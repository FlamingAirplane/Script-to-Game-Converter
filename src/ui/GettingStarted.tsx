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
          <strong>Bring your script.</strong> Drag in a screenplay (Final Draft, Word, Fountain or a plain-text export) or a prose document
          (Word or Markdown), or paste text below. Not sure? Try a sample at the bottom first.
        </li>
        <li>
          <strong>Pick how interactive it should be.</strong> <em>Faithful</em> keeps your story exactly as written. <em>Interactive adaptation</em>{' '}
          suggests choices for you to accept or reject — nothing changes without your say-so.
        </li>
        <li>
          <strong>Review and play.</strong> Check each scene in <em>Review</em>, then play it in <em>Playtest</em> exactly as a player would. Anything
          that needs attention shows up in the <em>Diagnostics</em> list on the right, in plain words.
        </li>
        <li>
          <strong>Hand it to your developer.</strong> In <em>Export</em>, download the Unity or Unreal package and send that one .zip to whoever is
          building the game. It contains everything they need.
        </li>
      </ol>
      <p className="muted small">
        Your scripts never leave this computer — nothing is uploaded. Work is remembered in this browser, but use <strong>Save project</strong> (top
        right) to keep a copy you can reopen anywhere.
      </p>
    </section>
  );
}
