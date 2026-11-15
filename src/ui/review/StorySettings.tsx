import { useMemo, useState } from 'react';
import { uniqueId, type StoryProject } from '../../core/isr';
import { ProvenanceBadge } from '../common';
import { VoicePicker } from '../VoiceControls';
import { CharacterPortrait } from '../CharacterPortrait';
import { StoryFiles } from '../StoryFiles';
import { RecordingsImport } from '../RecordingsImport';
import { formatMinutes, storyStats } from '../../core/stats';
import { DraftShelf } from '../Drafts';
import { DialogueOnlySetting } from '../DialogueOnlySetting';
import { type Update, mergeCharacter } from '../projectOps';

export function StorySettings({ project, update, onKeepDraft, onRestoreDraft }: { project: StoryProject; update: Update; onKeepDraft: (label: string) => Promise<void>; onRestoreDraft: (id: number) => void }) {
  return (
    <div className="editor settings">
      <h2>Story settings</h2>
      <div className="ex-libris" aria-label="Bookplate">
        <span className="ex-libris-label">Ex Libris</span>
        <span className="ex-libris-title">{project.project.title || 'Untitled'}</span>
        {project.project.author && <span className="ex-libris-by">by {project.project.author}</span>}
        <span className="ex-libris-meta">
          {project.passages.length} passages · {project.characters.length} characters · {project.project.mode} edition
        </span>
      </div>
      <div className="settings-grid">
        <label className="field">
          <span className="muted small">Title</span>
          <input className="input" value={project.project.title} onChange={(e) => update((d) => (d.project.title = e.target.value), `settings:project.title`)} />
        </label>
        <label className="field">
          <span className="muted small">Author</span>
          <input className="input" value={project.project.author ?? ''} onChange={(e) => update((d) => (d.project.author = e.target.value || undefined), `settings:project.author`)} />
        </label>
        <label className="field">
          <span className="muted small">Start passage</span>
          <select className="input" value={project.project.startPassage} onChange={(e) => update((d) => (d.project.startPassage = e.target.value))}>
            {project.passages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.id})
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span className="muted small">Mode · schema</span>
          <span>
            {project.project.mode} · ISR {project.schemaVersion}
          </span>
        </div>
      </div>
      <DialogueOnlySetting project={project} update={update} />

      <AtAGlance project={project} />
      <DraftShelf projectId={project.project.id} current={project} onKeep={onKeepDraft} onRestore={onRestoreDraft} />

      <h3>Characters</h3>
      <table className="table">
        <thead>
          <tr>
            <th>id</th>
            <th>Display name</th>
            <th>Aliases seen in source</th>
            <th>Same person as…</th>
            <th>Voice</th>
            <th>Portrait</th>
          </tr>
        </thead>
        <tbody>
          {project.characters.map((c, i) => (
            <tr key={c.id}>
              <td className="mono small">{c.id}</td>
              <td>
                <input className="input small" value={c.displayName} onChange={(e) => update((d) => (d.characters[i].displayName = e.target.value), `settings:characters.displayName:${i}`)} />
              </td>
              <td className="muted small">{c.aliases.join(', ') || '—'}</td>
              <td>
                {project.characters.length > 1 && (
                  <select
                    className="input tiny-select"
                    value=""
                    aria-label={`Merge ${c.displayName} into another character`}
                    onChange={(e) => {
                      const into = project.characters.find((x) => x.id === e.target.value);
                      if (!into || !confirm(`Merge ${c.displayName} into ${into.displayName}? All of ${c.displayName}’s lines will be spoken by ${into.displayName}.`)) return;
                      update((d) => mergeCharacter(d, c.id, into.id));
                    }}
                  >
                    <option value="">merge into…</option>
                    {project.characters
                      .filter((x) => x.id !== c.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.displayName}
                        </option>
                      ))}
                  </select>
                )}
              </td>
              <td>
                <VoicePicker voice={c.voice} name={c.displayName} onChange={(voice) => update((d) => (d.characters[i].voice = voice), `settings:voice:${i}`)} />
              </td>
              <td>
                <CharacterPortrait character={c} update={update} />
              </td>
            </tr>
          ))}
          {!project.characters.length && (
            <tr>
              <td colSpan={6} className="muted small">
                No characters detected.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h3>Recordings</h3>
      <RecordingsImport project={project} update={update} />

      <StoryFiles project={project} />

      <h3>Items</h3>
      <p className="muted small">Each item becomes an Ink Boolean <code>has_&lt;id&gt;</code>. In a real game the host inventory should stay authoritative.</p>
      <table className="table">
        <thead>
          <tr>
            <th>id</th>
            <th>Display name</th>
            <th>Consumable</th>
            <th>Origin</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {project.items.map((it, i) => (
            <tr key={it.id}>
              <td className="mono small">{it.id}</td>
              <td>
                <input className="input small" value={it.displayName} onChange={(e) => update((d) => (d.items[i].displayName = e.target.value), `settings:items.displayName:${i}`)} />
              </td>
              <td>
                <input type="checkbox" checked={it.consumable} onChange={(e) => update((d) => (d.items[i].consumable = e.target.checked))} />
              </td>
              <td>
                <ProvenanceBadge origin={it.origin} />
              </td>
              <td>
                <button className="icon" title="Remove (references will be flagged)" onClick={() => update((d) => d.items.splice(i, 1))}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewEntry
        placeholder="new_item_id"
        label="+ Item"
        onAdd={(raw) =>
          update((d) => {
            const id = uniqueId(raw, new Set(d.items.map((x) => x.id)), 'item');
            d.items.push({ id, displayName: raw, consumable: false, origin: 'user_authored' });
          })
        }
      />

      <h3>Variables</h3>
      <table className="table">
        <thead>
          <tr>
            <th>id</th>
            <th>Type</th>
            <th>Initial</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {project.variables.map((v, i) => (
            <tr key={v.id}>
              <td className="mono small">{v.id}</td>
              <td className="small">{v.type}</td>
              <td>
                {v.type === 'bool' ? (
                  <input type="checkbox" checked={v.initial === true} onChange={(e) => update((d) => (d.variables[i].initial = e.target.checked))} />
                ) : (
                  <input
                    className="input small"
                    value={String(v.initial)}
                    onChange={(e) => update((d) => (d.variables[i].initial = v.type === 'int' ? parseInt(e.target.value || '0', 10) || 0 : e.target.value))}
                  />
                )}
              </td>
              <td>
                <button className="icon" onClick={() => update((d) => d.variables.splice(i, 1))}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewEntry
        placeholder="trust"
        label="+ Integer variable"
        onAdd={(raw) =>
          update((d) => {
            const id = uniqueId(raw, new Set([...d.variables.map((x) => x.id), ...d.items.map((x) => `has_${x.id}`)]), 'var');
            d.variables.push({ id, type: 'int', initial: 0, origin: 'user_authored' });
          })
        }
      />
    </div>
  );
}

/** Length, branching and who speaks how much, for planning reading time and voice sessions. */
function AtAGlance({ project }: { project: StoryProject }) {
  const st = useMemo(() => storyStats(project), [project]);
  const n = (v: number) => v.toLocaleString();
  return (
    <section className="glance" aria-labelledby="glance-head">
      <h3 id="glance-head">At a glance</h3>
      <dl className="glance-grid">
        <div>
          <dt>Words</dt>
          <dd>{n(st.words)}</dd>
        </div>
        <div>
          <dt>Reading time</dt>
          <dd>{formatMinutes(st.readingMinutes)}</dd>
        </div>
        <div>
          <dt>Choices</dt>
          <dd>
            {n(st.choices)}
            {st.conditionalChoices > 0 && <span className="muted small"> · {n(st.conditionalChoices)} conditional</span>}
          </dd>
        </div>
        <div>
          <dt>Endings</dt>
          <dd>{n(st.endings)}</dd>
        </div>
        <div>
          <dt>Spoken dialogue</dt>
          <dd>{formatMinutes(st.spokenMinutes)}</dd>
        </div>
      </dl>
      {st.characters.length > 0 && (
        <table className="table glance-cast">
          <caption className="muted small">Lines per character (rejected passages are not counted)</caption>
          <thead>
            <tr>
              <th scope="col">Character</th>
              <th scope="col">Lines</th>
              <th scope="col">Words</th>
              <th scope="col">Clips</th>
            </tr>
          </thead>
          <tbody>
            {st.characters.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{n(c.lines)}</td>
                <td>{n(c.words)}</td>
                <td>
                  {c.clips}/{c.lines}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function NewEntry({ placeholder, label, onAdd }: { placeholder: string; label: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onAdd(v.trim());
        setV('');
      }}
    >
      <input className="input small mono" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn tiny" type="submit" disabled={!v.trim()}>
        {label}
      </button>
    </form>
  );
}
