import { getKey, getModel } from '@/ai/keys';

/**
 * The network edge. The only file in the app that talks to anything.
 *
 * Sarvam, an Indian provider, for an app used by Indian businesses: the data
 * stays in-country, and the models are trained on Indian languages, which
 * matters the moment an owner writes half a question in Hindi.
 *
 * The API is OpenAI-shaped, so this is mostly the standard chat-completions
 * client. Three things about it are not standard, and each one broke something
 * before it was handled here:
 *
 * 1. **A bad key is a 403, not a 401.** Every other provider uses 401, and the
 *    fallback below treats 403 as "this one model will not serve" — so a wrong
 *    key walked the whole roster, failed identically each time, and reported
 *    that no model was available. Classification therefore reads the machine
 *    -readable `code` in the body first and the status only as a fallback.
 * 2. **One of the two models cannot answer a short question.** `sarvam-105b`
 *    is a reasoning model: it spends the budget in `reasoning_content` and
 *    returns `content: null`. Asked for the single word "ok" with 400 tokens it
 *    used all 400 and answered nothing. `sarvam-105b-conversations` answered in
 *    three.
 * 3. **The model list carries no pricing or modality.** Rows are `{ id, object,
 *    created, owned_by }` and nothing else, so a filter written against
 *    OpenRouter's richer rows rejects every model Sarvam offers.
 */

const BASE = 'https://api.sarvam.ai/v1';

/**
 * The model that answers, as opposed to the one that thinks.
 *
 * Named rather than discovered, because discovery cannot tell them apart: both
 * appear in `/models` as bare ids with no hint that one of them will burn the
 * whole budget reasoning and return nothing. See the note above.
 */
const DEFAULT_MODEL = 'sarvam-105b-conversations';

/**
 * Models that answer by thinking out loud first.
 *
 * Kept as a list rather than a guess about the id, because being wrong in the
 * cautious direction only costs a larger token budget, and being wrong the
 * other way returns an empty answer to somebody asking about their takings.
 */
const REASONING_MODELS = new Set(['sarvam-105b']);

/** Free models are throttled, and a slow answer is still an answer — but not a stalled one. */
const TIMEOUT_MS = 30_000;
const MODEL_CACHE_MS = 6 * 60 * 60 * 1000;

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type AiErrorKind =
  | 'no-key'
  | 'offline'
  | 'rate-limited'
  | 'refused'
  | 'policy'
  /**
   * This one model will not serve this account, for a reason particular to the
   * model rather than to the key: withdrawn, region-locked, or — the one that
   * sent us looking — published only to "agentic harnesses" and refused to
   * every ordinary chat request.
   *
   * Kept apart from `refused` because the two need opposite handling. A refused
   * *key* fails identically for every model, so walking the roster proves the
   * same point four times; a refused *model* is exactly what the roster exists
   * to route around.
   */
  | 'model-unavailable'
  | 'bad-response';

export class AiError extends Error {
  // Assigned explicitly rather than as a constructor parameter property. The
  // parameter-property shorthand emits real code, so Node's type-stripping
  // refuses to load the module at all — which would leave the whole `src/ai`
  // tree untestable by the verification scripts for the sake of one line.
  readonly kind: AiErrorKind;

  constructor(message: string, kind: AiErrorKind) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
  }
}

/* ---------------------------------------------------------------- models -- */

type ModelRow = {
  id: string;
  /** Sarvam sends no display name; other OpenAI-shaped providers do. */
  name?: string;
  owned_by?: string;
};

let modelCache: { at: number; ids: string[] } | null = null;

/**
 * Which models the provider offers, discovered rather than hardcoded.
 *
 * Sarvam's list is short and stable, so this matters less than it did against a
 * router whose free roster churned weekly — but it still means a model added
 * next month appears in the picker without a release, and one withdrawn stops
 * being offered.
 *
 * `/models` needs no key, which is why the picker can be populated before the
 * owner has pasted one.
 */
