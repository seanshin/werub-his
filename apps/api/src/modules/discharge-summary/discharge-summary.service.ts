import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { DiagnosisPoaService } from './diagnosis-poa.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AdmissionNotFoundError, DischargeSummaryExistsError,
  DischargeSummaryNotFoundError, DischargeAlreadySignedError,
} from '../../domain/errors/domain-error';
import { CreateDischargeSummaryDto } from './dto/create-discharge-summary.dto';
import { ChronicService } from '../chronic/chronic.service';
import { recordBlockchainSignature } from '../../common/util/blockchain-signature';
import { preserveSignedVersion } from '../him/signed-record-version';

/** date-only 컬럼 — 비교는 날짜 문자열로(시각 차이를 '정정'으로 세지 않는다) */
const DS_DATE_FIELDS = new Set(['admitDate', 'dischargeDate', 'followUpDate']);
const dsNorm = (f: string, v: unknown) =>
  v == null ? null : v instanceof Date ? (DS_DATE_FIELDS.has(f) ? v.toISOString().slice(0, 10) : v.toISOString()) : typeof v === 'object' ? JSON.stringify(v) : v;

/** 서명본 대비 실제로 바뀐 퇴원요약 항목 */
export function dischargeChangedFields(existing: Record<string, unknown>, data: Record<string, unknown>): string[] {
  return Object.keys(data).filter((f) => dsNorm(f, data[f]) !== dsNorm(f, existing[f]));
}

