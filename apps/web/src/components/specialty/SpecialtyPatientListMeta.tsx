'use client';

import { Tf } from '@/components/ui/i18n-text';

/**
 * 전문과 '이 과 기록이 있는 환자' 목록의 범위 고지(2026-10-10).
 *
 * 🔴 종전 목록은 그 과 기록 표 전체를 상한 없이 읽었고(산부인과만 2,000행에서 말없이 잘림),
 *    머리글은 "내 환자"였지만 실제로는 **누구의 환자든** 그 과 기록이 있는 모든 환자였다.
 *    서버(`GET <과>/patients`)가 최근 기록 순 상한·전체 수·잘림을 `meta` 로 준다 — 자르면 잘랐다고 말한다.
 */
export interface SpecialtyPatientMeta {
  total: number;
  limit: number;
  truncated: boolean;
}

/** 응답 본문에서 meta 를 꺼낸다 — 모양이 다르면 null(지어내지 않는다) */
export function specialtyPatientMeta(body: unknown): SpecialtyPatientMeta | null {
  const m = (body as { meta?: Record<string, unknown> } | undefined)?.meta;
  if (!m || typeof m.total !== 'number' || typeof m.limit !== 'number' || typeof m.truncated !== 'boolean') return null;
  return { total: m.total, limit: m.limit, truncated: m.truncated };
}

export function SpecialtyPatientListMeta({ meta }: { meta: SpecialtyPatientMeta | null }) {
  if (!meta) return null;
  if (meta.truncated) {
    return (
      <p className="text-xs text-amber-700 mt-0.5" data-specialty-truncated>
        <Tf k="최근 기록 순 {limit}명만 표시 — 전체 {total}명 · 다른 환자는 아래 개별 환자 조회에서 찾으세요" params={{ limit: meta.limit, total: meta.total }} />
      </p>
    );
  }
  return (
    <p className="text-xs text-gray-500 mt-0.5" data-specialty-total>
      <Tf k="전체 {total}명 · 최근 기록 순" params={{ total: meta.total }} />
    </p>
  );
}
