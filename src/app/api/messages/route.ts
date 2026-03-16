import { convex } from "@/lib/convex-client";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import z from "zod";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { inngest } from "@/inngest/client";

const requestSchema = z.object({
    conversationId: z.string(),
    message: z.string(),
})

export async function POST(request: Request) {
    const { userId } = await auth();

    if (!userId) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
        );
    }

    const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY

    if (!internalKey) {
        return NextResponse.json(
            { error: "Internal key not configured" },
            { status: 500 }
        )
    }
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
        return NextResponse.json(
            {
                error: "Invalid request body",
                details: parsed.error.flatten(),
            },
            { status: 400 }
        );
    }

    const { conversationId, message } = parsed.data;

    // Call convex mutation, query
    const conversation = await convex.query(api.system.getConversationById, {
        internalKey,
        conversationId: conversationId as Id<"conversations">
    })
    if (!conversation) {
        return NextResponse.json(
            { error: "Conversation not found" },
            { status: 404 }
        );
    }

    const projectId = conversation.projectId

    // Find all already processing messages in this project
    const processingMessages = await convex.query(
        api.system.getProcessingMessages,
        {
            internalKey,
            projectId: projectId as Id<"projects">,
        }
    );

    if (processingMessages.length > 0) {
        // cancel all processing messaages
        await Promise.all(
            processingMessages.map(async (msg) => {
                await inngest.send({
                    name: "message/cancel",
                    data: {
                        messageId: msg._id,
                    },
                });

                await convex.mutation(api.system.updateMessageStatus, {
                    internalKey,
                    messageId: msg._id,
                    status: "cancelled",
                });
            })
        )
    }

    // create user message
    await convex.mutation(api.system.createMessage, {
        internalKey,
        conversationId: conversationId as Id<"conversations">,
        projectId,
        role: "user",
        content: message,
    });


    // Create assistant message placeholder with processing status
    const assistantMessageId = await convex.mutation(api.system.
        createMessage,
        {
            internalKey,
            conversationId: conversationId as Id<"conversations">,
            projectId,
            role: "assistant",
            content: "",
            status: "processing",
        }
    );

    // Invoke inngest to process the message
    //Invoke inngest to process the message
    const event = await inngest.send({
        name: "message/sent",
        data: {
            messageId: assistantMessageId,
            conversationId,
            projectId,
            message,
        }
    })
    return NextResponse.json({
        success: true,
        eventId: event.ids[0],
        messageId: assistantMessageId,
    })

    // Invoke. Inngest.background jobs

}