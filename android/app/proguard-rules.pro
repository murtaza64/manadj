# Phone build (UH31). No reflection/JNI callbacks into Kotlin; keep what the platform calls by name.
# WebView bridge (viz): JS calls these by name.
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
-keepattributes JavascriptInterface
# Readable stack traces in logcat.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
-dontwarn org.jetbrains.annotations.**
