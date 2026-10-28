import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { buildMedicationSearchWhere } from '../../common/medication-search';
import {
  CreateDiagnosisCodeDto,
  UpdateDiagnosisCodeDto,
  CreateMedicationCodeDto,
  UpdateMedicationCodeDto,
  SearchCodeDto,
  DrugInteractionCheckDto,
  DURCheckDto,
  ContraindicationCheckDto,
  InteractionWarningDto,
  DURWarningDto,
  ValidationResultDto,
} from './dto/medical-terminology.dto';

@Injectable()
export class MedicalTerminologyService {
  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // Diagnosis Code Management
  // ============================================================

  async createDiagnosisCode(dto: CreateDiagnosisCodeDto) {
    // Check if code already exists
    const existing = await this.prisma.diagnosisCode.findUnique({
      where: { codeSystem_code: { codeSystem: dto.codeSystem, code: dto.code } },
    });
    if (existing) throw new ConflictException('Diagnosis code already exists');

    return this.prisma.diagnosisCode.create({
      data: {
        codeSystem: dto.codeSystem,
        code: dto.code,
        nameKo: dto.nameKo,
        nameEn: dto.nameEn,
        category: dto.category,
        chapter: dto.chapter,
        parentCode: dto.parentCode,
        icd10Code: dto.icd10Code,
        icd11Code: dto.icd11Code,
        validFrom: new Date(dto.validFrom),
        validTo: dto.validTo ? new Date(dto.validTo) : null,
      },
    });
  }

  async updateDiagnosisCode(id: string, dto: UpdateDiagnosisCodeDto) {
    const code = await this.prisma.diagnosisCode.findUnique({ where: { id } });
    if (!code) throw new NotFoundException('Diagnosis code not found');

    return this.prisma.diagnosisCode.update({
      where: { id },
      data: {
        nameKo: dto.nameKo ?? code.nameKo,
        nameEn: dto.nameEn,
        category: dto.category,
        parentCode: dto.parentCode,
        icd10Code: dto.icd10Code,
        icd11Code: dto.icd11Code,
        isActive: dto.isActive ?? code.isActive,
        validTo: dto.validTo ? new Date(dto.validTo) : code.validTo,
      },
    });
  }

  async deleteDiagnosisCode(id: string) {
    const code = await this.prisma.diagnosisCode.findUnique({ where: { id } });
    if (!code) throw new NotFoundException('Diagnosis code not found');

    // Check if code is in use
    const inUse = await this.prisma.encounterDiagnosis.findFirst({
      where: { diagnosisCodeId: id },
    });
    if (inUse) throw new ConflictException('Diagnosis code is in use');

    return this.prisma.diagnosisCode.delete({ where: { id } });
  }

  async searchDiagnosisCodes(dto: SearchCodeDto) {
    const take = dto.limit || 50;
    const skip = ((dto.page || 1) - 1) * take;

    const where: Prisma.DiagnosisCodeWhereInput = { isActive: true };
    if (dto.codeSystem) where.codeSystem = dto.codeSystem;
    if (dto.category) where.category = dto.category;
    if (dto.keyword) {
      where.OR = [{ code: { contains: dto.keyword } }, { nameKo: { contains: dto.keyword } }];
    }

    const [results, total] = await Promise.all([
      this.prisma.diagnosisCode.findMany({ where, take, skip, orderBy: { code: 'asc' } }),
      this.prisma.diagnosisCode.count({ where }),
    ]);

    return { results, total, page: dto.page || 1, limit: take };
  }

  async getDiagnosisCodeDetail(id: string) {
    const code = await this.prisma.diagnosisCode.findUnique({
      where: { id },
      include: {
        encounterDiagnoses: { take: 5 },
        problemLists: { take: 5 },
      },
    });
    if (!code) throw new NotFoundException('Diagnosis code not found');
    return code;
  }

  // ============================================================
  // Medication Code Management
  // ============================================================

  async createMedicationCode(dto: CreateMedicationCodeDto) {
    const existing = await this.prisma.medicationCode.findUnique({
      where: { code: dto.code },
    });
    if (existing) throw new ConflictException('Medication code already exists');

    return this.prisma.medicationCode.create({
      data: {
        code: dto.code,
        nameKo: dto.nameKo,
        nameEn: dto.nameEn,
        ingredient: dto.ingredient,
        manufacturer: dto.manufacturer,
        dosageForm: dto.dosageForm,
        unit: dto.unit,
        insuranceCode: dto.insuranceCode,
        unitPrice: dto.unitPrice,
        validFrom: new Date(dto.validFrom),
        validTo: dto.validTo ? new Date(dto.validTo) : null,
      },
    });
  }

