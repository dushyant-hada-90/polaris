import { CopyIcon, HistoryIcon, LoaderIcon, PlusIcon } from "lucide-react";
import { Id } from "../../../../convex/_generated/dataModel";
import { DEFAULT_CONVERSATION_TITLE } from "../../../../convex/constants";
import { Button } from "@/components/ui/button";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputMessage, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "@/components/ai-elements/prompt-input";
import { useConversation, useConversations, useCreateConversation, useMessages } from "../hooks/use-conversations";
import { useState } from "react";
import { toast } from "sonner";
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import ky from "ky";
import { nanoid } from "nanoid";

interface ConversationSidebarProps {
    projectId: Id<"projects">;
}
export const ConversationSidebar = ({
    projectId,
}: ConversationSidebarProps) => {

    const [selectedConversationId, setSelectedConversationId] = useState<Id<"conversations"> | null>(null)
    const [isPendingNewConversation, setIsPendingNewConversation] = useState(false) //tracks if this conversation is pending to be created in db 
    const createConversation = useCreateConversation()
    const conversations = useConversations(projectId)
    const activeConversationId = selectedConversationId ?? conversations?.[0]?._id ?? null

    const activeConversation = useConversation(activeConversationId && !isPendingNewConversation ? activeConversationId : null)
    const conversationMessages = useMessages(activeConversationId && !isPendingNewConversation ? activeConversationId : null)
    const [input, setInput] = useState("")
    const [isSubmitting, setIsSubmitting] = useState(false)
    // check if any message is currently processing 
    const isProcessing = conversationMessages?.some(
        (msg) => msg.status === "processing"
    )
    // Disable input if submitting or processing
    const isDisabled = isSubmitting || isProcessing

    const handleCreateConversation = () => {
        // Create a temporary conversation ID (UI only, not in DB)
        const tempConversationId = nanoid() as Id<"conversations">
        setSelectedConversationId(tempConversationId)
        setIsPendingNewConversation(true)
    }

    const handleSubmit = async (message: PromptInputMessage) => {
        if (isProcessing && !message.text) {
            // todo await cancel
            setInput("")
            return
        }

        // Immediately disable input to prevent multiple submissions
        setIsSubmitting(true)
        setInput("")

        let conversationId = activeConversationId

        // If this is a pending new conversation, create it in DB first
        if (isPendingNewConversation && conversationId) {
            try {
                const newConversationId = await createConversation({
                    projectId,
                    title: DEFAULT_CONVERSATION_TITLE,
                })
                // Update the selected conversation ID to the real one from DB
                setSelectedConversationId(newConversationId)
                setIsPendingNewConversation(false)
                conversationId = newConversationId
            } catch (error) {
                toast.error("Unable to create new conversation")
                setIsSubmitting(false)
                return
            }
        }

        // trigger innges function 
        try {
            await ky.post("/api/messages", {
                json: {
                    conversationId,
                    message: message.text,
                },
            })
        } catch (error) {
            toast.error("Failed to send message")
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="flex flex-col h-full bg-sidebar">
            <div className="h-8.75 flex items-center justify-between border-b">
                <div className="text-sm truncate pl-3">
                    {activeConversation?.title ?? DEFAULT_CONVERSATION_TITLE}
                </div>
                <div className="flex items-center px-1 gap-1">
                    <Button
                        size="icon-xs"
                        variant="highlight"
                    >
                        <HistoryIcon className="size-3.5" />
                    </Button>

                    <Button
                        size="icon-xs"
                        variant="highlight"
                        onClick={handleCreateConversation}
                        disabled={isPendingNewConversation}
                    >
                        <PlusIcon className="size-3.5" />
                    </Button>
                </div>
            </div >
            <Conversation className="flex-1">
                <ConversationContent>
                    {conversationMessages?.map((message, messageIndex) => (
                        <Message
                            key={message._id}
                            from={message.role}
                        >
                            <MessageContent>
                                {message.status === "processing" ? (
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                        <LoaderIcon className="size-4 animate-spin" />
                                        <span>Thinking ...</span>
                                    </div>
                                ) : (
                                    <MessageResponse>
                                        {message.content}
                                    </MessageResponse>
                                )}
                            </MessageContent>
                            {message.role === "assistant" &&
                                message.status === "completed" &&
                                messageIndex === (conversationMessages?.length ?? 0) - 1 &&
                                (
                                    <MessageActions>
                                        <MessageAction
                                            onClick={() => navigator.clipboard.writeText(message.content)}
                                            label="Copy"
                                        >
                                            <CopyIcon className="size-3" />
                                        </MessageAction>
                                    </MessageActions>
                                )
                            }
                        </Message>
                    ))}
                </ConversationContent>
                <ConversationScrollButton />
            </Conversation>
            <div className="p-3">
                <PromptInput
                    onSubmit={handleSubmit}
                    className="mt-2"
                >
                    <PromptInputBody>
                        <PromptInputTextarea
                            placeholder="Ask anything..."
                            onChange={(e) => setInput(e.target.value)}
                            value={input}
                            disabled={isDisabled}
                        />
                    </PromptInputBody>
                    <PromptInputFooter>
                        <PromptInputTools />
                        <PromptInputSubmit
                            disabled={isDisabled ? false : !input}
                            status={isDisabled ? "streaming" : undefined}
                        />
                    </PromptInputFooter>

                </PromptInput>
            </div>
        </div >

    );

};