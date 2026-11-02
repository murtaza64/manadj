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
