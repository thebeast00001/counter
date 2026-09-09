import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { AiError } from '@/ai/provider';
import { answer as askModel, phraseLocal, toHistory } from '@/ai/engine';
import { getKey } from '@/ai/keys';
import type { ChatMessage } from '@/ai/provider';
import { ask } from '@/domain/query';
import { useBusiness } from '@/state/business';

/**
 * The conversation, and whether it is on screen.
 *
 * The assistant used to be a screen you navigated to, which made it a place
 * rather than a thing you could ask. Pulling it out of the bar instead means
 * the question happens on top of whatever the owner was already looking at —
 * and the answer lands beside the figures it is about rather than replacing
 * them.
 *
 * Split into a frozen actions context and a live state context, for the reason
 * `undo.tsx` is: the bar subscribes to `open` on every screen in the app, and a
 * combined value would hand every one of them a new object on each keystroke.
 */

export type Turn = {
  id: string;
  role: 'you' | 'app';
  text: string;
  /** Anyone named in the reply, so the transcript can offer to open them. */
  partyIds?: string[];
  failed?: boolean;
};

/** Closed, pulled up to a panel, or taken to the full screen. */
export type Stage = 'closed' | 'open' | 'full';

type Actions = {
  openChat: () => void;
  closeChat: () => void;
  setStage: (stage: Stage) => void;
  send: (text: string) => void;
  clear: () => void;
};

type State = {
  stage: Stage;
  turns: Turn[];
  thinking: boolean;
};

const ActionsContext = createContext<Actions | null>(null);
const StateContext = createContext<State>({ stage: 'closed', turns: [], thinking: false });

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const { profile, data } = useBusiness();

  const [stage, setStageRaw] = useState<Stage>('closed');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [thinking, setThinking] = useState(false);

  /*
    Ids from a counter, not from the clock.

    The React Compiler is on and render has to stay pure, so `Date.now()` is not
    available where a key is needed. A counter in a ref is monotonic, cheap, and
    cannot collide inside one session.
  */
  const seq = useRef(0);
  const nextId = useCallback(() => {
    seq.current += 1;
    return `t${seq.current}`;
  }, []);

  /*
    History stays behind the curtain.

    `toHistory` redacts both halves before they are kept. Storing the displayed
    text and replaying it on the next turn is the usual way this promise breaks:
    the first answer reveals a name for the reader, and the second request
    carries it to the server.
  */
  const history = useRef<ChatMessage[]>([]);

  /** Live values for the async path, so a stale closure cannot answer. */
  const latest = useRef({ profile, data });
  latest.current = { profile, data };

  /*
    The id is computed before the updater, never inside it.

    React may run a state updater twice, so anything impure in there runs twice
    and can disagree with itself — two turns with different ids from one call,
    or the same id from two. `nextId` bumps a ref outside the updater, which is
    the only place it is safe to.
  */
  const push = useCallback(
    (turn: Omit<Turn, 'id'>) => {
      const id = nextId();
      setTurns((prev) => [...prev, { ...turn, id }]);
    },
    [nextId],
  );

  const send = useCallback(
    (text: string) => {
      const question = text.trim();
      if (question.length < 2) return;

      const { profile: p, data: d } = latest.current;
      if (!p) return;

      push({ role: 'you', text: question });

      /*
        The device answers first, and most of the time that is the whole
        transaction: no network, no key, no wait. Only a miss is worth a round
        trip, and escalating a question the device already understood would be
        slower and less accurate for no gain.
      */
      const local = ask(p, d, question);
      if (local.ok) {
        const said = phraseLocal(local);
        push({
          role: 'app',
          text: said,
          partyIds: local.rows.map((r) => r.partyId).filter((id): id is string => Boolean(id)),
        });
        history.current = [...history.current, ...toHistory(d, question, said)].slice(-6);
        return;
      }

      setThinking(true);
      void (async () => {
        const key = await getKey();
        if (!key) {
          setThinking(false);
          push({
            role: 'app',
            text: 'That is not one I can work out on this phone. Connecting a model in Settings lets me answer the rest.',
            failed: true,
          });
          return;
        }

        try {
          const reply = await askModel(p, d, question, { history: history.current });
          push({ role: 'app', text: reply.text, partyIds: reply.partyIds });
          history.current = [...history.current, ...toHistory(d, question, reply.text)].slice(-6);
        } catch (err) {
          push({
            role: 'app',
            text: err instanceof AiError ? err.message : 'Something went wrong.',
            failed: true,
          });
        } finally {
          setThinking(false);
        }
      })();
    },
    [push],
  );

  const openChat = useCallback(() => setStageRaw('open'), []);
  const closeChat = useCallback(() => setStageRaw('closed'), []);
  const setStage = useCallback((next: Stage) => setStageRaw(next), []);
  const clear = useCallback(() => {
    setTurns([]);
    history.current = [];
  }, []);

  const actions = useMemo<Actions>(
    () => ({ openChat, closeChat, setStage, send, clear }),
    [openChat, closeChat, setStage, send, clear],
  );
  const state = useMemo<State>(() => ({ stage, turns, thinking }), [stage, turns, thinking]);

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/** Frozen — safe for the bar on every screen to hold. */
export function useAssistant(): Actions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error('useAssistant outside AssistantProvider');
  return value;
}

/** Live — only the sheet and the bar's own open/closed check want this. */
export function useAssistantState(): State {
  return useContext(StateContext);
}
