// Library model, local store, device-sync client, filter + Follow ranking (#372).
// Pure Kotlin/JVM so its logic tests run on the host (./gradlew :library:test).
plugins { id("org.jetbrains.kotlin.jvm") }
kotlin { jvmToolchain(17) }
dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    // Portable Ed25519: minSdk26 must not depend on a platform Ed25519 JCA provider.
    implementation("com.google.crypto.tink:tink-android:1.17.0")
    implementation("io.github.erdtman:java-json-canonicalization:1.1")
    // org.json is part of the Android platform; the JVM build and tests need the artifact.
    compileOnly("org.json:json:20250107")
    testImplementation("org.json:json:20250107")
    testImplementation(kotlin("test"))
}
tasks.test {
    useJUnitPlatform()
    systemProperty("manadj.groupTestClasspath", sourceSets["test"].runtimeClasspath.asPath)
}
