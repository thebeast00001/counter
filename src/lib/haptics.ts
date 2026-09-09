import * as Haptics from 'expo-haptics';

/**
 * Haptic signatures — one distinct shape per kind of outcome.
 *
 * Everything used to fire the same light tap, which meant the phone said "you
 * touched something" and nothing more. That is a wasted channel: an owner
 * recording twenty check-ins is not looking at the screen for most of them, and
 * touch is the only sense that is free at that moment.
 *
 * Each signature is a short rhythm rather than a single pulse, because rhythm is
 * what the hand can actually tell apart. A single Heavy and a single Medium are
 * indistinguishable through a case; two taps and one tap are not.
 *
 * The rule for adding one: it must correspond to an outcome the owner would want
 * to know about without looking. Anything that only means "received" stays a
 * plain tap — a vocabulary where everything is distinctive is one where nothing
 * is.
 */

const Impact = Haptics.ImpactFeedbackStyle;
const Notify = Haptics.NotificationFeedbackType;

/** Fire-and-forget throughout: a failed haptic must never interrupt an interaction. */
const impact = (style: Haptics.ImpactFeedbackStyle) => Haptics.impactAsync(style).catch(() => {});
const notify = (type: Haptics.NotificationFeedbackType) =>
  Haptics.notificationAsync(type).catch(() => {});

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Something was written down. One firm tap — the most common event in the app,
 * so it stays the shortest.
 */
export function tapRecorded(): void {
  impact(Impact.Medium);
}

/**
 * Money arrived. Two rising taps, light then heavy: the shape of something
 * landing rather than something being noted.
 */
export async function tapSettled(): Promise<void> {
  await impact(Impact.Light);
  await wait(70);
  await impact(Impact.Heavy);
}

/**
 * An action was taken back. The settle signature reversed — heavy then light,
 * falling away. Undo should feel like the opposite of what it undoes.
 */
export async function tapUndone(): Promise<void> {
  await impact(Impact.Heavy);
  await wait(70);
  await impact(Impact.Light);
}

/**
 * A batch finished — a whole session recorded, a list worked through. Three
 * quick taps, the only signature with a third beat, reserved for the end of
 * something rather than a step inside it.
 */
export async function tapCompleted(): Promise<void> {
  await impact(Impact.Light);
  await wait(55);
  await impact(Impact.Light);
  await wait(55);
  await impact(Impact.Medium);
}

/** Refused, or nothing to do. The system warning shape — already learned. */
export function tapRefused(): void {
  notify(Notify.Warning);
}

/** Something is now committed and cannot be quietly re-entered. */
export function tapConfirmed(): void {
  notify(Notify.Success);
}
