import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Dock } from '@/components/Dock';

export default function TabsLayout() {
  return (
    <View style={styles.fill}>
      <Tabs
        tabBar={(props) => <Dock {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: 'transparent' },
        }}>
        <Tabs.Screen name="index" options={{ title: 'Today' }} />
        <Tabs.Screen name="people" options={{ title: 'People' }} />
        <Tabs.Screen name="money" options={{ title: 'Money' }} />
        <Tabs.Screen name="insights" options={{ title: 'Insights' }} />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
