import type { ProcessedStory } from '../pipeline';
import { audioFileName, bytesToBase64, referencedAudio, type AudioAssets } from '../audio';
import { imageFileName, portraitFiles, referencedImages } from '../images';
import { log } from '../log';
import { EXIT_PREFIX, RESERVED_TAGS } from '../isr';
import { cueSounds } from '../cues';
import { describeCondition } from '../gating';
import { isActive } from '../isr';
import { translationEntries } from './translations';
import { assertExportable, storyVersion } from './common';

// "Playable story" export: one self-contained HTML file (Ink runtime + compiled story + a small
// book-style reader) that anyone can open in a browser to read and play the story. No game engine.
// The Ink runtime source is passed in so this module stays free of bundler- or Node-specific imports:
// the web app imports it with Vite's ?raw, the CLI reads it from node_modules.

/** Makes JavaScript source safe to place inside an inline <script> element. */
function scriptSafe(s: string): string {
  return s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/** Makes JSON safe inside an inline <script>: in JSON, "<" can only occur inside strings, where \u003c is equivalent. */
function jsonSafe(s: string): string {
  return s.replace(/</g, '\\u003c');
}

function htmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function playableFileName(story: ProcessedStory): string {
  return `${story.project.project.id || 'story'}.html`;
}

export function buildPlayableHtml(story: ProcessedStory, inkRuntimeJs: string, audio: AudioAssets = {}, images: AudioAssets = {}): string {
  assertExportable(story);
  const { title, author, id } = story.project.project;
  const runtime = scriptSafe(inkRuntimeJs.replace(/\/\/# sourceMappingURL=.*$/m, ''));
  // Recorded clips are embedded as data URIs keyed by the file name used in #audio tags.
  const clips: Record<string, string> = {};
  for (const ref of referencedAudio(story.project)) {
    const a = audio[ref.id];
    if (a) clips[audioFileName(ref)] = `data:${a.mime};base64,${bytesToBase64(a.bytes)}`;
  }
  // Scene pictures likewise, keyed by the file name used in #image tags, with their descriptions.
  const pictures: Record<string, { src: string; alt: string }> = {};
  for (const ref of referencedImages(story.project)) {
    const a = images[ref.id];
    if (a) pictures[imageFileName(ref)] = { src: `data:${a.mime};base64,${bytesToBase64(a.bytes)}`, alt: ref.alt ?? '' };
  }
  const voices = Object.fromEntries(story.project.characters.filter((c) => c.voice).map((c) => [c.id, c.voice]));
  // The sounds writers attached to cues: cue tag (music:calm) → clip file, for the clips that made it in.
  const cueFiles = Object.fromEntries([...cueSounds(story.project)].map(([tag, ref]) => [tag, audioFileName(ref)]).filter(([, f]) => clips[f]));
  // Translations brought in on the Export page, only for text the story has: language → key → text.
  const t = story.project.translations;
  const keys = new Set(translationEntries(story.project).map((e) => e.key));
  const translations = t
    ? { languages: t.languages, strings: Object.fromEntries(Object.entries(t.strings).filter(([k]) => keys.has(k))) }
    : { languages: [] as string[], strings: {} };
  // Choices that need something, to show greyed out with what they need while the reader lacks it.
  const gated = story.project.passages.flatMap((p) =>
    p.choices.filter((c) => isActive(c.review) && c.conditions.length).map((c) => ({ p: p.id, t: c.text.trim(), needs: c.conditions.map((x) => ({ w: describeCondition(x, story.project), c: x })) })),
  );
  const hasVoiceClips = story.project.passages.some((p) => p.content.some((b) => b.type === 'dialogue' && b.audio && clips[audioFileName(b.audio)]));
  const meta = jsonSafe(
    JSON.stringify({
      title,
      author: author ?? '',
      saveKey: `narrative-bridge.play.${id}`,
      version: storyVersion(story),
      voices,
      hasClips: hasVoiceClips,
      cueSounds: cueFiles,
      storyTags: [...RESERVED_TAGS],
      translations,
      gated,
    }),
  );
  const clipJson = jsonSafe(JSON.stringify(clips));
  const pictureJson = jsonSafe(JSON.stringify(pictures));
  // Character portraits: speaker id (the #speaker tag) → picture file, for characters that have one.
  const portraitJson = jsonSafe(JSON.stringify(Object.fromEntries(Object.entries(portraitFiles(story.project)).filter(([, f]) => pictures[f]))));
  log('export').info('Built playable story', { cueSounds: Object.keys(cueFiles).length, clips: Object.keys(clips).length, pictures: Object.keys(pictures).length, voices: Object.keys(voices).length, storyBytes: story.compile.json!.length });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="generator" content="Narrative Bridge">
<title>${htmlText(title)}</title>
<style>${PLAYER_CSS}</style>
</head>
<body>
<main class="book">
  <section id="cover" class="cover">
    <div class="orn">❦</div>
    <h1 id="title"></h1>
    <p id="author" class="author"></p>
    <div class="rule"></div>
    <div class="cover-actions">
      <button id="resume" class="btn primary" hidden>Continue reading</button>
      <button id="begin" class="btn">Begin</button>
    </div>
    <p class="colophon">An interactive story. Your progress is saved in this browser.</p>
  </section>
  <section id="reader" class="reader" hidden>
    <header class="running-head"><span id="rh-title"></span><span class="tools"><select id="language" aria-label="Language" hidden></select><button id="sounds" class="link" aria-pressed="true">Sounds on</button><button id="voice" class="link" aria-pressed="false">Voices off</button><button id="undo" class="link" disabled>Undo</button><button id="restart" class="link">Start over</button></span></header>
    <p id="notice" class="notice" role="status" hidden></p>
    <div id="text" class="text" aria-live="polite"></div>
    <nav id="choices" class="choices"></nav>
  </section>
</main>
<script>${runtime}</script>
<script id="story-json" type="application/json">${jsonSafe(story.compile.json!)}</script>
<script id="story-meta" type="application/json">${meta}</script>
<script id="story-audio" type="application/json">${clipJson}</script>
<script id="story-pictures" type="application/json">${pictureJson}</script>
<script id="story-portraits" type="application/json">${portraitJson}</script>
<script>${PLAYER_JS}</script>
</body>
</html>
`;
}

const PLAYER_CSS = `
:root{--paper:#fefae0;--ink:#283618;--ink2:#3d4a24;--faded:#5d6440;--rule:#c9b97f;--rubric:#8f4f16;--pen:#606c38;
--serif:'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif}
*{box-sizing:border-box}html,body{margin:0;min-height:100%}
body{background:radial-gradient(ellipse at 50% 0%,#2d3c1a,#1d270f 70%);color:var(--ink);font:18px/1.7 var(--serif);padding:28px 16px;
-webkit-font-smoothing:antialiased;font-variant-numeric:oldstyle-nums}
.book{max-width:720px;margin:0 auto;background:var(--paper);min-height:calc(100vh - 56px);padding:56px 64px 48px;border-radius:2px 4px 4px 2px;
box-shadow:1px 1px 0 #f3ecc9,2px 2px 0 #ddd1a0,3px 3px 0 #f3ecc9,4px 4px 0 #cbbd84,0 18px 40px rgba(0,0,0,.5)}
.cover{text-align:center;padding-top:12vh}.orn{color:var(--rubric);font-size:30px}
h1{font-weight:400;font-size:42px;line-height:1.15;margin:10px 0 6px}.author{font-style:italic;color:var(--ink2);margin:0}
.rule{width:120px;border-top:1px solid var(--rule);margin:30px auto}
.cover-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.colophon{margin-top:40px;font-size:14px;color:var(--faded);font-style:italic}
.btn{font:inherit;font-size:17px;font-variant:small-caps;text-transform:lowercase;letter-spacing:.08em;padding:8px 22px;border:1px solid var(--ink2);
background:transparent;color:var(--ink);border-radius:3px;cursor:pointer}.btn:hover{background:#fffdf1}
.btn.primary{background:var(--ink);color:var(--paper)}.btn.primary:hover{background:var(--rubric);border-color:var(--rubric)}
.running-head{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--rule);padding-bottom:8px;margin-bottom:22px;
font-size:13px;font-variant:small-caps;text-transform:lowercase;letter-spacing:.2em;color:var(--faded)}
.tools{display:flex;gap:14px;letter-spacing:.06em}
.link{background:none;border:0;padding:0;font:inherit;color:var(--pen);cursor:pointer}.link:disabled{color:var(--rule);cursor:default}
.text p{margin:0 0 4px;text-indent:1.4em;text-align:justify;hyphens:auto}
.text>p:first-child{text-indent:0}.text>p:first-child::first-letter{float:left;font-size:3.3em;line-height:.9;padding:4px 8px 0 0;color:var(--rubric)}
.scene{display:block;text-align:center;text-indent:0;font-size:13px;font-variant:small-caps;text-transform:lowercase;letter-spacing:.2em;color:var(--faded);margin:24px 0 10px}
.picture{margin:18px 0 22px;text-align:center}.game-exit{border:1px dashed #2f6458;border-radius:3px;padding:12px 16px;text-align:center}.game-exit p{margin:0 0 10px;font-style:italic}.game-played{text-align:center;color:#2f6458}.dialogue.with-portrait{display:flow-root}.portrait{float:left;width:64px;height:64px;object-fit:cover;border-radius:50%;margin:2px 14px 4px 0;box-shadow:0 1px 4px rgba(40,54,24,.25)}.picture img{max-width:100%;max-height:60vh;border-radius:2px;box-shadow:0 2px 10px rgba(40,54,24,.18)}
.scene:before{content:'❧';display:block;color:var(--rubric);font-size:18px;letter-spacing:0}
.text p.dialogue{text-indent:0;text-align:left;margin:10px 0 10px 2.2em}
.speaker{display:block;font-size:13px;font-variant:small-caps;text-transform:lowercase;letter-spacing:.16em;font-weight:600;color:var(--ink2)}
.paren{display:block;font-style:italic;color:var(--faded);font-size:16px}
.text p.chosen{text-indent:0;text-align:center;font-style:italic;color:var(--pen);margin:14px 0;font-size:16px}
.text p.transition{text-indent:0;text-align:right;font-size:13px;font-variant:small-caps;text-transform:lowercase;letter-spacing:.14em;color:var(--faded)}
.choices{margin-top:22px;border-top:1px solid var(--rule);padding-top:12px;display:flex;flex-direction:column}
.choice{position:relative;text-align:left;font:italic 18px var(--serif);color:var(--ink);background:none;border:0;border-bottom:1px dotted var(--rule);
padding:10px 8px 10px 30px;cursor:pointer}.choice:before{content:'❧';position:absolute;left:4px;color:var(--rubric);font-style:normal}
.choice:hover,.choice:focus-visible{color:var(--pen);background:rgba(96,108,56,.1);outline:none}
.choice.continue{align-self:center;text-align:center;border:0;padding:8px 20px;font-style:normal;font-variant:small-caps;text-transform:lowercase;letter-spacing:.14em;color:var(--pen)}
.choice.continue:before{content:none}.choice.continue:after{content:' ›'}
.choice.locked{cursor:default;color:var(--faded,#8a8a6a);opacity:.75}.choice.locked:hover{background:none;color:var(--faded,#8a8a6a)}.choice.locked:before{content:'🔒';font-size:13px;top:12px}
.choice .needs{display:block;font-size:13px;font-style:normal;letter-spacing:.03em}
#language{font:inherit;font-size:inherit;background:none;border:0;color:inherit;letter-spacing:inherit;cursor:pointer}
.end{text-align:center;color:var(--rubric);font-style:italic;font-size:22px;margin:30px 0 10px;letter-spacing:.1em}
.end-actions{text-align:center}
.notice{font-size:15px;font-style:italic;color:var(--ink2);background:rgba(221,161,94,.16);border-left:2px solid var(--rubric);padding:8px 12px;margin:0 0 18px}
@media (max-width:600px){body{padding:0;font-size:17px}.book{padding:34px 22px;min-height:100vh;border-radius:0}h1{font-size:32px}}
`;

const PLAYER_JS = `
(function () {
  var meta = JSON.parse(document.getElementById('story-meta').textContent);
  var json = document.getElementById('story-json').textContent;
  var $ = function (id) { return document.getElementById(id); };
  var story, lines = [], history = [];
  document.title = meta.title;
  $('title').textContent = meta.title;
  $('rh-title').textContent = meta.title;
  $('author').textContent = meta.author ? 'by ' + meta.author : '';

  // One save per story (not per version), so a revised edition of the story finds the reader's
  // place. Editions before this kept one key per version: "<saveKey>.<version>".
  function store(get, value) {
    try {
      if (get) {
        var s = JSON.parse(localStorage.getItem(meta.saveKey) || 'null');
        if (s) return s;
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf(meta.saveKey + '.') === 0) {
            s = JSON.parse(localStorage.getItem(k) || 'null');
            if (s) { s.version = k.slice(meta.saveKey.length + 1); return s; }
          }
        }
        return null;
      }
      for (var j = localStorage.length - 1; j >= 0; j--) {
        var old = localStorage.key(j);
        if (old && old.indexOf(meta.saveKey + '.') === 0) localStorage.removeItem(old);
      }
      if (value === null) localStorage.removeItem(meta.saveKey);
      else localStorage.setItem(meta.saveKey, JSON.stringify(value));
    } catch (e) { return null; }
  }

  function newStory() {
    story = new inkjs.Story(json);
    story.onError = function (m) { console.error(m); };
  }

  function tag(tags, name) {
    for (var i = 0; i < tags.length; i++) if (tags[i].indexOf(name + ':') === 0) return tags[i].slice(name.length + 1).trim();
    return null;
  }

  // ---- Translations: a text's key is its words with spaces tidied, hashed (as in the translation sheet) ----
  var language = '';
  try { language = localStorage.getItem('narrative-bridge.play.language') || ''; } catch (e) {}
  if (meta.translations.languages.indexOf(language) < 0) language = '';
  function textKey(text) {
    var t = String(text).trim().replace(/\\s+/g, ' '), h = 0x811c9dc5;
    for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'nb_' + ('0000000' + h.toString(16)).slice(-8);
  }
  function tr(text) {
    if (!language || !text) return text;
    var row = meta.translations.strings[textKey(text)];
    return (row && row[language]) || text;
  }
  function languageLabel(code) {
    try { var n = new Intl.DisplayNames([code], { type: 'language' }).of(code); return n.charAt(0).toUpperCase() + n.slice(1); } catch (e) { return code; }
  }

  // ---- Locked choices: shown greyed out, with what they need, while the reader lacks it ----
  function holds(c) {
    switch (c.type) {
      case 'has_item': return story.variablesState.$('has_' + c.itemId) === true;
      case 'not': return !holds(c.condition);
      case 'and': return c.conditions.every(holds);
      case 'or': return c.conditions.some(holds);
      case 'compare':
        var v = story.variablesState.$(c.variableId), w = c.value;
        switch (c.op) { case '==': return v === w; case '!=': return v !== w; case '<': return v < w; case '<=': return v <= w; case '>': return v > w; case '>=': return v >= w; }
    }
    return false;
  }
  function lockedNow() {
    var c = story.currentChoices;
    if (!c.length || isPause() || exitName()) return [];
    var knot = (c[0].sourcePath || '').split('.')[0];
    var offered = c.map(function (x) { return x.text; });
    return meta.gated.filter(function (g) { return g.p === knot && offered.indexOf(g.t) < 0; }).map(function (g) {
      return { text: g.t, needs: g.needs.filter(function (n) { try { return !holds(n.c); } catch (e) { return false; } }).map(function (n) { return n.w; }) };
    }).filter(function (g) { return g.needs.length; });
  }

  // ---- Voices: recorded clips, else the browser's speech voice set for the character ----
  var clips = JSON.parse(document.getElementById('story-audio').textContent);
  var pictures = JSON.parse(document.getElementById('story-pictures').textContent);
  var portraits = JSON.parse(document.getElementById('story-portraits').textContent);
  var voiceOn = meta.hasClips;
  try { var pref = localStorage.getItem('narrative-bridge.play.voices'); if (pref) voiceOn = pref === 'on'; } catch (e) {}
  var queue = [], playing = null;
  function voiceLabel() { $('voice').textContent = voiceOn ? 'Voices on' : 'Voices off'; $('voice').setAttribute('aria-pressed', String(voiceOn)); }
  function stopVoices() {
    queue = [];
    if (playing && playing.pause) playing.pause();
    playing = null;
    if (window.speechSynthesis) speechSynthesis.cancel();
  }
  function nextVoice() {
    playing = null;
    var item = queue.shift();
    if (!item) return;
    if (item.audio && clips[item.audio]) {
      var a = new Audio(clips[item.audio]);
      playing = a;
      a.onended = a.onerror = nextVoice;
      a.play().catch(nextVoice);
    } else if (window.speechSynthesis && item.who) {
      var u = new SpeechSynthesisUtterance(item.text), v = meta.voices[item.who] || {};
      if (v.voiceName) u.voice = speechSynthesis.getVoices().filter(function (x) { return x.name === v.voiceName; })[0] || null;
      if (v.rate) u.rate = v.rate;
      if (v.pitch) u.pitch = v.pitch;
      u.onend = u.onerror = nextVoice;
      playing = u;
      speechSynthesis.speak(u);
    } else nextVoice();
  }
  var replaying = false;
  function speak(newLines) {
    if (!voiceOn || replaying) return;
    newLines.forEach(function (l) { if (l.speaker) queue.push(l); });
    if (!playing) nextVoice();
  }

  // ---- Cue sounds: music and ambience loop (one track each, faded), any other cue with a sound plays once ----
  function cueKind(name) {
    var n = name.toLowerCase();
    if (n.indexOf('stop_music') >= 0 || n === 'silence') return 'stop_music';
    if (n.indexOf('stop_ambience') >= 0) return 'stop_ambience';
    if (n.indexOf('music') >= 0 || n === 'song' || n === 'track') return 'music';
    if (n.indexOf('ambien') >= 0 || n === 'weather') return 'ambience';
    if (n.indexOf('shake') >= 0 || n === 'rumble') return 'shake';
    return 'sound';
  }
  function cuesIn(tags) {
    var out = [];
    tags.forEach(function (raw) {
      var t = raw.trim(), colon = t.indexOf(':'), name = (colon < 0 ? t : t.slice(0, colon)).trim();
      if (name && meta.storyTags.indexOf(name) < 0) out.push({ name: name, value: colon < 0 ? '' : t.slice(colon + 1).trim(), tag: t });
    });
    return out;
  }
  var tracks = { music: null, ambience: null };
  function fadeTo(a, to, done) {
    var from = a.volume, start = Date.now();
    var timer = setInterval(function () {
      var t = Math.min(1, (Date.now() - start) / 700);
      a.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (t >= 1) { clearInterval(timer); if (done) done(); }
    }, 30);
  }
  function setTrack(which, tag) {
    var cur = tracks[which];
    if (cur && cur.tag === tag) { if (cur.audio.paused) cur.audio.play().catch(function () {}); return; }
    if (cur) { var old = cur.audio; fadeTo(old, 0, function () { old.pause(); }); }
    tracks[which] = null;
    if (!tag || !meta.cueSounds[tag]) return;
    var a = new Audio(clips[meta.cueSounds[tag]]);
    a.loop = true;
    a.volume = 0;
    tracks[which] = { tag: tag, audio: a };
    a.play().then(function () { fadeTo(a, 0.7); }).catch(function () {}); // tried again at the next click
  }
  // The music and ambience follow the story: where they stand after every cue read so far (after an undo too).
  function syncBackground() {
    var music = null, ambience = null;
    if (soundsOn) lines.forEach(function (l) {
      if (!l.cue) return;
      cuesIn([l.cue]).forEach(function (c) {
        var k = cueKind(c.name);
        if (k === 'stop_music' || (k === 'music' && !c.value)) music = null;
        else if (k === 'stop_ambience' || (k === 'ambience' && !c.value)) ambience = null;
        else if (k === 'music' && meta.cueSounds[c.tag]) music = c.tag;
        else if (k === 'ambience' && meta.cueSounds[c.tag]) ambience = c.tag;
      });
    });
    setTrack('music', music);
    setTrack('ambience', ambience);
  }
  function playSounds(newLines) {
    if (!soundsOn) return;
    newLines.forEach(function (l) {
      if (!l.cue) return;
      cuesIn([l.cue]).forEach(function (c) {
        if (cueKind(c.name) === 'sound' && meta.cueSounds[c.tag]) new Audio(clips[meta.cueSounds[c.tag]]).play().catch(function () {});
      });
    });
  }

  // ---- Book sounds (synthesised; no audio files): page turn on a choice, a bell at the end ----
  var soundsOn = true, actx = null;
  try { soundsOn = localStorage.getItem('narrative-bridge.play.sounds') !== 'off'; } catch (e) {}
  function ac() {
    if (!soundsOn || !window.AudioContext) return null;
    try { actx = actx || new AudioContext(); if (actx.state === 'suspended') actx.resume(); return actx; } catch (e) { return null; }
  }
  function env(c, peak, a, d) { var g = c.createGain(), t = c.currentTime; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); return g; }
  function pageTurn() {
    var c = ac(); if (!c) return;
    var buf = c.createBuffer(1, Math.ceil(c.sampleRate * 0.45), c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource(); src.buffer = buf;
    var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(900, c.currentTime); bp.frequency.exponentialRampToValueAtTime(3800, c.currentTime + 0.32);
    src.connect(bp).connect(env(c, 0.13, 0.06, 0.32)).connect(c.destination); src.start(); src.stop(c.currentTime + 0.45);
  }
  function chime() {
    var c = ac(); if (!c) return;
    [[660, 0.07], [1320, 0.035], [1980, 0.02], [2640, 0.012]].forEach(function (p) {
      var o = c.createOscillator(); o.frequency.value = p[0];
      o.connect(env(c, p[1], 0.01, 1.8)).connect(c.destination); o.start(); o.stop(c.currentTime + 2);
    });
  }
  function soundsLabel() { $('sounds').textContent = soundsOn ? 'Sounds on' : 'Sounds off'; $('sounds').setAttribute('aria-pressed', String(soundsOn)); }

  function continueStory() {
    var from = lines.length;
    while (story.canContinue) {
      var raw = (story.Continue() || '').trim();
      var tags = story.currentTags || [];
      // Cues for the game (#music:calm) come before the line they're on, or alone at the end of a passage.
      cuesIn(tags).forEach(function (c) { lines.push({ cue: c.tag }); });
      if (!raw) continue;
      var line = { text: raw, scene: tag(tags, 'scene'), transition: tags.indexOf('transition') >= 0, audio: tag(tags, 'audio'), image: tag(tags, 'image'), who: tag(tags, 'speaker') };
      if (tag(tags, 'speaker') !== null) {
        var i = raw.indexOf(': ');
        if (i > 0) { line.speaker = raw.slice(0, i); line.text = raw.slice(i + 2); }
        line.paren = tag(tags, 'paren');
      }
      lines.push(line);
    }
    speak(lines.slice(from));
    if (!replaying) playSounds(lines.slice(from));
  }

  function el(tagName, cls, text) {
    var e = document.createElement(tagName);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render() {
    var box = $('text');
    box.textContent = '';
    syncBackground();
    lines.forEach(function (l) {
      if (l.pause || l.cue) return; // a Continue break: the page simply goes on; a cue plays, it isn't read
      if (l.chosen && l.chosen.indexOf('${EXIT_PREFIX}') === 0) { box.appendChild(el('p', 'chosen game-played', '⇥ the game played here ⇤')); return; }
      if (l.chosen) { box.appendChild(el('p', 'chosen', tr(l.chosen))); return; }
      if (l.scene) box.appendChild(el('span', 'scene', tr(l.scene)));
      var pic = l.image && pictures[l.image];
      if (pic) {
        var fig = el('figure', 'picture'), img = el('img');
        img.src = pic.src;
        img.alt = pic.alt;
        fig.appendChild(img);
        box.appendChild(fig);
      }
      if (l.speaker) {
        var face = l.who && portraits[l.who] && pictures[portraits[l.who]];
        var p = el('p', face ? 'dialogue with-portrait' : 'dialogue');
        if (face) {
          var img = el('img', 'portrait');
          img.src = face.src;
          img.alt = '';
          p.appendChild(img);
        }
        p.appendChild(el('span', 'speaker', tr(l.speaker)));
        if (l.paren) p.appendChild(el('span', 'paren', '(' + tr(l.paren) + ')'));
        p.appendChild(document.createTextNode(tr(l.text)));
        box.appendChild(p);
      } else box.appendChild(el('p', l.transition ? 'transition' : '', tr(l.text)));
    });
    var nav = $('choices');
    nav.textContent = '';
    var choices = story.currentChoices;
    if (!choices.length) {
      if (lines.length) chime();
      nav.appendChild(el('p', 'end', '❦ The End ❦'));
      var again = el('div', 'end-actions');
      var b = el('button', 'btn', 'Read again');
      b.onclick = startOver;
      again.appendChild(b);
      nav.appendChild(again);
    }
    var pause = isPause();
    var exit = exitName();
    if (exit) {
      // An exit to the game: in a game, gameplay happens here until the game resumes the story.
      var box2 = el('div', 'game-exit');
      box2.appendChild(el('p', '', 'The game takes over here (' + exit + '). In the game, the player plays until it resumes the story.'));
      var r = el('button', 'choice continue', 'Resume the story');
      r.onclick = function () { choose(choices[0].index, choices[0].text); };
      box2.appendChild(r);
      nav.appendChild(box2);
      $('undo').disabled = !history.length;
      return;
    }
    choices.forEach(function (c) {
      var b = el('button', pause ? 'choice continue' : 'choice', tr(c.text));
      b.onclick = function () { choose(c.index, c.text); };
      nav.appendChild(b);
    });
    lockedNow().forEach(function (g) {
      var b = el('button', 'choice locked', tr(g.text));
      b.disabled = true;
      b.appendChild(el('span', 'needs', 'needs ' + g.needs.map(tr).join(', ')));
      nav.appendChild(b);
    });
    $('undo').disabled = !history.length;
  }

  function save() { store(false, { version: meta.version, state: story.state.toJson(), lines: lines, history: history }); }

  // A save from another version of the story: read it again from the start, making the same
  // choices, so the new version's text and variables apply. Stops at the first choice the new
  // version no longer offers. Returns true if every choice was found.
  function replay(saved) {
    var chosen = (saved.lines || []).filter(function (l) { return l.chosen; }).map(function (l) { return l.chosen; });
    newStory(); lines = []; history = [];
    replaying = true;
    var take = function (c) {
      history.push({ state: story.state.toJson(), lines: lines.slice() });
      if (history.length > 50) history.shift();
      var pause = isPause();
      story.ChooseChoiceIndex(c.index);
      lines.push(pause ? { chosen: c.text, pause: true } : { chosen: c.text });
      continueStory();
    };
    try {
      continueStory();
      for (var i = 0, steps = 0; i < chosen.length && steps < 10000; steps++) {
        var match = story.currentChoices.filter(function (c) { return c.text === chosen[i]; })[0];
        if (match) { take(match); i++; }
        else if (isPause()) take(story.currentChoices[0]); // a Continue break added since the save
        else if (chosen[i] === 'Continue') i++; // a Continue break removed since the save
        else return false;
      }
      return true;
    } finally { replaying = false; }
  }

  // An exit to the game (see inkgen.ts): its name, or null.
  function exitName() {
    var c = story.currentChoices;
    return c.length === 1 && c[0].text.indexOf('${EXIT_PREFIX}') === 0 ? c[0].text.slice(${EXIT_PREFIX.length}) : null;
  }

  // A Continue break: the only thing to do is go on (see inkgen.ts).
  function isPause() {
    var c = story.currentChoices;
    return c.length === 1 && c[0].text === 'Continue';
  }

  function notice(text) {
    $('notice').textContent = text || '';
    $('notice').hidden = !text;
  }

  function choose(index, text) {
    history.push({ state: story.state.toJson(), lines: lines.slice() });
    if (history.length > 50) history.shift();
    stopVoices();
    notice('');
    pageTurn();
    var pause = isPause();
    story.ChooseChoiceIndex(index);
    lines.push(pause ? { chosen: text, pause: true } : { chosen: text });
    continueStory();
    render();
    save();
    var last = $('text').lastElementChild;
    if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function undo() {
    var h = history.pop();
    if (!h) return;
    story.state.LoadJson(h.state);
    lines = h.lines;
    render();
    save();
  }

  function open() { $('cover').hidden = true; $('reader').hidden = false; window.scrollTo(0, 0); }

  function begin() {
    stopVoices();
    notice('');
    newStory(); lines = []; history = [];
    continueStory(); render(); save(); open();
  }

  function startOver() {
    if (history.length && !confirm('Start the story again from the beginning?')) return;
    store(false, null);
    begin();
  }

  var saved = store(true);
  if (saved && saved.state) {
    $('resume').hidden = false;
    $('begin').textContent = 'Start over';
    $('resume').onclick = function () {
      try {
        if (saved.version === meta.version) {
          newStory();
          story.state.LoadJson(saved.state);
          lines = saved.lines || []; history = saved.history || [];
        } else {
          notice(replay(saved)
            ? 'This story has been revised since you last read it. You are back where you left off.'
            : 'This story has been revised since you last read it. Some of your earlier choices are no longer in it, so you pick up from the last part that still matches.');
          save();
        }
        render(); open();
      } catch (e) { begin(); }
    };
  }
  $('begin').onclick = begin;
  $('undo').onclick = undo;
  $('restart').onclick = startOver;
  voiceLabel();
  soundsLabel();
  $('sounds').onclick = function () {
    soundsOn = !soundsOn;
    try { localStorage.setItem('narrative-bridge.play.sounds', soundsOn ? 'on' : 'off'); } catch (e) {}
    soundsLabel();
    syncBackground();
  };
  if (meta.translations.languages.length) {
    var pick = $('language');
    [''].concat(meta.translations.languages).forEach(function (code) {
      var o = el('option', '', code ? languageLabel(code) : 'As written');
      o.value = code;
      pick.appendChild(o);
    });
    pick.value = language;
    pick.hidden = false;
    pick.onchange = function () {
      language = pick.value;
      try { localStorage.setItem('narrative-bridge.play.language', language); } catch (e) {}
      if (story) render();
    };
  }
  $('voice').onclick = function () {
    voiceOn = !voiceOn;
    try { localStorage.setItem('narrative-bridge.play.voices', voiceOn ? 'on' : 'off'); } catch (e) {}
    if (!voiceOn) stopVoices();
    voiceLabel();
  };
})();
`;
