type PickerModule = typeof import('expo-image-picker');

/** Guarded like every other native module here: missing means unavailable, not broken. */
const Picker: PickerModule | null = (() => {
  try {
    return require('expo-image-picker');
  } catch {
    return null;
  }
})();

export function avatarPickerAvailable(): boolean {
  return Picker !== null;
}

/**
 * Picks a photo and returns a local URI.
 *
 * Cropped square at the point of selection rather than masked in the UI. A
 * circular mask over a landscape photo shows whatever happens to be in the
 * middle, which for a portrait is usually a chin — letting the owner choose the
 * crop is the difference between a picture of them and a picture near them.
 *
 * Kept small on purpose. It is displayed at forty points; storing a twelve
 * megapixel original to render it at that size would be the largest thing in the
 * app by an order of magnitude.
 */
export async function pickAvatar(): Promise<string | null> {
  if (!Picker) return null;
  try {
    const permission = await Picker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return null;

    const result = await Picker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });

    if (result.canceled || !result.assets[0]) return null;
    return result.assets[0].uri;
  } catch {
    return null;
  }
}
