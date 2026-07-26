package com.hamor.game;

import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Native Google Play Billing bridge used by src/lib/iap.ts. */
@CapacitorPlugin(name = "InAppPurchases")
public class InAppPurchasesPlugin extends Plugin implements PurchasesUpdatedListener {
    private BillingClient billingClient;
    private final Map<String, ProductDetails> productCache = new HashMap<>();
    private PluginCall pendingPurchaseCall;
    private boolean connecting;
    private final List<Runnable> readyCallbacks = new ArrayList<>();

    @Override
    public void load() {
        billingClient = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
            )
            .build();
        connect(null);
    }

    @Override
    protected void handleOnDestroy() {
        if (billingClient != null) billingClient.endConnection();
        rejectPendingPurchase("تم إغلاق عملية الشراء");
        super.handleOnDestroy();
    }

    private void connect(Runnable onReady) {
        if (billingClient == null) return;
        if (billingClient.isReady()) {
            if (onReady != null) onReady.run();
            return;
        }
        if (onReady != null) readyCallbacks.add(onReady);
        if (connecting) return;
        connecting = true;
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                connecting = false;
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    List<Runnable> callbacks = new ArrayList<>(readyCallbacks);
                    readyCallbacks.clear();
                    for (Runnable callback : callbacks) callback.run();
                } else {
                    readyCallbacks.clear();
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                connecting = false;
                // The next call reconnects; no purchase is granted client-side.
            }
        });
    }

    @PluginMethod
    public void getProducts(PluginCall call) {
        JSArray identifiers = call.getArray("productIdentifiers");
        if (identifiers == null || identifiers.length() == 0) {
            call.resolve(new JSObject().put("products", new JSArray()));
            return;
        }
        connect(() -> queryProducts(call, identifiers));
    }

    private void queryProducts(PluginCall call, JSArray identifiers) {
        List<QueryProductDetailsParams.Product> inApp = new ArrayList<>();
        List<QueryProductDetailsParams.Product> subs = new ArrayList<>();
        try {
            for (Object value : identifiers.toList()) {
                String id = String.valueOf(value);
                QueryProductDetailsParams.Product inAppProduct = QueryProductDetailsParams.Product
                    .newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build();
                QueryProductDetailsParams.Product subProduct = QueryProductDetailsParams.Product
                    .newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build();
                inApp.add(inAppProduct);
                subs.add(subProduct);
            }
        } catch (JSONException error) {
            call.reject("معرفات المنتجات غير صالحة", error);
            return;
        }

        List<ProductDetails> combined = new ArrayList<>();
        queryProductGroup(inApp, combined, () -> queryProductGroup(subs, combined, () -> {
            JSArray products = new JSArray();
            for (ProductDetails details : combined) {
                productCache.put(details.getProductId(), details);
                products.put(toProductJson(details));
            }
            call.resolve(new JSObject().put("products", products));
        }));
    }

    private void queryProductGroup(
        List<QueryProductDetailsParams.Product> products,
        List<ProductDetails> result,
        Runnable done
    ) {
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
            .setProductList(products)
            .build();
        billingClient.queryProductDetailsAsync(params, (billingResult, queryResult) -> {
            if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK && queryResult != null) {
                List<ProductDetails> details = queryResult.getProductDetailsList();
                if (details != null) result.addAll(details);
            }
            done.run();
        });
    }

    private JSObject toProductJson(ProductDetails details) {
        String price = "";
        String currency = "";
        if (details.getOneTimePurchaseOfferDetails() != null) {
            price = details.getOneTimePurchaseOfferDetails().getFormattedPrice();
            currency = details.getOneTimePurchaseOfferDetails().getPriceCurrencyCode();
        } else if (details.getSubscriptionOfferDetails() != null && !details.getSubscriptionOfferDetails().isEmpty()) {
            List<ProductDetails.PricingPhase> phases = details.getSubscriptionOfferDetails()
                .get(0).getPricingPhases().getPricingPhaseList();
            if (!phases.isEmpty()) {
                ProductDetails.PricingPhase phase = phases.get(phases.size() - 1);
                price = phase.getFormattedPrice();
                currency = phase.getPriceCurrencyCode();
            }
        }
        return new JSObject()
            .put("identifier", details.getProductId())
            .put("productId", details.getProductId())
            .put("title", details.getTitle())
            .put("description", details.getDescription())
            .put("priceString", price)
            .put("currencyCode", currency);
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        String id = call.getString("productIdentifier");
        if (id == null || id.isEmpty()) {
            call.reject("معرف المنتج مطلوب");
            return;
        }
        connect(() -> launchPurchase(call, id));
    }

    private void launchPurchase(PluginCall call, String id) {
        ProductDetails details = productCache.get(id);
        if (details == null) {
            call.reject("تعذر العثور على المنتج في Google Play. حدّث صفحة المتجر وحاول مجدداً");
            return;
        }
        if (pendingPurchaseCall != null) {
            call.reject("هناك عملية شراء أخرى قيد التنفيذ");
            return;
        }

        BillingFlowParams.ProductDetailsParams.Builder item = BillingFlowParams.ProductDetailsParams
            .newBuilder()
            .setProductDetails(details);
        if (BillingClient.ProductType.SUBS.equals(details.getProductType())) {
            List<ProductDetails.SubscriptionOfferDetails> offers = details.getSubscriptionOfferDetails();
            if (offers == null || offers.isEmpty()) {
                call.reject("لا توجد خطة اشتراك متاحة لهذا المنتج");
                return;
            }
            item.setOfferToken(offers.get(0).getOfferToken());
        }

        pendingPurchaseCall = call;
        BillingFlowParams params = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(Collections.singletonList(item.build()))
            .build();
        BillingResult launch = billingClient.launchBillingFlow(getActivity(), params);
        if (launch.getResponseCode() != BillingClient.BillingResponseCode.OK) {
            rejectPendingPurchase(launch.getDebugMessage());
        }
    }

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        if (pendingPurchaseCall == null) return;
        if (result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            rejectPendingPurchase("تم إلغاء الشراء");
            return;
        }
        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK || purchases == null || purchases.isEmpty()) {
            rejectPendingPurchase(result.getDebugMessage());
            return;
        }
        Purchase purchase = purchases.get(0);
        if (purchase.getPurchaseState() != Purchase.PurchaseState.PURCHASED) {
            rejectPendingPurchase("عملية الشراء معلقة ولم يتم الخصم بعد");
            return;
        }
        pendingPurchaseCall.resolve(new JSObject().put("transaction", toPurchaseJson(purchase)));
        pendingPurchaseCall = null;
    }

    @PluginMethod
    public void restorePurchases(PluginCall call) {
        connect(() -> {
            List<Purchase> combined = new ArrayList<>();
            queryPurchases(BillingClient.ProductType.INAPP, combined, () ->
                queryPurchases(BillingClient.ProductType.SUBS, combined, () -> {
                    JSArray transactions = new JSArray();
                    for (Purchase purchase : combined) transactions.put(toPurchaseJson(purchase));
                    call.resolve(new JSObject().put("transactions", transactions));
                })
            );
        });
    }

    private void queryPurchases(String type, List<Purchase> result, Runnable done) {
        QueryPurchasesParams params = QueryPurchasesParams.newBuilder().setProductType(type).build();
        billingClient.queryPurchasesAsync(params, (billingResult, purchases) -> {
            if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
                result.addAll(purchases);
            }
            done.run();
        });
    }

    private JSObject toPurchaseJson(Purchase purchase) {
        String productId = purchase.getProducts().isEmpty() ? "" : purchase.getProducts().get(0);
        String orderId = purchase.getOrderId() == null ? purchase.getPurchaseToken() : purchase.getOrderId();
        return new JSObject()
            .put("productIdentifier", productId)
            .put("productId", productId)
            .put("transactionId", orderId)
            .put("orderId", orderId)
            .put("purchaseToken", purchase.getPurchaseToken());
    }

    private void rejectPendingPurchase(String message) {
        if (pendingPurchaseCall == null) return;
        pendingPurchaseCall.reject(message == null || message.isEmpty() ? "تعذر إتمام الشراء" : message);
        pendingPurchaseCall = null;
    }
}