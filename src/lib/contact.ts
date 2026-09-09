import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

/**
 * Reaching a customer, from a phone number typed by hand into a small business's
 * records.
 *
 * Every outbound route in the app goes through here so the messy parts — country
 * codes, WhatsApp's addressing, and what to do when an app is not installed —
 * are solved once rather than at each of the six call sites that need them.
 */

/** India, because that is where the numbers in these records come from. */
const DEFAULT_CC = '91';

/**
 * Normalises a number for WhatsApp, which wants full international digits and no
 * punctuation at all.
 *
 * Owners type numbers however they think of them — `98765 43210`, `+91 98765
 * 43210`, `098765-43210`. All three are the same person.
 */
export function toInternational(raw: string, countryCode = DEFAULT_CC): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `${countryCode}${digits}`;
  // A leading zero is a domestic trunk prefix and is never part of the
  // international form.
  if (digits.length === 11 && digits.startsWith('0')) return `${countryCode}${digits.slice(1)}`;
  return digits;
}

export function canMessage(phone?: string | null): boolean {
  return Boolean(phone && phone.replace(/\D/g, '').length >= 10);
}

/**
 * A number reduced to what may safely appear in a `tel:` or `sms:` URL.
 *
 * These strings are typed by owners and imported from the device address book,
 * so they arrive with spaces, brackets, and occasionally worse. Interpolating
 * them raw builds a URL out of untrusted text: a `#` truncates everything after
 * it at the URL parser, so a stored number ending in one silently dials a
 * different, shorter number, and `&` or `?` can append parameters the caller
 * never wrote — on `sms:` that means rewriting the body of a message the owner
 * thinks they are sending.
 *
 * Keeping only digits and a leading `+` removes the whole class. Nothing legible
 * is lost: no dialable number needs any other character.
 */
function dialable(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/\D/g, '');
}

/**
 * Opens WhatsApp with the message ready to send.
 *
 * Two routes, deliberately in this order.
 *
 * The `whatsapp://` scheme lands straight in the conversation with no
 * intermediate page, which is what an owner working through a list of fourteen
 * people actually needs. It is not usable via `canOpenURL` — from Android 11 an
 * app can only *see* schemes it declared in its manifest, and Expo Go has not
 * declared this one — but launching is not gated the same way as querying, so
 * `openURL` still works and simply throws when WhatsApp is absent.
 *
 * `wa.me` is the backstop for the cases where it does throw despite WhatsApp
 * being installed. It is an https link matched by WhatsApp's own intent filter,
 * so it cannot be blocked; the cost is a possible browser bounce, which is why
 * it is second rather than first.
 */
export async function openWhatsApp(phone: string, message: string): Promise<boolean> {
  const to = toInternational(phone);
  if (to.length < 10) return false;
  const text = encodeURIComponent(message);

  try {
    await Linking.openURL(`whatsapp://send?phone=${to}&text=${text}`);
    return true;
  } catch {
    // WhatsApp did not answer the scheme. Fall through to the universal link.
  }

  try {
    await Linking.openURL(`https://wa.me/${to}?text=${text}`);
    return true;
  } catch {
    return false;
  }
}

/** The phone's own SMS app, with the body pre-filled. */
export async function openSms(phone: string, message: string): Promise<boolean> {
  const to = dialable(phone);
  if (!to) return false;
  // Android and iOS disagree on the separator, and getting it wrong silently
  // drops the body — the message app opens empty and the owner retypes it.
  const separator = Platform.OS === 'ios' ? '&' : '?';
  try {
    await Linking.openURL(`sms:${to}${separator}body=${encodeURIComponent(message)}`);
    return true;
  } catch {
    return false;
  }
}

export async function openCall(phone: string): Promise<boolean> {
  const to = dialable(phone);
  if (!to) return false;
  try {
    await Linking.openURL(`tel:${to}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * WhatsApp first, SMS if that fails.
 *
 * This order is not a preference, it is where these conversations actually
 * happen — a fee reminder from a tuition centre arrives on WhatsApp or it does
 * not arrive. SMS is the fallback, not the default.
 */
export async function message(phone: string, text: string): Promise<'whatsapp' | 'sms' | null> {
  if (await openWhatsApp(phone, text)) return 'whatsapp';
  if (await openSms(phone, text)) return 'sms';
  return null;
}
