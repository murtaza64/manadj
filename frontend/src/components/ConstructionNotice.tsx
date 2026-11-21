import './ConstructionNotice.css';
/** Deliberately unbuilt, not disconnected, loading, failed or a pretend action. */
export function ConstructionNotice({ label, detail }: { label: string; detail: string }) {
  return <details className="construction-notice"><summary><span aria-hidden="true">⚒</span> {label} <small>Under construction</small></summary><p>{detail}</p></details>;
}
