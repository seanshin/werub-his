/**
 * 분만 보드 판정(2026-10-07).
 *  · 분만 완료 — 종전엔 분만 방식 버튼 한 번에 `deliveredAt: new Date()`(누른 시각)를 박았다. 분만 시각은 사람이 적는 사실이다
 *    → 방식·시각을 고르고 확인한다. 시각은 비우면 저장 불가 · 미래 불가
 *  · 모아 대조 — 서버가 불일치를 `MOTHER_BABY_MISMATCH` 로 말한다. 그 외 실패(네트워크·권한·404)를 "불일치"로 그리지 않는다
 */
export function deliveredAtIso(local: string, now: Date = new Date()): { ok: true; iso: string } | { ok: false; reason: 'EMPTY' | 'INVALID' | 'FUTURE' } {
  if (!local.trim()) return { ok: false, reason: 'EMPTY' };
  const d = new Date(local);
  if (!Number.isFinite(d.getTime())) return { ok: false, reason: 'INVALID' };
  // 1분 여유 — 입력 칸은 분 단위라 지금 이 분을 고르면 몇 초 미래가 된다
  if (d.getTime() > now.getTime() + 60_000) return { ok: false, reason: 'FUTURE' };
  return { ok: true, iso: d.toISOString() };
}

export function motherBabyVerifyOutcome(e: unknown): 'MISMATCH' | 'ERROR' {
  const o = e as { code?: unknown; details?: unknown } | null;
  if (o?.code === 'MOTHER_BABY_MISMATCH') return 'MISMATCH';
  const d = o?.details as { babyOk?: unknown; motherOk?: unknown } | undefined;
  if (d && (typeof d.babyOk === 'boolean' || typeof d.motherOk === 'boolean')) return 'MISMATCH';
  return 'ERROR';
}
