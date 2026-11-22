import { useState } from 'react';
import { languageName } from '../language';
import { importTranslations, removeLanguage, translationCoverage } from '../../core/export/translations';
import type { StoryProject } from '../../core/isr';
import type { Update } from '../projectOps';

/** Bring a filled-in translation sheet back into the story, and see how much of each language is done. */
export function TranslationsIn({ project, update }: { project: StoryProject; update: Update }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const coverage = translationCoverage(project);
  const read = async (file: File) => {
    setError('');
    setMessage('');
    try {
      const text = await file.text();
      // Read it into a copy first: a wrong file changes nothing, and this says what it brings.
      const f = importTranslations(structuredClone(project), text);
      update((d) => void importTranslations(d, text));
      setMessage(
        `Brought in ${f.languages.map((l) => `${languageName(l.code)} (${l.translated} of ${f.total})`).join(', ')}.` +
          (f.stale ? ` ${f.stale} row(s) were for text that has changed since the sheet was made, so they were left out.` : ''),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="translations-in">
      <label className="btn small file-btn">
        Bring in a translated sheet…
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          hidden
          onChange={(e) => (e.target.files?.[0] && void read(e.target.files[0]), (e.target.value = ''))}
        />
      </label>
      {coverage.languages.length > 0 && (
        <ul className="small translation-coverage" aria-label="Translations in this story">
          {coverage.languages.map((l) => (
            <li key={l.code}>
              <strong>{languageName(l.code)}</strong> <span className="muted">({l.code})</span>: {l.translated} of {coverage.total} translated
              {l.translated < coverage.total && <span className="muted"> · download the sheet to see what’s missing</span>}{' '}
              <button className="link small" onClick={() => update((d) => removeLanguage(d, l.code))} aria-label={`Remove ${languageName(l.code)}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p className="small" role="status">
          {message} Playtest and the playable story can now show it; the Unity package includes it.
        </p>
      )}
      {error && <p className="error-text small">{error}</p>}
    </div>
  );
}
