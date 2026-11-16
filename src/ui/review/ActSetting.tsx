import { useEffect, useState } from 'react';
import { actToFollowing, actsOf, addAct, removeAct, renameAct, setPassageAct } from '../../core/acts';
import type { Passage, StoryProject } from '../../core/isr';
import type { Update } from '../projectOps';

const NEW_ACT = '__new_act__';

/** Review → Passage settings: which act the passage is in, and the act's title (see core/acts.ts). */
export function ActSetting({ project, passage, update }: { project: StoryProject; passage: Passage; update: Update }) {
  const acts = actsOf(project);
  const act = acts.find((a) => a.id === passage.act);
  const [titleDraft, setTitleDraft] = useState(act?.title ?? '');
  useEffect(() => setTitleDraft(act?.title ?? ''), [act?.id, act?.title]);
  const pid = passage.id;
  const at = project.passages.findIndex((p) => p.id === pid);
  const following = project.passages.slice(at + 1);
  const canSpread = !!act && following.length > 0 && !following[0].act;

  return (
    <div className="act-setting">
      <label>
        <strong>🎭 Act</strong>{' '}
        <select
          className="input small"
          aria-label="The passage's act"
          value={act?.id ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW_ACT) {
              const title = prompt('The new act’s title:', `Act ${acts.length + 1}`);
              if (title?.trim()) update((d) => void addAct(d, title.trim(), pid));
            } else update((d) => setPassageAct(d, pid, v || undefined));
          }}
        >
          <option value="">No act</option>
          {acts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
          <option value={NEW_ACT}>New act…</option>
        </select>
      </label>
      {act ? (
        <>
          <input
            className="input small"
            aria-label="The act's title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => titleDraft.trim() && titleDraft !== act.title && update((d) => renameAct(d, act.id, titleDraft.trim()))}
          />
          <span className="mono muted small" title="The name the game uses for this act (StoryInfo.Acts)">
            {act.id}
          </span>
          {canSpread && (
            <button className="btn tiny" title="Put the passages after this one, up to the next act, in this act too" onClick={() => update((d) => void actToFollowing(d, pid))}>
              Also the passages after it
            </button>
          )}
          <button
            className="btn tiny"
            onClick={() => confirm(`Remove the act "${act.title}"? Its passages stay, in no act.`) && update((d) => removeAct(d, act.id))}
          >
            Remove act
          </button>
        </>
      ) : (
        <span className="muted small">Group passages into acts: the contents list shows them by act, and the game gets the list of acts. The story plays the same.</span>
      )}
    </div>
  );
}
