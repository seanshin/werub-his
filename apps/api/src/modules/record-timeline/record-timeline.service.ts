import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import {
  stayDays,
  isAdmissionScopedNursingContext,
  AI_PROPOSAL_KIND_LABEL,
  AI_PROPOSAL_STATUS_LABEL,
  scribeSessionStatusLabel,
  scribeSourceLabel,
  type AiProposalKind,
  type AiProposalStatusValue,
  VITALS_THRESHOLDS,
  mergeVitalsThresholdsDetailed,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';
import { AuditService } from '../audit/audit.service';
import { buildRuleSummary, buildSummaryPrompt, type SummaryMode } from './record-summary';
import { dedupeIssues, extractIssues, type Issue } from './record-issues';
import { buildInsights, type IssueLike, type RawItem } from './record-insights';
import { applyCursor, compareItems, formatCursor, parseCursor } from './timeline-cursor';
import { CRITICAL_ALERT_OPEN_STATUSES } from '../lab/critical-value-alert-states';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { buildRecordAnalytics, type RecordAnalytics } from './record-analytics';

export interface TimelineQuery {
  from?: Date; to?: Date; types?: string[]; admissionId?: string; limit?: number;
  /**
   * 커서 — `<ISO>|<id>` 복합키. 이 위치보다 **과거** 항목만(최신순 페이지네이션).
   * 시각만으로는 동일 시각 항목이 유실·중복된다 → timeline-cursor.ts 참조.
   */
  before?: string;
}
const nm = (u?: { familyName?: string | null; givenName?: string | null } | null) => `${u?.familyName ?? ''}${u?.givenName ?? ''}`.trim();

/** 트랙 등재 목록 — FE 필터 칩·기본 선택의 정본(신규 트랙은 여기에만 추가) */
export const TIMELINE_TRACKS = [
  { type: 'ENCOUNTER', label: '진료' },
  { type: 'NURSING', label: '간호' },
  { type: 'LAB', label: '검사' },
  { type: 'IMAGING', label: '영상' },
  { type: 'PRESCRIPTION', label: '처방' },
  { type: 'VITALS', label: '활력' },
  { type: 'SURGERY', label: '수술' },
  { type: 'ADMISSION', label: '입퇴원' },
  { type: 'PROGRESS_NOTE', label: '경과기록' },
  { type: 'MAR', label: '투약실행' },
  { type: 'DISCHARGE_SUMMARY', label: '퇴원요약' },
  // 🔴 임상 기록이 아니라 **AI 가 무엇을 냈고 사람이 그것을 어떻게 했는가**의 트랙이다.
  //    본문은 싣지 않는다(초안 본문의 정본은 `AiProposal` 하나 — 시계열이 사본을 들면 정본이 둘이 된다).
  { type: 'AI_PROPOSAL', label: 'AI 제안' },
  // 🔴 대화(스크라이브) 트랙 — **대화 원문·초안 본문을 싣지 않는다.** 전사 정본은 `ScribeSession.transcript`/
  //    `VoiceUtterance.text` 하나이고, 시계열이 사본을 들면 같은 사실에 정본이 둘이 된다(AI_PROPOSAL 과 같은 규약).
  //    여기 담는 것은 "언제 대화가 있었고, 몇 발화였고, 어느 필드에 반영됐고, 무슨 엔진이었고, 얼마나 놓쳤는가"뿐이다.
  { type: 'CONVERSATION', label: '대화 기록' },
] as const;

/**
 * 미확인 위급 검사값 이슈 — **집계 실패(null)를 0 과 구분해서 말한다**.
 *  - `n > 0` → 위급(CRITICAL): 확인 폐루프가 열려 있다
 *  - `n === 0` → 이슈 없음(진짜 0)
 *  - `n === null` → 산출 불가(WARN): 없다고 말하지 않는다. 거짓 위급 경보로 올리지도 않는다
 *    ("거짓 경보는 진짜 경보를 죽인다").
 */
export function pendingCriticalIssue(n: number | null, now: Date = new Date()): Issue | null {
  if (n === null) {
    return {
      level: 'WARN', at: now.toISOString(), category: '미확인', label: '위급 검사값',
      value: '산출 불가',
      why: '미확인 위급값 집계에 실패했습니다. **확인 대기 건이 없다는 뜻이 아닙니다** — 검사 결과 화면에서 직접 확인하십시오.',
    };
  }
  if (n > 0) {
    return {
      level: 'CRITICAL', at: now.toISOString(), category: '미확인', label: '위급 검사값',
      value: `${n}건`,
      why: '담당의 확인이 대기 중인 위급값이 있습니다. 확인 폐루프가 열려 있어 환자 통지·후속 조치가 지연될 수 있습니다.',
    };
  }
  return null;
}

const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 1000;
const PER_TRACK_CAP = 400; // 트랙별 조회 상한(장기 환자 무제한 로드 방지 — 절단 시 truncated 보고)

/**
 * 환자 임상 기록 통합 시계열 — 도메인별 재료를 시간축 하나로 병합.
 *
 * 시각(at) 선택 규약 — **"의료진이 그 정보를 알게 된 시점"**을 기준으로 함(임상 판단 시점 재구성이 목적):
 *  - 진료: signedAt ?? createdAt   · 간호: recordedAt
 *  - 검사: verifiedAt ?? completedAt ?? collectedAt ?? createdAt (확정·검증 시점 우선)
 *  - 영상: reportedAt ?? acquiredAt ?? createdAt (판독 보고 시점 우선)
 *  - 처방: createdAt(별도 prescribedAt 없음) · 활력: measuredAt/recordedAt
 *  - 수술: startedAt ?? scheduledAt · 입퇴원: 입원/퇴원을 **각각 별 항목**으로(한 Admission → 2 point)
 *  - AI 제안: decidedAt ?? presentedAt ?? createdAt (사람이 결정한 시점 → 노출된 시점 → 생성 시점 순).
 *    🔴 어느 것을 썼는지 `atBasis` 로 함께 낸다 — 생성만 된 제안은 사람이 본 적조차 없다.
 * 진단(EncounterDiagnosis)은 자체 기록 시각이 없어 독립 트랙이 아니라 ENCOUNTER 항목에 동봉한다.
 */
@Injectable()
export class RecordTimelineService {
  private readonly logger = new Logger(RecordTimelineService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly medicalAi?: MedicalAiService, // AI 요약은 부가(미가용 시 규칙 요약만)
    @Optional() private readonly audit?: AuditService,
    // 활력 범위 판정 정본(환자안전위 개정 `clinical.vitals.thresholds`) — 없으면 코드 기본값이고 응답이 그 출처를 밝힌다
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /** 분석 조회 상한 */
  static readonly ANALYTICS_LIMIT = { labItems: 4000, vitals: 2000, meds: 300 } as const;

  /**
   * 시계열 분석(2026-10-01) — 검사·활력 수치 추이와 처방 기간을 한 시간축에서 · 기본 최근 1년(정본 `record-analytics.ts`).
   * 검사는 예비(COMPLETED)·검증(VERIFIED) 결과 모두(종전 AI 추세는 COMPLETED 만 봐 검증된 결과를 뺐다).
   */
  async analytics(patientId: string, opts: { from?: Date; to?: Date }, userId?: string): Promise<RecordAnalytics> {
    const to = opts.to && !Number.isNaN(opts.to.getTime()) ? opts.to : new Date();
    const from = opts.from && !Number.isNaN(opts.from.getTime()) ? opts.from : new Date(to.getTime() - 365 * 86_400_000);
    if (from.getTime() >= to.getTime()) throw new BadRequestException('from must be before to');
    const L = RecordTimelineService.ANALYTICS_LIMIT;
    const [items, pre, flow, rxs, rawTh] = await Promise.all([
      this.prisma.labResultItem.findMany({
        where: { labResult: { patientId, status: { in: ['COMPLETED', 'VERIFIED'] }, OR: [{ completedAt: { gte: from, lt: to } }, { completedAt: null, createdAt: { gte: from, lt: to } }] } },
        select: {
          testName: true, testCode: true, loincCode: true, value: true, unit: true, normalMin: true, normalMax: true, flag: true,
          labResult: { select: { verifiedAt: true, completedAt: true, collectedAt: true, createdAt: true } },
        },
        orderBy: { labResult: { completedAt: 'desc' } },
        take: L.labItems + 1,
      }),
      this.prisma.preVisitVitals.findMany({
        where: { patientId, measuredAt: { gte: from, lt: to } },
        select: { measuredAt: true, systolicBp: true, diastolicBp: true, heartRate: true, temperature: true, spo2: true, respiratoryRate: true },
        orderBy: { measuredAt: 'desc' }, take: L.vitals + 1,
      }),
      this.prisma.flowSheetEntry.findMany({
        where: { admission: { patientId }, recordedAt: { gte: from, lt: to } },
        select: { recordedAt: true, systolicBp: true, diastolicBp: true, heartRate: true, temperature: true, spo2: true, respiratoryRate: true },
        orderBy: { recordedAt: 'desc' }, take: L.vitals + 1,
      }),
      this.prisma.prescription.findMany({
        // 처방 기간이 창과 겹칠 수 있는 약 — 창 시작 1년 전부터 발행된 것까지(장기 처방)
        where: { encounter: { patientId }, type: 'MEDICATION', createdAt: { gte: new Date(from.getTime() - 365 * 86_400_000), lt: to } },
        select: { id: true, status: true, createdAt: true, duration: true, discontinuedAt: true, medicationCode: { select: { nameKo: true } } },
        orderBy: { createdAt: 'desc' }, take: L.meds + 1,
      }),
      this.config?.get('clinical.vitals.thresholds') ?? Promise.resolve(undefined),
    ]);
    const merged = mergeVitalsThresholdsDetailed(rawTh);
    const configured = rawTh && typeof rawTh === 'object'
      && Object.keys(rawTh as Record<string, unknown>).some((k) => k in VITALS_THRESHOLDS && !merged.invertedKeys.includes(k));
    const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? null : Number(d));
    const meds = rxs.slice(0, L.meds)
      .map((p) => ({ id: p.id, name: p.medicationCode?.nameKo ?? null, status: p.status, createdAt: p.createdAt, duration: p.duration, discontinuedAt: p.discontinuedAt }))
      // 창과 겹치는 것만(시작이 창 끝 전 · 끝이 창 시작 뒤 또는 모름)
      .filter((m) => {
        const end = m.discontinuedAt ?? (m.duration ? new Date(m.createdAt.getTime() + m.duration * 86_400_000) : null);
        return m.createdAt < to && (end == null || end >= from);
      });
    const result = buildRecordAnalytics({
      labs: items.slice(0, L.labItems).map((it) => ({
        at: it.labResult.verifiedAt ?? it.labResult.completedAt ?? it.labResult.collectedAt ?? it.labResult.createdAt,
        testName: it.testName, testCode: it.testCode, loincCode: it.loincCode, value: it.value, unit: it.unit,
        normalMin: num(it.normalMin), normalMax: num(it.normalMax), flag: it.flag,
      })),
      vitals: [
        ...pre.slice(0, L.vitals).map((v) => ({ at: v.measuredAt, source: 'PRE_VISIT' as const, ...v, temperature: num(v.temperature) })),
        ...flow.slice(0, L.vitals).map((v) => ({ at: v.recordedAt, source: 'FLOWSHEET' as const, ...v, temperature: num(v.temperature) })),
      ],
      meds,
      thresholds: merged.thresholds,
      thresholdSource: configured ? 'CONFIGURED' : 'DEFAULT',
      period: { from, to },
      truncated: { labs: items.length > L.labItems, vitals: pre.length > L.vitals || flow.length > L.vitals, meds: rxs.length > L.meds },
    });
    await this.audit?.safeLog({
      userId: userId ?? 'unknown', action: AuditAction.READ, resourceType: 'Patient', resourceId: patientId,
      changes: { recordTimelineAnalytics: { old: null, new: { from: from.toISOString(), to: to.toISOString(), analytes: result.analytes.length } } },
    });
    return result;
  }

  /**
   * 시계열 AI 정리 — **규칙 요약은 항상**, AI 문장은 가용할 때만 덧붙인다(ambient analyze 와 동일 규약).
   * 진단·처방 권고 금지 프롬프트를 강제하고, 실패는 조용히 규칙 요약으로 저하한다.
   */
  /**
   * 의미찾기 — 같은 기록을 **의미 단위로 재배치**해 돌려준다(시간축이 답하지 못하는 질문용).
   * 요약과 같은 재료(시계열 + 이슈)를 쓰되 AI 는 부르지 않는다(규칙만·즉시).
   */
  async insights(patientId: string, q: TimelineQuery, userId?: string) {
    const tl = await this.getPatientTimeline(patientId, { ...q, limit: 1000 });
    const issues: IssueLike[] = dedupeIssues(extractIssues(tl.items as never[])) as IssueLike[];
    const pending = await this.countPendingCritical(patientId);
    const pendingIssue = pendingCriticalIssue(pending);
    if (pendingIssue) issues.unshift(pendingIssue);
    const groups = buildInsights(tl.items as unknown as RawItem[], issues);

    // 요약과 동일하게 PHI 열람으로 명시 기록(무엇을 묶어 봤는지)
    if (userId) {
      void this.audit
        ?.log({
          userId, action: 'READ' as AuditAction, resourceType: 'RecordInsights', resourceId: patientId,
          changes: {
            groups: { old: null, new: groups.map((g) => `${g.key}:${g.items.length}`).join(',') },
            itemCount: { old: null, new: tl.items.length },
          },
        })
        .catch(() => {});
    }
    return { groups, itemCount: tl.items.length, truncatedTracks: tl.truncatedTracks };
  }

  async summarize(patientId: string, q: TimelineQuery, mode: SummaryMode, useAi = true, userId?: string) {
    const tl = await this.getPatientTimeline(patientId, {
      ...q,
      types: mode === 'chart' ? ['ENCOUNTER'] : mode === 'rx' ? ['PRESCRIPTION'] : q.types,
      limit: 1000,
    });
    const rule = buildRuleSummary(tl.items as never[], mode);
    // 중요 수치·이슈 — 값과 함께 **왜 이슈인지**를 낸다(강조만 하고 이유를 빼면 판단에 도움이 안 됨)
    const issues: Issue[] = dedupeIssues(extractIssues(tl.items as never[]));
    // 담당의 미확인 위급 검사값 — 폐루프가 열려 있는 상태라 최우선 표시
    const pending = await this.countPendingCritical(patientId);
    const pendingIssue = pendingCriticalIssue(pending);
    if (pendingIssue) issues.unshift(pendingIssue);
    let ai: string | null = null;
    let engine: 'RULE' | 'RULE+AI' = 'RULE';
    if (useAi && this.medicalAi && tl.items.length) {
      try {
        const res = (await this.medicalAi.summarize(buildSummaryPrompt(mode, rule))) as Record<string, unknown>;
        const inner = (res?.data ?? res) as Record<string, unknown>;
        const text = [inner?.summary, inner?.text, inner?.result, inner?.content].find((v) => typeof v === 'string' && v.trim());
        if (text) { ai = String(text).trim(); engine = 'RULE+AI'; }
      } catch (e) {
        this.logger.warn(`시계열 AI 요약 실패 — 규칙 요약만 반환: ${e instanceof Error ? e.message : e}`);
      }
    }
    // PHI 열람 감사 — 요약은 한 환자의 여러 도메인을 한 번에 읽으므로 열람 근거를 남긴다(규약: resourceId=patientId)
    await this.audit?.safeLog({
      userId: userId ?? 'unknown', action: AuditAction.READ, resourceType: 'Patient', resourceId: patientId,
      changes: { recordTimelineSummary: { old: null, new: { mode, engine, items: tl.items.length, issues: issues.length, from: rule.period.from, to: rule.period.to, ai: useAi } } },
    });
    return {
      mode, engine, aiText: ai, lines: rule.lines, counts: rule.counts, period: rule.period, issues,
      itemCount: tl.items.length,
      disclaimer: 'AI·규칙 요약은 참고용입니다. 원본 기록 확인을 대체하지 않으며 진단·처방 판단은 의료진이 합니다.',
    };
  }


  /**
   * 담당의 미확인 위급 검사값 건수.
   *
   * 🔴 종전에는 `.catch(() => 0)` 이었다. 집계가 실패하면 **미확인 위급값 이슈가 조용히
   *    사라져**, 화면은 "확인 대기 없음"과 구분되지 않는 상태로 안심시켰다(P1·P17).
   *    실패는 0 이 아니다 — `null`(산출 불가)로 돌려 읽는 쪽이 드러내게 한다(2026-08-14 W8).
   */
  private async countPendingCritical(patientId: string): Promise<number | null> {
    try {
      return await this.prisma.criticalValueAlert.count({ where: { patientId, status: { in: CRITICAL_ALERT_OPEN_STATUSES } } });
    } catch (e) {
      this.logger.error(`미확인 위급값 집계 실패(patient=${patientId}) — 0 으로 삼키지 않고 '산출 불가'로 노출: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  /** 관계 미선언 스칼라 FK(userId) → 이름 배치 조회. N+1 방지(1 쿼리) */
  private async resolveUserNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, familyName: true, givenName: true } });
    return new Map(users.map((u) => [u.id, nm(u)]));
  }

  /**
   * 단건 상세 — 시계열 카드의 '자료' 열람용. **그 한 건만** 반환한다(차트 전체 목록을 열지 않도록).
   * 목록보다 넓은 payload(진료=처방 목록·간호=전문·입원=병상/기간)를 담고, 소유(patientId) 검증 포함.
   */
  async getRecordDetail(patientId: string, type: string, id: string) {
    const nf = () => new NotFoundException('해당 기록을 찾을 수 없습니다');

    if (type === 'ENCOUNTER') {
      const e = await this.prisma.encounter.findFirst({
        where: { id, patientId },
        include: {
          doctor: { select: { familyName: true, givenName: true } },
          diagnoses: { include: { diagnosisCode: { select: { code: true, nameKo: true, nameEn: true } } } },
          prescriptions: { select: { id: true, type: true, dosage: true, frequency: true, duration: true, status: true, medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, code: true } } } },
        },
      });
      if (!e) throw nf();
      return {
        type, id: e.id, at: e.signedAt ?? e.createdAt, status: e.status, author: nm(e.doctor), authorRole: '진료',
        visitType: e.visitType, title: e.chiefComplaint ?? null,
        soap: { S: e.subjective, O: e.objective, A: e.assessment, P: e.plan },
        diagnoses: e.diagnoses.map((d) => ({ code: d.diagnosisCode?.code, name: d.diagnosisCode?.nameKo, type: d.type })),
        rxCount: e.prescriptions.length,
        orders: e.prescriptions.map((p) => ({ type: p.type, name: p.medicationCode?.nameKo ?? p.type, dosage: p.dosage, frequency: p.frequency, duration: p.duration, status: p.status })),
        signedAt: e.signedAt, createdAt: e.createdAt,
        link: `/patients/${patientId}?tab=encounters`,
      };
    }

    if (type === 'NURSING') {
      const n = await this.prisma.nursingNote.findFirst({
        where: { id, admission: { patientId } },
        include: { nurse: { select: { familyName: true, givenName: true } } },
      });
      if (n) {
        return {
          type, id: n.id, at: n.recordedAt, status: n.status, author: nm(n.nurse), authorRole: '간호',
          noteType: n.noteType, shift: n.shiftType, focus: n.focus, priority: n.priority,
          dar: { D: n.data, A: n.action, R: n.response, E: n.education },
          soap: { S: n.subjective, O: n.objective, A: n.assessment, P: n.plan },
          content: n.content, admissionId: n.admissionId,
          link: `/patients/${patientId}?tab=nursing`,
        };
      }
      const u = await this.prisma.universalNursingNote.findFirst({
        where: { id, patientId },
        include: { nurse: { select: { familyName: true, givenName: true } } },
      });
      if (!u) throw nf();
      return {
        type, id: u.id, at: u.recordedAt, status: null, author: nm(u.nurse), authorRole: '간호',
        noteType: u.noteType, outpatient: true, content: u.content,
        link: `/patients/${patientId}?tab=nursing`,
      };
    }

    if (type === 'LAB') {
      const l = await this.prisma.labResult.findFirst({
        where: { id, patientId },
        include: {
          items: { select: { testName: true, value: true, unit: true, flag: true, normalMin: true, normalMax: true } },
          technician: { select: { familyName: true, givenName: true } },
        },
      });
      if (!l) throw nf();
      const vmap = await this.resolveUserNames([l.verifiedBy]);
      return {
        type, id: l.id, at: l.verifiedAt ?? l.completedAt ?? l.collectedAt ?? l.createdAt, status: l.status,
        title: l.items.length === 1 ? l.items[0].testName : `검사 ${l.items.length}항목`,
        author: nm(l.technician), authorRole: '검사',
        verifier: l.verifiedBy ? vmap.get(l.verifiedBy) ?? null : null,
        results: l.items.map((i) => ({
          name: i.testName, value: i.value, unit: i.unit, flag: i.flag,
          refLow: i.normalMin === null ? null : Number(i.normalMin),
          refHigh: i.normalMax === null ? null : Number(i.normalMax),
        })),
        abnormalCount: l.items.filter((i) => i.flag && i.flag !== 'N').length,
        collectedAt: l.collectedAt, completedAt: l.completedAt, verifiedAt: l.verifiedAt,
        link: `/patients/${patientId}?tab=labresults`,
      };
    }

    if (type === 'IMAGING') {
      const r = await this.prisma.imagingResult.findFirst({ where: { id, patientId } });
      if (!r) throw nf();
      const map = await this.resolveUserNames([r.radiologistId]);
      return {
        type, id: r.id, at: r.reportedAt ?? r.acquiredAt ?? r.createdAt, status: r.status,
        title: `${r.modality}${r.bodyPart ? ` ${r.bodyPart}` : ''}`,
        author: r.radiologistId ? map.get(r.radiologistId) ?? null : null, authorRole: '판독',
        finding: r.finding, impression: r.impression, acquiredAt: r.acquiredAt, reportedAt: r.reportedAt,
        link: `/patients/${patientId}?tab=imaging`,
      };
    }

    if (type === 'PRESCRIPTION') {
      const p = await this.prisma.prescription.findFirst({
        where: { id, encounter: { patientId } },
        include: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, code: true } }, procedureCode: { select: { nameKo: true, code: true } } },
      });
      if (!p) throw nf();
      const map = await this.resolveUserNames([p.prescriberId, p.createdBy]);
      return {
        type, id: p.id, at: p.createdAt, status: p.status, rxType: p.type,
        title: p.medicationCode?.nameKo ?? p.procedureCode?.nameKo ?? p.type,
        author: map.get(p.prescriberId ?? p.createdBy ?? '') ?? null, authorRole: '처방',
        code: p.medicationCode?.code ?? p.procedureCode?.code ?? null, route: p.route ?? null,
        dosage: p.dosage, frequency: p.frequency, duration: p.duration, instructions: p.instructions,
        link: `/patients/${patientId}?tab=medications`,
      };
    }

    if (type === 'VITALS') {
      const v = await this.prisma.preVisitVitals.findFirst({ where: { id, patientId } });
      if (!v) throw nf();
      const map = await this.resolveUserNames([v.nurseId]);
      return {
        type, id: v.id, at: v.measuredAt, status: v.isAbnormal ? 'ABNORMAL' : 'NORMAL',
        author: v.nurseId ? map.get(v.nurseId) ?? null : null, authorRole: '측정',
        vitals: {
          bp: v.systolicBp && v.diastolicBp ? `${v.systolicBp}/${v.diastolicBp}` : null,
          hr: v.heartRate, temp: v.temperature ? Number(v.temperature) : null,
          spo2: v.spo2, rr: v.respiratoryRate, pain: v.painScore,
          weight: v.weight === null ? null : Number(v.weight),
          bmi: v.bmi === null ? null : Number(v.bmi),
        },
        note: v.notes ?? null,
        link: `/patients/${patientId}?tab=vitals`,
      };
    }

    if (type === 'SURGERY') {
      const s2 = await this.prisma.surgery.findFirst({ where: { id, patientId } });
      if (!s2) throw nf();
      const map = await this.resolveUserNames([s2.surgeonId, s2.anesthetistId]);
      return {
        type, id: s2.id, at: s2.startedAt ?? s2.scheduledAt, status: s2.status,
        title: s2.procedureName, bodySite: s2.bodySite,
        author: map.get(s2.surgeonId) ?? null, authorRole: '집도',
        anesthetist: s2.anesthetistId ? map.get(s2.anesthetistId) ?? null : null,
        preOpDiagnosis: s2.preOpDiagnosis, postOpDiagnosis: s2.postOpDiagnosis, findings: s2.findings,
        opNote: s2.opNote ?? null, startedAt: s2.startedAt, endedAt: s2.endedAt, scheduledAt: s2.scheduledAt,
        link: `/surgery/${s2.id}`,
      };
    }

    if (type === 'ADMISSION') {
      const admId = id.includes(':') ? id.split(':')[0] : id;
      const sub = id.endsWith(':out') ? 'DISCHARGE' : 'ADMIT';
      const a = await this.prisma.admission.findFirst({
        where: { id: admId, patientId },
        include: {
          admittingDoctor: { select: { familyName: true, givenName: true } },
          attendingDoctor: { select: { familyName: true, givenName: true } },
          bed: { select: { roomNumber: true, bedNumber: true, ward: { select: { name: true } } } },
        },
      });
      if (!a) throw nf();
      const days = a.dischargeDate ? stayDays(a.admitDate, a.dischargeDate) : null;
      return {
        type, id, at: sub === 'DISCHARGE' ? a.dischargeDate : a.admitDate, status: a.status,
        title: sub === 'DISCHARGE' ? '퇴원' : '입원', subType: sub, admissionId: a.id,
        author: nm(a.attendingDoctor) || nm(a.admittingDoctor), authorRole: '주치의',
        reason: a.admitReason ?? null,
        bed: a.bed ? `${a.bed.ward?.name ?? ''} ${a.bed.roomNumber}-${a.bed.bedNumber}`.trim() : null,
        admitDate: a.admitDate, dischargeDate: a.dischargeDate, stayDays: days,
        link: `/inpatient/${a.id}`,
      };
    }

    throw new BadRequestException(`지원하지 않는 기록 유형: ${type}`);
  }

  async getPatientTimeline(patientId: string, q: TimelineQuery) {
    const want = (t: string) => !q.types?.length || q.types.includes(t);
    const range = (from?: Date, to?: Date) => ({ ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) });
    const hasRange = !!(q.from || q.to);
    // 커서는 DB 에서 **동일 시각을 포함(lte)** 해 가져오고, 정확한 경계는 병합 후 applyCursor 가 판정한다
    // (lt 로 자르면 같은 시각의 나머지 항목이 영구 유실된다 — 프로드 실측 결함).
    const cursor = parseCursor(q.before);
    const rangeFor = (field: string) => {
      const r: Record<string, unknown> = {};
      if (hasRange || cursor) {
        r[field] = { ...range(q.from, q.to), ...(cursor ? { lte: cursor.at } : {}) };
      }
      return r;
    };

    /**
     * 🔴 입원 범위(admissionId) 판정 — 검사·영상·처방·활력·투약실행 모델에는 **입원 연결(FK)이 없다**.
     * FK 필터만 걸면 이 트랙들이 통째로 걸러지지 않아 "입원 기간 기록" 화면에 다른 입원·외래 기록이
     * 섞인다(프로드 실측: 입원일 이전 42건 혼입). FK 없는 트랙은 **재원 기간**으로 범위를 판정한다.
     * (FK 있는 트랙에는 창을 걸지 않는다 — 퇴원요약은 퇴원 이후에 작성될 수 있어 창에 잘린다)
     */
    let admWindow: { gte: Date; lte?: Date } | undefined;
    if (q.admissionId) {
      const adm = await this.prisma.admission.findFirst({
        where: { id: q.admissionId, patientId }, // 소유 검증 — 타 환자 입원 id 는 통하지 않는다
        select: { admitDate: true, dischargeDate: true },
      });
      if (!adm) throw new NotFoundException('해당 환자의 입원 기록을 찾을 수 없습니다');
      admWindow = { gte: adm.admitDate, ...(adm.dischargeDate ? { lte: adm.dischargeDate } : {}) };
    }
    const maxDate = (...d: (Date | undefined)[]) => d.filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0];
    const minDate = (...d: (Date | undefined)[]) => d.filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0];
    /** 창(재원 기간)·요청 기간·커서를 **교집합**으로 병합 — 커서가 창을 넓히지 못하게 min 을 취한다 */
    const windowFilter = (): { gte?: Date; lte?: Date } | undefined => {
      if (!hasRange && !cursor && !admWindow) return undefined;
      const gte = maxDate(q.from, admWindow?.gte);
      const lte = minDate(q.to, admWindow?.lte, cursor?.at);
      return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
    };
    const rangeForWindowed = (field: string): Record<string, { gte?: Date; lte?: Date }> => {
      const f = windowFilter();
      return f ? { [field]: f } : {};
    };
    const items: Array<Record<string, unknown>> = [];
    const truncated: string[] = [];
    const note = (track: string, n: number) => { if (n >= PER_TRACK_CAP) truncated.push(track); };

    if (want('ENCOUNTER')) {
      const encs = await this.prisma.encounter.findMany({
        where: {
          patientId,
          // FK(admissionId)는 optional 이라 연결 누락이 실존(프로드: 입원 진료가 null) —
          // FK 일치 또는 (FK 없음 + 재원 기간 내)로 판정해 누락만으로 빠지지 않게 한다
          ...(q.admissionId ? { OR: [{ admissionId: q.admissionId }, { admissionId: null, createdAt: windowFilter() }] } : {}),
          ...rangeFor('createdAt'),
        },
        orderBy: { createdAt: 'desc' },
        take: PER_TRACK_CAP,
        include: {
          doctor: { select: { familyName: true, givenName: true } },
          diagnoses: { include: { diagnosisCode: { select: { code: true, nameKo: true, nameEn: true } } } },
          _count: { select: { prescriptions: true } },
        },
      });
      note('ENCOUNTER', encs.length);
      for (const e of encs) {
        // 내용이 전혀 없는 임시저장(DRAFT)은 시간축에서 제외 — 진료 시작만 하고 비운 껍데기
        const empty = !e.chiefComplaint && !e.subjective && !e.objective && !e.assessment && !e.plan;
        if (e.status === 'DRAFT' && empty && e.diagnoses.length === 0) continue;
        items.push({
          type: 'ENCOUNTER', id: e.id, at: e.signedAt ?? e.createdAt, status: e.status, author: nm(e.doctor),
          visitType: e.visitType, title: e.chiefComplaint ?? null,
          // 🔴 대화(스크라이브) 초안에서 출발한 진료인가 — 요약이 출처를 말할 수 있게 사실만 싣는다(본문 아님)
          aiScribed: e.aiScribed, scribeSessionId: e.scribeSessionId, aiEditDistance: e.aiEditDistance,
          soap: { S: e.subjective, O: e.objective, A: e.assessment, P: e.plan },
          diagnoses: e.diagnoses.map((d) => ({ code: d.diagnosisCode?.code, name: d.diagnosisCode?.nameKo, type: d.type })),
          rxCount: e._count.prescriptions,
          link: `/patients/${patientId}?tab=encounters`,
        });
      }
    }

    if (want('NURSING')) {
      // 입원 간호기록(NursingNote — patientId 없음·admission 경유)
      const adms = await this.prisma.admission.findMany({ where: { patientId }, select: { id: true } });
      const admIds = q.admissionId ? (adms.some((a) => a.id === q.admissionId) ? [q.admissionId] : []) : adms.map((a) => a.id);
      if (admIds.length) {
        const notes = await this.prisma.nursingNote.findMany({
          where: { admissionId: { in: admIds }, ...rangeFor('recordedAt') },
          orderBy: { recordedAt: 'desc' },
          take: PER_TRACK_CAP,
          include: { nurse: { select: { familyName: true, givenName: true } } },
        });
        note('NURSING', notes.length);
        for (const n of notes) items.push({
          type: 'NURSING', id: n.id, at: n.recordedAt, status: n.status, author: nm(n.nurse),
          noteType: n.noteType, shift: n.shiftType, focus: n.focus, priority: n.priority,
          dar: { D: n.data, A: n.action, R: n.response, E: n.education },
          soap: { S: n.subjective, O: n.objective, A: n.assessment, P: n.plan },
          content: n.content,
          link: `/patients/${patientId}?tab=nursing`,
        });
      }
      // 🔴 외래·응급 등 범용 간호기록 — UniversalNursingNote(환자 직결·입원 FK 없음).
      //    종전엔 `admissionId` 가 지정되면 이 트랙을 **통째로 건너뛰었다**. 그래서 정본 경계를 우회해
      //    새어나간 기록(contextType='INPATIENT' 등)이 입원 화면에서 영구히 안 보였다.
      //    FK 가 없으므로 ENCOUNTER 트랙과 같은 규칙으로 판정한다 —
      //    ① 컨텍스트가 그 입원을 직접 가리키거나 ② 재원 기간 안에 있으면 포함.
      const uniWindow = q.admissionId ? rangeForWindowed('recordedAt') : null;
      const uniWhere: Prisma.UniversalNursingNoteWhereInput = uniWindow
        ? { patientId, OR: [{ contextId: q.admissionId }, uniWindow] }
        : { patientId, ...rangeFor('recordedAt') };
      const uni = await this.prisma.universalNursingNote.findMany({
        where: uniWhere,
        orderBy: { recordedAt: 'desc' },
        take: PER_TRACK_CAP,
        include: { nurse: { select: { familyName: true, givenName: true } } },
      });
      note('NURSING', uni.length);
      for (const n of uni) items.push({
        type: 'NURSING', id: n.id, at: n.recordedAt, status: null, author: nm(n.nurse),
        noteType: n.noteType,
        // 🔴 컨텍스트를 그대로 말한다 — 응급 기록을 '외래'라 부르면 화면이 거짓을 말한다
        context: n.contextType, outpatient: n.contextType === 'OUTPATIENT',
        // 정본 경계를 우회해 새어나간 기록은 그렇다고 표시한다(조용히 섞지 않는다)
        canonBypass: isAdmissionScopedNursingContext(n.contextType) || undefined,
        // SBAR 은 SOAP·DAR 와 다른 서식이다 — 다른 칸에 밀어 넣으면 화면이 서식을 거짓말한다
        sbar: { S: n.situation, B: n.background, A: n.assessment, R: n.recommendation },
        content: n.content,
        link: `/patients/${patientId}?tab=nursing`,
      });
    }

    if (want('LAB')) {
      const labs = await this.prisma.labResult.findMany({
        // 검사는 '확정 시각(verifiedAt)' 우선 판정 — 창·기간·커서 교집합을 두 필드에 각각
        where: { patientId, ...(hasRange || admWindow ? { OR: [{ verifiedAt: windowFilter() }, { verifiedAt: null, createdAt: windowFilter() }] } : {}) },
        orderBy: { createdAt: 'desc' },
        take: PER_TRACK_CAP,
        include: {
          items: { select: { testName: true, value: true, unit: true, flag: true, normalMin: true, normalMax: true } },
          technician: { select: { familyName: true, givenName: true } },
        },
      });
      note('LAB', labs.length);
      const verifierNames = await this.resolveUserNames(labs.map((l) => l.verifiedBy));
      for (const l of labs) items.push({
        type: 'LAB', id: l.id, at: l.verifiedAt ?? l.completedAt ?? l.collectedAt ?? l.createdAt, status: l.status,
        title: l.items.length === 1 ? l.items[0].testName : `검사 ${l.items.length}항목`,
        author: nm(l.technician),                                   // 검사 수행자
        authorRole: '검사',
        verifier: l.verifiedBy ? verifierNames.get(l.verifiedBy) ?? null : null, // 결과 확정(독립검증)
        results: l.items.map((i) => ({
          name: i.testName, value: i.value, unit: i.unit, flag: i.flag,
          refLow: i.normalMin === null ? null : Number(i.normalMin),
          refHigh: i.normalMax === null ? null : Number(i.normalMax),
        })),
        abnormalCount: l.items.filter((i) => i.flag && i.flag !== 'N').length,
        collectedAt: l.collectedAt, completedAt: l.completedAt, verifiedAt: l.verifiedAt,
        link: `/patients/${patientId}?tab=labresults`,
      });
    }

    if (want('IMAGING')) {
      const imgs = await this.prisma.imagingResult.findMany({
        where: { patientId, ...(hasRange || admWindow ? { OR: [{ reportedAt: windowFilter() }, { reportedAt: null, createdAt: windowFilter() }] } : {}) },
        orderBy: { createdAt: 'desc' },
        take: PER_TRACK_CAP,
      });
      note('IMAGING', imgs.length);
      const radNames = await this.resolveUserNames(imgs.map((r) => r.radiologistId));
      for (const r of imgs) items.push({
        type: 'IMAGING', id: r.id, at: r.reportedAt ?? r.acquiredAt ?? r.createdAt, status: r.status,
        title: `${r.modality}${r.bodyPart ? ` ${r.bodyPart}` : ''}`,
        author: r.radiologistId ? radNames.get(r.radiologistId) ?? null : null,
        authorRole: '판독',
        finding: r.finding, impression: r.impression,
        acquiredAt: r.acquiredAt, reportedAt: r.reportedAt,
        link: `/patients/${patientId}?tab=imaging`,
      });
    }

    if (want('PRESCRIPTION')) {
      const rxs = await this.prisma.prescription.findMany({
        // LAB/IMAGING 처방은 오더 캐리어일 뿐이고 결과는 각 트랙이 보여줌 → 이중 표시 제거
        where: { encounter: { patientId }, type: { notIn: ['LAB', 'IMAGING'] }, ...rangeForWindowed('createdAt') },
        orderBy: { createdAt: 'desc' },
        take: PER_TRACK_CAP,
        include: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, code: true } } },
      });
      note('PRESCRIPTION', rxs.length);
      const rxNames = await this.resolveUserNames(rxs.flatMap((p) => [p.prescriberId, p.createdBy]));
      for (const p of rxs) items.push({
        type: 'PRESCRIPTION', id: p.id, at: p.createdAt, status: p.status,
        rxType: p.type, title: p.medicationCode?.nameKo ?? p.type,
        author: rxNames.get(p.prescriberId ?? p.createdBy ?? '') ?? null,
        authorRole: '처방',
        code: p.medicationCode?.code ?? null, route: p.route ?? null,
        dosage: p.dosage, frequency: p.frequency, duration: p.duration, instructions: p.instructions,
        link: `/patients/${patientId}?tab=medications`,
      });
    }

    if (want('VITALS')) {
      const vs = await this.prisma.preVisitVitals.findMany({
        where: { patientId, ...rangeForWindowed('measuredAt') },
        orderBy: { measuredAt: 'desc' },
        take: PER_TRACK_CAP,
      });
      note('VITALS', vs.length);
      const vitalNurses = await this.resolveUserNames(vs.map((v) => v.nurseId));
      for (const v of vs) items.push({
        type: 'VITALS', id: v.id, at: v.measuredAt, status: v.isAbnormal ? 'ABNORMAL' : 'NORMAL',
        vitals: {
          bp: v.systolicBp && v.diastolicBp ? `${v.systolicBp}/${v.diastolicBp}` : null,
          hr: v.heartRate, temp: v.temperature ? Number(v.temperature) : null,
          spo2: v.spo2, rr: v.respiratoryRate, pain: v.painScore,
          weight: v.weight === null ? null : Number(v.weight),
          bmi: v.bmi === null ? null : Number(v.bmi),
        },
        author: v.nurseId ? vitalNurses.get(v.nurseId) ?? null : null,
        authorRole: '측정',
        link: `/patients/${patientId}?tab=vitals`,
      });
    }

    if (want('SURGERY')) {
      const surgs = await this.prisma.surgery.findMany({
        where: {
          patientId,
          ...(q.admissionId ? { OR: [{ admissionId: q.admissionId }, { admissionId: null, scheduledAt: windowFilter() }] } : {}),
          ...rangeFor('scheduledAt'),
        },
        orderBy: { scheduledAt: 'desc' },
        take: PER_TRACK_CAP,
      });
      note('SURGERY', surgs.length);
      const surgeonNames = await this.resolveUserNames(surgs.map((x) => x.surgeonId));
      for (const s of surgs) items.push({
        type: 'SURGERY', id: s.id, at: s.startedAt ?? s.scheduledAt, status: s.status,
        title: s.procedureName, bodySite: s.bodySite,
        author: surgeonNames.get(s.surgeonId) ?? null,
        authorRole: '집도',
        preOpDiagnosis: s.preOpDiagnosis, postOpDiagnosis: s.postOpDiagnosis, findings: s.findings,
        startedAt: s.startedAt, endedAt: s.endedAt,
        link: `/surgery/${s.id}`, // 실존 라우트
      });
    }

    if (want('ADMISSION')) {
      const adms = await this.prisma.admission.findMany({
        where: { patientId, ...(q.admissionId ? { id: q.admissionId } : {}) },
        orderBy: { admitDate: 'desc' },
        take: PER_TRACK_CAP,
        include: {
          admittingDoctor: { select: { familyName: true, givenName: true } },
          attendingDoctor: { select: { familyName: true, givenName: true } },
        },
      });
      note('ADMISSION', adms.length);
      const inRange = (d: Date) => !hasRange || ((!q.from || d >= q.from) && (!q.to || d <= q.to));
      for (const a of adms) {
        const doc = nm(a.attendingDoctor) || nm(a.admittingDoctor);
        const common = { status: a.status, admissionId: a.id, author: doc || null, authorRole: '주치의', reason: a.admitReason ?? null, link: `/inpatient/${a.id}` };
        if (inRange(a.admitDate)) items.push({ type: 'ADMISSION', id: `${a.id}:in`, at: a.admitDate, title: '입원', subType: 'ADMIT', ...common });
        if (a.dischargeDate && inRange(a.dischargeDate)) items.push({ type: 'ADMISSION', id: `${a.id}:out`, at: a.dischargeDate, title: '퇴원', subType: 'DISCHARGE', ...common });
      }
    }

    if (want('PROGRESS_NOTE')) {
      // 경과기록 — 입원 문맥(admissionId). 환자 단위 조회는 admission 경유
      const adms = await this.prisma.admission.findMany({ where: { patientId }, select: { id: true } });
      const admIds = q.admissionId ? (adms.some((a) => a.id === q.admissionId) ? [q.admissionId] : []) : adms.map((a) => a.id);
      if (admIds.length) {
        const notes = await this.prisma.progressNote.findMany({
          where: { admissionId: { in: admIds }, ...rangeFor('createdAt') },
          orderBy: { createdAt: 'desc' },
          take: PER_TRACK_CAP,
          include: { doctor: { select: { familyName: true, givenName: true } } },
        });
        note('PROGRESS_NOTE', notes.length);
        for (const n of notes) items.push({
          type: 'PROGRESS_NOTE', id: n.id, at: n.createdAt, status: null, author: nm(n.doctor), authorRole: '경과',
          title: '경과기록', content: n.content, admissionId: n.admissionId,
          link: `/inpatient/${n.admissionId}`,
        });
      }
    }

    if (want('MAR')) {
      // 투약 실행(MAR) — 환자 직결. 시각은 실제 투여시각 우선(예정만 있으면 예정시각)
      const mar = await this.prisma.medicationAdministration.findMany({
        where: {
          patientId,
          // 실제 투여시각 우선 판정이라 두 필드에 각각 창을 적용(창·기간·커서 교집합)
          ...(hasRange || cursor || admWindow
            ? { OR: [{ administeredAt: windowFilter() }, { administeredAt: null, scheduledAt: windowFilter() }] }
            : {}),
        },
        orderBy: { scheduledAt: 'desc' },
        take: PER_TRACK_CAP,
        include: { prescription: { select: { medicationCode: { select: { nameKo: true, nameEn: true, ingredient: true, code: true } } } } },
      });
      note('MAR', mar.length);
      const marNurses = await this.resolveUserNames(mar.map((m) => m.nurseId));
      for (const m of mar) items.push({
        type: 'MAR', id: m.id, at: m.administeredAt ?? m.scheduledAt, status: m.status,
        title: m.prescription?.medicationCode?.nameKo ?? '투약',
        code: m.prescription?.medicationCode?.code ?? null,
        author: m.nurseId ? marNurses.get(m.nurseId) ?? null : null, authorRole: '투여',
        dosage: m.dose, route: m.route,
        // 보류/누락은 사유가 임상적으로 중요 — 값을 그대로 노출
        instructions: m.holdReason ?? null,
        scheduledAt: m.scheduledAt, administeredAt: m.administeredAt,
        link: `/patients/${patientId}?tab=medications`,
      });
    }

    if (want('DISCHARGE_SUMMARY')) {
      const adms = await this.prisma.admission.findMany({ where: { patientId }, select: { id: true } });
      const admIds = q.admissionId ? (adms.some((a) => a.id === q.admissionId) ? [q.admissionId] : []) : adms.map((a) => a.id);
      if (admIds.length) {
        const sums = await this.prisma.dischargeSummary.findMany({
          where: { admissionId: { in: admIds }, ...rangeFor('createdAt') },
          orderBy: { createdAt: 'desc' },
          take: PER_TRACK_CAP,
          include: { doctor: { select: { familyName: true, givenName: true } } },
        });
        note('DISCHARGE_SUMMARY', sums.length);
        for (const d of sums) items.push({
          type: 'DISCHARGE_SUMMARY', id: d.id, at: d.createdAt, status: d.status,
          title: '퇴원요약', author: nm(d.doctor), authorRole: '작성',
          admitDiagnosis: d.admitDiagnosis, dischargeDiagnosis: d.dischargeDiagnosis,
          hospitalCourse: d.hospitalCourse, followUpPlan: d.followUpPlan,
          admissionId: d.admissionId,
          link: `/inpatient/${d.admissionId}/discharge-summary`,
        });
      }
    }

    if (want('AI_PROPOSAL')) {
      /**
       * AI 제안 트랙 — 🔴 **본문을 싣지 않는다.** 초안 본문의 정본은 `AiProposal.contentEnc` 하나이고
       * 복호는 `AiProposalService.get()` 에서만 한다. 시계열이 사본을 들면 같은 사실에 정본이 둘이 된다.
       * 여기 담는 것은 "무엇에 대한 초안이 언제 나왔고, 사람이 그것을 어떻게 했는가"의 **요약**뿐이다.
       *
       * 🔴 `at` = **알게 된 시점** 규약: `decidedAt ?? presentedAt ?? createdAt`.
       *    셋은 다른 사실이라 어느 것을 썼는지 `atBasis` 로 함께 말한다 — 생성만 된 제안(사람이 본 적
       *    없는 것)을 결정 시각처럼 그리면 화면이 검토 이력을 지어내게 된다.
       */
      const props = await this.prisma.aiProposal.findMany({
        where: {
          patientId,
          // at 이 세 필드에서 파생되므로 창·기간·커서도 그 우선순위대로 각각 건다(LAB/MAR 과 같은 규칙)
          ...(hasRange || cursor || admWindow
            ? {
                OR: [
                  { decidedAt: windowFilter() },
                  { decidedAt: null, presentedAt: windowFilter() },
                  { decidedAt: null, presentedAt: null, createdAt: windowFilter() },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: PER_TRACK_CAP,
        select: {
          id: true, kind: true, status: true, source: true, reasonCode: true,
          targetType: true, targetId: true, targetKey: true,
          modelRef: true, promptVersion: true, version: true, supersedesId: true,
          editDistance: true, rejectReason: true,
          createdAt: true, presentedAt: true, decidedAt: true, decidedBy: true,
          // 최근 전이 1건 — "마지막으로 무슨 일이 있었나". 원장 전체는 제안 상세가 갖는다
          transitions: {
            orderBy: { at: 'desc' as const },
            take: 1,
            select: { fromStatus: true, toStatus: true, at: true, actorId: true, reason: true },
          },
        },
      });
      note('AI_PROPOSAL', props.length);
      const aiActors = await this.resolveUserNames([
        ...props.map((p) => p.decidedBy),
        ...props.flatMap((p) => p.transitions.map((t) => t.actorId)),
      ]);
      for (const p of props) {
        const last = p.transitions[0] ?? null;
        const kindLabel = AI_PROPOSAL_KIND_LABEL[p.kind as AiProposalKind] ?? p.kind;
        const statusLabel = AI_PROPOSAL_STATUS_LABEL[p.status as AiProposalStatusValue] ?? p.status;
        items.push({
          type: 'AI_PROPOSAL', id: p.id, at: p.decidedAt ?? p.presentedAt ?? p.createdAt, status: p.status,
          // 🔴 어느 시각을 썼는지 밝힌다 — 생성 시각을 결정 시각인 척 그리지 않는다
          atBasis: p.decidedAt ? 'DECIDED' : p.presentedAt ? 'PRESENTED' : 'CREATED',
          title: `${kindLabel} · ${statusLabel}`,
          aiKind: p.kind,
          // 사람이 결정한 건만 주체가 있다. 결정 전이면 null — 작성자를 지어내지 않는다
          author: p.decidedBy ? aiActors.get(p.decidedBy) ?? null : null,
          authorRole: p.decidedBy ? 'AI 제안 결정' : null,
          // 3상태(AI/FALLBACK/UNAVAILABLE) — 규칙이 대신 답한 것을 AI 라 부르지 않는다
          source: p.source, reasonCode: p.reasonCode,
          // 🔴 상류가 돌려준 태그만. null = 모델을 모른다(요청 태그로 메우지 않는다)
          modelRef: p.modelRef, promptVersion: p.promptVersion,
          // 🔴 null = **재지 않았다**(0 이 아니다 — "안 고쳤다"와 "안 쟀다"는 다른 사실)
          editDistance: p.editDistance,
          rejectReason: p.rejectReason,
          version: p.version, supersedesId: p.supersedesId,
          // 정본 참조 — 이 제안이 무엇에 달린 것인가
          targetType: p.targetType, targetId: p.targetId, targetKey: p.targetKey,
          createdAt: p.createdAt, presentedAt: p.presentedAt, decidedAt: p.decidedAt,
          lastTransition: last
            ? {
                from: last.fromStatus, to: last.toStatus, at: last.at, reason: last.reason,
                actor: last.actorId ? aiActors.get(last.actorId) ?? null : null,
              }
            : null,
          // 🔴 **비워둔다.** 제안 원장을 보여주는 화면(`/admin/ai-oversight`·환자 탭)이 아직 없다.
          //    없는 화면으로 보내는 링크를 그리면 화면이 있는 척하는 것이 된다(모르면 비운다).
          link: null,
        });
      }
    }

    if (want('CONVERSATION')) {
      /**
       * 대화(스크라이브) 트랙 — 🔴 **원문을 싣지 않는다**(위 TIMELINE_TRACKS 주석).
       *
       * 🔴 `at` = 세션 **시작** 시각(createdAt). 대화가 일어난 시각이 임상적 사실이고, 반영·전사 완료
       *    시각은 다른 사실이라 `appliedAt`(=updatedAt)을 따로 싣는다 — 하나로 뭉개면 화면이 "언제 대화했나"와
       *    "언제 기록에 넣었나"를 뒤바꿔 말한다.
       * 🔴 발화 수는 **AMBIENT(라이브 대화)에만 있다.** 녹음 사후(RECORDING)는 발화 단위로 저장하지 않으므로
       *    `utterances: null`(산출 불가)이다 — `0` 이라 적으면 "말이 없었다"는 다른 사실이 된다.
       * 🔴 `droppedSec` 합이 `null` = **재지 않았다**(0 = 놓친 구간이 없었다와 다른 사실).
       */
      const sessions = await this.prisma.scribeSession.findMany({
        where: { patientId, ...rangeFor('createdAt') },
        orderBy: { createdAt: 'desc' },
        take: PER_TRACK_CAP,
        select: {
          id: true, encounterId: true, doctorId: true, status: true, source: true,
          sttTier: true, resolverKind: true, aiModel: true, aiPromptVersion: true,
          transcript: true, audioPath: true, audioDeletedAt: true, legalHold: true,
          draftSnapshot: true, createdAt: true, updatedAt: true,
        },
      });
      note('CONVERSATION', sessions.length);
      const convActors = await this.resolveUserNames(sessions.map((x) => x.doctorId));
      /**
       * 발화 수·누락초는 AMBIENT 세션에만 있다(없는 축에 0 을 만들지 않는다).
       * 🔴 세션마다 묻지 않는다 — `groupBy` **2쿼리 상수**다(세션 수만큼 묻던 첫 구현은 상한 200 에서 600쿼리였다.
       *    다른 트랙과 같은 규약: 이름 조회·집계는 항목 수와 무관하게 상수).
       */
      const ambientIds = sessions.filter((x) => x.source === 'AMBIENT').map((x) => x.id);
      const [uttRows, delRows] = ambientIds.length
        ? await Promise.all([
            this.prisma.voiceUtterance.groupBy({
              by: ['sessionId'], where: { sessionId: { in: ambientIds } },
              _count: { _all: true }, _sum: { droppedSec: true },
            }),
            this.prisma.voiceUtterance.groupBy({
              by: ['sessionId'], where: { sessionId: { in: ambientIds }, deleted: true },
              _count: { _all: true },
            }),
          ])
        : [[] as Array<{ sessionId: string; _count: { _all: number }; _sum: { droppedSec: number | null } }>,
           [] as Array<{ sessionId: string; _count: { _all: number } }>];
      const uttBy = new Map(uttRows.map((x) => [x.sessionId, x]));
      const delBy = new Map(delRows.map((x) => [x.sessionId, x._count._all]));
      for (const sess of sessions) {
        const ambient = sess.source === 'AMBIENT';
        const row = uttBy.get(sess.id);
        // 🔴 AMBIENT 인데 행이 없으면 **진짜 0 발화**다(그 축이 없는 RECORDING 의 null 과 다른 사실)
        const utterances: number | null = ambient ? row?._count._all ?? 0 : null;
        const deletedUtterances: number | null = ambient ? delBy.get(sess.id) ?? 0 : null;
        const droppedSec: number | null = ambient ? row?._sum.droppedSec ?? null : null; // null = 재지 않았다
        // 반영 필드 — **키만**(본문은 정본이 갖는다). `appliedFields` 가 없으면 반영 기록이 없다는 뜻이지 0 필드가 아니다
        const snap = sess.draftSnapshot;
        const appliedRaw = snap && typeof snap === 'object' && !Array.isArray(snap)
          ? (snap as Record<string, unknown>).appliedFields
          : undefined;
        const appliedFields = appliedRaw && typeof appliedRaw === 'object' && !Array.isArray(appliedRaw)
          ? Object.keys(appliedRaw as Record<string, unknown>)
          : null;
        items.push({
          type: 'CONVERSATION', id: sess.id, at: sess.createdAt, atBasis: 'CREATED', status: sess.status,
          // 라벨 어휘는 shared 정본 하나(BE·FE 가 각자 번역하면 갈라진다)
          title: `${scribeSourceLabel(sess.source) ?? sess.source} · ${scribeSessionStatusLabel(sess.status) ?? sess.status}`,
          scribeSource: sess.source,
          author: convActors.get(sess.doctorId) ?? null,
          authorRole: '대화 기록 주체',
          encounterId: sess.encounterId,
          // 🔴 null = 그 축이 없다(RECORDING) · 숫자 = 실측
          utterances, deletedUtterances, droppedSec,
          // 전사가 남아 있는가(파기되면 null 이 된다 — 보존·파기 축과 같은 사실을 말한다)
          transcriptPresent: sess.transcript !== null && sess.transcript !== undefined,
          audioPresent: !!sess.audioPath, audioDeletedAt: sess.audioDeletedAt,
          legalHold: sess.legalHold,
          appliedFields, appliedAt: appliedFields ? sess.updatedAt : null,
          // 엔진 3상태 — null = 모른다(요청 태그로 메우지 않는다)
          sttTier: sess.sttTier, resolverKind: sess.resolverKind,
          // AI_PROPOSAL 트랙과 같은 필드명을 쓴다(화면이 트랙마다 다른 이름을 읽으면 갈라진다)
          modelRef: sess.aiModel, promptVersion: sess.aiPromptVersion,
          // 🔴 비워둔다 — 대화 원문 화면은 진료 화면 안의 패널이고 시계열에서 바로 여는 경로가 없다
          link: null,
        });
      }
    }

    // 결정적 정렬(시각 내림차순·동일 시각은 id 오름차순) → 커서 경계 판정 → 상한 적용
    items.sort((a, b) => compareItems(a as { at: Date; id: string }, b as { at: Date; id: string }));
    const scoped = applyCursor(items as Array<{ at: Date; id: string }>, cursor) as Array<Record<string, unknown>>;
    const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const total = scoped.length;
    const page = scoped.slice(0, limit);

    const counts: Record<string, number> = {};
    for (const t of TIMELINE_TRACKS) counts[t.type.toLowerCase()] = scoped.filter((i) => i.type === t.type).length;
    // 커서 = 마지막 표시 항목의 위치(시각+id). 트랙 병합이라 offset 은 불안정하므로 위치 커서.
    const nextCursor = page.length && total > page.length ? formatCursor(page[page.length - 1] as { at: Date; id: string }) : null;
    return {
      items: page,
      counts,
      total,
      hasMore: total > page.length,
      nextCursor,
      truncatedTracks: [...new Set(truncated)], // 트랙 상한에 걸린 도메인 — 조용한 절단 방지
      tracks: TIMELINE_TRACKS,
    };
  }
}
