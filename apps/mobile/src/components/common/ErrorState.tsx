import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props { message?: string; onRetry?: () => void }

export function ErrorState({ message = '데이터를 불러올 수 없습니다', onRetry }: Props) {
  return (
    <View style={styles.container}>
      <Ionicons name="alert-circle-outline" size={48} color="#F87171" />
      <Text style={styles.text}>{message}</Text>
      {onRetry && (
        <TouchableOpacity style={styles.btn} onPress={onRetry}>
          <Text style={styles.btnText}>다시 시도</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },
  text: { fontSize: 14, color: '#991B1B', marginTop: 12 },
  btn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: '#4F46E5', borderRadius: 8 },
  btnText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
});
