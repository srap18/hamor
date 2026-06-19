# استبدال PayPal بـ Polar

استبدال كامل لطبقة الدفع. PayPal يُحذف، Polar يأخذ مكانه في كل مكان (متجر الشحن، VIP، الدروع).

## التغييرات

### 1. قاعدة البيانات (migration واحدة)
- جدول `polar_purchases`: `id`, `user_id`, `polar_checkout_id` (unique), `polar_order_id`, `pack_id`, `amount_cents`, `environment` (sandbox/live), `status`, `created_at`. RLS + GRANT.
- RPC جديد `grant_polar_purchase(...)` بنفس توقيع `grant_paddle_purchase` تقريباً، يكتب في `polar_purchases` بدل `paddle_purchases` ويمنح المكافآت.

### 2. كود الخادم (server fns + route جديدة)
- `src/lib/polar.server.ts` — wrapper لـ Polar REST API. يقرأ `POLAR_ACCESS_TOKEN`، يحدد `baseUrl` حسب `POLAR_ENV` (افتراضي `sandbox`).
- `src/lib/polar-checkout.functions.ts`:
  - `createPolarCheckout({ packId, origin })` — يتحقق من eligibility (نفس قواعد `checkPackEligibility`)، يجيب المنتج من Polar عبر metadata.pack_id، ينشئ checkout session مع `external_customer_id = userId` و `success_url = {origin}/payment-success?polar_checkout_id={CHECKOUT_ID}`، يرجّع `{ checkoutUrl }`.
  - `verifyPolarCheckout({ checkoutId })` — يستدعى من صفحة النجاح، يتحقق من حالة checkout ويرجّع status.
- `src/routes/api/public/polar/webhook.ts` — Standard Webhooks signature verification بـ `POLAR_WEBHOOK_SECRET`، يعالج `order.paid` فقط: يستدعي `grant_polar_purchase` (idempotent عبر unique constraint على checkout_id)، يمنح inventory items و phoenix ships و referral bonus بنفس منطق PayPal الحالي.

### 3. UI
- `RechargePanel.tsx`: حذف import `buyPackWithPayPal`، استبدال زر الدفع باستدعاء `createPolarCheckout` ثم `window.location.href = checkoutUrl`.
- `vip.tsx`: نفس الاستبدال.
- `payment-success.tsx`: قراءة `polar_checkout_id` من URL، استدعاء `verifyPolarCheckout`، عرض النتيجة.

### 4. حذف
- ملفات: `src/lib/paypal-buy.ts`, `src/lib/paypal-checkout.functions.ts`, `src/lib/paypal.server.ts`, `src/routes/api/public/paypal/webhook.ts`.
- أسرار: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` (سأطلب منك حذفها من Settings → Secrets يدوياً بعد التأكد إن كل شيء يشتغل).

## ما تحتاج تسويه أنت بعد التنفيذ

1. **في Polar dashboard** أنشئ المنتجات (واحدة لكل حزمة في المتجر — 30+ منتج). لكل منتج:
   - السعر = `priceUSD` من `STORE_PACKS`.
   - في **Metadata** أضف مفتاح `pack_id` = نفس الـ ID من `STORE_PACKS` (مثل `offer_gems_550_15off`).
   - الكود يطابق المنتجات تلقائياً عبر هذا المفتاح، فما تحتاج تحفظ IDs يدوياً.
2. **Webhook**: بعد ما يتنشر المشروع، روح Polar → Settings → Webhooks → New Endpoint، URL = `https://<your-domain>/api/public/polar/webhook`، الأحداث: `order.paid` (و اختيارياً `order.refunded`, `checkout.updated`). ثم تعطيني السر لإضافته كـ `POLAR_WEBHOOK_SECRET`.
3. **البيئة**: ابدأ في sandbox. للاختبار بدون دفع فعلي: أنشئ كوبون خصم 100% في Polar sandbox واستخدمه على checkout.

## تفاصيل تقنية

- **Polar API base**:
  - sandbox: `https://sandbox-api.polar.sh/v1`
  - live: `https://api.polar.sh/v1`
  - يتحدد من `process.env.POLAR_ENV` (افتراضي `sandbox` حتى تطلب التبديل).
- **Auth header**: `Authorization: Bearer ${POLAR_ACCESS_TOKEN}`.
- **مطابقة المنتجات**: عند أول استدعاء بعد deploy، نجيب كل المنتجات من `/v1/products?organization_id=...&is_archived=false` ونكاش map من `metadata.pack_id` → `productId/priceId` في الذاكرة (TTL 5 دقائق).
- **Webhook signature**: مكتبة `standardwebhooks` لازم base64-encode للسر قبل البناء.
- **Idempotency**: unique constraint على `polar_checkout_id` يمنع double-grant لو الـ webhook اتعاد.

## نقطة قرار

**البيئة**: تبي أبدأ بـ sandbox (الافتراضي، آمن للاختبار)، أو production مباشرة؟ أنصح بـ sandbox أولاً، بعد ما نتأكد إن كل شيء يشتغل (شراء تجريبي يكتمل، webhook يصل، مكافآت تنزل)، نحوّل لـ live بتغيير `POLAR_ENV` فقط.