@Injectable()
export class DischargeSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chronic: ChronicService,
    @Optional() private readonly poa?: DiagnosisPoaService,
  ) {}

  async create(admissionId: string, dto: CreateDischargeSummaryDto, doctorId: string) {
    const admission = await this.prisma.admission.findUnique({ where: { id: admissionId } });
    if (!admission) throw new AdmissionNotFoundError(admissionId);

    const existing = await this.prisma.dischargeSummary.findUnique({ where: { admissionId } });
    if (existing) throw new DischargeSummaryExistsError(admissionId);

    return this.prisma.dischargeSummary.create({
      data: {
        admissionId,
        doctorId,
        admitDate: new Date(dto.admitDate),
        dischargeDate: new Date(dto.dischargeDate),
        admitDiagnosis: dto.admitDiagnosis,
        dischargeDiagnosis: dto.dischargeDiagnosis,
        diagnosisCodes: dto.diagnosisCodes as unknown as Prisma.InputJsonValue,
        hospitalCourse: dto.hospitalCourse,
        procedures: dto.procedures,
        significantFindings: dto.significantFindings,
        conditionAtDischarge: dto.conditionAtDischarge,
        dischargeMedications: dto.dischargeMedications as unknown as Prisma.InputJsonValue,
        followUpPlan: dto.followUpPlan,
        followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : undefined,
        dietaryInstructions: dto.dietaryInstructions,
        activityRestrictions: dto.activityRestrictions,
        patientEducation: dto.patientEducation,
      },
      include: this.defaultInclude(),
    });
  }

  async findByAdmission(admissionId: string) {
    const summary = await this.prisma.dischargeSummary.findUnique({
      where: { admissionId },
      include: this.defaultInclude(),
    });
    if (!summary) throw new DischargeSummaryNotFoundError(admissionId);
    return summary;
  }

  async update(admissionId: string, dto: Partial<CreateDischargeSummaryDto>, userId?: string | null) {
    const existing = await this.prisma.dischargeSummary.findUnique({ where: { admissionId }, include: { admission: { select: { patientId: true } } } });
    if (!existing) throw new DischargeSummaryNotFoundError(admissionId);
    // 🔴 (2026-09-15 B10) 바꿀 항목 없이 부르면 서명된 요약이 **내용 변경 없이 AMENDED(수정됨)** 로 뒤집혔다 — 하지 않은 수정을 기록하지 않는다
    if (Object.keys(this.buildUpdateData(dto)).length === 0) {
      throw new BadRequestException({ code: 'DISCHARGE_SUMMARY_NO_CHANGE', message: '바꿀 항목이 없습니다' });
    }
    if (existing.status === 'SIGNED') {
      // SIGNED → AMENDED 전환 — 🔴 직전 서명본을 같은 트랜잭션에 보존한다(종전엔 덮어써 정정 전 내용·원 서명 시각·서명자 소실)
      const data = this.buildUpdateData(dto) as Record<string, unknown>;
      const changed = dischargeChangedFields(existing as unknown as Record<string, unknown>, data);
      // 같은 값을 다시 보내면 정정이 아니다 — 서명본을 그대로 둔다
      if (changed.length === 0) return this.prisma.dischargeSummary.findUnique({ where: { admissionId }, include: this.defaultInclude() });
      const { id: _id, admissionId: _a, status: _s, signedAt, signedBy, createdAt: _c, updatedAt: _u, admission, ...content } = existing as typeof existing & { admission: { patientId: string } };
      return this.prisma.$transaction(async (tx) => {
        await preserveSignedVersion(tx, {
          patientId: admission.patientId, recordType: 'DISCHARGE_SUMMARY', recordId: existing.id,
          signedAt, signedBy, content: content as Record<string, unknown>,
          supersededBy: userId ?? null, changedFields: changed, reason: (dto as { amendmentReason?: string }).amendmentReason ?? null,
        });
        return tx.dischargeSummary.update({
          where: { admissionId },
          data: { ...this.buildUpdateData(dto), status: 'AMENDED' },
          include: this.defaultInclude(),
        });
      });
    }

    return this.prisma.dischargeSummary.update({
      where: { admissionId },
      data: this.buildUpdateData(dto),
      include: this.defaultInclude(),
    });
  }

  async sign(admissionId: string, doctorId: string, blockchainSignature?: {
    certificateId: string;
    signatureValue: string;
    signatureAlgorithm: string;
    documentHash: string;
  }) {
    const existing = await this.prisma.dischargeSummary.findUnique({
      where: { admissionId },
      include: { admission: { select: { patientId: true } } },
    });
    if (!existing) throw new DischargeSummaryNotFoundError(admissionId);
    if (existing.status === 'SIGNED') throw new DischargeAlreadySignedError();
    // 진단별 POA — 결정 safety.poaFlag 가 필수로 정했을 때만 빈 진단을 말하며 거부(2026-10-09)
    await this.poa?.assertReadyToSign(admissionId);

    // 퇴원약 오더화(2026-09-30) — 처방 원장에 퇴원약이 있으면 서명 순간의 목록을 요약에 박는다(서명된 문서가 가리키는 약).
    //   없으면 요약의 기존 값을 건드리지 않는다(옛 자유 기재 보존 — 처방이 아닌 글자를 지우지도 지어내지도 않는다).
    const structured = await this.dischargeMedSnapshot(admissionId);
    const result = await this.prisma.dischargeSummary.update({
      where: { admissionId },
      data: {
        status: 'SIGNED', signedAt: new Date(), signedBy: doctorId,
        ...(structured.length > 0 ? { dischargeMedications: structured as unknown as Prisma.InputJsonValue } : {}),
      },
      include: this.defaultInclude(),
    });

    // Blockchain signature (non-blocking)
    if (blockchainSignature) {
      try {
        await recordBlockchainSignature(this.prisma, blockchainSignature, {
          documentType: 'DISCHARGE_SUMMARY',
          documentId: existing.id,
          patientId: existing.admission?.patientId,
          signerUserId: doctorId,
        });
} catch (e) {
        console.error('Blockchain signature failed (non-blocking):', e);
      }
    }

    return result;
  }

  /**
   * 처방 원장의 활성 퇴원약 → 요약·포털이 읽는 모양. `name`(요약 정본 키)과 `drugName`(포털 키)을 함께 싣는다 —
   * 🔴 포털 복약 설명은 `drugName` 을 찾는데 프리필은 `name` 을 적어 본인 퇴원약 확인이 늘 실패했다.
   */
  private async dischargeMedSnapshot(admissionId: string) {
    const rows = await this.prisma.prescription.findMany({
      where: { type: 'MEDICATION', dischargeMed: true, status: 'ACTIVE', encounter: { admissionId } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, dosage: true, frequency: true, duration: true, quantity: true, route: true, dispensingType: true, medicationCode: { select: { code: true, nameKo: true } } },
    });
    return rows.map((m) => ({
      prescriptionId: m.id,
      code: m.medicationCode?.code ?? null,
      name: m.medicationCode?.nameKo ?? null,
      drugName: m.medicationCode?.nameKo ?? null,
      dosage: m.dosage, frequency: m.frequency, duration: m.duration, quantity: m.quantity, route: m.route,
      dispensingType: m.dispensingType,
    }));
  }

  async prefill(admissionId: string) {
    const admission = await this.prisma.admission.findUnique({
      where: { id: admissionId },
      include: {
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
    });
    if (!admission) throw new AdmissionNotFoundError(admissionId);

    // 입원 기간 진단 취합
    const encounters = await this.prisma.encounter.findMany({
      where: { patientId: admission.patientId, createdAt: { gte: admission.admitDate } },
      include: { diagnoses: { include: { diagnosisCode: { select: { code: true, nameKo: true } } } } },
      orderBy: { createdAt: 'asc' },
    });

    const diagnosisCodes = encounters.flatMap(e =>
      e.diagnoses.map(d => ({ code: d.diagnosisCode.code, name: d.diagnosisCode.nameKo, type: d.type })),
    );

    // 입원 기간 수술 기록
    const surgeries = await this.prisma.surgery.findMany({
      where: { patientId: admission.patientId, admissionId: admissionId },
      select: { procedureName: true, procedureCode: true, startedAt: true, status: true },
    });

    // 주요 검사결과 취합
    const labResults = await this.prisma.labResult.findMany({
      where: {
        patientId: admission.patientId,
        status: 'COMPLETED',
        completedAt: { gte: admission.admitDate },
      },
      include: { items: true },
      orderBy: { completedAt: 'desc' },
      take: 10,
    });

    const significantFindings = labResults.flatMap(lr =>
      lr.items
        .filter((item) => item.flag && item.flag !== 'N')
        .map((item) => `${item.testName}: ${item.value} ${item.unit} (${item.flag})`),
    ).join('\n') || null;

    // 퇴원약 — 처방 원장의 퇴원약이 정본(2026-09-30). 없으면 입원 중 활성 약을 **참고로만** 싣고 출처를 밝힌다
    //   (🔴 종전엔 입원 중 약을 그대로 "퇴원약"이라 불렀다 — 퇴원 때 끊을 수액·주사까지)
    const structured = await this.dischargeMedSnapshot(admissionId);
    const activeMeds = structured.length > 0 ? [] : await this.prisma.prescription.findMany({
      where: {
        encounter: { patientId: admission.patientId },
        type: 'MEDICATION',
        status: 'ACTIVE',
        dischargeMed: false,
        createdAt: { gte: admission.admitDate },
      },
      include: { medicationCode: { select: { code: true, nameKo: true } } },
    });

    return {
      admitDate: admission.admitDate,
      dischargeDate: admission.dischargeDate ?? new Date(),
      admitDiagnosis: admission.admitReason ?? '',
      diagnosisCodes,
      procedures: surgeries.map(s => `${s.procedureName} (${s.procedureCode ?? ''})`).join(', ') || null,
      significantFindings,
      dischargeMedications: structured.length > 0 ? structured : activeMeds.map(m => ({
        code: m.medicationCode?.code,
        name: m.medicationCode?.nameKo,
        dosage: m.dosage,
        frequency: m.frequency,
        duration: m.duration,
      })),
      // ORDERS = 처방 원장의 퇴원약 · INPATIENT_ACTIVE = 입원 중 약(퇴원약 처방이 아니다 — 참고) · null = 없음
      dischargeMedicationsSource: structured.length > 0 ? 'ORDERS' : activeMeds.length > 0 ? 'INPATIENT_ACTIVE' : null,
      // P2b — 만성질환 경과 자동초안(SoT 파생, hospitalCourse 보조). 의사 검토·수정·서명.
      chronicCourse: (await this.chronic.getProblemNarrative(admission.patientId)).text || null,
      patient: admission.patient,
    };
  }

  private buildUpdateData(dto: Partial<CreateDischargeSummaryDto>) {
    const data: Prisma.DischargeSummaryUncheckedUpdateInput = {};
    if (dto.admitDate) data.admitDate = new Date(dto.admitDate);
    if (dto.dischargeDate) data.dischargeDate = new Date(dto.dischargeDate);
    if (dto.admitDiagnosis !== undefined) data.admitDiagnosis = dto.admitDiagnosis;
    if (dto.dischargeDiagnosis !== undefined) data.dischargeDiagnosis = dto.dischargeDiagnosis;
    if (dto.diagnosisCodes !== undefined) data.diagnosisCodes = dto.diagnosisCodes;
    if (dto.hospitalCourse !== undefined) data.hospitalCourse = dto.hospitalCourse;
    if (dto.procedures !== undefined) data.procedures = dto.procedures;
    if (dto.significantFindings !== undefined) data.significantFindings = dto.significantFindings;
    if (dto.conditionAtDischarge !== undefined) data.conditionAtDischarge = dto.conditionAtDischarge;
    if (dto.dischargeMedications !== undefined) data.dischargeMedications = dto.dischargeMedications;
    if (dto.followUpPlan !== undefined) data.followUpPlan = dto.followUpPlan;
    if (dto.followUpDate) data.followUpDate = new Date(dto.followUpDate);
    if (dto.dietaryInstructions !== undefined) data.dietaryInstructions = dto.dietaryInstructions;
    if (dto.activityRestrictions !== undefined) data.activityRestrictions = dto.activityRestrictions;
    if (dto.patientEducation !== undefined) data.patientEducation = dto.patientEducation;
    return data;
  }

  private defaultInclude() {
    return {
      doctor: { select: { id: true, familyName: true, givenName: true } },
      admission: { select: { id: true, patientId: true, status: true } },
    };
  }
}
