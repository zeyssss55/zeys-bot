import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { remember, recall } from "@/lib/memory";
import { getTools } from "@/lib/composio";
import { google } from "@ai-sdk/google";

async function sendTelegramMessage(chatId: number, text: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.error("TELEGRAM_BOT_TOKEN is not defined in env variables");
        return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            chat_id: chatId,
            text: text,
        }),
    });

    if (!response.ok) {
        console.error("Failed to send message to Telegram:", await response.text());
    }
}

export async function POST(req: NextRequest) {
    let chatId: number | undefined;

    try {
        // 1. Verify secret token if configured
        const expectedSecret = process.env.TELEGRAM_SECRET_TOKEN;
        const receivedSecret = req.headers.get("x-telegram-bot-api-secret-token");
        if (expectedSecret && receivedSecret !== expectedSecret) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const message = body.message;

        // Check if the update contains a message and message text
        if (!message) {
            return NextResponse.json({ ok: true });
        }

        chatId = message.chat?.id;
        if (chatId === undefined) {
            return NextResponse.json({ ok: true });
        }
        const userId = message.from?.id?.toString() || chatId.toString();
        const userText = message.text;

        if (!userText) {
            return NextResponse.json({ ok: true });
        }

        // 2. Recall memory and fetch tools in parallel
        let memoryContext = "";
        let tools: any = undefined;
        try {
            const [recalledContext, composioTools] = await Promise.all([
                recall(userId, userText).catch(err => {
                    console.error("Error recalling memory:", err);
                    return "";
                }),
                getTools(userId).catch(err => {
                    console.error("Error fetching Composio tools:", err);
                    return undefined;
                })
            ]);

            memoryContext = recalledContext;
            if (composioTools && Object.keys(composioTools).length > 0) {
                tools = composioTools;
            }
        } catch (err) {
            console.error("Error in parallel setup:", err);
        }

        const systemPrompt = `You are a helpful Telegram AI Assistant.
You have access to tools via Composio (Gmail, GitHub, Google Calendar) to perform tasks.
You also have a memory of past interactions. Here is the recalled context:
${memoryContext || "None"}

Please respond concisely since the user is reading your messages on Telegram. Keep formatting clean.`;

        // 3. Run the AI agent
        const { text: aiResponse } = await generateText({
            model: google("gemini-2.5-flash"),
            system: systemPrompt,
            prompt: userText,
            ...(tools ? { tools, maxSteps: 10 } : {}),
        } as any);

        // 4. Reply to user as early as possible
        await sendTelegramMessage(chatId, aiResponse);

        // 5. Save this conversation turn to memory in the background (awaited before return to ensure execution)
        try {
            await remember(userId, `User: ${userText}\nAssistant: ${aiResponse}`);
        } catch (err) {
            console.error("Error saving memory:", err);
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("Error in Telegram route handler:", error);

        // Attempt to report error back to the user if we can retrieve chatId
        if (chatId) {
            try {
                await sendTelegramMessage(chatId, "Sorry, I encountered an error while processing your request.");
            } catch (err) {
                console.error("Could not send error message to Telegram:", err);
            }
        }

        return NextResponse.json({ ok: true });
    }
}
