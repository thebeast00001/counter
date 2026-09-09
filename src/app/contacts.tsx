import { useRouter } from 'expo-router';
import { ArrowLeft, Check, Trash2, UserPlus, Users } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Press } from '@/components/Press';
import { TextField } from '@/components/TextField';
import { readContacts, type DeviceContact } from '@/lib/contacts';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { useBusiness } from '@/state/business';
import { useBarInset } from '@/state/dock';
import { useUndo } from '@/state/undo';

/**
 * Bringing people in from the phone, any time.
 *
 * This existed only as an onboarding step, which is the wrong place for it to
 * live alone: onboarding happens once, usually in a hurry, often before the
 * owner has decided who actually belongs in the app. Anyone who skipped it — or
 * who takes on twenty new customers in March — had no route back.
 *
 * Already-imported people are shown as already-imported rather than hidden. A
 * list that silently omits them looks like the import failed, and matching on
 * name plus digits means an owner can see exactly why something is or is not
 * offered.
 */
export default function ContactsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const { profile, data, addParty, archiveParty } = useBusiness();
  const { offerUndo } = useUndo();

  const [contacts, setContacts] = useState<DeviceContact[] | null>(null);
  const [state, setState] = useState<'idle' | 'asking' | 'denied' | 'unavailable'>('idle');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  /** Everyone already on the books, keyed the way the importer keys contacts. */
  const existing = useMemo(() => {
    const keys = new Map<string, string>();
    for (const party of data.parties) {
      if (party.archivedAt) continue;
      keys.set(`${party.name.toLowerCase()}|${(party.phone ?? '').replace(/\D/g, '')}`, party.id);
      // Also keyed on the bare name, so a contact whose number was never saved
      // still matches somebody added by hand.
      keys.set(`${party.name.toLowerCase()}|`, party.id);
    }
    return keys;
  }, [data.parties]);

  const shown = useMemo(() => {
    if (!contacts) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(needle));
  }, [contacts, query]);

  const sync = async () => {
    setState('asking');
    const result = await readContacts();
    if (result.ok) {
      setContacts(result.contacts);
      setState('idle');
      return;
    }
    setState(result.reason === 'denied' ? 'denied' : 'unavailable');
  };

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const bringIn = () => {
    const chosen = (contacts ?? []).filter((c) => picked.has(c.id) && !existing.has(c.id));
    const added = chosen.map((c) => addParty({ name: c.name, phone: c.phone }));
    setPicked(new Set());
    offerUndo(`${added.length} added`, () => {
      for (const party of added) if (party) archiveParty(party.id);
    });
  };

  if (!profile) return null;
  const term = profile.vocabulary.party;
  const toAdd = [...picked].filter((id) => !existing.has(id)).length;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press
          haptic="light"
          scaleTo={0.9}
          onPress={() => router.back()}
          accessibilityLabel="Back"
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <ArrowLeft size={19} color={colors.text} strokeWidth={2.2} />
        </Press>
        <AppText variant="title3">From contacts</AppText>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        {contacts === null ? (
          <Animated.View entering={enter(0)} style={styles.gutter}>
            <Card tone="surface">
              <View style={styles.headRow}>
                <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
                  <Users size={15} color={colors.accent} strokeWidth={2} />
                </View>
                <AppText variant="title3" style={styles.grow}>
                  Add from this phone
                </AppText>
              </View>

              <AppText variant="footnote" color="textDim" style={styles.note}>
                Only the names and numbers you tick are copied, and they stay on this device.
                Anyone already on your books is shown but cannot be added twice.
              </AppText>

              {state === 'denied' || state === 'unavailable' ? (
                <AppText variant="footnote" color="textDim" style={styles.note}>
                  {state === 'denied'
                    ? 'No access to contacts. You can still add people by hand.'
                    : 'Contacts are not available on this device.'}
                </AppText>
              ) : null}

              {state === 'asking' ? (
                <View style={styles.busy}>
                  <ActivityIndicator size="small" color={colors.textFaint} />
                  <AppText variant="footnote" color="textDim">
                    Reading contacts…
                  </AppText>
                </View>
              ) : (
                <Button
                  label={state === 'denied' ? 'Try again' : 'Choose from contacts'}
                  onPress={sync}
                />
              )}
            </Card>
          </Animated.View>
        ) : (
          <>
            <View style={styles.gutter}>
              <TextField
                placeholder="Search contacts"
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
              />
            </View>

            <View style={[styles.gutter, styles.countRow]}>
              <AppText variant="caption" color="textFaint">
                {toAdd > 0 ? `${toAdd} TO ADD` : `${shown.length} CONTACTS`}
              </AppText>
              <Pressable
                hitSlop={8}
                onPress={() =>
                  setPicked(
                    picked.size > 0
                      ? new Set()
                      : new Set(shown.filter((c) => !existing.has(c.id)).map((c) => c.id)),
                  )
                }>
                <AppText variant="caption" tint={colors.accent}>
                  {picked.size > 0 ? 'Clear' : 'Select all'}
                </AppText>
              </Pressable>
            </View>

            <View style={styles.gutter}>
              {shown.map((contact) => {
                const already = existing.get(contact.id);
                const on = picked.has(contact.id);
                return (
                  <Pressable
                    key={contact.id}
                    onPress={() => (already ? undefined : toggle(contact.id))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: Boolean(already) }}
                    accessibilityLabel={`${contact.name}${already ? ', already added' : ''}`}
                    style={[
                      styles.row,
                      {
                        backgroundColor: on ? colors.accentSoft : colors.surface,
                        opacity: already ? 0.55 : 1,
                      },
                    ]}>
                    <View
                      style={[
                        styles.tick,
                        {
                          backgroundColor: on || already ? colors.accent : 'transparent',
                          borderColor: on || already ? colors.accent : colors.hairlineStrong,
                        },
                      ]}>
                      {on || already ? (
                        <Check size={12} color={colors.accentText} strokeWidth={3} />
                      ) : null}
                    </View>
                    <View style={styles.rowBody}>
                      <AppText variant="callout" numberOfLines={1}>
                        {contact.name}
                      </AppText>
                      <AppText variant="caption" color="textFaint" numberOfLines={1}>
                        {already ? `Already a ${term.one.toLowerCase()}` : (contact.phone ?? 'No number')}
                      </AppText>
                    </View>
                    {already ? (
                      <Press
                        haptic="medium"
                        scaleTo={0.9}
                        onPress={() => {
                          archiveParty(already);
                          offerUndo(`${contact.name} removed`, () => {});
                        }}
                        accessibilityLabel={`Remove ${contact.name}`}
                        style={styles.remove}>
                        <Trash2 size={15} color={colors.warn} strokeWidth={2} />
                      </Press>
                    ) : null}
                  </Pressable>
                );
              })}

              {shown.length === 0 ? (
                <AppText variant="footnote" color="textDim">
                  Nobody by that name.
                </AppText>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>

      {toAdd > 0 ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + barInset }]}>
          <Press
            haptic="medium"
            scaleTo={0.97}
            onPress={bringIn}
            style={[styles.cta, { backgroundColor: colors.accent }]}>
            <UserPlus size={17} color={colors.accentText} strokeWidth={2.2} />
            <AppText variant="callout" tint={colors.accentText}>
              {`Add ${toAdd} ${toAdd === 1 ? term.one.toLowerCase() : term.many.toLowerCase()}`}
            </AppText>
          </Press>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
    paddingVertical: space.md,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { paddingTop: space.sm, gap: space.md },
  gutter: { paddingHorizontal: space.gutter },

  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  icon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: { flex: 1 },
  note: { lineHeight: 19, marginBottom: space.md },
  busy: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },

  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.sm,
    marginBottom: space.sm,
  },
  tick: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 1 },
  remove: { padding: space.sm },

  footer: { paddingHorizontal: space.gutter, paddingTop: space.md },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 52,
    borderRadius: radius.pill,
  },
});
