# نظام SEASONS — ملوك القراصنة

نظام موسمي جديد **معزول تماماً** عن الأنظمة الحالية. لا تعديل على `attacks` أو `record_attack` أو أي منطق قتال — فقط قراءة الأحداث وتسجيلها في جداول موسم جديدة.

---

## 1) قاعدة البيانات (migration واحدة آمنة)

### جداول جديدة (كلها في `public` مع GRANTs و RLS):

**`seasons`** — قائمة المواسم
- `id` (int PK), `name` (مثل "SEASON 01"), `code` (نصي فريد)
- `starts_at`, `ends_at`, `status` (active/closed), `closed_at`

**`season_damage`** — نقاط الضرر لكل لاعب في كل موسم
- `season_id`, `user_id`, `damage_total` (bigint)
- `first_reached_at` (لكسر التعادل)
- PK مركب `(season_id, user_id)` — يمنع التكرار

**`season_damage_events`** — سجل حدث لكل هجوم (idempotency)
- `season_id`, `attack_id` (يرتبط بـ `attacks.id`), `user_id`, `damage`
- PK مركب `(season_id, attack_id)` — يضمن أن نفس المعركة لا تُحسب مرتين حتى لو تكرر الـ trigger

**`season_results`** — نتائج نهائية مجمّدة بعد إغلاق الموسم
- `season_id`, `user_id`, `final_rank`, `final_damage`, `frame_tier`, `reward_gems`, `granted_at`, `tx_id`
- PK `(season_id, user_id)`

### دوال SQL:

- `season_frame_tier(damage bigint) → int` — يرجّع مستوى الإطار (0–10) حسب عتبات 100M...1B
- `current_season() → seasons` — يرجّع الموسم النشط (ينشئ واحد إذا ما فيه)
- `close_season(season_id int)` — atomic، idempotent (يستخدم `FOR UPDATE` + فحص `status='active'`)، يحسب الترتيب، يجمّد النتائج، يمنح الجوائز عبر INSERT في `season_results` (مرة واحدة بسبب PK)، ينشئ موسم جديد
- `cron_close_expired_seasons()` — يُستدعى يومياً من pg_cron، يفحص `ends_at < now()`

### Trigger:
`trg_season_damage_after_attack` — AFTER INSERT على `public.attacks`، يقرأ `damage_dealt` ويضيفه إلى `season_damage` للموسم النشط. يستخدم `INSERT ... ON CONFLICT DO NOTHING` على `season_damage_events` أولاً، ثم UPSERT على `season_damage` — Atomic + Idempotent.

### pg_cron:
جدولة `cron_close_expired_seasons()` كل ساعة.

**لا تعديل على `attacks` أو `record_attack` أو أي جدول موجود.**

---

## 2) الواجهة الأمامية

### ملفات جديدة:
- `src/lib/season-frames.tsx` — 11 مكوّن React لإطارات CSS/SVG (Nebula, Fire, Lightning, Wave, Skull, Dragon, Volcano, Diamond, Crown, Legendary, PirateKing) مع Particles/Glow/Animation
- `src/routes/season.tsx` — صفحة **🏆 SEASON RANKING** مستقلة:
  - Header فخم باسم الموسم والعد التنازلي للانتهاء
  - Podium خاص للمراكز 1/2/3 بتأثيرات ضوئية وتاج
  - قائمة بقية اللاعبين (رتبة، صورة داخل الإطار المحقق، اسم، ضرر)
  - سجل المواسم السابقة (tab ثانوي)
- `src/components/SeasonAchievements.tsx` — قسم **🏆 إنجازات المواسم** يُدرج في `src/routes/profile.tsx` و `src/routes/players.$playerId.tsx` و `src/routes/u.$username.tsx`

### تعديلات محدودة:
- `src/components/BottomNav.tsx` أو `src/routes/index.tsx` — رابط بسيط لصفحة `/season`
- `src/routes/profile.tsx` — إضافة `<SeasonAchievements />` فقط (لا حذف/تغيير باقي المحتوى)

### عرض الإطار النشط:
دالة helper `useMySeasonFrame()` تقرأ ضرر اللاعب في الموسم الحالي وترجع مكوّن الإطار. تُستخدم في podium وقوائم الترتيب.
**الإطار الموسمي لا يُخزَّن في `inventory`** — يُحسب ديناميكياً من `season_damage`، وبعد إغلاق الموسم يبقى في `season_results.frame_tier` فقط للعرض التاريخي.

---

## 3) ضمانات عدم الإضرار

- ✅ لا حذف/تعديل على جداول: `attacks`, `profiles`, `inventory`, `ships_owned`, `bans`, `user_roles`
- ✅ لا تعديل على أي RPC: `record_attack`, `launch_nuke`, `pvp_fleet_count`... تبقى كما هي
- ✅ الإطارات الموسمية منفصلة عن نظام `frames.ts` الحالي (لا تظهر في المتجر ولا في inventory)
- ✅ الجواهر تُمنح فقط عبر `close_season` مع حماية PK ضد التكرار
- ✅ Trigger القراءة فقط (READ من `attacks`، WRITE على جداول جديدة) — لا يفشل الهجوم إذا فشل هو

---

## 4) عتبات الإطارات

| الضرر الموسمي | المستوى | الاسم |
|---|---|---|
| 100M | 1 | نار |
| 200M | 2 | برق |
| 300M | 3 | أمواج |
| 400M | 4 | جمجمة |
| 500M | 5 | تنين |
| 600M | 6 | بركان |
| 700M | 7 | ماس |
| 800M | 8 | تاج |
| 900M | 9 | طاقة أسطورية |
| 1B | 10 | ملك القراصنة 👑 |

## 5) الجوائز

المركز الأول: 100,000 جوهرة — الثاني: 50,000 — الثالث: 25,000.
تُمنح داخل `close_season` عبر UPDATE على `profiles.gems` + INSERT على `season_results` (PK يمنع التكرار) + INSERT على `transactions` للتدقيق.

## 6) كسر التعادل
الأولوية للاعب الذي **وصل للنقاط أولاً** (`first_reached_at` يُسجَّل عند كل تحديث لأعلى قيمة).

---

## الترتيب التنفيذي
1. Migration SQL (جداول + دوال + trigger + pg_cron + إنشاء SEASON 01 فوراً)
2. مكتبة إطارات CSS/SVG
3. صفحة `/season`
4. مكوّن الإنجازات + إدراجه في ملفات اللاعب
5. رابط في التنقل
6. فحص: محاكاة هجمات، فحص idempotency، محاكاة `close_season` مرتين للتأكد أن الجائزة لا تتكرر
