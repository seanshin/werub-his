import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { todayDateOnly } from '../../common/day-range';
import { withAdvisoryLock } from '../../common/util/advisory-lock';
import { irbValidityOf, ymdOf, IrbValidity } from './irb-validity';
import type {
  AddIrbAmendmentDto,
  AddResearchDocumentDto,
  AddResearchSubjectDto,
  CreateResearchStudyDto,
  ReviewIrbAmendmentDto,
  UpdateResearchStudyDto,
  UpdateResearchSubjectDto,
} from './research.dto';

/** 심의 대기(= 아직 결정이 나지 않은) IRB 상태 */
const PENDING_IRB_STATUSES = ['SUBMITTED', 'UNDER_REVIEW'];
/** 대상자 등록이 살아있지 않은 상태 — 등록 현황의 '활성' 계수에서 뺀다 */
const INACTIVE_SUBJECT_STATUSES = ['WITHDRAWN', 'SCREEN_FAILURE'];

export interface StaffRef {
  id: string;
  familyName: string;
  givenName: string;
  department: string | null;
}

/**
 * 등록 현황의 **정본 표기**.
 *
 * 🔴 같은 응답이 `subjectCount:0` 과 `currentEnroll:500` 을 동시에 반환하던 것을 봉합한다(P12 — 정본이 둘).
 *    `research_subjects` 행 수는 검증 가능한 사실이고 `current_enroll` 은 파생 카운터다.
 *    카운터를 임의로 덮어쓰지 않는다(과거 기록 변조 금지) — 대신 **불일치 사실 자체를 화면에 넘긴다.**
 */
interface EnrollFacts {
  /** research_subjects 실계수 — 사실 */
  subjectCount: number;
  /** 철회·스크리닝실패를 뺀 계수 */
  activeSubjectCount: number;
  /** current_enroll 저장 카운터 — 참고값 */
  storedEnroll: number;
  /** 저장 카운터가 실계수와 다른가 */
  enrollMismatch: boolean;
}

@Injectable()
export class ResearchService {
  constructor(private readonly prisma: PrismaService) {}

  /* ───────── Studies ───────── */

  async findAll(filters: Record<string, unknown>) {
    const where: Record<string, unknown> = {};
    if (filters.department) where.department = filters.department;
    if (filters.irbStatus) where.irbStatus = filters.irbStatus;
    if (filters.studyType) where.studyType = filters.studyType;
    if (filters.piUserId) where.piUserId = filters.piUserId;

    const studies = await this.prisma.researchStudy.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const enroll = await this.enrollFactsOf(studies.map((s) => s.id));
    // 🔴 책임연구자 열이 통째로 공백이던 원인 — piUserId(UUID)만 내려보내고 User 조인이 없었다.
    //    ResearchStudy.piUserId 에는 relation 이 없어 include 가 불가능하므로 배치 조회로 채운다(N+1 금지).
    const staff = await this.resolveStaff(studies.map((s) => s.piUserId));

    return studies.map((s) => ({
      ...s,
      ...this.enrollOf(enroll, s),
      pi: staff.get(s.piUserId) ?? null,
      irbValidity: irbValidityOf(s),
    }));
  }

  async create(data: CreateResearchStudyDto, userId: string) {
    const title = String(data.title ?? '').trim();
    if (!title) throw new BadRequestException('연구 제목은 필수입니다');
    if (!data.department) throw new BadRequestException('진료과는 필수입니다');
    if (!data.studyType) throw new BadRequestException('연구 유형은 필수입니다');

    // 🔴 종전엔 등록 폼의 '연구책임자' 입력이 버려지고 무조건 등록자가 PI 였다.
    //    타인을 PI 로 지정할 수 있게 하되, 실존 계정인지 확인한다(없는 사람을 책임자로 앉히지 않는다).
    const piUserId = await this.resolvePiUserId(data.piUserId, userId);

    const year = new Date().getFullYear();
    // 채번 원자화 — studyNo @unique 동시 생성 충돌(P2002) 방지
    return withAdvisoryLock(this.prisma, `irb-study:${year}`, async (tx) => {
      const count = await tx.researchStudy.count({
        where: { studyNo: { startsWith: `IRB-${year}-` } },
      });
      const studyNo = `IRB-${year}-${String(count + 1).padStart(3, '0')}`;
      return tx.researchStudy.create({
        data: {
          studyNo,
          title,
          piUserId,
          department: data.department as string,
          studyType: data.studyType as string,
          phase: (data.phase as string) ?? null,
          sponsor: (data.sponsor as string) ?? null,
          targetEnroll: (data.targetEnroll as number) ?? null,
          startDate: data.startDate ? new Date(data.startDate as string) : null,
          endDate: data.endDate ? new Date(data.endDate as string) : null,
          description: (data.description as string) ?? null,
          protocol: data.protocol !== undefined ? (data.protocol as object) : undefined,
        },
      });
    });
  }

