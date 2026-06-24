import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { remember, recall, client } from "@/lib/memory";
import { getTools } from "@/lib/composio";
import { google } from "@ai-sdk/google";

class PendingApprovalError extends Error {
    constructor() {
        super("Pending approval");
        this.name = "PendingApprovalError";
    }
}

const RISKY_TOOL_KEYWORDS = [
    "send", "create", "delete", "update", "write", "patch", "post", "put", "close", "merge", "cancel", "star"
];

function isRiskyTool(toolName: string): boolean {
    return RISKY_TOOL_KEYWORDS.some(kw => toolName.toLowerCase().includes(kw));
}

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

async function sendTelegramApprovalRequest(chatId: number, toolName: string, args: any, docId: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    const text = `⚠️ *Aksi Berisiko Terdeteksi!*\n\n*Alat:* \`${toolName}\`\n*Parameter:* \`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\`\n\nApakah Anda menyetujui aksi ini?`;
    
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ Setuju (Approve)", callback_data: `approve:${docId}` },
                        { text: "❌ Tolak (Reject)", callback_data: `reject:${docId}` }
                    ]
                ]
            }
        }),
    });

    if (!response.ok) {
        console.error("Failed to send approval request to Telegram:", await response.text());
    }
}

async function editTelegramMessage(chatId: number, messageId: number, text: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    const url = `https://api.telegram.org/bot${token}/editMessageText`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text: text,
            parse_mode: "Markdown",
        }),
    });

    if (!response.ok) {
        console.error("Failed to edit Telegram message:", await response.text());
    }
}

async function answerCallbackQuery(callbackQueryId: string, text?: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
    await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            callback_query_id: callbackQueryId,
            ...(text ? { text } : {})
        }),
    });
}

