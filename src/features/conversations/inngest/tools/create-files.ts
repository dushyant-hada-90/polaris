import { convex } from "@/lib/convex-client";
import { createTool } from "@inngest/agent-kit";
import z from "zod";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

interface CreateFilesToolOptions {
    projectId: Id<"projects">;
    internalKey: string;
}

const paramsSchema = z.object({
    parentId: z.string(),
    files: z
        .array(
            z.object({
                name: z.string().min(1, "File name cannot be empty"),
                content: z.string(),
            })
        )
        .min(1, "Provide at least one file to create"),
})


export const createCreateFilesTool = ({ internalKey, projectId }: CreateFilesToolOptions) => {
    return createTool({
        name: "createFiles",
        description:
            "Create multiple files at once in the same folder.Use this to batch create files that share the same parent folder. More efficient than creating files one by one. Returns a plain text summary listing how many files were created, which names succeeded, and which names failed with reasons.",
        parameters: z.object({
            parentId: z
                .string()
                .describe(
                    "The ID of the parent folder. Use empty string for root level. Must be a valid folder ID from listFiles."
                ),
            files: z
                .array(
                    z.object({
                        name: z.string().describe("The file name including extension"),
                        content: z.string().describe("The file content"),
                    }),
                )
                .describe("Array of files to create")
        }),
        handler: async (params, { step: toolStep, network }) => {
            const iteration = network?.state?.results?.length ?? 0
            const stepId = `tool-${iteration + 1}-create-files`
            const parsed = paramsSchema.safeParse(params)
            if (!parsed.success) {
                return `Error : ${parsed.error.issues[0].message}`
            }

            const { parentId, files } = parsed.data


            try {
                return await toolStep?.run(stepId, async () => {
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
                            return `Error: Invalid parentId "${parentId}" Use listFiles to get valid folder IDs, or use empty string for root level.`
                        }
                    }
                    const results = await convex.mutation(api.system.createFiles, {
                        internalKey,
                        projectId,
                        parentId: resolvedParentId,
                        files,
                    })

                    const created = results.filter((r) => !r.error)
                    const failed = results.filter((r) => r.error)

                    let response = `created ${created.length} file(s)`
                    if (created.length > 0) {
                        response += `: ${created.map((r) => r.name).join(", ")}`
                    }

                    if (failed.length > 0) {
                        response += `. Failed: ${failed.map((r) => `${r.name} (${r.error})`).join(", ")}`
                    }
                    return response
                })

            } catch (error) {
                return `Error creating files: ${error instanceof Error ? error.message : "Unknown error"}`
            }
        }
    })
}