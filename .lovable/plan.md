# خطة تحسين الأداء الشاملة

نطاق ضخم — سأنفذها على 4 مراحل متتالية بدون تغيير أي منطق لعبة/اقتصاد/أسعار/صلاحيات.

## المرحلة 1 — البنية التحتية للـ Cache والتنقل
- تفعيل SWR فعلياً في hooks الأساسية (`use-auth`, `use-admin`, `use-elite-vip`, `use-daughter`, `use-chat-mod`) لمنع إعادة الجلب على كل Mount.
- رفع `defaultPreload="intent"` وتقليل `defaultPreloadDelay` وتفعيل prefetch على `<Link>` الرئيسية في `BottomNav`.
- إضافة AbortController لكل fetch يتبع route mount لإلغاء الطلبات القديمة عند التنقل.

## المرحلة 2 — الشات والرسائل والإشعارات
- `src/routes/chat.tsx` و `SupportTicketChat`: 
  - فتح فوري من الـ cache (`getCached`) قبل الشبكة.
  - جلب آخر 50 رسالة فقط + Infinite Scroll للأقدم عند التمرير لأعلى.
  - إزالة أي `select('*')` واستخدام أعمدة محددة.
  - قناة Realtime واحدة لكل غرفة، تنظيف دقيق في cleanup.
- `dm-unread`: تقليل limit من 300 إلى 100، تنفيذ الاستعلامات المستقلة بـ `Promise.all` (موجود) لكن مع تخزين مؤقت 30 ثانية.
- الإشعارات: dedupe للاشتراكات + cache.

## المرحلة 3 — الترتيب/اللوحات/الملفات الشخصية
- `index.tsx` (Home leaderboards): جلب 20 صف + عرض من cache فوراً + revalidate خلفي.
- `players.$playerId`, `u.$username`, `p.$id`: SWR + select أعمدة محددة فقط.
- المخزون/السفن/المتجر: تفعيل `useSwrCache` مع مفاتيح مستقرة.

## المرحلة 4 — قاعدة البيانات
- Indexes مقترحة (كلها CREATE INDEX IF NOT EXISTS، بدون تغيير schema):
  - `messages(channel, recipient_id, created_at DESC)` جزئي حيث `channel='dm'`
  - `messages(channel, sender_id, created_at DESC)` جزئي
  - `support_ticket_messages(ticket_id, created_at)`
  - `notifications(recipient_id, created_at DESC)`
  - `tribe_donations(tribe_id, created_at DESC)`
  - `season_damage(season_id, damage DESC)`
  - `ships_owned(user_id, level DESC)`
- تشغيل `supabase--slow_queries` وإضافة indexes للاستعلامات الأثقل.

## قيود
- بدون تغيير: الاقتصاد، الأسعار، المكافآت، القتال، الصيد، السفن، الاشتراكات، الصلاحيات، المميزات، التصميم.
- كل التغييرات presentation/cache/index فقط.

## التحقق
- Build + typecheck تلقائي.
- فحص Console للـ duplicate requests عبر preview.
- فحص Realtime channels للتأكد من عدم التسريب.

بعد الموافقة أبدأ فوراً بالمرحلة 1 وأتابع للنهاية في نفس الجلسة، وأعطيك تقريراً نهائياً بكل ما تم.
