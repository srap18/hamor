# نظام منع الغش الشامل

هدف الخطة: إغلاق ثغرات تعديل القيم من المتصفح، التدبيل بين الحسابات، وتكرار الطلبات (clutches/exploits)، مع كشف تلقائي وحظر للمتلاعبين.

## 1) طبقة التحقق من السيرفر (الأهم)
أي عملية تغيّر عملة/جواهر/سمك/سفن لازم تمر عبر RPC مع `SECURITY DEFINER`:
- منع أي `UPDATE` مباشر من العميل على: `profiles.coins/gems/xp/level`, `fish_stock`, `inventory`, `ships_owned`.
- سحب صلاحيات `UPDATE` على الأعمدة الحساسة من دور `authenticated` وترك التعديل فقط للـ RPCs.
- كل RPC يتحقق: المستخدم مالك السجل، القيم ضمن الحد المنطقي، الحالة (سفينة ترجع/تصيد/مدمرة) صحيحة.

## 2) Rate limiting على السيرفر
جدول `rate_limits(user_id, action, window_start, count)` + دالة `check_rate(action, max, window_seconds)`:
- صيد: حد أقصى لكل سفينة حسب `fishing_seconds`.
- بيع سمك/شراء/تفعيل أكواد/إرسال دعم/هجوم/رسائل: حد منطقي بالدقيقة والساعة.
- تجاوز الحد → رفض الطلب وتسجيل محاولة.

## 3) كشف تلقائي للشذوذ (`cheat_flags`)
جدول جديد + triggers تسجّل تلقائياً:
- قفزة عملات/جواهر غير مبررة (بدون transaction مطابق).
- صيد سمك أعلى من الحد النظري في فترة زمنية.
- تكرار نفس الـ `device_id` بحسابات مختلفة (تدبيل).
- إرسال دعم/هدايا متبادل بين نفس الحسابات بكثرة (farming).
- استلام عملات من حساب دائماً يخسر معه في هجمات (gold trading).

## 4) منع التدبيل بين الحسابات (موجود جزئياً + تقوية)
- `device_accounts` موجود → نضيف فحص IP يومي وتسجيل في `account_links(user_a, user_b, reason)`.
- منع تحويل قيمة عبر هجوم بين حسابات على نفس الجهاز/IP.
- منع إرسال دعم لحساب على نفس الجهاز.

## 5) سجل وإجراء (`cheat_actions`)
- 3 flags = تنبيه أدمن (إشعار).
- 5 flags = mute تلقائي + تجميد المعاملات 24س.
- 10 flags = bann تلقائي.
- كل الإجراءات قابلة للمراجعة من الأدمن (إلغاء/تأكيد).

## 6) لوحة أدمن
صفحة `/admin/anti-cheat`:
- قائمة الـ flags مع سبب وتاريخ ولاعب.
- زر "تأكيد غش" → حظر، "خطأ إيجابي" → مسح الـ flag.
- إحصائيات: أكثر الإجراءات المشبوهة، أكثر الأجهزة ربطاً بحسابات.

## التفاصيل التقنية

**جداول جديدة:**
- `rate_limits(user_id, action, window_start, count)` — sliding window.
- `cheat_flags(user_id, kind, severity, details jsonb, resolved bool)`.
- `account_links(user_a, user_b, link_type[device|ip|trade], created_at)`.
- `user_ips(user_id, ip, last_seen)` لرصد التطابق.

**دوال SQL:**
- `check_rate(_action text, _max int, _seconds int) returns boolean`.
- `flag_cheat(_user uuid, _kind text, _severity int, _details jsonb)`.
- `apply_auto_action(_user uuid)` — يستدعى بعد كل flag.
- Triggers على `profiles` لرصد قفزات coins/gems بدون transaction مطابق.

**تعديل RPCs الموجودة:** إضافة `PERFORM check_rate(...)` في بداية كل من: `catch_fish`, `sell_fish`, `attack_player`, `send_support`, `redeem_code`, إرسال الرسائل.

**سحب الصلاحيات:**
```
REVOKE UPDATE (coins, gems, xp, level, rubies) ON public.profiles FROM authenticated;
```
يبقى الـ UPDATE للحقول التجميلية فقط (avatar_emoji, display_name, selected_bg_id).

**العميل:** يضيف header `x-client-version` ويتم رفض الإصدارات القديمة (لقفل الـ exploits المعروفة).

## ما لن تُغطّيه هذه الخطة
- Reverse engineering كامل للعميل (مستحيل في ويب).
- كشف bots بشري vs آلي (نحتاج captcha منفصل لاحقاً).

هل أبدأ التنفيذ؟ أو تبي أضيف/أحذف شي؟
