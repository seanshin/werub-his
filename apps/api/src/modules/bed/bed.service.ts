import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BedStatus, Prisma } from '@prisma/client';

@Injectable()
export class BedService {
  constructor(private readonly prisma: PrismaService) {}

  async listBeds(wardId?: string) {
    const where = wardId ? { wardId } : {};
    return this.prisma.bed.findMany({
      where,
      orderBy: { roomNumber: 'asc' },
      include: { ward: { select: { name: true } } },
    });
  }

  async updateBedStatus(bedId: string, status: BedStatus) {
    const bed = await this.prisma.bed.findUnique({ where: { id: bedId } });
    if (!bed) throw new NotFoundException('Bed not found');

    return this.prisma.bed.update({
      where: { id: bedId },
      data: { status },
      include: { ward: true },
    });
  }

  async getAvailableBeds(wardId?: string) {
    const where: Prisma.BedWhereInput = { status: { in: [BedStatus.AVAILABLE, BedStatus.RESERVED] } };
    // 🔴 wardId 미지정=입원 배정용 전체 조회 — 응급병동(ER 베드 보드 소관)이 입원 가용으로 새던 실결함 봉합.
    //    특정 병동을 지목하면 그 병동이 응급이어도 존중(호출자가 스코프를 안다).
    if (wardId) where.wardId = wardId;
    else where.ward = { type: { not: 'EMERGENCY' } };

    return this.prisma.bed.findMany({
      where,
      orderBy: { roomNumber: 'asc' },
      include: { ward: { select: { name: true } } },
    });
  }

  async getBedsByWard(wardId: string) {
    const ward = await this.prisma.ward.findUnique({ where: { id: wardId } });
    if (!ward) throw new NotFoundException('Ward not found');

    return this.prisma.bed.findMany({
      where: { wardId },
      orderBy: { roomNumber: 'asc' },
    });
  }

  async getBedDetail(bedId: string) {
    const bed = await this.prisma.bed.findUnique({
      where: { id: bedId },
      include: {
        ward: true,
        admissions: { where: { status: 'ADMITTED' }, take: 1 },
      },
    });

    if (!bed) throw new NotFoundException('Bed not found');
    return bed;
  }

  async calculateWardOccupancy(wardId: string) {
    const beds = await this.prisma.bed.findMany({ where: { wardId } });
    const occupied = beds.filter(b => b.status === BedStatus.OCCUPIED).length;
    const total = beds.length;

    return {
      wardId,
      total,
      occupied,
      available: total - occupied,
      // 🔴 등록 병상 0이면 가동률은 0% 가 아니라 **산출 불가**(null). 0 은 "병상이 다 비었다"로 읽힌다.
      //    분자·분모(occupied·total)는 위에서 이미 함께 낸다 — 화면은 <Ratio> 로 그린다.
      occupancyRate: total > 0 ? Math.round((occupied / total) * 100 * 100) / 100 : null,
    };
  }

  async getWardsWithBeds() {
    const wards = await this.prisma.ward.findMany({
      include: {
        beds: {
          orderBy: [{ roomNumber: 'asc' }, { bedNumber: 'asc' }],
          include: {
            admissions: {
              where: { status: 'ADMITTED' },
              include: { patient: { select: { familyName: true, givenName: true, mrn: true } } },
              take: 1,
            },
          },
        },
      },
      orderBy: { floor: 'asc' },
    });
    return wards.map(w => ({
      ...w,
      beds: w.beds.map(b => ({
        ...b,
        patient: b.admissions[0]?.patient ?? null,
        admissions: undefined,
      })),
    }));
  }

  async getBedStatusSummary() {
    const beds = await this.prisma.bed.findMany();
    const total = beds.length;
    const byStatus = Object.entries(
      beds.reduce((acc, b) => { acc[b.status] = (acc[b.status] || 0) + 1; return acc; }, {} as Record<string, number>)
    ).map(([status, count]) => ({ status, _count: count }));
    return { total, byStatus };
  }
}
