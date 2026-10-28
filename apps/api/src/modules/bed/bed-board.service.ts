import { Injectable } from '@nestjs/common';
import { stayDays } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 병상·입원 보드(D5) — 병상 가동률(병동별)·금일 입퇴원·재원일수·장기재원.
 * raw SQL 미사용(Prisma ORM).
 */
@Injectable()
export class BedBoardService {
  constructor(private readonly prisma: PrismaService) {}

  async getBoard() {
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);

    const [beds, admitToday, dischargeToday, admitted] = await Promise.all([
      this.prisma.bed.findMany({ select: { status: true, wardId: true, ward: { select: { name: true } } } }),
      this.prisma.admission.count({ where: { admitDate: { gte: dayStart, lt: dayEnd } } }),
      this.prisma.admission.count({ where: { status: 'DISCHARGED', dischargeDate: { gte: dayStart, lt: dayEnd } } }),
      this.prisma.admission.findMany({ where: { status: 'ADMITTED' }, select: { admitDate: true } }),
    ]);

    // 병동별 집계
    // 🔴 BedStatus 는 6종(AVAILABLE·OCCUPIED·RESERVED·MAINTENANCE·CLEANING·ISOLATION)인데
    //    종전엔 4종만 세어 **CLEANING·ISOLATION 병상이 total 에는 들어가고 어느 컬럼에도 안 나타났다**
    //    → 화면에서 합이 맞지 않았다(2026-08-11 실측: 응급병동 25 = 가용22 + 점검1 + ???2, 실제는 청소 2).
    //    청소 대기는 "즉시 배정 불가"라 운영상 반드시 보여야 하는 상태다.
    const wardMap = new Map<string, { name: string; total: number; occupied: number; available: number; reserved: number; maintenance: number; cleaning: number; isolation: number }>();
    for (const b of beds) {
      const key = b.wardId;
      const w = wardMap.get(key) ?? { name: b.ward?.name ?? '-', total: 0, occupied: 0, available: 0, reserved: 0, maintenance: 0, cleaning: 0, isolation: 0 };
      w.total += 1;
      if (b.status === 'OCCUPIED') w.occupied += 1;
      else if (b.status === 'AVAILABLE') w.available += 1;
      else if (b.status === 'RESERVED') w.reserved += 1;
      else if (b.status === 'MAINTENANCE') w.maintenance += 1;
      else if (b.status === 'CLEANING') w.cleaning += 1;
      else if (b.status === 'ISOLATION') w.isolation += 1;
      wardMap.set(key, w);
    }
    // 🔴 병상 0인 병동의 가동률은 0% 가 아니라 산출 불가(null) — 정렬은 null 을 뒤로 보낸다(NaN 비교 금지)
    const wards = [...wardMap.values()]
      .map((w) => ({ ...w, occupancyRate: w.total ? Math.round((w.occupied / w.total) * 100) : null }))
      .sort((a, b) => (b.occupancyRate ?? -1) - (a.occupancyRate ?? -1));

    const totalBeds = beds.length;
    const occupied = beds.filter((b) => b.status === 'OCCUPIED').length;
    const available = beds.filter((b) => b.status === 'AVAILABLE').length;
    const cleaning = beds.filter((b) => b.status === 'CLEANING').length;

    // 재원일수 분포 + 장기재원(14일+)
    const losList = admitted.map((a) => stayDays(a.admitDate) ?? 0);
    const longStay = losList.filter((d) => d >= 14).length;
    // 🔴 (2026-09-17 L4) 재원 환자 0 명이면 평균 재원일수는 **0 일이 아니라 산출 불가**다 — 바로 위
    //    occupancyRate 는 이미 null 로 고쳐져 있었는데(병상 0) 이 줄만 0 으로 떨어져 한 응답 안에서 갈라져 있었다.
    //    admittedTotal(=losList.length) 을 함께 내므로 화면이 분모를 보고 '—' 로 그린다.
    const avgLos = losList.length ? Math.round((losList.reduce((s, d) => s + d, 0) / losList.length) * 10) / 10 : null;

    return {
      summary: {
        totalBeds, occupied, available, cleaning,
        // 🔴 등록 병상 0 → 산출 불가(null). totalBeds·occupied 를 함께 내므로 화면이 <Ratio> 로 그린다
        occupancyRate: totalBeds ? Math.round((occupied / totalBeds) * 100) : null,
        admitToday, dischargeToday,
        admittedTotal: admitted.length, longStay, avgLos,
      },
      wards,
    };
  }
}
