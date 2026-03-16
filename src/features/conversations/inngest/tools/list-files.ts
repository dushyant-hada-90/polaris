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
            "List all files and folders in the project. Returns an array of objects containing names, IDs, types, parentId, and resolved paths for each item, or an error if it fails. Items with parentId: null are at root level. Use the parentId to understand the folder structure - items with the same parentId are in the same folder.",
        parameters: z.object({}),
        handler: async (_, { step: toolStep }) => {
            try {
                return await toolStep?.run("list-files", async () => {
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