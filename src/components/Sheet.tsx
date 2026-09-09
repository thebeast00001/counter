import { useEffect, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { useColors } from '@/design/theme';
import { duration, radius, space, spring } from '@/design/tokens';

const SCREEN_H = Dimensions.get('window').height;

/**
 * Sheets never take the whole screen — the scrim above them is the way out.
 *
 * These cap the *sheet*, not the scroll area inside it. Capping the scroll was
 * the obvious first version and quietly broke: a tall sheet with a two-button
 * footer came to 78% for the list plus a header plus 160pt of footer, which is
 * more than the screen, so the whole thing was pushed off the bottom. Bounding
 * the container and letting the scroll shrink into whatever is left over is the
 * only arrangement that cannot overflow.
 */
const MAX_SHEET_H = SCREEN_H * 0.72;
/**
 * Deep-dive height. Still short of the top: a sheet that reaches the status bar
 * reads as a pushed screen, and the visible strip of scrim is the affordance
 * that tells you it can be flicked away.
 */
const TALL_SHEET_H = SCREEN_H * 0.9;

/** Long enough to read as motion, short enough never to be waited on. */
const DISMISS_MS = 220;

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Small line above the title. Used by deep dives to name what is being explained. */
  eyebrow?: string;
  children: React.ReactNode;
  /** Set false for short, fixed-height content that should not scroll. */
  scrollable?: boolean;
  /** `tall` is for deep dives, which carry far more than a form. */
  size?: 'auto' | 'tall';
  /**
   * Pinned below the scroll area. Primary actions belong here so they stay
   * reachable no matter how long the form gets.
   */
  footer?: React.ReactNode;
};

/**
 * Bottom sheet with drag-to-dismiss.
 *
 * The drag gesture is attached to the header only, not the whole sheet. When it
 * wrapped everything it swallowed every vertical drag before the content saw it,
 * so scrollable lists inside a sheet silently refused to scroll and horizontal
 * strips refused to slide. Restricting the handle to the grabber area is also
 * what people expect: you pull a sheet by its lip.
 *
 * Scrolling lives here rather than in each caller, so no sheet ends up nesting a
 * ScrollView inside a ScrollView and fighting over the same gesture.
 */
export function Sheet({
  visible,
  onClose,
  title,
  eyebrow,
  children,
  scrollable = true,
  size = 'auto',
  footer,
}: SheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const [keyboardUp, setKeyboardUp] = useState(false);

  const translateY = useSharedValue(SCREEN_H);
  const backdrop = useSharedValue(0);

  useEffect(() => {
    // `Will` events fire before the animation on iOS; Android only has `Did`.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const up = Keyboard.addListener(showEvent, () => setKeyboardUp(true));
    const down = Keyboard.addListener(hideEvent, () => setKeyboardUp(false));
    return () => {
      up.remove();
      down.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      backdrop.value = withTiming(1, { duration: duration.normal });
      translateY.value = withSpring(0, spring.standard);
      return;
    }
    if (!mounted) return;

    /**
     * Dismissal is a timing curve, not a spring.
     *
     * `spring.gentle` is overdamped — a damping ratio around 1.2 — which is
     * exactly right for short travel and completely wrong here: a tall sheet has
     * to cover most of the screen, and an overdamped spring crawls the last few
     * pixels. Worse, the modal only unmounted on the spring's completion
     * callback, so a dismissed sheet sat on screen, inert and still capturing
     * touches, for the better part of two seconds.
     *
     * A fixed duration is both faster and more predictable, and because it is
     * known the unmount lands the instant the sheet is off screen.
     *
     * The curve is ease-*in*, not ease-out. Ease-out decelerates into the target,
     * so the sheet crawled the last stretch of a full-screen slide and every
     * dismissal felt like it was catching on something. Accelerating away is
     * what makes it feel released rather than dragged — it mirrors the spring on
     * the way in, which accelerates from rest.
     */
    backdrop.value = withTiming(0, { duration: duration.normal });
    translateY.value = withTiming(
      SCREEN_H,
      { duration: DISMISS_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(setMounted)(false);
      },
    );
  }, [visible, mounted, backdrop, translateY]);

  const pan = Gesture.Pan()
    // Ignore the first few pixels so a tap on the header is not read as a drag.
    .activeOffsetY([-8, 8])
    .onUpdate((e) => {
      // Downward only — dragging up must not detach the sheet from the edge.
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      // Velocity-aware: a fast flick closes even on a short drag, which is what
      // people actually expect from a sheet.
      if (e.translationY > 110 || e.velocityY > 800) {
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, spring.standard);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  if (!mounted) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/* Gesture handlers need their own root inside an RN Modal on Android. */}
      <GestureHandlerRootView style={styles.fill}>
        <Animated.View style={[styles.fill, backdropStyle, { backgroundColor: colors.scrim }]}>
          {/*
            Tapping the scrim dismisses the keyboard first and the sheet second.
            Reaching past an open keyboard to close a sheet used to take two
            taps that looked like one had been ignored.
          */}
          <Pressable
            style={styles.fill}
            onPress={() => {
              if (keyboardUp) Keyboard.dismiss();
              else onClose();
            }}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            sheetStyle,
            {
              backgroundColor: colors.surfaceAlt,
              paddingBottom: insets.bottom + space.lg,
              maxHeight: size === 'tall' ? TALL_SHEET_H : MAX_SHEET_H,
            },
          ]}>
          <GestureDetector gesture={pan}>
            <View style={styles.handle}>
              <View style={[styles.grabber, { backgroundColor: colors.hairlineStrong }]} />
              {eyebrow ? (
                <AppText variant="caption" color="textFaint" style={styles.eyebrow}>
                  {eyebrow.toUpperCase()}
                </AppText>
              ) : null}
              {title ? (
                <AppText variant="title2" style={styles.title}>
                  {title}
                </AppText>
              ) : null}
            </View>
          </GestureDetector>

          {scrollable ? (
            <ScrollView
              // Shrinks into whatever the header and footer leave behind, so the
              // footer is always reachable and the sheet never exceeds its cap.
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : (
            <View style={styles.static}>{children}</View>
          )}

          {footer ? (
            /*
              The footer rides above the keyboard rather than hiding behind it.
              Every sheet in the app puts its primary action here, and a form
              whose Save button is under the keyboard is a form people abandon.
            */
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.footerWrap}>
              <View style={[styles.footer, keyboardUp && styles.footerRaised]}>{footer}</View>
            </KeyboardAvoidingView>
          ) : null}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: space.md,
  },
  // Generous hit area: the whole header is the drag handle, not just the bar.
  handle: { paddingHorizontal: space.gutter, paddingBottom: space.sm },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    marginBottom: space.base,
  },
  eyebrow: { marginBottom: 2, letterSpacing: 0.8 },
  title: { marginBottom: space.sm },
  scroll: { flexShrink: 1 },
  scrollContent: { paddingHorizontal: space.gutter, paddingBottom: space.base },
  static: { paddingHorizontal: space.gutter },
  footerWrap: { flexShrink: 0 },
  footer: { paddingHorizontal: space.gutter, paddingTop: space.md, gap: space.sm },
  // Android resizes the window instead of overlaying, so the extra breathing
  // room is only needed to keep the button clear of the keyboard's top edge.
  footerRaised: { paddingBottom: space.sm },
});
