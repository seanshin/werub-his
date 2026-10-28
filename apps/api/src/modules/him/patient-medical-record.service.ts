import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { HimService } from './him.service';

/** 환자 차트에서 보이는 최근 발급·요청 행 수 — 넘으면 전체 수와 함께 "잘렸다"고 말한다 */
export const PATIENT_RECORD_LIST_LIMIT = 50;

/** 서명본 보존을 시작한 날 — 이전 진료기록·퇴원요약 정정은 정정 전 내용이 남아 있지 않다 */
export const SIGNED_VERSION_PRESERVED_SINCE = '2026-10-03';

/** 간호기록 정정문이 원본을 가리키는 표식 — nursing.service amendNote 가 본문 앞에 붙인다(관계 컬럼 없음) */
const NURSING_ADDENDUM_RE = /^\[정정 addendum of ([0-9a-f-]{36})\]/i;

/**
 * 정정 이력의 출처 — 기록 종류마다 원장이 다르다(합치지 않고 출처를 밝힌다)
 *  - SIGNED_VERSION: 진료기록·퇴원요약 — 정정 순간 보존한 직전 서명본(내용 열람 가능)
 *  - UNPRESERVED: 지금 정정 중(재서명 대기)인데 보존본이 없다 — 보존 시작 이전에 정정됨(정정 전 내용 모름)
 *  - NURSING_ADDENDUM: 간호기록 — 원본은 그대로 두고 정정문을 새 기록으로(원본 보존)
 *  - LAB_RESULT_AMENDMENT: 검사 결과 — 수정 전 항목 스냅샷(사유 포함)
 */
export type AmendmentSource = 'SIGNED_VERSION' | 'UNPRESERVED' | 'NURSING_ADDENDUM' | 'LAB_RESULT_AMENDMENT';

/**
 * 환자 차트 '의무기록' 탭 — 기록 완결(미비)·발급 문서·발급 요청(2026-10-02).
 *
 * 🔴 서버에는 다 있었는데 환자 차트에서 볼 자리가 없었다.
 *  - 미비 기록(퇴원요약 미비·미서명 진료/간호기록·상병 미입력 서명)은 병원 전체 목록(/admin/him)뿐이었다
 *  - 이 환자에게 무엇이 발급됐는지(진단서·소견서·사본 · 원본/사본/재발급/무효)를 차트에서 알 수 없었다
 *  - 사본 발급 요청이 어디까지 왔는지도 발급 업무 화면에서만 보였다
 * 정책(기한·조회 기간)은 병원 목록과 같은 정본(HimService)을 쓴다. 목록은 상한이 있고, 넘으면 전체 수를 함께 준다.
 */
