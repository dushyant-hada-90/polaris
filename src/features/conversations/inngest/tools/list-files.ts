import { convex } from "@/lib/convex-client";
import { createTool } from "@inngest/agent-kit";
import z from "zod";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";


type Item = {
    id: string
    name: string
    type: "file" | "folder"
    parentId: string | null
}

type ItemWithPath = Item & { path: string }

const paramsSchema = z.object({})

export function addPaths(fileList: Item[]): ItemWithPath[] {
    const map = new Map<string, Item>()
    fileList.forEach(f => map.set(f.id, f))

    return fileList.map(file => {
        const pathParts: string[] = []
        const visited = new Set<string>()

        let current: Item | undefined = file

        while (current) {
            // circular reference protection
            if (visited.has(current.id)) {
                throw new Error(`Circular parent reference detected at ${current.id}`)
            }
            visited.add(current.id)

            pathParts.unshift(current.name)

            if (!current.parentId) break

            const parent = map.get(current.parentId)

            // missing parent protection
            if (!parent) {
                throw new Error(`Parent ${current.parentId} not found for ${current.id}`)
            }

            current = parent
        }

        return {
            ...file,
            path: "/" + pathParts.join("/")
        }
    })
}


interface ReadFilesToolOptions {
    internalKey: string;
    projectId: Id<"projects">
}

export const createListFilesTool = ({ internalKey, projectId }: ReadFilesToolOptions) => {
    return createTool({
        name: "listFiles",
        description:
            "List all files and folders in the project. Returns a JSON string array of objects with id, name, type, parentId, and resolved path for each item, or an error message.",
        parameters: z.object({}),
        handler: async (params, { step: toolStep, network }) => {
            const iteration = network?.state?.results?.length ?? 0
            const stepId = `tool-${iteration + 1}-list-files`
            const parsed = paramsSchema.safeParse(params)
            if (!parsed.success) {
                return `Error : ${parsed.error.issues[0].message}`
            }

            try {
                return await toolStep?.run(stepId, async () => {
                    const files = await convex.query(api.system.getProjectFiles, {
                        internalKey,
                        projectId,
                    })

                    // Sort: folders first then files alphabetically
                    const sorted = files.sort((a, b) => {
                        if (a.type !== b.type) {
                            return a.type === "folder" ? -1 : 1;
                        }
                        return a.name.localeCompare(b.name);
                    });

                    const fileListRaw = sorted.map((f) => ({
                        id: f._id,
                        name: f.name,
                        type: f.type,
                        parentId: f.parentId ?? null,
                    }))

                    const fileList = addPaths(fileListRaw)
                    return JSON.stringify(fileList)
                })
            } catch (error) {
                return `Error listing files: ${error instanceof Error ? error.message : "Unknown error"}`
            }
        }
    })
}