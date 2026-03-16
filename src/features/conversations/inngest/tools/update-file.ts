import { convex } from "@/lib/convex-client";
import { createTool } from "@inngest/agent-kit";
import z from "zod";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

interface UpdateFileToolOptions {
    internalKey: string;
}

const paramsSchema = z.object({
    fileId: z.string().min(1, "File ID is required"),
    content: z.string(),
})

export const createUpdateFileTool = ({ internalKey }: UpdateFileToolOptions) => {
    return createTool({
        name: "updateFile",
        description: "Update the content of an existing file. Returns a success message if the update was successful, or an error message if it fails.",
        parameters: z.object({
            fileId: z.string().describe("The ID of the file to update"),
            content: z.string().describe("The new content for the file"),
        }),
        handler: async (params, { step: toolStep }) => {
            const parsed = paramsSchema.safeParse(params)
            if (!parsed.success) {
                return `Error : ${parsed.error.issues[0].message}`
            }

            const { fileId, content } = parsed.data

            // Fast fail if it looks like the agent passed a filename
            if (fileId.includes('.') || fileId.includes('/')) {
                return `Error: You passed file name or path instead of file IDs: ${fileId}. You MUST call the listFiles tool first to get the correct file IDs!`;
            }

            // Validate file exists befpre running the step
            const file = await convex.query(api.system.getFileById, {
                internalKey,
                fileId: fileId as Id<"files">,
            })

            if (!file) {
                return `Error: File with ID "${fileId}" not found. Use listFiles to get valid file IDs.`;
            }

            if (file.type === "folder") {
                return `Error: "${fileId}" is a folder, not a file. You can only update file contents.`
            }



            try {
                return await toolStep?.run("update-files", async () => {
                    await convex.mutation(api.system.updateFile, {
                        internalKey,
                        fileId: fileId as Id<"files">,
                        content,
                    })

                    return `file "${file.name}" updated successfully`
                })
            } catch (error) {
                return `Error updating files: ${error instanceof Error ? error.message : "Unknown error"}`
            }
        }
    })
}