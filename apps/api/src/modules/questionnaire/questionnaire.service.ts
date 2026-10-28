import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { randomUUID } from 'crypto';

@Injectable()
export class QuestionnaireService {
  private readonly logger = new Logger(QuestionnaireService.name);
  constructor(private readonly prisma: PrismaService) {}

  async generateToken(data: { patientId: string; formSchemaId: string; appointmentId?: string }) {
    const schema = await this.prisma.formSchema.findUnique({ where: { id: data.formSchemaId } });
    if (!schema) throw new NotFoundException('Form schema not found');

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48); // 48시간 유효

    return this.prisma.questionnaireToken.create({
      data: {
        patientId: data.patientId,
        formSchemaId: data.formSchemaId,
        appointmentId: data.appointmentId,
        token: randomUUID(),
        expiresAt,
      },
      include: {
        formSchema: { select: { name: true } },
        patient: { select: { familyName: true, givenName: true } },
      },
    });
  }

  async getByToken(token: string) {
    const qt = await this.prisma.questionnaireToken.findUnique({
      where: { token },
      include: {
        formSchema: true,
        // 🔴 (2026-09-16 I1) 무인증 응답에 환자 내부 id 를 싣지 않는다(화면은 이름만 읽는다 · F4 `PATIENT_FACING_OMIT` 규약)
        patient: { select: { familyName: true, givenName: true } },
      },
    });
    if (!qt) throw new NotFoundException('Invalid questionnaire token');
    if (qt.expiresAt < new Date()) {
      await this.prisma.questionnaireToken.update({ where: { token }, data: { status: 'EXPIRED' } }).catch(() => {});
      throw new BadRequestException('Questionnaire token has expired');
    }
    if (qt.completedAt) throw new BadRequestException('Questionnaire already completed');

    // 최초 열람 시 OPENED 상태 기록
    if (qt.status === 'SENT') {
      await this.prisma.questionnaireToken.update({
        where: { token },
        data: { status: 'OPENED', openedAt: new Date() },
      }).catch(() => {});
    }

    return qt;
  }

  async submit(token: string, formData: Record<string, unknown>) {
    const qt = await this.getByToken(token);

    // 평가도구 점수 자동 계산
    const schema = await this.prisma.formSchema.findUnique({ where: { id: qt.formSchemaId } });
    const schemaData = schema?.schema as Record<string, unknown> | null;
    let scoringResult: { totalScore: number; maxScore: number | null; interpretation: string } | null = null;

    if (schemaData?.scoring) {
      const sections = schemaData.sections as Array<{ fields?: Array<{ key: string }> }> | undefined;
      const fields = (schemaData.fields ?? sections?.flatMap((s) => s.fields ?? []) ?? []) as Array<{ key: string }>;
      let totalScore = 0;
      for (const f of fields) {
        const val = formData[f.key];
        if (val !== undefined && val !== '') {
          const numVal = typeof val === 'number' ? val : parseInt(String(val));
          if (!isNaN(numVal)) totalScore += numVal;
        }
      }
      // 🔴 (2026-09-21 H) 종전 `?? 0` — 설문 스키마에 만점이 정의돼 있지 않으면 **만점 0** 으로
      //    기록됐다(`{ totalScore: 7, maxScore: 0 }` — 7/0). 모르는 분모는 원장에 0 으로 박지 않는다.
      const maxScore = typeof schemaData.maxScore === 'number' ? schemaData.maxScore : null;
      let interpretation = '';
      if (schemaData.interpretation) {
        for (const interp of schemaData.interpretation as Array<{ range: string; label: string }>) {
          const [min, max] = interp.range.split('-').map(Number);
          if (totalScore >= min && totalScore <= max) { interpretation = interp.label; break; }
        }
      }
      scoringResult = { totalScore, maxScore, interpretation };
    }

    // 제출 데이터에 점수 포함
    const submissionData = scoringResult
      ? { ...formData, _scoring: scoringResult }
      : formData;

    const submission = await this.prisma.formSubmission.create({
      data: {
        formSchemaId: qt.formSchemaId,
        patientId: qt.patientId,
        data: submissionData as unknown as Prisma.InputJsonValue,
        submittedBy: qt.patientId,
        // 🔴 제출 때 문항 판 — 채점에 쓴 바로 그 문항 행의 판(P5 A7 · 폼을 못 찾았으면 null)
        formSchemaRevision: schema?.revision ?? null,
      },
    });

    await this.prisma.questionnaireToken.update({
      where: { token },
      data: { completedAt: new Date(), submissionId: submission.id, status: 'COMPLETED' },
    });

    // SOAP 연동 — 문진표 응답을 진료 기록 subjective에 반영
    if (qt.appointmentId) {
      try {
        const encounter = await this.prisma.encounter.findFirst({
          where: { appointmentId: qt.appointmentId },
        });
        if (encounter) {
          const summary = this.buildQuestionnaireSummary(formData, scoringResult);
          const existing = encounter.subjective ?? '';
          const divider = existing ? '\n\n---\n[문진표 응답]\n' : '[문진표 응답]\n';
          await this.prisma.encounter.update({
            where: { id: encounter.id },
            data: { subjective: existing + divider + summary },
          });
        }
      } catch {} // 연동 실패 시 무시 — 문진표 제출 자체는 성공
    }

    // 알레르기 자동 반영 (drugAllergy/otherAllergy 필드가 있으면)
    // ⚠ 구조화 Allergy.recordedBy는 User FK(NOT NULL)라 환자 자가보고(문진표) 맥락에선
    // 유효한 User가 없어 FK 위반→과거 .catch로 조용히 유실됐음. Patient.allergies(JSONB)에
    // 병합하면 FK 없이 저장되고 DUR가 레거시 JSON도 UNION으로 확인하므로 처방 시 실제 반영됨.
    if (formData.drugAllergy || formData.otherAllergy) {
      const incoming = [formData.drugAllergy, formData.otherAllergy]
        .filter(Boolean)
        .map((a) => String(a).trim())
        .filter((a) => a.length > 0);
      if (incoming.length) {
        try {
          const p = await this.prisma.patient.findUnique({ where: { id: qt.patientId }, select: { allergies: true } });
          const current: string[] = Array.isArray(p?.allergies)
            ? (p!.allergies as unknown[]).map((x) => String(x)).filter(Boolean)
            : [];
          const merged = Array.from(new Set([...current, ...incoming]));
          if (merged.length !== current.length) {
            await this.prisma.patient.update({ where: { id: qt.patientId }, data: { allergies: merged } });
          }
        } catch (e) {
          this.logger.warn(`문진표 알레르기 반영 실패(patient ${qt.patientId}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    return submission;
  }

  /** 예약 완료 시 자동 문진표 토큰 생성 (진료과 매핑 기반) */
  async generateForAppointment(patientId: string, appointmentId: string): Promise<{ token: string; url: string; formName: string } | null> {
    try {
      // 1. 예약에서 진료과/유형 조회
      const appt = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: { doctor: { select: { department: true } } },
      });
      const dept = appt?.doctor?.department;
      const visitType = appt?.type ?? 'INITIAL';

      // 2. 진료과-양식 매핑 조회
      let schema: any = null;
      if (dept) {
        const mapping = await this.prisma.departmentFormMapping.findFirst({
          where: {
            departmentName: dept,
            isActive: true,
            visitType: { in: [visitType, 'ALL'] },
          },
          include: { formSchema: true },
          orderBy: { priority: 'asc' },
        });
        if (mapping) schema = mapping.formSchema;
      }

      // 3. 폴백: 첫 번째 활성 양식
      if (!schema) {
        schema = await this.prisma.formSchema.findFirst({
          where: { isActive: true },
          orderBy: { name: 'asc' },
        });
      }
      if (!schema) return null;

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 48);

      const qt = await this.prisma.questionnaireToken.create({
        data: {
          patientId,
          formSchemaId: schema.id,
          appointmentId,
          token: randomUUID(),
          expiresAt,
          status: 'SENT',
          sentVia: 'CHAT',
        },
      });

      return {
        token: qt.token,
        url: `/questionnaire/${qt.token}`,
        formName: schema.name,
      };
    } catch (e) {
      return null;
    }
  }

  /** 임시저장 (상태 IN_PROGRESS로 변경) */
  async saveDraft(token: string, formData: Record<string, unknown>) {
    const qt = await this.prisma.questionnaireToken.findUnique({ where: { token } });
    // 모르는 토큰에 `{data:null}` 200 을 주면 "저장된 것처럼" 읽힌다 — 조회(getByToken)와 같은 판정으로 말한다
    if (!qt) throw new NotFoundException('Invalid questionnaire token');
    if (qt.completedAt) throw new BadRequestException('Questionnaire already submitted');
    if (qt.expiresAt < new Date()) {
      // 만료 토큰이 상태를 IN_PROGRESS 로 되돌리던 것 차단(직원 목록이 "작성중"으로 읽었다)
      await this.prisma.questionnaireToken.update({ where: { token }, data: { status: 'EXPIRED' } }).catch(() => {});
      throw new BadRequestException('Questionnaire token has expired');
    }

    await this.prisma.questionnaireToken.update({
      where: { token },
      data: { status: 'IN_PROGRESS' },
    });

    // 임시저장 데이터는 토큰에 직접 저장하지 않고 클라이언트 localStorage 권장
    // 서버측은 상태만 변경
    return { saved: true, status: 'IN_PROGRESS' };
  }

  async findByPatient(patientId: string) {
    return this.prisma.questionnaireToken.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      include: {
        formSchema: { select: { name: true } },
        submission: { select: { id: true, submittedAt: true, data: true } }, // 제출 응답(JsonB) — FE 제출 뷰어가 소비
        reviewer: { select: { familyName: true, givenName: true } }, // 검토자 표시(누가 읽었는지) — 2026-09-14
      },
    });
  }

  private buildQuestionnaireSummary(
    formData: Record<string, unknown>,
    scoringResult: { totalScore: number; maxScore: number | null; interpretation: string } | null,
  ): string {
    const lines: string[] = [];
    const skip = new Set(['_scoring', 'drugAllergy', 'otherAllergy']);
    for (const [key, value] of Object.entries(formData)) {
      if (skip.has(key) || value === '' || value === null || value === undefined) continue;
      lines.push(`• ${key}: ${String(value)}`);
    }
    if (scoringResult) {
      // 🔴 만점이 정의돼 있지 않으면 `7/0` 이 아니라 **분모를 아예 말하지 않는다**
      //    (자료부족의 표현은 0 이 아니라 공백이다 · 이 문장은 진료기록 subjective 에 그대로 박힌다).
      //    🔴 서버가 한국어 문장을 새로 조립하지 않는다 — 두 갈래 모두 숫자만 만든다
      //    (`server-composed-display-text` 기준선을 늘리지 않기 위해서가 아니라, 그 규약이 맞아서다).
      const scoreText = scoringResult.maxScore != null
        ? `${scoringResult.totalScore}/${scoringResult.maxScore}`
        : String(scoringResult.totalScore);
      lines.push(`\n평가 점수: ${scoreText} (${scoringResult.interpretation})`);
    }
    return lines.join('\n');
  }
}
