import { convex } from "@/lib/convex-client";
import { createTool } from "@inngest/agent-kit";
import z from "zod";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

interface RenameFileToolOptions {
    internalKey: string;
}

const paramsSchema = z.object({
    fileId: z.string().min(1, "File ID is required"),
    newName: z.string().min(1, "New name is required")
});

export const createRenameFileTool = ({ internalKey }: RenameFileToolOptions) => {
    return createTool({
        name: "renameFile",
        description: "Rename a file or folder (id remins same only the name is updated). Returns a success message if the Rename was successful, or an error message if it fails.",
        parameters: z.object({
            fileId: z.string().describe("The ID of the file to Rename"),
            newName: z.string().describe("The new name for the file or folder"),
        }),
        handler: async (params, { step: toolStep ,network}) => {

            // 2. Grab the current network loop count (safely fallback to 0)
            const iteration = network?.state?.results?.length ?? 0;

            // 3. Combine Iteration + Arguments for a 100% unique, deterministic ID
            const stepId = `rename-files-iter-${iteration}`; //upgrade the identifier when project upgrades to parallel execution
            const parsed = paramsSchema.safeParse(params)
            if (!parsed.success) {
                return `Error : ${parsed.error.issues[0].message}`
            }

            const { fileId, newName } = parsed.data

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

            try {
                return await toolStep?.run(stepId, async () => {
                    await convex.mutation(api.system.renameFile, {
                        internalKey,
                        fileId: fileId as Id<"files">,
                        newName,
                    })

                    return `file "${file.name}" Renamed successfully to "${newName}`
                })
            } catch (error) {
                return `Error updating files: ${error instanceof Error ? error.message : "Unknown error"}`
            }
        }
    })
}