import { NotFoundException } from '@nestjs/common';
import { stayDays } from '@hospital-run/shared';

/**
 * 재입원 예측 맥락 — AI 서버 권장 키(2026-10-07 회신 · HOSPITAL score 항목)를 **기록에서만** 채운다.
 *  · `length_of_stay` 재원일수 정본 `stayDays`(입원~퇴원 또는 지금)
 *  · `past_admissions` 이 입원 시작 전 1년 안의 다른 입원 수(취소 입원 제외 — 여정 재입원 정의와 같은 제외)
 *  · `lab_results` 이번 입원 중 가장 최근 혈색소(g/dL)·나트륨(mEq/L·mmol/L) — 보고값 그대로(재반올림 없음) · 측정 시각 병기
 *  · `admission_info` 응급실 경유(응급 진료 기록이 이 입원에 연결됨) · 입원 중 수술(기록된 수술명)
 * 🔴 기록이 없으면 그 키를 **빼고** 보낸다(서버 권장) — "예정 입원"·"시술 없음"을 기록 부재에서 추정하지 않는다.
 *    검사 항목은 이름으로 고른다(원내 검사 코드 정본이 없다) — 이름이 맞아도 단위가 다르면 쓰지 않는다. HbA1c 는 이름 경계(`HbA1c` 는 `hb\b` 가 아니다)와 단위(%)로 빠진다.
 */
/**
 * 재입원 점수(HOSPITAL score) 입력 중 **기록에서 채우지 못한 것** — AI 서버 회신(10-07): 빠진 항목은 0점이라 위험도가 낮게 나올 수 있다.
 *  HB·NA 이번 입원 중 검사 없음 · ADMISSION_ROUTE 응급 경유 연결 기록 없음(예정 입원이라는 뜻이 아니다)
 *  PROCEDURE 입원 중 수술 기록 없음(시술 없음이라는 뜻이 아니다 — 수술 외 시술은 원장이 없다) · ONCOLOGY 종양내과 퇴원 여부는 HIS 에 근거가 없다(항상)
 *  PAST_ADMISSIONS·LENGTH_OF_STAY 요청에도 기록에도 없음
 */
export type ReadmissionInputGap = 'HB' | 'NA' | 'ADMISSION_ROUTE' | 'PROCEDURE' | 'ONCOLOGY' | 'PAST_ADMISSIONS' | 'LENGTH_OF_STAY';

export interface ReadmissionContext {
  patientId: string;
  gaps: ReadmissionInputGap[];
  lengthOfStay: number | null;
  pastAdmissions: number;
  labResults: string | null;
  admissionInfo: string | null;
}

type Prisma = {
  admission: {
    findUnique(a: unknown): Promise<{ id: string; patientId: string; admitDate: Date; dischargeDate: Date | null } | null>;
    count(a: unknown): Promise<number>;
  };
  labResultItem: { findMany(a: unknown): Promise<{ testName: string; value: string; unit: string; labResult: { createdAt: Date; verifiedAt: Date | null } }[]> };
  emergencyVisit: { count(a: unknown): Promise<number> };
  surgery: { findMany(a: unknown): Promise<{ procedureName: string }[]> };
};

const HB = /^(hemoglobin|hgb|hb)\b|^혈색소/i;
const NA = /^(na|sodium)\b|^나트륨/i;

export function pickLab(items: { testName: string; value: string; unit: string; at: Date }[], name: RegExp, units: RegExp): { value: string; unit: string; at: Date } | null {
  const hit = items
    .filter((i) => name.test(i.testName.trim()) && units.test(i.unit.trim()) && i.value.trim() !== '')
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  return hit ? { value: hit.value.trim(), unit: hit.unit.trim(), at: hit.at } : null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function buildReadmissionContext(prisma: Prisma, admissionId: string): Promise<ReadmissionContext> {
  const adm = await prisma.admission.findUnique({ where: { id: admissionId }, select: { id: true, patientId: true, admitDate: true, dischargeDate: true } });
  if (!adm) throw new NotFoundException('입원 기록을 찾을 수 없습니다.');
  const yearBefore = new Date(adm.admitDate.getTime() - 365 * 86_400_000);
  const [pastAdmissions, labRows, erLinked, surgeries] = await Promise.all([
    prisma.admission.count({ where: { patientId: adm.patientId, id: { not: adm.id }, status: { not: 'CANCELLED' }, admitDate: { gte: yearBefore, lt: adm.admitDate } } }),
    prisma.labResultItem.findMany({
      where: { labResult: { patientId: adm.patientId, createdAt: { gte: adm.admitDate, ...(adm.dischargeDate ? { lte: adm.dischargeDate } : {}) } } },
      select: { testName: true, value: true, unit: true, labResult: { select: { createdAt: true, verifiedAt: true } } },
      take: 500,
      orderBy: { labResult: { createdAt: 'desc' } },
    }),
    prisma.emergencyVisit.count({ where: { admissionId: adm.id } }),
    prisma.surgery.findMany({ where: { admissionId: adm.id, status: { in: ['IN_PROGRESS', 'COMPLETED'] } }, select: { procedureName: true }, take: 5 }),
  ]);
  const items = labRows.map((r) => ({ testName: r.testName, value: r.value, unit: r.unit, at: r.labResult.verifiedAt ?? r.labResult.createdAt }));
  const hb = pickLab(items, HB, /^g\/dl$/i);
  const na = pickLab(items, NA, /^(meq\/l|mmol\/l)$/i);
  const labParts = [hb && `Hb ${hb.value} ${hb.unit} (${ymd(hb.at)})`, na && `Na ${na.value} ${na.unit} (${ymd(na.at)})`].filter(Boolean) as string[];
  const infoParts = [
    erLinked > 0 ? '응급실 경유 입원' : null,
    surgeries.length ? `입원 중 수술: ${surgeries.map((s) => s.procedureName).join(', ')}` : null,
  ].filter(Boolean) as string[];
  const gaps: ReadmissionInputGap[] = [];
  if (!hb) gaps.push('HB');
  if (!na) gaps.push('NA');
  if (erLinked === 0) gaps.push('ADMISSION_ROUTE');
  if (!surgeries.length) gaps.push('PROCEDURE');
  gaps.push('ONCOLOGY');
  return {
    patientId: adm.patientId,
    gaps,
    lengthOfStay: stayDays(adm.admitDate, adm.dischargeDate),
    pastAdmissions,
    labResults: labParts.length ? labParts.join(', ') : null,
    admissionInfo: infoParts.length ? infoParts.join(', ') : null,
  };
}
