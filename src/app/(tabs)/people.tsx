import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { EmptyState } from '@/components/EmptyState';
import { Press } from '@/components/Press';
import { Highlighted, Row } from '@/components/Row';
import { Segmented } from '@/components/Segmented';
import { TextField } from '@/components/TextField';
import { churnRead } from '@/domain/analytics';
import { activeCommitments } from '@/domain/metrics';
import type { Party } from '@/domain/model';
import { useBreakpoint } from '@/design/responsive';
import { useColors } from '@/design/theme';
import { layout, radius, space } from '@/design/tokens';
import { openCall, message } from '@/lib/contact';
import { relativeDays, useTick } from '@/lib/time';
import { useBusiness, useIndex } from '@/state/business';
import { useBarScrollHandler } from '@/state/dockChrome';
import { useDockInset } from '@/state/dock';

const DAY = 24 * 60 * 60 * 1000;

/** Fixed so the list can skip measuring, which is most of what makes it fast. */
const ROW_H = 62;
const GAP = space.sm;
const HEADER_H = 38;

type Filter = 'all' | 'quiet' | 'expiring';

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

type RosterRow = {
  kind: 'row';
  key: string;
  party: Party;
  seen: number | null;
  expiring: boolean;
  risk: number;
};

type SectionRow = { kind: 'header'; key: string; title: string; count: number };
type Item = RosterRow | SectionRow;

/**
 * The roster, under whatever this business calls it.
 *
 * The filters are the two questions an owner actually opens this screen to
 * answer — who has gone quiet, and whose plan is about to end. A plain
 * alphabetical list answers neither, which is why the default view is grouped by
 * state rather than sorted by name.
 *
 * Virtualised, and that is not premature. Every row carries a pan gesture for
 * swipe-to-call and an entrance animation; rendering forty of those inside a
 * plain ScrollView meant changing a filter tore down forty gesture handlers and
 * started forty animations at once, which is exactly as slow as it sounds. A
 * windowed list mounts about eight.
 */
