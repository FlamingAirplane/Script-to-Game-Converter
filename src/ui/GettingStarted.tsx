import { useState } from 'react';

const KEY = 'narrative-bridge.guide-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Plain-language first-run guide for writers. Dismissible; reopened from "How it works". */
/** The illustrated guide in the repository (docs/USER_GUIDE.md). */
export const USER_GUIDE_URL = 'https://github.com/FlamingAirplane/Script-to-Game-Converter/blob/main/docs/USER_GUIDE.md';

export function GettingStarted() {
  const [open, setOpen] = useState(() => !readDismissed());
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private window or storage blocked: the guide simply shows again next time */
    }
  };

  if (!open)
    return (
      <button className="link small guide-reopen" onClick={() => setOpen(true)}>
        How it works
      </button>
    );

  return (
    <section className="guide card" aria-label="Getting started">
      <div className="row">
        <h2>New here? Four steps.</h2>
        <span className="spacer" />
        <button className="btn tiny" onClick={close}>
          Got it
        </button>
      </div>
      <ol className="guide-steps">
        <li>
          <strong>Bring your script:</strong> drop in a screenplay or prose file (Final Draft, Word, PDF, Fountain, text), or paste it.
        </li>
        <li>
          <strong>Pick a mode:</strong> <em>Faithful</em> keeps it as written; <em>Interactive adaptation</em> suggests choices for your OK.
        </li>
        <li>
          <strong>Review and play</strong> each scene, and fix anything listed under <em>Diagnostics</em> (the notes on the right).
        </li>
        <li>
          <strong>Export</strong> a playable web page to share, or a package for your game developer (Unity or Unreal).
        </li>
      </ol>
      <p className="muted small">
        Your scripts stay on this computer: nothing is uploaded unless you choose to move a project through your own GitHub account. Work is remembered in this browser, but use <strong>Save project</strong> (top
        right) to keep a copy you can reopen anywhere.
      </p>
      <p className="small">
        <a href={USER_GUIDE_URL} target="_blank" rel="noopener noreferrer">
          Read the full user guide
        </a>{' '}
        for every screen, with pictures.
      </p>
    </section>
  );
}
