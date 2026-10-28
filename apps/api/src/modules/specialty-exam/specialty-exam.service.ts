import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { calcBmi } from '../vitals/vitals-evaluate';
import type {
  CreateEmergencyExamDto,
  CreateFamilyMedExamDto,
  CreatePediatricExamDto,
  CreateRehabExamDto,
} from './dto/specialty-exam.dto';

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * 가정의학 건강검진 묶음(JsonB) — 🔴 (2026-10-10) 화면이 `toFixed(1)` 로 만든 BMI 문자열을 그대로 저장했다.
 * 체중(kg)·신장(cm)에서 서버가 다시 계산하고, 둘 중 하나라도 없으면 BMI 는 null(화면 값을 남기지 않는다).
 * 나머지 칸은 원문 보존.
 */
export function familyMedCheckup(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const c = raw as Record<string, unknown>;
  return { ...c, bmi: calcBmi(numOrNull(c.weight), numOrNull(c.height)) ?? null };
}

@Injectable()
export class SpecialtyExamService {
  constructor(private readonly prisma: PrismaService) {}

  createEmergency(dto: CreateEmergencyExamDto, examinedBy: string) {
    // ktasLevel은 triage에서 파생하되, 직접 전달값 우선
    const triage = dto.triage as { ktasLevel?: number } | undefined;
    return this.prisma.emergencyExam.create({
      data: {
        patientId: dto.patientId,
        encounterId: dto.encounterId,
        ktasLevel: dto.ktasLevel ?? triage?.ktasLevel,
        triage: dto.triage as never,
        assessment: dto.assessment as never,
        treatment: dto.treatment as never,
        progressNotes: dto.progressNotes as never,
        disposition: dto.disposition as never,
        examinedBy,
      },
    });
  }

  createFamilyMed(dto: CreateFamilyMedExamDto, examinedBy: string) {
    return this.prisma.familyMedExam.create({
      data: {
        patientId: dto.patientId,
        encounterId: dto.encounterId,
        soap: dto.soap as never,
        vitals: dto.vitals as never,
        checkup: familyMedCheckup(dto.checkup) as never,
        lifestyle: dto.lifestyle as never,
        screenings: dto.screenings as never,
        examinedBy,
      },
    });
  }

  createPediatric(dto: CreatePediatricExamDto, examinedBy: string) {
    return this.prisma.pediatricExam.create({
      data: {
        patientId: dto.patientId,
        encounterId: dto.encounterId,
        ageMonths: dto.ageMonths,
        gender: dto.gender,
        weight: dto.weight,
        height: dto.height,
        headCircumference: dto.headCircumference,
        // 🔴 (2026-10-10) 화면이 보낸 BMI 를 그대로 저장했다 — 체중·신장에서 서버가 계산(BMI 정본 calcBmi) · 보낸 값은 무시
        bmi: calcBmi(dto.weight, dto.height) ?? null,
        developmentalAssessment: dto.developmentalAssessment as never,
        immunizations: dto.immunizations as never,
        findings: dto.findings,
        examinedBy,
      },
    });
  }

  createRehab(dto: CreateRehabExamDto, examinedBy: string) {
    return this.prisma.rehabExam.create({
      data: {
        patientId: dto.patientId,
        encounterId: dto.encounterId,
        soap: dto.soap as never,
        functionalAssessment: dto.functionalAssessment as never,
        therapyPlans: dto.therapyPlans as never,
        examinedBy,
      },
    });
  }
}
