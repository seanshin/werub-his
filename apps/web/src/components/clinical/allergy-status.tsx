'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { KDate } from '@/components/ui/display';
import { allergyStatusMeta, allergyStatusIsReassuring, canReadAllergyStatus } from '@hospital-run/shared';
import { useAuthStore } from '@/stores/auth-store';

/**
 * 알레르기 확인 상태 배지 — **서버 4상태 정본을 그대로** 말한다.
 *
 * 🔴 종전 헤더는 `allergies.length === 0` 이면 초록 `NKDA`(알려진 약물 알레르기 없음)를 달았다.
 *    그것은 "물어봤고 없었다"는 **임상적 단언**인데, 운영에서 알레르기 평가를 받은 환자는 **0명**이었다
 *    (환자 874명 · 알레르기 기록 12명 · 평가 0명) — **862명이 근거 없는 초록 배지**를 달고 있었다.
 *
 * 🔴 **초록은 평가 기록이 있을 때만.** 🔴 **로딩 중을 "확인 불가"라고 말하지 않는다.**
 * 🔴 **조회 실패를 초록으로 접지 않는다** — 실패는 주의다.
 *
 * 🔴 2026-08-27 — 이 파일은 원래 `(main)/patients/[id]/components/` 안에 있었다. 그래서 회진 보드·
 *    간호 타블렛·원격진료 패널은 **자기 판정을 새로 적었고**(`allergies.length === 0` → 초록 NKDA),
 *    C1 이 고친 것은 차트 헤더 한 곳뿐이었다. **정본이 한 라우트 안에 있으면 다른 라우트가 자기 것을 만든다** —
 *    그래서 라우트 밖으로 옮겼다.
 */
export interface AllergyStatusResult {
  status: string;
  assessedAt: string | null;
  allergies?: unknown[];
}

const TONE_CLASS: Record<'danger' | 'warn' | 'safe', string> = {
  danger: 'bg-red-100 text-red-700 border-red-300',
  warn: 'bg-amber-100 text-amber-800 border-amber-300',
  safe: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export function useAllergyStatus(patientId: string, enabled = true) {
  return useQuery({
    queryKey: ['allergy-status', patientId],
    // 🔴 `.catch(() => 기본값)` 을 쓰지 않는다 — 쓰면 실패가 "알레르기 없음"이 된다
    queryFn: () =>
      apiClient.get<{ data: AllergyStatusResult }>(`/api/v1/patients/${patientId}/allergies/status`),
    enabled: !!patientId && enabled,
    staleTime: 60_000,
  });
}

export function AllergyStatusBadge({
  patientId,
  allergyCount,
}: {
  patientId: string;
  /** 화면이 이미 갖고 있는 활성 알레르기 수(있으면 건수를 함께 보여준다) */
  allergyCount?: number;
}) {
  const role = useAuthStore((s) => s.user?.role);
  // 🔴 권한이 없으면 **부르지 않는다.** 403 을 "확인 못 함"으로 그리면 시스템 장애처럼 읽히고,
  //    목록에 알레르기가 있는데도 경고가 약해진다(실측: LAB_TECH·RECEPTIONIST·MEDICAL_RECORDS·CHECKUP
  //    은 status 403 인데 `/summary` 로 알레르기 목록은 그대로 받는다).
  const allowed = canReadAllergyStatus(role);
  const { data, isLoading, isError } = useAllergyStatus(patientId, allowed);
  const res = (data?.data as AllergyStatusResult | undefined) ?? undefined;

  if (!allowed) {
    // 이 직군이 아는 것은 **목록뿐**이다 — 초록으로 안심시키지 않고, 있는 것은 그대로 경고한다.
    return allergyCount != null && allergyCount > 0 ? (
      <span className={`text-xs font-bold px-2.5 py-1 rounded-full border whitespace-nowrap ${TONE_CLASS.danger}`}>
        ⚠ 알레르기 {allergyCount}건
      </span>
    ) : (
      <span
        title="등록된 알레르기가 없습니다 — 확인 여부는 이 화면에서 알 수 없습니다(권한)."
        className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200 whitespace-nowrap"
      >
        알레르기 기록 없음
      </span>
    );
  }

  // 🔴 아직 안 온 것과 모르는 것은 다른 사실이다
  if (isLoading) {
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 border border-gray-200 whitespace-nowrap">
        알레르기 확인 중…
      </span>
    );
  }

  // 🔴 못 읽었으면 안전한 쪽으로 그리지 않는다
  if (isError || !res) {
    return (
      <span
        title="알레르기 확인 상태를 불러오지 못했습니다 — 없다는 뜻이 아닙니다."
        className={`text-xs font-bold px-2.5 py-1 rounded-full border whitespace-nowrap ${TONE_CLASS.warn}`}
      >
        ⚠ 알레르기 확인 못 함
      </span>
    );
  }

  const meta = allergyStatusMeta(res.status);
  const reassuring = allergyStatusIsReassuring(res.status, res.assessedAt);
  // 🔴 초록은 평가 기록이 있을 때만 — 없으면 주의로 내린다
  const tone = meta.tone === 'safe' && !reassuring ? 'warn' : meta.tone;
  const count = res.status === 'HAS_ALLERGIES' ? allergyCount ?? res.allergies?.length : undefined;

  return (
    <span
      title={meta.meaning}
      className={`text-xs font-bold px-2.5 py-1 rounded-full border inline-flex items-center gap-1 whitespace-nowrap ${TONE_CLASS[tone]}`}
    >
      {tone !== 'safe' && <span aria-hidden="true">⚠</span>}
      {meta.label}
      {count != null && count > 0 && <span>{count}건</span>}
      {reassuring && res.assessedAt && (
        <span className="font-normal opacity-70">
          <KDate value={res.assessedAt} mode="date" />
        </span>
      )}
    </span>
  );
}
