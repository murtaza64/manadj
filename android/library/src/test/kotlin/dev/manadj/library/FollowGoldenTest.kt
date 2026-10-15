package dev.manadj.library

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Follow parity with the desktop (golden): resources/follow/ comes from
 * src/test/tools/follow — gen_fixture.py runs the real backend (snapshot
 * builder + crud.get_tracks candidate query) over a synthetic library, and
 * export-follow-cases.test.ts runs the desktop frontend's Follow pipeline.
 * Regenerate both when desktop Follow changes.
 */
class FollowGoldenTest {
    private fun resource(name: String) = javaClass.getResource("/follow/$name")!!.readText()
    private val snapshot = SnapshotJson.parse(resource("snapshot.json"))
    private val library = Library(snapshot)

    @Test fun keyOpenKeyMatchesDesktopTable() {
        for (t in snapshot.tracks) assertEquals(t.key?.let { KEY_TABLE[it]?.first }, t.keyOpenKey, "track ${t.id}")
    }

    @Test fun bpmGateMatchesBackendCandidateQuery() {
        val sets = JSONObject(resource("candidates.json"))
        for (key in sets.keys()) {
            val (ref, thr) = key.split(":").map(String::toInt)
            val gate = BpmGate.of(library.track(ref)!!, FollowParams(bpmThresholdPercent = thr.toDouble()))
            val expected = sets.getJSONArray(key).let { a -> (0 until a.length()).map(a::getInt) }
            val got = snapshot.tracks.filter(gate::admits).map { it.id }.sorted()
            assertEquals(expected, got, "candidates $key")
        }
    }

    @Test fun followRowsOrderTierAndScoreMatchDesktop() {
        val cases = JSONArray(resource("expected.json"))
        var rows = 0
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val refs = c.getJSONArray("refs").let { a -> (0 until a.length()).map(a::getInt) }
            val params = FollowParams(
                bpmThresholdPercent = c.getDouble("thr"),
                knownOnly = c.getBoolean("knownOnly"),
                temperature = c.getDouble("temperature"),
                seed = c.getLong("seed"),
            )
            val expected = c.getJSONArray("rows").let { a -> (0 until a.length()).map(a::getJSONObject) }
            // The desktop pins the followed Tracks first ("Following"); the phone omits them.
            val following = expected.takeWhile { it.getString("label") == "Following" }.map { it.getInt("id") }
            assertEquals(refs.distinct().filter { library.track(it) != null }, following, "case $i following")
            val want = expected.drop(following.size)
            val got = library.follow(refs, params)
            val name = "case $i refs=$refs thr=${params.bpmThresholdPercent} knownOnly=${params.knownOnly} T=${params.temperature}"
            if (want.map { it.getInt("id") } != got.map { it.track.id }) {
                val w = want.map { it.getInt("id") }
                val g = got.map { it.track.id }
                fail("$name: order differs\n missing=${w - g.toSet()}\n extra=${g - w.toSet()}\n first diff at ${w.indices.firstOrNull { it >= g.size || w[it] != g[it] }}")
            }
            for ((e, r) in want.zip(got)) {
                assertEquals(e.getString("label"), r.label, "$name track ${r.track.id} label")
                val score = if (e.isNull("score")) null else e.getDouble("score")
                val shown = r.displayScore
                if (score == null || shown == null) assertEquals(score, shown, "$name track ${r.track.id} score")
                else assertTrue(abs(score - shown) <= 1e-9, "$name track ${r.track.id} score $shown != $score")
            }
            rows += got.size
        }
        assertTrue(rows > 1500, "golden too small: $rows rows")
    }
}
