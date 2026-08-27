import { Component, type ErrorInfo, type ReactNode } from 'react'
import './RootErrorBoundary.css'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  componentStack: string | null
}

// Root error boundary (gh#191, from #188's diagnosis): an uncaught
// render/effect error unmounts the whole React tree → blank screen. This
// catches it and shows a crash panel (message + component stack + reload)
// so future unknowns produce on-screen evidence. renderer.log captures the
// throw itself; this panel is the human-facing half.
export default class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null })
    // Belt-and-braces: make sure the crash reaches the console (and thus
    // renderer.log in the desktop shell) even if React swallows it.
    console.error('[RootErrorBoundary] uncaught error:', error, info.componentStack)
  }

  render() {
    const { error, componentStack } = this.state
    if (!error) return this.props.children
    return (
      <div className="crash-panel" role="alert">
        <div className="crash-panel-inner">
          <div className="crash-panel-title">manadj crashed</div>
          <div className="crash-panel-message">
            {error.name}: {error.message}
          </div>
          {error.stack && (
            <>
              <div className="crash-panel-label">stack</div>
              <pre className="crash-panel-stack">{error.stack}</pre>
            </>
          )}
          {componentStack && (
            <>
              <div className="crash-panel-label">component stack</div>
              <pre className="crash-panel-stack">{componentStack.trim()}</pre>
            </>
          )}
          <button
            className="crash-panel-reload"
            onClick={() => window.location.reload()}
          >
            RELOAD
          </button>
        </div>
      </div>
    )
  }
}
