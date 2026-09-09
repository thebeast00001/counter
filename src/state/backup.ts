import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import {
  FORMAT,
  MARK,
  backupFileName,
  readBackup,
  type Backup,
  type RestoreResult,
} from '@/domain/backupFormat';
import type { BusinessData, BusinessProfile } from '@/domain/model';

export { countOf, readBackup } from '@/domain/backupFormat';
export type { Backup, RestoreResult } from '@/domain/backupFormat';

/**
 * A copy of the business the owner can hold.
 *
 * Until this existed the app had exactly one copy of anybody's records: a single
 * sealed blob in this phone's AsyncStorage. Cloud sync is opt-in and most people
 * will never turn it on, so the default state of a real business using this app
 * was one dropped phone away from having no books at all. Everything else in
 * here — the derivation layer, the insights, the collection lists — is worth
 * nothing the moment that happens.
 *
 * ## Why the file is not encrypted
 *
 * The vault seals the on-device copy with a key generated on this device and
 * kept in the Keystore (`src/state/vault.ts`). That key cannot leave, which is
 * the point of it — and it means a sealed export could only ever be opened by
 * the phone that is already the thing being backed up against. A backup that
 * only restores onto the device it came from is not a backup.
 *
 * So the file is plain JSON, and it holds customers' names and phone numbers.
 * The screen that offers it has to say so plainly, because an owner who does
 * not know that will put it somewhere they would not have chosen.
 */

/**
 * Writes the whole business to a file and hands it to the share sheet.
 *
 * Cache rather than documents: the file exists to be handed to Drive or
 * WhatsApp or wherever the owner keeps things, and a second permanent copy
 * sitting in the app's own storage would be one more thing to leak and one more
 * thing to forget about. The system reclaims it.
 */
export async function exportBackup(
  profile: BusinessProfile,
  data: BusinessData,
  now = Date.now(),
): Promise<{ ok: true; uri: string } | { ok: false; reason: string }> {
  try {
    const payload: Backup = { format: FORMAT, mark: MARK, exportedAt: now, profile, data };

    const file = new File(Paths.cache, backupFileName(profile, now));
    // Overwrite rather than append: exporting twice in a day is the same
    // backup, not two of them.
    if (file.exists) file.delete();
    file.create();
    file.write(JSON.stringify(payload));

    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, reason: 'This device has nowhere to send the file.' };
    }

    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: 'Save your records',
      UTI: 'public.json',
    });

    return { ok: true, uri: file.uri };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Could not write the file.' };
  }
}

/**
 * Reads a backup the owner picks, and refuses anything that is not one.
 *
 * Every failure is named. A restore that silently produces an empty business is
 * indistinguishable, from the outside, from a restore that worked on an empty
 * file — and the owner would find out weeks later.
 */
export async function importBackup(): Promise<RestoreResult> {
  let picked: DocumentPicker.DocumentPickerResult;
  try {
    picked = await DocumentPicker.getDocumentAsync({
      // Not `application/json`: Android content providers label a file by what
      // the app that wrote it claimed, and a backup that came back through Drive
      // or WhatsApp routinely arrives as `application/octet-stream`. Filtering
      // strictly here is how a valid backup becomes un-pickable.
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Could not open the picker.' };
  }

  if (picked.canceled) return { ok: false, cancelled: true, reason: 'Cancelled.' };

  const asset = picked.assets?.[0];
  if (!asset?.uri) return { ok: false, reason: 'Nothing was chosen.' };

  let text: string;
  try {
    text = await new File(asset.uri).text();
  } catch {
    return { ok: false, reason: 'That file could not be read.' };
  }

  return readBackup(text);
}
