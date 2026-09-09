import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { space } from '@/design/tokens';

export type SectionHeaderProps = {
  title: string;
  /** Right-aligned count or status, e.g. "4 online". */
  trailing?: string;
};

export function SectionHeader({ title, trailing }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <AppText variant="title3" style={styles.title}>
        {title}
      </AppText>
      {trailing ? (
        <AppText variant="footnote" color="textDim">
          {trailing}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: space.gutter,
    marginTop: space.xxl,
    marginBottom: space.md,
  },
  title: { flex: 1 },
});
