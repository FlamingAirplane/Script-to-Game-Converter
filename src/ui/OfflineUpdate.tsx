import { useEffect, useState } from 'react';
import { errorData, log } from '../core/log';

// Registers the website's service worker (see scripts/offline-site.ts), which keeps a copy of the
// app so it opens without a connection, and offers a reload when a newer version has been fetched.
// The project is autosaved, so reloading loses nothing.

const offlineLog = log('offline');

/** Only the built website has a service worker; the dev server and the file:// edition don't. */
const enabled = import.meta.env.PROD && import.meta.env.MODE !== 'single' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol);

export function OfflineUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    };
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        const firstInstall = !navigator.serviceWorker.controller;
        if (reg.waiting && !firstInstall) setWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state !== 'installed') return;
            if (navigator.serviceWorker.controller) {
              offlineLog.info('A new version is ready');
              setWaiting(sw);
            } else offlineLog.info('Saved for offline use');
          });
        });
        // Only reload when the writer asked for the new version, never on the first install.
        navigator.serviceWorker.addEventListener('controllerchange', () => !firstInstall && onControllerChange());
      })
      .catch((e) => offlineLog.warn('Offline copy unavailable', errorData(e)));
  }, []);

  if (!waiting) return null;
  return (
    <div className="update-toast" role="status">
      <span>A new edition of Narrative Bridge is ready.</span>
      <button className="btn tiny primary" onClick={() => waiting.postMessage('skip-waiting')}>
        Reload
      </button>
      <button className="btn tiny" onClick={() => setWaiting(null)}>
        Later
      </button>
    </div>
  );
}
