import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

interface Props { message?: string; color?: string }

export function LoadingState({ message = '불러오는 중...', color = '#4F46E5' }: Props) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={color} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  text: { fontSize: 14, color: '#6B7280', marginTop: 12 },
});
