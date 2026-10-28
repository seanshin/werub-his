/**
 * 간호 원내 규정 현황(2026-10-26) — `GET /nursing-rules` · 보호대 점검 간격·통증 재평가 규정·인계 인수 방식(값과 출처).
 * 정의·라벨·값 검사 정본 = shared `nursing-rules` · 쓰기는 `PUT /config/:key`(관리자 · 같은 값 검사).
 */
import { useQuery } from '@tanstack/react-query';
import type { HandoffAckMode, NursingRuleSource, PainReassessRule, RiskReassessIntervals } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';

export interface NursingRulesOverview {
  restraint: { minutes: number; source: Extract<NursingRuleSource, 'CONFIGURED' | 'SEED' | 'CODE_DEFAULT' | 'UNKNOWN'> };
  painReassess: { rule: PainReassessRule | null; source: Extract<NursingRuleSource, 'CONFIGURED' | 'SEED' | 'UNSET' | 'UNKNOWN'> };
  /** mode=null 이면 모른다(설정 조회 실패) */
  handoffAckMode: { mode: HandoffAckMode | null; source: Extract<NursingRuleSource, 'CONFIGURED' | 'SEED' | 'CODE_DEFAULT' | 'UNKNOWN'> };
  /** 낙상·욕창 위험 재평가 주기(시간) — 옛 서버면 없음 */
  riskReassessIntervals?: { table: RiskReassessIntervals; source: Extract<NursingRuleSource, 'CONFIGURED' | 'SEED' | 'CODE_DEFAULT' | 'UNKNOWN'> };
}

export const unwrapData = <T,>(r: unknown): T | undefined => ((r as { data?: { data?: T } })?.data?.data ?? (r as { data?: T })?.data);

export function useNursingRules() {
  return useQuery({
    queryKey: ['nursing-rules'],
    queryFn: async () => unwrapData<NursingRulesOverview>(await apiClient.get('/api/v1/nursing-rules')) ?? null,
    staleTime: 60_000,
  });
}
