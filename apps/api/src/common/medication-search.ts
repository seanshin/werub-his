import { Prisma } from '@prisma/client';

/**
 * 약물 검색 정본(한/영 병용 P1·D2 — medication-bilingual-naming.plan.md).
 *
 * EP 마다 제각각이던 매칭(nameEn 유무·insensitive 유무·code startsWith vs contains)을 하나로:
 *   nameKo · nameEn · ingredient contains(insensitive) + code startsWith(대문자).
 * ingredient 는 운영 데이터의 90%가 영문 성분명(HIRA 백필 "thiotepa 15mg" 형)이라
 * — nameEn 백필 없이도 영문 질의가 이 빌더로 실동작한다(P0 재실측 0.9).
 *
 * 정렬 규약: nameKo asc (MEDICATION_SEARCH_ORDER). 정확도 가중 정렬은 후속 판단.
 * 성능: name_ko·name_en·ingredient gin_trgm 인덱스 3본을 **정의한 파일은 있다**(manual/medication-bilingual-p0-20260805.sql).
 *   🔴 그러나 2026-09-13 운영 실측(`pg_indexes`)에서 **세 인덱스 모두 운영에 없다** — 지금 운영 검색(`ILIKE '%…%'`)은
 *   인덱스 없이 돈다(성능 영향은 측정하지 않았다). 적용 여부는 사람 판단: `docs/05-reference/manual-index-inventory.md` §4·§7.
 */
export function medicationSearchOrTerms(q: string): Prisma.MedicationCodeWhereInput[] {
  const query = q.trim();
  if (!query) return [];
  return [
    { code: { startsWith: query.toUpperCase() } },
    { nameKo: { contains: query, mode: 'insensitive' } },
    { nameEn: { contains: query, mode: 'insensitive' } },
    { ingredient: { contains: query, mode: 'insensitive' } },
  ];
}

/** 검색 where — 빈 질의는 {}(전체·호출부 take 가 제한). 추가 조건은 스프레드로 합성 */
export function buildMedicationSearchWhere(q: string): Prisma.MedicationCodeWhereInput {
  const terms = medicationSearchOrTerms(q);
  return terms.length ? { OR: terms } : {};
}

export const MEDICATION_SEARCH_ORDER: Prisma.MedicationCodeOrderByWithRelationInput[] = [{ nameKo: 'asc' }];
