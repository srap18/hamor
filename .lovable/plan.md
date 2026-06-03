
## نظرة عامة

إضافة نظام يوزر فريد لكل مستخدم، صفحة ملف شخصي عامة بأزرار تفاعل، ألبوم شخصي للصور والفيديوهات القصيرة، وفحص ذكي للمحتوى المخل قبل النشر.

---

## 1. نظام اليوزر (Username)

**الحقول الجديدة في `profiles`:**
- `username` (text, unique, lowercase, 5-20 حرف، يقبل `a-z0-9_` فقط)
- `username_changed_at` (timestamp) — لحساب 14 يوم

**التوليد التلقائي:**
- لكل حساب موجود وحساب جديد: `user_` + 6 أرقام عشوائية (مثل `user_482917`)
- يتم تنفيذه عبر migration للحسابات الحالية + trigger للحسابات الجديدة
- ضمان التفرّد عبر unique constraint مع إعادة المحاولة لو تكرر

**تغيير اليوزر:**
- دالة `change_username(new_username)` ترفض لو آخر تغيير أقل من 14 يوم
- التحقق من التوفر + صيغة صحيحة + غير محجوز

**البحث:**
- `search_profiles_public` يدعم البحث بـ username بجانب display_name
- يظهر اليوزر تحت الاسم في نتائج البحث: `أحمد @user_482917`

---

## 2. زيارة الملف الشخصي (Profile Page)

**Route جديد:** `/u/$username` (أو يدعم `/players/$playerId` الموجود)

من أي مكان فيه صوت/اسم لاعب (chat, voice rooms, friends list): الضغط على الاسم → يفتح الملف.

**يحتوي على:**
- بطاقة البروفايل (إطار + اسم + يوزر + level + xp)
- وصف شخصي (`bio` نص قصير، 200 حرف)
- 3 أزرار رئيسية:
  - **زيارة المحيط** → ينقل إلى `/players/$playerId` (يعرض سفنه ويوفر هجوم/سرقة/دعم - الموجودة حاليًا)
  - **إضافة صديق** → يستخدم نظام friends الموجود
  - **رسالة خاصة** → DM
- شبكة الألبوم (grid 3 أعمدة)

---

## 3. الألبوم الشخصي

**جدول جديد `profile_media`:**
- `user_id`, `media_url`, `media_type` ('image' | 'video')
- `thumbnail_url` (للفيديو), `duration_ms` (للفيديو)
- `caption` (اختياري, 100 حرف)
- حد أقصى **20 عنصر** لكل مستخدم (يفرضه trigger)

**Storage Bucket جديد:** `profile-media` (عام للقراءة)

**القواعد:**
- الصور: حد 5 ميجا، jpg/png/webp
- الفيديوهات: حد 25 ميجا، **مدة لا تتجاوز 30 ثانية** (يُتحقق عبر `<video>.duration` قبل الرفع)
- المالك يقدر يحذف عناصره
- الإدارة تقدر تحذف أي شيء
- الجميع يقدر يشاهد ألبوم أي شخص

---

## 4. فحص المحتوى بالذكاء الاصطناعي

**الصور:** نستخدم `moderateImage` الموجود (Lovable AI / Gemini Vision) — موسّع بفئات أكثر شمولًا.

**الفيديوهات:** سيرفر فنكشن جديدة `moderateVideo`:
- نأخذ 3-4 إطارات (frames) من الفيديو في المتصفح عبر `<canvas>` (بداية/منتصف/نهاية)
- نرسلها لـ Gemini Vision دفعة واحدة للتصنيف
- لو أي إطار غير آمن → رفض الفيديو

**معايير الرفض:** عُري، محتوى جنسي/ملابس داخلية صريحة، عنف دموي، رموز كراهية، إيذاء ذاتي.

**التدفق:** المستخدم يختار ملف → معاينة + فحص → "جاري الفحص..." → قبول/رفض + سبب → الرفع لـ Storage.

---

## الملفات (تفاصيل تقنية)

**Migrations:**
- `add_username_to_profiles` — عمود + unique + توليد لكل المستخدمين الحاليين + trigger للجديد
- `create_profile_media` — الجدول + RLS + trigger حد 20 + GRANTs
- `change_username_rpc` — دالة التغيير كل 14 يوم
- توسيع `search_profiles_public` ليشمل username

**Storage:** `profile-media` bucket عام + RLS على `storage.objects` (الكتابة للمالك فقط في مجلده).

**واجهة:**
- `src/routes/u.$username.tsx` — صفحة الملف العام
- `src/components/ProfileAlbum.tsx` — الشبكة + الرفع + المعاينة (lightbox)
- `src/components/MediaUploader.tsx` — اختيار + فحص مدة الفيديو + استدعاء moderation
- `src/lib/profile-media.functions.ts` — server functions للرفع/الحذف
- `src/lib/moderation.functions.ts` — إضافة `moderateVideoFrames`
- توسيع `src/lib/profiles-public.ts` ليجلب الـ bio + username

**روابط:** أي مكان يعرض اسم لاعب (ChatMessages, VoiceRooms, FriendsList, ForumTopics) → wrap بـ Link إلى `/u/$username`.

---

## ملاحظات

- البيو والألبوم اختياريان — لو فاضي يظهر "لم يضف بعد"
- زيارة المحيط = نفس صفحة `/players/$playerId` الموجودة (فيها الهجوم/السرقة/الدعم)
- الفحص بالذكاء يستخدم Lovable AI مجاناً (Gemini) — بدون مفاتيح إضافية
- التطبيق على مراحل: (1) اليوزر، (2) صفحة الملف + bio + الأزرار، (3) الألبوم + الفحص

هل أبدأ بالتنفيذ؟
