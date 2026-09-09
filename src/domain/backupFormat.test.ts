import { describe, expect, it } from 'vitest';

import { ARCHETYPES } from '@/domain/archetypes';
import { buildProfile } from '@/domain/compile';
import { emptyData } from '@/domain/seed';
import { countOf, readBackup } from '@/domain/backupFormat';

/**
 * The gate in front of "replace everything on this phone".
 *
 * A restore is the single most destructive thing in the app, and it is offered
 * to somebody who has usually just lost their previous phone. Every refusal
 * here is a case where accepting the file would have produced an empty or
 * half-formed business that looks, from the home screen, exactly like a
 * successful restore of a business that had nothing in it.
 */

const profile = buildProfile({
  name: 'Iron House',
  description: 'A gym.',
  archetype: 'gym',
  shape: ARCHETYPES.gym.shape,
});

const good = () =>
  JSON.stringify({
    format: 1,
    mark: 'counter.backup',
    exportedAt: 1_757_000_000_000,
    profile,
    data: {
      ...emptyData(),
      parties: [{ id: 'p1', name: 'A Person', joinedAt: 1, contactable: true }],
    },
  });

describe('readBackup', () => {
  it('accepts a file this app wrote', () => {
    const result = readBackup(good());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.name).toBe('Iron House');
    expect(result.data.parties).toHaveLength(1);
    expect(result.exportedAt).toBe(1_757_000_000_000);
  });

  it('refuses a file that is not JSON', () => {
    const result = readBackup('not a backup at all');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/not readable as JSON/);
  });

  it('refuses JSON that is not ours', () => {
    // Picking the wrong file is the normal failure here — the picker shows
    // every file on the phone, because filtering by MIME type loses backups
    // that came back through Drive.
    const result = readBackup(JSON.stringify({ hello: 'world' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('That is not a Counter backup.');
  });

  it('refuses a backup from a newer version rather than guessing at it', () => {
    const result = readBackup(good().replace('"format":1', '"format":99'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/newer version/);
  });

  it('refuses a backup with no business in it', () => {
    const result = readBackup(
      JSON.stringify({ format: 1, mark: 'counter.backup', exportedAt: 0, data: emptyData() }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no business/);
  });

  it('fills in collections a older backup never had', () => {
    // Written before `obligations` existed. It must restore as an empty list,
    // not as undefined reaching a `.length` on the home screen.
    const result = readBackup(
      JSON.stringify({
        format: 1,
        mark: 'counter.backup',
        exportedAt: 0,
        profile,
        data: { parties: [] },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.isArray(result.data.obligations)).toBe(true);
    expect(Array.isArray(result.data.money)).toBe(true);
    expect(countOf(result.data)).toBe(0);
  });
});
