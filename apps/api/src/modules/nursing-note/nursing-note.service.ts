import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  isAdmissionScopedNursingContext, isUniversalNursingContext,
  hasUniversalNursingBody, ADMISSION_SCOPED_NURSING_HINT,
  UNIVERSAL_NURSING_CONTEXT_TYPES,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateNursingNoteDto, UpdateNursingNoteDto } from './dto/nursing-note.dto';

/** 입원 간호기록 정본(NursingNote)이 세는 통계 버킷 — universal 의 contextType 과 섞이지 않는 별도 이름 */
export const INPATIENT_NURSING_STATS_BUCKET = 'INPATIENT';

const NOTE_INCLUDE = {
  patient: { select: { id: true, familyName: true, givenName: true, mrn: true } },
  nurse: { select: { id: true, familyName: true, givenName: true, department: true } },
} as const;

@Injectable()
export class NursingNoteService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 🔴 정본 경계 — 서비스 층에서도 한 번 더 막는다.
   * DTO 검증은 `ValidationPipe` 가 metatype 을 읽을 수 있을 때만 돈다(인라인 @Body·교차 타입·
   * `Partial<>` 은 통째로 스킵된다). 다른 호출자가 생겨도 경계가 새지 않게 여기서 fail-closed.
   */
  private assertCanonicalBoundary(input: {
    contextType?: string;
    situation?: string; background?: string; assessment?: string; recommendation?: string; content?: string;
  }) {
    if (input.contextType !== undefined) {
      if (isAdmissionScopedNursingContext(input.contextType)) {
        throw new BadRequestException({
          code: 'NURSING_NOTE_CANON_BYPASS',
          message: `contextType='${input.contextType}' 은 범용 간호기록에 쓸 수 없습니다. ${ADMISSION_SCOPED_NURSING_HINT}`,
        });
      }
      if (!isUniversalNursingContext(input.contextType)) {
        throw new BadRequestException({
          code: 'NURSING_NOTE_CONTEXT_UNKNOWN',
          message: `contextType 은 ${UNIVERSAL_NURSING_CONTEXT_TYPES.join(' | ')} 중 하나여야 합니다.`,
        });
      }
    }
  }

  /** 1. 간호기록 생성 */
  async create(dto: CreateNursingNoteDto, nurseId: string) {
    this.assertCanonicalBoundary(dto);
    // 🔴 본문 없는 기록은 만들지 않는다 — whitelist 가 화면 키를 지워도 200 이 나가지 않게(데이터 소실 차단)
    if (!hasUniversalNursingBody(dto)) {
      throw new BadRequestException({
        code: 'NURSING_NOTE_EMPTY_BODY',
        message: '간호기록 본문이 비었습니다 — content 또는 SBAR(situation·background·assessment·recommendation) 중 최소 한 칸을 채우세요.',
      });
    }
    return this.prisma.universalNursingNote.create({
      data: {
        patientId: dto.patientId,
        nurseId,
        contextType: dto.contextType,
        contextId: dto.contextId,
        noteType: dto.noteType,
        situation: dto.situation,
        background: dto.background,
        assessment: dto.assessment,
        recommendation: dto.recommendation,
        content: dto.content,
        vitalSigns: dto.vitalSigns as unknown as Prisma.InputJsonValue,
        severity: dto.severity,
        shiftType: dto.shiftType,
        recordedAt: new Date(),
      },
      include: NOTE_INCLUDE,
    });
  }

  /** 2. 간호기록 목록 조회 (필터) */
  async findAll(filters: {
    contextType?: string;
    contextId?: string;
    patientId?: string;
    noteType?: string;
  }) {
    const where: Prisma.UniversalNursingNoteWhereInput = {};
    if (filters.contextType) where.contextType = filters.contextType;
    if (filters.contextId) where.contextId = filters.contextId;
    if (filters.patientId) where.patientId = filters.patientId;
    if (filters.noteType) where.noteType = filters.noteType;

    return this.prisma.universalNursingNote.findMany({
      where,
      include: NOTE_INCLUDE,
      orderBy: { recordedAt: 'desc' },
    });
  }

  /** 3. 단건 조회 */
  async findById(id: string) {
    const note = await this.prisma.universalNursingNote.findUnique({
      where: { id },
      include: NOTE_INCLUDE,
    });
    if (!note) throw new NotFoundException(`NursingNote ${id} not found`);
    return note;
  }

  /** 4. 수정 */
  async update(id: string, dto: UpdateNursingNoteDto) {
    this.assertCanonicalBoundary(dto);
    const before = await this.findById(id); // existence check
    // 정정으로 본문을 통째로 비우는 것도 소실이다 — 병합 결과로 판정한다
    const merged = {
      situation: dto.situation !== undefined ? dto.situation : before.situation ?? undefined,
      background: dto.background !== undefined ? dto.background : before.background ?? undefined,
      assessment: dto.assessment !== undefined ? dto.assessment : before.assessment ?? undefined,
      recommendation: dto.recommendation !== undefined ? dto.recommendation : before.recommendation ?? undefined,
      content: dto.content !== undefined ? dto.content : before.content ?? undefined,
    };
    if (!hasUniversalNursingBody(merged)) {
      throw new BadRequestException({
        code: 'NURSING_NOTE_EMPTY_BODY',
        message: '수정 결과 간호기록 본문이 비게 됩니다 — 최소 한 칸은 남겨야 합니다.',
      });
    }
    return this.prisma.universalNursingNote.update({
      where: { id },
      data: {
        ...(dto.contextType !== undefined && { contextType: dto.contextType }),
        ...(dto.contextId !== undefined && { contextId: dto.contextId }),
        ...(dto.noteType !== undefined && { noteType: dto.noteType }),
        ...(dto.situation !== undefined && { situation: dto.situation }),
        ...(dto.background !== undefined && { background: dto.background }),
        ...(dto.assessment !== undefined && { assessment: dto.assessment }),
        ...(dto.recommendation !== undefined && { recommendation: dto.recommendation }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.vitalSigns !== undefined && { vitalSigns: dto.vitalSigns as unknown as Prisma.InputJsonValue }),
        ...(dto.severity !== undefined && { severity: dto.severity }),
        ...(dto.shiftType !== undefined && { shiftType: dto.shiftType }),
      },
      include: NOTE_INCLUDE,
    });
  }

  /** 5. 환자별 간호기록 조회 */
  async findByPatient(patientId: string) {
    return this.prisma.universalNursingNote.findMany({
      where: { patientId },
      include: NOTE_INCLUDE,
      orderBy: { recordedAt: 'desc' },
      take: 100,
    });
  }

  /** 6. 컨텍스트별 간호기록 조회 */
  async findByContext(contextType: string, contextId: string) {
    return this.prisma.universalNursingNote.findMany({
      where: { contextType, contextId },
      include: NOTE_INCLUDE,
      orderBy: { recordedAt: 'desc' },
    });
  }

  /**
   * 7. 오늘 간호기록 통계 (contextType별 카운트)
   *
   * 🔴 간호기록은 **정본이 둘로 갈려 있다**(입원=NursingNote · 그 밖=UniversalNursingNote).
   *    종전엔 universal 만 세어서 **병동 기록이 0으로 보고**됐다 — 화면 이름은 그냥 '간호기록 통계'인데.
   *    두 정본을 모두 세고, 입원분은 `INPATIENT` 버킷으로 **구분해서** 돌려준다(합쳐 감추지 않는다).
   */
  async getStats(nurseId?: string) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const where: Prisma.UniversalNursingNoteWhereInput = {
      recordedAt: { gte: todayStart },
    };
    if (nurseId) where.nurseId = nurseId;

    const [stats, inpatientCount] = await Promise.all([
      this.prisma.universalNursingNote.groupBy({
        by: ['contextType'],
        where,
        _count: { id: true },
      }),
      this.prisma.nursingNote.count({
        where: { recordedAt: { gte: todayStart }, ...(nurseId ? { nurseId } : {}) },
      }),
    ]);

    const rows: { contextType: string; count: number; source: 'UNIVERSAL' | 'ADMISSION' }[] =
      stats.map((s) => ({ contextType: s.contextType, count: s._count.id, source: 'UNIVERSAL' }));
    if (inpatientCount > 0) {
      rows.push({ contextType: INPATIENT_NURSING_STATS_BUCKET, count: inpatientCount, source: 'ADMISSION' });
    }
    return rows;
  }
}
