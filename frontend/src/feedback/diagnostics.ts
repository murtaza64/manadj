type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Snapshot = Record<string, Json>;
export type Section = 'view' | 'browse' | 'filters' | 'decks' | 'mixer' | 'editor' | 'set' | 'session' | 'audible_surface' | 'crash';
export type Readers = Partial<Record<Section, () => unknown>>;
const readers: Partial<Record<Section, Set<() => unknown>>> = {};
const recent: { at: string; source: string; message: string }[] = [];

export function redact(text: string, limit = 1000): string {
  return text.slice(0, 24000)
    .replace(/(?:https?:\/\/|\/)[^\s<>"']+/gi, (url) => url
      .replace(/\/\/[^/@\s]+:[^/@\s]+@/, '//[redacted]@')
      .replace(/[?#].*$/, '?[redacted]'))
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, '[redacted]')
    .replace(/(["']?(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|access[_-]?key)[\w-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]')
    .replace(/\b(?:gh[pousr]_[\w]+|github_pat_[\w]+|sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[redacted]')
    .slice(0, limit);
}

// Only selected fields enter here. Bounds/redaction are a second barrier, not
// permission to hand this function a Track, a context, or a query cache.
function bounded(value: unknown, depth = 0): Json {
  if (value == null || depth > 5) return null;
  if (typeof value === 'string') return redact(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.slice(0, 32).map((v) => bounded(v, depth + 1));
  if (typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries(value).slice(0, 32)
    .filter(([k]) => !/password|secret|token|cookie|authorization|credential|api.?key/i.test(k))
    .map(([k, v]) => [redact(k, 64), bounded(v, depth + 1)]));
}

export function registerDiagnostics(section: Section, read: () => unknown): () => void {
  (readers[section] ??= new Set()).add(read);
  return () => { readers[section]?.delete(read); };
}

export function recordError(source: string, error: unknown): void {
  // Never stringify arbitrary rejection/console objects (request bodies, etc.).
  const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
    : typeof error === 'string' ? error : '[non-text error omitted]';
  recent.push({ at: new Date().toISOString(), source: redact(source, 80), message: redact(message) });
  if (recent.length > 12) recent.shift();
}

export function installFeedbackErrors(): () => void {
  const onError = (e: ErrorEvent) => recordError('window.error', e.error ?? e.message);
  const onRejection = (e: PromiseRejectionEvent) => recordError('unhandledrejection', e.reason);
  const original = console.error;
  const wrapped: typeof console.error = (...args) => {
    recordError('console.error', args.slice(0, 4).map((arg) =>
      arg instanceof Error ? `${arg.name}: ${arg.message}` : typeof arg === 'string' ? arg : '[object omitted]').join(' '));
    original.apply(console, args);
  };
  console.error = wrapped;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    if (console.error === wrapped) console.error = original;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

export function captureDiagnostics(extra: Readers = {}): { snapshot: Snapshot; warnings: string[] } {
  const snapshot: Snapshot = {
    captured_at: new Date().toISOString(),
    viewport: { width: window.innerWidth, height: window.innerHeight, pixel_ratio: window.devicePixelRatio },
    user_agent: redact(navigator.userAgent),
    errors: recent.map((entry) => ({ ...entry })),
  };
  const warnings: string[] = [];
  for (const section of ['view', 'browse', 'filters', 'decks', 'mixer', 'editor', 'set', 'session', 'audible_surface', 'crash'] as const) {
    const sources = [...(readers[section] ?? []), ...(extra[section] ? [extra[section]!] : [])];
    if (!sources.length) continue;
    try {
      // The shell and selection panel can contribute disjoint primitive fields.
      const values = sources.flatMap((read) => {
        try { return [read()]; }
        catch { warnings.push(`${section}: diagnostics unavailable`); return []; }
      });
      if (!values.length) continue;
      const value = bounded(values.length === 1 ? values[0] : Object.assign({}, ...values));
      if (JSON.stringify(value).length > 8000) throw new Error('section exceeds size limit');
      if (JSON.stringify({ ...snapshot, [section]: value }).length > 64000) throw new Error('snapshot exceeds size limit');
      snapshot[section] = value;
    } catch {
      warnings.push(`${section}: diagnostics unavailable`);
    }
  }
  return { snapshot, warnings };
}
