import { inngest } from "@/inngest/client";
import { Id } from "../../../../convex/_generated/dataModel";
import { NonRetriableError } from "inngest";
import { createAgent, createNetwork, gemini, grok, openai } from "@inngest/agent-kit";
import { api } from "../../../../convex/_generated/api";
import { convex } from "@/lib/convex-client";
import { CODING_AGENT_SYSTEM_PROMPT, TITLE_GENERATOR_SYSTEM_PROMPT } from "./constants";
import { DEFAULT_CONVERSATION_TITLE } from "../constants";
import { createListFilesTool } from "./tools/list-files";
import { createReadFilesTool } from "./tools/read-files";
import { createUpdateFileTool } from "./tools/update-file";
import { createCreateFilesTool } from "./tools/create-files";
import { createCreateFolderTool } from "./tools/create-folder";
import { createRenameFileTool } from "./tools/rename-file";
import { createDeleteFilesTool } from "./tools/delete-files";
import { createScrapeUrlsTool } from "./tools/scrape-urls";


interface MessageEvent {
    messageId: Id<"messages">;
    conversationId: Id<"conversations">;
    projectId: Id<"projects">;
    message: string;
}

export const processMessage = inngest.createFunction(
    {
        id: "process-message",
        cancelOn: [
            {
                event: "message/cancel",
                if: "event.data.messageId == async.data.messageId",
            }
        ],
        onFailure: async ({ event, step }) => {
            const { messageId } = event.data.event.data as MessageEvent
            const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY

            //update message with error content
            if (internalKey) {
                await step.run("update-message-on-failure", async () => {
                    await convex.mutation(api.system.updateMessageContent, {
                        internalKey,
                        messageId,
                        content:
                            "My apologies, I encountered an error while processing your request. Let me know if you need anything else!",
                    });
                })
            }
        }
    },
    {
        event: "message/sent",
    },

    async ({ event, step }) => {
        const {
            messageId,
            conversationId,
            projectId,
            message,
        } = event.data as MessageEvent

        const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

        if (!internalKey) {
            throw new NonRetriableError("POLARIS_CONVEX_INTERNAL_KEY is not configured");
        }

        // TODO: Check if this is needed
        await step.sleep("wait-for-db-sync", "1s");

        // get conversation for title generation check
        const conversation = await step.run("get-conversation", async () => {
            return await convex.query(api.system.getConversationById, {
                internalKey,
                conversationId,
            })
        })

        if (!conversation) {
            throw new NonRetriableError('Conversation not found')
        }

        // fetch recent messages for conversation context
        const recentMessages = await step.run("get-recent-messages", async () => {
            return await convex.query(api.system.getRecentMessages, {
                internalKey,
                conversationId,
                limit: 10
            })
        })

        let systemPrompt = CODING_AGENT_SYSTEM_PROMPT
        // Filter out the current processing message and empty messages
        const contextMessages = recentMessages.filter(
            (msg) => msg._id !== messageId && msg.content.trim() !== ""
        );

        if (contextMessages.length > 0) {
            const historyText = contextMessages
                .map((msg) => `${msg.role.toUpperCase()}:${msg.content}`)
                .join("\n\n")

            systemPrompt += `\n\n## Previous Conversation (for context only -Do NOT repeat these responses): \n${historyText}\n\n## 
            Request:\nRespond ONLY to the user's new message below. 
            Do not repeat  or reference your previous responses.`
        }

        // Generate conversation title if it's still the default
        const shouldGenerateTitle =
            conversation.title == DEFAULT_CONVERSATION_TITLE;

        if (shouldGenerateTitle) {
            const titleAgent = createAgent({

                name: "title-generator",
                system: TITLE_GENERATOR_SYSTEM_PROMPT,

                model: openai({
                    model: "llama-3.1-8b-instant",
                    apiKey: process.env.GROQ_API_KEY,
                    baseUrl: "https://api.groq.com/openai/v1",
                    defaultParameters: {
                        max_completion_tokens: 20,
                        temperature: 0.2,
                    },
                }),
                // model: gemini({ 
                //     model: "gemini-1.0-flash"
                //     })


            });
            const { output } = await titleAgent.run(message, { step })

            const textMessage = output.find(
                (m) => m.type === "text" && m.role == "assistant"
            )

            if (textMessage?.type === "text") {
                const title =
                    typeof textMessage.content === "string"
                        ? textMessage.content.trim()
                        : textMessage.content
                            .map((c) => c.text)
                            .join("")
                            .trim();
                if (title) {
                    await step.run("update-conversation-title", async () => {
                        await convex.mutation(api.system.updateConversationTitle, {
                            internalKey,
                            conversationId,
                            title,
                        })
                    })
                }
            }
        }

        // create coding agent qwen3-32b
        const codingModel = openai({
            model: "qwen/qwen3-32b",
            apiKey: process.env.GROQ_API_KEY,
            baseUrl: "https://api.groq.com/openai/v1",
            defaultParameters: {
                temperature: 0.3,
                max_completion_tokens: 4500,
                parallel_tool_calls: false,
            },
        });

        // HOTFIX: Some models via OpenAI compatible endpoints return `null` for arguments when there are no parameters.
        // This crashes @inngest/agent-kit because it tries to evaluate `tool.input.arguments`.
        // We wrap the response parser and ensure `tool.input` is always at least an empty object.
        const originalResponseParser = (codingModel as any).responseParser;
        (codingModel as any).responseParser = (output: any) => {
            const msgs = originalResponseParser(output);
            msgs.forEach((msg: any) => {
                if (msg.type === "tool_call" && Array.isArray(msg.tools)) {
                    msg.tools.forEach((tool: any) => {
                        if (!tool.input) {
                            tool.input = {};
                        }
                    });
                }
            });
            return msgs;
        };

        const getCodingAgent = (iteration: number) => {
            const codingAgent = createAgent({
                name: `polaris-${iteration + 1}`,
                description: "An expert AI coding assistant",
                system: systemPrompt,
                model: codingModel,
                tools: [
                    createListFilesTool({ projectId, internalKey }),
                    createReadFilesTool({ internalKey }),
                    createUpdateFileTool({ internalKey }),
                    createCreateFilesTool({ internalKey, projectId }),
                    createCreateFolderTool({ internalKey, projectId }),
                    createRenameFileTool({ internalKey }),
                    createDeleteFilesTool({ internalKey }),
                    createScrapeUrlsTool()

                ],
            })
            return codingAgent
        }

        const network = createNetwork({
            name: "polaris-network",
            agents: [getCodingAgent(0)],
            maxIter: 20,
            router: ({ network }) => {
                const lastResult = network.state.results.at(-1)
                const hasTextResponse = lastResult?.output.some(
                    (m) => m.type === "text" && m.role === "assistant"
                )
                const hasToolCalls = lastResult?.output.some(
                    (m) => m.type === "tool_call"
                )

                if (hasTextResponse && !hasToolCalls) {
                    return undefined
                }
                const currentIteration = network.state.results.length;
                return getCodingAgent(currentIteration)
            }
        })


        const result = await network.run(message)

        // Extract the assistant's text response from the last agent result
        const lastResult = result.state.results.at(-1);
        const textMessage = lastResult?.output.find(
            (m) => m.type === "text" && m.role === "assistant"
        )



        let assistantResponse = "I processed your request. Let me know if you need anything else!";

        if (textMessage?.type === "text") {
            assistantResponse =
                typeof textMessage.content === "string"
                    ? textMessage.content
                    : textMessage.content.map((c) => c.text).join("");
        }

        await step.run("update-assistant-message", async () => {
            await convex.mutation(api.system.updateMessageContent, {
                internalKey,
                messageId,
                content: assistantResponse
            })
        });

        return { success: true, messageId, conversationId }
    }
)
