import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, ProblemStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ProblemNotFoundError, ProblemAlreadyResolvedError } from '../../domain/errors/domain-error';
import { CreateProblemDto } from './dto/create-problem.dto';
import { UpdateProblemDto, ResolveProblemDto } from './dto/update-problem.dto';

/** 지금 유효한 문제 — 같은 진단을 두 번 올리지 않는 기준(해결·비활성은 다시 올릴 수 있다) */
export const PROBLEM_CURRENT_STATUSES: ProblemStatus[] = ['ACTIVE', 'CHRONIC'];

@Injectable()
export class ProblemListService {
  constructor(private readonly prisma: PrismaService) {}

  async create(patientId: string, dto: CreateProblemDto, userId: string) {
    // 🔴 (2026-10-03) 같은 진단이 이미 활성·만성으로 있으면 거부 — 진단에서 바로 올리는 화면이 생겨 더블클릭·재시도로 중복이 생길 수 있다
    const dup = await this.prisma.problemList.findFirst({
      where: { patientId, diagnosisCodeId: dto.diagnosisCodeId, status: { in: PROBLEM_CURRENT_STATUSES } },
      select: { id: true, status: true },
    });
    // 문장은 고정 · 상태는 값으로(서버가 상태 낱말을 끼워 문장을 조립하지 않는다 — 화면 언어를 바꿔도 남는다)
    if (dup) throw new ConflictException({ code: 'PROBLEM_ALREADY_LISTED', message: '이미 문제 목록에 있는 진단입니다', details: { problemId: dup.id, status: dup.status } });
    return this.prisma.problemList.create({
      data: {
        patientId,
        diagnosisCodeId: dto.diagnosisCodeId,
        description: dto.description,
        status: dto.status,
        severity: dto.severity,
        onsetDate: dto.onsetDate ? new Date(dto.onsetDate) : undefined,
        addedEncounterId: dto.addedEncounterId,
        notes: dto.notes,
        addedBy: userId,
      },
      include: this.defaultInclude(),
    });
  }

  async findByPatient(patientId: string, statusFilter?: string) {
    const where: Prisma.ProblemListWhereInput = { patientId };
    if (statusFilter) {
      const statuses = statusFilter.split(',') as ProblemStatus[];
      where.status = { in: statuses };
    }

    return this.prisma.problemList.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: this.defaultInclude(),
    });
  }

  /**
   * 🔴 (2026-09-16) 경로는 `patients/:patientId/problems/:id` 인데 환자 id 를 버리고 문제 id 만으로
   *    조회·수정·해결했다 — 다른 환자의 문제목록을 이 경로로 읽고 고칠 수 있었다.
   *    소속이 다르면 존재를 알려주지 않는다(404). 같은 결함이 알레르기에도 있었다.
   */
  private async ensureBelongsToPatient(patientId: string, id: string) {
    const owned = await this.prisma.problemList.findFirst({ where: { id, patientId }, select: { id: true } });
    if (!owned) throw new ProblemNotFoundError(id);
  }

  async findById(patientId: string, id: string) {
    const problem = await this.prisma.problemList.findFirst({
      where: { id, patientId },
      include: this.defaultInclude(),
    });
    if (!problem) throw new ProblemNotFoundError(id);
    return problem;
  }

  async update(patientId: string, id: string, dto: UpdateProblemDto) {
    await this.ensureBelongsToPatient(patientId, id);

    return this.prisma.problemList.update({
      where: { id },
      data: {
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.severity !== undefined && { severity: dto.severity }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: this.defaultInclude(),
    });
  }

  async resolve(patientId: string, id: string, dto: ResolveProblemDto) {
    const existing = await this.prisma.problemList.findFirst({ where: { id, patientId } });
    if (!existing) throw new ProblemNotFoundError(id);
    if (existing.status === 'RESOLVED') {
      throw new ProblemAlreadyResolvedError(id);
    }

    return this.prisma.problemList.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedDate: dto.resolvedDate ? new Date(dto.resolvedDate) : new Date(),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: this.defaultInclude(),
    });
  }

  private defaultInclude() {
    return {
      diagnosisCode: { select: { code: true, nameKo: true, nameEn: true, codeSystem: true } },
      addedByUser: { select: { id: true, familyName: true, givenName: true } },
    };
  }
}
