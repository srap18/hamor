# 1. حماية مكتبات Capacitor الأساسية
-keep class com.getcapacitor.** { *; }
-keep class com.capacitor.** { *; }

# 2. حماية مكتبات Google و Firebase (مهم جداً لـ Google Services)
-keep class com.google.** { *; }
-keepattributes *Annotation*
-keep class com.google.firebase.** { *; }

# 3. حماية مكتبات AndroidX (ضروري جداً)
-keep class androidx.** { *; }

# 4. حماية نظام الـ Billing (تأكد من إضافته لأنك تستخدمه في التطبيق)
-keep class com.android.billingclient.** { *; }

# 5. حماية واجهة الاتصال بين الجافا سكريبت والنيتيف
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# 6. الحفاظ على أسماء الفئات والأساليب المهمة للعمل
-keepattributes Signature,InnerClasses,EnclosingMethod,Exceptions,SourceFile,LineNumberTable

# 7. (إضافة مهمة) حماية ملفات الإعدادات والـ JSON
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}
