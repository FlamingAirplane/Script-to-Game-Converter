import { describe, expect, it } from 'vitest';
import { processProject } from '../src/core/pipeline';
import { build } from './helpers';

describe('story map arrows', () => {
  const card = (x: number, y: number) => ({ x, y, w: 188, h: 56 });
  it('goes around cards in the way and uses the sides that face each other', async () => {
    const { routeEdges, routeHits } = await import('../src/core/edgeRouting');
    // A and B in a row with C between them; D straight below A.
    const cards = new Map([['a', card(0, 0)], ['c', card(300, 0)], ['b', card(600, 0)], ['d', card(0, 300)]]);
    const routes = routeEdges(cards, [
      { id: 'ab', from: 'a', to: 'b' },
      { id: 'ad', from: 'a', to: 'd' },
      { id: 'db', from: 'd', to: 'b' },
    ]);
    expect(routeHits(routes.get('ab')!, cards.get('c')!)).toBe(false);
    expect([routes.get('ad')!.fromSide, routes.get('ad')!.toSide]).toEqual(['bottom', 'top']);
  });

  it('spreads arrows that share a side, in the order of where they go', async () => {
    const { routeEdges } = await import('../src/core/edgeRouting');
    const cards = new Map([['a', card(0, 200)], ['b', card(400, 0)], ['c', card(400, 200)], ['d', card(400, 400)]]);
    const routes = routeEdges(cards, ['b', 'c', 'd'].map((t) => ({ id: t, from: 'a', to: t })));
    const starts = ['b', 'c', 'd'].map((t) => routes.get(t)!).map((r) => r.d.match(/^M(-?[\d.]+),(-?[\d.]+)/)!.slice(1).map(Number));
    expect(new Set(starts.map((s) => s.join(','))).size).toBe(3);
    // All leave by the right side, top to bottom in the order of their targets.
    expect(starts.every((s) => s[0] === 188)).toBe(true);
    expect(starts[0][1]).toBeLessThan(starts[1][1]);
    expect(starts[1][1]).toBeLessThan(starts[2][1]);
    const self = routeEdges(cards, [{ id: 'loop', from: 'a', to: 'a' }]).get('loop')!;
    expect(self.d).toMatch(/^M188,/);
  });
});

describe('readable story maps', () => {
  // A short branching story: a choice in the hall leads on directly or by way of a detour; a loop goes back.
  const story = `@start hall

@passage hall Hall

INT. HALL - NIGHT

The hall.

* [Go straight to the attic] -> attic
* [Take the stairs] -> stairs

@passage stairs Stairs

The stairs.

-> landing

@passage landing Landing

The landing.

* [Go up] -> attic
* [Go back down] -> hall

@passage attic Attic

INT. ATTIC - NIGHT

The attic.

* [Leave] -> roof

@passage roof Roof

The roof.

@end
`;
  const load = async () => {
    const { project } = await build(story, 'story.md', 'structured');
    return { project, graph: processProject(project, [], { skipSmoke: true }).analysis.graph };
  };

  it('puts each passage after everything that leads into it, and loops back become stubs', async () => {
    const { storyLayout, loopRoutes } = await import('../src/core/layout');
    const { graph } = await load();
    const pos = storyLayout(graph, 'hall');
    const col = (id: string) => pos.get(id)!.x;
    // The attic comes after the landing (its longest way in), not beside the stairs (its shortest).
    expect(col('hall') < col('stairs') && col('stairs') < col('landing') && col('landing') < col('attic') && col('attic') < col('roof')).toBe(true);
    expect([...loopRoutes(graph, 'hall')]).toEqual(['landing>hall']);
    // Every other route goes forward.
    for (const e of graph.edges) if (e.from !== 'landing' || e.to !== 'hall') expect(col(e.to)).toBeGreaterThan(col(e.from));
    // The same story always gets the same map.
    expect([...storyLayout(graph, 'hall')]).toEqual([...pos]);
  });

  it('groups passages into scenes and folds a scene into one card', async () => {
    const { sceneGroups, foldGraph } = await import('../src/core/scenes');
    const { project, graph } = await load();
    const groups = sceneGroups(project);
    expect(groups.map((g) => [g.id, g.members])).toEqual([
      ['hall', ['hall', 'stairs', 'landing']],
      ['attic', ['attic', 'roof']],
    ]);
    const { graph: f, of } = foldGraph(graph, groups, new Set(['hall']));
    expect(f.nodes.map((n) => n.id)).toEqual(['scene:hall', 'attic', 'roof']);
    expect(f.nodes[0]).toMatchObject({ title: 'Hall (3 passages)', isStart: true });
    expect(of.get('landing')).toBe('scene:hall');
    // Routes inside the scene are left out; the two ways into the attic become one.
    expect(f.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['scene:hall>attic', 'attic>roof']);
    expect(foldGraph(graph, groups, new Set()).graph).toBe(graph);
  });

  it('traces every way from the start to a passage', async () => {
    const { traceRoutes } = await import('../src/core/scenes');
    const { graph } = await load();
    const t = traceRoutes(graph.edges, 'hall', 'attic');
    expect([...t.nodes].sort()).toEqual(['attic', 'hall', 'landing', 'stairs']);
    expect(t.edges.size).toBe(5); // both ways to the attic, and the loop back that can still reach it
    expect(traceRoutes(graph.edges, 'roof', 'hall').nodes.size).toBe(0);
  });
});

describe('story outline', () => {
  it('finds where a choice\'s branches meet again, so the outline carries on from there', async () => {
    const { meetingPoints } = await import('../src/ui/StoryOutline');
    const { project } = await build(
      `@start alley

@passage alley Alley

The alley.

* [Gate] -> gate
* [Ear] -> ear

@passage gate Gate

The gate.

-> night

@passage ear Ear

The ear.

-> night

@passage night Night

The night.

* [Stay] -> stay
* [Run] -> run

@passage stay Stay

You stay.

@end

@passage run Run

You run.

@end
`,
      'story.md',
      'structured',
    );
    // The alley's two branches meet at the night; the night's never meet again (each ends).
    expect([...meetingPoints(project)]).toEqual([['alley', 'night']]);
  });
});
