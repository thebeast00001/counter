import { forwardRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { useBreakpoint } from '@/design/responsive';
import { useColors } from '@/design/theme';
import { layout, radius, space } from '@/design/tokens';
import { useBarScrollHandler } from '@/state/dockChrome';

export type LargeTitleScreenProps = {
  title: string;
  subtitle?: string;
  /** Toolbar accessory, aligned with the title. */
  right?: React.ReactNode;
  children: React.ReactNode;
  /** Extra space below the content, on top of the tab bar allowance. */
  bottomInset?: number;
  /**
   * 0..1 — draws a thin rule under the header showing how far through the
   * trading day it is. Only the home screen sets it; elsewhere the day is not
   * the frame the content is read in.
   */
  dayProgress?: number;
  /** Long-press the title. Used for the rename affordance on home. */
  onLongPressTitle?: () => void;
};

/**
 * Screen scaffold with a large title.
 *
 * The header scrolls with the content rather than being pinned above it. A fixed
 * header while the page slides underneath reads as two disconnected planes — the
 * title looks stranded. Making it the first row of the same scroll view means the
 * whole screen moves as one surface, which is what people expect from a title
 * this large.
 *
 * The scroll view's ref is forwarded so screens can drive it — the roster's
 * alphabet index needs to jump to an offset, and there is no way to do that from
 * outside without reaching the underlying view.
 */
export const LargeTitleScreen = forwardRef<ScrollView, LargeTitleScreenProps>(
  function LargeTitleScreen(
    { title, subtitle, right, children, bottomInset = 0, dayProgress, onLongPressTitle },
    ref,
  ) {
    const insets = useSafeAreaInsets();
    const colors = useColors();
    const { maxWidth } = useBreakpoint();
    // Every screen built on this scaffold moves the bar the same way.
    const onScroll = useBarScrollHandler();

    return (
      <View style={styles.root}>
        <Animated.ScrollView
          ref={ref}
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
          contentContainerStyle={{
            paddingTop: insets.top + space.sm,
            paddingBottom: insets.bottom + layout.tabBarHeight + space.huge + bottomInset,
          }}>
          <View style={[styles.column, { maxWidth }]}>
            <View style={styles.header}>
              <View style={styles.titleRow}>
                <View style={styles.titleBlock}>
                  <AppText
                    variant="largeTitle"
                    numberOfLines={2}
                    onLongPress={onLongPressTitle}
                    accessibilityHint={onLongPressTitle ? 'Long press to change' : undefined}>
                    {title}
                  </AppText>
                  {subtitle ? (
                    <AppText
                      variant="footnote"
                      color="textDim"
                      numberOfLines={1}
                      style={styles.subtitle}>
                      {subtitle}
                    </AppText>
                  ) : null}
                </View>
                {right ? <View style={styles.right}>{right}</View> : null}
              </View>

              {/* How much of the trading day has gone. A calendar tells you the
                  date; this tells you how much of it is left to do anything with. */}
              {dayProgress !== undefined ? (
                <View style={[styles.dayTrack, { backgroundColor: colors.hairline }]}>
                  <View
                    style={[
                      styles.dayFill,
                      {
                        width: `${Math.max(0, Math.min(dayProgress, 1)) * 100}%`,
                        backgroundColor: colors.accent,
                      },
                    ]}
                  />
                </View>
              ) : null}
            </View>

            {children}
          </View>
        </Animated.ScrollView>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  // Centred on tablets, full-bleed on phones (maxWidth is undefined there).
  column: { width: '100%', alignSelf: 'center' },
  header: { paddingHorizontal: space.gutter, paddingBottom: space.lg },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  titleBlock: { flex: 1 },
  subtitle: { marginTop: 3 },
  right: { marginTop: 2 },
  dayTrack: {
    height: 2,
    borderRadius: radius.pill,
    marginTop: space.base,
    overflow: 'hidden',
  },
  dayFill: { height: '100%', borderRadius: radius.pill },
});
