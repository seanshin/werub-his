import { Prisma } from '@prisma/client';

/**
 * 누적선량 요약(2026-10-10) — 화면이 선량을 직접 더하지 않게 서버가 한 번 센다.
 *
 * 🔴 조사 경로(`deliverFraction`)와 **같은 규칙**: 상태 문자열이 아니라 **기록된 조사선량**(deliveredDose not null)을 더한다
 *    (시드가 조사 분획을 `COMPLETED` 로 넣은 계획에서 상태 조건이 16Gy 를 빠뜨렸다 — 2026-08-18).
 * 🔴 처방 총선량이 0/없음이면 비율은 null(산출 불가) — 0% 로 그리지 않는다.
 * Decimal 로 더한다 — 1.8 × 25 가 44.999… 가 되지 않게(저장 정밀도 그대로).
 */
export interface RadiationDoseSummary {
  /** 기록된 조사선량 합(Gy) — 기록 0건이면 0(조사하지 않았다는 사실) */
  deliveredGy: number;
  /** 조사선량이 기록된 분할 수 */
  recordedFractions: number;
  /** 처방 총선량(Gy) — 0/없음이면 null */
  prescribedGy: number | null;
}

export function radiationDoseSummary(
  fractions: Array<{ deliveredDose: Prisma.Decimal | number | string | null }>,
  totalDose: Prisma.Decimal | number | string | null | undefined,
): RadiationDoseSummary {
  let sum = new Prisma.Decimal(0);
  let recorded = 0;
  for (const f of fractions) {
    if (f.deliveredDose == null) continue;
    sum = sum.plus(new Prisma.Decimal(f.deliveredDose as Prisma.Decimal.Value));
    recorded++;
  }
  const total = totalDose == null ? null : Number(totalDose);
  return { deliveredGy: sum.toNumber(), recordedFractions: recorded, prescribedGy: total != null && total > 0 ? total : null };
}
