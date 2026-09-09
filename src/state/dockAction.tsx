import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/**
 * A screen's one primary action, published into the floating bar.
 *
 * Inner screens used to pin their own footer button above the tab inset, which
 * put two competing bars at the bottom of the same screen — and the worklist's
 * pinned one sat *underneath* the floating bar, so the button a screen exists to
 * offer was the one thing you could not reach.
 *
 * Padding around the bar would have fixed the overlap and left the real problem:
 * two surfaces claiming the same corner of the thumb's reach. The bar already
 * answers "what next, from here", so a screen's primary action belongs in it
 * rather than beside it.
 *
 * Split into a frozen actions context and a live state context for the reason
 * `undo.tsx` documents: a combined value changes identity on every navigation
 * and re-renders every screen that only wanted the setter.
 */

export type DockPrimary = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** `warn` for destructive or unfinished work, otherwise the accent. */
  tone?: 'accent' | 'warn';
};

type Actions = { publish: (action: DockPrimary | null) => void };

const ActionsContext = createContext<Actions>({ publish: () => {} });
const StateContext = createContext<DockPrimary | null>(null);

export function DockActionProvider({ children }: { children: React.ReactNode }) {
  const [primary, setPrimary] = useState<DockPrimary | null>(null);

  const actions = useMemo<Actions>(() => ({ publish: setPrimary }), []);

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={primary}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/**
 * Publishes an action for as long as the screen is mounted.
 *
 * Pass null to withdraw it. The cleanup clears only if nothing else has claimed
 * the slot since, so a push that mounts the next screen before unmounting this
 * one does not leave the bar empty.
 */
export function useDockPrimary(action: DockPrimary | null): void {
  const { publish } = useContext(ActionsContext);
  const { label, onPress, disabled, tone } = action ?? {};

  useEffect(() => {
    if (!label || !onPress) {
      publish(null);
      return;
    }
    const mine: DockPrimary = { label, onPress, disabled, tone };
    publish(mine);
    return () => publish(null);
    // `onPress` is a fresh closure each render; depending on it would republish
    // every frame. The label, tone and disabled flag are what the bar draws.
  }, [publish, label, disabled, tone]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Read by the bar. */
export function useDockPrimaryValue(): DockPrimary | null {
  return useContext(StateContext);
}
