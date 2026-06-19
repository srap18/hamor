# حماية مكتبة Capacitor الأساسية (بدونها قد يتوقف التطبيق)
-keep class com.getcapacitor.** { *; }

# حماية مكتبات Google و Firebase
-keep class com.google.** { *; }
-keep class com.google.firebase.** { *; }

# حماية مكتبات AndroidX
-keep class androidx.** { *; }

# حماية واجهة الاتصال بين الجافا سكريبت والنيتيف (ضروري لـ WebView)
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# الحفاظ على أسماء الفئات والأساليب المهمة للعمل
-keepattributes Signature,InnerClasses,EnclosingMethod,Exceptions,SourceFile,LineNumberTable
