'use client';

/**
 * 임상차트 검수 상태 훅 — BE 요약({ fourEyes, items })을 chartId map 으로.
 * 정의(코드) verified=false 를 런타임 오버라이드하되:
 *  - 4-eyes 활성 시 서로 다른 승인자 2인 미만이면 '2차 승인 대기'
 *  - 승인 시점 defHash ≠ 현재 정의 해시면 '재검수 필요(정의 변경)'
 * react-query 공유 캐시 — Runner·목록·편집기 어디서 불러도 요청 1회 dedup.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { computeDefHash, type ClinicalChartDef } from '@/lib/clinical-charts';

export interface ChartVerification {
  chartId: string;
  status: 'VERIFIED' | 'REJECTED';
  sourceGuideline?: string | null;
  sourceVersion?: string | null;
  note?: string | null;
  defHash?: string | null;
  approverCount?: number;
  approverNames?: string[];
  verifiedByName: string;
  createdAt: string;
}

interface SummaryResponse { fourEyes: boolean; fourEyesSource?: 'config' | 'default'; items: ChartVerification[] }

export function useChartVerifications() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['clinical-chart-verifications'],
    queryFn: () => apiClient.get<{ data: SummaryResponse | ChartVerification[] }>('/api/v1/clinical-chart-verifications'),
    staleTime: 60_000,
  });

  const { map, fourEyes, fourEyesSource } = useMemo(() => {
    const raw = data?.data as SummaryResponse | ChartVerification[] | { data?: SummaryResponse | ChartVerification[] } | undefined;
    const unwrapped = (raw && !Array.isArray(raw) && 'data' in raw ? raw.data : raw) as SummaryResponse | ChartVerification[] | undefined;
    // 신형 { fourEyes, items } / 구형 배열 응답 모두 수용(배포 창 호환)
    const items: ChartVerification[] = Array.isArray(unwrapped) ? unwrapped : unwrapped?.items ?? [];
    const fe = !Array.isArray(unwrapped) && unwrapped ? unwrapped.fourEyes === true : false;
    // 4-eyes 출처 — 설정 행(config) / 설정 없음 = 서버 안전 기본값(default) / 모름(옛 응답) null
    const src = !Array.isArray(unwrapped) && unwrapped?.fourEyesSource ? unwrapped.fourEyesSource : null;
    const m: Record<string, ChartVerification> = {};
    for (const v of items) m[v.chartId] = v;
    return { map: m, fourEyes: fe, fourEyesSource: src };
  }, [data]);

  // 🔴 isError — 요약을 못 받으면 map 이 비어 89개 전부 "미검증"으로 그려진다. 관리 화면은 이것을 "확인 불가"로 말한다
  //    (임상 화면의 레지멘 처방 초안은 그때도 닫힌다 — 안전 방향).
  return { map, fourEyes, fourEyesSource, isLoading, isError, error, refetch };
}

export type VerifyState = 'verified' | 'pending2nd' | 'defChanged' | 'rejected' | 'unverified';

export const VERIFY_STATE_META: Record<VerifyState, { label: string; cls: string }> = {
  verified: { label: '검증됨', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  pending2nd: { label: '2차 승인 대기', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  defChanged: { label: '재검수 필요(정의 변경)', cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  rejected: { label: '검수 반려', cls: 'bg-red-100 text-red-700 border-red-200' },
  unverified: { label: '미검증 참조용', cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
};

/** 정의 + 검수 요약 → 상태 판정 */
export function verificationState(def: ClinicalChartDef, ver: ChartVerification | undefined, fourEyes: boolean): VerifyState {
  if (def.verified) return 'verified';
  if (!ver) return 'unverified';
  if (ver.status === 'REJECTED') return 'rejected';
  if (ver.defHash && ver.defHash !== computeDefHash(def)) return 'defChanged';
  if (fourEyes && (ver.approverCount ?? 1) < 2) return 'pending2nd';
  return 'verified';
}

/** 유효 검증 여부(boolean) — 기존 호출부 호환용 래퍼 */
export function effectiveVerified(def: ClinicalChartDef, ver: ChartVerification | undefined, fourEyes = false): boolean {
  return verificationState(def, ver, fourEyes) === 'verified';
}

/**
 * 🔴 레지멘(항암 처방 초안을 만드는 도구)은 검증 전까지 처방 초안 생성이 닫혀 있다 — 검수가 실제로 막고 있는 것.
 *    검수 화면은 "막고 있는 레지멘 → 나머지" 순(2026-10-21 임상 규칙 P5 A6 · 결정 `clinicalChart.verifyPolicy` 의 "레지멘 먼저").
 *    정본은 ClinicalChartRunner 의 `regimenVerified`(검증됨일 때만 처방 초안) — 같은 판정이다.
 */
export function blocksOrderDraft(def: Pick<ClinicalChartDef, 'archetype'>, state: VerifyState): boolean {
  return def.archetype === 'tree' && state !== 'verified';
}