  async findOne(id: string) {
    const study = await this.prisma.researchStudy.findUnique({
      where: { id },
      include: {
        subjects: { include: { patient: { select: { id: true, familyName: true, givenName: true, dateOfBirth: true } } } },
        documents: { orderBy: { uploadedAt: 'desc' } },
        amendments: { orderBy: { amendmentNo: 'desc' } },
      },
    });
    if (!study) throw new NotFoundException('연구를 찾을 수 없습니다');

    const subjects = study.subjects ?? [];
    const staff = await this.resolveStaff([
      study.piUserId,
      ...(study.documents ?? []).map((d) => d.uploadedBy),
    ]);

    return {
      ...study,
      // 상세도 목록과 같은 정본을 쓴다 — 두 화면이 다른 등록 수를 말하면 안 된다
      subjectCount: subjects.length,
      activeSubjectCount: subjects.filter((s) => !INACTIVE_SUBJECT_STATUSES.includes(s.status)).length,
      storedEnroll: study.currentEnroll,
      enrollMismatch: subjects.length !== study.currentEnroll,
      pi: staff.get(study.piUserId) ?? null,
      irbValidity: irbValidityOf(study),
      // 업로더도 UUID 그대로 흘려보내지 않는다
      documents: (study.documents ?? []).map((d) => ({ ...d, uploader: staff.get(d.uploadedBy) ?? null })),
    };
  }

  async update(id: string, data: UpdateResearchStudyDto) {
    await this.ensureStudyExists(id);
    const updateData: Record<string, unknown> = {};
    const allowedFields = ['title', 'department', 'studyType', 'phase', 'sponsor', 'targetEnroll', 'description', 'protocol'];
    for (const key of allowedFields) {
      const v = (data as Record<string, unknown>)[key];
      if (v !== undefined) updateData[key] = v;
    }
    if (data.startDate) updateData.startDate = new Date(data.startDate as string);
    if (data.endDate) updateData.endDate = new Date(data.endDate as string);
    if (data.irbExpiryDate) updateData.irbExpiryDate = new Date(data.irbExpiryDate as string);

    return this.prisma.researchStudy.update({ where: { id }, data: updateData });
  }

  /**
   * IRB 승인.
   *
   * 🔴 만료일(`irbExpiryDate`)은 **여기서 지어내지 않는다.** 승인 유효기간은 IRB 의결로 정해지는
   *    값(통상 1년이지만 위원회·과제별로 다르고 조건부 승인은 더 짧다)이라 시스템이 +365 를 찍으면
   *    실제 승인서와 다른 날짜가 법정 기록으로 남는다. 심의 결과에 적힌 날짜를 받아서 저장하고,
   *    받지 못하면 비워둔 채 화면이 '만료일 미등록'이라고 말하게 한다(irb-validity.ts).
   */
  async approve(id: string, opts?: { irbExpiryDate?: string | null }) {
    const study = await this.ensureStudyExists(id);
    if (!PENDING_IRB_STATUSES.includes(study.irbStatus)) {
      throw new BadRequestException(`현재 상태(${study.irbStatus})에서는 승인할 수 없습니다`);
    }

    const data: Record<string, unknown> = { irbStatus: 'APPROVED', irbApprovalDate: todayDateOnly() };
    if (opts?.irbExpiryDate) {
      const expiry = new Date(opts.irbExpiryDate);
      if (Number.isNaN(expiry.getTime())) throw new BadRequestException('만료일 형식이 올바르지 않습니다');
      const approvalYmd = ymdOf(new Date())!;
      const expiryYmd = ymdOf(expiry)!;
      if (expiryYmd <= approvalYmd) {
        throw new BadRequestException('만료일은 승인일보다 뒤여야 합니다');
      }
      data.irbExpiryDate = expiry;
    }

    return this.prisma.researchStudy.update({ where: { id }, data });
  }

