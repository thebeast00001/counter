import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from '@/components/AppText';
import { useColors } from '@/design/theme';
import { radius, space, type as typeScale } from '@/design/tokens';

export type TextFieldProps = TextInputProps & {
  label?: string;
  /** Shown right-aligned beside the label, e.g. a character count. */
  hint?: string;
  /**
   * Shown under the field, for confirming how an entry was read.
   *
   * Separate from `hint` because `hint` lives in the label row and vanishes on a
   * field with no label — which is exactly where this was first needed. A field
   * that silently drops the feedback it was given is worse than one that never
   * offered any.
   */
  footnote?: string;
  /**
   * Drops the fill, border and padding so the field can sit inside a container
   * that already provides them — a search pill with an icon, for instance.
   * Without it the field draws its own box inside the outer one and the result
   * looks like a rendering fault.
   */
  bare?: boolean;
};

export function TextField({ label, hint, footnote, bare = false, style, ...rest }: TextFieldProps) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      {label ? (
        <View style={styles.labelRow}>
          <AppText variant="footnote" color="textDim">
            {label}
          </AppText>
          {hint ? (
            <AppText variant="caption" color="textFaint">
              {hint}
            </AppText>
          ) : null}
        </View>
      ) : null}

      <TextInput
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.accent}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[
          bare ? styles.bare : styles.input,
          typeScale.body,
          bare
            ? { color: colors.text }
            : {
                backgroundColor: colors.surfaceHigh,
                color: colors.text,
                borderColor: focused ? colors.accent : 'transparent',
              },
          style,
        ]}
        {...rest}
      />
      {footnote ? (
        <AppText variant="caption" color="textFaint" style={styles.footnote}>
          {footnote}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  footnote: { marginTop: 6, marginLeft: space.sm },
  wrap: { gap: space.sm },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  input: {
    minHeight: 50,
    borderRadius: radius.md,
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    borderWidth: 1.5,
  },
  bare: { minHeight: 44, paddingVertical: space.sm },
});
