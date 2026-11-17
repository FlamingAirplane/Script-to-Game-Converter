import { useEffect, useState } from 'react';

// A pixel-grid loader with a shimmering label and the time so far, adapted from Beautiful UI's
// Loading State (https://www.beautifului.dev, MIT licence, © 2026 Shane Levine). The 3×3 cells
// light up in a chevron that drives to the right. Styles: .pti-* in pen-to-ink.css.

const DELAYS = Array.from({ length: 9 }, (_, i) => ((i % 3) + Math.abs(Math.floor(i / 3) - 1)) * 90);

function useElapsed() {
  const [tenths, setTenths] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTenths((d) => d + 1), 100);
    return () => clearInterval(t);
  }, []);
  const s = tenths / 10;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${(s % 60).toFixed(1)}s`;
}

export function Loading({ label, elapsed = true }: { label: string; elapsed?: boolean }) {
  return (
    <span className="pti-loading">
      <span className="pti-grid" aria-hidden>
        {DELAYS.map((d, i) => (
          <span key={i} style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
      <span className="pti-label">{label}</span>
      {elapsed && <Elapsed />}
    </span>
  );
}

function Elapsed() {
  return (
    <span className="pti-elapsed" aria-hidden>
      {useElapsed()}
    </span>
  );
}
