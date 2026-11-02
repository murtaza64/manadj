package dev.manadj.library.group

import com.google.crypto.tink.subtle.Ed25519Sign
import com.google.crypto.tink.subtle.Ed25519Verify
import java.security.GeneralSecurityException
import kotlin.test.*

/** RFC8032 test1, independent of a host/platform Ed25519 Signature provider. */
class GroupSignatureTest {
    private fun hex(value: String) = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    @Test fun portableEd25519MatchesPublishedVectorAndRejectsTampering() {
        val seed = hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
        val publicKey = hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
        val signature = hex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
        assertContentEquals(signature, Ed25519Sign(seed).sign(byteArrayOf()))
        Ed25519Verify(publicKey).verify(signature, byteArrayOf())
        assertFailsWith<GeneralSecurityException> { Ed25519Verify(publicKey).verify(signature, byteArrayOf(1)) }
        val forged = signature.copyOf().apply { this[0] = (this[0].toInt() xor 1).toByte() }
        assertFailsWith<GeneralSecurityException> { Ed25519Verify(publicKey).verify(forged, byteArrayOf()) }
    }
}
