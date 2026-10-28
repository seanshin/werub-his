import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class BtgService {
  constructor(private readonly prisma: PrismaService) {}

  async createAccess(data: { patientId: string; reason: string; resourceType: string; resourceId?: string }, userId: string) {
    return this.prisma.breakTheGlassAccess.create({
      data: {
        userId,
        patientId: data.patientId,
        reason: data.reason,
        accessedAt: new Date(),
        resourceType: data.resourceType,
        resourceId: data.resourceId,
      },
      include: {
        user: { select: { id: true, familyName: true, givenName: true, role: true } },
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
    });
  }

  async findAll(filters: { userId?: string; dateFrom?: string; dateTo?: string }) {
    const where: Prisma.BreakTheGlassAccessWhereInput = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.dateFrom || filters.dateTo) {
      where.accessedAt = {};
      if (filters.dateFrom) where.accessedAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.accessedAt.lte = new Date(filters.dateTo);
    }

    return this.prisma.breakTheGlassAccess.findMany({
      where,
      orderBy: { accessedAt: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, familyName: true, givenName: true, role: true } },
        patient: { select: { id: true, mrn: true, familyName: true, givenName: true } },
      },
    });
  }

  async review(id: string, isApproved: boolean, reviewerId: string) {
    const access = await this.prisma.breakTheGlassAccess.findUnique({ where: { id } });
    if (!access) throw new NotFoundException('BTG access not found');

    return this.prisma.breakTheGlassAccess.update({
      where: { id },
      data: { reviewedBy: reviewerId, reviewedAt: new Date(), isApproved },
    });
  }

  /**
   * 환자 접근 이력 — 감사 커버리지 확대(2026-07)로 임상 도메인 열람도 대상 환자(resourceId=patientId)에
   * 귀속돼 기록된다. 종전 `resourceType: 'Patient'` 고정은 환자 기본정보 조회만 보여줘
   * 간호기록·검사결과 등 실제 차트 열람이 이력에서 통째로 빠졌음.
   */
  /**
   * 환자 기록 열람·변경 이력(감사 원장 resourceId = 환자) — 환자 차트 '의무기록' 탭(2026-10-02).
   * 🔴 종전: 50건에서 **말없이** 잘렸고, 다른 직원의 **IP·브라우저 정보**를 의사·간호사 누구에게나 돌려줬다(화면은 없었다 — 고아 EP).
   *    → 전체 수·쪽 나눔을 주고, IP·브라우저는 관리자에게만 · 변경 내용(changes)은 싣지 않는다(무엇을 봤는지가 아니라 누가 언제 봤는지).
   */
  async getPatientAccessHistory(patientId: string, opts: { viewerRole?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200);
    const offset = Math.max(Math.trunc(opts.offset ?? 0), 0);
    const where = { resourceId: patientId };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true, action: true, resourceType: true, timestamp: true, ipAddress: true, userAgent: true,
          user: { select: { id: true, familyName: true, givenName: true, role: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    const showNetwork = opts.viewerRole === 'ADMIN';
    return {
      total,
      limit,
      offset,
      networkVisible: showNetwork,
      items: rows.map(({ ipAddress, userAgent, ...r }) => (showNetwork ? { ...r, ipAddress, userAgent } : r)),
    };
  }
}
