import { convex } from "@/lib/convex-client";
import { createTool } from "@inngest/agent-kit";
import z from "zod";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

interface BulkCreateToolOptions {
    projectId: Id<"projects">;
    internalKey: string;
}

const bulkEntrySchema = z.object({
    filename: z.string().min(1, "filename cannot be empty"),
    filePath: z.string().default(""),
    type: z.enum(["file", "folder"]),
    content: z.string(),
}).strict();

const paramsSchema = z.object({
    entries: z.array(bulkEntrySchema).min(1, "Provide at least one entry to create"),
});

export const createCreateFilesTool = ({ internalKey, projectId }: BulkCreateToolOptions) => {
    return createTool({
        name: "createFiles",
        description:
            "Bulk create files and folders. Input 'entries' only as an array of objects (do not send top-level filename/type/content). Each entry requires filename, filePath (empty string for root), type ('file' or 'folder'), and content. Use \"\" as content when creating an empty file or any folder. It returns an array of results mentioning creation success or error for each entry.",
        parameters: z.object({
            entries: z
                .array(
                    z.object({
                        filename: z.string().describe("Name of file/folder to create"),
                        filePath: z
                            .string()
                            .describe("Parent folder path in which this file needs to be created. Use empty string for root level, it cannot contain .ts .js .py like and file extensions"),
                        type: z
                            .enum(["file", "folder"])
                            .describe("Whether this entry is a file or folder"),
                        content: z.string().describe("Required content string. Use \"\" for empty file content. For folders, pass \"\"."),
                    }).strict()
                )
                .min(1)
                .describe("Array of entries to create"),
        }).strict(),
        handler: async (params, { step: toolStep, network }) => {
            const iteration = network?.state?.results?.length ?? 0;
            const stepId = `tool-${iteration + 1}-bulk-create`;
            const parsed = paramsSchema.safeParse(params);

            if (!parsed.success) {
                return `Error: ${parsed.error.issues[0].message}`;
            }

            const entries = parsed.data.entries;

            try {
                return await toolStep?.run(stepId, async () => {
                    const results = await convex.mutation(api.system.createBulkEntries, {
                        internalKey,
                        projectId,
                        entries,
                    });

                    const created = results.filter((result) => !result.error);
                    const failed = results.filter((result) => result.error);

                    let response = `Created ${created.length}/${results.length} item(s).`;

                    if (created.length > 0) {
                        response += ` Success: ${created
                            .map((result) => `${result.type}:${result.filename}`)
                            .join(", ")}.`;
                    }

                    if (failed.length > 0) {
                        response += ` Failed: ${failed
                            .map(
                                (result) =>
                                    `${result.type}:${result.filename} at "${result.filePath}" (${result.error})`
                            )
                            .join(", ")}.`;
                    }

                    return response;
                });
            } catch (error) {
                return `Error creating items: ${error instanceof Error ? error.message : "Unknown error"}`;
            }
        },
    });
};