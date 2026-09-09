import { buildIndex, type Index } from '@/domain/analytics';
import type { BusinessData, BusinessProfile } from '@/domain/model';
import { ask } from '@/domain/query';
import { curtain } from '@/ai/redact';
import { complete, type ChatMessage } from '@/ai/provider';
import { runTool, toolMenu, type ToolCall, type ToolResult } from '@/ai/tools';

/**
 * The engine.
 *
 * Three passes, and the ordering is the whole design:
 *
 *   1. Ask the device. `query.ts` answers a bounded set of questions exactly, in
 *      single-digit milliseconds, offline and free. Most real questions an owner
 *      types are in that set, so most of the time no model runs at all.
 *   2. If the device did not understand, ask a model *which lookup* to run —
 *      never what the answer is.
 *   3. Run the lookup locally, then ask the model to phrase the result.
 *
 * The model therefore sits at both ends of the pipeline and nowhere in the
 * middle: it interprets the question and it writes the sentence, and every digit
 * in between comes from the same deterministic code the rest of the app uses.
 * A model that hallucinates cannot invent someone's balance, because it is never
 * asked for one — the worst it can do is choose a lookup that does not fit,
 * which is visible in the answer and recoverable.
 *
 * This is also why a modest model is enough. Routing to one of seven tools
 * and writing two sentences from supplied facts is well within an 8B model;
 * "reason correctly about a business's finances from raw records" is not, and
 * pretending otherwise is how these features end up confidently wrong.
 */

export type Source = 'local' | 'ai';

export type Reply = {
  text: string;
  source: Source;
  /** Which lookup ran, for the disclosure line under the answer. */
  usedTool?: string;
  /** People named in the reply, so the UI can offer to open them. */
  partyIds: string[];
  model?: string;
};

const PLAN_SYSTEM = `You route questions about a small business to exactly one lookup.

Available lookups:
{{TOOLS}}

Reply with ONLY a JSON object: {"tool": "<name>", "args": {...}}
If no lookup fits, reply {"tool": null}.
No prose, no code fences, no explanation.`;

/*
  Loosened, deliberately, and only where it was style rather than safety.

  This said "two sentences at most" and "do not add advice unless the owner asked
  for it". Both were meant to stop a model padding, and together they produced an
  assistant that felt gagged: "should I raise my prices" routes to the findings
  and then came back as two flat sentences with the answer to the actual question
  withheld. The owner reads that as a model that cannot think.

  The rule that matters is untouched and is now stated harder — every figure comes
  from the lookup, and one that is not in the lookup may not appear at all. What
  changed is how much room it has to say the thing it was given.
*/
const WRITE_SYSTEM = `You are the assistant inside a small-business app. The owner asked a question and the app looked up the answer.

Rules:
- Use ONLY the figures in the lookup result. Never invent one, never estimate, never round differently, and never introduce a number that is not in the result.
- If the result does not answer the question, say so plainly and say what would.
- Use as many sentences as the question needs, up to five. Most need one or two. Never pad.
- Plain language. No headings, no bullet points, no markdown.
- People are referred to by tokens like P4. Keep the tokens exactly as written.
- If the owner asked what they should do, answer them — reasoning from the figures in front of you, not from general business advice.`;

const CHAT_SYSTEM = `You are the assistant inside Counter, an app that keeps the books for a small business. You are talking to the owner.

This turn has NO access to their records.

Rules:
- Never state a figure, a name, a count or a date about their business. Not a guess, not "roughly", not "around". If they asked for one, say what to ask instead and stop.
- Up to five sentences, and usually fewer. Plain language, no headings, no bullet points, no markdown.
- Answer ordinary questions normally, including ones that have nothing to do with the business.
- People may appear as tokens like P4. Keep them exactly as written.
- If asked what you can do, mention: takings, who owes money, who has stopped coming, the busiest day, and what needs doing today.`;

