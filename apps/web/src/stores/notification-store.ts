'use client';

import { create } from 'zustand';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { normalizeNotificationSeverity, notificationCategory } from '@hospital-run/shared';

export interface Notification {
  id: string;
  type: 'order' | 'billing' | 'lab' | 'pharmacy' | 'appointment' | 'clinical' | 'approval' | 'consult' | 'system';
  rawType?: string; // 원본 백엔드 type(세분화 카테고리용)
  severity?: 'info' | 'low' | 'warning' | 'moderate' | 'high' | 'critical';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  href?: string;
  refType?: string;
  refId?: string;
}

interface NotificationState {
  notifications: Notification[];
  /** 알림 조회 실패 — 패널이 '없음'으로 말하지 않게 한다 */
  fetchError: boolean;
  /** 한 번이라도 조회에 성공했는가 — 첫 응답 전의 빈 목록을 "알림 없음"으로 말하지 않기 위해 */
  hasFetched: boolean;
  unreadCount: number;
  isOpen: boolean;
  sseAbortController: AbortController | null;
  toggle: () => void;
  close: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  fetchNotifications: () => Promise<void>;
  connectSSE: () => void;
  disconnectSSE: () => void;
}

interface BackendNotif {
  id: string;
  type: string;
  title: string;
  message: string;
  severity?: string;
  isRead?: boolean;
  refType?: string | null;
  refId?: string | null;
  createdAt: string;
}

// 정본(shared) 3단계로 정규화 — ERROR/URGENT/WARN가 info로 오표시되던 버그 봉합
function mapNotifSeverity(s?: string): Notification['severity'] {
  return normalizeNotificationSeverity(s).toLowerCase() as Notification['severity'];
}

