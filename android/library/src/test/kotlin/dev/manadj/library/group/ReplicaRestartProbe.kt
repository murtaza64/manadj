package dev.manadj.library.group

import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/** Separate JVM process probe, generated directories only; never provisions or resets. */
object ReplicaRestartProbe {
    @JvmStatic fun main(args: Array<String>) {
        val replica = GroupReplica(File(args[0]), args[1])
        val result = JSONObject().put("evidence", JSONArray(replica.evidence().map { it.json() }))
            .put("pending", JSONArray(replica.pendingFor(args[2])))
        print(result.toString())
    }
}

internal fun restartReplica(root: File, group: String, peer: String): JSONObject {
    val builder = ProcessBuilder(File(System.getProperty("java.home"), "bin/java").path,
        "-cp", System.getProperty("manadj.groupTestClasspath"), ReplicaRestartProbe::class.java.name,
        root.path, group, peer).redirectErrorStream(true)
    // JVM option banners would corrupt the JSON protocol; this probe reads group state only.
    builder.environment().remove("JAVA_TOOL_OPTIONS")
    builder.environment().remove("JDK_JAVA_OPTIONS")
    val process = builder.start()
    try {
        check(process.waitFor(30, java.util.concurrent.TimeUnit.SECONDS)) { "Generated restart probe timed out" }
        val output = process.inputStream.bufferedReader().readText()
        check(process.exitValue() == 0) { output }
        return JSONObject(output)
    } finally { if(process.isAlive) process.destroyForcibly() }
}
