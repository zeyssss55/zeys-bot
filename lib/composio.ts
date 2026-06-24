// lib/composio.ts
import { Composio } from "@composio/core"
import { VercelProvider } from "@composio/vercel"

export const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY || "build_time_dummy",
    provider: new VercelProvider(),
})

const ESSENTIAL_TOOLS = [
    // Spotify
    "SPOTIFY_SEARCH_FOR_ITEM",
    "SPOTIFY_START_RESUME_PLAYBACK",
    "SPOTIFY_PAUSE_PLAYBACK",
    "SPOTIFY_ADD_ITEM_TO_PLAYBACK_QUEUE",
    "SPOTIFY_GET_PLAYBACK_STATE",
    "SPOTIFY_GET_CURRENTLY_PLAYING_TRACK",
    "SPOTIFY_GET_THE_USER_S_QUEUE",
    
    // Gmail
    "GMAIL_CREATE_EMAIL_DRAFT",
    "GMAIL_SEND_EMAIL",
    "GMAIL_FETCH_EMAILS",
    "GMAIL_LIST_MESSAGES",
    "GMAIL_REPLY_TO_THREAD",
    
    // GitHub
    "GITHUB_CREATE_AN_ISSUE",
    "GITHUB_CREATE_AN_ISSUE_COMMENT",
    "GITHUB_CREATE_A_PULL_REQUEST",
    "GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS",
    "GITHUB_FIND_PULL_REQUESTS",
    
    // Google Calendar
    "GOOGLECALENDAR_CREATE_EVENT",
    "GOOGLECALENDAR_DELETE_EVENT",
    "GOOGLECALENDAR_QUICK_ADD",
    "GOOGLECALENDAR_EVENTS_LIST",
    "GOOGLECALENDAR_FIND_EVENT",
    
    // Notion
    "NOTION_CREATE_NOTION_PAGE",
    "NOTION_RETRIEVE_PAGE",
    "NOTION_SEARCH_NOTION_PAGE",
    "NOTION_CREATE_DATABASE",
    "NOTION_CREATE_COMMENT"
];

// Ambil tools utk user tertentu (userId = chat id Telegram, misalnya)
export async function getTools(userId: string) {
    return composio.tools.get(userId, {
        tools: ESSENTIAL_TOOLS,
    });
}