export default function PeopleScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dockInset = useDockInset();
  const { maxWidth } = useBreakpoint();
  const { profile, data, term } = useBusiness();
  const index = useIndex();
  const listRef = useRef<FlatList<Item>>(null);
  // The roster is the one tab built on a list rather than a scroll view, and
  // without this its bar was the only one that never got out of the way.
  const onScroll = useBarScrollHandler();

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  // Five minutes, not one. Nothing on this screen changes minute to minute, and
  // a tick here re-runs a churn read for every person on the books.
  const now = useTick(300_000);

  /**
   * The expensive half, computed once and independent of the controls.
   *
   * Risk is a per-person read over their whole history; expiry needs a pass over
   * commitments. Neither depends on which filter is selected or what has been
   * typed, but both used to sit in the same memo as the filtering — so switching
   * from "Gone quiet" to "Expiring" recomputed ninety churn reads to display a
   * subset it already had. That was the lag, and it was worst between the two
   * filtered views because both had to rebuild the whole set to narrow it.
   */
  const everyone = useMemo<RosterRow[]>(() => {
    if (!profile) return [];

    const expiringIds = new Set(
      activeCommitments(data, now)
        .filter((c) => c.endAt <= now + 7 * DAY)
        .map((c) => c.partyId),
    );

    return data.parties
      .filter((p) => !p.archivedAt)
      .map((party) => ({
        kind: 'row' as const,
        key: party.id,
        party,
        seen: index.lastSeen.get(party.id) ?? null,
        expiring: expiringIds.has(party.id),
        // Judged against this person's own rhythm rather than one number applied
        // to the whole roster — a fortnightly customer is not missing at 21 days.
        risk: churnRead(data, index, party.id, now).risk,
      }))
      .sort((a, b) => (a.seen ?? 0) - (b.seen ?? 0));
  }, [profile, data, index, now]);

  /**
   * The controls move at full priority; the list catches up.
   *
   * Switching to "All" goes from ten rows to ninety plus three headings, and
   * doing that on the same frame as the thumb animation meant the toggle
   * stuttered under the weight of the list it was about to build. Deferring the
   * value React re-renders the list from lets the control finish its travel
   * first — the filter still applies immediately, it simply stops competing with
   * an animation for the same frame.
   */
  const deferredFilter = useDeferredValue(filter);
  const deferredQuery = useDeferredValue(query);

  /** The cheap half: narrowing an array that is already sorted and scored. */
  const rows = useMemo<RosterRow[]>(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return everyone.filter((r) => {
      if (needle && !r.party.name.toLowerCase().includes(needle)) return false;
      if (deferredFilter === 'quiet') return r.risk >= 0.5;
      if (deferredFilter === 'expiring') return r.expiring;
      return true;
    });
  }, [everyone, deferredFilter, deferredQuery]);

  /**
   * One flat array of headings and rows.
   *
   * A SectionList would model this more literally and costs a second
   * virtualisation layer to do it; flattening keeps one window and one scroll
   * position, and the heading is just a shorter row.
   */
  const items = useMemo<Item[]>(() => {
    if (deferredFilter !== 'all' || deferredQuery) return rows;

    const drifting = rows.filter((r) => r.risk >= 0.5);
    const expiring = rows.filter((r) => r.risk < 0.5 && r.expiring);
    const fine = rows.filter((r) => r.risk < 0.5 && !r.expiring);

    const out: Item[] = [];
    const push = (key: string, title: string, group: RosterRow[]) => {
      if (group.length === 0) return;
      out.push({ kind: 'header', key: `h-${key}`, title, count: group.length });
      out.push(...group);
    };

    push('quiet', 'Gone quiet', drifting);
    push('expiring', 'Up for renewal', expiring);
    push('fine', 'Coming regularly', fine);
    return out;
  }, [rows, deferredFilter, deferredQuery]);

  /**
   * Row heights are known, so the list never has to measure.
   *
   * Without this, FlatList measures every row as it scrolls and cannot jump —
   * which is most of the cost virtualisation was meant to remove.
   *
   * Offsets are accumulated once per list rather than re-summed inside the
   * callback. FlatList calls `getItemLayout` per item on every scroll pass, so
   * summing from zero each time is quadratic work in the one place that has to
   * stay cheap.
   */
  const layouts = useMemo(() => {
    const out: { length: number; offset: number }[] = [];
    let offset = 0;
    for (const item of items) {
      const length = (item.kind === 'header' ? HEADER_H : ROW_H) + GAP;
      out.push({ length, offset });
      offset += length;
    }
    return out;
  }, [items]);

  const getItemLayout = useCallback(
    (_: ArrayLike<Item> | null | undefined, i: number) => ({
      length: layouts[i]?.length ?? ROW_H + GAP,
      offset: layouts[i]?.offset ?? 0,
      index: i,
    }),
    [layouts],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Item>) => {
      if (item.kind === 'header') {
        return (
          <View style={styles.sectionHead}>
            <AppText variant="caption" color="textFaint" style={styles.sectionTitle}>
              {item.title.toUpperCase()}
            </AppText>
            <AppText variant="caption" color="textFaint" tabular>
              {item.count}
            </AppText>
          </View>
        );
      }
      // Deferred so the highlight matches the rows actually on screen rather
      // than a search term the list has not caught up with.
      return <PartyRow item={item} query={deferredQuery} now={now} />;
    },
    [deferredQuery, now],
  );

  if (!profile) return null;

  const hasCommitments = profile.shape.commitmentWeight > 0.4;
  const live = data.parties.filter((p) => !p.archivedAt).length;

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <View style={styles.titleBlock}>
          <AppText variant="largeTitle" numberOfLines={2}>
            {term('party', true)}
          </AppText>
          <AppText variant="footnote" color="textDim" style={styles.subtitle}>
            {live} on the books
          </AppText>
        </View>
        <Press
          haptic="medium"
          scaleTo={0.9}
          onPress={() => router.push('/capture?mode=person' as never)}
          accessibilityLabel={`Add a ${term('party').toLowerCase()}`}
          style={[styles.add, { backgroundColor: colors.accent }]}>
          <Plus size={18} color={colors.accentText} strokeWidth={2.6} />
        </Press>
      </View>

      <View style={styles.controls}>
        <Segmented<Filter>
          options={[
            { value: 'all', label: 'All' },
            { value: 'quiet', label: 'Gone quiet' },
            ...(hasCommitments ? [{ value: 'expiring' as Filter, label: 'Expiring' }] : []),
          ]}
          value={filter}
          onChange={(next) => {
            setFilter(next);
            // The old list is gone; leaving the scroll where it was strands the
            // reader halfway down a shorter list with no idea what changed.
            listRef.current?.scrollToOffset({ offset: 0, animated: false });
          }}
        />
        <View style={styles.search}>
          <TextField placeholder="Search by name" value={query} onChangeText={setQuery} />
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <Animated.FlatList
        ref={listRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            art="search"
            title={query ? 'Nobody by that name' : 'Nothing here'}
            body={
              query
                ? 'Try a different spelling, or clear the search.'
                : filter === 'quiet'
                  ? 'Everyone is coming as often as they normally do. That is a good sign.'
                  : 'No plans are ending in the next week.'
            }
            action={
              query
                ? { label: 'Clear the search', onPress: () => setQuery('') }
                : {
                    label: `Add a ${term('party').toLowerCase()}`,
                    onPress: () => router.push('/capture?mode=person' as never),
                  }
            }
          />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        /*
          Tuned against a measurement, not a guess.
          Switching filters was 13% janky with rows on screen and 0.7% with the
          list emptied by a search — so the segmented control was never the
          problem, the mount volume behind it was. `windowSize` is counted in
          viewport heights: at 7 this kept roughly fifty rows mounted, each with
          its own gesture handler, and rebuilt that set on every switch.

          Three viewports is still a screen of buffer either side, and the
          smaller batch spreads the work across more frames — the total is
          similar, but no single frame runs long, and a long frame is the only
          kind anybody feels.
        */
        initialNumToRender={8}
        maxToRenderPerBatch={5}
        updateCellsBatchingPeriod={50}
        windowSize={3}
        /*
          Deliberately off. On Android this detaches offscreen rows and
          frequently fails to re-attach their text, so scrolling quickly leaves
          rows with an avatar and no name — the list looks broken rather than
          fast. `windowSize` and `getItemLayout` already keep the work bounded.
        */
        removeClippedSubviews={false}
        contentContainerStyle={[
          styles.content,
          {
            maxWidth,
            paddingTop: insets.top + space.sm,
            paddingBottom: insets.bottom + layout.tabBarHeight + space.huge + dockInset,
          },
        ]}
      />
    </View>
  );
}

