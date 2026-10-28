import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  title: string;
  subtitle?: string;
  accentColor?: string;
  children: React.ReactNode;
}

export function InfoCard({ title, subtitle, accentColor = '#4F46E5', children }: Props) {
  return (
    <View style={styles.card}>
      <View style={[styles.accent, { backgroundColor: accentColor }]} />
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <View style={styles.body}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  accent: { width: 4, borderTopLeftRadius: 12, borderBottomLeftRadius: 12 },
  content: { flex: 1, padding: 14 },
  title: { fontSize: 14, fontWeight: '700', color: '#1F2937' },
  subtitle: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  body: { marginTop: 8 },
});
