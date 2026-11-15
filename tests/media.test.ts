import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analyzer';
import { ADAPTERS } from '../src/core/export';
import { processProject } from '../src/core/pipeline';
import { SAMPLES } from '../src/samples';
import { build } from './helpers';

describe('dialogue audio', () => {
  const withClip = async () => {
    const { project } = await build(SAMPLES.find((x) => x.id === 'archive')!.text, 'a.md', 'structured');
    const line = project.passages[0].content.find((b) => b.type === 'dialogue')!;
    if (line.type !== 'dialogue') throw new Error();
    line.audio = { id: 'vo_mira_1', name: 'take1.wav', mime: 'audio/wav', durationMs: 1200 };
    project.characters[0].voice = { voiceName: 'Samantha', rate: 1.2, pitch: 0.75 };
    return processProject(project);
  };

  it('encodes a valid mono 16-bit WAV', async () => {
    const { encodeWav } = await import('../src/core/audio');
    const wav = encodeWav([new Float32Array([0, 0.5, -0.5, 1]), new Float32Array([0, 0.5, -0.5, -1])], 22050);
    const v = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(22050);
    expect(v.getUint32(40, true)).toBe(8); // 4 samples × 2 bytes
    expect(v.getInt16(46, true)).toBe(Math.round(0.5 * 0x7fff)); // averaged channels
    expect(v.getInt16(50, true)).toBe(0); // 1 and -1 mixed to silence
  });

  it('tags clipped lines in Ink and ships the clip with every export', async () => {
    const story = await withClip();
    expect(story.generated.ink).toContain('#audio:vo_mira_1.wav');
    expect(story.compile.ok).toBe(true);
    const bytes = new Uint8Array([82, 73, 70, 70]);
    const audio = { vo_mira_1: { mime: 'audio/wav', bytes } };
    for (const engine of ['unity', 'unreal'] as const) {
      const a = ADAPTERS[engine];
      const r = await a.export(story, { engine, projectName: 'A', engineVersion: a.defaultEngineVersion, integrationRef: 'v1.0.0', includeDemo: true, audio });
      const clip = r.files.find((f) => f.path.endsWith('vo_mira_1.wav'))!;
      expect(clip.content).toBe(bytes);
      expect(clip.path).toContain(engine === 'unity' ? 'Runtime/Resources/NarrativeBridge/a/Audio/' : 'StorySource/VoiceClips/');
      expect(r.report.errors).toEqual([]);
    }
    const missing = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'A', engineVersion: '6000.0', integrationRef: 'v1.0.0', includeDemo: true });
    expect(missing.report.warnings.join(' ')).toContain('take1.wav');
    const { buildPlayableHtml } = await import('../src/core/export');
    const html = buildPlayableHtml(story, 'window.inkjs={};', audio);
    expect(html).toContain('"vo_mira_1.wav":"data:audio/wav;base64,UklGRg=="');
    expect(html).toContain('"voiceName":"Samantha"');
  });
});

