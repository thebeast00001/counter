import Constants, { AppOwnership } from 'expo-constants';

import { startOfDay } from '@/domain/analytics';
import { money } from '@/domain/metrics';
import type { BusinessData, BusinessProfile } from '@/domain/model';
import { plural } from '@/domain/words';

/**
 * The one thing the app could not do: speak first.
 *
 * Everything here is built to notice — overdue money, somebody drifting, a
 * licence coming up — and none of it could reach the owner unless they happened
 * to open the app. A business tool that only works when you remember to consult
 * it is a filing cabinet.
 *
 * ## Nothing identifying, ever
 *
 * A notification is read on a lock screen, in public, by whoever is standing
 * there. So these carry counts and amounts and never a name — the same promise
 * `src/ai/redact.ts` makes about the model, for the same reason and with less
 * excuse for breaking it, because here it would be visible to a stranger rather
 * than to a server.
 *
 * ## Why the module is reached through a guarded require
 *
 * `expo-notifications` does not merely fail in Expo Go — it **throws on import**,
 * because Expo removed Android push from the Go client in SDK 53 and the module
 * refuses to load rather than pretending. A plain `import` at the top of this
 * file therefore took the entire app down at startup, on the one client this
 * project is required to run on. It is resolved lazily and inside a `try` for
 * the same reason `shareImage.ts` and `supabase.ts` resolve theirs: a feature
 * that cannot work here has to degrade to *nothing*, not to a crash.
 *
 * Everything below returns `false` when the module is absent, and
 * `remindersAvailable()` lets the settings screen say why rather than offering a
 * switch that silently does nothing.
 *
 * ## Why the text is baked in advance
 *
 * Expo Go runs no background task, so nothing can compute a figure at the
 * moment a notification fires. The text has to be written when it is scheduled.
 * That is fine for tomorrow and dishonest by next week, so only the next day's
 * notification carries real figures; the six after it carry a nudge that cannot
 * go stale. Re-armed every time the app opens, which is most days, the owner
 * only ever sees the accurate one.
 */

/*
  Resolved once, lazily, and never allowed to throw.

  Typed against the real module so the calls below are still checked, while the
  value itself may be null at runtime.
*/
type NotificationsModule = typeof import('expo-notifications');

let resolved: NotificationsModule | null | undefined;

function notifications(): NotificationsModule | null {
  if (resolved !== undefined) return resolved;

  /*
    Asked before it is required, not caught after.

    The first attempt wrapped the `require` in a `try` — and the throw still
    reached the red box, because the module does not fail cleanly on the call:
    it reports through React Native's global handler, which no local `catch` is
    in a position to stop. So the question has to be settled before the module
    is touched at all.

    `appOwnership` rather than `executionEnvironment`, deprecation and all:
    `executionEnvironment` reports `storeClient` for Expo Go *and* for a
    development build, and notifications work perfectly well in the second. This
    is the only field that separates the one client where the module is missing
    from every client where it is not, so using the modern field here would
    switch the feature off for the builds that can actually run it.
  */
  if (Constants.appOwnership === AppOwnership.Expo) {
    resolved = null;
    return resolved;
  }

  try {
    resolved = require('expo-notifications') as NotificationsModule;
  } catch {
    resolved = null;
  }
  return resolved;
}

/** False in Expo Go, true in a development or production build. */
export function remindersAvailable(): boolean {
  return notifications() !== null;
}

/** How far ahead to fill in, so the app going unopened does not end the reminders. */
const DAYS_AHEAD = 7;

const DAY = 24 * 60 * 60 * 1000;

export type ReminderTime = 'morning' | 'midday' | 'evening';

export const REMINDER_HOURS: Record<ReminderTime, number> = {
  morning: 8,
  midday: 13,
  evening: 19,
};

export type ReminderSettings = { enabled: boolean; at: ReminderTime };

export const DEFAULT_REMINDERS: ReminderSettings = { enabled: false, at: 'morning' };

/* ------------------------------------------------------------------ copy -- */

/**
 * What today looks like, in counts.
 *
 * Returns null when there is genuinely nothing — a notification that fires to
 * say nothing is wrong is how an owner learns to swipe them away unread, and
 * then the one that mattered goes with it.
 */
export function reminderBody(
  profile: BusinessProfile,
  data: BusinessData,
  now: number,
): string | null {
  const dayStart = startOfDay(now);
  const parts: string[] = [];

  const overdue = data.money.filter(
    (m) => m.direction === 'in' && m.status === 'due' && (m.dueAt ?? m.at) < dayStart,
  );
  if (overdue.length > 0) {
    const total = overdue.reduce((s, m) => s + m.amount, 0);
    parts.push(
      `${money(total)} overdue from ${overdue.length} ${plural(
        overdue.length,
        profile.vocabulary.party,
      ).toLowerCase()}`,
    );
  }

  const dueToday = data.money.filter(
    (m) =>
      m.direction === 'in' &&
      m.status === 'due' &&
      (m.dueAt ?? m.at) >= dayStart &&
      (m.dueAt ?? m.at) < dayStart + DAY,
  );
  if (dueToday.length > 0) {
    parts.push(`${money(dueToday.reduce((s, m) => s + m.amount, 0))} due today`);
  }

  const soon = data.obligations.filter(
    (o) => !o.done && o.dueAt <= now + (o.leadDays ?? 3) * DAY,
  );
  if (soon.length > 0) {
    parts.push(`${soon.length} ${soon.length === 1 ? 'thing' : 'things'} to renew or file`);
  }

  if (parts.length === 0) return null;
  return parts.join(' · ');
}

/* ------------------------------------------------------------- scheduling -- */

/** Local time of the next occurrence of `hour`, strictly in the future. */
function nextAt(hour: number, now: number, dayOffset: number): Date {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + dayOffset);
  return d;
}

export async function permissionGranted(): Promise<boolean> {
  const N = notifications();
  if (!N) return false;
  try {
    const current = await N.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const asked = await N.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export async function cancelReminders(): Promise<void> {
  const N = notifications();
  if (!N) return;
  try {
    await N.cancelAllScheduledNotificationsAsync();
  } catch {
    // Nothing scheduled, or no notification support. Either way there is
    // nothing left to cancel.
  }
}

/**
 * Replaces the whole schedule with a fresh week.
 *
 * Cancel-then-schedule rather than reconciling: seven entries is cheap to
 * rebuild and impossible to get subtly wrong, whereas diffing them against
 * whatever a previous version of the app left behind is neither.
 */
export async function armReminders(
  profile: BusinessProfile,
  data: BusinessData,
  at: ReminderTime,
  now = Date.now(),
): Promise<boolean> {
  const N = notifications();
  if (!N) return false;
  if (!(await permissionGranted())) return false;

  await cancelReminders();

  const hour = REMINDER_HOURS[at];
  const today = reminderBody(profile, data, now);

  try {
    for (let day = 0; day < DAYS_AHEAD; day++) {
      const date = nextAt(hour, now, day);

      // Only the first one may quote a figure. See the note at the top.
      const body =
        day === 0 && today
          ? today
          : 'Open Counter to see what needs you.';

      await N.scheduleNotificationAsync({
        content: {
          title: profile.name,
          body,
          // No payload: a notification carrying record ids is a notification
          // that has to be reasoned about when the records change under it.
        },
        trigger: { type: N.SchedulableTriggerInputTypes.DATE, date },
      });
    }
    return true;
  } catch {
    return false;
  }
}