  async updateMedicationCode(id: string, dto: UpdateMedicationCodeDto) {
    const med = await this.prisma.medicationCode.findUnique({ where: { id } });
    if (!med) throw new NotFoundException('Medication code not found');

    return this.prisma.medicationCode.update({
      where: { id },
      data: {
        nameKo: dto.nameKo ?? med.nameKo,
        nameEn: dto.nameEn,
        ingredient: dto.ingredient,
        manufacturer: dto.manufacturer,
        dosageForm: dto.dosageForm,
        unit: dto.unit,
        insuranceCode: dto.insuranceCode,
        unitPrice: dto.unitPrice ?? med.unitPrice,
        isActive: dto.isActive ?? med.isActive,
        validTo: dto.validTo ? new Date(dto.validTo) : med.validTo,
      },
    });
  }

  async deleteMedicationCode(id: string) {
    const med = await this.prisma.medicationCode.findUnique({ where: { id } });
    if (!med) throw new NotFoundException('Medication code not found');

    const inUse = await this.prisma.prescription.findFirst({
      where: { medicationCodeId: id },
    });
    if (inUse) throw new ConflictException('Medication code is in use');

    return this.prisma.medicationCode.delete({ where: { id } });
  }

  async searchMedicationCodes(dto: SearchCodeDto) {
    const take = dto.limit || 50;
    const skip = ((dto.page || 1) - 1) * take;

    // 한/영 병용 P1(D2): 공용 빌더 — 영문 성분·nameEn 질의도 매칭
    const where: Prisma.MedicationCodeWhereInput = { isActive: true, ...buildMedicationSearchWhere(dto.keyword ?? '') };

    const [results, total] = await Promise.all([
      this.prisma.medicationCode.findMany({ where, take, skip, orderBy: { code: 'asc' } }),
      this.prisma.medicationCode.count({ where }),
    ]);

    return { results, total, page: dto.page || 1, limit: take };
  }

  async getMedicationCodeDetail(id: string) {
    const med = await this.prisma.medicationCode.findUnique({
      where: { id },
      include: {
        prescriptions: { take: 5 },
        dispensingItems: { take: 5 },
      },
    });
    if (!med) throw new NotFoundException('Medication code not found');
    return med;
  }

  // ============================================================
  // Drug Interaction Validation
  // ============================================================

  async checkDrugInteractions(dto: DrugInteractionCheckDto): Promise<ValidationResultDto> {
    // Validate all medication codes exist
    const meds = await this.prisma.medicationCode.findMany({
      where: { code: { in: dto.medicationCodes } },
    });

    if (meds.length !== dto.medicationCodes.length) {
      throw new BadRequestException('One or more medication codes not found');
    }

    const warnings: InteractionWarningDto[] = [];

    // Check pairwise interactions
    for (let i = 0; i < dto.medicationCodes.length; i++) {
      for (let j = i + 1; j < dto.medicationCodes.length; j++) {
        const interaction = await this.findInteraction(
          dto.medicationCodes[i],
          dto.medicationCodes[j],
        );
        if (interaction) {
          warnings.push(interaction);
        }
      }
    }

    return {
      isValid: warnings.filter(w => w.severity === 'CONTRAINDICATED').length === 0,
      warnings,
    };
  }

  private async findInteraction(
    code1: string,
    code2: string,
  ): Promise<InteractionWarningDto | null> {
    // Mock interactions for common drug pairs
    const interactionMap: Record<string, InteractionWarningDto> = {
      'WARFARIN:ASPIRIN': {
        severity: 'HIGH',
        interactingDrug1: 'WARFARIN',
        interactingDrug2: 'ASPIRIN',
        description: 'Increased bleeding risk with concurrent use',
        recommendation: 'Monitor bleeding parameters regularly',
      },
      'METFORMIN:CONTRAST': {
        severity: 'CONTRAINDICATED',
        interactingDrug1: 'METFORMIN',
        interactingDrug2: 'CONTRAST',
        description: 'Risk of lactic acidosis with iodinated contrast',
        recommendation: 'Hold metformin before contrast procedures',
      },
      'ACE_INHIBITOR:POTASSIUM': {
        severity: 'MODERATE',
        interactingDrug1: 'ACE_INHIBITOR',
        interactingDrug2: 'POTASSIUM',
        description: 'Risk of hyperkalemia',
        recommendation: 'Monitor serum potassium levels',
      },
    };

    const key1 = `${code1}:${code2}`;
    const key2 = `${code2}:${code1}`;
    return interactionMap[key1] || interactionMap[key2] || null;
  }

