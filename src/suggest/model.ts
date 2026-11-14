// The model suggester: a small pretrained instruct model, run on this machine through Transformers.js, reads one
// passage at a time and names at most one moment where the reader could choose (see prompt.ts). It is loaded only
// through a dynamic import, so nothing here is paid for until a writer asks for it. In Node it serves the CLI
// (--suggest model); the browser worker comes later (see the plan).

import { log } from '../core/log';
import type { FoundItem } from '../core/adapt';
import type { Item, StoryProject } from '../core/isr';
import type { Proposal, Suggester, SuggestOptions } from '../core/proposals';
import { buildPrompt, gatesForFound, MOMENT_SCHEMA, momentToProposal, parseReply, promptLines, SYSTEM_PROMPT, windows, type Moment } from './prompt';

/** The model the CLI uses unless told otherwise. Chosen by measurement (npm run eval:adapt), not by name. */
export const DEFAULT_MODEL = 'HuggingFaceTB/SmolLM2-360M-Instruct';

/** Candidates from the plan, for --model. Sizes are approximate; licences are to be checked before any is pinned. */
export const CANDIDATE_MODELS = [
  { repo: 'HuggingFaceTB/SmolLM2-360M-Instruct', note: 'smallest; Apache 2.0; English only' },
  { repo: 'onnx-community/Qwen3-0.6B-ONNX', note: 'about 335 MB; licence on the upstream card' },
  { repo: 'onnx-community/LFM2.5-350M-ONNX', note: 'the structured-output example model' },
  { repo: 'onnx-community/gemma-3-1b-it-ONNX', note: 'a larger step if the small ones fall short' },
];

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** Runs the model once: the reply text for a conversation, held to `schema` where the runtime can. */
export type Generator = (messages: ChatMessage[], opts: { schema: object; signal?: AbortSignal }) => Promise<string>;

export interface ModelSuggesterOptions {
  /** Hugging Face repository id (default DEFAULT_MODEL). */
  model?: string;
  revision?: string;
  /** Quantisation, e.g. 'q4' (default) or 'fp16'. */
  dtype?: string;
  /** A folder holding a local copy of the model files (no network). */
  modelDir?: string;
  maxNewTokens?: number;
  /** Download progress, per file. */
  onDownload?: (file: string, loaded: number, total: number) => void;
  /** The text generator to use instead of Transformers.js (tests, and the browser worker later). */
  generate?: Generator;
}

const logger = log('suggest');

/** A Suggester that asks the model about every passage that could take a choice menu. */
export function createModelSuggester(opts: ModelSuggesterOptions = {}): Suggester {
  const name = opts.model ?? DEFAULT_MODEL;
  const revision = opts.revision ?? 'main';
  const id = `model:${name}@${revision}`;
  let generator: Promise<Generator> | undefined;
  const generate = () => (generator ??= opts.generate ? Promise.resolve(opts.generate) : transformersGenerator({ ...opts, model: name, revision }));

  return {
    id,
    async suggest(project: StoryProject, o: SuggestOptions = {}): Promise<Proposal[]> {
      const done = logger.time('Model suggestions', 'info');
      const gen = await generate();
      const speakers = new Map(project.characters.map((c) => [c.id, c.displayName]));
      const eligible = project.inkPassthrough !== undefined ? [] : project.passages.filter((p) => !p.choices.length && p.divert && !p.isEnding && !p.cutscene);
      const proposals: Proposal[] = [];
      const found: FoundItem[] = [];
      const claimed = new Set(project.passages.filter((p) => p.choices.length).map((p) => p.id));
      let calls = 0;
      let unreadable = 0;
      let read = 0;
      o.onProgress?.(0, eligible.length);
      for (const [i, passage] of eligible.entries()) {
        if (o.signal?.aborted) break;
        const lines = promptLines(passage, speakers);
        let moment: Moment | null | undefined = null;
        for (const window of windows(lines)) {
          if (!window.length || o.signal?.aborted) break;
          const prompt = buildPrompt({ passage, index: i + 1, total: eligible.length, lines: window, knownItems: knownItems(project, found) });
          moment = await ask(gen, prompt, o.signal);
          calls++;
          if (moment === undefined) {
            // One retry with a firmer instruction, then give the passage up.
            moment = await ask(gen, `${prompt}\nReply with the JSON object only.`, o.signal);
            calls++;
            if (moment === undefined) unreadable++;
          }
          if (moment) {
            const built = momentToProposal(project, passage, moment, lines, { suggester: id, claimed, found });
            proposals.push(built.proposal);
            if (built.found) found.push(built.found);
            claimed.add(built.proposal.passageId);
            break; // at most one moment per passage
          }
        }
        read++;
        o.onProgress?.(read, eligible.length);
      }
      // Gates stay rule-based: where the items the model found are used later.
      const gates = gatesForFound(project, found, claimed, id);
      done({ model: id, passages: eligible.length, read, calls, unreadable, proposals: proposals.length, gates: gates.length, cancelled: !!o.signal?.aborted });
      return [...proposals, ...gates];
    },
  };
}

