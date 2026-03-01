"""
سكريبت Python لجلب تعليقات يوتيوب البث المباشر وحفظها في Supabase
يعمل على جهازك المحلي — يوتيوب لا يحجب الطلبات المحلية

التثبيت:
  pip install pytchat requests

التشغيل:
  python save_chat.py
"""

import pytchat
import requests
import time
from datetime import datetime, timezone, timedelta

# ── إعدادات ──────────────────────────────────────────────────
VIDEO_ID   = "6_9ZiuONXt0"
SUPA_URL   = "https://amuopyagznrsyojqxaqp.supabase.co"
SUPA_KEY   = "sb_publishable_VEEiRh3zLWxhzIwgJBcvLw_f0hABb0u"
IRAQ_TZ    = timezone(timedelta(hours=3))
BATCH_SIZE = 20   # حفظ كل 20 تعليق دفعةً واحدة

# ── Supabase ──────────────────────────────────────────────────
def save_to_supabase(rows):
    if not rows:
        return
    r = requests.post(
        f"{SUPA_URL}/rest/v1/comments",
        headers={
            "apikey": SUPA_KEY,
            "Authorization": f"Bearer {SUPA_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates,return=minimal",
        },
        json=rows,
        timeout=10,
    )
    if r.status_code not in (200, 201, 409):
        print(f"⚠️  خطأ Supabase: {r.status_code} — {r.text[:200]}")
    else:
        print(f"✅ تم حفظ {len(rows)} تعليق")

# ── الدالة الرئيسية ───────────────────────────────────────────
def main():
    print(f"🚀 بدء جلب تعليقات البث: {VIDEO_ID}")
    print("اضغط Ctrl+C للإيقاف\n")

    chat  = pytchat.create(video_id=VIDEO_ID)
    batch = []
    total = 0

    while chat.is_alive():
        for c in chat.get().sync_items():
            iraq_time = datetime.now(IRAQ_TZ).isoformat()
            batch.append({
                "youtube_id": c.id,
                "author":     c.author.name,
                "message":    c.message,
                "created_at": iraq_time,
            })
            print(f"💬 {c.author.name}: {c.message}")

            if len(batch) >= BATCH_SIZE:
                save_to_supabase(batch)
                total += len(batch)
                print(f"📦 المجموع: {total} تعليق\n")
                batch = []

        time.sleep(1)

    # حفظ ما تبقى
    if batch:
        save_to_supabase(batch)
        total += len(batch)

    print(f"\n🏁 انتهى البث. المجموع: {total} تعليق")

if __name__ == "__main__":
    main()
