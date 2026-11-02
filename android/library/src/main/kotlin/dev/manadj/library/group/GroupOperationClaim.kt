package dev.manadj.library.group

import org.json.JSONObject

/** Identity of a deny-only paired claim, not membership or replay authorization. */
data class GroupOperationClaim(val groupId: String, val operationId: String, val originDeviceId: String, val operationSha256: String) {
    fun json() = JSONObject().put("group_id",groupId).put("operation_id",operationId)
        .put("origin_device_id",originDeviceId).put("operation_sha256",operationSha256)
    companion object {
        fun parse(o: JSONObject): GroupOperationClaim {
            GroupWire.fields(o,"group_id","operation_id","origin_device_id","operation_sha256")
            val hash=o.getString("operation_sha256"); require(hash.matches(Regex("[0-9a-f]{64}")))
            return GroupOperationClaim(GroupWire.uuid(o.getString("group_id")),GroupWire.uuid(o.getString("operation_id")),
                GroupWire.uuid(o.getString("origin_device_id")),hash)
        }
    }
}