export type FreeModel = { id: string; label: string; reasoning: boolean };

let rowCache: { at: number; rows: FreeModel[] } | null = null;

/**
 * Models this session has watched refuse.
 *
 * In memory only, and deliberately: the reason is usually temporary — a model
 * withdrawn for a day, a region that opens later — and a refusal written to
 * disk would outlive its cause with nothing in the product able to clear it.
 * A restart is the reset.
 */
const unavailable = new Set<string>();

/**
 * The models on a catalogue that can answer a question, best first.
 *
 * Pure, and exported, so `scripts/ai-check.mjs` can hold it against real rows.
 *
 * There is nothing in a Sarvam row to filter *on* — no pricing, no modality,
 * just an id — so this does not pretend to judge them. What it does is order
 * them: a model that thinks before answering goes last, because it costs a much
 * larger budget to say the same sentence and returns nothing at all if the
 * budget falls short. That ordering is the whole reason this function exists
 * rather than the list being used as it arrives.
 */
export function chatModels(rows: ModelRow[]): FreeModel[] {
  return rows
    .filter((m) => typeof m.id === 'string' && m.id.length > 0)
    .map((m) => ({
      id: m.id,
      // Sarvam sends no display name, so the id is the label. Hyphens read
      // badly in a list, and the vendor prefix other providers carry is noise.
      label: (m.name ?? m.id).replace(/^[^:]*:\s*/, ''),
      reasoning: REASONING_MODELS.has(m.id),
    }))
    .sort((a, b) => {
      if (a.reasoning !== b.reasoning) return a.reasoning ? 1 : -1;
      // The named default first among the rest, then alphabetical so the list
      // does not reshuffle between sessions.
      if (a.id === DEFAULT_MODEL) return -1;
      if (b.id === DEFAULT_MODEL) return 1;
      return a.id.localeCompare(b.id);
    });
}

/** The free roster with names attached, for the picker. */
export async function freeModelRows(): Promise<FreeModel[]> {
  if (rowCache && Date.now() - rowCache.at < MODEL_CACHE_MS) return rowCache.rows;

  const res = await request(`${BASE}/models`, { method: 'GET' }, null);
  const free = chatModels(Array.isArray(res?.data) ? (res.data as ModelRow[]) : []);

  rowCache = { at: Date.now(), rows: free };
  modelCache = { at: Date.now(), ids: free.map((m) => m.id) };
  return free;
}

export async function freeModels(): Promise<string[]> {
  if (modelCache && Date.now() - modelCache.at < MODEL_CACHE_MS) return modelCache.ids;
  return (await freeModelRows()).map((m) => m.id);
}

/* ------------------------------------------------------------- transport -- */

/**
 * Whatever the service said went wrong, in its own words.
 *
 * Returns null rather than throwing: a failed error-parse must never replace the
 * real failure with a parsing failure.
 */
type Failure = { said: string | null; code: string | null };

async function errorMessage(res: Response): Promise<Failure> {
  try {
    const text = await res.text();
    if (!text) return { said: null, code: null };
    try {
      const body = JSON.parse(text) as {
        error?: { message?: string; code?: string } | string;
        message?: string;
      };
      const said =
        typeof body.error === 'string'
          ? body.error
          : (body.error?.message ?? body.message ?? null);
      /*
        Sarvam names the cause: `invalid_api_key_error`, `invalid_request_error`.
        That is worth more than the status, because the status lies — a rejected
        key comes back 403, which every other provider uses for "not this model".
      */
      const code = typeof body.error === 'object' ? (body.error?.code ?? null) : null;
      return { said: said ? said.slice(0, 300) : null, code };
    } catch {
      // Not JSON — the raw body is still better than inventing a cause.
    }
    return { said: text.slice(0, 300), code: null };
  } catch {
    return { said: null, code: null };
  }
}

