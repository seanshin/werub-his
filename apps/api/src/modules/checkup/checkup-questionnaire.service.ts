import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class CheckupQuestionnaireService {
  constructor(private readonly prisma: PrismaService) {}

  // ── 템플릿 CRUD ──

  async findAllTemplates(query: { programId?: string; isActive?: boolean }) {
    const where: Record<string, unknown> = {};
    if (query.programId) where.programId = query.programId;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    return this.prisma.checkupQuestionnaire.findMany({
      where,
      include: {
        program: { select: { code: true, name: true } },
        _count: { select: { responses: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findTemplate(id: string) {
    const template = await this.prisma.checkupQuestionnaire.findUnique({
      where: { id },
      include: {
        program: { select: { code: true, name: true } },
        _count: { select: { responses: true } },
      },
    });
    if (!template) throw new NotFoundException('문진 템플릿을 찾을 수 없습니다');
    return template;
  }

  async createTemplate(dto: {
    programId?: string;
    title: string;
    sections: unknown;
  }) {
    if (dto.programId) {
      const program = await this.prisma.checkupProgram.findUnique({
        where: { id: dto.programId },
      });
      if (!program) throw new NotFoundException('프로그램을 찾을 수 없습니다');
    }

    return this.prisma.checkupQuestionnaire.create({
      data: {
        programId: dto.programId,
        title: dto.title,
        sections: dto.sections as Prisma.InputJsonValue,
      },
    });
  }

  async updateTemplate(id: string, dto: {
    title?: string;
    sections?: unknown;
    isActive?: boolean;
  }) {
    await this.findTemplate(id);
    return this.prisma.checkupQuestionnaire.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.sections !== undefined && { sections: dto.sections as Prisma.InputJsonValue }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async removeTemplate(id: string) {
    await this.findTemplate(id);
    return this.prisma.checkupQuestionnaire.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ── 응답 관리 ──

  async getResponseByVisit(visitId: string) {
    return this.prisma.checkupQuestionnaireResponse.findUnique({
      where: { visitId },
      include: {
        questionnaire: { select: { id: true, title: true, sections: true } },
      },
    });
  }

  async saveResponse(visitId: string, dto: {
    questionnaireId: string;
    answers: unknown;
  }) {
    const visit = await this.prisma.checkupVisit.findUnique({
      where: { id: visitId },
    });
    if (!visit) throw new NotFoundException('검진 예약을 찾을 수 없습니다');
    if (!['RESERVED', 'CHECKED_IN'].includes(visit.status))
      throw new BadRequestException('예약 또는 접수 상태에서만 문진 작성 가능합니다');

    const existing = await this.prisma.checkupQuestionnaireResponse.findUnique({
      where: { visitId },
    });

    if (existing) {
      return this.prisma.checkupQuestionnaireResponse.update({
        where: { visitId },
        data: {
          answers: dto.answers as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
    }

    return this.prisma.checkupQuestionnaireResponse.create({
      data: {
        questionnaireId: dto.questionnaireId,
        visitId,
        patientId: visit.patientId,
        answers: dto.answers as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
  }

  /** 프로그램에 연결된 문진 템플릿 조회 (없으면 공통 템플릿) */
  async getTemplateForVisit(visitId: string) {
    const visit = await this.prisma.checkupVisit.findUnique({
      where: { id: visitId },
      select: { programId: true },
    });
    if (!visit) throw new NotFoundException('검진 예약을 찾을 수 없습니다');

    // 프로그램 전용 템플릿 우선
    let template = await this.prisma.checkupQuestionnaire.findFirst({
      where: { programId: visit.programId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    // 없으면 공통 템플릿 (programId=null)
    if (!template) {
      template = await this.prisma.checkupQuestionnaire.findFirst({
        where: { programId: null, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
    }

    return template;
  }
}
