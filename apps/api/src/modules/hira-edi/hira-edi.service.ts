import { Injectable, NotFoundException, BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { resolveEdiCodes } from './edi-code';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { requireHospitalIdentityForSubmission } from '../config/hospital-facts';
import {
  HIRA_CHANNEL,
  HIRA_DOC_STATUS,
  HIRA_SUBMITTABLE_STATUSES,
  canRegenerateHiraDocument,
  classifyHiraTransmission,
  localReceiptNo,
  notTransmittedNote,
  transmitToHira,
  type HiraTransmissionInfo,
} from './hira-transmission';
import { decryptLegacyPid } from '../../common/crypto/legacy-pid-crypto';

@Injectable()
export class HiraEdiService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 명세서 생성 — 입원 EDI 청구 P2 정합 재작성(inpatient-edi-claim.plan.md 결정 #1·#6·#7).
   * 구버전 결함 해소: ①비존재 필드(category/ediCode) 필터로 항목 분리가 항상 공집합 ②급여율 0.7 하드코딩
   * ③진단 소스 비존재 관계(claim.diagnoses) ④입원 재원기간 미반영·기관정보 하드코딩·면허 공란.
   * - 항목 분리: BillingItem.codeType(PROCEDURE|MEDICATION|MATERIAL) + codeId→마스터 union 해석으로 실 EDI 코드
   * - 금액: Billing 정본(totalAmount/insuranceCovered/patientCopay — eligibility 반영분) 사용
   * - 입원(INPATIENT·admissionId 有): **Admission 단위 합산 명세서** — 재원 내 전 Billing 항목·재원기간·전 encounter 진단
   * - 진단: EncounterDiagnosis(PRIMARY 우선·rank순) → KCD 코드
   * - 기관/의사: config hospital.code/name·doctor.licenseNumber
   */
  async generateDocument(claimId: string, userId: string) {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: {
        patient: {
          select: {
            id: true, mrn: true, familyName: true, givenName: true,
            insuranceType: true, insuranceNumber: true,
          },
        },
        billing: {
          include: {
            items: true,
            encounter: {
              include: {
                doctor: { select: { id: true, familyName: true, givenName: true, department: true } },
              },
            },
          },
        },
      },
    });
    if (!claim) throw new NotFoundException('Claim not found');

    const baseBilling = claim.billing;
    const encounter = baseBilling?.encounter;
    const patient = claim.patient;
    const doctor = encounter?.doctor;
    if (!baseBilling || !encounter) throw new BadRequestException('청구에 연결된 수납/진료 정보가 없습니다');

    const isInpatient = (encounter.visitType === 'INPATIENT' || encounter.visitType === 'INPATIENT_CONSULT') && !!encounter.admissionId;
    const claimType = isInpatient ? 'INPATIENT' : 'OUTPATIENT';

    // ── 범위 확정: 입원=Admission 단위 합산 / 외래=해당 Billing 단독 ──
    let billingItems: (typeof baseBilling.items)[number][] = baseBilling.items;
    let totals = { total: baseBilling.totalAmount, insurance: baseBilling.insuranceCovered, patient: baseBilling.patientCopay };
    let treatmentFrom: Date = encounter.createdAt;
    let treatmentTo: Date = encounter.createdAt;
    let encounterIds: string[] = [encounter.id];

    if (isInpatient && encounter.admissionId) {
      const admission = await this.prisma.admission.findUnique({
        where: { id: encounter.admissionId },
        select: { admitDate: true, dischargeDate: true },
      });
      const encs = await this.prisma.encounter.findMany({ where: { admissionId: encounter.admissionId }, select: { id: true } });
      encounterIds = encs.map((e) => e.id);
      // 🔴 (2026-10-14 수납·청구 결함 발굴 P2-6) 종전엔 상태를 보지 않아 취소·환불·미수납 수납까지 합산했다 —
      //    청구 대상은 정본 청구 생성과 같이 수납 완료(PAID)만.
      const billings = await this.prisma.billing.findMany({
        where: { encounterId: { in: encounterIds }, status: 'PAID' },
        include: { items: true },
      });
      // 🔴 (P2-6) 입원 명세서는 입원 전체를 합산한다 — 같은 입원의 다른 청구로 이미 만든 명세서가 있으면
      //    또 만들면 같은 진료비가 N 번 청구된다. 반려된 명세서만 다시 만들 수 있다.
      const dup = await this.prisma.hiraClaimDocument.findFirst({
        where: { documentType: 'INPATIENT', status: { not: 'REJECTED' }, claim: { billing: { encounterId: { in: encounterIds } } } },
        select: { id: true, claimId: true },
      });
      if (dup) {
        throw new ConflictException({ code: 'EDI_ADMISSION_ALREADY_DOCUMENTED', message: '이 입원은 이미 입원 명세서가 있습니다 — 입원 명세서는 입원 전체를 합산하므로 한 번만 만듭니다', details: dup });
      }
      billingItems = billings.flatMap((b) => b.items);
      totals = {
        total: billings.reduce((s, b) => s + b.totalAmount, 0),
        insurance: billings.reduce((s, b) => s + b.insuranceCovered, 0),
        patient: billings.reduce((s, b) => s + b.patientCopay, 0),
      };
      treatmentFrom = admission?.admitDate ?? encounter.createdAt;
      treatmentTo = admission?.dischargeDate ?? new Date();
    }

    // ── EDI 코드 해석: codeId → 수가/약가 마스터 union(견고 — codeType 라우팅 비의존) · 정본 `resolveEdiCodes` ──
    // 🔴 (P2-2) 종전엔 못 찾은 코드를 내부 UUID 로 폴백해 명세서에 실었다 — 지어내지 않고 거부한다(어느 항목인지 밝힌다).
    const ediCodeOf = await resolveEdiCodes(this.prisma, billingItems.map((i) => i.codeId));
    const unresolved = billingItems.filter((i) => !ediCodeOf.has(i.codeId)).map((i) => i.codeName);
    if (unresolved.length) {
      throw new UnprocessableEntityException({ code: 'EDI_CODE_UNRESOLVED', message: '청구 코드를 찾을 수 없는 항목이 있어 명세서를 만들지 않습니다', details: { unresolved } });
    }

    const toLine = (i: (typeof billingItems)[number]) => ({
      ediCode: ediCodeOf.get(i.codeId) as string, // 위에서 전부 해석됨을 확인했다
      name: i.codeName,
      qty: i.quantity,
      unitPrice: i.unitPrice,
      amount: i.amount,
      days: 1,
    });
    const procedures = billingItems.filter((i) => i.codeType === 'PROCEDURE').map(toLine);
    const medications = billingItems.filter((i) => i.codeType === 'MEDICATION').map(toLine);
    const materials = billingItems.filter((i) => i.codeType === 'MATERIAL').map(toLine);
    const nonCovered = billingItems.filter((i) => i.insuranceCategory === 'NON_COVERED').reduce((s, i) => s + i.amount, 0);

    // ── 진단(KCD): EncounterDiagnosis — PRIMARY 우선·rank순 ──
    const encDx = await this.prisma.encounterDiagnosis.findMany({
      where: { encounterId: { in: encounterIds } },
      include: { diagnosisCode: { select: { code: true, nameKo: true } } },
      orderBy: [{ type: 'asc' }, { rank: 'asc' }], // PRIMARY < SECONDARY (사전순 우연 일치·명시 정렬 아래 재정렬)
    });
    const dxSeen = new Set<string>();
    const diagnoses = encDx
      .sort((a, b) => (a.type === 'PRIMARY' ? 0 : 1) - (b.type === 'PRIMARY' ? 0 : 1) || a.rank - b.rank)
      .filter((d) => { const k = d.diagnosisCode.code; if (dxSeen.has(k)) return false; dxSeen.add(k); return true; })
      .map((d) => ({ code: d.diagnosisCode.code, name: d.diagnosisCode.nameKo, type: d.type }));

    // ── 기관/의사 정보: config·면허 실값(면허번호는 Staff 소관 — User↔Staff는 userId 링크) ──
    const doctorStaff = doctor
      ? await this.prisma.staff.findUnique({ where: { userId: doctor.id }, select: { licenseNumber: true } })
      : null;
    // 🔴 대외 제출물이다 — 기관 식별은 DB 행만, 비었으면 명세서를 만들지 않는다(422 · 누락 키는 details.missing).
    //    종전 `config.get(...).catch(() => null) ?? 'Hospital RUN'/'12345678'` 은 조회 실패도 미설정도 날조값으로 메웠고,
    //    `get()` 자체가 DEFAULTS 플레이스홀더('Hospital RUN 병원'·'12345678')로 떨어져 폴백에 닿기 전부터 가짜였다.
    const inst = await requireHospitalIdentityForSubmission(this.prisma, ['hospital.code', 'hospital.name'] as const);
    const facilityCode = inst['hospital.code'];
    const facilityName = inst['hospital.name'];

    const ediData = {
      header: { facilityCode, facilityName, claimType },
      patient: {
        name: `${patient.familyName}${patient.givenName}`,
        mrn: patient.mrn,
        insuranceType: patient.insuranceType || 'NHI',
        insuranceNumber: decryptLegacyPid(patient.insuranceNumber),
      },
      treatment: {
        from: treatmentFrom.toISOString().slice(0, 10),
        to: treatmentTo.toISOString().slice(0, 10),
        ...(isInpatient ? { stayDays: Math.max(1, Math.ceil((treatmentTo.getTime() - treatmentFrom.getTime()) / 86400_000)) } : {}),
        department: doctor?.department ?? '',
        doctorName: doctor ? `${doctor.familyName}${doctor.givenName}` : '',
        doctorLicense: doctorStaff?.licenseNumber ?? '',
      },
      diagnoses,
      procedures,
      medications,
      ...(materials.length ? { materials } : {}),
      totals: { total: totals.total, insurance: totals.insurance, patient: totals.patient, nonCovered },
    };

    return this.prisma.hiraClaimDocument.create({
      data: {
        claimId,
        patientId: patient.id,
        documentType: claimType,
        ediVersion: '1.1', // P2 정합 재작성판
        ediData: ediData as unknown as Prisma.JsonObject,
        treatmentFrom,
        treatmentTo,
        totalAmount: totals.total,
        insuranceAmount: totals.insurance,
        patientAmount: totals.patient,
        diagnosisCodes: diagnoses as unknown as Prisma.JsonArray,
        procedures: procedures as unknown as Prisma.JsonArray,
        medications: medications as unknown as Prisma.JsonArray,
        materials: materials.length ? (materials as unknown as Prisma.JsonArray) : Prisma.JsonNull,
        status: 'DRAFT',
        createdBy: userId,
      },
    });
  }

  /**
   * 🔴 C1 — 읽는 쪽에서 전송 여부를 판정해 붙인다(저장값 변조 없음).
   * 운영에 남은 status=SUBMITTED 건도 전송 채널이 존재한 적 없으므로 '전송 근거 없음'으로 읽힌다.
   * 접수번호는 스키마에 컬럼이 없어 `ediData.transmission.receiptNo`(원내 번호)에 둔다.
   */
  private decorate<T extends { status: string; submittedAt?: Date | null; ediData?: unknown }>(
    doc: T,
  ): T & { transmission: HiraTransmissionInfo; receiptNo: string | null } {
    const tx = (doc.ediData as { transmission?: { receiptNo?: string } } | null)?.transmission ?? null;
    const receiptNo = tx?.receiptNo ?? null;
    return {
      ...doc,
      receiptNo,
      transmission: classifyHiraTransmission({ status: doc.status, submittedAt: doc.submittedAt, receiptNo }),
    };
  }

  async getDocument(id: string) {
    const doc = await this.prisma.hiraClaimDocument.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        claim: { select: { id: true, claimNumber: true, status: true } },
      },
    });
    if (!doc) throw new NotFoundException('EDI document not found');
    return this.decorate(doc);
  }

  async getDocuments(filters: {
    status?: string;
    patientId?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const where: Prisma.HiraClaimDocumentWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.patientId) where.patientId = filters.patientId;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(filters.dateFrom);
      if (filters.dateTo) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(filters.dateTo + 'T23:59:59Z');
    }

    const docs = await this.prisma.hiraClaimDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
        claim: { select: { id: true, claimNumber: true, status: true } },
      },
    });
    return docs.map((d) => this.decorate(d));
  }

  async validateDocument(id: string) {
    const doc = await this.prisma.hiraClaimDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('EDI document not found');

    const ediData = doc.ediData as Record<string, unknown>;
    const errors: string[] = [];

    const header = ediData.header as Record<string, unknown> | undefined;
    if (!header?.facilityCode) errors.push('시설 코드 누락');

    const patient = ediData.patient as Record<string, unknown> | undefined;
    if (!patient?.name) errors.push('환자 이름 누락');
    if (!patient?.insuranceNumber) errors.push('보험 번호 누락');

    const treatment = ediData.treatment as Record<string, unknown> | undefined;
    if (!treatment?.from) errors.push('진료 시작일 누락');
    if (!treatment?.doctorLicense) errors.push('의사 면허번호 누락');

    const totals = ediData.totals as Record<string, number> | undefined;
    if (!totals || totals.total <= 0) errors.push('청구 금액이 0 이하');
    if (totals && totals.insurance + totals.patient !== totals.total) {
      errors.push('보험자부담 + 본인부담 합계 불일치');
    }

    const diagnoses = ediData.diagnoses as Array<Record<string, unknown>> | undefined;
    if (!diagnoses || diagnoses.length === 0) errors.push('진단 코드 누락');

    const status = errors.length === 0 ? 'VALIDATED' : 'DRAFT';

    return this.prisma.hiraClaimDocument.update({
      where: { id },
      data: {
        validationErrors: errors.length > 0 ? errors : Prisma.JsonNull,
        status,
      },
    });
  }

  /**
   * 🔴 C1 봉합 — 종전 이 메서드는 `status:'SUBMITTED'` · `submittedAt: new Date()` 를 **적기만** 했다.
   * 심평원으로 나가는 전송 코드는 존재한 적이 없는데 화면은 '제출됨'을 보여줬다(전송을 흉내낸 것).
   * 이제 실제 전송을 시도하고(`transmitToHira`), 미구축이면 **원내 접수(LOCAL_RECORDED)** 로만 적는다:
   *  - `submittedAt: null` (모르는 시각은 원장에 박지 않는다)
   *  - 접수번호 `LOCAL-HIRA-…` (기관 부여 번호가 아님을 접두어로 드러낸다)
   *  - 미전송이므로 **재제출 가능**(HIRA_SUBMITTABLE_STATUSES 에 LOCAL_RECORDED 포함)
   */
  async submitDocument(id: string) {
    const doc = await this.prisma.hiraClaimDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('EDI document not found');
    if (!HIRA_SUBMITTABLE_STATUSES.includes(doc.status)) {
      throw new BadRequestException(
        doc.status === 'DRAFT'
          ? '문서가 검증되지 않았습니다. 먼저 유효성 검증을 실행하세요.'
          : `제출할 수 없는 상태입니다(${doc.status}).`,
      );
    }

    const now = new Date();
    const result = await transmitToHira(doc.ediData);
    const prevEdi = (doc.ediData ?? {}) as Prisma.JsonObject;

    if (result.outcome === 'SENT') {
      const ediData = {
        ...prevEdi,
        transmission: {
          channel: HIRA_CHANNEL.key,
          outcome: 'SENT',
          receiptNo: result.externalRef ?? null,
          transmittedAt: (result.at ?? now).toISOString(),
        },
      } as unknown as Prisma.JsonObject;
      return this.decorate(
        await this.prisma.hiraClaimDocument.update({
          where: { id },
          data: { status: HIRA_DOC_STATUS.SUBMITTED, submittedAt: result.at ?? now, ediData },
        }),
      );
    }

    const failed = result.outcome === 'FAILED';
    const receiptNo = failed ? null : localReceiptNo(now);
    const ediData = {
      ...prevEdi,
      transmission: {
        channel: HIRA_CHANNEL.key,
        outcome: result.outcome,
        receiptNo,
        recordedAt: now.toISOString(),
        note: notTransmittedNote(now, result.reason),
        manualFallback: HIRA_CHANNEL.manualFallback,
      },
    } as unknown as Prisma.JsonObject;

    return this.decorate(
      await this.prisma.hiraClaimDocument.update({
        where: { id },
        data: {
          status: failed ? HIRA_DOC_STATUS.SEND_FAILED : HIRA_DOC_STATUS.LOCAL_RECORDED,
          submittedAt: null, // 🔴 나가지 않았으므로 제출 시각을 적지 않는다
          ediData,
        },
      }),
    );
  }

  async recordResponse(id: string, responseData: Record<string, unknown>) {
    const doc = await this.prisma.hiraClaimDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('EDI document not found');

    const status = responseData.status as string;
    if (!['ACCEPTED', 'REJECTED', 'ADJUSTED'].includes(status)) {
      throw new BadRequestException('유효한 응답 상태: ACCEPTED, REJECTED, ADJUSTED');
    }

    return this.decorate(
      await this.prisma.hiraClaimDocument.update({
        where: { id },
        data: {
          status,
          responseData: responseData as unknown as Prisma.JsonObject,
          responseAt: new Date(),
        },
      }),
    );
  }

  async getStats() {
    const byStatus = await this.prisma.hiraClaimDocument.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    const allDocs = await this.prisma.hiraClaimDocument.findMany({
      select: { ediData: true, status: true, submittedAt: true },
    });

    let totalAmount = 0;
    let insuranceAmount = 0;
    let patientAmount = 0;
    let transmittedCount = 0;
    let notTransmittedCount = 0;

    for (const doc of allDocs) {
      const ediData = doc.ediData as Record<string, unknown>;
      const totals = ediData?.totals as Record<string, number> | undefined;
      if (totals) {
        totalAmount += totals.total || 0;
        insuranceAmount += totals.insurance || 0;
        patientAmount += totals.patient || 0;
      }
      // 🔴 C1 — '제출됨' 카운트가 실제 전송을 뜻하지 않는다. 전송 근거 유무로 다시 센다.
      const tx = classifyHiraTransmission({
        status: doc.status,
        submittedAt: doc.submittedAt,
        receiptNo: (ediData?.transmission as { receiptNo?: string } | undefined)?.receiptNo ?? null,
      });
      if (tx.transmitted) transmittedCount++;
      else notTransmittedCount++;
    }

    return {
      byStatus: byStatus.reduce(
        (acc, s) => ({ ...acc, [s.status]: s._count.id }),
        {} as Record<string, number>,
      ),
      totalAmount,
      insuranceAmount,
      patientAmount,
      // 🔴 전송 실태 — 채널 미구축인 동안 transmittedCount 는 0 이다(초록 배지 금지).
      channel: { key: HIRA_CHANNEL.key, name: HIRA_CHANNEL.name, implemented: HIRA_CHANNEL.implemented, manualFallback: HIRA_CHANNEL.manualFallback },
      transmittedCount,
      notTransmittedCount,
    };
  }

  /**
   * 🔴 C1 — 종전 `SUBMITTED`(실은 미전송)까지 무조건 차단해 **나가지도 않은 명세서를 영구히
   * 고칠 수 없게** 만들었다. 전송 근거가 없는 건은 재생성할 수 있어야 한다
   * (심사결과가 기록된 ACCEPTED/ADJUSTED 만 사람 판단 영역으로 남긴다).
   */
  async regenerate(id: string) {
    const doc = await this.prisma.hiraClaimDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('EDI document not found');
    if (!canRegenerateHiraDocument(doc.status)) {
      throw new BadRequestException('심사결과가 기록된 문서는 재생성할 수 없습니다.');
    }

    return this.generateDocument(doc.claimId, doc.createdBy);
  }
}
