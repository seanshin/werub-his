import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { todayRange } from '../../common/day-range';

/**
 * "지금 어디 있나" 판정 정본(2026-10-03) — 위치 원장의 열린 기록(left_at IS NULL) 중 **현재로 볼 근거가 있는 것**만.
 *
 * 🔴 종전 8개 읽기 경로(층 보드 4 · 메타버스 3 · 환자 흐름 1)가 열린 기록을 전부 "현재"로 셌다. 위치는 새 위치가 열릴 때만
 *    닫혀 왔기 때문에(재원 종료 닫기는 2026-10-03 부터) 7~9월 추정 위치가 지금 위치처럼 그려졌다. 3D 상황판만 화면에서
 *    "오늘 기록만" 걸렀다(정본이 둘).
 *
 * 규칙 — 열린 기록이면서 다음 중 하나:
 *  ① 오늘(병원 달력 KST) 들어왔다
 *  ② 그 환자가 지금 재원 중(입원 ADMITTED)이거나 응급 방문이 끝나지 않았다(COMPLETED 아님) — 여러 날 머무는 자리
 * 그 밖의 열린 기록은 **오래된 기록**(마지막 기록 이후 떠났는지 모름) — 그리지 않고 수만 말한다. 떠난 시각을 지어내 닫지도 않는다.
 * 🔴 외래는 끝을 판정할 정본이 없어(여정 D8 사람 결정) 오늘 기록이면 오늘 안에서는 현재로 본다 — 이미 떠났을 수 있다(화면이 말한다).
 */
export const CURRENT_LOCATION_RULE = {
  todayKst: true,
  activeStay: ['ADMISSION_ADMITTED', 'ER_NOT_COMPLETED'] as const,
};

export type CurrentLocationScope = {
  /** 현재 위치 조건 — 다른 조건과 합칠 때 `{ ...extra, ...scope.current }` (current 가 OR 를 쓴다) */
  current: Prisma.PatientLocationWhereInput;
  /** 오래된 열린 기록 조건 */
  stale: Prisma.PatientLocationWhereInput;
  /** 오늘 시작(KST) */
  since: Date;
  /** 여러 날 머무는 중이라 오늘 이전 기록도 현재로 보는 환자 수 */
  activeStayPatients: number;
};

type Reader = Pick<PrismaService, 'admission' | 'emergencyVisit'>;

export async function currentLocationScope(prisma: Reader, now: Date = new Date()): Promise<CurrentLocationScope> {
  const { gte } = todayRange(now);
  const [adm, er] = await Promise.all([
    prisma.admission.findMany({ where: { status: 'ADMITTED' }, select: { patientId: true }, distinct: ['patientId'] }),
    prisma.emergencyVisit.findMany({ where: { status: { not: 'COMPLETED' } }, select: { patientId: true }, distinct: ['patientId'] }),
  ]);
  const active = [...new Set([...adm, ...er].map((x) => x.patientId))];
  const current: Prisma.PatientLocationWhereInput = {
    leftAt: null,
    OR: [{ enteredAt: { gte } }, ...(active.length ? [{ patientId: { in: active } }] : [])],
  };
  const stale: Prisma.PatientLocationWhereInput = {
    leftAt: null,
    enteredAt: { lt: gte },
    ...(active.length ? { patientId: { notIn: active } } : {}),
  };
  return { current, stale, since: gte, activeStayPatients: active.length };
}
