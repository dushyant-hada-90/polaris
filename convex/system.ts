import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";



// Guards all system queries/mutations — throws if the caller doesn't supply the correct secret key.
const validateInternalKey = (key: string) => {
    const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;

    if (!internalKey) {
        throw new Error("POLARIS_CONVEX_INTERNAL_KEY is not configured");
    }
    if (key !== internalKey) {
        throw new Error("Invalid internal key");
    }
}

// Fetches a single conversation document by its ID. Used by the messages API to resolve
// the projectId and verify the conversation exists before creating messages.
export const getConversationById = query({
    args: {
        conversationId: v.id("conversations"),
        internalKey: v.string(),
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey)
        return await ctx.db.get(args.conversationId);
    }
})

// Inserts a new message (user or assistant) into the messages table and bumps
// the parent conversation's updatedAt timestamp. Returns the new message ID.
export const createMessage = mutation({
    args: {
        internalKey: v.string(),
        conversationId: v.id("conversations"),
        projectId: v.id("projects"),
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        status: v.optional(
            v.union(
                v.literal("processing"),
                v.literal("completed"),
                v.literal("cancelled")
            )
        ),
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey)

        const messageId = await ctx.db.insert("messages", {
            conversationId: args.conversationId,
            projectId: args.projectId,
            role: args.role,
            content: args.content,
            status: args.status,
        });

        // Update conversation's updatedAt
        await ctx.db.patch(args.conversationId, {
            updatedAt: Date.now(),
        });

        return messageId
    }
})

// Sets the final content of an assistant message and marks its status as "completed".
// Called by the Inngest function once the AI response is fully streamed.
export const updateMessageContent = mutation({
    args: {
        internalKey: v.string(),
        messageId: v.id("messages"),
        content: v.string(),
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey);

        await ctx.db.patch(args.messageId, {
            content: args.content,
            status: "completed" as const,
        });
    }
})


// Returns all messages that are currently in "processing" status for a given project.
// Used by the cancel endpoint to find which messages need to be aborted.
export const getProcessingMessages = query({
    args: {
        internalKey: v.string(),
        projectId: v.id("projects"),
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey);

        return await ctx.db
            .query("messages")
            .withIndex("by_project_status", (q) =>
                q
                    .eq("projectId", args.projectId)
                    .eq("status", "processing")
            )
            .collect()
    }
})


// Updates the status of a single message (e.g. "processing" → "cancelled").
// Used by the cancel endpoint after sending the cancellation event to Inngest.
export const updateMessageStatus = mutation({
    args: {
        internalKey: v.string(),
        messageId: v.id("messages"),
        status: v.union(
            v.literal("processing"),
            v.literal("completed"),
            v.literal("cancelled")
        )
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey);

        await ctx.db.patch(args.messageId, {
            status: args.status,
        })
    }
})

// Returns the N most recent messages for a conversation, ordered oldest-first.
// Fed to the AI agent as conversation context when processing a new message.
export const getRecentMessages = query({
    args: {
        internalKey: v.string(),
        conversationId: v.id("conversations"),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey);

        const messages = await ctx.db
            .query("messages")
            .withIndex("by_conversation", (q) =>
                q.eq("conversationId", args.conversationId)
            )
            .order("asc")
            .collect();

        const limit = args.limit ?? 10
        return messages.slice(-limit)
    }
})

// Overwrites the conversation title and bumps updatedAt. Called by the agent
// after generating a descriptive title from the first user message.
export const updateConversationTitle = mutation({
    args: {
        internalKey: v.string(),
        conversationId: v.id("conversations"),
        title: v.string(),
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey);

        await ctx.db.patch(args.conversationId, {
            title: args.title,
            updatedAt: Date.now(),
        });
    }
});

// Retrieves all files belonging to a project. Exposed to the AI agent via
// the "listFiles" tool so it can enumerate the project's file tree.
export const getProjectFiles = query({
    args: {
        internalKey: v.string(),
        projectId: v.id("projects"),
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey);

        return await ctx.db
            .query("files")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect();
    }
})

// Fetches a single file document by its ID. Used by the agent's "readFile" tool
// to retrieve file content before editing or referencing it.
export const getFileById = query({
    args: {
        internalKey: v.string(),
        fileId: v.id("files"),
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey);

        return await ctx.db.get(args.fileId);

    }
});

