'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { portalDateText } from './portal-date';
import { ApiError, apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import type { MainTab } from '../_types';
import PortalSheet from './PortalSheet';
import { SkeletonCard, EmptyState } from './index';
import { PT, usePortalTAttr } from './PT';
import { isAccountRequired, mayCallAccountFeature, useAccountFeature } from '../_auth/session-check';

/**
 * F-1 웹 알림 센터 (기획 patient-portal-enhancement §3.1 · 설계 §1)
 * 백엔드는 기존 patient-auth 알림 API 재사용(신규 EP 0) — PatientAccountAuthGuard(환자계정 JWT) 전용.
 * 레거시 포털 토큰(MRN+생년월일) 세션은 401 → 가입 유도 폴백. 위임 세션은 벨 자체를 숨김(page.tsx).
 */

/** 401(레거시 포털 세션) — '계정 없음' 안내로 접어도 되는 유일한 실패 */
// 🔴 (v4.93.2) 서버는 살아 있는 등록번호 세션에 403 PATIENT_ACCOUNT_REQUIRED 로 답한다(401 은 세션 끝 — 포털이 로그아웃시킨다)
const isUnauthorized = (e: unknown) => e instanceof ApiError && (e.code === 'UNAUTHORIZED' || isAccountRequired(e));

interface PatientNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationSettingRow {
  type: string;
  enabled: boolean;
  pushEnabled: boolean;
  smsEnabled: boolean;
}

// 실사용 알림 type → 탭/세그먼트 딥링크 (설계 §1.4 — 서버 발송 type 전수 기준)
const TYPE_ROUTES: Record<string, { tab: MainTab; segment?: string }> = {
  APPOINTMENT: { tab: 'care', segment: 'appointments' },
  CALLED: { tab: 'home' },
  LAB_RESULT: { tab: 'health', segment: 'labs' },
  PHARMACY: { tab: 'health', segment: 'medications' },
  MEDICATION_REMINDER: { tab: 'health', segment: 'medications' },
  BILLING: { tab: 'services', segment: 'billing' },
  CONSENT: { tab: 'care', segment: 'consent' },
  CHECKUP_RESULT: { tab: 'health', segment: 'checkup' },
  ROUND: { tab: 'home' },
  DOCUMENT_READY: { tab: 'services', segment: 'documents' },
  MARKETING: { tab: 'home' }, // 스카우트: route 누락으로 클릭 무반응이던 유형
  TREATMENT_SCHEDULE: { tab: 'care', segment: 'schedule' },
};

const TYPE_ICON: Record<string, string> = {
  APPOINTMENT: '📅',
  CALLED: '🔔',
  LAB_RESULT: '🧪',
  PHARMACY: '💊',
  MEDICATION_REMINDER: '💊',
  BILLING: '💳',
  CONSENT: '📝',
  CHECKUP_RESULT: '🩺',
  ROUND: '👨‍⚕️',
  DOCUMENT_READY: '📄',
  MARKETING: '📢',
};

// 설정 화면 라벨 — 서버 defaultTypes(patient-auth) 문자열과 동일 정본
const SETTING_LABEL: Record<string, string> = {
  APPOINTMENT_REMINDER: '예약 알림',
  LAB_RESULT: '검사 결과',
  DOCUMENT_READY: '서류 발급 완료',
  BILLING: '진료비·수납',
  QUESTIONNAIRE: '문진표',
  SYSTEM: '공지·시스템',
  MEDICATION_REMINDER: '복약 알림',
};

/**
 * 알림 경과 표기 — 🔴 (2026-09-13) `방금 전`·`N분 전`·`N시간 전` 이 **어떤 포털 언어에서도 한국어**였다.
 *    포털 언어 축(`usePortalTAttr` · 포털 카탈로그)으로 옮기고, 수가 문장 한가운데 오는 언어가 있어
 *    **한 문장 한 키**(`{수}분 전`)로 넘긴다. 직원 `<T>`/`useDurationText` 는 다른 축이라 쓰지 않는다.
 * 🔴 미래 시각(서버·기기 시계 차)은 '방금'이라 말하지 않는다 — 날짜로 그린다(판정 규칙 §1). 무효 시각은 `-`.
 */
export const timeAgo = (iso: string, tAttr: (k: string) => string) => {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '-';
  const diff = Date.now() - t;
  if (diff < 0) return portalDateText(iso, 'date');
  const min = Math.floor(diff / 60_000);
  if (min < 1) return tAttr('방금 전');
  if (min < 60) return tAttr('{수}분 전').replace('{수}', String(min));
  const hr = Math.floor(min / 60);
  if (hr < 24) return tAttr('{수}시간 전').replace('{수}', String(hr));
  return portalDateText(iso, 'date');
};

/**
 * 헤더 벨 배지용 미읽음 수.
 *
 * 🔴 예전엔 모든 실패를 `null` 로 접었다 → 배지가 사라져 **"알림 없음"** 과 구분되지 않았다.
 * 401(레거시 포털 세션)만 '계정 없음'이라 배지가 없는 게 맞고(`accountless`),
 * 그 밖의 실패는 실패라고 말한다(`loadFailed`).
 */
export function useUnreadCount(enabled: boolean) {
  // 🔴 (A1) 계정 없는 세션은 부르지 않는다 — 능력표가 false 면 처음부터 '계정 없음'
  const allowed = useAccountFeature('notifications');
  const { data, isError, error, refetch } = useQuery({
    queryKey: ['portal-notify-unread'],
    queryFn: () =>
      apiClient
        .get<{ data: { count: number } }>('/api/v1/patient-auth/notifications/unread-count')
        .then(r => r?.data?.count ?? 0),
    enabled: enabled && mayCallAccountFeature(allowed),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const accountless = allowed === false || (isError && isUnauthorized(error));
  return { data, isError, error, refetch, accountless, loadFailed: isError && !accountless };
}

/** 알림 패널 — PortalSheet 기반 목록·읽음·전체읽음·딥링크 */
export function NotificationPanel({
  open,
  onClose,
  onNavigate,
  onSignupGuide,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: MainTab, segment?: string) => void;
  onSignupGuide?: () => void;
}) {
  const tAttr = usePortalTAttr();
  const qc = useQueryClient();
  const allowed = useAccountFeature('notifications');
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-notify-list'],
    queryFn: () =>
      apiClient
        .get<{ data: { items: PatientNotification[]; total: number } }>('/api/v1/patient-auth/notifications', { limit: 20 })
        .then(r => r?.data ?? { items: [], total: 0 }),
    enabled: open && mayCallAccountFeature(allowed),
    staleTime: 15_000,
  });
  // 🔴 401(레거시 세션)만 '계정 안내'다 — 그 밖의 실패까지 안내로 접으면 장애가 '가입하세요'로 보인다
  const needsAccount = allowed === false || (isError && isUnauthorized(error));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['portal-notify-list'] });
    qc.invalidateQueries({ queryKey: ['portal-notify-unread'] });
  };
  const markRead = useMutation({
    mutationFn: (id: string) => apiClient.put(`/api/v1/patient-auth/notifications/${id}/read`),
    onSuccess: invalidate,
  });
  const readAll = useMutation({
    mutationFn: () => apiClient.put('/api/v1/patient-auth/notifications/read-all'),
    onSuccess: invalidate,
  });

  const handleItemClick = (n: PatientNotification) => {
    if (!n.isRead) markRead.mutate(n.id);
    const route = TYPE_ROUTES[n.type];
    if (route) {
      onNavigate(route.tab, route.segment);
      onClose();
    }
  };

  const items = data?.items ?? [];
  const hasUnread = items.some(n => !n.isRead);

  return (
    <PortalSheet open={open} onClose={onClose} title={tAttr('알림')}>
      {needsAccount ? (
        <EmptyState
          icon="🔔"
          title="알림은 환자 계정에서 제공됩니다"
          description="휴대폰 번호 계정으로 로그인하면 예약·검사·서류 알림을 이곳에서 확인하실 수 있습니다."
          actionLabel={onSignupGuide ? '계정 만들기' : undefined}
          onAction={onSignupGuide}
        />
      ) : isError ? (
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonCard lines={4} />
      ) : items.length === 0 ? (
        <EmptyState icon="🔔" title="새 알림이 없습니다" description="예약·검사·서류 소식이 도착하면 이곳에서 확인하실 수 있습니다." />
      ) : null}
      {items.length > 0 && (
        <div>
          {hasUnread && (
            <div className="flex justify-end mb-2">
              <button
                onClick={() => readAll.mutate()}
                disabled={readAll.isPending}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
              >
                <PT k="모두 읽음" />
              </button>
            </div>
          )}
          <div className="divide-y divide-gray-100">
            {items.map(n => (
              <button
                key={n.id}
                onClick={() => handleItemClick(n)}
                className={`w-full flex items-start gap-3 px-1 py-3 text-left hover:bg-gray-50 transition-colors ${n.isRead ? 'opacity-60' : ''}`}
              >
                <span className="text-lg leading-none mt-0.5">{TYPE_ICON[n.type] ?? '🔔'}</span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" aria-label={tAttr('미읽음')} />}
                    <span className="text-sm font-medium text-gray-900 truncate">{n.title}</span>
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</span>
                  <span className="block text-[10px] text-gray-400 mt-1">{timeAgo(n.createdAt, tAttr)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </PortalSheet>
  );
}

/** 알림 설정 — NotificationSetting(type 행 단위) 조회/저장. MoreTab '준비 중' 해소 */
export function NotificationSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tAttr = usePortalTAttr();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-notify-settings'],
    queryFn: () =>
      apiClient
        .get<{ data: NotificationSettingRow[] }>('/api/v1/patient-auth/notifications/settings')
        .then(r => (Array.isArray(r?.data) ? r.data : [])),
    enabled: open,
    staleTime: 30_000,
  });
  const needsAccount = isError && isUnauthorized(error);

  const save = useMutation({
    mutationFn: (settings: NotificationSettingRow[]) =>
      apiClient.put('/api/v1/patient-auth/notifications/settings', { settings }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-notify-settings'] }),
    // 저장 실패 시 낙관적 setQueryData(toggle)로 바뀐 화면을 서버 상태로 원복
    onError: () => qc.invalidateQueries({ queryKey: ['portal-notify-settings'] }),
  });

  const toggle = (row: NotificationSettingRow, field: 'enabled' | 'pushEnabled') => {
    if (!data) return;
    const next = data.map(s => (s.type === row.type ? { ...s, [field]: !s[field] } : s));
    save.mutate(next);
    qc.setQueryData(['portal-notify-settings'], next);
  };

  return (
    <PortalSheet open={open} onClose={onClose} title={tAttr('알림 설정')}>
      {needsAccount && (
        <EmptyState
          icon="🔔"
          title="알림 설정은 환자 계정에서 제공됩니다"
          description="휴대폰 번호 계정으로 로그인하면 알림 종류별 수신 여부를 설정하실 수 있습니다."
        />
      )}
      {isError && !needsAccount && <QueryErrorFallback error={error} onRetry={() => refetch()} />}
      {isLoading && !isError && <SkeletonCard lines={5} />}
      {!isLoading && !isError && data != null && (
        <div className="divide-y divide-gray-100">
          {data.map(row => (
            <div key={row.type} className="flex items-center gap-3 py-3">
              <span className="text-sm text-gray-700 flex-1">{SETTING_LABEL[row.type] ?? row.type}</span>
              <button
                onClick={() => toggle(row, 'enabled')}
                role="switch"
                aria-checked={row.enabled}
                aria-label={`${SETTING_LABEL[row.type] ?? row.type} 수신`}
                className={`relative w-10 h-6 rounded-full transition-colors ${row.enabled ? 'bg-blue-600' : 'bg-gray-200'}`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${row.enabled ? 'left-[18px]' : 'left-0.5'}`}
                />
              </button>
            </div>
          ))}
          <p className="text-[10px] text-gray-400 pt-3">푸시 알림은 모바일 앱에서 기기 등록 후 수신됩니다.</p>
        </div>
      )}
    </PortalSheet>
  );
}
