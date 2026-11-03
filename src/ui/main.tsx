import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { errorData, formatEntry, log, logbook } from '../core/log';
import { GENERATOR_VERSION } from '../core/version';
import { App } from './App';
import './fonts.css';
import './styles.css';

const appLog = log('app');
appLog.info('Narrative Bridge started', {
  version: GENERATOR_VERSION,
  edition: location.protocol === 'file:' ? 'offline file' : 'web',
  language: navigator.language,
});
// Anything that escapes the app is recorded, so it can be included in a bug report.
window.addEventListener('error', (e) => appLog.error('Uncaught error', { message: e.message, at: e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : undefined }));
window.addEventListener('unhandledrejection', (e) => appLog.error('Unhandled promise rejection', errorData(e.reason)));

function downloadLog() {
  const blob = new Blob([logbook.all().map(formatEntry).join('\n') + '\n'], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `narrative-bridge-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
  a.click();
}

/** If a view crashes, show a recoverable page (with the log) instead of a blank screen. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    appLog.error('A view crashed', errorData(error));
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div className="card">
          <h2>A page has torn</h2>
          <p>Something went wrong while drawing this screen. Your project is saved in this browser, so reloading usually brings everything back.</p>
          <p className="muted small mono">{this.state.error.message}</p>
          <div className="row">
            <button className="btn primary" onClick={() => location.reload()}>
              Reload
            </button>
            <button className="btn" onClick={downloadLog}>
              Download log
            </button>
          </div>
          <p className="muted small">If it keeps happening, please attach the log to a report on GitHub. It contains no story text.</p>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