// Overwrites the content of an existing file and bumps its updatedAt timestamp.
// Called by the agent's "editFile" tool after generating new file content.
export const updateFile = mutation({
    args: {
        internalKey: v.string(),
        fileId: v.id("files"),
        content: v.string(),
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey);

        const file = await ctx.db.get(args.fileId);

        if (!file) {
            throw new Error("File not found");
        }

        await ctx.db.patch(args.fileId, {
            content: args.content,
            updatedAt: Date.now(),
        })

        return args.fileId
    }
});


export const createFile = mutation({
    args: {
        internalKey: v.string(),
        projectId: v.id("projects"),
        name: v.string(),
        content: v.string(),
        parentId: v.optional(v.id("files")),
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey);

        const files = await ctx.db
            .query("files")
            .withIndex("by_project_and_parent", (q) =>
                q.eq("projectId", args.projectId).eq("parentId", args.parentId)
            )
            .collect()

        const existing = files.find(
            (file) => file.name === args.name && file.type === "file"
        )
        if (existing) {
            throw new Error("File already exists");
        }

        const fileId = await ctx.db.insert("files", {
            projectId: args.projectId,
            name: args.name,
            content: args.content,
            type: "file",
            parentId: args.parentId,
            updatedAt: Date.now(),
        })

        return fileId
    }
})

export const createFiles = mutation({
    args: {
        internalKey: v.string(),
        projectId: v.id("projects"),
        parentId: v.optional(v.id("files")),
        files: v.array(
            v.object({
                name: v.string(),
                content: v.string(),
            })
        ),
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey);

        const existingFiles = await ctx.db
            .query("files")
            .withIndex("by_project_and_parent", (q) =>
                q.eq("projectId", args.projectId).eq("parentId", args.parentId)
            )
            .collect();

        const results: { name: string; fileId: string; error?: string }[] = []

        for (const file of args.files) {
            const existing = existingFiles.find(
                (f) => f.name === file.name && f.type === "file"
            )

            if (existing) {
                results.push({
                    name: file.name,
                    fileId: existing._id,
                    error: "File already exists",
                })
                continue;
            }

            const fileId = await ctx.db.insert("files", {
                projectId: args.projectId,
                name: file.name,
                content: file.content,
                type: "file",
                parentId: args.parentId,
                updatedAt: Date.now(),
            })

            results.push({ name: file.name, fileId })
        }

        return results
    }
})


export const createFolder = mutation({
    args: {
        internalKey: v.string(),
        projectId: v.id("projects"),
        name: v.string(),
        parentId: v.optional(v.id("files")),
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey);

        const files = await ctx.db
            .query("files")
            .withIndex("by_project_and_parent", (q) =>
                q.eq("projectId", args.projectId).eq("parentId", args.parentId)
            )
            .collect()

        const existing = files.find(
            (file) => file.name === args.name && file.type === "folder"
        )
        if (existing) {
            throw new Error("Folder already exists");
        }

        const fileId = await ctx.db.insert("files", {
            projectId: args.projectId,
            name: args.name,
            type: "folder",
            parentId: args.parentId,
            updatedAt: Date.now(),
        })

        return fileId
    }
})


// todo: create bulk folders  tool

export const renameFile = mutation({
    args: {
        internalKey: v.string(),
        fileId: v.id("files"),
        newName: v.string(),
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey);

        const file = await ctx.db.get(args.fileId);
        if (!file) {
            throw new Error("File not found");
        }
        // Check if a file with the new name already exists in the same parent folder
        const siblings = await ctx.db
            .query("files")
            .withIndex("by_project_and_parent", (q) =>
                q.eq("projectId", file.projectId).eq("parentId", file.parentId)
            )
            .collect();

        const existing = siblings.find(
            (sibling) =>
                sibling.name === args.newName &&
                sibling.type === file.type &&
                sibling._id !== args.fileId
        );

        if (existing) {
            throw new Error(`A ${file.type} named "${args.newName}" already exists`);
        }

        await ctx.db.patch(args.fileId, {
            name: args.newName,
            updatedAt: Date.now(),
        })

        return args.fileId
    }
})

export const deleteFile = mutation({
    args: {
        internalKey: v.string(),
        fileId: v.id("files"),
    },
    handler: async (ctx, args) => {
        validateInternalKey(args.internalKey);

        const file = await ctx.db.get(args.fileId);
        if (!file) {
            throw new Error("File not found");
        }
        // Recursively delete file/folder and all descendants
        const deleteRecursively = async (fileId: typeof args.fileId) => {
            const item = await ctx.db.get(fileId);
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
        await deleteRecursively(args.fileId)

        return args.fileId
    }
});