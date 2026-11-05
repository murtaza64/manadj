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
        // #481: Excalibur-signed app installs alongside the original da36-signed dev.murt.manadj (separate data store).
        applicationId = "dev.murt.manadj.excalibur"
        minSdk = 26
        targetSdk = 35
        versionCode = 8
        versionName = "0.1.0-rc.8"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
    testOptions { unitTests.isIncludeAndroidResources = true }
    // Release identity (#419): scripts/release/android_release.py stamp writes <dir>/manadj-release/{build-info,release-notes}.json;
    // -Pmanadj.releaseMetadataDir=<dir> ships them as assets/manadj-release/*. Absent = unstamped dev build.
    (findProperty("manadj.releaseMetadataDir") as String?)?.let { sourceSets.getByName("main").assets.srcDir(it) }
    // Lanes sharing one phone install side by side: -Pmanadj.appIdSuffix=.lane
    (findProperty("manadj.appIdSuffix") as String?)?.let { buildTypes.getByName("debug").applicationIdSuffix = it }
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
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303") // the real org.json (android.jar ships stubs)
    testImplementation(composeBom)
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    androidTestImplementation(composeBom)
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
