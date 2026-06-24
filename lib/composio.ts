// lib/composio.ts
import { Composio } from "@composio/core"
import { VercelProvider } from "@composio/vercel"

export const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY || "build_time_dummy",
    provider: new VercelProvider(),
})

// Ambil tools utk user tertentu (userId = chat id Telegram, misalnya)
export async function getTools(userId: string) {
    return composio.tools.get(userId, {
        toolkits: ["GMAIL", "GITHUB", "GOOGLECALENDAR"],
    })
}