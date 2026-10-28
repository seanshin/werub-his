/**
 * 알레르기 확인 상태 도출 — 순수 함수(2026-10-20 환자 목록 P3 B2 · 단건 `AllergyService.getStatus` 와 목록 묶음 조회가 같은 규칙).
 * 활성 알레르기>0 → HAS_ALLERGIES / 없으면 최신 문진 결과 / 문진 없음·낡음 → NOT_ASSESSED.
 * 🔴 문진이 최근 알레르기 변경보다 오래됐으면 낡은 문진 — 옛 NKA 를 다시 내지 않는다(오안심 방지).
 */
import type { AllergyStatusKey } from '@hospital-run/shared';

export function deriveAllergyStatus(input: {
  activeCount: number;
  latest: { result: string; assessedAt: Date } | null;
  lastAllergyChangeAt: Date | null;
}): AllergyStatusKey {
  const { activeCount, latest, lastAllergyChangeAt } = input;
  if (activeCount > 0) return 'HAS_ALLERGIES';
  const stale = !!latest && !!lastAllergyChangeAt && latest.assessedAt < lastAllergyChangeAt;
  if (!stale && latest?.result === 'NO_KNOWN_ALLERGIES') return 'NO_KNOWN_ALLERGIES';
  if (!stale && latest?.result === 'UNABLE_TO_ASSESS') return 'UNABLE_TO_ASSESS';
  return 'NOT_ASSESSED';
}
