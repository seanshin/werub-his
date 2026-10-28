/**
 * 테스트용 Prisma where 평가기 — **where 모양을 문자열로 대조하지 않고, 행 집합에 실제로 적용해 본다.**
 *
 * 🔴 where 를 `toEqual` 로만 대조하면 "내가 적은 모양"을 테스트하게 된다(판정 규칙 §3 — 목은 정본의 실제 모양).
 *    여기서는 인메모리 행에 where 를 평가해 "누가 무엇을 보는가"를 결과로 확인한다.
 *
 * 지원 범위(이 저장소 스펙이 쓰는 부분집합만): AND · OR · NOT · 스칼라 동등/`null` · `{ in }` · `{ notIn, not }`
 * · 중첩 1:1 관계(객체) · 1:N 관계 `{ some }`. 모르는 연산자를 만나면 **던진다**(조용히 참으로 두지 않는다).
 */
type Row = Record<string, unknown>;

export function matchesWhere(row: Row | null | undefined, where: unknown): boolean {
  if (where == null) return true;
  if (row == null) return false;
  const w = where as Record<string, unknown>;
  for (const [key, cond] of Object.entries(w)) {
    if (cond === undefined) continue;
    if (key === 'AND') {
      const list = Array.isArray(cond) ? cond : [cond];
      if (!list.every((c) => matchesWhere(row, c))) return false;
      continue;
    }
    if (key === 'OR') {
      if (!(cond as unknown[]).some((c) => matchesWhere(row, c))) return false;
      continue;
    }
    if (key === 'NOT') {
      const list = Array.isArray(cond) ? cond : [cond];
      if (list.some((c) => matchesWhere(row, c))) return false;
      continue;
    }
    const value = row[key];
    if (!fieldMatches(value, cond)) return false;
  }
  return true;
}

function fieldMatches(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (typeof cond !== 'object' || cond instanceof Date) return value === cond;
  const c = cond as Record<string, unknown>;
  // 1:N 관계
  if ('some' in c) {
    return Array.isArray(value) && value.some((v) => matchesWhere(v as Row, c.some));
  }
  // 스칼라 필터 — 알려진 연산자만
  const scalarOps = ['in', 'notIn', 'not', 'equals'];
  if (Object.keys(c).length > 0 && Object.keys(c).every((k) => scalarOps.includes(k))) {
    if ('equals' in c && value !== c.equals) return false;
    if ('in' in c) {
      // SQL: NULL IN (...) 은 참이 아니다
      if (value == null || !(c.in as unknown[]).includes(value)) return false;
    }
    if ('notIn' in c) {
      // SQL: NULL NOT IN (...) 도 참이 아니다
      if (value == null || (c.notIn as unknown[]).includes(value)) return false;
    }
    if ('not' in c) {
      if (c.not === null) { if (value == null) return false; }
      else if (typeof c.not === 'object') { if (fieldMatches(value, c.not)) return false; }
      else if (value === c.not) return false;
    }
    return true;
  }
  // 1:1 관계 — 중첩 where
  if (value == null || typeof value !== 'object') return false;
  for (const k of Object.keys(c)) {
    if (['is', 'isNot', 'every', 'none', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'mode'].includes(k)) {
      throw new Error(`prisma-where-eval: 지원하지 않는 연산자 ${k}`);
    }
  }
  return matchesWhere(value as Row, c);
}
