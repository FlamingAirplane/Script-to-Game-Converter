// The Pen to Ink mark: a fountain-pen nib, its slit and breather hole cut out, laying down a stroke
// of ink. Drawn with currentColor so it takes the colour of its surroundings (gold on the top bar,
// copper on the page). The same paths are used for the favicon and the app icons
// (index.html, scripts/icons.mjs, scripts/og-image.mjs): change them together.

/** The nib, with the breather hole and the slit cut out (even-odd fill). */
export const NIB_PATH =
  'M8.5 2.5H15.5V5.4C17.9 7.4 19.1 9.5 18.7 11.7L12 19.6L5.3 11.7C4.9 9.5 6.1 7.4 8.5 5.4Z' +
  'M12 9.2A1.5 1.5 0 1 0 12 12.2A1.5 1.5 0 1 0 12 9.2Z' +
  'M11.55 13.2H12.45L12.08 18.4H11.92Z';
/** The collar where the nib meets the pen. */
export const COLLAR_PATH = 'M8.5 5.4H15.5';
/** The stroke of ink the nib has just written. */
export const STROKE_PATH = 'M3.5 22.2C6.2 20.6 8.6 20.6 11.2 21.6C13.8 22.6 16.6 22.4 20.5 20.4';

export const LOGO_PATHS = (
  <>
    <path d={NIB_PATH} fill="currentColor" fillRule="evenodd" />
    <path d={COLLAR_PATH} stroke="var(--logo-cut, rgba(0,0,0,0.28))" strokeWidth="0.9" />
    <path d={STROKE_PATH} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </>
);

export function Logo({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} className="logo">
      {LOGO_PATHS}
    </svg>
  );
}

/** The name as a wordmark: "Pen" and "Ink" in the interface face, a small italic "to" between. */
export function Wordmark({ name = 'Pen to Ink' }: { name?: string }) {
  const m = /^(.*?)\s+(to)\s+(.*)$/i.exec(name);
  if (!m) return <span className="wordmark">{name}</span>;
  return (
    <span className="wordmark">
      <span>{m[1]}</span> <em>{m[2]}</em> <span>{m[3]}</span>
    </span>
  );
}
