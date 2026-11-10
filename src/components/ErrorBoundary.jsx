import React from 'react';

/**
 * Last line of defence.
 *
 * Before this existed, a single render-time TypeError in any page unmounted the whole React
 * tree and left a white screen with no message — the user cannot tell a crash from a failed
 * deployment. This boundary keeps the navigation alive, shows what broke, and offers a retry.
 *
 * It is not a substitute for handling loading states correctly (see the `?.` guards throughout
 * the pages); it is what makes the difference between "this screen failed" and "the app is gone".
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Log once, with the component stack, so the browser console names the page that failed.
    console.error('[ui] render error', error?.message, info?.componentStack?.split('\n').slice(0, 6).join(' | '));
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card card-pad max-w-xl mx-auto mt-10">
        <h2 className="text-base font-semibold text-ink-900">This screen could not be displayed</h2>
        <p className="text-sm text-ink-600 mt-1">
          The rest of the application is still working. The error has been written to the browser
          console so it can be reported precisely.
        </p>
        <p className="mt-2 text-[12px] font-mono bg-ink-50 border border-ink-200 rounded px-2 py-1.5 text-danger-700">
          {String(this.state.error?.message || this.state.error)}
        </p>
        <div className="flex gap-2 mt-3">
          <button type="button" className="btn-primary btn-sm" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => { window.location.href = '/'; }}>
            Go to dashboard
          </button>
        </div>
        {this.props.label && <p className="text-[11px] text-ink-400 mt-2">Screen: {this.props.label}</p>}
      </div>
    );
  }
}
