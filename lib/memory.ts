import Supermemory from "supermemory"

const apiKey = process.env.SUPERMEMORY_API_KEY || "build_time_dummy";
const client = new Supermemory({ apiKey })

export async function remember(userId: string, content: string) {
    await client.add({ content, containerTag: userId })
}

export async function recall(userId: string, query: string) {
    const res = await client.search.execute({ q: query, containerTag: userId })
    return res.results.map((r) => r.content).filter(Boolean).join("\n")
}