describe('scene pictures and recordings', () => {
  const src = '@passage hall Hall\nThe hall is dark.\n\nMIRA: Who is there?\n\nTOMAS: Only me.\n-> room\n@passage room Room\n@end\n';
  const png = { mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) };

  it('tags the first line of a scene with its picture and ships it in every export', async () => {
    const { buildPlayableHtml } = await import('../src/core/export');
    const { project } = await build(src, 'p.md', 'structured');
    project.passages[0].image = { id: 'img_hall_1', name: 'hall.png', mime: 'image/png', width: 4, height: 3, alt: 'A dark hall' };
    const story = processProject(project);
    expect(story.compile.ok).toBe(true);
    expect(story.generated.ink).toMatch(/^The hall is dark\. #image:img_hall_1\.png$/m);
    // Re-importing that Ink keeps the story and does not count the tag as something it lost.
    const { inkUnsupported } = await import('../src/core/parsing/ink');
    expect(inkUnsupported(story.generated.ink)).toEqual([]);
    const opts = { engineVersion: '6000.0', integrationRef: 'v1.2.3', includeDemo: true, images: { img_hall_1: png } };
    const unity = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'P', ...opts });
    expect(unity.files.map((f) => f.path)).toContain('com.narrativebridge.p/Runtime/Resources/NarrativeBridge/p/Images/img_hall_1.png.bytes');
    expect(unity.report.warnings.filter((w) => /picture/.test(w))).toEqual([]);
    const unreal = await ADAPTERS.unreal.export(story, { engine: 'unreal', projectName: 'P', ...opts, engineVersion: '5.7' });
    expect(unreal.files.map((f) => f.path)).toContain('P/Content/NarrativeBridge/Data/Images/img_hall_1.png');
    const missing = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'P', ...opts, images: {} });
    expect(missing.report.warnings).toContain('Scene picture "hall.png" is missing from this browser, so it was left out of the package.');
    const html = buildPlayableHtml(story, '/* runtime */', {}, { img_hall_1: png });
    const pictures = JSON.parse(/<script id="story-pictures" type="application\/json">([^<]*)<\/script>/.exec(html)![1]);
    expect(pictures['img_hall_1.png']).toEqual({ src: 'data:image/png;base64,iVBORw==', alt: 'A dark hall' });
  });

  it('warns when a picture has no line of text to open it', async () => {
    const { project } = await build(src, 'p.md', 'structured');
    project.passages[1].image = { id: 'img_room', name: 'room.png', mime: 'image/png' };
    expect(analyze(project).diagnostics.filter((d) => d.code === 'IMAGE_WITHOUT_TEXT').map((d) => d.entityId)).toEqual(['room']);
  });

  it('matches recording files to lines by the script\'s clip name, an existing clip, or the row number', async () => {
    const { buildRecordingScript, matchRecordings } = await import('../src/core/export');
    const { project } = await build(src, 'p.md', 'structured');
    const kinds = project.passages[0].content.map((b) => b.type);
    expect(kinds).toEqual(['action', 'dialogue', 'dialogue']);
    // Clips are numbered by the passage's dialogue lines, so the narration before them leaves no gap.
    const csv = buildRecordingScript(project);
    expect(csv).toContain('hall_001.wav');
    expect(csv).toContain('hall_002.wav');
    expect(csv).not.toContain('hall_003.wav');
    // A file named from an older recording script (numbered with the narration) still finds its line.
    expect(matchRecordings(project, ['hall_003.wav']).matched.map((m) => m.index)).toEqual([2]);
    project.passages[0].content[2] = { ...(project.passages[0].content[2] as Extract<(typeof project.passages)[0]['content'][number], { type: 'dialogue' }>), audio: { id: 'vo_tomas_ab12', name: 'old.wav', mime: 'audio/wav' } };
    const r = matchRecordings(project, ['HALL_001.WAV', 'vo_tomas_ab12.mp3', 'notes.wav', '2.wav', '01.ogg']);
    expect(r.matched.map((m) => [m.file, m.passageId, m.index])).toEqual([
      ['HALL_001.WAV', 'hall', 1],
      ['vo_tomas_ab12.mp3', 'hall', 2],
    ]);
    // "2.wav" is the second line, already matched; "01.ogg" is the first, already matched too.
    expect(r.unmatched).toEqual(['notes.wav', '2.wav', '01.ogg']);
  });
});