/**
 * Memoised, and that is what makes filtering feel instant.
 *
 * Without it every row re-renders on each keystroke of the search field. The
 * comparison is deliberately shallow on the few values that actually change what
 * is drawn — comparing the whole party object would defeat the purpose, since a
 * new one is built by the mapping above on every pass.
 */
const PartyRow = memo(
  function PartyRow({ item, query, now }: { item: RosterRow; query: string; now: number }) {
    const colors = useColors();
    const router = useRouter();
    const { party, seen, expiring, risk } = item;
    const quiet = risk >= 0.5;

    const call = () => {
      if (party.phone) openCall(party.phone);
    };
    // WhatsApp first, SMS only if that fails. A fee reminder from a tuition
    // centre arrives on WhatsApp or it does not arrive.
    const write = () => {
      if (party.phone) message(party.phone, `Hi ${party.name.split(' ')[0]}, `);
    };

    return (
      <View style={styles.rowWrap}>
        <Row
          target={{ kind: 'party', partyId: party.id }}
          onPress={() => router.push(`/person/${party.id}` as never)}
          accessibilityLabel={`${party.name}, ${relativeDays(seen, now, 'never been in')}${
            party.phone ? '. Swipe right to call, left to message on WhatsApp.' : ''
          }`}
          swipe={
            party.phone
              ? [
                  { side: 'left', icon: 'phone', label: 'Call', tint: colors.success, onAct: call },
                  {
                    side: 'right',
                    icon: 'message',
                    label: 'WhatsApp',
                    tint: colors.accent,
                    onAct: write,
                  },
                ]
              : undefined
          }>
          <View style={[styles.avatar, { backgroundColor: colors.surfaceHigh }]}>
            <AppText variant="footnote" color="textDim">
              {initials(party.name)}
            </AppText>
          </View>

          <View style={styles.rowBody}>
            <Highlighted text={party.name} query={query} />
            <View style={styles.meta}>
              <AppText variant="caption" color={quiet ? 'warn' : 'textFaint'}>
                {relativeDays(seen, now, 'Never been in')}
              </AppText>
              {expiring ? (
                <AppText variant="caption" tint={colors.warn}>
                  · Expiring
                </AppText>
              ) : null}
            </View>
          </View>
        </Row>
      </View>
    );
  },
  (a, b) =>
    a.item.party.id === b.item.party.id &&
    a.item.party.name === b.item.party.name &&
    a.item.seen === b.item.seen &&
    a.item.expiring === b.item.expiring &&
    a.item.risk === b.item.risk &&
    a.query === b.query,
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { width: '100%', alignSelf: 'center', paddingHorizontal: space.gutter },

  header: { marginBottom: space.lg },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  titleBlock: { flex: 1 },
  subtitle: { marginTop: 3 },
  controls: { marginTop: space.lg },
  search: { marginTop: space.md },

  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    height: HEADER_H,
    paddingTop: space.md,
    marginBottom: GAP,
  },
  sectionTitle: { letterSpacing: 0.9 },

  rowWrap: { marginBottom: GAP, height: ROW_H },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  add: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
