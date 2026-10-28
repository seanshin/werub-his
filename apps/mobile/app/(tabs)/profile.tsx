import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { apiClient } from '../../src/lib/api-client';

interface ProfileData {
  familyName: string;
  givenName: string;
  phone: string;
  email: string;
  address: string;
  dateOfBirth?: string;
  gender?: string;
  mrn?: string;
  [key: string]: any;
}

export default function ProfileScreen() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<ProfileData>({
    familyName: '',
    givenName: '',
    phone: '',
    email: '',
    address: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () =>
      apiClient.get<{ data: ProfileData }>('/api/v1/portal/profile'),
  });

  const profileData: ProfileData | null = (data as any)?.data ?? null;

  useEffect(() => {
    if (profileData) {
      setForm(profileData);
    }
  }, [profileData]);

  const updateMutation = useMutation({
    mutationFn: (body: Partial<ProfileData>) =>
      apiClient.put('/api/v1/portal/profile', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      setIsEditing(false);
      Alert.alert('알림', '프로필이 수정되었습니다.');
    },
    onError: (err: any) => {
      Alert.alert('오류', err?.message ?? '프로필 수정에 실패했습니다.');
    },
  });

  const handleSave = () => {
    updateMutation.mutate({
      phone: form.phone,
      email: form.email,
      address: form.address,
    });
  };

  const handleCancel = () => {
    if (profileData) {
      setForm(profileData);
    }
    setIsEditing(false);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Stack.Screen options={{ title: '프로필', headerShown: true }} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4F46E5" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <Stack.Screen
        options={{
          title: '프로필',
          headerStyle: { backgroundColor: '#FFFFFF' },
          headerTitleStyle: { fontWeight: '700', fontSize: 18, color: '#111827' },
          headerShadowVisible: false,
          headerRight: () =>
            !isEditing ? (
              <TouchableOpacity
                onPress={() => setIsEditing(true)}
                style={styles.headerButton}
              >
                <Text style={styles.editBtn}>편집</Text>
              </TouchableOpacity>
            ) : null,
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
        >
          {/* 프로필 아바타 */}
          <View style={styles.avatarSection}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={40} color="#FFFFFF" />
            </View>
            <Text style={styles.fullName}>
              {form.familyName}{form.givenName}
            </Text>
            {form.dateOfBirth && (
              <Text style={styles.subInfo}>
                {form.dateOfBirth} / {form.gender === 'M' ? '남' : form.gender === 'F' ? '여' : form.gender ?? ''}
              </Text>
            )}
          </View>

          {/* 폼 필드 */}
          <View style={styles.fieldGroup}>
            <Text style={styles.sectionLabel}>기본 정보</Text>

            <View style={styles.field}>
              <Text style={styles.label}>성</Text>
              <TextInput
                style={[styles.input, styles.inputDisabled]}
                value={form.familyName}
                editable={false}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>이름</Text>
              <TextInput
                style={[styles.input, styles.inputDisabled]}
                value={form.givenName}
                editable={false}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>연락처</Text>
              <TextInput
                style={[styles.input, isEditing && styles.inputEditable]}
                value={form.phone}
                maxLength={20}
                onChangeText={(v) => setForm({ ...form, phone: v })}
                editable={isEditing}
                keyboardType="phone-pad"
                placeholder="010-0000-0000"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>이메일</Text>
              <TextInput
                style={[styles.input, isEditing && styles.inputEditable]}
                value={form.email}
                maxLength={200}
                onChangeText={(v) => setForm({ ...form, email: v })}
                editable={isEditing}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="email@example.com"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>주소</Text>
              <TextInput
                style={[styles.input, isEditing && styles.inputEditable]}
                value={form.address}
                maxLength={500}
                onChangeText={(v) => setForm({ ...form, address: v })}
                editable={isEditing}
                placeholder="주소를 입력하세요"
              />
            </View>
          </View>

          {/* 저장/취소 버튼 */}
          {isEditing && (
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
                <Text style={styles.cancelBtnText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSave}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveBtnText}>저장</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  headerButton: {
    marginRight: 8,
  },
  editBtn: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4F46E5',
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#4F46E5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  fullName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  subInfo: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  fieldGroup: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  inputDisabled: {
    color: '#9CA3AF',
    backgroundColor: '#F3F4F6',
  },
  inputEditable: {
    borderColor: '#4F46E5',
    backgroundColor: '#FFFFFF',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6B7280',
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
