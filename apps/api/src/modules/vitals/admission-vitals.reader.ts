import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 입원 활력 **읽기 정본**(2026-10-10) — 한 재원의 활력을 두 원장에서 함께 읽는다.
 *
 * 🔴 왜: 입원 환자 활력이 두 원장에 갈려 있었다(운영 실측 — 재원 기간 안 외래 원장 행 27).
 *    · 플로시트·워크스테이션 → `FlowSheetEntry`(입원 원장 · 수집 포트 INPATIENT)
 *    · 간호 스테이션 'VS 일괄'·차트 빠른 입력 → `POST /vitals` → `PreVisitVitals`(외래 원장)
 *   그래서 의사 회진 목록·근무조 마감·병동 보드·바이탈 미체크는 스테이션에서 잰 활력을 "기록 없음"으로,
 *   입원 목록 '최근 VS'·차트 바이탈 탭은 플로시트 활력을 "기록 없음"으로 말했다.
 *   새 쓰기는 이제 재원 중이면 입원 원장으로 간다(`VitalsService.record`) — 그러나 **이미 외래 원장에 쌓인 것은 옮기지 않는다**
 *   (일어난 기록은 소급하지 않는다). 그래서 읽기는 두 원장을 함께 본다.
 *
 * 규칙:
 *  · 외래 원장 행은 **그 환자의 재원 기간 안**(입원 시각 이상 · 퇴원 시각 미만)에 잰 것만 그 재원의 활력이다.
 *  · 행마다 원장(`ledger`)을 밝힌다 — 섞어 놓고 어디서 왔는지 지우지 않는다.
 *  · 값을 고치지 않는다(원장 그대로 · 결측은 null).
 */
export type AdmissionVitalsLedger = 'FLOWSHEET' | 'PREVISIT';

export interface AdmissionRef {
  id: string;
  patientId: string;
  admitDate: Date;
  dischargeDate?: Date | null;
}

export interface AdmissionVitalsRow {
  id: string;
  ledger: AdmissionVitalsLedger;
  admissionId: string;
  patientId: string;
  /** 측정 시각(플로시트 recordedAt · 외래 measuredAt) */
  at: Date;
  nurseId: string;
  systolicBp: number | null;
  diastolicBp: number | null;
  heartRate: number | null;
  temperature: number | null;
  spo2: number | null;
  respiratoryRate: number | null;
  painScore: number | null;
  /** 외래 원장에는 의식 칸이 없다 — null */
  consciousness: string | null;
  notes: string | null;
}

export interface TimeWindow { gte?: Date; lt?: Date }

const num = (v: unknown) => (v == null ? null : Number(v));

@Injectable()
export class AdmissionVitalsReader {
  constructor(private readonly prisma: PrismaService) {}

  /** 재원 기간 ∩ 요청 창 — 외래 원장 조회 범위 */
  private range(a: AdmissionRef, w?: TimeWindow): { gte: Date; lt?: Date } | null {
    const gte = w?.gte && w.gte > a.admitDate ? w.gte : a.admitDate;
    const ends = [a.dischargeDate ?? null, w?.lt ?? null].filter((d): d is Date => d != null);
    const lt = ends.length ? new Date(Math.min(...ends.map((d) => d.getTime()))) : undefined;
    if (lt && lt <= gte) return null;
    return { gte, ...(lt ? { lt } : {}) };
  }

  /** 여러 재원의 행 — 창 안 · 원장 둘 합침 · 시각 내림차순 */
  async rows(admissions: AdmissionRef[], w?: TimeWindow, takePerLedger = 500): Promise<AdmissionVitalsRow[]> {
    if (!admissions.length) return [];
    const ids = admissions.map((a) => a.id);
    const fsWhere = { admissionId: { in: ids }, ...(w?.gte || w?.lt ? { recordedAt: { ...(w.gte ? { gte: w.gte } : {}), ...(w.lt ? { lt: w.lt } : {}) } } : {}) };
    const pvOr = admissions
      .map((a) => ({ a, r: this.range(a, w) }))
      .filter((x) => x.r != null)
      .map(({ a, r }) => ({ patientId: a.patientId, measuredAt: r! }));
    const [fs, pv] = await Promise.all([
      this.prisma.flowSheetEntry.findMany({ where: fsWhere, orderBy: { recordedAt: 'desc' }, take: takePerLedger }),
      pvOr.length
        ? this.prisma.preVisitVitals.findMany({ where: { OR: pvOr }, orderBy: { measuredAt: 'desc' }, take: takePerLedger })
        : Promise.resolve([]),
    ]);
    const out: AdmissionVitalsRow[] = fs.map((r) => ({
      id: r.id, ledger: 'FLOWSHEET' as const, admissionId: r.admissionId,
      patientId: admissions.find((a) => a.id === r.admissionId)!.patientId,
      at: r.recordedAt, nurseId: r.nurseId,
      systolicBp: r.systolicBp, diastolicBp: r.diastolicBp, heartRate: r.heartRate, temperature: num(r.temperature),
      spo2: r.spo2, respiratoryRate: r.respiratoryRate, painScore: r.painScore, consciousness: r.consciousness, notes: r.notes,
    }));
    for (const r of pv) {
      // 같은 환자에 재원이 여럿이면 측정 시각이 든 재원 하나에만 붙는다
      const a = admissions.find((x) => x.patientId === r.patientId && r.measuredAt >= x.admitDate && (!x.dischargeDate || r.measuredAt < x.dischargeDate));
      if (!a) continue;
      out.push({
        id: r.id, ledger: 'PREVISIT', admissionId: a.id, patientId: r.patientId, at: r.measuredAt, nurseId: r.nurseId,
        systolicBp: r.systolicBp, diastolicBp: r.diastolicBp, heartRate: r.heartRate, temperature: num(r.temperature),
        spo2: r.spo2, respiratoryRate: r.respiratoryRate, painScore: r.painScore, consciousness: null, notes: r.notes,
      });
    }
    out.sort((x, y) => y.at.getTime() - x.at.getTime());
    return out;
  }

