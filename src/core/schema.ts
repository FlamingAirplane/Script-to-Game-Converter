import { diag, type Diagnostic } from './diagnostics';
import { SCHEMA_VERSION, type StoryProject } from './isr';

// Structural validation of the ISR (mirrors schemas/story-model-v1.schema.json). Runs before
// semantic analysis so that malformed project files produce clear errors instead of crashes.

export function validateSchema(p: unknown): Diagnostic[] {
  const ds: Diagnostic[] = [];
  const err = (msg: string, entityId?: string) => ds.push(diag('SCHEMA_INVALID', 'error', 'story_validation', msg, { entityId }));
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
  const str = (x: unknown) => typeof x === 'string';

  if (!isObj(p)) {
    err('Project is not an object.');
    return ds;
  }
  const sp = p as unknown as StoryProject;
  if (sp.schemaVersion !== SCHEMA_VERSION) {
    if (!str(sp.schemaVersion)) err('schemaVersion is missing.');
    else ds.push(diag('SCHEMA_VERSION_MISMATCH', 'warning', 'story_validation', `Project uses schema ${sp.schemaVersion}; this build expects ${SCHEMA_VERSION}.`, { exportBlocked: false }));
  }
  if (!isObj(sp.project) || !str(sp.project.id) || !str(sp.project.title) || !str(sp.project.startPassage)) err('project.id, project.title and project.startPassage are required.');
  for (const k of ['characters', 'items', 'variables', 'passages', 'sources'] as const) if (!Array.isArray(sp[k])) err(`${k} must be an array.`);
  if (ds.some((d) => d.severity === 'error')) return ds;

  sp.passages.forEach((ps, i) => {
    if (!isObj(ps) || !str(ps.id) || !ps.id) return err(`passages[${i}] is missing an id.`);
    if (!Array.isArray(ps.content) || !Array.isArray(ps.choices)) err(`Passage "${ps.id}" must have content and choices arrays.`, ps.id);
    ps.choices?.forEach((c, j) => {
      if (!isObj(c) || !str(c.id) || !str(c.text) || !str(c.target)) err(`Choice ${j} in "${ps.id}" requires id, text and target.`, ps.id);
      if (!Array.isArray(c.conditions) || !Array.isArray(c.effects)) err(`Choice "${c.id}" must have conditions and effects arrays.`, c.id);
    });
    ps.content?.forEach((b, j) => {
      if (!isObj(b) || !str(b.type)) err(`Content ${j} in "${ps.id}" has no type.`, ps.id);
      else if ((b.type === 'dialogue' || b.type === 'action') && !str(b.text)) err(`Content ${j} in "${ps.id}" is missing text.`, ps.id);
    });
  });
  if (sp.translations !== undefined) {
    const t = sp.translations as unknown;
    if (!isObj(t) || !Array.isArray(t.languages) || !isObj(t.strings)) err('The translations must have a list of languages and the strings.');
  }
  sp.items.forEach((it) => (!isObj(it) || !str(it.id) ? err('An item is missing its id.') : undefined));
  sp.variables.forEach((v) => {
    if (!isObj(v) || !str(v.id)) return err('A variable is missing its id.');
    if (!['bool', 'int', 'string'].includes(v.type)) err(`Variable "${v.id}" has unsupported type "${v.type}".`, v.id);
  });
  return ds;
}
