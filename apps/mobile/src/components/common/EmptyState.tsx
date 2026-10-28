import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  message: string;
}

export function EmptyState({ icon = 'document-outline', message }: Props) {
  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={48} color="#D1D5DB" />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },
  text: { fontSize: 15, color: '#9CA3AF', marginTop: 12, textAlign: 'center' },
});
