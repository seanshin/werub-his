import { JourneyService } from '../journey/journey.service';
import { Injectable, NotFoundException, BadRequestException, ConflictException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { recordBlockchainSignature } from '../../common/util/blockchain-signature';
import { assertStateTransition, stateChangedConflict, TransitionMap } from '../../common/state-transition';

/** 병리 검체 상태 어휘 — 스키마 주석(PathologySpecimen.status) 그대로 */
export type SpecimenStatus = 'RECEIVED' | 'PROCESSING' | 'REPORTED' | 'SIGNED' | 'AMENDED';
export const SPECIMEN_TRANSITIONS: TransitionMap<SpecimenStatus> = {
  RECEIVED: ['PROCESSING'],
  PROCESSING: ['REPORTED', 'SIGNED'],
  REPORTED: ['SIGNED', 'AMENDED'],
  SIGNED: ['AMENDED'],
  AMENDED: ['SIGNED'],
};
export const SPECIMEN_TX_CTX = { code: 'PATHOLOGY_SPECIMEN', message: '지금 상태에서는 할 수 없는 검체 처리입니다' };

@Injectable()
export class PathologyService {
  constructor(
    private readonly prisma: PrismaService,
    /** 여정 정본 발행기(2026-10-01 P0-6 — 직접 쓰기 이관) */
    @Optional() private readonly journey?: JourneyService,
  ) {}

  async getSpecimens(filters: {
    status?: string;
    patientId?: string;
    priority?: string;
    page?: number;
    limit?: number;
  }) {
    const { status, patientId, priority, page = 1, limit = 20 } = filters;
    const where: Prisma.PathologySpecimenWhereInput = {};
    if (status) where.status = status;
    if (patientId) where.patientId = patientId;
    if (priority) where.priority = priority;

    const [items, total] = await Promise.all([
      this.prisma.pathologySpecimen.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
          collector: { select: { id: true, familyName: true, givenName: true } },
        },
      }),
      this.prisma.pathologySpecimen.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getSpecimenById(id: string) {
    const specimen = await this.prisma.pathologySpecimen.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        collector: { select: { id: true, familyName: true, givenName: true } },
        report: true,
      },
    });
    if (!specimen) throw new NotFoundException('Specimen not found');
    return specimen;
  }

  async createSpecimen(data: Record<string, unknown>) {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    // accession 번호 중복 방지 — 일자 단위 advisory lock으로 채번(count+1)+생성 원자화(@unique 충돌·검체 등록누락 방지)
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`specimen:${dateStr}`}))`;
      const count = await tx.pathologySpecimen.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } });
      const accessionNo = `SP-${dateStr}-${String(count + 1).padStart(4, '0')}`;
      return tx.pathologySpecimen.create({
        data: {
          accessionNo,
          patientId: data.patientId as string,
          specimenType: data.specimenType as string,
          site: data.collectionSite as string || '',
          fixative: data.fixative as string | undefined,
          collectedAt: data.collectedAt ? new Date(data.collectedAt as string) : new Date(),
          collectedBy: data.collectorId as string,
          priority: (data.priority as string) || 'ROUTINE',
          clinicalInfo: (data.clinicalInfo ?? data.clinicalHistory) as string | undefined,
          status: 'RECEIVED',
        },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        },
      });
    });
  }

  /**
   * 검체 접수(RECEIVED→PROCESSING). 🔴 (2026-09-15 D1) 종전엔 상태를 보지 않아 **서명된 검체를 PROCESSING 으로
   * 되돌리고 접수 시각을 오늘로 덮어썼다**(보고서는 서명된 채 남아 검체만 "처리 중"이 되는 모순).
   */
  async receiveSpecimen(id: string) {
    const specimen = await this.prisma.pathologySpecimen.findUnique({ where: { id } });
    if (!specimen) throw new NotFoundException('Specimen not found');
    if (specimen.status === 'PROCESSING') return specimen;
    assertStateTransition(SPECIMEN_TRANSITIONS, specimen.status as SpecimenStatus, 'PROCESSING', SPECIMEN_TX_CTX);

    const upd = await this.prisma.pathologySpecimen.updateMany({
      where: { id, status: specimen.status },
      data: { receivedAt: new Date(), status: 'PROCESSING' },
    });
    if (upd.count === 0) stateChangedConflict(SPECIMEN_TX_CTX, specimen.status);
    return this.prisma.pathologySpecimen.findUnique({ where: { id } });
  }

  async getReport(specimenId: string) {
    const report = await this.prisma.pathologyReport.findFirst({
      where: { specimenId },
      include: {
        specimen: { select: { id: true, accessionNo: true, specimenType: true } },
      },
    });
    if (!report) throw new NotFoundException('Report not found for this specimen');
    // FE(PathologyReport)는 ihcResults/molecularResults 키 기대 → 별칭 부여
    return { ...report, ihcResults: report.ihc, molecularResults: report.molecularTest };
  }

  async createReport(data: Record<string, unknown>) {
    const specimen = await this.prisma.pathologySpecimen.findUnique({
      where: { id: data.specimenId as string },
    });
    if (!specimen) throw new NotFoundException('Specimen not found');

    return this.prisma.pathologyReport.create({
      data: {
        specimenId: data.specimenId as string,
        grossDescription: data.grossDescription as string | undefined,
        microDescription: (data.microDescription ?? data.microscopicDescription) as string | undefined,
        diagnosis: data.diagnosis as string | undefined,
        diagnosisCode: (data.diagnosisCode ?? data.icdCode) as string | undefined,
        // 추가 검사(면역화학·분자) — FE ihcResults/molecularResults ↔ 모델 ihc/molecularTest
        ihc: (data.ihcResults ?? data.ihc) as Prisma.InputJsonValue ?? undefined,
        molecularTest: (data.molecularResults ?? data.molecularTest) as Prisma.InputJsonValue ?? undefined,
        // TNM(pT/pN/pM) + 병기군 + 등급 + 절제연
        tnmT: data.tnmT as string | undefined,
        tnmN: data.tnmN as string | undefined,
        tnmM: data.tnmM as string | undefined,
        tnmStage: data.tnmStage as string | undefined,
        tumorGrade: data.tumorGrade as string | undefined,
        marginStatus: data.marginStatus as string | undefined,
        reportedBy: (data.reportedBy ?? data.pathologistId) as string | undefined,
      },
    });
  }

  async updateReport(id: string, data: Record<string, unknown>) {
    const report = await this.prisma.pathologyReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    // 서명된 병리 리포트(최종 진단)는 무단 수정 불가 — 서명 후 진단·TNM·절제연 등을 재서명·감사 없이
    //  덮어쓰면 서명 의료문서(암 진단)의 변조. 정정은 별도 정정(addendum)·재서명 절차를 이용.
    if (report.signedAt) {
      throw new BadRequestException({ code: 'PATHOLOGY_REPORT_SIGNED', message: '서명된 병리 리포트는 수정할 수 없습니다. 정정이 필요하면 정정(addendum)·재서명 절차를 이용하세요.' });
    }

    const updateData: Record<string, unknown> = {};
    const allowed = ['grossDescription', 'microDescription', 'diagnosis', 'diagnosisCode', 'addendum',
      'tnmT', 'tnmN', 'tnmM', 'tnmStage', 'tumorGrade', 'marginStatus'];
    for (const key of allowed) {
      if (data[key] !== undefined) updateData[key] = data[key];
    }
    // 추가 검사(FE ihcResults/molecularResults ↔ 모델 ihc/molecularTest)
    if (data.ihcResults !== undefined || data.ihc !== undefined) updateData.ihc = (data.ihcResults ?? data.ihc) as Prisma.InputJsonValue;
    if (data.molecularResults !== undefined || data.molecularTest !== undefined) updateData.molecularTest = (data.molecularResults ?? data.molecularTest) as Prisma.InputJsonValue;

    return this.prisma.pathologyReport.update({ where: { id }, data: updateData });
  }

  async signReport(id: string, userId: string, blockchainSignature?: {
    certificateId: string;
    signatureValue: string;
    signatureAlgorithm: string;
    documentHash: string;
  }) {
    const report = await this.prisma.pathologyReport.findUnique({
      where: { id },
      include: { specimen: { select: { patientId: true } } },
    });
    if (!report) throw new NotFoundException('Report not found');
    // 🔴 (2026-09-15 D1) 종전엔 이미 서명된 보고서를 다시 서명하면 **서명자·서명 시각이 덮어써졌다**
    //    (누가 언제 진단을 확정했는가는 법정 기록이다 — 정정은 서명 취소·재발행 경로로 간다).
    if (report.signedAt) {
      throw new ConflictException({
        code: 'PATHOLOGY_REPORT_ALREADY_SIGNED',
        message: '이미 서명된 병리 보고서입니다',
        details: { signedAt: report.signedAt, signedBy: report.signedBy },
      });
    }

    const [updatedReport] = await this.prisma.$transaction([
      this.prisma.pathologyReport.update({
        where: { id },
        data: { signedBy: userId, signedAt: new Date() },
      }),
      this.prisma.pathologySpecimen.update({
        where: { id: report.specimenId },
        data: { status: 'SIGNED' },
      }),
    ]);

    // 암등록 연계: 서명 진단이 악성(ICD C코드 또는 진단문 악성 키워드)이면 등록 후보 알림
    const patientIdForReg = (report as { specimen?: { patientId?: string } }).specimen?.patientId;
    const dxCode = (report.diagnosisCode ?? '').toUpperCase();
    const dxText = report.diagnosis ?? '';
    const isMalignant = /^C\d/.test(dxCode) || /(암|악성|malignan|carcinoma|sarcoma|lymphoma|leukemia|melanoma)/i.test(dxText);
    if (patientIdForReg && isMalignant) {
      // 이미 해당 환자 암등록이 있으면 후보 알림 생략
      const existingReg = await this.prisma.cancerRegistry.findFirst({ where: { patientId: patientIdForReg }, select: { id: true } });
      if (!existingReg) {
        this.journey?.emit({
            patientId: patientIdForReg,
            eventType: 'CANCER_REGISTRY_CANDIDATE',
            title: '암등록 후보 (병리 악성 진단)',
            description: [dxText, dxCode ? `진단코드: ${dxCode}` : ''].filter(Boolean).join(' · '),
            department: '병리과',
            refType: 'PATHOLOGY_REPORT',
            refId: id,
            navUrl: '/cancer-registry',
            severity: 'WARNING',
          });
      }
    }

    // Blockchain signature (non-blocking)
    if (blockchainSignature) {
      try {
        await recordBlockchainSignature(this.prisma, blockchainSignature, {
          documentType: 'PATHOLOGY_REPORT',
          documentId: id,
          patientId: patientIdForReg,
          signerUserId: userId,
        });
} catch (e) {
        console.error('Blockchain signature failed (non-blocking):', e);
      }
    }

    return updatedReport;
  }

  async addAddendum(id: string, addendum: string) {
    const report = await this.prisma.pathologyReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    if (!addendum) throw new BadRequestException('Addendum text is required');

    const [updatedReport] = await this.prisma.$transaction([
      this.prisma.pathologyReport.update({
        where: { id },
        data: { addendum, amendedAt: new Date() },
      }),
      this.prisma.pathologySpecimen.update({
        where: { id: report.specimenId },
        data: { status: 'AMENDED' },
      }),
    ]);

    return updatedReport;
  }

  async getStats() {
    const [specimens, urgentPending] = await Promise.all([
      this.prisma.pathologySpecimen.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      // 긴급 = 미보고 상태의 URGENT/FROZEN — 이미 보고된 긴급 건은 조치 대상이 아니다
      this.prisma.pathologySpecimen.count({
        where: { priority: { in: ['URGENT', 'FROZEN'] }, status: { notIn: ['REPORTED', 'SIGNED', 'AMENDED'] } },
      }),
    ]);
    const byStatus = specimens.reduce(
      (acc, s) => ({ ...acc, [s.status]: s._count.id }),
      {} as Record<string, number>,
    );
    const total = specimens.reduce((sum, s) => sum + s._count.id, 0);
    const tat = await this.getTatStats();

    return {
      byStatus,
      total,
      // 🔴 FE 통계 탭 계약 필드 — 종전엔 {byStatus,total}만 줘서 4개 카드가 데이터가 있어도
      //    항상 0 이었고, '평균 TAT 0시간'은 측정값이 아니라 계약 불일치의 결과였다(P11·2026-08-13 W3).
      totalReceived: total,
      totalReported: (byStatus['REPORTED'] ?? 0) + (byStatus['SIGNED'] ?? 0) + (byStatus['AMENDED'] ?? 0),
      averageTAT: tat.overall.avg, // 시간(h) — 정본은 getTatStats 하나(P12 방지)
      urgentCount: urgentPending,
    };
  }

  async getPatients() {
    // FE 는 patient.specimenCount·lastSpecimenDate 를 읽는다 — 없으면 배지가 'undefined건'(P11)
    const [specimens, counts] = await Promise.all([
      this.prisma.pathologySpecimen.findMany({
        distinct: ['patientId'],
        select: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.pathologySpecimen.groupBy({
        by: ['patientId'],
        _count: { id: true },
        _max: { createdAt: true },
      }),
    ]);
    const byPatient = new Map(counts.map((c) => [c.patientId, c]));
    return specimens.map((s) => ({
      ...s.patient,
      specimenCount: byPatient.get(s.patient.id)?._count.id ?? 0,
      lastSpecimenDate: byPatient.get(s.patient.id)?._max.createdAt ?? null,
    }));
  }

  // Phase 3: Processing Steps
  async updateProcessingStep(id: string, step: string, notes?: string, performedBy?: string) {
    const validSteps = ['FIXATION', 'EMBEDDING', 'SECTIONING', 'STAINING', 'MOUNTING'];
    if (!validSteps.includes(step)) {
      throw new BadRequestException(`Invalid step. Must be one of: ${validSteps.join(', ')}`);
    }

    const specimen = await this.prisma.pathologySpecimen.findUnique({ where: { id } });
    if (!specimen) throw new NotFoundException('Specimen not found');
    if (specimen.status !== 'PROCESSING' && specimen.status !== 'RECEIVED') {
      throw new BadRequestException('Specimen must be in RECEIVED or PROCESSING status');
    }

    // 처리단계 실 기록(clinicalInfo 오염 제거) + 검체 상태 PROCESSING 전이
    const [, updated] = await this.prisma.$transaction([
      this.prisma.pathologyProcessingStep.create({ data: { specimenId: id, step, notes: notes ?? null, performedBy: performedBy ?? null } }),
      this.prisma.pathologySpecimen.update({
        where: { id },
        data: { status: 'PROCESSING' },
        include: {
          patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
          processingSteps: { orderBy: { performedAt: 'asc' } },
        },
      }),
    ]);
    return updated;
  }

  /** 검체 처리단계 이력 조회 */
  async getProcessingSteps(specimenId: string) {
    return this.prisma.pathologyProcessingStep.findMany({ where: { specimenId }, orderBy: { performedAt: 'asc' } });
  }

  // Phase 4: TAT Stats
  async getTatStats() {
    const specimens = await this.prisma.pathologySpecimen.findMany({
      where: { status: { in: ['REPORTED', 'SIGNED', 'AMENDED'] } },
      select: {
        collectedAt: true,
        createdAt: true,
        priority: true,
        report: { select: { reportedAt: true } },
      },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });

    const tats = specimens.map((s) => {
      const start = s.collectedAt || s.createdAt;
      const end = s.report?.reportedAt || new Date();
      return {
        hours: (end.getTime() - start.getTime()) / 3600000,
        priority: s.priority,
      };
    });

    const calcAvg = (arr: { hours: number }[]) =>
      arr.length ? Math.round((arr.reduce((s, t) => s + t.hours, 0) / arr.length) * 100) / 100 : 0;

    const calcMedian = (arr: { hours: number }[]) => {
      if (!arr.length) return 0;
      const sorted = arr.map((t) => t.hours).sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return Math.round((sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
    };

    const routine = tats.filter((t) => t.priority === 'ROUTINE');
    const urgent = tats.filter((t) => t.priority === 'URGENT');
    const frozen = tats.filter((t) => t.priority === 'FROZEN');

    return {
      overall: { avg: calcAvg(tats), median: calcMedian(tats), count: tats.length },
      routine: { avg: calcAvg(routine), target: 120, count: routine.length },
      urgent: { avg: calcAvg(urgent), target: 24, count: urgent.length },
      frozen: { avg: calcAvg(frozen), target: 0.5, count: frozen.length },
      exceedCount: tats.filter((t) => {
        if (t.priority === 'FROZEN') return t.hours > 0.5;
        if (t.priority === 'URGENT') return t.hours > 24;
        return t.hours > 120;
      }).length,
    };
  }

  // Phase 5: Department Stats
  async getStatsByDepartment() {
    const specimens = await this.prisma.pathologySpecimen.findMany({
      include: { collector: { select: { department: true } } },
      where: { createdAt: { gte: new Date(Date.now() - 30 * 86400000) } },
    });

    const byDept: Record<string, number> = {};
    specimens.forEach((s) => {
      const dept = s.collector?.department || '기타';
      byDept[dept] = (byDept[dept] || 0) + 1;
    });

    return Object.entries(byDept)
      .map(([department, count]) => ({ department, count }))
      .sort((a, b) => b.count - a.count);
  }

  // Phase 5: Slide Management
  async addSlide(specimenId: string, slide: { blockNo: string; slideNo: string; stainType: string }) {
    const specimen = await this.prisma.pathologySpecimen.findUnique({ where: { id: specimenId } });
    if (!specimen) throw new NotFoundException('Specimen not found');

    let info: Record<string, unknown> = {};
    try { info = JSON.parse(specimen.clinicalInfo || '{}'); } catch { info = { text: specimen.clinicalInfo }; }
    if (!Array.isArray(info.slides)) info.slides = [];
    (info.slides as unknown[]).push({ ...slide, createdAt: new Date().toISOString() });

    return this.prisma.pathologySpecimen.update({
      where: { id: specimenId },
      data: { clinicalInfo: JSON.stringify(info) },
    });
  }

  async getSlides(specimenId: string) {
    const specimen = await this.prisma.pathologySpecimen.findUnique({ where: { id: specimenId } });
    if (!specimen) throw new NotFoundException('Specimen not found');
    try {
      const info = JSON.parse(specimen.clinicalInfo || '{}');
      return info.slides || [];
    } catch { return []; }
  }

  // Phase 6: Report Images — 🔴 (2026-09-15 P16) 종전엔 아무것도 저장하지 않고 "이미지 메타데이터 저장 완료"를 돌려줬다.
  //    PathologyReport 에 이미지 컬럼·연결 모델이 없다(schema) — 저장한 척하지 않고 저장되지 않았다고 말한다.
  //    받은 값을 그대로 되돌려주지도 않는다(되돌리면 호출자가 "기록된 값"으로 읽는다).
  async addReportImage(reportId: string, _image: { filename: string; description: string; magnification?: string }) {
    const report = await this.prisma.pathologyReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found');

    return { reportId, recorded: false as const, reason: 'NOT_PERSISTED' as const, recordedAt: null };
  }

  // Phase 7: QC Stats
  async getQcStats() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    const [total, amended, recheck] = await Promise.all([
      this.prisma.pathologySpecimen.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.pathologySpecimen.count({ where: { status: 'AMENDED', createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.pathologyReport.count({ where: { addendum: { not: null }, createdAt: { gte: thirtyDaysAgo } } }),
    ]);

    return {
      period: '30일',
      totalSpecimens: total,
      amendedCount: amended,
      amendRate: total > 0 ? ((amended / total) * 100).toFixed(1) : '0',
      recheckCount: recheck,
      recheckRate: total > 0 ? ((recheck / total) * 100).toFixed(1) : '0',
    };
  }

  // Phase 6-7: Diagnosis Distribution
  async getStatsByDiagnosis() {
    const reports = await this.prisma.pathologyReport.findMany({
      where: { diagnosis: { not: null } },
      select: { diagnosis: true, diagnosisCode: true },
      take: 500,
      orderBy: { reportedAt: 'desc' },
    });

    const categories = { benign: 0, malignant: 0, premalignant: 0, other: 0 };
    reports.forEach((r) => {
      const code = r.diagnosisCode || '';
      if (code.startsWith('C')) categories.malignant++;
      else if (code.startsWith('D0') || code.startsWith('D1')) categories.premalignant++;
      else if (code.startsWith('D') || code.startsWith('K') || code.startsWith('N')) categories.benign++;
      else categories.other++;
    });

    return { total: reports.length, categories };
  }
}