  async close(id: string) {
    await this.ensureStudyExists(id);
    return this.prisma.researchStudy.update({
      where: { id },
      data: { irbStatus: 'CLOSED', endDate: todayDateOnly() },
    });
  }

  /* ───────── Subjects ───────── */

  async addSubject(studyId: string, data: AddResearchSubjectDto, userId: string) {
    const study = await this.ensureStudyExists(studyId);
    const patientId = String(data.patientId ?? '').trim();
    if (!patientId) throw new BadRequestException('환자를 선택하세요');
    if (!data.consentDate) throw new BadRequestException('동의일은 필수입니다');
    // 🔴 종전 화면은 'P000001'(MRN) 을 입력받아 보냈고 컬럼은 @db.Uuid 라 등록이 항상 실패했다.
    //    조용한 500 대신 무엇이 틀렸는지 말한다(화면은 환자 검색으로 UUID 를 넘기도록 고쳤다).
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } }).catch(() => null);
    if (!patient) throw new BadRequestException('등록할 환자를 찾을 수 없습니다(환자 검색에서 선택하세요)');

    // 채번 원자화 — subjectNo(연구별 순번) 동시 등록 중복 방지 + 등록수 증가를 한 트랜잭션에
    return withAdvisoryLock(this.prisma, `irb-subject:${studyId}`, async (tx) => {
      const subjectCount = await tx.researchSubject.count({ where: { studyId } });
      const subjectNo = `${study.studyNo}-S${String(subjectCount + 1).padStart(3, '0')}`;
      const subject = await tx.researchSubject.create({
        data: {
          studyId,
          patientId,
          subjectNo,
          consentDate: new Date(data.consentDate as string),
          armGroup: (data.armGroup as string) ?? null,
          enrolledBy: userId,
        },
      });
      await tx.researchStudy.update({
        where: { id: studyId },
        data: { currentEnroll: { increment: 1 } },
      });
      return subject;
    });
  }

  async getSubjects(studyId: string) {
    return this.prisma.researchSubject.findMany({
      where: { studyId },
      include: { patient: { select: { id: true, familyName: true, givenName: true, dateOfBirth: true, gender: true } } },
      orderBy: { subjectNo: 'asc' },
    });
  }

  async updateSubject(id: string, data: UpdateResearchSubjectDto) {
    const subject = await this.prisma.researchSubject.findUnique({ where: { id } });
    if (!subject) throw new NotFoundException('연구 대상자를 찾을 수 없습니다');

    const updateData: Record<string, unknown> = {};
    if (data.status) updateData.status = data.status;
    if (data.armGroup !== undefined) updateData.armGroup = data.armGroup;

    return this.prisma.researchSubject.update({ where: { id }, data: updateData });
  }

  /**
   * 중도탈락 처리.
   * 🔴 사유는 필수다. 종전엔 화면이 사유를 묻지도 않고 `'연구자 판단'` 을 임의로 채워 보냈는데
   *    그마저 필드명 불일치로 서버에 닿지 않아 `withdraw_reason` 이 NULL 로 저장됐다.
   *    탈락 사유는 GCP 상 보고 대상이라 빈 값으로 통과시키지 않는다(fail-closed).
   */
  async withdrawSubject(id: string, reason: string) {
    const subject = await this.prisma.researchSubject.findUnique({ where: { id } });
    if (!subject) throw new NotFoundException('연구 대상자를 찾을 수 없습니다');

    const trimmed = String(reason ?? '').trim();
    if (!trimmed) throw new BadRequestException('중도탈락 사유는 필수입니다');
    if (subject.status === 'WITHDRAWN') {
      throw new BadRequestException('이미 중도탈락 처리된 대상자입니다');
    }

    const updated = await this.prisma.researchSubject.update({
      where: { id },
      data: { status: 'WITHDRAWN', withdrawDate: todayDateOnly(), withdrawReason: trimmed },
    });

    await this.prisma.researchStudy.update({
      where: { id: subject.studyId },
      data: { currentEnroll: { decrement: 1 } },
    });

    return updated;
  }

  /* ───────── Documents ───────── */

  async addDocument(studyId: string, data: AddResearchDocumentDto, userId: string) {
    await this.ensureStudyExists(studyId);
    // 🔴 종전엔 화면이 {name, type} 만 보내 필수 4필드가 undefined 로 들어가 항상 실패했다.
    //    무엇이 빠졌는지 말해준다(조용한 500 금지).
    const docType = String(data.docType ?? '').trim();
    const version = String(data.version ?? '').trim();
    const fileName = String(data.fileName ?? '').trim();
    const fileUrl = String(data.fileUrl ?? '').trim();
    const missing = [
      !docType && '문서 유형',
      !version && '버전',
      !fileName && '파일명',
      !fileUrl && '파일 경로',
    ].filter(Boolean);
    if (missing.length) throw new BadRequestException(`필수 항목이 없습니다: ${missing.join(', ')}`);

    return this.prisma.researchDocument.create({
      data: { studyId, docType, version, fileName, fileUrl, uploadedBy: userId },
    });
  }

  async getDocuments(studyId: string) {
    const docs = await this.prisma.researchDocument.findMany({
      where: { studyId },
      orderBy: { uploadedAt: 'desc' },
    });
    const staff = await this.resolveStaff(docs.map((d) => d.uploadedBy));
    return docs.map((d) => ({ ...d, uploader: staff.get(d.uploadedBy) ?? null }));
  }

  /* ───────── IRB Reviews (연구별 심의 상태) ───────── */

  /**
   * 연구별 IRB 심의 상태 — **이력 조회용**이지 '예정 심의'가 아니다.
   *
   * 🔴 종전엔 `scheduledDate = irbApprovalDate ?? createdAt` 이었다. 즉 **승인 완료일**을
   *    '심의 예정일'이라는 이름으로 내보내, 7개월 전에 끝난 승인이 주간 캘린더에 '예정'으로 떴다.
   *    스키마에 IRB 개최일 필드가 없으므로 **없는 예정일을 만들어내지 않고** 제출일/승인일/만료일을
   *    각자의 이름으로 내보낸다. 진짜 예정 심의는 `getIrbCalendar()`(SUBMITTED/UNDER_REVIEW)가 정본이다.
   */
  async getIrbReviews() {
    const studies = await this.prisma.researchStudy.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, studyNo: true, title: true, department: true, studyType: true, irbStatus: true, irbApprovalDate: true, irbExpiryDate: true, createdAt: true },
    });
    return studies.map((s) => ({
      id: s.id,
      studyId: s.id,
      studyNo: s.studyNo,
      studyTitle: s.title,
      department: s.department,
      studyType: s.studyType,
      // 연구 자체(초기 심의)의 상태 — 변경심의는 IrbAmendment 가 따로 관리한다
      reviewType: 'INITIAL' as const,
      irbStatus: s.irbStatus,
      submittedAt: s.createdAt,
      approvalDate: s.irbApprovalDate,
      expiryDate: s.irbExpiryDate,
      irbValidity: irbValidityOf(s),
      // 결정이 난 것만 결과를 말한다 — 심의 중인 건에 결과를 붙이지 않는다
      result: s.irbStatus === 'APPROVED' ? 'APPROVED' : s.irbStatus === 'REJECTED' ? 'REJECTED' : null,
    }));
  }

  /* ───────── Amendments ───────── */

  async getAmendments(studyId: string) {
    await this.ensureStudyExists(studyId);
    return this.prisma.irbAmendment.findMany({ where: { studyId }, orderBy: { amendmentNo: 'desc' } });
  }

  async addAmendment(studyId: string, data: AddIrbAmendmentDto) {
    await this.ensureStudyExists(studyId);
    // 🔴 화면이 {version, description} 만 보내 필수 reason 이 undefined 로 들어가 항상 실패했다.
    const reason = String(data.reason ?? '').trim();
    if (!reason) throw new BadRequestException('변경 사유는 필수입니다');

    const lastAmendment = await this.prisma.irbAmendment.findFirst({
      where: { studyId },
      orderBy: { amendmentNo: 'desc' },
    });
    const amendmentNo = (lastAmendment?.amendmentNo ?? 0) + 1;

    return this.prisma.irbAmendment.create({
      data: {
        studyId,
        amendmentNo,
        reason,
        changes: (data.changes as object) ?? {},
      },
    });
  }

  async updateAmendment(id: string, data: ReviewIrbAmendmentDto) {
    const amendment = await this.prisma.irbAmendment.findUnique({ where: { id } });
    if (!amendment) throw new NotFoundException('변경 신청을 찾을 수 없습니다');

    const status = data.status as string;
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      throw new BadRequestException('status는 APPROVED 또는 REJECTED만 가능합니다');
    }

    return this.prisma.irbAmendment.update({
      where: { id },
      data: { status, reviewedAt: new Date(), reviewNote: (data.reviewNote as string) ?? null },
    });
  }

  /* ───────── Data 추출 ───────── */

  /**
   * 연구용 대상자 명부 추출.
   *
   * 🔴 종전엔 전 대상자에게 **같은 가짜 검사값**(WBC 6200 · Hb 13.5 · BP 120/80 · 날짜 2026-05-01)을
   *    붙여 내보냈다(P15 — 임상 소견 날조). 연구 데이터로 쓰이면 그대로 논문 표가 된다.
   *    EMR 임상값 추출은 아직 배선되지 않았으므로 **가진 사실(명부)만** 내보내고,
   *    임상값이 포함되지 않았다는 사실을 응답에 명시한다.
   */
  async extractData(studyId: string) {
    const study = await this.ensureStudyExists(studyId);
    const subjects = await this.prisma.researchSubject.findMany({
      where: { studyId },
      select: { subjectNo: true, status: true, armGroup: true, consentDate: true, withdrawDate: true },
      orderBy: { subjectNo: 'asc' },
    });
    return {
      studyNo: study.studyNo,
      extractedAt: new Date().toISOString(),
      recordCount: subjects.length,
      /** 🔴 임상 관측치(검사·활력)는 아직 이 경로로 추출되지 않는다 — 있는 척하지 않는다 */
      clinicalDataIncluded: false,
      note: '대상자 명부만 포함됩니다. 검사·활력 등 임상 관측치 추출은 미배선입니다.',
      subjects: subjects.map((s) => ({
        subjectNo: s.subjectNo,
        status: s.status,
        armGroup: s.armGroup,
        consentDate: ymdOf(s.consentDate),
        withdrawDate: ymdOf(s.withdrawDate),
      })),
    };
  }

  /* ───────── Stats / Charts ───────── */

  /**
   * 임상연구 통계.
   *
   * 🔴 두 가지를 동시에 고친다.
   *    1) 형태 계약 — 종전 `byType`/`byStatus` 는 **객체**였는데 화면은 배열로 보고 `.map()` 을 불러
   *       통계 탭이 열자마자 TypeError 로 죽었다(P11). 이제 배열이 계약이다(가드 스펙 고정).
   *    2) 카드 6종 — `totalStudies`·`activeStudies`·`totalSubjects`·`pendingReviews`·
   *       `approvalRate`·`enrollmentRate` 를 화면이 읽는데 서버가 계산하지 않아
   *       "IRB 승인률 undefined%" 가 떴다. 실제로 계산해서 내려보낸다.
   *
   * 🔴 비율은 **분모가 0이면 0이 아니라 null**(산출 불가)이다. 0% 는 "전부 반려됐다"로 읽힌다.
   *    분모를 함께 내려보내 화면이 근거를 말할 수 있게 한다.
   */
  async getStats() {
    const studies = await this.prisma.researchStudy.findMany({
      select: { id: true, studyType: true, irbStatus: true, irbExpiryDate: true, targetEnroll: true, currentEnroll: true },
    });
    const subjects = await this.prisma.researchSubject.findMany({
      select: { studyId: true, status: true, consentDate: true },
    });

    const byTypeMap: Record<string, number> = {};
    const byStatusMap: Record<string, number> = {};
    let expired = 0;
    let expiringSoon = 0;
    let noExpiryOnRecord = 0;
    let approved = 0;
    let rejected = 0;
    let pendingReviews = 0;
    let totalTarget = 0;

    for (const s of studies) {
      byTypeMap[s.studyType] = (byTypeMap[s.studyType] ?? 0) + 1;
      byStatusMap[s.irbStatus] = (byStatusMap[s.irbStatus] ?? 0) + 1;
      if (s.irbStatus === 'APPROVED') approved += 1;
      if (s.irbStatus === 'REJECTED') rejected += 1;
      if (PENDING_IRB_STATUSES.includes(s.irbStatus)) pendingReviews += 1;
      if (s.targetEnroll && s.targetEnroll > 0) totalTarget += s.targetEnroll;

      const v = irbValidityOf(s);
      if (v.state === 'EXPIRED') expired += 1;
      else if (v.state === 'EXPIRING_SOON') expiringSoon += 1;
      else if (v.state === 'NO_EXPIRY_ON_RECORD') noExpiryOnRecord += 1;
    }

    const monthlyMap: Record<string, number> = {};
    let storedEnrollTotal = 0;
    for (const s of studies) storedEnrollTotal += s.currentEnroll ?? 0;
    for (const s of subjects) {
      const key = ymdOf(s.consentDate)?.slice(0, 7);
      if (key) monthlyMap[key] = (monthlyMap[key] ?? 0) + 1;
    }

    const decided = approved + rejected;
    const sortDesc = (a: { count: number }, b: { count: number }) => b.count - a.count;

    return {
      totalStudies: studies.length,
      /** IRB 승인 상태로 진행 중인 연구 — 만료 경과 건수는 irbExpiry 로 따로 말한다 */
      activeStudies: approved,
      /** research_subjects 실계수 — 저장 카운터 합(storedEnrollTotal)과 다를 수 있다 */
      totalSubjects: subjects.length,
      storedEnrollTotal,
      enrollMismatch: subjects.length !== storedEnrollTotal,
      pendingReviews,

      // 🔴 분모 0 → null(산출 불가). 0 으로 내리면 화면이 "승인률 0%" 라고 거짓말한다.
      approvalRate: decided > 0 ? (approved / decided) * 100 : null,
      approvalBasis: { approved, rejected, decided },
      enrollmentRate: totalTarget > 0 ? (subjects.length / totalTarget) * 100 : null,
      enrollmentBasis: { enrolled: subjects.length, target: totalTarget },

      /** 규제 경보 — 만료된 승인으로 연구가 계속되고 있는지 */
      irbExpiry: { expired, expiringSoon, noExpiryOnRecord },

      byType: Object.entries(byTypeMap).map(([type, count]) => ({ type, count })).sort(sortDesc),
      byStatus: Object.entries(byStatusMap).map(([status, count]) => ({ status, count })).sort(sortDesc),
      monthlyEnrollment: Object.entries(monthlyMap)
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    };
  }

  async getEnrollmentChart(studyId: string) {
    await this.ensureStudyExists(studyId);
    const subjects = await this.prisma.researchSubject.findMany({
      where: { studyId },
      select: { consentDate: true },
      orderBy: { consentDate: 'asc' },
    });

    const monthly: Record<string, number> = {};
    let cumulative = 0;
    for (const s of subjects) {
      const key = ymdOf(s.consentDate);
      if (key) monthly[key.slice(0, 7)] = (monthly[key.slice(0, 7)] ?? 0) + 1;
    }

    const chart = Object.entries(monthly).map(([month, count]) => {
      cumulative += count;
      return { month, enrolled: count, cumulative };
    });

    return chart;
  }

  /**
   * 진짜 '예정 심의' — 아직 결정이 나지 않은 연구만.
   * 🔴 스키마에 IRB 개최 예정일이 없다. 그래서 **예정일을 지어내지 않고** 제출일과 대기일수만 말한다.
   *    화면은 이 사실을 그대로 표기해야 한다('심의일 미정').
   */
  async getIrbCalendar() {
    const upcoming = await this.prisma.researchStudy.findMany({
      where: {
        irbStatus: { in: PENDING_IRB_STATUSES },
      },
      select: { id: true, studyNo: true, title: true, irbStatus: true, department: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    const now = Date.now();
    return upcoming.map((s) => ({
      studyId: s.id,
      studyNo: s.studyNo,
      title: s.title,
      status: s.irbStatus,
      department: s.department,
      submittedAt: s.createdAt,
      /** 제출 후 경과일 — 심의 지연을 화면이 볼 수 있게 */
      daysWaiting: Math.max(0, Math.floor((now - new Date(s.createdAt).getTime()) / 86_400_000)),
      /** 🔴 개최 예정일은 시스템에 없는 정보다 */
      scheduledDate: null as string | null,
    }));
  }

  /* ───────── Helpers ───────── */

  private async ensureStudyExists(id: string) {
    const study = await this.prisma.researchStudy.findUnique({ where: { id } });
    if (!study) throw new NotFoundException('연구를 찾을 수 없습니다');
    return study;
  }

  /** UUID → 직원 이름 배치 조회(N+1 금지). piUserId/uploadedBy 에는 relation 이 없다. */
  private async resolveStaff(ids: (string | null | undefined)[]): Promise<Map<string, StaffRef>> {
    const uniq = [...new Set(ids.filter((v): v is string => !!v))];
    if (!uniq.length) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: uniq } },
      select: { id: true, familyName: true, givenName: true, department: true },
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  private async resolvePiUserId(raw: unknown, fallbackUserId: string): Promise<string> {
    const candidate = typeof raw === 'string' ? raw.trim() : '';
    if (!candidate || candidate === fallbackUserId) return fallbackUserId;
    const user = await this.prisma.user
      .findUnique({ where: { id: candidate }, select: { id: true, role: true, isActive: true } })
      .catch(() => null);
    if (!user) throw new BadRequestException('지정한 연구책임자 계정을 찾을 수 없습니다');
    if (!user.isActive) throw new BadRequestException('비활성 계정은 연구책임자로 지정할 수 없습니다');
    return user.id;
  }

  /** 연구별 대상자 실계수(전체/활성) — 등록 현황의 단일 출처 */
  private async enrollFactsOf(studyIds: string[]): Promise<Map<string, { total: number; active: number }>> {
    const out = new Map<string, { total: number; active: number }>();
    if (!studyIds.length) return out;
    const rows = await this.prisma.researchSubject.groupBy({
      by: ['studyId', 'status'],
      where: { studyId: { in: studyIds } },
      _count: { _all: true },
    });
    for (const r of rows as { studyId: string; status: string; _count: { _all: number } }[]) {
      const cur = out.get(r.studyId) ?? { total: 0, active: 0 };
      const n = r._count?._all ?? 0;
      cur.total += n;
      if (!INACTIVE_SUBJECT_STATUSES.includes(r.status)) cur.active += n;
      out.set(r.studyId, cur);
    }
    return out;
  }

  private enrollOf(
    facts: Map<string, { total: number; active: number }>,
    study: { id: string; currentEnroll: number },
  ): EnrollFacts {
    const f = facts.get(study.id) ?? { total: 0, active: 0 };
    return {
      subjectCount: f.total,
      activeSubjectCount: f.active,
      storedEnroll: study.currentEnroll,
      enrollMismatch: f.total !== study.currentEnroll,
    };
  }
}

export type { IrbValidity };
