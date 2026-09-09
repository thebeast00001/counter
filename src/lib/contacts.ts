type ContactsModule = typeof import('expo-contacts');

/**
 * Reading the phone's own address book.
 *
 * Guarded require, like the vault and the share capture: a missing native module
 * degrades to "not available" rather than taking the screen down. Onboarding is
 * the worst possible place for a crash — there is no app to go back to yet.
 */
const Contacts: ContactsModule | null = (() => {
  try {
    return require('expo-contacts');
  } catch {
    return null;
  }
})();

export type DeviceContact = {
  id: string;
  name: string;
  phone?: string;
};

export type ContactsResult =
  | { ok: true; contacts: DeviceContact[] }
  | { ok: false; reason: 'unavailable' | 'denied' | 'failed' };

export function contactsAvailable(): boolean {
  return Contacts !== null;
}

/**
 * Asks, then reads.
 *
 * The permission prompt is deliberately not pre-empted with a custom dialog
 * explaining why. The screen it is launched from already says what it is for and
 * what happens to the result; a second dialog in front of the system one is a
 * dark pattern dressed as courtesy, and it trains people to dismiss both.
 *
 * Only names and phone numbers are requested. The address book also holds
 * emails, addresses, birthdays and photos, and asking for fields the app cannot
 * use is how an import feature becomes a privacy incident.
 *
 * Uses `Contact.getAllDetails` rather than `getContactsAsync`. SDK 57 rewrote
 * this module: the old call still exports, but only as a shim that throws
 * `Method getContactsAsync imported from "expo-contacts" is deprecated` at
 * runtime — it typechecks, installs, and fails on the device. `getAllDetails` is
 * also the cheaper call, because it returns plain objects instead of
 * constructing a full `Contact` instance per row.
 */
export async function readContacts(): Promise<ContactsResult> {
  if (!Contacts) return { ok: false, reason: 'unavailable' };

  try {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') return { ok: false, reason: 'denied' };

    // The enum members, not the string literals they happen to equal — the
    // signature is keyed on `ContactField`, so bare strings do not satisfy it.
    const rows = await Contacts.Contact.getAllDetails([
      Contacts.ContactField.GIVEN_NAME,
      Contacts.ContactField.FAMILY_NAME,
      Contacts.ContactField.PHONES,
    ] as const);

    const seen = new Set<string>();
    const contacts: DeviceContact[] = [];

    for (const entry of rows) {
      const name = [entry.givenName, entry.familyName]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join(' ')
        .trim();
      // A contact with no name is a phone number somebody never labelled. It
      // would import as a blank row, which is worse than not importing it.
      if (name.length < 2) continue;

      const phone = entry.phones?.[0]?.number?.trim();

      // Address books are full of the same person twice — one from the SIM, one
      // from an account sync. Keyed on name plus digits so "Priya" at two
      // different numbers survives as two people, which is usually correct.
      const key = `${name.toLowerCase()}|${(phone ?? '').replace(/\D/g, '')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      contacts.push({ id: key, name, phone });
    }

    contacts.sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, contacts };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
