import { useState } from 'react';
import type { Update } from '../projectOps';
import { addReaderNotes, parseReaderNotes } from '../../core/readerNotes';

/** Brings a reader's notes file into the story: each note goes in as a note line after the line it was written on. */
export function ReaderNotesIn({ update }: { update: Update }) {
  const [message, setMessage] = useState('');
  return (
    <div className="reader-notes-in">
      <label className="btn small">
        Bring in readers' notes…
        <input
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Readers' notes file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const parsed = parseReaderNotes(await file.text());
            if ('error' in parsed) return setMessage(parsed.error);
            let result = { placed: 0, unplaced: 0, duplicates: 0 };
            update((d) => {
              result = addReaderNotes(d, parsed.notes);
            });
            const parts = [
              `${result.placed} note${result.placed === 1 ? '' : 's'} from ${file.name} went in beside the lines they're about, as notes in Review`,
              result.unplaced ? `${result.unplaced} on lines the script no longer has went at the start of the story` : '',
              result.duplicates ? `${result.duplicates} were already there` : '',
            ].filter(Boolean);
            setMessage(`${parts.join('; ')}. Readers don't see notes.`);
          }}
        />
      </label>
      {message && (
        <p className="small note-text" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
