import { hydrateData } from '@/domain/model';
import type { BusinessData, BusinessProfile } from '@/domain/model';

/**
 * The shape of a backup file, and the decision to accept one.
 *
 * Separate from `src/state/backup.ts` for the same reason `src/state/supabase.ts`
 * reaches its native modules through a guarded require: this half must stay
 * loadable in plain Node. The other half imports the filesystem, the picker and
 * the share sheet, all of which pull in React Native — and a validator that
 * cannot be loaded by a test runner is the one function here that most needs to
 * be, because it is what stands in front of "replace everything on this phone".
 */

/** Bumped when the shape changes in a way a restore has to know about. */
export const FORMAT = 1;

export const MARK = 'counter.backup';

export type Backup = {
  format: number;
  mark: typeof MARK;
  exportedAt: number;
  profile: BusinessProfile;
  data: BusinessData;
};

export type RestoreResult =
  | { ok: true; profile: BusinessProfile; data: BusinessData; exportedAt: number }
  | { ok: false; reason: string }
  | { ok: false; cancelled: true; reason: string };

export function backupFileName(profile: BusinessProfile, now: number): string {
  const day = new Date(now).toISOString().slice(0, 10);
  const name = profile.name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${name || 'counter'}-${day}.counter.json`;
}

/**
 * Everything a restore decides, given the file's contents.
 *
 * Every refusal is named. A restore that silently produced an empty business
 * would look, from the home screen, exactly like a successful restore of a
 * business that had nothing in it — and the owner would find out weeks later.
 */
export function readBackup(text: string): RestoreResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'That is not a Counter backup — it is not readable as JSON.' };
  }

  const body = parsed as Partial<Backup>;
  if (body?.mark !== MARK) {
    return { ok: false, reason: 'That is not a Counter backup.' };
  }
  if (typeof body.format !== 'number' || body.format > FORMAT) {
    return {
      ok: false,
      reason: 'That backup was made by a newer version of the app. Update, then try again.',
    };
  }
  if (!body.profile?.id || !body.profile?.vocabulary) {
    return { ok: false, reason: 'That backup has no business in it.' };
  }

  /*
    Run through the same normaliser the store uses on every launch, so a backup
    written before a field existed restores with that field's default rather
    than as `undefined` reaching a render.
  */
  return {
    ok: true,
    profile: body.profile,
    data: hydrateData(body.data),
    exportedAt: typeof body.exportedAt === 'number' ? body.exportedAt : 0,
  };
}

/** What a restore is about to replace, for the confirmation that precedes it. */
export function countOf(data: BusinessData): number {
  return (
    data.parties.length +
    data.engagements.length +
    data.money.length +
    data.commitments.length +
    data.obligations.length
  );
}
