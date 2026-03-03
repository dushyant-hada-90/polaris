import { useMutation, useQuery } from "convex/react";
import { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";

export const useCreateFile = () => {
    const mutation = useMutation(api.files.createFile);
    return mutation.withOptimisticUpdate((localStore, args) => {
        const currentValue = localStore.getQuery(api.files.getFolderContents, {
            projectId: args.projectId,
            parentId: args.parentId,
        });

        if (currentValue !== undefined) {
            const optimisticFile = {
                _id: crypto.randomUUID() as Id<"files">,
                _creationTime: Date.now(),
                projectId: args.projectId,
                parentId: args.parentId,
                name: args.name,
                content: args.content,
                type: "file" as const,
                updatedAt: Date.now(),
            };

            localStore.setQuery(api.files.getFolderContents, {
                projectId: args.projectId,
                parentId: args.parentId,
            }, [...currentValue, optimisticFile].sort((a, b) => {
                if (a.type === "folder" && b.type === "file") return -1;
                if (a.type === "file" && b.type === "folder") return 1;
                return a.name.localeCompare(b.name);
            }));
        }
    });
};

export const useCreateFolder = () => {
    const mutation = useMutation(api.files.createFolder);
    return mutation.withOptimisticUpdate((localStore, args) => {
        const currentValue = localStore.getQuery(api.files.getFolderContents, {
            projectId: args.projectId,
            parentId: args.parentId,
        });

        if (currentValue !== undefined) {
            const optimisticFolder = {
                _id: crypto.randomUUID() as Id<"files">,
                _creationTime: Date.now(),
                projectId: args.projectId,
                parentId: args.parentId,
                name: args.name,
                type: "folder" as const,
                updatedAt: Date.now(),
            };

            localStore.setQuery(api.files.getFolderContents, {
                projectId: args.projectId,
                parentId: args.parentId,
            }, [...currentValue, optimisticFolder].sort((a, b) => {
                if (a.type === "folder" && b.type === "file") return -1;
                if (a.type === "file" && b.type === "folder") return 1;
                return a.name.localeCompare(b.name);
            }));
        }
    });
};

export const useRenameFile = () => {
    const mutation = useMutation(api.files.renameFile);
    return mutation.withOptimisticUpdate((localStore, args) => {
        // We need to find which folder contains this file
        // Since we don't know the parent without the file data, we need to get the file first
        const currentFile = localStore.getQuery(api.files.getFile, { id: args.id });
        
        if (currentFile) {
            const currentValue = localStore.getQuery(api.files.getFolderContents, {
                projectId: currentFile.projectId,
                parentId: currentFile.parentId,
            });

            if (currentValue !== undefined) {
                localStore.setQuery(api.files.getFolderContents, {
                    projectId: currentFile.projectId,
                    parentId: currentFile.parentId,
                }, currentValue.map((file) =>
                    file._id === args.id
                        ? { ...file, name: args.newName, updatedAt: Date.now() }
                        : file
                ).sort((a, b) => {
                    if (a.type === "folder" && b.type === "file") return -1;
                    if (a.type === "file" && b.type === "folder") return 1;
                    return a.name.localeCompare(b.name);
                }));
            }

            // Also update the individual file query
            localStore.setQuery(api.files.getFile, { id: args.id }, {
                ...currentFile,
                name: args.newName,
                updatedAt: Date.now(),
            });
        }
    });
};

export const useDeleteFile = () => {
    const mutation = useMutation(api.files.deleteFile);
    return mutation.withOptimisticUpdate((localStore, args) => {
        const currentFile = localStore.getQuery(api.files.getFile, { id: args.id });
        
        if (currentFile) {
            const currentValue = localStore.getQuery(api.files.getFolderContents, {
                projectId: currentFile.projectId,
                parentId: currentFile.parentId,
            });

            if (currentValue !== undefined) {
                localStore.setQuery(api.files.getFolderContents, {
                    projectId: currentFile.projectId,
                    parentId: currentFile.parentId,
                }, currentValue.filter((file) => file._id !== args.id));
            }

            // Clear the individual file query
            localStore.setQuery(api.files.getFile, { id: args.id }, undefined);
        }
    });
};

export const useFolderContents = ({
    projectId,
    parentId,
    enabled = true,
}: {
    projectId: Id<"projects">;
    parentId?: Id<"files">;
    enabled?: boolean;
}) => {
    return useQuery(
        api.files.getFolderContents,
        enabled ? { projectId, parentId } : "skip",
    )
}