import { useEffect, useState } from 'react';
import { sameDesign, useDesign } from '../design/design';

// The hidden way into the design editor: the page's address ending in #admin. Nothing links to it.
// The editor itself (and its lock screen) is a separate chunk, loaded only then.

const isAdminHash = () => location.hash === '#admin';

export function AdminHost() {
  const [open, setOpen] = useState(isAdminHash);
  const { draft, previewPublished, published } = useDesign();
  useEffect(() => {
    const on = () => setOpen(isAdminHash());
    window.addEventListener('hashchange', on);
    on(); // the address may have changed before this listener was attached
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    if (!open) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    const close = () => {
      history.replaceState(null, '', location.pathname + location.search);
      setOpen(false);
    };
    void import('./AdminRoot').then((m) => {
      if (!cancelled) dispose = m.mountAdmin(close);
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [open]);
  // A draft only exists in the browser it was made in (the admin's), so this shows only there.
  if (open || !draft || sameDesign(draft, published)) return null;
  return (
    <button className="design-draft-pill" onClick={() => (location.hash = 'admin')} title="This browser is showing an unpublished design draft. Open the design editor.">
      {previewPublished ? 'Published design (draft hidden)' : 'Design draft'}
    </button>
  );
}
