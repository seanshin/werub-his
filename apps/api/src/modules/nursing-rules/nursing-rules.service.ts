import { Injectable, Optional } from '@nestjs/common';
import {
  PAIN_REASSESS_WINDOW_HOURS, isAnalgesicMed, painReassessDue,
  type AnalgesicEvent, type PainRecordEvent, type PainReassessDue,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { AdmissionVitalsReader } from '../vitals/admission-vitals.reader';
import { readHandoffAckMode, readPainReassessRule, readRestraintInterval, readRiskReassessIntervals } from './nursing-rules.read';

/**
 * 간호 원내 규정(2026-10-26) — 규정 현황 + 통증 재평가 대기 목록.
 * 규정 값의 쓰기는 범용 설정 저장(`PUT /config/:key` · 관리자 · 같은 값 검사)이 한다 — 쓰는 길을 둘 두지 않는다.
 */
@Injectable()
export class NursingRulesService {
  private readonly vitals: AdmissionVitalsReader;
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {
    this.vitals = new AdmissionVitalsReader(prisma);
  }

  /** 규정 현황 — 값과 출처(원내 설정·코드 기본값·미설정·조회 실패) */
  async overview() {
    const [restraint, pain, handoff, riskIntervals] = await Promise.all([
      readRestraintInterval(this.config), readPainReassessRule(this.config), readHandoffAckMode(this.config), readRiskReassessIntervals(this.config),
    ]);
    return { restraint, painReassess: pain, handoffAckMode: handoff, riskReassessIntervals: riskIntervals };
  }

  /**
   * 통증 재평가 대기 — 재원 중 환자마다 최근 {@link PAIN_REASSESS_WINDOW_HOURS}시간의 통증 기록·진통제 투여로 판정(shared `painReassessDue`).
   *  · 🔴 규정 미설정이면 목록을 만들지 않는다(items=null · reason RULE_UNSET) — 기준 점수를 지어내지 않는다.
   *  · 통증 기록 = 입원 활력 두 원장(플로시트·재원 중 외래 원장) + 간호 초기평가.
   *  · 진통제 판정 = 약품 효능 분류 · 🔴 분류를 모르는 투약은 진통제 아님으로 접지 않고 따로 센다.
   */
  async painReassessment(now = new Date()) {
    const { rule, source } = await readPainReassessRule(this.config);
    const windowStart = new Date(now.getTime() - PAIN_REASSESS_WINDOW_HOURS * 3_600_000);
    const base = { rule, ruleSource: source, windowHours: PAIN_REASSESS_WINDOW_HOURS, generatedAt: now.toISOString() };
    if (!rule) return { ...base, reason: source === 'UNKNOWN' ? 'RULE_UNKNOWN' : 'RULE_UNSET', items: null, admissions: null, unclassifiedAdministrations: null };

    const admissions = await this.prisma.admission.findMany({
      where: { status: 'ADMITTED' },
      select: {
        id: true, patientId: true, admitDate: true, dischargeDate: true,
        patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
        bed: { select: { roomNumber: true, bedNumber: true, ward: { select: { id: true, name: true } } } },
      },
    });
    if (!admissions.length) return { ...base, reason: null, items: [], admissions: 0, unclassifiedAdministrations: rule.afterAnalgesicMinutes == null ? null : 0 };

    const ids = admissions.map((a) => a.id);
    const [rows, assessments, mar] = await Promise.all([
      this.vitals.rows(admissions, { gte: windowStart, lt: now }, 5000),
      this.prisma.nursingAssessment.findMany({ where: { admissionId: { in: ids }, assessedAt: { gte: windowStart, lt: now } }, select: { admissionId: true, assessedAt: true, painScore: true } }),
      rule.afterAnalgesicMinutes == null
        ? Promise.resolve([])
        : this.prisma.medicationAdministration.findMany({
          where: { patientId: { in: admissions.map((a) => a.patientId) }, status: 'ADMINISTERED', administeredAt: { gte: windowStart, lt: now } },
          select: { patientId: true, administeredAt: true, prescription: { select: { medicationCode: { select: { nameKo: true, category: true, highAlertCategory: true } } } } },
        }),
    ]);

    const pain = new Map<string, PainRecordEvent[]>();
    const push = (id: string, e: PainRecordEvent) => pain.set(id, [...(pain.get(id) ?? []), e]);
    for (const r of rows) if (r.painScore != null) push(r.admissionId, { at: r.at, score: r.painScore });
    for (const a of assessments) push(a.admissionId, { at: a.assessedAt, score: a.painScore });

    const analgesics = new Map<string, AnalgesicEvent[]>();
    let unclassified = 0;
    for (const m of mar) {
      if (!m.administeredAt) continue;
      const adm = admissions.find((a) => a.patientId === m.patientId && m.administeredAt! >= a.admitDate);
      if (!adm) continue;
      const code = m.prescription?.medicationCode ?? null;
      const yes = isAnalgesicMed(code);
      if (yes == null) { unclassified++; continue; }
      if (yes) analgesics.set(adm.id, [...(analgesics.get(adm.id) ?? []), { at: m.administeredAt, name: code?.nameKo ?? null }]);
    }

    const items: Array<{ admissionId: string; patient: (typeof admissions)[number]['patient']; ward: { id: string; name: string } | null; room: string | null; lastPain: PainRecordEvent | null } & PainReassessDue> = [];
    for (const a of admissions) {
      const p = pain.get(a.id) ?? [];
      const due = painReassessDue(rule, p, analgesics.get(a.id) ?? [], now);
      if (!due) continue;
      const last = p.reduce<PainRecordEvent | null>((m, e) => (!m || e.at > m.at ? e : m), null);
      items.push({
        admissionId: a.id, patient: a.patient,
        ward: a.bed?.ward ?? null, room: a.bed ? `${a.bed.roomNumber}-${a.bed.bedNumber}` : null,
        lastPain: last, ...due,
      });
    }
    // 지연 먼저(오래 지난 순) · 그다음 기한 이른 순
    items.sort((x, y) => (x.status === y.status ? x.dueAt.getTime() - y.dueAt.getTime() : x.status === 'OVERDUE' ? -1 : 1));
    return { ...base, reason: null, items, admissions: admissions.length, unclassifiedAdministrations: rule.afterAnalgesicMinutes == null ? null : unclassified };
  }
}