describe('story files', () => {
  it('lists every file put into a story, with names to save them under and unique zip paths', async () => {
    const { storyFiles, zipPaths, safeFileName } = await import('../src/core/files');
    const { project } = await build('@passage hall Hall\nThe hall is dark.\n\nMIRA: Who is there?\n\nMIRA: Hello?\n@end\n', 'scene one.md', 'structured');
    project.sources.push({ ...project.sources[0], id: 'pdf', fileName: 'Draft 2.pdf', format: 'fountain', text: 'INT. HALL' });
    const lines = project.passages[0].content.filter((b) => b.type === 'dialogue');
    (lines[0] as { audio?: unknown }).audio = { id: 'vo_a', name: 'take1.wav', mime: 'audio/wav' };
    (lines[1] as { audio?: unknown }).audio = { id: 'vo_b', name: 'take1.wav', mime: 'audio/wav' };
    project.passages[0].image = { id: 'img_hall', name: 'hall.png', mime: 'image/png' };
    project.characters[0].portrait = { id: 'img_mira', name: 'mira face.jpg', mime: 'image/jpeg' };
    const files = storyFiles(project);
    expect(files.map((f) => [f.kind, f.fileName])).toEqual([
      ['script', 'scene one.md'],
      ['script', 'Draft 2.fountain'],
      ['picture', 'hall.png'],
      ['recording', 'take1.wav'],
      ['recording', 'take1.wav'],
      ['portrait', 'mira face.jpg'],
    ]);
    expect(files[1]).toMatchObject({ convertedFrom: 'pdf', text: 'INT. HALL' });
    expect(files[3].context).toContain('Who is there?');
    expect(zipPaths(files)).toEqual(['Scripts/scene one.md', 'Scripts/Draft 2.fountain', 'Scene pictures/hall.png', 'Recordings/take1.wav', 'Recordings/take1 (2).wav', 'Portraits/mira face.jpg']);
    expect(safeFileName('a/b:c?.wav')).toBe('a_b_c_.wav');
  });
});

describe('recording sessions', () => {
  it('reads and writes times', async () => {
    const { formatTime, parseTime } = await import('../src/core/session');
    expect([formatTime(0), formatTime(75.5), formatTime(3723.4)]).toEqual(['0:00.00', '1:15.50', '1:02:03.40']);
    expect(['1:15.5', '75.5', '1:02:03.4', '1:15,5', 'abc', '1:75', ''].map(parseTime)).toEqual([75.5, 75.5, 3723.4, 75.5, null, null, null]);
  });

  it('finds the takes in a session and gives them to lines in order, cutting them cleanly', async () => {
    const { detectSegments, assignInOrder, cutSamples } = await import('../src/core/session');
    const rate = 8000;
    // Quiet room tone, with three spoken takes at 1–2 s, 3–3.6 s and 5–6.5 s, and a click at 4.3 s (too short to be a take).
    const s = new Float32Array(rate * 8);
    for (let i = 0; i < s.length; i++) s[i] = Math.sin(i * 12.9898) * 0.002;
    const speak = (a: number, b: number) => {
      for (let i = a * rate; i < b * rate; i++) s[i] = Math.sin(i / 3) * 0.5;
    };
    speak(1, 2);
    speak(3, 3.6);
    speak(5, 6.5);
    for (let i = 4.3 * rate; i < 4.3 * rate + 40; i++) s[i] = 0.6;
    const takes = detectSegments(s, rate);
    expect(takes).toHaveLength(3);
    takes.forEach((t, i) => {
      const [a, b] = [[1, 2], [3, 3.6], [5, 6.5]][i];
      expect(t.start).toBeGreaterThan(a - 0.2);
      expect(t.start).toBeLessThanOrEqual(a);
      expect(t.end).toBeGreaterThanOrEqual(b);
      expect(t.end).toBeLessThan(b + 0.2);
    });
    // A long minimum pause joins takes that are close together.
    expect(detectSegments(s, rate, { minGap: 1.5 }).length).toBeLessThan(3);
    expect(assignInOrder(['a', 'b'], takes)).toEqual({ a: takes[0], b: takes[1] });
    const cut = cutSamples(s, rate, { start: 1, end: 2 });
    expect(cut.length).toBe(rate);
    expect(Math.abs(cut[0])).toBe(0); // faded in
    expect(detectSegments(new Float32Array(rate), rate)).toEqual([]);
  });

  it('lists the lines in recording-script order with where their clips came from', async () => {
    const { sessionLines, clipName } = await import('../src/core/session');
    const { project } = await build('@passage hall Hall\nThe hall is dark.\n\nMIRA: Who is there?\n\nTOMAS: Only me.\n@end\n', 'p.md', 'structured');
    const second = project.passages[0].content.filter((b) => b.type === 'dialogue')[1] as { audio?: unknown };
    second.audio = { id: 'vo_x', name: 'x.wav', mime: 'audio/wav', from: { session: 'ses_1', start: 3, end: 4.5 } };
    const lines = sessionLines(project);
    expect(lines.map((l) => [l.number, l.speaker, l.text, l.from?.start])).toEqual([
      [1, 'MIRA', 'Who is there?', undefined],
      [2, 'TOMAS', 'Only me.', 3],
    ]);
    expect(lines[0].slot).toMatch(/^hall_\d{3}$/);
    expect(clipName({ id: 'ses_1', name: 'Mira day 1.wav', mime: 'audio/wav' }, { start: 62.5, end: 65.1 })).toBe('Mira day 1 1.02.50–1.05.10.wav');
  });
});

