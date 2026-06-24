// lib/composio.ts
import { Composio } from "@composio/core"
import { VercelProvider } from "@composio/vercel"

export const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY || "build_time_dummy",
    provider: new VercelProvider(),
})

// Ambil tools utk user tertentu (userId = chat id Telegram, misalnya)
export async function getTools(userId: string) {
    const toolkits = ["GMAIL", "GITHUB", "GOOGLECALENDAR", "SPOTIFY", "NOTION"];
    const results = await Promise.all(
        toolkits.map(toolkit =>
            composio.tools.get(userId, {
                toolkits: [toolkit],
            }).catch(err => {
                console.error(`Error fetching tools for toolkit ${toolkit}:`, err);
                return {};
            })
        )
    );
    
    // Merge all tools into a single object
    return Object.assign({}, ...results);
}