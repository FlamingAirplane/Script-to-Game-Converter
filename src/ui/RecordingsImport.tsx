import { useRef, useState } from 'react';
import { matchRecordings } from '../core/export';
import type { StoryProject } from '../core/isr';
import { storeClip } from './audioStore';
import type { Update } from './projectOps';

/**
 * "Add recordings…": pick many audio files at once (or drop them here) and each is attached to the line of
 * dialogue the recording script named it for. A file for a line that already has a clip replaces it.
 */
export function RecordingsImport({ project, update }: { project: StoryProject; update: Update }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ attached: number; unmatched: string[]; failed: string[] } | null>(null);
  const [over, setOver] = useState(false);
  const lines = project.passages.reduce((n, p) => n + p.content.filter((b) => b.type === 'dialogue').length, 0);
  const recorded = project.passages.reduce((n, p) => n + p.content.filter((b) => b.type === 'dialogue' && b.audio).length, 0);

  const add = async (files: File[]) => {
    const audio = files.filter((f) => f.type.startsWith('audio/') || /\.(wav|mp3|ogg|m4a|aac|flac|webm)$/i.test(f.name));
    if (!audio.length) return;
    setBusy(true);
    const { matched, unmatched } = matchRecordings(project, audio.map((f) => f.name));
    const byName = new Map(audio.map((f) => [f.name, f]));
    const stored: { passageId: string; index: number; ref: Awaited<ReturnType<typeof storeClip>> }[] = [];
    const failed: string[] = [];
    for (const m of matched) {
      const passage = project.passages.find((p) => p.id === m.passageId);
      const block = passage?.content[m.index];
      try {
        const ref = await storeClip(byName.get(m.file)!, m.file, block?.type === 'dialogue' ? block.speakerId : m.passageId);
        stored.push({ passageId: m.passageId, index: m.index, ref });
      } catch {
        failed.push(m.file);
      }
    }
    // One edit, so a single Undo takes them all back off.
    if (stored.length)
      update((d) => {
        for (const s of stored) {
          const b = d.passages.find((p) => p.id === s.passageId)?.content[s.index];
          if (b?.type === 'dialogue') b.audio = s.ref;
        }
      });
    setResult({ attached: stored.length, unmatched: [...unmatched, ...files.filter((f) => !audio.includes(f)).map((f) => f.name)], failed });
    setBusy(false);
  };

  return (
    <div
      className={`recordings-import${over ? ' over' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void add([...e.dataTransfer.files]);
      }}
    >
      <p className="muted small">
        {recorded} of {lines} line{lines === 1 ? '' : 's'} of dialogue recorded. Name each file as the recording script's <em>Clip</em> column says (or by
        its row number, like <code>12.wav</code>), then add them all at once or drop them here.
      </p>
      <button className="btn" disabled={busy || !lines} onClick={() => input.current?.click()}>
        {busy ? 'Adding…' : 'Add recordings…'}
      </button>
      {result && (
        <p className="small" role="status">
          {result.attached ? `Attached ${result.attached} recording${result.attached === 1 ? '' : 's'}.` : 'No recordings attached.'}
          {result.unmatched.length > 0 && (
            <span className="muted">
              {' '}
              {result.unmatched.length} file{result.unmatched.length === 1 ? '' : 's'} didn't match a line: {result.unmatched.slice(0, 5).join(', ')}
              {result.unmatched.length > 5 ? '…' : ''}
            </span>
          )}
          {result.failed.length > 0 && <span className="error-text"> Couldn't read: {result.failed.join(', ')}.</span>}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="audio/*"
        multiple
        hidden
        aria-label="Recording files"
        onChange={(e) => {
          void add([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
