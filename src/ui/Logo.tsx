// The Narrative Bridge mark: an open book whose leaves form the deck of a bridge, arched over a
// river. Drawn with currentColor so it takes the colour of its surroundings (gilt on the cover
// band, ink on the page).

export const LOGO_PATHS = (
  <>
    {/* the open book: two curved leaves with page thickness, which also form the bridge deck */}
    <path d="M2 13.4 C 5.6 10.4, 9.4 10, 12 11.6 C 14.6 10, 18.4 10.4, 22 13.4 V 15.2 C 18.4 12.4, 14.6 12.2, 12 13.8 C 9.4 12.2, 5.6 12.4, 2 15.2 Z" fill="currentColor" />
    {/* the arch and piers beneath */}
    <path d="M5 20.6 C 6.4 16.6, 9.2 14.6, 12 14.4 C 14.8 14.6, 17.6 16.6, 19 20.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M3 14.6 V 20.6 M21 14.6 V 20.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    {/* the river */}
    <path d="M2.5 22.6 C 5 21.8, 7 23.2, 9.5 22.6 C 12 22, 14 23.2, 16.5 22.6 C 18.5 22.1, 20 22.8, 21.5 22.6" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
  </>
);

export function Logo({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} className="logo">
      {LOGO_PATHS}
    </svg>
  );
}
