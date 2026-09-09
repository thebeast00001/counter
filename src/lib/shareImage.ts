import { Share } from 'react-native';
import type { View } from 'react-native';
import type { RefObject } from 'react';

import { SHARE_H, SHARE_W } from '@/components/ShareCard';

/**
 * Sharing a picture rather than a paragraph.
 *
 * Both native modules are resolved through a guarded require, the same way the
 * vault resolves SecureStore. If either is missing — an older client, a build
 * without them — the caller still gets a text share rather than a crash. A share
 * button that throws is worse than one that shares less.
 */
type ViewShotModule = typeof import('react-native-view-shot');
type SharingModule = typeof import('expo-sharing');

const ViewShot: ViewShotModule | null = (() => {
  try {
    return require('react-native-view-shot');
  } catch {
    return null;
  }
})();

const Sharing: SharingModule | null = (() => {
  try {
    return require('expo-sharing');
  } catch {
    return null;
  }
})();

export function canShareImage(): boolean {
  return Boolean(ViewShot && Sharing);
}

export type ShareResult = 'image' | 'text' | 'failed';

/**
 * Captures the card and hands it to the share sheet.
 *
 * The output size is stated rather than inherited. The card is laid out at a
 * quarter of its final size — 1080pt wide is not a width any phone can measure
 * sensibly — and `width`/`height` resize the capture to the real 1080×1350.
 * Capturing at the on-screen size and letting the receiving app upscale gives
 * exactly the soft, obviously-a-screenshot image this exists to avoid.
 */
export async function shareCardImage(
  ref: RefObject<View | null>,
  fallbackText: string,
): Promise<ShareResult> {
  if (ViewShot && Sharing && ref.current) {
    try {
      const uri = await ViewShot.captureRef(ref, {
        format: 'png',
        quality: 1,
        width: SHARE_W,
        height: SHARE_H,
        result: 'tmpfile',
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: 'Share',
          UTI: 'public.png',
        });
        return 'image';
      }
    } catch {
      // Fall through to text. A capture can fail for reasons the caller cannot
      // fix — no temp space, a view mid-layout — and none of them are worth
      // showing an error for when there is a working alternative.
    }
  }

  try {
    await Share.share({ message: fallbackText });
    return 'text';
  } catch {
    return 'failed';
  }
}
