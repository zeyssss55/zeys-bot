// lib/composio.ts
import { Composio } from "@composio/core"
import { VercelProvider } from "@composio/vercel"

export const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY || "build_time_dummy",
    provider: new VercelProvider(),
})

const TOOLKIT_LIMITS: Record<string, number> = {
    GMAIL: 40,
    GITHUB: 30,
    GOOGLECALENDAR: 50,
    SPOTIFY: 100,
    NOTION: 50,
};

// Ambil tools utk user tertentu (userId = chat id Telegram, misalnya)
export async function getTools(userId: string) {
    const results = await Promise.all(
        Object.entries(TOOLKIT_LIMITS).map(([toolkit, limit]) =>
            composio.tools.get(userId, {
                toolkits: [toolkit],
                limit,
            }).catch(err => {
                console.error(`Error fetching tools for toolkit ${toolkit}:`, err);
                return {};
            })
        )
    );
    
    // Merge all tools into a single object
    return Object.assign({}, ...results);
}