/**
 * Which kind of failure the router just reported.
 *
 * Pure and exported so `scripts/ai-check.mjs` can pin it, because getting this
 * wrong is not a cosmetic mistake: the caller uses the kind to decide whether
 * to try the next model or give up, and one misfiled status turns the whole
 * fallback list into a single point of failure.
 *
 * 403 and 404 both mean "not served", and only the body says which kind. A
 * data-policy rejection is a setting on the account, so every model fails it
 * identically and the run should stop and say what to change. Everything else
 * at those statuses is about one model — withdrawn, region-locked, or served
 * only to agentic harnesses — and is exactly what the roster routes around.
 */
export function classifyFailure(
  status: number,
  said: string | null,
  code: string | null = null,
): AiErrorKind {
  /*
    The body's own code wins, where there is one.

    Sarvam answers a rejected key with **403**, not 401 — and 403 is exactly the
    status this function reads as "this one model will not serve you", which
    sends the caller off to try the next model and the next, failing identically
    each time, before reporting that nothing was available. The owner is then
    looking at a message about model availability with a wrong key in their
    pocket. `invalid_api_key_error` says plainly which it is.
  */
  if (code === 'invalid_api_key_error') return 'refused';
  if (code === 'invalid_request_error') return 'bad-response';

  if (status === 429) return 'rate-limited';
  if (status === 401) return 'refused';

  // Without a code, the wording is all there is. An authentication failure
  // dressed as a 403 still has to be recognised, or the loop above repeats.
  if (/invalid or missing authentication|invalid api key|unauthori[sz]ed/i.test(said ?? '')) {
    return 'refused';
  }

  if (status === 403 || status === 404) {
    return /data policy|privacy|training|no allowed providers/i.test(said ?? '')
      ? 'policy'
      : 'model-unavailable';
  }
  return 'bad-response';
}

function defaultMessage(status: number): string {
  if (status === 429) return 'The free model is busy right now.';
  if (status === 401) return 'That API key was refused.';
  if (status === 403 || status === 404) return 'That model is not available on your account.';
  return `The service returned ${status}.`;
}

async function request(
  url: string,
  init: RequestInit,
  key: string | null,
): Promise<Record<string, unknown> & { data?: unknown; choices?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      // Read what the service actually said. Guessing the cause from the status
      // code alone is how a data-policy rejection gets reported as a bad key,
      // sending the owner off to make a second key that fails the same way.
      const { said, code } = await errorMessage(res);

      throw new AiError(
        said ?? defaultMessage(res.status),
        classifyFailure(res.status, said, code),
      );

    }

    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof AiError) throw err;
    // Abort and DNS failure are indistinguishable to the owner, and the advice
    // is the same either way.
    throw new AiError('Could not reach the model. Check your connection.', 'offline');
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------ completion -- */

export type CompleteOptions = {
  /** Lower for planning, higher for prose. Free models drift badly above ~0.7. */
  temperature?: number;
  maxTokens?: number;
  /** Tried in order. Defaults to whatever is free right now. */
  models?: string[];
};

/**
 * One completion, falling through the model list on failure.
 *
 * Rate limiting and capacity errors move to the next model; a refused key or a
 * malformed request does not, because retrying those just burns the remaining
 * quota to arrive at the same answer.
 */
