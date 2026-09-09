import { usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import {
  runOnJS,
  useAnimatedScrollHandler,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

import { useMotion } from '@/design/motion';
import { spring } from '@/design/tokens';

/**
 * Whether the floating bar is on screen, and what moves it.
 *
 * The bar covers the bottom of every screen, which is the right trade while a
 * thumb is reaching for it and the wrong one while somebody is reading. So it
 * follows the scroll: down takes it away, up brings it back, and two seconds
 * after the scrolling stops it leaves on its own.
 *
 * `hidden` is a shared value driven entirely on the UI thread — the bar has to
 * keep up with a finger, and a React state update per scroll frame is the one
 * way to guarantee it cannot. React only hears about this at all through
 * `hold`, which fires a handful of times a session.
 *
 * Split into a frozen actions context and a live value the same way `undo.tsx`
 * is: the bar and every scrolling screen subscribe, and a combined value would
 * hand all of them a new object on each navigation.
 */

/** How long after the last scroll the bar sees itself out. */
const IDLE_MS = 2000;

type Chrome = {
  hidden: SharedValue<number>;
  /** Bring it back and cancel any pending exit. */
  show: () => void;
  /** Keep it up regardless of scrolling — an undo offer nobody could reach is worse. */
  hold: (active: boolean) => void;
};

const ChromeContext = createContext<Chrome | null>(null);

export function DockChromeProvider({ children }: { children: React.ReactNode }) {
  const hidden = useSharedValue(0);
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clear();
    hidden.value = withSpring(0, spring.standard);
  }, [clear, hidden]);

  const hold = useCallback(
    (active: boolean) => {
      held.current = active;
      if (active) show();
    },
    [show],
  );

  /*
    Armed from the scroll handler when a drag or a fling ends. Never from
    `onScroll` — that would cross to the JS thread sixty times a second to
    reschedule a timer that only matters once.
  */
  const arm = useCallback(() => {
    if (held.current) return;
    clear();
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!held.current) hidden.value = withSpring(1, spring.standard);
    }, IDLE_MS);
  }, [clear, hidden]);

  /*
    A new screen always starts with its bar. Without this you arrive somewhere
    with no navigation and no idea that scrolling up is what brings it back.
  */
  useEffect(() => {
    show();
  }, [pathname, show]);

  useEffect(() => clear, [clear]);

  const value = useMemo<Chrome>(() => ({ hidden, show, hold }), [hidden, show, hold]);
  const armRef = useMemo(() => ({ arm, cancel: clear }), [arm, clear]);

  return (
    <ChromeContext.Provider value={value}>
      <ArmContext.Provider value={armRef}>{children}</ArmContext.Provider>
    </ChromeContext.Provider>
  );
}

const ArmContext = createContext<{ arm: () => void; cancel: () => void } | null>(null);

/** For the bar itself. */
export function useDockChrome(): Chrome | null {
  return useContext(ChromeContext);
}

/**
 * A scroll handler that moves the bar, for a screen's main scroll view.
 *
 * Screens that already track their own offset — the two with collapsing
 * headers — pass their shared value in rather than running a second handler
 * beside this one, because two `useAnimatedScrollHandler`s on one view means
 * only the last one attached receives events.
 */
export function useBarScrollHandler(track?: SharedValue<number>) {
  const chrome = useContext(ChromeContext);
  const armed = useContext(ArmContext);
  const { reduced } = useMotion();

  const last = useSharedValue(0);
  const hidden = chrome?.hidden;
  const arm = armed?.arm;
  const cancel = armed?.cancel;

  return useAnimatedScrollHandler(
    {
      onScroll: (e) => {
        const y = e.contentOffset.y;
        if (track) track.value = y;
        if (!hidden || reduced) {
          last.value = y;
          return;
        }

        const dy = y - last.value;
        last.value = y;

        // The top of a page always has its bar: there is nothing above to read,
        // and arriving to a hidden bar after a scroll-to-top reads as a fault.
        if (y <= 4) {
          hidden.value = withSpring(0, spring.standard);
          return;
        }

        // A threshold rather than a sign test. Without it the few pixels of
        // wobble at the end of a fling flip the bar back and forth.
        if (dy > 6) hidden.value = withSpring(1, spring.standard);
        else if (dy < -6) hidden.value = withSpring(0, spring.standard);
      },
      onBeginDrag: () => {
        // Cancelled, not re-armed: the exit is owed two seconds of stillness,
        // and a long drag would otherwise reach zero with a finger still down.
        if (cancel && !reduced) runOnJS(cancel)();
      },
      onEndDrag: () => {
        if (arm && !reduced) runOnJS(arm)();
      },
      onMomentumEnd: () => {
        if (arm && !reduced) runOnJS(arm)();
      },
    },
    [hidden, arm, cancel, track, reduced],
  );
}
