plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "dev.manadj.app"
    compileSdk = 35
    defaultConfig {
        // Project domain manadj.murt.dev; distinct from the #365 prototype (dev.manadj.phonelab).
        applicationId = "dev.murt.manadj"
        minSdk = 26
        targetSdk = 35
        versionCode = 6
        versionName = "0.1.0-rc.6"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
    // Lanes sharing one phone install side by side: -Pmanadj.appIdSuffix=.lane
    (findProperty("manadj.appIdSuffix") as String?)?.let { buildTypes.getByName("debug").applicationIdSuffix = it }
    // UH31: what the human's phone runs — R8-optimized, not debuggable (fully AOT/JIT-compiled, no Compose debug
    // paths), profileable from shell, signed with the shared debug key so it installs over the debug app
    // (same applicationId). Baseline profile: src/main/baseline-prof.txt + library profiles via profileinstaller.
    // assemblePhone → build/outputs/apk/phone/app-phone.apk. run-as no longer works on it (use a debug install).
    buildTypes.create("phone") {
        initWith(buildTypes.getByName("release"))
        isMinifyEnabled = true
        isShrinkResources = true
        isDebuggable = false
        isProfileable = true
        proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        signingConfig = signingConfigs.getByName("debug")
        matchingFallbacks += listOf("release")
    }
    // One debug identity across lanes/machines so installs update in place:
    // MANADJ_ANDROID_KEYSTORE (path, password "android", alias androiddebugkey), else a
    // lane-local ../.lane-tmp/android-user/debug.keystore, else the SDK default key.
    signingConfigs.getByName("debug") {
        val shared = System.getenv("MANADJ_ANDROID_KEYSTORE")?.let { file(it) }
        val retained = rootProject.file("../.lane-tmp/android-user/debug.keystore")
        (shared?.takeIf { it.isFile } ?: retained.takeIf { it.isFile })?.let { storeFile = it }
    }
}
dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.04.01")
    implementation(project(":audio-engine"))
    implementation(project(":library"))
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.profileinstaller:profileinstaller:1.4.1") // installs baseline profiles on sideload
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303") // the real org.json (android.jar ships stubs)
    androidTestImplementation(composeBom)
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest") // createComposeRule host activity (BrowserSheetTest)
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