export async function complete(
  messages: ChatMessage[],
  options: CompleteOptions = {},
): Promise<{ text: string; model: string }> {
  const key = await getKey();
  if (!key) throw new AiError('No API key set.', 'no-key');

  // A model the owner named goes first — they may have credits and a preference,
  // and silently substituting something else would make the setting a lie.
  const chosen = options.models ? null : await getModel();
  const discovered = options.models ?? (await freeModels().catch(() => []));

  /*
    The default is always in the list, even when discovery failed.

    Against a router with a churning roster there was no safe name to fall back
    to, so an unreachable `/models` meant no attempt at all. Here there is one,
    and letting a failed catalogue lookup stop a question the app could have
    answered is a self-inflicted outage.
  */
  const withDefault = discovered.includes(DEFAULT_MODEL)
    ? discovered
    : [...discovered, DEFAULT_MODEL];
  const listed = chosen
    ? [chosen, ...withDefault.filter((m) => m !== chosen)]
    : withDefault;

  /*
    Minus anything already proven dead this session.

    The roster is ordered by context and the longest-context free models are the
    likeliest to be gated, so without this every question re-learns the same
    refusal at the cost of a request and several seconds. The owner's own
    choice is skipped too once it has failed: a setting that cannot answer is
    not worth a round trip to honour, and the fallback exists precisely so the
    question still gets answered.
  */
  const candidates = listed.filter((m) => !unavailable.has(m));

  if (candidates.length === 0) {
    throw new AiError(
      listed.length > 0
        ? 'Every model available to this account refused. Try again later.'
        : 'No models are available right now.',
      'bad-response',
    );
  }

  let last: AiError | null = null;

  // Six rather than four: the filter above removes the models that cannot answer
  // at all, so the remaining attempts are all real ones.
  for (const model of candidates.slice(0, 6)) {
    try {
      /*
        A thinking model needs room to think before it says anything.

        `sarvam-105b` puts its working in `reasoning_content` and only then
        writes `content`. Asked for the single word "ok" inside 400 tokens it
        spent all 400 reasoning and returned `content: null` — a perfectly
        healthy request that looks, from here, exactly like a broken one. The
        conversational model answered the same question in three tokens.

        So the budget depends on which model is being asked, rather than one
        number that is either wasteful for one or fatal for the other.
      */
      const thinking = REASONING_MODELS.has(model);
      const body = JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.3,
        /*
          A caller's budget is a request, not a cap, for a model that thinks.

          `?? (thinking ? 2400 : 600)` looked right and was not: an explicit
          budget — the engine asks for 420, which is generous for five
          sentences — replaced the reasoning headroom rather than sitting inside
          it. A model asked to reason inside 420 tokens spends all of them
          reasoning and returns nothing, so choosing `sarvam-105b` in the picker
          would have failed on every question and blocklisted itself.
        */
        max_tokens: thinking
          ? Math.max(options.maxTokens ?? 600, 2400)
          : (options.maxTokens ?? 600),
      });
      const res = await request(`${BASE}/chat/completions`, { method: 'POST', body }, key);

      const choice = (
        res.choices as
          | { message?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string }[]
          | undefined
      )?.[0];
      const text = choice?.message?.content?.trim();

      if (!text) {
        /*
          Told apart, because the fixes are opposite. A model that ran out of
          room mid-thought will do it again on the next question and should be
          dropped for the session; a model that simply returned an empty string
          is a transient nothing worth one more model's attempt.
        */
        const ranOut =
          choice?.finish_reason === 'length' && Boolean(choice?.message?.reasoning_content);
        throw new AiError(
          ranOut
            ? 'That model spent its whole answer thinking and never got to the reply.'
            : 'The model returned nothing.',
          ranOut ? 'model-unavailable' : 'bad-response',
        );
      }

      return { text, model };
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError('Unexpected failure.', 'bad-response');
      // A bad key, or an account that will not accept free endpoints, fails
      // identically for every model in the list. Stop rather than walking the
      // whole roster to prove the same point six times.
      if (e.kind === 'no-key' || e.kind === 'refused' || e.kind === 'policy') throw e;
      if (e.kind === 'model-unavailable') unavailable.add(model);
      last = e;
    }
  }

  /*
    The roster ran out.

    Reporting `last` verbatim would put one model's complaint on screen as if it
    were the whole story — "inkling-small is only available on agentic
    harnesses" tells an owner nothing they can act on, and it is what they saw
    before the fallback worked. Say that everything was tried, and keep the last
    reason after it for anyone who can use it.
  */
  if (last && last.kind === 'model-unavailable') {
    throw new AiError(
      `None of the free models would answer just now. The last one said: ${last.message}`,
      'bad-response',
    );
  }
  throw last ?? new AiError('Every model refused.', 'bad-response');
}

