'use client';

/**
 * 포털 첫 안내(온보딩) — 계정 단위(2026-10-20).
 *
 * 🔴 종전: 기기 localStorage(`portal-onboarding-done`) 하나 — 같은 계정이라도 기기·브라우저를 바꾸면 다시 떴고,
 *    한 브라우저를 같이 쓰면 다른 사람도 안 봤다.
 * 이제:
 *  · 계정 세션(본인·보호자 위임 = 보는 사람의 계정) → 서버 기록(`PatientAccount.onboardingCompletedAt`)이 정본
 *  · 계정이 없는 등록번호 세션 → 남길 곳이 없어 종전처럼 기기에만(그 사실은 세션 능력표 `onboarding.scope = DEVICE`)
 *  · 능력표가 오는 중이면 띄우지 않는다(떴다가 닫히는 깜빡임) · 능력표 조회 실패(모름)면 종전 기기 기준
 *  · 기기에 이미 본 표시가 있으면 계정 기록이 없어도 이 기기에서는 다시 띄우지 않는다 — 다만 그 표시로 계정 기록을 지어내지 않는다
 *    (한 브라우저를 같이 쓰는 다른 사람이 닫은 것일 수 있다)
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PortalSessionInfo } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { usePortalSession } from '../_auth/session-check';

export const ONBOARDING_DEVICE_KEY = 'portal-onboarding-done';

function readDeviceDone(): boolean {
  try { return typeof window !== 'undefined' && !!window.localStorage.getItem(ONBOARDING_DEVICE_KEY); } catch { return false; }
}
function writeDeviceDone() {
  try { window.localStorage.setItem(ONBOARDING_DEVICE_KEY, 'true'); } catch { /* 저장 못 하면 다음에 다시 뜬다 — 막을 일은 아니다 */ }
}

/** 띄울지 — 순수 판정(테스트 대상) */
export function shouldShowOnboarding(s: {
  pending: boolean; error: boolean; onboarding: PortalSessionInfo['onboarding'] | undefined; deviceDone: boolean;
}): boolean {
  if (s.pending) return false;
  if (s.error || !s.onboarding) return !s.deviceDone;
  if (s.onboarding.scope === 'ACCOUNT') return s.onboarding.completedAt == null && !s.deviceDone;
  return !s.deviceDone;
}

export function usePortalOnboarding(): { show: boolean; complete: () => void } {
  const session = usePortalSession();
  const qc = useQueryClient();
  const [deviceDone, setDeviceDone] = useState(readDeviceDone);
  const show = shouldShowOnboarding({ pending: session.isPending, error: session.isError, onboarding: session.data?.onboarding, deviceDone });

  const complete = () => {
    writeDeviceDone();
    setDeviceDone(true);
    // 계정 세션이면 계정에 남긴다 — 모르면(능력표 실패) 서버가 계정 유무로 가른다(계정 없으면 recorded:false)
    if (session.data?.onboarding?.scope !== 'DEVICE') {
      apiClient.post('/api/v1/portal/onboarding/complete', {})
        .then(() => qc.invalidateQueries({ queryKey: ['portal-session'] }))
        .catch((e: unknown) => {
          // 기록 실패 — 이 기기에서는 다시 안 뜨고 다른 기기에서 한 번 더 뜬다(안내 화면이라 막지 않는다 · 실패는 남긴다)
          console.warn('[portal] 첫 안내 완료 기록 실패', e);
        });
    }
  };
  return { show, complete };
}
