import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";
import { Doc, Id } from "./_generated/dataModel";

export const getFiles = query({
    args: { projectId: v.id("projects") },
    handler: async (ctx, args) => {
        const identity = await verifyAuth(ctx);

        const project = await ctx.db.get("projects", args.projectId);

        if (!project) {
            throw new Error("Project not found");
        }
        if (project.ownerId !== identity.subject) {
            throw new Error("Unauthorized to access this project");
        }
        return await ctx.db
            .query("files")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();
    }
})

export const getFile = query({
    args: { id: v.id("files") },
    handler: async (ctx, args) => {
        const identity = await verifyAuth(ctx);

        const file = await ctx.db.get("files", args.id);

        if (!file) {
            throw new Error("File not found");
        }

        const project = await ctx.db.get("projects", file.projectId);

        if (!project) {
            throw new Error("Project not found");
        }


        if (project.ownerId !== identity.subject) {
            throw new Error("Unauthorized to access this project");
        }

        return file;
    }
})

export const getFolderContents = query({
    args: { projectId: v.id("projects"), parentId: v.optional(v.id("files")) },
    handler: async (ctx, args) => {
        const identity = await verifyAuth(ctx);

        const project = await ctx.db.get("projects", args.projectId);

        if (!project) {
            throw new Error("Project not found");
        }
        if (project.ownerId !== identity.subject) {
            throw new Error("Unauthorized to access this project");
        }
        const files = await ctx.db
            .query("files")
            .withIndex("by_project_and_parent",
                (q) => q
                    .eq("projectId", args.projectId)
                    .eq("parentId", args.parentId)
            )
            .collect();

        return files.sort((a, b) => {
            if (a.type === "folder" && b.type === "file") {
                return -1;
            }
            if (a.type === "file" && b.type === "folder") {
                return 1;
            }
            return a.name.localeCompare(b.name);
        })
    }
})

export const getFilePath = query({
    args: { id: v.id("files") },
    handler: async (ctx, args) => {
        const identity = await verifyAuth(ctx);
        const file = await ctx.db.get("files", args.id)

        if (!file) {
            throw new Error("Project not found");
        }

        const project = await ctx.db.get("projects", file.projectId)

        if (!project) {
            throw new Error("Project not found");
        }
        if (project.ownerId !== identity.subject) {
            throw new Error("Unauthorized to access this project");
        }

        const path: { _id: string, name: string }[] = []
        let currentId: Id<"files"> | undefined = args.id

        while (currentId) {
            const file = (await ctx.db.get("files", currentId)) as
                | Doc<"files">
                | undefined;
            if (!file) break;

            path.unshift({_id:file._id,name:file.name})
            currentId = file.parentId
        }

        return path
    }
})
export const createFile = mutation({
    args: {
        projectId: v.id("projects"),
        parentId: v.optional(v.id("files")),
        name: v.string(),
        content: v.string(),

    },
    handler: async (ctx, args) => {
        const identity = await verifyAuth(ctx);

        const project = await ctx.db.get("projects", args.projectId);

        if (!project) {
            throw new Error("Project not found");
        }
        if (project.ownerId !== identity.subject) {
            throw new Error("Unauthorized to access this project");
        }
        const files = await ctx.db
            .query("files")
            .withIndex("by_project_and_parent",
                (q) => q
                    .eq("projectId", args.projectId)
                    .eq("parentId", args.parentId)
            )
            .collect();

        const existing = files.find((file) => file.name === args.name && file.type === "file");

        if (existing) {
            throw new Error("File with this name already exists");
        }

        const newFile = await ctx.db.insert("files", {
            projectId: args.projectId,
            parentId: args.parentId,
            name: args.name,
            content: args.content,
            type: "file",
            updatedAt: Date.now()
        });
        await ctx.db.patch("projects", args.projectId, {
            updatedAt: Date.now()
        })
        return newFile;
    }
})

