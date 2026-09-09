import { Check, Undo2 } from 'lucide-react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOutDown,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { tapUndone } from '@/lib/haptics';
import { layout, radius, space } from '@/design/tokens';

/** Long enough to notice and reach, short enough not to sit in the way. */
const GRACE_MS = 5000;

type Offer = {
  id: number;
  message: string;
  onUndo: () => void;
};

/**
 * Split in two, and the split is the point.
 *
 * Screens consume `offerUndo` and nothing else. When the offer and the host
 * count lived in the same context object, that object changed identity every
 * time a bar mounted — which is every navigation — so every screen holding
 * `useUndo()` re-rendered on every route change to learn about a countdown it
 * does not draw. Actions are frozen for the life of the provider; only the two
 * components that actually render the offer subscribe to the state.
 */
type UndoActions = {
  /**
   * Perform a destructive action with a window to take it back.
   *
   * The action still happens immediately — this is not a confirmation dialog.
   * Confirmations interrupt everyone to protect against a mistake most people
   * will not make; an undo window costs nothing until it is needed.
   */
  offerUndo: (message: string, onUndo: () => void) => void;
  dismiss: () => void;
  claimHost: () => () => void;
  graceMs: number;
};

type UndoState = { offer: Offer | null };

const UndoActionsContext = createContext<UndoActions | null>(null);
const UndoStateContext = createContext<UndoState>({ offer: null });

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [hosts, setHosts] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setOffer(null);
  }, []);

  const offerUndo = useCallback((message: string, onUndo: () => void) => {
    if (timer.current) clearTimeout(timer.current);
    const next = { id: Date.now(), message, onUndo };
    setOffer(next);
    timer.current = setTimeout(() => setOffer(null), GRACE_MS);
  }, []);

  /**
   * Lets the dock take over drawing the offer.
   *
   * Counted rather than a boolean, because a tab change briefly mounts the next
   * dock before unmounting the last — a boolean flips to false on that unmount
   * and the floating bar flashes in for a frame on every navigation.
   */
  const claimHost = useCallback(() => {
    setHosts((n) => n + 1);
    return () => setHosts((n) => Math.max(0, n - 1));
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Frozen: every field is a stable callback or a constant, so this identity
  // never changes and no screen re-renders because of undo.
  const actions = useMemo<UndoActions>(
    () => ({ offerUndo, dismiss: clear, claimHost, graceMs: GRACE_MS }),
    [offerUndo, clear, claimHost],
  );

  const state = useMemo<UndoState>(() => ({ offer }), [offer]);

  return (
    <UndoActionsContext.Provider value={actions}>
      <UndoStateContext.Provider value={state}>
      {children}
      {/*
        Only when nothing else is drawing it. The dock hosts the offer on the
        main tabs — it is already the bar at the bottom of the screen, and a
        second floating capsule above it was two competing notifications for one
        event. Screens outside the tabs have no dock, so the capsule remains for
        them rather than undo silently disappearing there.
      */}
      {offer && hosts === 0 ? (
        <FloatingUndo offer={offer} onDismiss={clear} graceMs={GRACE_MS} />
      ) : null}
      </UndoStateContext.Provider>
    </UndoActionsContext.Provider>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RING = 26;
const RING_STROKE = 2.5;

/**
 * The draining ring.
 *
 * Doing real work rather than decorating: an undo window that vanishes without
 * warning is worse than none, because you reach for it and it has gone. The ring
 * makes the remaining time legible at a glance without a countdown number
 * nagging at the corner of the eye.
 */
function Countdown({ id, graceMs }: { id: number; graceMs: number }) {
  const colors = useColors();
  const r = (RING - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  const remaining = useSharedValue(1);

  useEffect(() => {
    remaining.value = 1;
    // Linear on purpose: this is a clock, and any easing would misreport how
    // much time is actually left.
    remaining.value = withTiming(0, { duration: graceMs, easing: Easing.linear });
  }, [id, graceMs, remaining]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - remaining.value),
  }));

  return (
    <View style={styles.ringWrap}>
      <Svg width={RING} height={RING}>
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={colors.hairlineStrong}
          strokeWidth={RING_STROKE}
          fill="none"
        />
        <AnimatedCircle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={colors.accent}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          animatedProps={ringProps}
          transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
        />
      </Svg>
      <View style={styles.ringIcon}>
        <Check size={12} color={colors.textDim} strokeWidth={3} />
      </View>
    </View>
  );
}

/** The message and the button. Identical wherever the offer is drawn. */
function Body({ offer, onDismiss, graceMs }: { offer: Offer; onDismiss: () => void; graceMs: number }) {
  const colors = useColors();

  return (
    <>
      <Countdown id={offer.id} graceMs={graceMs} />

      <AppText variant="footnote" numberOfLines={1} style={styles.message}>
        {offer.message}
      </AppText>

      <View style={[styles.divider, { backgroundColor: colors.hairlineStrong }]} />

      <Press
        haptic="medium"
        scaleTo={0.9}
        accessibilityRole="button"
        accessibilityLabel={`Undo: ${offer.message}`}
        onPress={() => {
          offer.onUndo();
          // The reverse of the shape that recorded it: heavy, then light.
          tapUndone();
          onDismiss();
        }}
        style={styles.action}>
        <Undo2 size={15} color={colors.accent} strokeWidth={2.4} />
        <AppText variant="footnote" tint={colors.accent}>
          Undo
        </AppText>
      </Press>
    </>
  );
}

/**
 * The offer drawn inside the dock.
 *
 * No surface of its own and no shadow — it is a row of the bar it sits in, not a
 * card floating over it. Sized to the dock's own activity row so the bar grows
 * by exactly one row and the tabs never shift.
 */
export function DockUndo({ offer, onDismiss, graceMs }: { offer: Offer; onDismiss: () => void; graceMs: number }) {
  const { reduced } = useMotion();
  return (
    <Animated.View
      key={offer.id}
      entering={reduced ? FadeIn.duration(120) : FadeInDown.duration(200)}
      style={styles.inline}
      accessibilityLiveRegion="polite">
      <Body offer={offer} onDismiss={onDismiss} graceMs={graceMs} />
    </Animated.View>
  );
}

/** The offer on screens with no dock: a capsule floating clear of both edges. */
function FloatingUndo({
  offer,
  onDismiss,
  graceMs,
}: {
  offer: Offer;
  onDismiss: () => void;
  graceMs: number;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { reduced } = useMotion();

  return (
    <Animated.View
      // Keyed so a second offer replaces the first with its own entrance rather
      // than silently swapping the text of a bar already on screen.
      key={offer.id}
      entering={
        reduced ? FadeIn.duration(120) : FadeInDown.springify().damping(22).stiffness(260).mass(0.8)
      }
      exiting={FadeOutDown.duration(160)}
      style={[styles.wrap, { bottom: insets.bottom + space.lg }]}
      pointerEvents="box-none">
      <View
        style={[
          styles.capsule,
          { backgroundColor: colors.surfaceHigh, borderColor: colors.hairlineStrong, shadowColor: '#000' },
        ]}
        accessibilityLiveRegion="polite">
        <Body offer={offer} onDismiss={onDismiss} graceMs={graceMs} />
      </View>
    </Animated.View>
  );
}

export function useUndo(): UndoActions {
  const ctx = useContext(UndoActionsContext);
  if (!ctx) throw new Error('useUndo must be used inside <UndoProvider>');
  return ctx;
}

/**
 * Registers the caller as the place undo offers are drawn, for as long as it is
 * mounted. Returns the live offer so the host can render it.
 */
export function useUndoHost(): { offer: Offer | null; dismiss: () => void; graceMs: number } {
  const { dismiss, graceMs, claimHost } = useUndo();
  const { offer } = useContext(UndoStateContext);
  useEffect(() => claimHost(), [claimHost]);
  return { offer, dismiss, graceMs };
}

const styles = StyleSheet.create({
  // Centred rather than stretched: the capsule is only as wide as it needs to
  // be, so it reads as a passing notice rather than a permanent bar.
  wrap: {
    position: 'absolute',
    left: space.gutter,
    right: space.gutter,
    alignItems: 'center',
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingLeft: space.md,
    paddingRight: space.base,
    height: 48,
    maxWidth: '100%',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    height: layout.nowBarHeight,
  },
  ringWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringIcon: { position: 'absolute' },
  message: { flexShrink: 1, flexGrow: 1 },
  divider: { width: StyleSheet.hairlineWidth, height: 22 },
  action: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.sm },
});