  // ============================================================
  // DUR (Drug Utilization Review) Check
  // ============================================================

  async checkDUR(dto: DURCheckDto): Promise<ValidationResultDto> {
    const med = await this.prisma.medicationCode.findUnique({
      where: { code: dto.medicationCode },
    });
    if (!med) throw new NotFoundException('Medication code not found');

    const warnings: DURWarningDto[] = [];

    // DUR Rule 1: Maximum prescription days
    if (dto.prescriptionDays && dto.prescriptionDays > 90) {
      warnings.push({
        ruleCode: 'DUR001',
        ruleName: '장기처방 제한',
        severity: 'WARNING',
        description: 'Prescription exceeds 90 days maximum',
        recommendation: 'Review necessity of extended prescription',
      });
    }

    // DUR Rule 2: Elderly patients
    if (dto.patientAge && dto.patientAge > 65) {
      warnings.push({
        ruleCode: 'DUR002',
        ruleName: '고령자 용량 확인',
        severity: 'WARNING',
        description: 'Consider dose reduction for elderly patients',
        recommendation: 'Verify dose appropriateness for age group',
      });
    }

    // DUR Rule 3: Renal impairment
    if (dto.egfr && dto.egfr < 30) {
      warnings.push({
        ruleCode: 'DUR003',
        ruleName: '신기능 저하 약물 조정',
        severity: 'ERROR',
        description: 'Dose adjustment needed for severe renal impairment',
        recommendation: 'Reduce dose by 50% or use alternative',
      });
    }

    return {
      isValid: warnings.filter(w => w.severity === 'ERROR').length === 0,
      warnings,
    };
  }

  // ============================================================
  // Contraindication Check
  // ============================================================

  async checkContraindications(dto: ContraindicationCheckDto): Promise<ValidationResultDto> {
    const med = await this.prisma.medicationCode.findUnique({
      where: { code: dto.medicationCode },
    });
    const diagnosis = await this.prisma.diagnosisCode.findUnique({
      where: { id: dto.diagnosisCode },
    });

    if (!med) throw new NotFoundException('Medication code not found');
    if (!diagnosis) throw new NotFoundException('Diagnosis code not found');

    const warnings: InteractionWarningDto[] = [];

    // Contraindication rules
    const contraindicationRules: Record<string, boolean> = {
      'ACE_INHIBITOR:PREGNANCY': dto.isPregnant === true,
      'NSAID:RENAL_DISEASE': diagnosis.code.startsWith('N18'),
      'WARFARIN:HEMORRHAGE': diagnosis.code.includes('HEMORRHAGE'),
    };

    for (const [rule, isContraindicated] of Object.entries(contraindicationRules)) {
      if (isContraindicated) {
        const [drug, condition] = rule.split(':');
        warnings.push({
          severity: 'CONTRAINDICATED',
          interactingDrug1: drug,
          interactingDrug2: condition,
          description: `${dto.medicationCode} is contraindicated in ${condition}`,
          recommendation: 'Use alternative medication',
        });
      }
    }

    return {
      isValid: warnings.length === 0,
      warnings,
    };
  }

  // ============================================================
  // Bulk Operations
  // ============================================================

  async importDiagnosisCodes(codes: CreateDiagnosisCodeDto[]) {
    const created = [];
    const errors = [];

    for (const code of codes) {
      try {
        const result = await this.createDiagnosisCode(code);
        created.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ code: code.code, error: message });
      }
    }

    return { created: created.length, errors };
  }

  async importMedicationCodes(codes: CreateMedicationCodeDto[]) {
    const created = [];
    const errors = [];

    for (const code of codes) {
      try {
        const result = await this.createMedicationCode(code);
        created.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ code: code.code, error: message });
      }
    }

    return { created: created.length, errors };
  }
}
