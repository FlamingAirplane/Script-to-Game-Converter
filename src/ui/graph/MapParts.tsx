

export function EdgeLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const label = text.length > 34 ? `${text.slice(0, 33)}…` : text;
  const w = label.length * 6.6 + 16;
  return (
    <g className="edge-label" transform={`translate(${x - w / 2},${y - 11})`} pointerEvents="none">
      <rect width={w} height={22} rx={3} />
      <text x={w / 2} y={15} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

/** Decorative compass rose, pinned to the frame's corner (outside the panned drawing, so it never clips). */
export function Compass() {
  return (
    <svg className="compass" viewBox="-40 -54 80 94" width="58" height="68" aria-hidden>
      <circle r="30" className="compass-ring" />
      <circle r="24" className="compass-ring thin" />
      <path d="M0 -36 L6 0 L0 36 L-6 0 Z" className="compass-ns" />
      <path d="M-36 0 L0 -6 L36 0 L0 6 Z" className="compass-ew" />
      <text y="-42" textAnchor="middle" className="compass-n">
        N
      </text>
    </svg>
  );
}

export type TagKind = 'start' | 'ending' | 'unreachable';
const TAG_LABEL: Record<TagKind, string> = { start: 'Start', ending: 'Ending', unreachable: 'Can’t be reached' };
export const tagWidth = (kind: TagKind) => Math.round(TAG_LABEL[kind].length * 6.2 + 18);

/** A plain-word tag pinned to the top edge of a passage card. */
export function NodeTag({ kind, x, y = -9 }: { kind: TagKind; x: number; y?: number }) {
  const w = tagWidth(kind);
  return (
    <g className={`node-tag tag-${kind}`} transform={`translate(${x},${y})`}>
      <rect width={w} height={18} rx={9} />
      <text x={w / 2} y={12.5} textAnchor="middle">
        {TAG_LABEL[kind]}
      </text>
    </g>
  );
}

/** Small sign at the middle of a route: a padlock (needs an item or value), ! (forced) or ◆ (suggested, waiting for approval). */
export function RouteSign({ kind, x, y }: { kind: 'cond' | 'pending' | 'forced'; x: number; y: number }) {
  return (
    <g className={`route-sign ${kind}`} transform={`translate(${x},${y})`} pointerEvents="none">
      <circle r={9.5} />
      {kind === 'forced' ? (
        <text y={4} textAnchor="middle" className="sign-mark">
          !
        </text>
      ) : kind === 'cond' ? (
        <>
          <path d="M-3.2 -0.5 V-3 A3.2 3.2 0 0 1 3.2 -3 V-0.5" className="sign-line" />
          <rect x={-4.6} y={-0.8} width={9.2} height={6.6} rx={1.3} className="sign-fill" />
        </>
      ) : (
        <path d="M0 -4.8 L4.8 0 L0 4.8 L-4.8 0 Z" className="sign-fill" />
      )}
    </g>
  );
}

/** How many Continue breaks a passage has, pinned to its card's bottom edge (decorative: the card's text says it). */
export function BreakSign({ count, x, y, exit }: { count: number; x: number; y: number; exit?: boolean }) {
  const label = `${exit ? '⇥' : '⏸'} ${count}`;
  const w = label.length * 6.4 + 12;
  return (
    <g className={exit ? 'break-sign exit-sign' : 'break-sign'} transform={`translate(${x},${y})`} aria-hidden pointerEvents="none">
      <rect width={w} height={17} rx={8.5} />
      <text x={w / 2} y={12.5} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

/** The map's key, in plain words, drawn with the same marks as the map. */
export function MapKey({ hiddenGated }: { hiddenGated: number }) {
  const line = (kind: string, sign?: 'cond' | 'pending' | 'forced') => (
    <svg width="58" height="20" aria-hidden>
      <path d="M2 10 H50" className={`edge ${kind}`} markerEnd={`url(#arrow-${kind})`} />
      {sign && <RouteSign kind={sign} x={26} y={10} />}
    </svg>
  );
  const tag = (kind: TagKind) => (
    <svg width={tagWidth(kind) + 2} height="20" aria-hidden>
      <NodeTag kind={kind} x={1} y={1} />
    </svg>
  );
  return (
    <ul className="map-key" aria-label="Map key">
      <li>{tag('start')} the story begins here</li>
      <li>{tag('ending')} the story can end here</li>
      <li>{tag('unreachable')} no route leads here yet</li>
      <li>{line('edge')} a choice</li>
      <li>
        {line('cond', 'cond')} a choice that needs an item or value
        {hiddenGated > 0 && <span className="muted"> ({hiddenGated} locked route{hiddenGated === 1 ? '' : 's'} hidden; press “Locked routes” to see them)</span>}
      </li>
      <li>{line('forced', 'forced')} a forced choice: once its condition holds, the only way on</li>
      <li>{line('fallback')} continues on its own</li>
      <li>
        <svg width="58" height="20" aria-hidden>
          <path d="M2 10 H22" className="edge loop" markerEnd="url(#arrow-fallback)" />
          <text x={26} y={14} className="edge-end loop">↩</text>
        </svg>{' '}
        loops back to an earlier passage (click it to go there)
      </li>
      <li>{line('pending', 'pending')} suggested, waiting for your OK</li>
      <li>
        <svg width="40" height="20" aria-hidden>
          <BreakSign count={2} x={2} y={1} />
        </svg>{' '}
        Continue breaks inside the passage
      </li>
      <li>
        <svg width="40" height="20" aria-hidden>
          <BreakSign count={1} x={2} y={1} exit />
        </svg>{' '}
        exits to the game (gameplay takes over)
      </li>
    </ul>
  );
}