// 알림 type→카테고리: shared 정본(notificationCategory) 단일 소스 사용(종전 중복 제거·VoC/consult 포함)
function mapNotifType(t?: string): Notification['type'] {
  return notificationCategory(t) as Notification['type'];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 알림 → 이동할 화면. 🔴 (2026-09-30) 가능하면 **그 건**으로 보낸다 — 일반 목록으로 보내면 의사가 목록에서 다시 찾는다.
 *  · `PATIENT` + 환자 id(UUID) → 그 환자 차트
 *  · 검사 결과·영상 판독 도착(type LAB_RESULT·IMAGING_REPORT, refType ORDER) → 검사결과 확인함(확인하면 줄어드는 목록)
 *  refId 가 UUID 가 아니면 경로에 넣지 않는다(코드·MRN 을 넣으면 없는 화면으로 간다).
 */
export function hrefForNotification(refType?: string | null, refId?: string | null, rawType?: string | null): string | undefined {
  const ref = (refType ?? '').toUpperCase();
  const type = (rawType ?? '').toUpperCase();
  if (ref === 'PATIENT' && refId && UUID_RE.test(refId)) return `/patients/${refId}`;
  if (ref === 'ORDER' && (type === 'LAB_RESULT' || type === 'IMAGING_REPORT')) return '/doctor-inbox?tab=results';
  // 대체조제 판정 결과는 **약사**가 받는다 — 의사 화면(/pharmacist-replies · DOCTOR_ADMIN)으로 보내면 열리지 않는다(2026-09-30)
  if (ref === 'GENERIC_SUBSTITUTION' && type === 'SUBSTITUTION_DECIDED') return '/pharmacy/admin';
  // 협진 접수·회신 도착은 **의뢰한 의사**가 받는다 — 받은 협진 목록(/consultations 기본)이 아니라 보낸 협진으로(2026-10-10)
  if (ref === 'CONSULTATION' && type === 'CONSULT_REPLY') return '/consultations?scope=sent';
  // 미서명 차트 회수 → 할 일함 '미서명 기록'(종전 환자 목록 — 어느 진료인지 다시 찾아야 했다)
  if (ref === 'DRAFT_CHART') return '/doctor-inbox?tab=unsigned';
  return hrefForRef(refType);
}

/** 스카우트: 발신처 실측 refType 전량 커버(종전 7종 → 미매핑 클릭 무반응 해소). 미지 유형은 알림 목록. */
function hrefForRef(refType?: string | null): string | undefined {
  switch ((refType ?? '').toUpperCase()) {
    case 'ORDER': case 'LAB_RESULT': case 'LAB': return '/orders';
    case 'CONSENT': return '/workstation/consent';
    case 'BILLING': return '/billing';
    case 'CLAIM': return '/claims';
    case 'GUARDIAN': return '/admin/audit';
    case 'CONSULTATION': return '/consultations';
    case 'REFERRAL': return '/consultations';
    case 'EWS': case 'RISK_REASSESSMENT': case 'FALL_RISK': return '/nursing-station';
    case 'GOLDEN_PATHWAY': return '/emergency-board';
    case 'SAFETY_INCIDENT': return '/safety';
    case 'CS_STOCK': return '/admin/controlled-substance';
    case 'RESTRAINT': case 'NEWBORN': case 'DELIVERY': case 'OBGYN_EXAM': case 'PSYCH_EXAM': case 'HOSPICE': return '/nursing-station';
    case 'DIAGNOSTIC_TEST': return '/diagnostics';
    // 약사 중재 회신·대체조제 승인 요청 → 의사 워크리스트(경보 등록부 actionHref 와 같은 값)
    case 'PHARMACIST_INTERVENTION': case 'GENERIC_SUBSTITUTION': return '/doctor-inbox?tab=pharmacist';
    case 'BED_TRANSFER': return '/bed-transfers'; // 병동 간 전동 요청·수락(2026-09-30)
    case 'CLINICAL_HANDOFF': return '/handoffs'; // 인수인계 — 스탭포털(/staff/handoffs)은 자체 진입
    // 미서명 차트 회수·만성 리콜(PATIENT 는 종전 미매핑 → 클릭이 알림 목록에서 끝났다)
    case 'DRAFT_CHART': case 'PATIENT': return '/patients';
    case 'LEAVE': case 'DUTY_SWAP': return '/ess';
    case 'PRE_AUTH': return '/ess';
    case 'DOCUMENT_REQUEST': return '/workstation/documents';
    // D4: 상담 세션·VoC 딥링크(종전 미매핑 → 알림 클릭 무반응 봉합)
    case 'CONSULTSESSION': case 'CONSULT_ESCALATION': case 'CONSULT_NEW': case 'CONSULT_SLA': return '/consult';
    case 'VOCTICKET': case 'VOC_SLA_OVERDUE': case 'VOC_PATIENT_REPLY': case 'VOC_REOPENED': return '/admin/voc';
    case 'GOLIVEITEM': case 'GOLIVE_OVERDUE': case 'GOLIVE_READY': return '/admin/go-live';
    default: return '/notifications';
  }
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  fetchError: false,
  hasFetched: false,
  unreadCount: 0,
  isOpen: false,
  sseAbortController: null,

  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  close: () => set({ isOpen: false }),

  markRead: (id) => {
    set((s) => {
      const notifications = s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      );
      return { notifications, unreadCount: notifications.filter((n) => !n.read).length };
    });
    // 스카우트: 합성 prefix 치환 잔재 제거(실 ID 그대로)·실패 시 재조회로 서버 정합 복구
    apiClient.patch(`/api/v1/notifications/${id}/read`, {}).catch(() => { void get().fetchNotifications(); });
  },

  markAllRead: () => {
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
    apiClient.patch('/api/v1/notifications/read-all', {}).catch(() => {});
  },

  fetchNotifications: async () => {
    try {
      // 본인에게 타겟팅된 알림만 (백엔드 Notification 테이블, userId 필터됨)
      const res = await apiClient.get<{ data: unknown }>('/api/v1/notifications?limit=100');
      const raw = (res?.data as { data?: unknown })?.data ?? res?.data ?? [];
      const list = (Array.isArray(raw) ? raw : []) as BackendNotif[];
      const notifications: Notification[] = list.map((n) => ({
        id: n.id,
        type: mapNotifType(n.type),
        rawType: n.type,
        severity: mapNotifSeverity(n.severity),
        title: n.title,
        message: n.message,
        read: !!n.isRead,
        createdAt: n.createdAt,
        href: hrefForNotification(n.refType, n.refId, n.type),
        refType: n.refType ?? undefined,
        refId: n.refId ?? undefined,
      }));
      set({
        notifications: notifications.slice(0, 100),
        unreadCount: notifications.filter((n) => !n.read).length,
        fetchError: false,
        hasFetched: true,
      });
    } catch {
      /**
       * 🔴 조회 실패를 삼키면 패널이 **"새 알림이 없습니다"** 라고 말한다(2026-09-02).
       *    첫 로드가 실패하면 빈 배열이 그대로 남아, 미확인 위급값·결재가 있는지조차 모르는 상태를
       *    "없다"로 단정한다. 실패는 실패라고 기록해 화면이 그대로 말하게 한다.
       */
      set({ fetchError: true });
    }
  },

  connectSSE: () => {
    const token = apiClient.getToken();
    if (!token) return;

    // 기존 연결 종료
    get().disconnectSSE();

    const abortController = new AbortController();
    set({ sseAbortController: abortController });

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';

    const connect = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/v1/notifications/stream`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'notification') {
                // 스카우트: 위급 알림이 배지 +1로만 조용히 쌓이던 문제 — CRITICAL/WARNING은 토스트로 표면화
                const sev = String(data.severity ?? '').toUpperCase();
                if (sev === 'CRITICAL') toast.error(`${data.title} — ${String(data.message ?? '').slice(0, 80)}`);
                else if (sev === 'WARNING') toast.warning(`${data.title} — ${String(data.message ?? '').slice(0, 80)}`);
                set((s) => ({
                  notifications: [
                    {
                      id: data.id,
                      title: data.title,
                      message: data.message,
                      severity: mapNotifSeverity(data.severity),
                      read: false,
                      createdAt: new Date().toISOString(),
                      type: mapNotifType(data.notificationType),
                      rawType: data.notificationType,
                      refType: data.refType,
                      refId: data.refId,
                      // 🔴 실시간으로 받은 알림엔 이동 경로가 없어 눌러도 아무 데도 가지 않았다 — 조회분과 같은 정본으로
                      href: hrefForNotification(data.refType, data.refId, data.notificationType),
                    },
                    ...s.notifications,
                  ].slice(0, 100),
                  unreadCount: s.unreadCount + 1,
                }));
              } else if (data.type === 'init') {
                set({ unreadCount: data.unreadCount });
              }
              // heartbeat는 무시
            } catch {
              // JSON 파싱 실패 무시
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // 5초 후 재연결
        setTimeout(() => {
          if (!abortController.signal.aborted) connect();
        }, 5000);
      }
    };

    connect();
  },

  disconnectSSE: () => {
    const controller = get().sseAbortController;
    if (controller) {
      controller.abort();
      set({ sseAbortController: null });
    }
  },
}));
