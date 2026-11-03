package dev.manadj.app

import dev.manadj.audio.MasterRecordingStatus
import java.io.File

/** Service-owned projection; only finalized .wav files may be shared/exported. */
data class MasterRecordings(
    val status: MasterRecordingStatus? = null,
    val pending: Boolean = false,
    val files: List<File> = emptyList(),
    val incomplete: Int = 0,
    val error: String? = null,
) {
    val busy get() = pending || status?.busy == true
    val label get() = when {
        pending -> "Finalizing / starting…"
        status?.busy == true -> "REC %02d:%02d".format(status.seconds.toInt() / 60, status.seconds.toInt() % 60)
        error != null -> error
        status?.errorMessage != null -> status.errorMessage
        incomplete > 0 -> "$incomplete incomplete recording(s) retained, not shareable"
        else -> "Stereo Master · WAV"
    }
}
