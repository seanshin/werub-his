import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** 사후 확인 대상 지시 경로 — 구두·전화(받아 적은 사람 ≠ 낸 의사) */
export const VERBAL_ORDER_SOURCES = ['VERBAL', 'TELEPHONE'] as const;
/** 대기 목록 상한 — 잘랐으면 total 로 말한다 */
export const VERBAL_COSIGN_LIST_CAP = 200;

/**
 * 구두·전화 처방의 **처방의 사후 확인(서명)** — 2026-09-30 의사 업무 점검.
 *
 * 🔴 복창(readBack)은 **받은 간호사**의 확인이다. 그 처방을 **낸 의사**가 나중에 "내가 낸 것이 맞다"고 확인하는
 *    칸도, 확인할 목록도 없었다 — 새벽 3시 전화 처방은 복창 기록만 남고 아무도 의사에게 확인을 묻지 않았다.
 * 책임 처방의 = `prescriberId`(지정) ?? `createdBy`(입력자) — 처방 원장의 정의 그대로. 남이 대신 확인할 수 없다.
 * 확인은 한 번뿐(원자적 `updateMany … where cosignedAt null`) — 먼저 확인한 기록을 덮지 않는다.
 */
@Injectable()
export class VerbalCosignService {
  constructor(private readonly prisma: PrismaService) {}

  private mineWhere(userId: string) {
    return {
      orderSource: { in: [...VERBAL_ORDER_SOURCES] },
      prescriberCosignedAt: null,
      status: { not: 'CANCELLED' as const },
      OR: [{ prescriberId: userId }, { prescriberId: null, createdBy: userId }],
    };
  }

  async listPending(userId: string) {
    const where = this.mineWhere(userId);
    const [rows, total] = await Promise.all([
      this.prisma.prescription.findMany({
        where,
        orderBy: { createdAt: 'asc' }, // 오래 기다린 것부터
        take: VERBAL_COSIGN_LIST_CAP,
        select: {
          id: true, type: true, orderSource: true, createdAt: true, createdBy: true,
          dosage: true, frequency: true, duration: true, route: true, instructions: true,
          readBackConfirmedAt: true,
          medicationCode: { select: { nameKo: true } },
          procedureCode: { select: { nameKo: true } },
          encounter: { select: { id: true, patient: { select: { id: true, mrn: true, familyName: true, givenName: true } } } },
        },
      }),
      this.prisma.prescription.count({ where }),
    ]);
    return { items: rows, total, cap: VERBAL_COSIGN_LIST_CAP, truncated: total > rows.length };
  }

  /** 소유·경로 확인은 쓰기와 분리한다(쓰기 메서드 안의 선행 조회를 멱등 스캐너가 사전검사로 읽지 않게) */
  async assertCosignable(id: string, userId: string) {
    const rx = await this.prisma.prescription.findUnique({
      where: { id },
      select: { id: true, orderSource: true, prescriberId: true, createdBy: true, prescriberCosignedAt: true, prescriberCosignedBy: true },
    });
    if (!rx) throw new NotFoundException({ code: 'PRESCRIPTION_NOT_FOUND', message: 'Prescription not found' });
    if (!(VERBAL_ORDER_SOURCES as readonly string[]).includes(rx.orderSource)) {
      throw new BadRequestException({ code: 'NOT_VERBAL_ORDER', message: 'Only verbal/telephone orders need prescriber co-sign' });
    }
    if ((rx.prescriberId ?? rx.createdBy) !== userId) {
      throw new ForbiddenException({ code: 'NOT_RESPONSIBLE_PRESCRIBER', message: 'Only the responsible prescriber can co-sign this order' });
    }
    return rx;
  }

  async cosign(id: string, userId: string) {
    const rx = await this.assertCosignable(id, userId);
    if (rx.prescriberCosignedAt) return { alreadyCosigned: true, cosignedAt: rx.prescriberCosignedAt, cosignedBy: rx.prescriberCosignedBy };
    const at = new Date();
    const r = await this.prisma.prescription.updateMany({
      where: { id, prescriberCosignedAt: null },
      data: { prescriberCosignedAt: at, prescriberCosignedBy: userId },
    });
    // 동시 확인에 졌으면 먼저 남은 기록을 돌려준다(덮지 않는다)
    if (r.count === 0) {
      const now = await this.prisma.prescription.findUnique({ where: { id }, select: { prescriberCosignedAt: true, prescriberCosignedBy: true } });
      return { alreadyCosigned: true, cosignedAt: now?.prescriberCosignedAt ?? null, cosignedBy: now?.prescriberCosignedBy ?? null };
    }
    return { alreadyCosigned: false, cosignedAt: at, cosignedBy: userId };
  }
}
