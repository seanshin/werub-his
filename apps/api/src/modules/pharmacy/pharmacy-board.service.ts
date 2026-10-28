import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { waitMinutesSince } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PharmacyService } from './pharmacy.service';

/**
 * 약국 보드(D7) — 조제 대기·검수 대기·금일 조제·재고 부족.
 *
 * 🔴 정본 정렬(2026-08-13 W3): 같은 사실은 /pharmacy 화면과 같은 모수로 센다.
 * - 조제 대기 = **원내 약 처방의 접수 대기(ORDERED/RECEIVED)** — 종전엔 dispensing.PENDING
 *   (=이미 조제 시작된 것)을 세면서 딥링크는 /pharmacy?status=ORDERED 로 보내,
 *   보드가 "대기 없음 ✓"라 말하는 동안 약국 목록엔 10건이 서 있었다.
 * - 검수 대기 = dispensing.DISPENSED 를 원내/원외로 갈라 준다 — 종전 총계(5)를 눌러
 *   원내 탭(4)이 열리면 KPI > 목록이 됐다.
 * - 재고 부족 = **약품 재고 정본(MedicationBatch, getLowStock)** — 종전엔 원내 소모품
 *   마스터(inventoryItem·약품 0건)를 세서 약이 바닥나도 영원히 "부족 품목 없음 ✓"였다.
 */
@Injectable()
export class PharmacyBoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pharmacy: PharmacyService,
  ) {}

  async getBoard() {
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);

    // /pharmacy '접수 대기' 탭과 같은 모수(원내·약·미시작) — 갈라지면 두 화면이 딴소리를 한다.
    const pendingWhere: Prisma.OrderWhereInput = {
      department: 'PHARMACY',
      pharmacyType: 'INTERNAL',
      prescription: { status: 'ACTIVE', type: 'MEDICATION' },
      status: { in: ['ORDERED', 'RECEIVED'] },
    };

    const [pending, pendingList, verifyWait, verifyWaitExternal, dispensedToday, lowStockMeds] = await Promise.all([
      this.prisma.order.count({ where: pendingWhere }),
      this.prisma.order.findMany({
        where: pendingWhere,
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: {
          id: true, createdAt: true,
          prescription: { select: { encounter: { select: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } } } } },
        },
      }),
      this.prisma.dispensing.count({ where: { status: 'DISPENSED', order: { pharmacyType: 'INTERNAL' } } }),
      this.prisma.dispensing.count({ where: { status: 'DISPENSED', order: { pharmacyType: 'EXTERNAL' } } }),
      this.prisma.dispensing.count({ where: { dispensedAt: { gte: dayStart, lt: dayEnd } } }),
      this.pharmacy.getLowStock(), // 약품 재고 정본 — 품목 합산 잔여량 기준
    ]);

    const queue = pendingList.map((o) => {
      const p = o.prescription?.encounter?.patient;
      return {
        id: o.id, patientId: p?.id ?? null,
        name: p ? `${p.familyName}${p.givenName}` : '-', mrn: p?.mrn ?? '-',
        // 대기 경과 정본 — 미래 시각이면 음수가 아니라 null(아직 시작 안 함)
        waitMins: waitMinutesSince(o.createdAt, now),
      };
    });
    const lowStock = lowStockMeds.slice(0, 50).map((m) => ({
      id: m.id, name: m.nameKo, code: m.code,
      remainingQty: m.batches.reduce((a, b) => a + b.remainingQty, 0),
    }));

    return {
      summary: { pending, verifyWait, verifyWaitExternal, dispensedToday, lowStockCount: lowStockMeds.length },
      queue,
      lowStock,
    };
  }
}
