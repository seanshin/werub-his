/**
 * 휴진 영향 판정 정본 — 예약 하나가 그 의사의 휴진(들)에 닿는가.
 *
 * 🔴 (2026-09-14 P3) 판정이 둘이었다: 휴진 영향 예약 조회(clinic-schedule `findClosureAffected`)는
 *    "종일 세션 + 반일 휴진"을 확인 필요로 따로 줬는데, 예약 가능성 검증(schedule `validateBookable`)은 같은 경우를
 *    `covering.period === c.period` 비교로 **휴진 아님**으로 통과시켰다 — 휴진한 오전에 예약이 조용히 들어갔다.
 *    두 소비처가 이 파일 하나를 쓴다(판정이 둘이면 갈라진다).
 */
export type ClosureImpactVerdict =
  | { kind: 'AFFECTED'; closureId: string; basis: 'FULL_DAY' | 'SESSION' }
  | { kind: 'NEEDS_REVIEW'; closureId: string; basis: 'OUTSIDE_SCHEDULE' | 'ALL_DAY_SESSION_HALF_CLOSURE' }
  | { kind: 'UNAFFECTED' };

/**
 * 예약 하나가 그 의사의 휴진(들)에 닿는가 — 순수 함수(테스트 대상).
 * 세션 소속은 예약 가능성 검증과 같다: `apptStart >= sStart && apptEnd <= sEnd`(끝 시각에 시작하는 예약은 그 세션이 아니다).
 */
export function classifyClosureImpact(
  appt: { dateKey: string; scheduledAt: Date; durationMinutes: number },
  closures: Array<{ id: string; period: string | null }>,
  schedules: Array<{ period: string; startTime: string; endTime: string }>,
): ClosureImpactVerdict {
  const full = closures.find((c) => !c.period || c.period === 'ALL');
  if (full) return { kind: 'AFFECTED', closureId: full.id, basis: 'FULL_DAY' };

  const apptStart = appt.scheduledAt.getTime();
  const apptEnd = apptStart + appt.durationMinutes * 60000;
  const covering = schedules.find((s) => {
    const sStart = new Date(`${appt.dateKey}T${s.startTime}:00+09:00`).getTime();
    const sEnd = new Date(`${appt.dateKey}T${s.endTime}:00+09:00`).getTime();
    return apptStart >= sStart && apptEnd <= sEnd;
  });
  if (!covering) {
    // 시간표 밖 예약 — 반일 휴진이 여기에 닿는지 규칙으로 말할 수 없다(추측해 빼지도 넣지도 않는다)
    return closures.length ? { kind: 'NEEDS_REVIEW', closureId: closures[0].id, basis: 'OUTSIDE_SCHEDULE' } : { kind: 'UNAFFECTED' };
  }
  const same = closures.find((c) => c.period === covering.period);
  if (same) return { kind: 'AFFECTED', closureId: same.id, basis: 'SESSION' };
  if (covering.period === 'ALL' && closures.length) {
    // 종일 세션인데 오전/오후 휴진 — 어느 반쪽인지 시간표가 말하지 않는다
    return { kind: 'NEEDS_REVIEW', closureId: closures[0].id, basis: 'ALL_DAY_SESSION_HALF_CLOSURE' };
  }
  return { kind: 'UNAFFECTED' };
}

/**
 * 세션 하나가 그 의사의 휴진(들)에 닿는가 — 가용 슬롯·일 뷰 그리드의 세션 판정(순수 함수).
 *
 * 🔴 (2026-09-15) 가용 슬롯(`getAvailability`)·일 뷰(`getDayGrid`)는 옛 비교 `c.period === 'ALL' || c.period === s.period` 를
 *    각자 들고 있었다 — 종일(ALL) 세션에 오전 휴진이 걸리면 세션을 '휴진 아님'으로 그려, 휴진한 오전 슬롯까지
 *    환자 셀프 예약에 내놨다(예약 검증은 이미 이 파일을 쓴다 — 판정이 둘이면 갈라진다).
 *    판정은 `classifyClosureImpact` 의 세션 분기와 같다: 종일 휴진·같은 반나절=AFFECTED ·
 *    종일 세션+반일 휴진=NEEDS_REVIEW(어느 반쪽인지 시간표가 말하지 않는다 — 정오 경계를 지어내지 않는다) · 그 밖=UNAFFECTED.
 */
export function classifySessionClosure(
  session: { period: string },
  closures: Array<{ id: string; period: string | null }>,
): ClosureImpactVerdict {
  const full = closures.find((c) => !c.period || c.period === 'ALL');
  if (full) return { kind: 'AFFECTED', closureId: full.id, basis: 'FULL_DAY' };
  const same = closures.find((c) => c.period === session.period);
  if (same) return { kind: 'AFFECTED', closureId: same.id, basis: 'SESSION' };
  if (session.period === 'ALL' && closures.length) {
    return { kind: 'NEEDS_REVIEW', closureId: closures[0].id, basis: 'ALL_DAY_SESSION_HALF_CLOSURE' };
  }
  return { kind: 'UNAFFECTED' };
}
