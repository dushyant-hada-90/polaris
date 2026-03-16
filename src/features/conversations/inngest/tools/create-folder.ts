import { convex } from "@/lib/convex-client";
import { createTool } from "@inngest/agent-kit";
import z from "zod";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

interface CreateFolderToolOptions {
    projectId: Id<"projects">;
    internalKey: string;
}

const paramsSchema = z.object({
    parentId: z.string(),
    name: z.string()
})


export const createCreateFolderTool = ({ internalKey, projectId }: CreateFolderToolOptions) => {
    return createTool({
        name: "createFolder",
        description: "Create a new folder in the project. Returns a success message containing the new folder ID, or an error message if it fails.",
        parameters: z.object({
            name: z.string().describe("The name of the folder to create"),
            parentId: z
                .string()
                .describe(
                    "The ID (not name) of the parent folder from listFiles, or empty string for root level"
                )
        }),
        handler: async (params, { step: toolStep }) => {
            const parsed = paramsSchema.safeParse(params)
            if (!parsed.success) {
                return `Error : ${parsed.error.issues[0].message}`
            }

            const { parentId, name } = parsed.data


            try {
                return await toolStep?.run("create-Folder", async () => {
                    let resolvedParentId: Id<"files"> | undefined

                    if (parentId && parentId !== "") {
                        try {
                            resolvedParentId = parentId as Id<"files">
                            const parentFolder = await convex.query(api.system.getFileById, {
                                internalKey,
                                fileId: resolvedParentId,
                            });
                            if (!parentFolder) {
                                return `Error: Parent folder with ID "${parentId}" not found.Use listFiles to get valid folder IDs.`;
                            }
                            if (parentFolder.type !== "folder") {
                                return `Error: The ID "${parentId}" is a file, not a folder.Use a folder ID as parentId.`;
                            }
                        } catch (error) {
                            return `Error: Invalid parentId "${parentId}" Use listFolder to get valid folder IDs, or use empty string for root level.`
                        }
                    }
                    const folderId = await convex.mutation(api.system.createFolder, {
                        internalKey,
                        projectId,
                        parentId: resolvedParentId,
                        name,
                    })

                    return `Folder created with ID: ${folderId}`

                })

            } catch (error) {
                return `Error creating Folder: ${error instanceof Error ? error.message : "Unknown error"}`
            }
        }
    })
}