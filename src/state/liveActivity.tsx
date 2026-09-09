import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * Transient live activities.
 *
 * The dock's activity row is not a permanent fixture. It appears when something
 * actually happens — a session is running, a goal was met, a task was finished —
 * and retracts once that is no longer true. A bar that is always on screen stops
 * being read at all, and costs vertical space every second it says nothing.
 *
 * Two kinds live here:
 *  - a running session, which is derived from the session store rather than
 *    pushed, so it can never drift out of sync with the timer;
 *  - one-off events, pushed from anywhere via `notifyActivity` and expiring on
 *    their own.
 */
export type ActivityTone = 'accent' | 'success' | 'warn' | 'neutral';

export type ActivityIcon = 'check' | 'flame' | 'target' | 'users' | 'clock' | 'sparkle';

export type LiveActivity = {
  id: string;
  icon: ActivityIcon;
  title: string;
  subtitle?: string;
  tone: ActivityTone;
  /** Milliseconds before it retracts on its own. */
  ttl: number;
};

export type ActivityInput = Omit<LiveActivity, 'id' | 'tone' | 'ttl'> &
  Partial<Pick<LiveActivity, 'tone' | 'ttl'>>;

/** Long enough to read a short sentence without becoming furniture. */
const DEFAULT_TTL = 6000;

type LiveActivityValue = {
  activities: LiveActivity[];
  notify: (input: ActivityInput) => void;
  dismiss: (id: string) => void;
};

const LiveActivityContext = createContext<LiveActivityValue | null>(null);

/**
 * Bridge for non-React callers.
 *
 * The session and library stores raise events from inside reducers and effects
 * where hooks are not available. The provider parks its push function here on
 * mount so those call sites stay plain functions.
 */
let externalPush: ((input: ActivityInput) => void) | null = null;

export function notifyActivity(input: ActivityInput): void {
  externalPush?.(input);
}

export function LiveActivityProvider({ children }: { children: React.ReactNode }) {
  const [activities, setActivities] = useState<LiveActivity[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setActivities((prev) => prev.filter((a) => a.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (input: ActivityInput) => {
      const id = `a_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
      const activity: LiveActivity = {
        id,
        tone: 'accent',
        ttl: DEFAULT_TTL,
        ...input,
      };
      // Newest first: the thing that just happened is the thing to show.
      setActivities((prev) => [activity, ...prev].slice(0, 3));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), activity.ttl),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    externalPush = notify;
    return () => {
      externalPush = null;
    };
  }, [notify]);

  // Clear pending timers on unmount so a dismissal cannot fire into a dead tree.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  return (
    <LiveActivityContext.Provider value={{ activities, notify, dismiss }}>
      {children}
    </LiveActivityContext.Provider>
  );
}

export function useLiveActivity(): LiveActivityValue {
  const ctx = useContext(LiveActivityContext);
  if (!ctx) throw new Error('useLiveActivity must be used inside <LiveActivityProvider>');
  return ctx;
}