/* ------------------------------------------------------------ listening -- */

/** What the accepted MIME list calls each container this app can produce. */
const AUDIO_TYPES: Record<string, string> = {
  aac: 'audio/aac',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
};

/**
 * A recording, turned into words by Sarvam.
 *
 * ## This is the one thing the curtain cannot cover
 *
 * `redact.ts` swaps names for tokens before any text is sent, and that promise
 * holds for everything else in this file. It cannot hold here: an owner saying
 * "how much does Meera owe me" sends the sound of the name, and there is no way
 * to redact audio without first transcribing it — which is the request itself.
 *
 * So the exposure is real and bounded to exactly this hop. The transcript is put
 * through the curtain the moment it comes back, so the *reasoning* turn that
 * follows is redacted exactly as a typed question would be. The screen that
 * offers the microphone says all of this in one sentence, because an owner
 * deciding whether to speak a customer's name deserves to know before they do.
 *
 * ## Why the container is not converted
 *
 * Sarvam refuses `audio/m4a`, which is what `expo-audio` records on Android —
 * and accepts `application/octet-stream`, which it then decodes correctly. That
 * is checked rather than assumed: an ADTS `.aac` and a real `.m4a` were both put
 * through the live endpoint and both came back 200. Converting on device would
 * cost a native dependency to solve a problem the server does not have.
 */
export async function transcribe(
  uri: string,
): Promise<{ text: string; language: string | null }> {
  const key = await getKey();
  if (!key) throw new AiError('No API key set.', 'no-key');

  const extension = uri.split('.').pop()?.toLowerCase() ?? '';
  const type = AUDIO_TYPES[extension] ?? 'application/octet-stream';

  const form = new FormData();
  // React Native's FormData takes this shape for a file rather than a Blob.
  form.append('file', { uri, name: `speech.${extension || 'm4a'}`, type } as unknown as Blob);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE.replace('/v1', '')}/speech-to-text`, {
      method: 'POST',
      signal: controller.signal,
      // No `Content-Type`: it has to carry the multipart boundary, and setting
      // it by hand omits that and produces an unparseable body.
      headers: { 'api-subscription-key': key },
      body: form,
    });

    if (!res.ok) {
      const failure = await errorMessage(res);
      throw new AiError(
        failure.said ?? `Could not hear that (${res.status}).`,
        classifyFailure(res.status, failure.said, failure.code),
      );
    }

    const body = (await res.json()) as { transcript?: string; language_code?: string };
    const text = (body.transcript ?? '').trim();
    if (!text) throw new AiError('Nothing was said, or it was too quiet to hear.', 'bad-response');

    return { text, language: body.language_code ?? null };
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError('Could not reach the model. Check your connection.', 'offline');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Confirms a pasted key actually works, before the owner relies on it.
 *
 * Hits `/key`, which is authenticated, rather than `/models`, which is not.
 * Checking against an open endpoint would report success for any string at all
 * — the owner would leave this screen believing they were connected and find out
 * days later, at the moment they needed an answer.
 */
export async function verifyKey(): Promise<{ ok: boolean; detail: string; kind?: AiError['kind'] }> {
  const key = await getKey();
  if (!key) return { ok: false, detail: 'No key saved.', kind: 'no-key' };

  try {
    // A real completion, deliberately. Checking `/key` only proves the key can
    // authenticate — it says nothing about whether the account will actually
    // serve a free model, which is a separate permission and the one that fails
    // in practice. Verifying anything less than the thing we will really do
    // means the first genuine question is where the owner discovers the problem.
    const res = await complete([{ role: 'user', content: 'Reply with the single word: ok' }], {
      temperature: 0,
      maxTokens: 5,
    });
    return { ok: true, detail: `Working — answered by ${res.model.split('/').pop()}.` };
  } catch (err) {
    const e = err instanceof AiError ? err : null;
    return {
      ok: false,
      detail: e?.message ?? 'Could not verify.',
      kind: e?.kind,
    };
  }
}
