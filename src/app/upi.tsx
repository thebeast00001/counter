import { useRouter } from 'expo-router';
import { ArrowLeft, Check, Info, QrCode, Sparkles, UserPlus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Press } from '@/components/Press';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { money } from '@/domain/metrics';
import type { ExpenseCategory } from '@/domain/model';
import {
  CONFIDENT,
  isVpa,
  matchParty,
  newTransactions,
  parseTransactions,
  toMoneyEntry,
  type ParsedTransaction,
} from '@/domain/upi';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { formatDayMonth, useTick } from '@/lib/time';
import { useBarInset } from '@/state/dock';
import { useBusiness } from '@/state/business';
import { useUndo } from '@/state/undo';

const CATEGORIES: ExpenseCategory[] = [
  'rent',
  'wages',
  'stock',
  'utilities',
  'marketing',
  'equipment',
  'tax',
  'other',
];

/**
 * UPI, and what "automatic" can honestly mean here.
 *
 * The page opens by saying what this cannot do, because the alternative is an
 * owner who believes their takings are being captured while nothing is being
 * captured — and who finds out at the end of a quarter. No app that is not a
 * licensed payment service provider can watch a UPI account; reading the bank's
 * SMS needs a permission Play Store grants only to the phone's default messaging
 * app, and reading UPI notifications needs a native listener this build cannot
 * ship.
 *
 * What is left is genuinely most of the value, and it is what this screen does:
 *
 *  - **Collecting** starts here, so the app already knows who is paying and what
 *    for. Nothing is typed afterwards.
 *  - **Everything else** is pasted in once and read. A month of statements is one
 *    paste, and the rows arrive with the counterparty matched and the category
 *    filled in.
 *
 * Nothing is written without a tap. Every row shows the message it was read from
 * so the owner can see that the app understood it, and a row the parser is unsure
 * of arrives unticked rather than quietly joining the ledger.
 */
