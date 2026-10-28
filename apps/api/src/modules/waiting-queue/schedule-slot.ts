/**
 * 진료표 칸 정본 — 어떤 시각이 진료표(`clinic_schedules`)의 어느 요일·반나절에 해당하는가.
 *
 * 접수(대기열 생성)·의사/과 변경 재계산·포털 예약 길안내(B1)가 **같은 규칙**으로 진료실을 정해야 한다 —
 * 종전엔 접수 두 곳이 각자 `getDay()`·`getHours() < 13` 를 적었다(정본이 둘이면 갈라진다).
 * 시각은 프로세스 TZ(pm2 `TZ=Asia/Seoul`) 기준 — `common/day-range.ts` 와 같은 약속.
 * 13시 경계는 종전 접수 규칙 그대로다(바꾸지 않는다).
 */
export function scheduleSlotOf(at: Date): { dayOfWeek: number; period: 'AM' | 'PM' } {
  return { dayOfWeek: at.getDay(), period: at.getHours() < 13 ? 'AM' : 'PM' };
}

/** 진료표 조회 조건 — 그 반나절 또는 종일(ALL) · 활성만 */
export function scheduleWhereAt(doctorId: string, at: Date) {
  const { dayOfWeek, period } = scheduleSlotOf(at);
  return { doctorId, dayOfWeek, OR: [{ period }, { period: 'ALL' }], isActive: true };
}
