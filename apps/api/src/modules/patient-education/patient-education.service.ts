import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { EducationSource } from '@hospital-run/shared';
import { CreateEducationRecordDto } from './dto/patient-education.dto';

/** 다른 기록에서 모아 보이는 교육(읽기 전용) 한 줄 */
export interface RelatedEducation {
  source: Exclude<EducationSource, 'RECORD'>;
  id: string;
  at: Date;
  byName: string | null;
  label: string | null;
  content: string;
}

const RELATED_CAP = 50;
const FUTURE_SLACK_MS = 5 * 60_000;

/**
 * 환자 교육 기록(2026-09-30) — 기획 `docs/01-plan/features/patient-education-record.plan.md`.
 *  · 원장: `patient_education_records`(지우지 않고 무효 처리)
 *  · 한 환자의 교육 보기는 이 원장 + **이미 다른 곳에 적힌 교육**(복약상담·영양상담·간호기록 E·퇴원요약)을 출처와 함께 모은다.
 *    🔴 한 출처 조회가 실패해도 나머지를 보이되, 실패를 "없음"으로 접지 않는다(`sourceErrors`).
 */
@Injectable()
export class PatientEducationService {
  constructor(private readonly prisma: PrismaService) {}

  private async userNames(ids: (string | null | undefined)[]) {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, familyName: true, givenName: true } });
    return new Map(users.map((u) => [u.id, `${u.familyName ?? ''}${u.givenName ?? ''}`]));
  }

  async list(patientId: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('Patient not found');
    const records = await this.prisma.patientEducationRecord.findMany({ where: { patientId }, orderBy: { educatedAt: 'desc' }, take: 500 });

    const sources: { source: RelatedEducation['source']; load: () => Promise<RelatedEducation[]> }[] = [
      { source: 'PHARMACY_COUNSEL', load: async () => (await this.prisma.dispensingCounsel.findMany({
          where: { patientId }, orderBy: { counseledAt: 'desc' }, take: RELATED_CAP,
          select: { id: true, counseledAt: true, counselType: true, content: true, pharmacist: { select: { familyName: true, givenName: true } } },
        })).map((c) => ({ source: 'PHARMACY_COUNSEL' as const, id: c.id, at: c.counseledAt, byName: c.pharmacist ? `${c.pharmacist.familyName ?? ''}${c.pharmacist.givenName ?? ''}` : null, label: c.counselType, content: c.content })) },
      { source: 'NUTRITION_COUNSEL', load: async () => (await this.prisma.nutritionCounsel.findMany({
          where: { patientId }, orderBy: { counseledAt: 'desc' }, take: RELATED_CAP,
          select: { id: true, counseledAt: true, topic: true, content: true, counselor: { select: { familyName: true, givenName: true } } },
        })).map((c) => ({ source: 'NUTRITION_COUNSEL' as const, id: c.id, at: c.counseledAt, byName: c.counselor ? `${c.counselor.familyName ?? ''}${c.counselor.givenName ?? ''}` : null, label: c.topic, content: c.content })) },
      { source: 'NURSING_NOTE', load: async () => (await this.prisma.nursingNote.findMany({
          where: { admission: { patientId }, education: { not: null }, NOT: { education: '' } }, orderBy: { recordedAt: 'desc' }, take: RELATED_CAP,
          select: { id: true, recordedAt: true, education: true, nurse: { select: { familyName: true, givenName: true } } },
        })).map((n) => ({ source: 'NURSING_NOTE' as const, id: n.id, at: n.recordedAt, byName: n.nurse ? `${n.nurse.familyName ?? ''}${n.nurse.givenName ?? ''}` : null, label: null, content: n.education ?? '' })) },
      { source: 'DISCHARGE_SUMMARY', load: async () => (await this.prisma.dischargeSummary.findMany({
          where: { admission: { patientId }, patientEducation: { not: null }, NOT: { patientEducation: '' } }, orderBy: { createdAt: 'desc' }, take: RELATED_CAP,
          select: { id: true, createdAt: true, patientEducation: true, status: true },
        })).map((d) => ({ source: 'DISCHARGE_SUMMARY' as const, id: d.id, at: d.createdAt, byName: null, label: d.status, content: d.patientEducation ?? '' })) },
    ];
    const settled = await Promise.allSettled(sources.map((s) => s.load()));
    const related: RelatedEducation[] = [];
    const sourceErrors: { source: RelatedEducation['source']; message: string }[] = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') related.push(...r.value);
      else sourceErrors.push({ source: sources[i].source, message: r.reason instanceof Error ? r.reason.message : String(r.reason) });
    });
    related.sort((a, b) => b.at.getTime() - a.at.getTime());

    const names = await this.userNames([...records.map((r) => r.educatorId), ...records.map((r) => r.voidedById)]);
    return {
      records: records.map((r) => ({ ...r, educatorName: names.get(r.educatorId) ?? null, voidedByName: r.voidedById ? names.get(r.voidedById) ?? null : null })),
      related,
      relatedCapPerSource: RELATED_CAP,
      sourceErrors,
    };
  }

  async create(patientId: string, dto: CreateEducationRecordDto, userId: string, now: Date = new Date()) {
    const content = (dto.content ?? '').trim();
    if (!content) throw new BadRequestException({ code: 'EDUCATION_CONTENT_REQUIRED', message: 'Education content is required' });
    const educatedAt = new Date(dto.educatedAt);
    if (Number.isNaN(educatedAt.getTime())) throw new BadRequestException({ code: 'EDUCATION_TIME_INVALID', message: 'educatedAt is not a valid time' });
    if (educatedAt.getTime() > now.getTime() + FUTURE_SLACK_MS) {
      throw new BadRequestException({ code: 'EDUCATION_TIME_FUTURE', message: 'educatedAt cannot be in the future' });
    }
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('Patient not found');
    if (dto.encounterId) {
      const enc = await this.prisma.encounter.findUnique({ where: { id: dto.encounterId }, select: { patientId: true } });
      if (!enc || enc.patientId !== patientId) throw new BadRequestException({ code: 'EDUCATION_ENCOUNTER_MISMATCH', message: 'Encounter does not belong to this patient' });
    }
    // 재원 중이면 그 입원에 붙인다(퇴원 준비가 입원 단위로 센다) — 사실에서 파생, 화면이 고르지 않는다
    const adm = await this.prisma.admission.findFirst({ where: { patientId, status: 'ADMITTED' }, orderBy: { admitDate: 'desc' }, select: { id: true } });
    const methods = dto.methods?.length ? [...new Set(dto.methods)] : undefined;
    return this.prisma.patientEducationRecord.create({
      data: {
        patientId,
        admissionId: adm?.id ?? null,
        encounterId: dto.encounterId ?? null,
        topic: dto.topic,
        content,
        learner: dto.learner,
        learnerNote: dto.learnerNote?.trim() || null,
        methods: methods ?? undefined,
        understanding: dto.understanding ?? null,
        barriers: dto.barriers?.trim() || null,
        followUpNeeded: dto.followUpNeeded ?? null,
        educatedAt,
        educatorId: userId,
      },
    });
  }

  /** 무효 처리 — 지우지 않는다. 기록한 사람 또는 관리자만 · 사유 필수 */
  async void(patientId: string, recordId: string, userId: string, role: string, reasonRaw: string) {
    const reason = (reasonRaw ?? '').trim();
    if (!reason) throw new BadRequestException({ code: 'EDUCATION_VOID_REASON_REQUIRED', message: 'A reason is required to void a record' });
    const rec = await this.prisma.patientEducationRecord.findUnique({ where: { id: recordId } });
    if (!rec || rec.patientId !== patientId) throw new NotFoundException('Education record not found');
    if (rec.voidedAt) return { ...rec, alreadyVoided: true };
    if (rec.educatorId !== userId && role !== 'ADMIN') {
      throw new ForbiddenException({ code: 'EDUCATION_VOID_NOT_ALLOWED', message: 'Only the educator or an administrator can void this record' });
    }
    // 조건부 — 동시에 무효 처리된 것을 덮지 않는다
    await this.prisma.patientEducationRecord.updateMany({ where: { id: recordId, voidedAt: null }, data: { voidedAt: new Date(), voidedById: userId, voidReason: reason } });
    const after = await this.prisma.patientEducationRecord.findUnique({ where: { id: recordId } });
    return { ...after, alreadyVoided: false };
  }
}
