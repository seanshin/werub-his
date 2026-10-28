import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateCareTeamDto, UpdateCareTeamDto } from './dto/care-team.dto';

@Injectable()
export class CareTeamService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly includeMembers = {
    doctor: { select: { id: true, familyName: true, givenName: true, department: true } },
    nurse: { select: { id: true, familyName: true, givenName: true } },
  };

  /**
   * 🔴 화면 실사용 점검 W8 — CareTeam.doctorId/nurseId 는 **users.id** 다.
   *    화면이 staff.id 를 넘기면 FK 위반(P2003)이 되어 500 이 났고, 무엇이 틀렸는지는
   *    아무 데도 나오지 않았다. 저장 전에 계정을 확인해 **왜 안 되는지 말한다**.
   */
  private async assertMember(userId: string, expected: UserRole, label: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true },
    });
    if (!u) {
      throw new BadRequestException(
        `${label}로 지정한 계정을 찾을 수 없습니다. 직원에 시스템 계정이 연결되어 있는지 확인하세요.`,
      );
    }
    if (u.role !== expected) {
      throw new BadRequestException(`${label}로 지정할 수 없는 계정입니다(계정 역할=${u.role}).`);
    }
    if (!u.isActive) {
      throw new BadRequestException(`${label}로 지정한 계정이 비활성 상태입니다.`);
    }
  }

  /** Prisma 유니크 위반 판별 — 메시지 문자열만 보면 드라이버 문구가 바뀔 때 조용히 새 나간다 */
  private isUniqueViolation(err: unknown): boolean {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'P2002') return true;
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('Unique constraint');
  }

  async findAll(dept?: string, type?: string) {
    return this.prisma.careTeam.findMany({
      where: {
        isActive: true,
        ...(dept ? { departmentName: dept } : {}),
        ...(type ? { teamType: type } : {}),
      },
      include: this.includeMembers,
      orderBy: { departmentName: 'asc' },
    });
  }

  async create(dto: CreateCareTeamDto) {
    await this.assertMember(dto.doctorId, UserRole.DOCTOR, '담당 의사');
    await this.assertMember(dto.nurseId, UserRole.NURSE, '담당 간호사');

    try {
      return await this.prisma.careTeam.create({
        data: {
          doctorId: dto.doctorId,
          nurseId: dto.nurseId,
          departmentName: dto.departmentName,
          teamType: dto.teamType ?? 'OUTPATIENT',
          isPrimary: dto.isPrimary ?? true,
          ...(dto.effectiveFrom ? { effectiveFrom: new Date(dto.effectiveFrom) } : {}),
          ...(dto.effectiveTo ? { effectiveTo: new Date(dto.effectiveTo) } : {}),
        },
        include: this.includeMembers,
      });
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('이미 등록된 케어팀 조합입니다.');
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateCareTeamDto) {
    const existing = await this.prisma.careTeam.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('케어팀을 찾을 수 없습니다.');

    // 🔴 화면 실사용 점검 W8 — 종전에는 doctorId/nurseId 를 **아예 읽지 않았다**.
    //    수정 폼에서 담당자를 바꿔 저장하면 서버는 그 값을 버리고, 화면은 모달을 닫으며
    //    "저장됐다"는 얼굴을 했다(조용한 성공). 담당자 변경을 실제로 반영한다.
    if (dto.doctorId !== undefined && dto.doctorId !== existing.doctorId) {
      await this.assertMember(dto.doctorId, UserRole.DOCTOR, '담당 의사');
    }
    if (dto.nurseId !== undefined && dto.nurseId !== existing.nurseId) {
      await this.assertMember(dto.nurseId, UserRole.NURSE, '담당 간호사');
    }

    try {
      return await this.prisma.careTeam.update({
        where: { id },
        data: {
          ...(dto.doctorId !== undefined ? { doctorId: dto.doctorId } : {}),
          ...(dto.nurseId !== undefined ? { nurseId: dto.nurseId } : {}),
          ...(dto.departmentName !== undefined ? { departmentName: dto.departmentName } : {}),
          ...(dto.teamType !== undefined ? { teamType: dto.teamType } : {}),
          ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.effectiveFrom ? { effectiveFrom: new Date(dto.effectiveFrom) } : {}),
          ...(dto.effectiveTo ? { effectiveTo: new Date(dto.effectiveTo) } : {}),
        },
        include: this.includeMembers,
      });
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('이미 등록된 케어팀 조합입니다.');
      }
      throw err;
    }
  }

  async deactivate(id: string) {
    const existing = await this.prisma.careTeam.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('케어팀을 찾을 수 없습니다.');

    return this.prisma.careTeam.update({
      where: { id },
      data: { isActive: false, effectiveTo: new Date() },
      include: this.includeMembers,
    });
  }

  async getMyTeam(userId: string) {
    return this.prisma.careTeam.findMany({
      where: {
        isActive: true,
        OR: [{ doctorId: userId }, { nurseId: userId }],
      },
      include: this.includeMembers,
      orderBy: { departmentName: 'asc' },
    });
  }

  async getByDoctor(doctorId: string) {
    return this.prisma.careTeam.findMany({
      where: { doctorId, isActive: true },
      include: this.includeMembers,
      orderBy: { isPrimary: 'desc' },
    });
  }
}
