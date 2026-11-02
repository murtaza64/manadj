package dev.manadj.library.group

import com.google.crypto.tink.subtle.Ed25519Sign
import com.google.crypto.tink.subtle.Ed25519Verify
import org.erdtman.jcs.JsonCanonicalizer
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID

/** Opaque issuer bytes/signature. Relay never serializes the signed body again. */
data class GroupSigned(val bodyBase64: String, val signatureBase64: String) {
    fun json() = JSONObject().put("body_b64", bodyBase64).put("signature_b64", signatureBase64)
    companion object {
        fun parse(json: JSONObject): GroupSigned {
            GroupWire.fields(json, "body_b64", "signature_b64")
            return GroupSigned(json.get("body_b64") as String, json.get("signature_b64") as String)
        }
    }
}

data class VerifiedGroupBody(val body: JSONObject, val sha256: String)

/** Shared #452 v1 cryptographic framing; no membership authority is read from network JSON. */
object GroupWire {
    const val FORMAT = "manadj-device-group/v1"
    const val MAX_BODY = 4 * 1024 * 1024
    const val MAX_OPERATION = 1024 * 1024
    private val domain = (FORMAT + "\u0000").toByteArray(Charsets.UTF_8)

    fun encode64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)
    fun decode64(value: String, max: Int): ByteArray {
        require(value.length <= ((max + 2L) / 3L * 4L)) { "Group base64 too large" }
        val raw = Base64.getDecoder().decode(value)
        require(raw.size <= max && encode64(raw) == value) { "Noncanonical group base64" }
        return raw
    }
    fun sha256(raw: ByteArray) = MessageDigest.getInstance("SHA-256").digest(raw).joinToString("") { "%02x".format(it) }
    fun uuid(value: String): String = value.also { require(UUID.fromString(it).toString() == it) { "Canonical UUID required" } }
    fun fields(json: JSONObject, vararg expected: String) {
        require(json.keys().asSequence().toSet() == expected.toSet()) { "Unexpected group fields" }
    }
    fun counter(json: JSONObject, key: String): Long {
        val value = json.get(key)
        require(value is Int || value is Long) { "Integer counter required" }
        return (value as Number).toLong().also { require(it in 0..9007199254740991L) }
    }

    // Bound recursion before handing data to JSON/JCS parsers (including hostile signed input).
    private fun bounded(text: String) {
        var depth = 0; var quoted = false; var escaped = false
        text.forEach { c ->
            if (quoted) {
                if (escaped) escaped = false else if (c == '\\') escaped = true else if (c == '"') quoted = false
            } else when(c) {
                '"' -> quoted = true
                '{', '[' -> { depth++; require(depth <= 24) { "Group JSON too deep" } }
                '}', ']' -> { depth--; require(depth >= 0) }
            }
        }
        require(!quoted && depth == 0)
    }
    fun canonical(json: JSONObject): ByteArray {
        val text = json.toString()
        require(text.toByteArray().size <= MAX_BODY)
        bounded(text)
        return JsonCanonicalizer(text).encodedUTF8
    }
    fun parse(raw: ByteArray): JSONObject {
        require(raw.size <= MAX_BODY)
        val text = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw)).toString()
        bounded(text)
        // Issuers MUST emit RFC8785. Equality also rejects duplicate keys/loose org.json syntax.
        require(JsonCanonicalizer(text).encodedUTF8.contentEquals(raw)) { "Canonical signed JSON required" }
        return JSONObject(text)
    }
    fun sign(body: JSONObject, seed: ByteArray): GroupSigned {
        require(seed.size == 32)
        val raw = canonical(body)
        return GroupSigned(encode64(raw), encode64(Ed25519Sign(seed).sign(domain + raw)))
    }
    fun verify(signed: GroupSigned, publicKey: ByteArray): VerifiedGroupBody {
        require(publicKey.size == 32)
        val raw = decode64(signed.bodyBase64, MAX_BODY)
        val signature = decode64(signed.signatureBase64, 64)
        require(signature.size == 64)
        Ed25519Verify(publicKey).verify(signature, domain + raw)
        return VerifiedGroupBody(parse(raw), sha256(raw))
    }
    fun publicKey(seed: ByteArray): ByteArray = Ed25519Sign.KeyPair.newKeyPairFromSeed(seed).publicKey
}
