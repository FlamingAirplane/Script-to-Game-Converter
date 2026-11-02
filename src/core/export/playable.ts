import type { ProcessedStory } from '../pipeline';
import { audioFileName, bytesToBase64, referencedAudio, type AudioAssets } from '../audio';
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

export function buildPlayableHtml(story: ProcessedStory, inkRuntimeJs: string, audio: AudioAssets = {}): string {
  assertExportable(story);
  const { title, author, id } = story.project.project;
  const runtime = scriptSafe(inkRuntimeJs.replace(/\/\/# sourceMappingURL=.*$/m, ''));
  // Recorded clips are embedded as data URIs keyed by the file name used in #audio tags.
  const clips: Record<string, string> = {};
  for (const ref of referencedAudio(story.project)) {
    const a = audio[ref.id];
    if (a) clips[audioFileName(ref)] = `data:${a.mime};base64,${bytesToBase64(a.bytes)}`;
  }
  const voices = Object.fromEntries(story.project.characters.filter((c) => c.voice).map((c) => [c.id, c.voice]));
  const meta = jsonSafe(
    JSON.stringify({ title, author: author ?? '', saveKey: `narrative-bridge.play.${id}.${storyVersion(story)}`, voices, hasClips: Object.keys(clips).length > 0 }),
  );
  const clipJson = jsonSafe(JSON.stringify(clips));
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
    <header class="running-head"><span id="rh-title"></span><span class="tools"><button id="sounds" class="link" aria-pressed="true">Sounds on</button><button id="voice" class="link" aria-pressed="false">Voices off</button><button id="undo" class="link" disabled>Undo</button><button id="restart" class="link">Start over</button></span></header>
    <div id="text" class="text" aria-live="polite"></div>
    <nav id="choices" class="choices"></nav>
  </section>
</main>
<script>${runtime}</script>
<script id="story-json" type="application/json">${jsonSafe(story.compile.json!)}</script>
<script id="story-meta" type="application/json">${meta}</script>
<script id="story-audio" type="application/json">${clipJson}</script>
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
.end{text-align:center;color:var(--rubric);font-style:italic;font-size:22px;margin:30px 0 10px;letter-spacing:.1em}
.end-actions{text-align:center}
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

  function store(get, value) {
    try {
      if (get) return JSON.parse(localStorage.getItem(meta.saveKey) || 'null');
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

  // ---- Voices: recorded clips, else the browser's speech voice set for the character ----
  var clips = JSON.parse(document.getElementById('story-audio').textContent);
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
  function speak(newLines) {
    if (!voiceOn) return;
    newLines.forEach(function (l) { if (l.speaker) queue.push(l); });
    if (!playing) nextVoice();
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
      if (!raw) continue;
      var tags = story.currentTags || [];
      var line = { text: raw, scene: tag(tags, 'scene'), transition: tags.indexOf('transition') >= 0, audio: tag(tags, 'audio'), who: tag(tags, 'speaker') };
      if (tag(tags, 'speaker') !== null) {
        var i = raw.indexOf(': ');
        if (i > 0) { line.speaker = raw.slice(0, i); line.text = raw.slice(i + 2); }
        line.paren = tag(tags, 'paren');
      }
      lines.push(line);
    }
    speak(lines.slice(from));
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
    lines.forEach(function (l) {
      if (l.chosen) { box.appendChild(el('p', 'chosen', l.chosen)); return; }
      if (l.scene) box.appendChild(el('span', 'scene', l.scene));
      if (l.speaker) {
        var p = el('p', 'dialogue');
        p.appendChild(el('span', 'speaker', l.speaker));
        if (l.paren) p.appendChild(el('span', 'paren', '(' + l.paren + ')'));
        p.appendChild(document.createTextNode(l.text));
        box.appendChild(p);
      } else box.appendChild(el('p', l.transition ? 'transition' : '', l.text));
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
    choices.forEach(function (c) {
      var b = el('button', 'choice', c.text);
      b.onclick = function () { choose(c.index, c.text); };
      nav.appendChild(b);
    });
    $('undo').disabled = !history.length;
  }

  function save() { store(false, { state: story.state.toJson(), lines: lines, history: history }); }

  function choose(index, text) {
    history.push({ state: story.state.toJson(), lines: lines.slice() });
    if (history.length > 50) history.shift();
    stopVoices();
    pageTurn();
    story.ChooseChoiceIndex(index);
    lines.push({ chosen: text });
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
        newStory();
        story.state.LoadJson(saved.state);
        lines = saved.lines || []; history = saved.history || [];
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
  };
  $('voice').onclick = function () {
    voiceOn = !voiceOn;
    try { localStorage.setItem('narrative-bridge.play.voices', voiceOn ? 'on' : 'off'); } catch (e) {}
    if (!voiceOn) stopVoices();
    voiceLabel();
  };
})();
`;