describe('non-destructive clips', () => {
  it('trims, fades and changes gain without touching the source', async () => {
    const { applyEdit, hasEdit, isRendered, audioFileName } = await import('../src/core/audio');
    const rate = 1000;
    const src = new Float32Array(rate).fill(0.5); // one second
    expect(applyEdit(src, rate)).toEqual(src);
    const out = applyEdit(src, rate, { trimStart: 0.1, trimEnd: 0.2, fadeIn: 0.1, fadeOut: 0.1, gain: 6 });
    expect(out.length).toBe(700);
    expect(src[0]).toBe(0.5); // the source is unchanged
    expect(out[0]).toBe(0); // fades in from silence
    expect(out[350]).toBeCloseTo(0.5 * Math.pow(10, 6 / 20), 3); // +6 dB in the middle
    expect(out[699]).toBe(0); // and fades out
    expect(applyEdit(src, rate, { gain: 30 })[10]).toBe(1); // never clips past full scale
    expect([hasEdit({}), hasEdit({ gain: 0 }), hasEdit({ fadeIn: 0.2 })]).toEqual([false, false, true]);
    // A clip plays from its own file until it's a region or edited; then it's rendered as WAV.
    expect(audioFileName({ id: 'vo_a', mime: 'audio/mpeg' })).toBe('vo_a.mp3');
    expect(audioFileName({ id: 'vo_a', mime: 'audio/mpeg', edit: { fadeOut: 0.5 } })).toBe('vo_a.wav');
    expect(isRendered({ region: true })).toBe(true);
  });

  it('exports a region or edited clip under its WAV name in the Ink and the package', async () => {
    const { project } = await build('@passage hall Hall\nMIRA: Who is there?\n@end\n', 'r.md', 'structured');
    const line = project.passages[0].content.find((b) => b.type === 'dialogue') as { audio?: unknown };
    line.audio = { id: 'vo_mira_x', name: 'Session 0.01.00–0.02.00.wav', mime: 'audio/wav', from: { session: 'ses_1', start: 1, end: 2 }, region: true };
    const story = processProject(project);
    expect(story.generated.ink).toContain('#audio:vo_mira_x.wav');
    const wav = { mime: 'audio/wav', bytes: new Uint8Array([82, 73, 70, 70]) };
    const r = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'R', engineVersion: '6000.0', integrationRef: 'v1.2.3', includeDemo: true, audio: { vo_mira_x: wav } });
    expect(r.files.some((f) => f.path.endsWith('Audio/vo_mira_x.wav'))).toBe(true);
  });
});