export default function UpiScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const { profile, data, updateProfile, addMoney, removeMoney, updateParty } = useBusiness();
  const { offerUndo } = useUndo();
  const now = useTick(300_000);

  const [vpaDraft, setVpaDraft] = useState(profile?.vpa ?? '');
  const [paste, setPaste] = useState('');

  /** Rows the owner has ticked. Keyed by index into `parsed`. */
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  /** Category overrides, so a wrong suggestion is one tap from right. */
  const [categories, setCategories] = useState<Record<number, ExpenseCategory>>({});
  const [reviewing, setReviewing] = useState(false);
  /*
    Who paid, where the parser could not tell.

    `matchParty` refuses to guess — an exact handle, an exact phone number, or a
    name only one person answers to — which is right, because a payment booked
    against the wrong customer is worse than one booked against nobody. But it
    left the owner no way to say who it was either, so importing a month of
    statements moved the month's total and not one person's balance, and the
    "it learns the payers" promise on this screen could only ever be kept for
    payers it already knew. Assigning here is a statement by the owner, not a
    guess by the app, and it teaches the handle for next time.
  */
  const [assigned, setAssigned] = useState<Record<number, string>>({});
  const [picking, setPicking] = useState<number | null>(null);
  const [partyQuery, setPartyQuery] = useState('');

  /*
    Parsed on demand rather than as you type. Reading a month of statements on
    every keystroke would run the whole regex set against a few thousand
    characters sixty times a second, and the result is not useful until the paste
    is finished anyway.
  */
  const parsed = useMemo<ParsedTransaction[]>(() => {
    if (!reviewing || !profile) return [];
    const all = parseTransactions(paste, now);
    return newTransactions(all, data.money, now);
  }, [reviewing, paste, data.money, now, profile]);

  if (!profile) return null;

  /*
    Archived people are left out: they are off the books on purpose, and
    attaching a fresh payment to one would quietly bring them back into every
    figure that counts live customers.
  */
  const query = partyQuery.trim().toLowerCase();
  const searchable = data.parties
    .filter((p) => !p.archivedAt)
    .filter((p) => (query.length === 0 ? true : p.name.toLowerCase().includes(query)))
    .slice(0, 40);

  const review = () => {
    const found = parseTransactions(paste, now);
    if (found.length === 0) {
      Alert.alert(
        'Nothing to read there',
        'No transactions were found in that text. Paste the messages your bank sent — the ones with an amount and a reference number — or a statement export.',
      );
      return;
    }

    const fresh = newTransactions(found, data.money, now);
    if (fresh.length === 0) {
      Alert.alert(
        'Already recorded',
        `All ${found.length} of those are already on your books. Pasting the same statement twice is safe — nothing was added.`,
      );
      return;
    }

    // Pre-ticked only where the read was complete. See `CONFIDENT`.
    setChosen(new Set(fresh.map((t, i) => (t.confidence >= CONFIDENT ? i : -1)).filter((i) => i >= 0)));
    setCategories({});
    setReviewing(true);
  };

  const commit = () => {
    const rows = parsed.filter((_, i) => chosen.has(i));
    if (rows.length === 0) return;

    let attached = 0;
    /* Kept so the undo offer can actually take them back out. An undo that only
       dismisses a message would be worse than not offering one. */
    const added: string[] = [];

    for (const [index, transaction] of parsed.entries()) {
      if (!chosen.has(index)) continue;
      const assignedId = assigned[index];
      const party =
        matchParty(transaction, data.parties) ??
        (assignedId ? (data.parties.find((p) => p.id === assignedId) ?? null) : null);
      if (party) attached += 1;

      const entry = addMoney(
        toMoneyEntry(transaction, {
          partyId: party?.id ?? null,
          category: categories[index] ?? transaction.suggestedCategory,
          now,
        }),
      );
      added.push(entry.id);

      /*
        A payer whose UPI id was not on file gets it recorded now, so the next
        payment from them matches without anybody doing anything. This is the
        only part of the feature that compounds: the first import from a customer
        is unattached, every one after it is not.
      */
      if (party && transaction.vpa && !party.vpa) {
        updateParty(party.id, { vpa: transaction.vpa });
      }
    }

    offerUndo(
      `${rows.length} ${rows.length === 1 ? 'transaction' : 'transactions'} recorded`,
      () => removeMoney(added),
    );

    setPaste('');
    setReviewing(false);
    setChosen(new Set());
    setAssigned({});

    Alert.alert(
      'Recorded',
      attached > 0
        ? `${rows.length} added, ${attached} matched to someone on your books.`
        : `${rows.length} added. None matched a customer — open one to attach it.`,
    );
  };

  const saveVpa = () => {
    const value = vpaDraft.trim();
    if (value && !isVpa(value)) {
      Alert.alert(
        'That does not look like a UPI id',
        'It should look like yourname@okaxis or 9876543210@ybl — a name, an @, and your bank handle.',
      );
      return;
    }
    updateProfile({ vpa: value || undefined });
    Alert.alert(
      value ? 'Saved' : 'Cleared',
      value
        ? 'You can now collect by UPI from anyone on your books. Their app opens with the amount already filled in.'
        : 'Collecting by UPI is switched off.',
    );
  };

  const toggle = (index: number) => {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const total = parsed.reduce(
    (sum, t, i) => (chosen.has(i) ? sum + (t.direction === 'in' ? t.amount : -t.amount) : sum),
    0,
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press
          haptic="light"
          scaleTo={0.9}
          onPress={() => (reviewing ? setReviewing(false) : router.back())}
          accessibilityLabel="Back"
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <ArrowLeft size={19} color={colors.text} strokeWidth={2.2} />
        </Press>
        <View style={styles.barBody}>
          <AppText variant="title3">{reviewing ? 'Check these' : 'UPI'}</AppText>
          <AppText variant="caption" color="textFaint">
            {reviewing
              ? `${chosen.size} of ${parsed.length} selected`
              : 'Collect, and bring your statements in'}
          </AppText>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
          {reviewing ? (
            /* --------------------------------------------------------- review */
            parsed.length === 0 ? (
              <EmptyState
                art="sessions"
                title="Nothing new"
                body="Everything in that paste is already on your books."
              />
            ) : (
              <>
                {parsed.map((transaction, index) => {
                  const on = chosen.has(index);
                  const matched = matchParty(transaction, data.parties);
                  const assignedId = assigned[index];
                  const party =
                    matched ??
                    (assignedId ? (data.parties.find((p) => p.id === assignedId) ?? null) : null);
                  const unsure = transaction.confidence < CONFIDENT;
                  const category = categories[index] ?? transaction.suggestedCategory ?? 'other';

                  return (
                    <Animated.View key={index} entering={enter(index)} style={styles.gutter}>
                      <Press
                        haptic="light"
                        scaleTo={0.99}
                        onPress={() => toggle(index)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${transaction.direction === 'in' ? 'Received' : 'Paid'} ${money(transaction.amount)}`}
                        style={[
                          styles.row,
                          {
                            backgroundColor: colors.surface,
                            borderColor: on ? colors.accent : 'transparent',
                          },
                        ]}>
                        <View style={styles.rowHead}>
                          <View
                            style={[
                              styles.tick,
                              {
                                backgroundColor: on ? colors.accent : 'transparent',
                                borderColor: on ? colors.accent : colors.textFaint,
                              },
                            ]}>
                            {on ? (
                              <Check size={13} color={colors.accentText} strokeWidth={3} />
                            ) : null}
                          </View>

                          <AppText
                            variant="title3"
                            tabular
                            tint={transaction.direction === 'in' ? colors.success : colors.text}
                            style={styles.grow}>
                            {transaction.direction === 'in' ? '+' : '−'}
                            {money(transaction.amount)}
                          </AppText>

                          <AppText variant="caption" color="textFaint">
                            {transaction.at ? formatDayMonth(transaction.at) : 'no date'}
                          </AppText>
                        </View>

                        <AppText variant="footnote" color="textDim" numberOfLines={1}>
                          {party
                            ? party.name
                            : (transaction.counterparty ?? transaction.vpa ?? 'Not matched')}
                          {party ? (matched ? ' · on your books' : ' · you chose this') : ''}
                        </AppText>

                        {/*
                          The message it was read from, always visible. This is
                          the whole basis on which an owner can trust an imported
                          figure — without it they are being asked to take the
                          parser's word for their own accounts.
                        */}
                        <AppText variant="caption" color="textFaint" numberOfLines={2} style={styles.raw}>
                          {transaction.raw}
                        </AppText>

                        {unsure ? (
                          <AppText variant="caption" tint={colors.warn}>
                            Read only partly — check this one before adding it
                          </AppText>
                        ) : null}

                        {transaction.direction === 'in' && !matched ? (
                          <Press
                            haptic="light"
                            scaleTo={0.96}
                            onPress={() => {
                              setPartyQuery('');
                              setPicking(index);
                            }}
                            accessibilityLabel={
                              party ? `Paid by ${party.name}. Change` : 'Say who paid this'
                            }
                            style={[styles.assign, { borderColor: colors.hairlineStrong }]}>
                            <UserPlus size={14} color={colors.accent} strokeWidth={2.2} />
                            <AppText variant="caption" tint={colors.accent}>
                              {party ? 'Change who paid' : 'Say who paid'}
                            </AppText>
                          </Press>
                        ) : null}

                        {transaction.direction === 'out' ? (
                          <View style={styles.chips}>
                            {CATEGORIES.map((option) => (
                              <Press
                                key={option}
                                haptic="light"
                                scaleTo={0.94}
                                onPress={() =>
                                  setCategories((prev) => ({ ...prev, [index]: option }))
                                }
                                accessibilityRole="radio"
                                accessibilityState={{ selected: category === option }}
                                style={[
                                  styles.chip,
                                  {
                                    backgroundColor:
                                      category === option ? colors.accentSoft : colors.surfaceHigh,
                                  },
                                ]}>
                                <AppText
                                  variant="caption"
                                  tint={category === option ? colors.accent : colors.textDim}>
                                  {option}
                                </AppText>
                              </Press>
                            ))}
                          </View>
                        ) : null}
                      </Press>
                    </Animated.View>
                  );
                })}

                <Animated.View entering={enter(parsed.length)} style={[styles.gutter, styles.block]}>
                  <Button
                    label={
                      chosen.size === 0
                        ? 'Nothing selected'
                        : `Add ${chosen.size} · ${total >= 0 ? '+' : '−'}${money(Math.abs(total))}`
                    }
                    onPress={commit}
                    disabled={chosen.size === 0}
                  />
                </Animated.View>
              </>
            )
          ) : (
            /* ---------------------------------------------------------- setup */
            <>
              <Animated.View entering={enter(0)} style={styles.gutter}>
                <View style={[styles.card, { backgroundColor: colors.surface }]}>
                  <View style={styles.cardHead}>
                    <Info size={16} color={colors.textDim} strokeWidth={2} />
                    <AppText variant="callout">What this can and cannot do</AppText>
                  </View>
                  <AppText variant="footnote" color="textDim" style={styles.body}>
                    No app can watch your UPI account unless it is a licensed payment provider —
                    that is a rule of the network, not a limit of this app. Anything claiming
                    otherwise is reading your messages.
                  </AppText>
                  <AppText variant="footnote" color="textDim" style={styles.body}>
                    So there are two ways in. Payments you collect through this app record
                    themselves, because it already knows who and what for. Everything else — money
                    out, and money in that came another way — you paste in, and it reads.
                  </AppText>
                </View>
              </Animated.View>

              {/* ---------------------------------------------------- collect */}
              <Animated.View entering={enter(1)} style={[styles.gutter, styles.block]}>
                <AppText variant="caption" color="textFaint" style={styles.eyebrow}>
                  YOUR UPI ID
                </AppText>
                <View style={[styles.card, { backgroundColor: colors.surface }]}>
                  <TextField
                    label="Where customers pay you"
                    hint="optional"
                    value={vpaDraft}
                    onChangeText={setVpaDraft}
                    placeholder="yourname@okaxis"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <AppText variant="caption" color="textFaint" style={styles.body}>
                    Set this and every customer gets a Collect button. Their UPI app opens with the
                    amount and what it is for already filled in — you never type the payment
                    afterwards. The money goes straight to you; it never touches this app.
                  </AppText>
                  <View style={styles.block}>
                    {/*
                      An unset id is `undefined` and an empty field is `''`, so
                      comparing them directly left Save live and inviting on a
                      screen where there was nothing to save. Coalescing first
                      makes "nothing typed, nothing stored" the same state, and
                      still enables Save when a stored id is cleared to remove it.
                    */}
                    <Button
                      label={(profile.vpa ?? '') === vpaDraft.trim() ? 'Saved' : 'Save'}
                      onPress={saveVpa}
                      disabled={(profile.vpa ?? '') === vpaDraft.trim()}
                    />
                  </View>
                </View>
              </Animated.View>

              {/* ----------------------------------------------------- import */}
              <Animated.View entering={enter(2)} style={[styles.gutter, styles.block]}>
                <AppText variant="caption" color="textFaint" style={styles.eyebrow}>
                  BRING IN WHAT ALREADY HAPPENED
                </AppText>
                <View style={[styles.card, { backgroundColor: colors.surface }]}>
                  <AppText variant="footnote" color="textDim" style={styles.body}>
                    Paste the messages your bank sent, or a statement export. A whole month at once
                    is fine. Each one is read for the amount, the date, who it was with and what it
                    was for — and shown to you before anything is recorded.
                  </AppText>

                  <TextField
                    label="Paste here"
                    value={paste}
                    onChangeText={setPaste}
                    placeholder={
                      'Dear Customer, Rs.500.00 debited from A/c XX1234 on 03-09-26 to VPA shop@ybl (UPI Ref no 512345678901).'
                    }
                    multiline
                    numberOfLines={6}
                    style={styles.paste}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  <View style={styles.block}>
                    <Button
                      label="Read it"
                      onPress={review}
                      disabled={paste.trim().length < 20}
                    />
                  </View>
                </View>
              </Animated.View>

              <Animated.View entering={enter(3)} style={[styles.gutter, styles.block]}>
                <View style={[styles.card, { backgroundColor: colors.surface }]}>
                  <View style={styles.cardHead}>
                    <Sparkles size={16} color={colors.accent} strokeWidth={2} />
                    <AppText variant="callout">It learns the payers</AppText>
                  </View>
                  <AppText variant="footnote" color="textDim" style={styles.body}>
                    When an imported payment matches somebody on your books — or you say who
                    paid it — their UPI id is remembered. Every payment from them after that is
                    matched on its own, with no guessing and nothing to correct.
                  </AppText>
                </View>
              </Animated.View>

              <Animated.View entering={enter(4)} style={[styles.gutter, styles.block]}>
                <View style={[styles.note, { backgroundColor: colors.surfaceHigh }]}>
                  <QrCode size={16} color={colors.textFaint} strokeWidth={1.9} />
                  <AppText variant="caption" color="textFaint" style={styles.grow}>
                    Nothing here leaves the phone. The text you paste is read on the device and
                    then discarded — only the transactions you tick are kept.
                  </AppText>
                </View>
              </Animated.View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/*
        Who paid, chosen by the owner.

        Filtered rather than paged: a business with sixty customers scrolls, one
        with six hundred types two letters. Choosing closes the sheet straight
        away — there is one decision here and a confirm button would only ask
        the owner to agree with themselves.
      */}
      <Sheet
        visible={picking !== null}
        onClose={() => setPicking(null)}
        title="Who paid this?"
        eyebrow={
          picking !== null && parsed[picking]
            ? `${money(parsed[picking].amount)} · ${parsed[picking].vpa ?? 'no handle'}`
            : undefined
        }>
        <TextField
          value={partyQuery}
          onChangeText={setPartyQuery}
          placeholder={`Search ${profile.vocabulary.party.many.toLowerCase()}`}
          autoCapitalize="words"
          autoCorrect={false}
        />

        {picking !== null && assigned[picking] ? (
          <Press
            haptic="light"
            scaleTo={0.98}
            onPress={() => {
              setAssigned((prev) => {
                const next = { ...prev };
                delete next[picking];
                return next;
              });
              setPicking(null);
            }}
            style={[styles.pick, { borderColor: colors.hairline }]}>
            <AppText variant="callout" color="textDim">
              Nobody — leave it unattached
            </AppText>
          </Press>
        ) : null}

        {searchable.length === 0 ? (
          <AppText variant="footnote" color="textFaint" style={styles.body}>
            {data.parties.length === 0
              ? `You have no ${profile.vocabulary.party.many.toLowerCase()} on your books yet, so there is nobody to attach this to.`
              : 'Nobody by that name.'}
          </AppText>
        ) : (
          searchable.map((party) => (
            <Press
              key={party.id}
              haptic="light"
              scaleTo={0.98}
              onPress={() => {
                if (picking === null) return;
                setAssigned((prev) => ({ ...prev, [picking]: party.id }));
                setPicking(null);
              }}
              accessibilityRole="button"
              style={[styles.pick, { borderColor: colors.hairline }]}>
              <AppText variant="callout" numberOfLines={1} style={styles.grow}>
                {party.name}
              </AppText>
              {picking !== null && assigned[picking] === party.id ? (
                <Check size={16} color={colors.accent} strokeWidth={2.4} />
              ) : null}
            </Press>
          ))
        )}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
    paddingBottom: space.sm,
  },
  barBody: { flex: 1, gap: 1 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { paddingTop: space.sm },
  gutter: { paddingHorizontal: space.gutter },
  block: { marginTop: space.lg },
  eyebrow: { letterSpacing: 1.2, marginBottom: space.sm },
  card: { borderRadius: radius.lg, padding: space.base, gap: space.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  body: { lineHeight: 19 },
  paste: { minHeight: 120, textAlignVertical: 'top' },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.base,
  },
  grow: { flex: 1 },
  row: {
    borderRadius: radius.lg,
    borderWidth: 1.5,
    padding: space.base,
    gap: space.xs,
    marginBottom: space.sm,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tick: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  raw: { lineHeight: 15, fontStyle: 'italic' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  assign: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    marginTop: space.xs,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chip: { paddingHorizontal: space.sm, paddingVertical: 5, borderRadius: radius.pill },
});
