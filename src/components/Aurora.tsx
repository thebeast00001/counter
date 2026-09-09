import { memo, useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { useMotion } from '@/design/motion';

export type Blob = {
  id: string;
  color: string;
  /** Fractions of the screen, so one definition works on every handset. */
  x: number;
  y: number;
  radius: number;
  opacity: number;
  /** Seconds for one full drift. Deliberately long and mutually prime. */
  period: number;
  /** How far it wanders, in screen fractions. */
  travel: number;
};

/**
 * Soft fields of colour, slowly drifting.
 *
 * The look Apple Music uses behind a playlist: several large, heavily feathered
 * pools of colour that overlap into something that never resolves into a shape.
 * It works because there are no edges anywhere — the moment a boundary is
 * visible it reads as a gradient someone applied, rather than as light.
 *
 * ## Why it is built this way
 *
 * The first version animated `cx`/`cy` on full-screen SVG circles through
 * `useAnimatedProps`. It looked right and it was unusable: changing a geometry
 * prop invalidates the SVG, so three screen-sized radial gradients were being
 * re-rasterised every frame behind every screen. That is a fill-rate bill the
 * whole app pays, which is why *scrolling* went sluggish — nothing to do with
 * the lists themselves.
 *
 * So nothing about the SVG changes any more. Each pool is rasterised once, at
 * its own size rather than the screen's, and only the container's `transform`
 * is animated. Transforms are handled by the compositor: no re-raster, no
 * layout, no bridge traffic. Same picture, a fraction of the cost.
 */
export const Aurora = memo(function Aurora({ blobs }: { blobs: Blob[] }) {
  const { width, height } = useWindowDimensions();
  const { reduced } = useMotion();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {blobs.map((blob, i) => (
        <Drifter
          key={blob.id}
          blob={blob}
          width={width}
          height={height}
          reduced={reduced}
          phase={i}
        />
      ))}
    </View>
  );
});

const Drifter = memo(function Drifter({
  blob,
  width,
  height,
  reduced,
  phase,
}: {
  blob: Blob;
  width: number;
  height: number;
  reduced: boolean;
  phase: number;
}) {
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      t.value = 0;
      return;
    }
    // Each pool starts part-way through its own cycle, so they never line up
    // into a single pulsing mass.
    t.value = phase * 0.25;
    t.value = withRepeat(
      withTiming(1 + phase * 0.25, {
        duration: blob.period * 1000,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
  }, [blob.period, reduced, phase, t]);

  const drift = useAnimatedStyle(() => {
    const swing = (t.value - 0.5) * 2 * blob.travel;
    return {
      transform: [
        { translateX: swing * width },
        // Vertical travel is halved: sideways drift reads as light moving, while
        // the same amount of vertical movement reads as the layout shifting.
        { translateY: swing * 0.5 * height },
      ],
    };
  });

  const diameter = blob.radius * width * 2;

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: blob.x * width - diameter / 2,
          top: blob.y * height - diameter / 2,
          width: diameter,
          height: diameter,
        },
        drift,
      ]}
      // Promotes the pool to its own texture, so moving it is a compositor
      // operation rather than a redraw of everything underneath.
      renderToHardwareTextureAndroid
      shouldRasterizeIOS
      pointerEvents="none">
      <Svg width={diameter} height={diameter}>
        <Defs>
          <RadialGradient id={blob.id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={blob.color} stopOpacity={blob.opacity} />
            {/* A mid stop keeps the falloff from looking like a vignette — a
                straight line to zero reads as a ring rather than as light. */}
            <Stop offset="0.55" stopColor={blob.color} stopOpacity={blob.opacity * 0.38} />
            <Stop offset="1" stopColor={blob.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={diameter / 2} cy={diameter / 2} r={diameter / 2} fill={`url(#${blob.id})`} />
      </Svg>
    </Animated.View>
  );
});
