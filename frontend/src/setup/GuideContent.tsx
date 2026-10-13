import { Component, Suspense, type ReactNode } from 'react';

/** A failed/lazy guide must not replace the whole app or lose Setup progress. */
export class GuideContent extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return (
      <div className="setup-guide-content" role="alert">
        <h2>This guide couldn’t open.</h2>
        <p>Your choices are saved. Reload manaDJ to try again, or finish setup later.</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload manaDJ</button>
      </div>
    );
    return <div className="setup-guide-content"><Suspense fallback={<p role="status">Opening your next setup guide…</p>}>{this.props.children}</Suspense></div>;
  }
}