  /** 재원별 가장 최근 활력(창 안) — 없으면 Map 에 없다(지어내지 않는다) */
  async latestByAdmission(admissions: AdmissionRef[], w?: TimeWindow): Promise<Map<string, AdmissionVitalsRow>> {
    const m = new Map<string, AdmissionVitalsRow>();
    if (!admissions.length) return m;
    const ids = admissions.map((a) => a.id);
    // 재원마다 원장별 최신 1건씩만 — 전 이력을 끌어오지 않는다
    const [fs, pvLists] = await Promise.all([
      this.prisma.flowSheetEntry.findMany({
        where: { admissionId: { in: ids }, ...(w?.gte || w?.lt ? { recordedAt: { ...(w.gte ? { gte: w.gte } : {}), ...(w.lt ? { lt: w.lt } : {}) } } : {}) },
        orderBy: { recordedAt: 'desc' }, distinct: ['admissionId'],
      }),
      Promise.all(admissions.map((a) => {
        const r = this.range(a, w);
        return r ? this.prisma.preVisitVitals.findFirst({ where: { patientId: a.patientId, measuredAt: r }, orderBy: { measuredAt: 'desc' } }) : Promise.resolve(null);
      })),
    ]);
    const byId = new Map(admissions.map((a) => [a.id, a]));
    for (const r of fs) {
      m.set(r.admissionId, {
        id: r.id, ledger: 'FLOWSHEET', admissionId: r.admissionId, patientId: byId.get(r.admissionId)!.patientId,
        at: r.recordedAt, nurseId: r.nurseId,
        systolicBp: r.systolicBp, diastolicBp: r.diastolicBp, heartRate: r.heartRate, temperature: num(r.temperature),
        spo2: r.spo2, respiratoryRate: r.respiratoryRate, painScore: r.painScore, consciousness: r.consciousness, notes: r.notes,
      });
    }
    admissions.forEach((a, i) => {
      const r = pvLists[i];
      if (!r) return;
      const cur = m.get(a.id);
      if (cur && cur.at >= r.measuredAt) return;
      m.set(a.id, {
        id: r.id, ledger: 'PREVISIT', admissionId: a.id, patientId: r.patientId, at: r.measuredAt, nurseId: r.nurseId,
        systolicBp: r.systolicBp, diastolicBp: r.diastolicBp, heartRate: r.heartRate, temperature: num(r.temperature),
        spo2: r.spo2, respiratoryRate: r.respiratoryRate, painScore: r.painScore, consciousness: null, notes: r.notes,
      });
    });
    return m;
  }

  /**
   * 환자 단위 최근 활력 — 외래 원장 + **모든 재원**의 입원 원장을 합쳐 최근 순(차트·요약용).
   * 외래 원장 행 모양을 유지하고(입원 행은 `measuredAt` = recordedAt · `patientId` 채움) 행마다 `ledger` 를 단다.
   */
  async recentForPatient(patientId: string, take = 5) {
    const n = Math.min(Math.max(take, 1), 100);
    const [opd, admissions] = await Promise.all([
      this.prisma.preVisitVitals.findMany({ where: { patientId }, orderBy: { measuredAt: 'desc' }, take: n }),
      this.prisma.admission.findMany({ where: { patientId }, select: { id: true } }),
    ]);
    const ipd = admissions.length
      ? await this.prisma.flowSheetEntry.findMany({ where: { admissionId: { in: admissions.map((a) => a.id) } }, orderBy: { recordedAt: 'desc' }, take: n })
      : [];
    return [
      ...opd.map((v) => ({ ...v, ledger: 'PREVISIT' as const })),
      ...ipd.map((v) => ({ ...v, patientId, measuredAt: v.recordedAt, ledger: 'FLOWSHEET' as const })),
    ].sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime()).slice(0, n);
  }

  /** 창 안에 활력이 한 건이라도 있는 재원(근무조 마감·미체크 판정) */
  async admissionsWithAny(admissions: AdmissionRef[], w: TimeWindow): Promise<Set<string>> {
    return new Set((await this.latestByAdmission(admissions, w)).keys());
  }
}
