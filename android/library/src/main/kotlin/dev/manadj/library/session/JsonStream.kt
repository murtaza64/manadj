package dev.manadj.library.session

import java.io.Reader

/**
 * Minimal streaming JSON reader for Session logs (tens of MB, 100k+ events): the root object is walked
 * key by key and each array element parsed on its own, so no whole-document tree is ever built.
 * Values parse to Map<String, Any?> / List<Any?> / String / Double / Boolean / null.
 */
internal class JsonStream(private val reader: Reader) {
    private val buf = CharArray(1 shl 16)
    private var len = 0
    private var pos = 0

    private fun fill(): Boolean { len = reader.read(buf); pos = 0; return len > 0 }
    private fun peekRaw(): Char { if (pos >= len && !fill()) error("Unexpected end of JSON"); return buf[pos] }
    private fun next(): Char = peekRaw().also { pos++ }
    fun peek(): Char { skipWs(); return peekRaw() }
    private fun skipWs() { while (true) { val c = peekRaw(); if (c == ' ' || c == '\n' || c == '\r' || c == '\t') pos++ else return } }
    fun expect(c: Char) { skipWs(); val got = next(); require(got == c) { "Expected '$c' but found '$got'" } }

    /** Walk an object: [onKey] must consume the value (via [value], [skip] or nested walks). */
    fun obj(onKey: (String) -> Unit) {
        expect('{')
        if (peek() == '}') { pos++; return }
        while (true) {
            val key = string()
            expect(':')
            onKey(key)
            skipWs()
            when (next()) { ',' -> continue; '}' -> return; else -> error("Bad object") }
        }
    }

    /** Walk an array: [onItem] must consume each element. */
    fun array(onItem: () -> Unit) {
        expect('[')
        if (peek() == ']') { pos++; return }
        while (true) {
            onItem()
            skipWs()
            when (next()) { ',' -> continue; ']' -> return; else -> error("Bad array") }
        }
    }

    fun value(): Any? = when (peek()) {
        '{' -> LinkedHashMap<String, Any?>().also { m -> obj { k -> m[k] = value() } }
        '[' -> ArrayList<Any?>().also { l -> array { l.add(value()) } }
        '"' -> string()
        't' -> { word("true"); true }
        'f' -> { word("false"); false }
        'n' -> { word("null"); null }
        else -> number()
    }

    fun skip() { value() }

    private fun word(w: String) { for (c in w) require(next() == c) { "Bad literal" } }

    private fun number(): Double {
        val sb = StringBuilder()
        while (true) {
            if (pos >= len && !fill()) break
            val c = buf[pos]
            if (c in '0'..'9' || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E') { sb.append(c); pos++ } else break
        }
        return sb.toString().toDouble()
    }

    fun string(): String {
        expect('"')
        val sb = StringBuilder()
        while (true) {
            when (val c = next()) {
                '"' -> return sb.toString()
                '\\' -> when (val e = next()) {
                    'n' -> sb.append('\n'); 't' -> sb.append('\t'); 'r' -> sb.append('\r'); 'b' -> sb.append('\b'); 'f' -> sb.append('\u000c')
                    'u' -> sb.append(String(CharArray(4) { next() }).toInt(16).toChar())
                    else -> sb.append(e)
                }
                else -> sb.append(c)
            }
        }
    }
}
