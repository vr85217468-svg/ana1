// Netlify Scheduled Function — sync-background.js
// تعمل هذه الوظيفة كل دقيقة لجلب التعليقات وحفظها في Supabase تلقائياً
// وهذا يضمن استمرارية الأرشيف حتى لو لم يفتح أحد الموقع

const VIDEO_ID = "6_9ZiuONXt0";
const SUPA_URL = process.env.SUPABASE_URL || "https://amuopyagznrsyojqxaqp.supabase.co";
const SUPA_KEY = process.env.SUPABASE_KEY || "sb_publishable_VEEiRh3zLWxhzIwgJBcvLw_f0hABb0u";

async function go(url, opts = {}, ms = 8000) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ac.signal }); }
    finally { clearTimeout(t); }
}

async function getYouTubeChat() {
    const page = await go(`https://www.youtube.com/watch?v=${VIDEO_ID}`, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        },
    });
    const html = await page.text();
    const ytKey = (html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/) || [])[1];
    const clientVer = (html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) || [])[1];

    const patterns = [
        /"invalidationContinuationData"\s*:\s*\{[^}]{0,200}"continuation"\s*:\s*"([^"]+)"/,
        /"timedContinuationData"\s*:\s*\{[^}]{0,200}"continuation"\s*:\s*"([^"]+)"/,
        /liveChatRenderer[\s\S]{0,2000}?"continuation"\s*:\s*"([^"]{20,})"/
    ];

    let cont = null;
    for (const p of patterns) {
        const m = html.match(p);
        if (m?.[1]) { cont = m[1]; break; }
    }
    if (!cont) return [];

    const chatRes = await go(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${ytKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            context: { client: { clientName: "WEB", clientVersion: clientVer } },
            continuation: cont,
        }),
    });

    const data = await chatRes.json();
    const actions = data?.continuationContents?.liveChatContinuation?.actions || [];
    const iraqNow = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    return actions.map(a => {
        const r = a?.addChatItemAction?.item?.liveChatTextMessageRenderer;
        if (!r) return null;
        return {
            youtube_id: r.id,
            author: r.authorName?.simpleText || "مجهول",
            message: (r.message?.runs || []).map(x => x.text).join(""),
            created_at: iraqNow
        };
    }).filter(Boolean);
}

// Netlify Cron Expression: Run every minute
export const config = {
    schedule: "* * * * *"
};

export default async function () {
    const startTime = Date.now();
    const MAX_RUNTIME = 55000; // 55 ثانية لتجنب انتهاء مهلة نتليفاي
    const POLLING_INTERVAL = 2000; // جلب كل ثانيتين (أقصى سرعة ممكنة)

    console.log(`[Sync] Starting High-Frequency Loop for video ${VIDEO_ID}...`);

    while (Date.now() - startTime < MAX_RUNTIME) {
        try {
            const messages = await getYouTubeChat();
            if (messages.length > 0) {
                await go(`${SUPA_URL}/rest/v1/comments?on_conflict=youtube_id`, {
                    method: "POST",
                    headers: {
                        apikey: SUPA_KEY,
                        Authorization: `Bearer ${SUPA_KEY}`,
                        "Content-Type": "application/json",
                        Prefer: "resolution=ignore-duplicates,return=minimal",
                    },
                    body: JSON.stringify(messages),
                });
                console.log(`[Sync] Loop: Synced ${messages.length} messages.`);
            } else {
                console.log("[Sync] Loop: No new messages.");
            }
        } catch (e) {
            console.error("[Sync] Loop Error:", e.message);
        }

        // تسجيل نبضة قلب في السجل (اختياري - للتأكد من العمل في الخلفية)
        console.log(`[Pulse] ${new Date().toISOString()} - السيرفر يعمل الآن في الخلفية...`);

        // انتظر قبل الدورة التالية
        await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL));
    }

    console.log("[Sync] Loop window finished. Waiting for next cron trigger.");
}