describe('cue sounds', () => {
  const withSounds = async () => {
    const { project } = await build('@passage hall Hall\n@cue music calm\nThe hall is dark.\n@cue sound door\n@cue shake\n@passage yard Yard\n@cue music calm\nRain.\n@cue music\n@end\n', 'c.md', 'structured');
    return project;
  };

  it('knows what each cue does and where the music stands', async () => {
    const { cueKind, cuesIn, backgroundAfter, cueWantsSound } = await import('../src/core/cues');
    expect(['music', 'stop_music', 'ambience', 'stop_ambience', 'shake', 'door_slam', 'song'].map(cueKind)).toEqual(['music', 'stop_music', 'ambience', 'stop_ambience', 'shake', 'sound', 'music']);
    expect(cuesIn(['speaker:mira', 'audio:x.wav', 'music:calm', 'transition', 'shake', 'image:a.png'])).toEqual([
      { name: 'music', value: 'calm', tag: 'music:calm' },
      { name: 'shake', value: '', tag: 'shake' },
    ]);
    const has = (t: string) => ['music:calm', 'music:storm', 'ambience:rain'].includes(t);
    const cues = cuesIn(['music:calm', 'ambience:rain', 'music:unknown', 'sound:door']);
    expect(backgroundAfter(cues, has)).toEqual({ music: 'music:calm', ambience: 'ambience:rain' }); // a track with no sound changes nothing
    expect(backgroundAfter([...cues, ...cuesIn(['music', 'stop_ambience'])], has)).toEqual({ music: null, ambience: null });
    expect([cueWantsSound('music', ''), cueWantsSound('music', 'calm'), cueWantsSound('shake', '1'), cueWantsSound('door', '')]).toEqual([false, true, false, true]);
  });

  it('shares a sound among cues with the same tag, and ships it everywhere', async () => {
    const { setCueSound, cueSounds, cuesWithTag } = await import('../src/core/cues');
    const { referencedAudio } = await import('../src/core/audio');
    const { storyFiles } = await import('../src/core/files');
    const { buildPlayableHtml } = await import('../src/core/export');
    const project = await withSounds();
    const calm = { id: 'cue_calm', name: 'calm.mp3', mime: 'audio/mpeg' };
    expect(cuesWithTag(project, 'music:calm')).toBe(2);
    setCueSound(project, 'music:calm', calm);
    setCueSound(project, 'sound:door', { id: 'cue_door', name: 'door.wav', mime: 'audio/wav' });
    expect(project.passages.flatMap((p) => p.content).filter((b) => b.type === 'cue' && b.audio?.id === 'cue_calm')).toHaveLength(2);
    expect([...cueSounds(project).keys()]).toEqual(['music:calm', 'sound:door']);
    expect(referencedAudio(project).map((a) => a.id)).toEqual(['cue_calm', 'cue_door']);
    expect(storyFiles(project).filter((f) => f.kind === 'cue sound').map((f) => f.fileName)).toEqual(['calm.mp3', 'door.wav']);
    const story = processProject(project);
    const audio = { cue_calm: { mime: 'audio/mpeg', bytes: new Uint8Array([1, 2]) }, cue_door: { mime: 'audio/wav', bytes: new Uint8Array([3]) } };
    const html = buildPlayableHtml(story, '/* ink */', audio);
    const meta = JSON.parse(/<script id="story-meta" type="application\/json">([^<]*)<\/script>/.exec(html)?.[1] ?? '{}');
    expect(meta.cueSounds).toEqual({ 'music:calm': 'cue_calm.mp3', 'sound:door': 'cue_door.wav' });
    expect(meta.hasClips).toBe(false); // cue sounds alone don't turn voices on
    expect(html).toContain('"cue_calm.mp3":"data:audio/mpeg;base64,');
    const r = await ADAPTERS.unity.export(story, { engine: 'unity', projectName: 'Hall', engineVersion: '6000.3.23f1', integrationRef: '2.0.0', includeDemo: true, audio });
    const info = r.files.find((f) => f.path.endsWith('Runtime/StoryInfo.cs'))!.content as string;
    expect(info).toContain('CueSoundTags = { "music:calm", "sound:door" }');
    expect(info).toContain('CueSoundFiles = { "cue_calm.mp3", "cue_door.wav" }');
    expect(r.files.some((f) => f.path.endsWith('Resources/NarrativeBridge/hall/Audio/cue_calm.mp3'))).toBe(true);
    setCueSound(project, 'music:calm', undefined);
    expect(cueSounds(project).has('music:calm')).toBe(false);
  });
});
