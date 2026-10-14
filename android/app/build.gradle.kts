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
        versionCode = 4
        versionName = "0.1.0-local-playback"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
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
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.runtime:runtime")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