async function ask(gen: Generator, prompt: string, signal?: AbortSignal): Promise<Moment | null | undefined> {
  const text = await gen([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }], { schema: MOMENT_SCHEMA, signal });
  return parseReply(text);
}

function knownItems(project: StoryProject, found: FoundItem[]): Item[] {
  return [...project.items, ...found.filter((f) => !project.items.some((i) => i.id === f.itemId)).map((f) => ({ id: f.itemId, displayName: f.display, consumable: false, origin: 'generated' as const }))];
}

// Transformers.js, typed as much of it as this module touches.
interface TransformersModule {
  env: { localModelPath?: string; allowRemoteModels?: boolean; allowLocalModels?: boolean };
  pipeline(task: 'text-generation', model: string, opts: Record<string, unknown>): Promise<TextGenerator>;
}
interface TextGenerator {
  tokenizer: unknown;
  (messages: ChatMessage[], opts: Record<string, unknown>): Promise<{ generated_text: string | { role: string; content: string }[] }[]>;
}
interface StructuredOutputModule {
  StructuredOutputProcessor: new (tokenizer: unknown, constraint: { type: 'json_schema'; json_schema: object }) => unknown;
}

/** Loads Transformers.js (and, when it works, the structured-output processor) and returns a Generator. */
export async function transformersGenerator(opts: ModelSuggesterOptions & { model: string; revision: string }): Promise<Generator> {
  const loading = logger.time('Loaded model', 'info');
  const transformers = '@huggingface/transformers';
  const tf = (await import(/* @vite-ignore */ transformers)) as TransformersModule;
  if (opts.modelDir) {
    tf.env.localModelPath = opts.modelDir;
    tf.env.allowRemoteModels = false;
    tf.env.allowLocalModels = true;
  }
  const pipe = await tf.pipeline('text-generation', opts.model, {
    dtype: opts.dtype ?? 'q4',
    revision: opts.revision,
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file && opts.onDownload) opts.onDownload(p.file, p.loaded ?? 0, p.total ?? 0);
    },
  });
  let structured: StructuredOutputModule['StructuredOutputProcessor'] | null = null;
  try {
    const name = '@huggingface/transformers-structured-output';
    structured = ((await import(/* @vite-ignore */ name)) as StructuredOutputModule).StructuredOutputProcessor;
  } catch (e) {
    logger.warn('Structured output is not available; replies are parsed instead', { error: e instanceof Error ? e.message : String(e) });
  }
  loading({ model: opts.model, revision: opts.revision, dtype: opts.dtype ?? 'q4', structured: !!structured, local: !!opts.modelDir });
  return async (messages, { schema }) => {
    let logits_processor: unknown;
    if (structured) {
      try {
        // One processor per generation: it keeps grammar state and serves a single sequence.
        logits_processor = new structured(pipe.tokenizer, { type: 'json_schema', json_schema: schema });
      } catch (e) {
        logger.warn('Structured output failed for this call; the reply is parsed instead', { error: e instanceof Error ? e.message : String(e) });
      }
    }
    const out = await pipe(messages, { max_new_tokens: opts.maxNewTokens ?? 96, do_sample: false, return_full_text: false, ...(logits_processor ? { logits_processor } : {}) });
    const g = out?.[0]?.generated_text;
    if (typeof g === 'string') return g;
    if (Array.isArray(g)) return String(g.at(-1)?.content ?? '');
    return '';
  };
}