export const createFolder = mutation({
    args: {
        projectId: v.id("projects"),
        parentId: v.optional(v.id("files")),
        name: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await verifyAuth(ctx);

        const project = await ctx.db.get("projects", args.projectId);

        if (!project) {
            throw new Error("Project not found");
        }
        if (project.ownerId !== identity.subject) {
            throw new Error("Unauthorized to access this project");
        }
        const files = await ctx.db
            .query("files")
            .withIndex("by_project_and_parent",
                (q) => q
                    .eq("projectId", args.projectId)
                    .eq("parentId", args.parentId)
            )
            .collect();

        const existing = files.find((file) => file.name === args.name && file.type === "folder");

        if (existing) {
            throw new Error("Folder with this name already exists");
        }

        const newFolder = await ctx.db.insert("files", {
            projectId: args.projectId,
            parentId: args.parentId,
            name: args.name,
            type: "folder",
            updatedAt: Date.now()
        });
        await ctx.db.patch("projects", args.projectId, {
            updatedAt: Date.now()
        })
        return newFolder;
    }
})

export const renameFile = mutation({
    args: {
        id: v.id("files"),
        newName: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await verifyAuth(ctx);

        const file = await ctx.db.get("files", args.id);

        if (!file) {
            throw new Error("File not found");
        }
        const project = await ctx.db.get("projects", file.projectId);

        if (!project) {
            throw new Error("Project not found");
        }

        if (project.ownerId !== identity.subject) {
            throw new Error("Unauthorized to access this project");
        }

        const siblings = await ctx.db
            .query("files")
            .withIndex("by_project_and_parent",
                (q) => q
                    .eq("projectId", file.projectId)
                    .eq("parentId", file.parentId)
            )
            .collect();

        const existing = siblings.find((f) => f.name === args.newName && f._id !== args.id && f.type === file.type);

        if (existing) {
            throw new Error(`${file.type} with this name already exists`);
        }

        await ctx.db.patch("files", args.id, {
            name: args.newName,
            updatedAt: Date.now()
        });

        await ctx.db.patch("projects", file.projectId, {
            updatedAt: Date.now()
        })
    }
})

export const deleteFile = mutation({
    args: {
        id: v.id("files"),
    },
    handler: async (ctx, args) => {
        const identity = await verifyAuth(ctx);

        const file = await ctx.db.get("files", args.id);

        if (!file) {
            throw new Error("File not found");
        }
        const project = await ctx.db.get("projects", file.projectId);

        if (!project) {
            throw new Error("Project not found");
        }

        if (project.ownerId !== identity.subject) {
            throw new Error("Unauthorized to access this project");
        }

        const deleteRecursively = async (fileId: Id<"files">) => {
            const item = await ctx.db.get("files", fileId);
            if (!item) return;
            if (item.type === "folder") {
                const children = await ctx.db.query("files")
                    .withIndex("by_project_and_parent", (q) =>
                        q
                            .eq("projectId", item.projectId)
                            .eq("parentId", fileId)
                    )
                    .collect()

                for (const child of children) {
                    await deleteRecursively(child._id)
                }
            }

            if (item.storageId) {
                await ctx.storage.delete(item.storageId)
            }

            await ctx.db.delete("files", fileId)
        }
        await deleteRecursively(args.id)

        await ctx.db.patch("projects", file.projectId, {
            updatedAt: Date.now()
        })
    }
})

export const updateFile = mutation({
    args: {
        id: v.id("files"),
        content: v.string(),
    },
    handler: async (ctx, args) => {
        const identity = await verifyAuth(ctx);
        const file = await ctx.db.get("files", args.id);

        if (!file) {
            throw new Error("File not found");
        }
        const project = await ctx.db.get("projects", file.projectId);

        if (!project) {
            throw new Error("Project not found");
        }
        if (project.ownerId !== identity.subject) {
            throw new Error("Unauthorized to access this project");
        }
        await ctx.db.patch("files", args.id, {
            content: args.content,
            updatedAt: Date.now()
        });

        await ctx.db.patch("projects", file.projectId, {
            updatedAt: Date.now()
        })
    }
})