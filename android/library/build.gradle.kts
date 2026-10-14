// Library model, local store, device-sync client, filter + Follow ranking (#372).
// Pure Kotlin/JVM so its logic tests run on the host (./gradlew :library:test).
plugins { id("org.jetbrains.kotlin.jvm") }
kotlin { jvmToolchain(17) }
dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    // org.json is part of the Android platform; the JVM build and tests need the artifact.
    compileOnly("org.json:json:20250107")
    testImplementation("org.json:json:20250107")
    testImplementation(kotlin("test"))
}
tasks.test { useJUnitPlatform() }
