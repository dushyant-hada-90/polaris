import { convex } from "@/lib/convex-client";
import { createTool } from "@inngest/agent-kit";
import z from "zod";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

interface ReadFilesToolOptions {
    internalKey: string;
}

const paramsSchema = z.object({
    fileIds: z
        .array(z.string().min(1, "File ID cannot be empty"))
        .min(1, "Provide at least one file ID"),
})

export const createReadFilesTool = ({ internalKey }: ReadFilesToolOptions) => {
    return createTool({
        name: "readFiles",
        description: "Read file content from projects. CRITICAL: This tool ONLY accepts file IDs, NOT file names or paths. If you only know a file name, you MUST use the listFiles tool first to get its ID. Returns an array of file contents corresponding to the provided IDs, or an error message if it fails.",
        parameters: z.object({
            fileIds: z.array(z.string()).describe("Array of unique file IDs to read (e.g., 'jd7x...'). NEVER pass file names (like 'index.ts') here! Use listFiles first if you don't know the ID.")
        }),
        handler: async (params, { step: toolStep }) => {
            const parsed = paramsSchema.safeParse(params)
            if (!parsed.success) {
                return `Error : ${parsed.error.issues[0].message}`
            }

            const { fileIds } = parsed.data



            try {
                return await toolStep?.run("read-files", async () => {
                    const results: { id: string; name: string; content: string }[] = []

                    // Fast fail if it looks like the agent passed a filename
                    const invalidIds = fileIds.filter(id => id.includes('.') || id.includes('/'));
                    if (invalidIds.length > 0) {
                        return `Error: You passed file names or paths instead of file IDs: ${invalidIds.join(', ')}. You MUST call the listFiles tool first to get the correct file IDs!`;
                    }

                    for (const fileId of fileIds) {
                        const file = await convex.query(api.system.getFileById, {
                            internalKey,
                            fileId: fileId as Id<"files">
                        })

                        if (file && file.content) {
                            results.push({
                                id: file._id,
                                name: file.name,
                                content: file.content,
                            })
                        }
                    }

                    if (results.length === 0) {
                        return "Error:No files provided with provided IDs. use listFiles to get valid fileIds."
                    }

                    return JSON.stringify(results)
                })
            } catch (error) {
                return `Error reading files: ${error instanceof Error ? error.message : "Unknown error"}`
            }
        }
    })
}