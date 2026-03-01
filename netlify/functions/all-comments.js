// Netlify Function — all-comments.js
// يقرأ كل التعليقات المحفوظة من Supabase لصفحة الأرشيف

const SUPA_URL = process.env.SUPABASE_URL || "https://amuopyagznrsyojqxaqp.supabase.co";
const SUPA_KEY = process.env.SUPABASE_KEY || "sb_publishable_VEEiRh3zLWxhzIwgJBcvLw_f0hABb0u";

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
        clearTimeout(t);
    }
}

exports.handler = async function () {
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

    // تحقق من وجود بيانات Supabase
    if (!SUPA_URL || !SUPA_KEY) {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                comments: [],
                total: 0,
                error: "❌ متغيرات البيئة SUPABASE_URL و SUPABASE_KEY غير مضبوطة على Netlify",
            }),
        };
    }

    try {
        const res = await fetchWithTimeout(
            `${SUPA_URL}/rest/v1/comments?select=id,author,message,created_at&order=created_at.asc&limit=50000`,
            {
                headers: {
                    apikey: SUPA_KEY,
                    Authorization: `Bearer ${SUPA_KEY}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!res.ok) {
            const errText = await res.text();
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    comments: [],
                    total: 0,
                    error: `Supabase error ${res.status}: ${errText}`,
                }),
            };
        }

        const comments = await res.json();
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ comments, total: comments.length, error: null }),
        };
    } catch (e) {
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                comments: [],
                total: 0,
                error: e.name === "AbortError" ? "⏱ انتهت مهلة الاتصال بـ Supabase" : e.message,
            }),
        };
    }
};