/** Pulls the first JSON object out of a reply, tolerating fences and stray prose. */
function parsePlan(raw: string): ToolCall | null {
  const fenced = raw.replace(/```(?:json)?/gi, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(fenced.slice(start, end + 1)) as {
      tool?: unknown;
      args?: unknown;
    };
    if (typeof parsed.tool !== 'string' || parsed.tool.length === 0) return null;
    const args =
      parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
        ? (parsed.args as Record<string, unknown>)
        : {};
    return { tool: parsed.tool, args };
  } catch {
    return null;
  }
}

export type AnswerOptions = {
  now?: number;
  index?: Index;
  /** Prior turns, already redacted. Kept short — a long history costs tokens on
   *  every turn and buys very little for questions this self-contained. */
  history?: ChatMessage[];
};

/**
 * A device answer as one sentence.
 *
 * The headline is the figure and the detail is the sentence about it, and for
 * most answers joining them reads well — "12 — 12 customers have gone quiet".
 * For the ones whose detail already opens with the figure it read "₹43k — ₹43k
 * is outstanding across 29 customers", which is the same redundancy the Now
 * tiles had and looks like a bug in the same way.
 *
 * Exported because the chat surface phrases the same answers and had grown its
 * own copy of the join, so a fix here would have missed the place people
 * actually read it.
 */
export function phraseLocal(local: { headline: string; detail: string }): string {
  if (!local.headline) return local.detail;
  return local.detail.startsWith(local.headline)
    ? local.detail
    : `${local.headline} — ${local.detail}`;
}

export async function answer(
  profile: BusinessProfile,
  data: BusinessData,
  question: string,
  options: AnswerOptions = {},
): Promise<Reply> {
  const now = options.now ?? Date.now();

  /* -- 1. the device ----------------------------------------------------- */
  const local = ask(profile, data, question, now);
  if (local.ok) {
    const text = phraseLocal(local);
    return {
      text,
      source: 'local',
      partyIds: local.rows.map((r) => r.partyId).filter((id): id is string => Boolean(id)),
    };
  }

  /* -- 2. route ---------------------------------------------------------- */
  const index = options.index ?? buildIndex(data);
  const screen = curtain(data);
  const safeQuestion = screen.hide(question);

  const plan = await complete(
    [
      { role: 'system', content: PLAN_SYSTEM.replace('{{TOOLS}}', toolMenu()) },
      ...(options.history ?? []).slice(-4),
      { role: 'user', content: safeQuestion },
    ],
    // Routing is a classification, not a creative act. Near-zero temperature and
    // a tight token budget: anything long is prose the parser will reject anyway.
    { temperature: 0, maxTokens: 120 },
  );

  const call = parsePlan(plan.text);

  /* -- 2a. nothing to look up, so just talk ------------------------------- */
  /*
    "Hello" used to end here, with `I could not work out which figures you
    wanted`. The planner had done its job perfectly — it answered `{"tool":
    null}`, because no lookup fits a greeting — and the engine treated a correct
    answer as a failure. Anything that was not a question about a figure fell
    into the same hole: what can you do, thanks, how does this work.

    So a missing plan becomes a conversation instead. The safety property is
    untouched and is the reason this branch needs its own prompt: there is no
    lookup result in front of the model here, so it is told in the plainest
    terms available that it may not state a figure. The rule the app rests on —
    the model never produces a number — is enforced by never giving it one to
    repeat and by saying so.

    An unparseable plan lands here too. A model that returned prose where JSON
    was asked for is a model having a conversation, and answering it as one is
    better than showing the owner a parser error.
  */
  if (!call) {
    const chat = await complete(
      [
        { role: 'system', content: CHAT_SYSTEM },
        ...(options.history ?? []).slice(-4),
        { role: 'user', content: safeQuestion },
      ],
      { temperature: 0.4, maxTokens: 420 },
    );
    return {
      text: screen.reveal(chat.text),
      source: 'ai',
      partyIds: [],
      model: chat.model,
    };
  }

  /* -- 3. look it up, then phrase it ------------------------------------- */
  const result: ToolResult = runTool(call, profile, data, screen, now, index);

  const written = await complete(
    [
      { role: 'system', content: WRITE_SYSTEM },
      {
        role: 'user',
        content: `Question: ${safeQuestion}\n\nLookup result:\n${result.text}`,
      },
    ],
    { temperature: 0.2, maxTokens: 420 },
  );

  return {
    // Names go back in only here, at the very last step, after everything that
    // could have left the device already has.
    text: screen.reveal(written.text),
    source: 'ai',
    usedTool: call.tool,
    partyIds: result.partyIds,
    model: written.model,
  };
}

/**
 * A redacted transcript entry, for carrying context between turns.
 *
 * History has to stay behind the curtain too. Revealing names for display and
 * then feeding the displayed text back into the next request would leak every
 * identity on the second question — the subtle way this kind of feature usually
 * breaks its own privacy promise.
 */
export function toHistory(data: BusinessData, question: string, reply: string): ChatMessage[] {
  const screen = curtain(data);
  return [
    { role: 'user', content: screen.hide(question) },
    { role: 'assistant', content: screen.hide(reply) },
  ];
}