export async function POST(req: NextRequest) {
    let chatId: number | undefined;

    try {
        const expectedSecret = process.env.TELEGRAM_SECRET_TOKEN;
        const receivedSecret = req.headers.get("x-telegram-bot-api-secret-token");
        if (expectedSecret && receivedSecret !== expectedSecret) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();

        // Extract sender Telegram ID
        let senderId: number | undefined;
        if (body.callback_query) {
            senderId = body.callback_query.from?.id;
            chatId = body.callback_query.message?.chat?.id;
        } else if (body.message) {
            senderId = body.message.from?.id;
            chatId = body.message.chat?.id;
        }

        // Whitelist check
        const allowedIdsEnv = process.env.ALLOWED_TELEGRAM_USER_IDS;
        if (allowedIdsEnv && senderId) {
            const allowedIds = allowedIdsEnv.split(",").map(id => id.trim());
            if (!allowedIds.includes(senderId.toString())) {
                console.warn(`Unauthorized access attempt from Telegram ID: ${senderId}`);
                if (chatId) {
                    if (body.callback_query) {
                        await answerCallbackQuery(body.callback_query.id, "Akses ditolak.");
                    } else {
                        await sendTelegramMessage(chatId, "⚠️ Akses ditolak. Anda tidak terdaftar untuk menggunakan bot ini.");
                    }
                }
                return NextResponse.json({ ok: true });
            }
        }

        // --- HANDLE CALLBACK QUERY (Approve/Reject buttons) ---
        if (body.callback_query) {
            const callbackQuery = body.callback_query;
            const callbackQueryId = callbackQuery.id;
            const data = callbackQuery.data; // approve:docId or reject:docId
            chatId = callbackQuery.message?.chat?.id;
            const messageId = callbackQuery.message?.message_id;

            if (!data || !chatId || !messageId) {
                await answerCallbackQuery(callbackQueryId, "Gagal memproses tombol.");
                return NextResponse.json({ ok: true });
            }

            const [action, docId] = data.split(":");
            if (!action || !docId) {
                await answerCallbackQuery(callbackQueryId, "Parameter tombol tidak valid.");
                return NextResponse.json({ ok: true });
            }

            if (action === "reject") {
                await Promise.all([
                    editTelegramMessage(chatId, messageId, "❌ *Aksi telah ditolak dan dibatalkan.*"),
                    client.documents.delete(docId).catch(err => console.error("Error deleting doc:", err)),
                    answerCallbackQuery(callbackQueryId, "Aksi dibatalkan.")
                ]);
                return NextResponse.json({ ok: true });
            }

            if (action === "approve") {
                let doc: any;
                try {
                    doc = await client.documents.get(docId);
                } catch (err) {
                    console.error("Failed to fetch pending action:", err);
                    await editTelegramMessage(chatId, messageId, "❌ *Aksi kedaluwarsa atau tidak ditemukan.*");
                    await answerCallbackQuery(callbackQueryId, "Aksi kedaluwarsa.");
                    return NextResponse.json({ ok: true });
                }

                if (!doc || !doc.content) {
                    await editTelegramMessage(chatId, messageId, "❌ *Data aksi kosong atau tidak valid.*");
                    await answerCallbackQuery(callbackQueryId, "Data tidak valid.");
                    return NextResponse.json({ ok: true });
                }

                const { toolName, args } = JSON.parse(doc.content);
                const userId = chatId.toString();

                await editTelegramMessage(chatId, messageId, "⏳ *Aksi disetujui, sedang mengeksekusi...*");

                const tools = await getTools(userId);
                const tool = tools[toolName];

                if (!tool || !tool.execute) {
                    await editTelegramMessage(chatId, messageId, `❌ *Tool \`${toolName}\` tidak ditemukan atau tidak dapat dieksekusi.*`);
                    await answerCallbackQuery(callbackQueryId, "Eksekusi gagal.");
                    return NextResponse.json({ ok: true });
                }

                try {
                    const result = await (tool.execute as any)(args);
                    const resultText = typeof result === "string" ? result : JSON.stringify(result, null, 2);
                    
                    await editTelegramMessage(
                        chatId, 
                        messageId, 
                        `✅ *Aksi berhasil dieksekusi!*\n\n*Hasil:* \`\`\`json\n${resultText.substring(0, 1000)}\n\`\`\``
                    );
                    await answerCallbackQuery(callbackQueryId, "Aksi sukses dijalankan!");
                } catch (err: any) {
                    console.error("Error executing tool:", err);
                    await editTelegramMessage(chatId, messageId, `❌ *Eksekusi gagal:* ${err.message || err}`);
                    await answerCallbackQuery(callbackQueryId, "Eksekusi error.");
                }

                await client.documents.delete(docId).catch(err => console.error("Error deleting doc:", err));
                return NextResponse.json({ ok: true });
            }

            return NextResponse.json({ ok: true });
        }

        // --- HANDLE STANDARD MESSAGE ---
        const message = body.message;
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
                const interceptedTools: any = {};
                for (const [toolName, toolConfig] of Object.entries(composioTools)) {
                    if (isRiskyTool(toolName) && (toolConfig as any).execute) {
                        interceptedTools[toolName] = {
                            ...(toolConfig as any),
                            execute: async (args: any) => {
                                const contentPayload = JSON.stringify({ toolName, args, chatId });
                                const docRes = await client.add({
                                    content: contentPayload,
                                    containerTag: `pending_approval_${userId}`
                                });
                                await sendTelegramApprovalRequest(chatId!, toolName, args, docRes.id);
                                throw new PendingApprovalError();
                            }
                        };
                    } else {
                        interceptedTools[toolName] = toolConfig;
                    }
                }
                tools = interceptedTools;
            }
        } catch (err) {
            console.error("Error in parallel setup:", err);
        }

        const systemPrompt = `You are a helpful Telegram AI Assistant.
You have access to tools via Composio (Gmail, GitHub, Google Calendar, Spotify, Notion) to perform tasks.
You also have a memory of past interactions. Here is the recalled context:
${memoryContext || "None"}

Please respond concisely since the user is reading your messages on Telegram. Keep formatting clean.`;

        // 3. Run the AI agent
        console.log(`Processing message from ${userId}: "${userText}"`);
        const { text: aiResponse } = await generateText({
            model: google("gemini-2.5-flash"),
            system: systemPrompt,
            prompt: userText,
            ...(tools ? { tools, maxSteps: 10 } : {}),
            onStepFinish({ text, toolCalls, toolResults, finishReason }: any) {
                console.log("Step finished. Text:", text);
                console.log("Tool calls:", JSON.stringify(toolCalls));
                console.log("Tool results count:", toolResults?.length);
                if (toolResults && toolResults.length > 0) {
                    // Log clean tool results summary (without huge content if any)
                    const cleanResults = toolResults.map((r: any) => ({
                        toolName: r.toolName,
                        args: r.args,
                        type: r.type,
                        resultSummary: typeof r.result === "string" ? r.result.substring(0, 100) : "object"
                    }));
                    console.log("Tool results summary:", JSON.stringify(cleanResults));
                }
                console.log("Finish reason:", finishReason);
            }
        } as any);

        console.log(`AI Response for ${userId}: "${aiResponse}"`);

        // 4. Reply to user as early as possible
        if (!aiResponse || aiResponse.trim() === "") {
            console.warn("AI response was empty. Sending fallback message.");
            await sendTelegramMessage(chatId, "Maaf, saya tidak menerima respons tertulis dari asisten. Silakan coba lagi.");
        } else {
            await sendTelegramMessage(chatId, aiResponse);
        }

        // 5. Save this conversation turn to memory in the background
        try {
            await remember(userId, `User: ${userText}\nAssistant: ${aiResponse || "No response"}`);
        } catch (err) {
            console.error("Error saving memory:", err);
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        if (error instanceof PendingApprovalError) {
            console.log("Halted tool calling loop for user approval.");
            return NextResponse.json({ ok: true });
        }

        console.error("Error in Telegram route handler:", error);

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
