# Preserve Capacitor bridge and native plugins
-keep class com.getcapacitor.** { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-dontwarn com.getcapacitor.**

# Native widget and app classes
-keep class dev.presences.app.** { *; }
-keepclassmembers class dev.presences.app.** { *; }

# Preserve LineNumberTable for crash reporting
-keepattributes SourceFile,LineNumberTable
