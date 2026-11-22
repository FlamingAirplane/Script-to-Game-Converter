import type { StoryGraph } from '../../core/analyzer';
import { CARD, type Position } from '../../core/layout';
import { isGroupNode, type SceneGroup } from '../../core/scenes';
import { BreakSign, NodeTag, tagWidth, type TagKind } from './MapParts';

const { W, H } = CARD;

/** The passage cards (and folded scenes): title, id, tags and break signs, with keyboard and hover behaviour. */
export function MapNodes({
  graph,
  placed,
  lit,
  groups,
  sceneOf,
  endingsReached,
  breaks,
  exits,
  selected,
  matches,
  dragging,
  setHover,
  unfold,
  onOpen,
  inspect,
}: {
  graph: StoryGraph;
  placed: Map<string, Position>;
  lit: { nodes: Set<string>; edges: Set<string> } | null;
  groups: SceneGroup[];
  /** The scene each passage is in (an index into groups). */
  sceneOf: Map<string, number>;
  endingsReached?: Record<string, number>;
  breaks: Map<string, number>;
  exits: Map<string, string[]>;
  /** The passage selected on the map. */
  selected?: string;
  /** Passages the search found. */
  matches: string[];
  /** The card being dragged. */
  dragging: { id: string } | null;
  setHover: (id: string | null) => void;
  unfold: (nodeId: string) => void;
  onOpen: (id: string) => void;
  inspect: (id: string) => void;
}) {
  return (
    <>
      {graph.nodes.map((n) => {
        const p = placed.get(n.id)!;
        const reached = endingsReached?.[n.id];
        const tags: TagKind[] = [
          ...(n.isStart ? ['start' as const] : []),
          ...(n.isEnding ? ['ending' as const] : []),
          ...(n.reachable ? [] : ['unreachable' as const]),
        ];
        const out = graph.edges.filter((e) => e.from === n.id && !e.pending).length;
        const group = isGroupNode(n.id);
        const scene = sceneOf.get(group ? n.id.slice(6) : n.id);
        const about = [
          group ? 'A folded scene: click to unfold it.' : '',
          n.isStart ? 'The story begins here.' : '',
          n.isEnding ? 'The story can end here.' : '',
          n.reachable ? '' : 'No route leads here yet.',
          out ? `${out} route${out === 1 ? '' : 's'} lead${out === 1 ? 's' : ''} on.` : '',
          reached ? `Reached in ${reached} automated test play${reached === 1 ? '' : 's'}.` : '',
          breaks.get(n.id) ? `${breaks.get(n.id)} Continue break${breaks.get(n.id) === 1 ? '' : 's'}.` : '',
          exits.get(n.id)?.length ? `Exits to the game: ${exits.get(n.id)!.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join(' ');
        let tagX = 10;
        return (
          <g
            key={n.id}
            data-id={n.id}
            className={`node ${group ? 'folded' : ''} ${lit && !lit.nodes.has(n.id) ? 'dim' : ''} ${n.isStart ? 'start' : ''} ${n.isEnding ? 'ending' : ''} ${n.reachable ? '' : 'unreachable'} ${selected === n.id ? 'selected' : ''} ${matches.includes(n.id) ? 'match' : ''} ${dragging?.id === n.id ? 'dragging' : ''} origin-${n.origin}`}
            transform={`translate(${p.x},${p.y})`}
            onKeyDown={(e) => {
              if (group && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                unfold(n.id);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                onOpen(n.id);
              } else if (e.key === ' ') {
                e.preventDefault();
                inspect(n.id);
              }
            }}
            onDoubleClick={() => !group && onOpen(n.id)}
            onFocus={() => setHover(n.id)}
            onBlur={() => setHover(null)}
            tabIndex={0}
            role="button"
            aria-description={about}
            onPointerEnter={() => setHover(n.id)}
            onPointerLeave={() => setHover(null)}
          >
            <title>
              {group
                ? `${n.title} — ${about}`
                : `${n.title}${about ? ` — ${about}` : ''}${scene !== undefined && groups.length > 1 ? ` Scene: ${groups[scene].title}.` : ''} Click to see its lines, double-click to edit, drag to move.`}
            </title>
            <rect width={W} height={H} rx={3} />
            <rect x={3} y={3} width={W - 6} height={H - 6} rx={2} className="node-inner" />
            {scene !== undefined && groups.length > 1 && <rect x={0} y={0} width={4} height={H} className={`scene-stripe scene-c${scene % 6}`} />}
            <text x={12} y={tags.length ? 26 : 24} className="node-title">
              {(group ? (groups[scene ?? 0]?.title ?? n.title) : n.title).replace(/^(.{23}).+$/, '$1…')}
            </text>
            <text x={12} y={tags.length ? 43 : 41} className="node-id">
              {group ? `${groups[scene ?? 0]?.members.length ?? ''} passages folded · click to open` : n.id.length > 26 ? n.id.slice(0, 25) + '…' : n.id}
            </text>
            {tags.map((t) => {
              const x = tagX;
              tagX += tagWidth(t) + 5;
              return <NodeTag key={t} kind={t} x={x} />;
            })}
            {!!breaks.get(n.id) && <BreakSign count={breaks.get(n.id)!} x={W - 46} y={H - 9} />}
            {!!exits.get(n.id)?.length && <BreakSign count={exits.get(n.id)!.length} x={breaks.get(n.id) ? W - 92 : W - 46} y={H - 9} exit />}
          </g>
        );
      })}
    </>
  );
}
