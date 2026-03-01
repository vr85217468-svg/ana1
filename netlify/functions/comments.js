// Netlify Function — comments.js
// يجلب التعليقات الحالية من يوتيوب (تعكس الحذف) + يحفظ في Supabase للأرشيف
// تمت إضافة نظام "كاسر الدوائر" (Circuit Breaker) والـ Fallback لضمان استقرار الخدمة

const VIDEO_ID = "6_9ZiuONXt0";
const SUPA_URL = process.env.SUPABASE_URL || "https://amuopyagznrsyojqxaqp.supabase.co";
const SUPA_KEY = process.env.SUPABASE_KEY || "sb_publishable_VEEiRh3zLWxhzIwgJBcvLw_f0hABb0u";

// قائمة الـ User-Agents لتقليل تتبع يوتيوب
const AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
];

async function go(url, opts = {}, ms = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

// ─── جلب التعليقات الحالية من يوتيوب ─────────────────────────
async function getYouTubeChat() {
  const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)];
  const page = await go(`https://www.youtube.com/watch?v=${VIDEO_ID}`, {
    headers: { "User-Agent": agent, "Accept-Language": "en-US,en;q=0.9" },
  });
  const html = await page.text();

  const ytKey = (html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/) || [])[1] || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  const clientVer = (html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/) || [])[1] || "2.20240201.00.00";
  const visitorId = (html.match(/"visitorData"\s*:\s*"([^"]+)"/) || [])[1] || "";

  const patterns = [
    /"invalidationContinuationData"\s*:\s*\{[^}]{0,200}"continuation"\s*:\s*"([^"]+)"/,
    /"timedContinuationData"\s*:\s*\{[^}]{0,200}"continuation"\s*:\s*"([^"]+)"/,
    /"reloadContinuationData"\s*:\s*\{"continuation"\s*:\s*"([^"]+)"/,
    /liveChatRenderer[\s\S]{0,2000}?"continuation"\s*:\s*"([^"]{20,})"/,
    /"continuation"\s*:\s*"([^"]{30,})"/, // نمط إضافي احتياطي
  ];

  let cont = null;
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]?.length > 20) { cont = m[1]; break; }
  }
  if (!cont) throw new Error("Could not find continuation token (Scraping Error)");

  const chatRes = await go(
    `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${ytKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://www.youtube.com",
        "Referer": `https://www.youtube.com/watch?v=${VIDEO_ID}`,
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": clientVer,
        "X-Goog-Visitor-Id": visitorId,
      },
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: clientVer, visitorData: visitorId } },
        continuation: cont,
      }),
    }
  );

  if (!chatRes.ok) throw new Error(`YouTube API returned ${chatRes.status}`);

  const data = await chatRes.json();
  const actions = data?.continuationContents?.liveChatContinuation?.actions || [];
  const iraqNow = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

  const msgs = [];
  for (const a of actions) {
    const r = a?.addChatItemAction?.item?.liveChatTextMessageRenderer;
    if (!r) continue;
    const text = (r.message?.runs || []).map(x => x.text || "").join("").trim();
    if (!text) continue;
    msgs.push({
      youtube_id: r.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      author: r.authorName?.simpleText?.trim() || "مجهول",
      message: text,
      created_at: iraqNow,
    });
  }
  return msgs;
}

// ─── جلب الأرشيف من Supabase (Fallback) ──────────────────────
async function getSupabaseFallback() {
  const res = await go(`${SUPA_URL}/rest/v1/comments?select=*&order=created_at.desc&limit=50`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }
  });
  if (!res.ok) return [];
  return await res.json();
}

// ─── Handler ─────────────────────────────────────────────────
exports.handler = async function () {
  let messages = [];
  let source = "youtube";
  let error = null;

  try {
    messages = await getYouTubeChat();
    // حفظ في Supabase (Background Logging)
    if (messages.length > 0) {
      go(`${SUPA_URL}/rest/v1/comments?on_conflict=youtube_id`, {
        method: "POST",
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${SUPA_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=minimal",
        },
        body: JSON.stringify(messages),
      }).catch(e => console.error("Supabase Log Error:", e));
    }
  } catch (e) {
    console.warn("YouTube Scrape Failed, activating fallback:", e.message);
    error = e.message;
    try {
      messages = await getSupabaseFallback();
      source = "supabase_archive";
    } catch (sE) {
      messages = [];
      source = "error";
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({
      messages,
      total: messages.length,
      source,
      diagnostics: {
        status: source === "youtube" ? "healthy" : "fallback",
        error: error,
        timestamp: new Date().toISOString()
      }
    }),
  };
};