@Injectable()
export class PatientMedicalRecordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly him: HimService,
  ) {}

  /** 정정 이력 — 출처별 원장을 시각순으로 나란히(상한 + 전체 수) */
  private async amendments(patientId: string) {
    const [versions, amendedEnc, amendedDs, nursingAddenda, labAmend] = await Promise.all([
      this.prisma.signedRecordVersion.findMany({
        where: { patientId }, orderBy: { supersededAt: 'desc' },
        select: { id: true, recordType: true, recordId: true, signedAt: true, signedBy: true, supersededAt: true, supersededBy: true, changedFields: true, reason: true },
      }),
      this.prisma.encounter.findMany({ where: { patientId, status: 'AMENDED' }, select: { id: true, updatedAt: true } }),
      this.prisma.dischargeSummary.findMany({ where: { status: 'AMENDED', admission: { patientId } }, select: { id: true, updatedAt: true } }),
      this.prisma.nursingNote.findMany({
        where: { admission: { patientId }, content: { startsWith: '[정정 addendum of ' } },
        select: { id: true, content: true, signedAt: true, createdAt: true, nurseId: true },
      }),
      this.prisma.labResultAmendment.findMany({
        where: { labResult: { patientId } },
        select: { id: true, labResultId: true, amendedBy: true, reason: true, previousStatus: true, createdAt: true },
      }),
    ]);
    const amendedNow = new Set([...amendedEnc.map((e) => e.id), ...amendedDs.map((d) => d.id)]);
    const latestVersionOf = new Map<string, string>();
    for (const v of versions) if (!latestVersionOf.has(v.recordId)) latestVersionOf.set(v.recordId, v.id); // desc 정렬 — 첫 행이 최신
    type Row = {
      source: AmendmentSource; recordType: string; recordId: string; at: Date | null; by: string | null;
      versionId?: string; priorSignedAt?: Date | null; priorSignedBy?: string | null; changedFields?: string[];
      resignPending?: boolean; addendumId?: string; reason?: string; previousStatus?: string;
    };
    const rows: Row[] = [
      ...versions.map((v): Row => ({
        source: 'SIGNED_VERSION', recordType: v.recordType, recordId: v.recordId, at: v.supersededAt, by: v.supersededBy,
        versionId: v.id, priorSignedAt: v.signedAt, priorSignedBy: v.signedBy,
        changedFields: Array.isArray(v.changedFields) ? (v.changedFields as unknown[]).filter((x): x is string => typeof x === 'string') : [],
        // 지금도 재서명 전이고 이 판이 그 기록의 가장 최근 보존본이면 — 정정 중
        resignPending: amendedNow.has(v.recordId) && latestVersionOf.get(v.recordId) === v.id,
        // 정정 사유(선택 입력) — 없으면 싣지 않는다(빈 사유를 "사유 없음"으로 지어내지 않는다)
        ...(v.reason ? { reason: v.reason } : {}),
      })),
      // 정정 중인데 보존본이 없다 — 시각은 마지막 변경 시각(정정 시각을 지어내지 않는다 — 이름도 그렇게 말한다)
      ...amendedEnc.filter((e) => !latestVersionOf.has(e.id)).map((e): Row => ({ source: 'UNPRESERVED', recordType: 'ENCOUNTER', recordId: e.id, at: e.updatedAt, by: null, resignPending: true })),
      ...amendedDs.filter((d) => !latestVersionOf.has(d.id)).map((d): Row => ({ source: 'UNPRESERVED', recordType: 'DISCHARGE_SUMMARY', recordId: d.id, at: d.updatedAt, by: null, resignPending: true })),
      ...nursingAddenda.flatMap((n): Row[] => {
        const m = NURSING_ADDENDUM_RE.exec(n.content ?? '');
        return m ? [{ source: 'NURSING_ADDENDUM', recordType: 'NURSING_NOTE', recordId: m[1], addendumId: n.id, at: n.signedAt ?? n.createdAt, by: n.nurseId }] : [];
      }),
      ...labAmend.map((a): Row => ({ source: 'LAB_RESULT_AMENDMENT', recordType: 'LAB_RESULT', recordId: a.labResultId, at: a.createdAt, by: a.amendedBy, reason: a.reason, previousStatus: a.previousStatus })),
    ].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    const page = rows.slice(0, PATIENT_RECORD_LIST_LIMIT);
    const ids = [...new Set(page.flatMap((r) => [r.by, r.priorSignedBy]).filter((x): x is string => !!x))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, familyName: true, givenName: true } }) : [];
    const nameOf = new Map(users.map((u) => [u.id, `${u.familyName ?? ''}${u.givenName ?? ''}`.trim()]));
    const who = (id: string | null | undefined) => (id ? { id, name: nameOf.get(id) ?? null } : null);
    return {
      total: rows.length,
      limit: PATIENT_RECORD_LIST_LIMIT,
      preservedSince: SIGNED_VERSION_PRESERVED_SINCE,
      items: page.map((r) => ({ ...r, by: who(r.by), ...(r.source === 'SIGNED_VERSION' ? { priorSignedBy: who(r.priorSignedBy) } : {}) })),
    };
  }

  /**
   * 보존된 서명본 한 판 — 정정 전 내용과 지금 내용을 나란히(무엇이 바뀌었는지는 changedFields).
   * 환자 경로로만 연다 — 다른 환자의 판 id 를 넣으면 404(존재 여부도 말하지 않는다).
   */
  async signedVersion(patientId: string, versionId: string) {
    const v = await this.prisma.signedRecordVersion.findUnique({ where: { id: versionId } });
    if (!v || v.patientId !== patientId) throw new NotFoundException('이 환자의 보존된 서명본이 아닙니다');
    let current: Record<string, unknown> | null = null;
    let currentStatus: string | null = null;
    if (v.recordType === 'ENCOUNTER') {
      const e = await this.prisma.encounter.findUnique({
        where: { id: v.recordId },
        select: { status: true, signedAt: true, subjective: true, objective: true, assessment: true, plan: true, pregnancyStatus: true,
          chiefComplaint: true, historyPresentIllness: true, pastMedicalHistory: true, familyHistory: true, socialHistory: true, reviewOfSystems: true, physicalExamination: true,
          diagnoses: { select: { type: true, rank: true, certainty: true, diagnosisCode: { select: { code: true, nameKo: true } } } } },
      });
      if (e) {
        currentStatus = e.status;
        current = { subjective: e.subjective, objective: e.objective, assessment: e.assessment, plan: e.plan, pregnancyStatus: e.pregnancyStatus,
          chiefComplaint: e.chiefComplaint, historyPresentIllness: e.historyPresentIllness, pastMedicalHistory: e.pastMedicalHistory, familyHistory: e.familyHistory,
          socialHistory: e.socialHistory, reviewOfSystems: e.reviewOfSystems, physicalExamination: e.physicalExamination,
          diagnoses: e.diagnoses.map((d) => ({ code: d.diagnosisCode?.code ?? null, name: d.diagnosisCode?.nameKo ?? null, type: d.type, rank: d.rank, certainty: d.certainty })) };
      }
    } else if (v.recordType === 'DISCHARGE_SUMMARY') {
      const d = await this.prisma.dischargeSummary.findUnique({ where: { id: v.recordId } });
      if (d) {
        const { id: _i, admissionId: _a, status, signedAt: _sa, signedBy: _sb, createdAt: _c, updatedAt: _u, ...rest } = d;
        currentStatus = status; current = rest as Record<string, unknown>;
      }
    }
    // 이 판 뒤에 보존된 판이 있으면 '지금 내용'과 바로 비교하는 것은 중간 판을 건너뛴다 — 그 사실을 말한다
    const laterVersions = await this.prisma.signedRecordVersion.count({ where: { recordId: v.recordId, supersededAt: { gt: v.supersededAt } } });
    return {
      versionId: v.id, recordType: v.recordType, recordId: v.recordId,
      priorSignedAt: v.signedAt, supersededAt: v.supersededAt, reason: v.reason ?? null,
      changedFields: v.changedFields, prior: v.content, current, currentStatus, laterVersions,
    };
  }

  async forPatient(patientId: string) {
    const [deficiencies, docs, docTotal, reqs, reqTotal, amendments] = await Promise.all([
      this.him.getDeficiencies(false, patientId),
      this.prisma.issuedDocument.findMany({
        where: { patientId },
        orderBy: { issuedAt: 'desc' },
        take: PATIENT_RECORD_LIST_LIMIT,
        select: { issueNo: true, documentType: true, status: true, reissueOf: true, issuedAt: true, issuedBy: true },
      }),
      this.prisma.issuedDocument.count({ where: { patientId } }),
      this.prisma.documentRequest.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        take: PATIENT_RECORD_LIST_LIMIT,
        select: {
          id: true, type: true, status: true, copies: true, purpose: true, deliveryMethod: true,
          createdAt: true, completedAt: true, slaDueAt: true, issuedDocumentId: true,
        },
      }),
      this.prisma.documentRequest.count({ where: { patientId } }),
      this.amendments(patientId),
    ]);

    // 발급자 이름 — IssuedDocument.issuedBy 는 관계 없는 사용자 id 다(없으면 null 그대로 — 지어내지 않는다)
    const issuerIds = [...new Set(docs.map((d) => d.issuedBy).filter((x): x is string => !!x))];
    const users = issuerIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: issuerIds } }, select: { id: true, familyName: true, givenName: true } })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, `${u.familyName ?? ''}${u.givenName ?? ''}`.trim()]));

    return {
      deficiencies: {
        // 환자 차트에서는 환자 이름을 다시 싣지 않는다(이미 그 환자다)
        items: deficiencies.items.map(({ patient: _p, ...rest }) => rest),
        counts: deficiencies.counts,
        policy: deficiencies.policy,
      },
      issuedDocuments: {
        total: docTotal,
        limit: PATIENT_RECORD_LIST_LIMIT,
        items: docs.map((d) => ({
          issueNo: d.issueNo, documentType: d.documentType, status: d.status, reissueOf: d.reissueOf,
          issuedAt: d.issuedAt, issuedBy: d.issuedBy ? { id: d.issuedBy, name: nameOf.get(d.issuedBy) ?? null } : null,
        })),
      },
      documentRequests: {
        total: reqTotal,
        limit: PATIENT_RECORD_LIST_LIMIT,
        items: reqs.map((r) => ({ ...r, issueNo: r.issuedDocumentId, issuedDocumentId: undefined })),
      },
      amendments,
    };
  }
}
