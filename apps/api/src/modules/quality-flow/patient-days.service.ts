import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { dateOnlyValue, localDateKey, parseLocalDate } from '../../common/day-range';

const MAX_REBUILD_DAYS = 400;

/**
 * 일일 재원일수 스냅샷(QI 흐름 2026-10-08) — 사고율·감염률의 분모 원장.
 *
 *  · 그날의 **자정 재원 수**(다음 날 00:00 시점에 재원 중인 입원 · 취소 입원 제외)를 병동별로 센다
 *  · 병동 = 그 시점 유효한 병상 배정 이력(BedAssignment)의 병상 병동. 배정 이력이 아예 없는 입원은 현재 병상 병동,
 *    이력은 있는데 그 시점 유효한 배정이 없으면 병동 미상('') — 지어내지 않는다
 *  · 같은 날을 다시 세면 그날 행을 통째로 바꾼다(재계산 가능 · 병동 목록이 줄면 빠진 병동 행은 지운다)
 *  · 매일 00:10 어제 하루 · 관리자가 기간 재계산(최대 400일) — 과거 날의 병상 이력이 불완전하면 병동 미상이 늘어난다
 */
@Injectable()
export class PatientDaysService {
  private readonly logger = new Logger(PatientDaysService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** dayKey(YYYY-MM-DD · KST) 하루의 병동별 자정 재원 수 */
  async snapshotDay(dayKey: string): Promise<{ date: string; total: number; byWard: Record<string, number> }> {
    const day = parseLocalDate(dayKey);
    if (!day) throw new BadRequestException({ code: 'QI_PATIENT_DAY_DATE', message: '날짜를 YYYY-MM-DD 로 지정해주세요' });
    const instant = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0, 0);
    const rows = await this.prisma.admission.findMany({
      where: { admitDate: { lt: instant }, OR: [{ dischargeDate: null }, { dischargeDate: { gte: instant } }], status: { not: 'CANCELLED' } },
      select: {
        id: true,
        bed: { select: { wardId: true } },
        bedAssignments: { select: { assignedAt: true, releasedAt: true, bed: { select: { wardId: true } } } },
      },
    });
    const byWard: Record<string, number> = {};
    for (const a of rows) {
      let wardKey = '';
      if (!a.bedAssignments.length) wardKey = a.bed?.wardId ?? '';
      else {
        const active = a.bedAssignments.find((b) => b.assignedAt <= instant && (b.releasedAt == null || b.releasedAt > instant));
        wardKey = active?.bed?.wardId ?? '';
      }
      byWard[wardKey] = (byWard[wardKey] ?? 0) + 1;
    }
    // 🔴 재원 0명인 날도 "센 날"이다 — 행이 없으면 그 달 분모가 영원히 '스냅샷 미완'으로 남는다(0 행 하나로 덮는다)
    if (!rows.length) byWard[''] = 0;
    const date = dateOnlyValue(dayKey)!;
    await this.prisma.$transaction(async (tx) => {
      await tx.patientDaySnapshot.deleteMany({ where: { date, wardKey: { notIn: Object.keys(byWard) } } });
      for (const [wardKey, n] of Object.entries(byWard)) {
        await tx.patientDaySnapshot.upsert({
          where: { date_wardKey: { date, wardKey } },
          create: { date, wardKey, patientDays: n },
          update: { patientDays: n, computedAt: new Date() },
        });
      }
    });
    return { date: dayKey, total: rows.length, byWard };
  }

  /** 기간 재계산(관리자) — from·to 포함 · 최대 400일 */
  async rebuild(from: string, to: string): Promise<{ days: number; from: string; to: string }> {
    const a = parseLocalDate(from); const b = parseLocalDate(to);
    if (!a || !b) throw new BadRequestException({ code: 'QI_PATIENT_DAY_DATE', message: '날짜를 YYYY-MM-DD 로 지정해주세요' });
    if (a > b) throw new BadRequestException({ code: 'QI_PATIENT_DAY_ORDER', message: '시작일이 종료일보다 늦습니다' });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (b >= today) throw new BadRequestException({ code: 'QI_PATIENT_DAY_FUTURE', message: '끝나지 않은 날(오늘·미래)은 셀 수 없습니다' });
    const keys: string[] = [];
    const d = new Date(a);
    while (d <= b) { keys.push(localDateKey(d)); d.setDate(d.getDate() + 1); }
    if (keys.length > MAX_REBUILD_DAYS) throw new BadRequestException({ code: 'QI_PATIENT_DAY_RANGE', message: '재계산은 400일까지입니다' });
    for (const k of keys) await this.snapshotDay(k);
    return { days: keys.length, from: keys[0], to: keys[keys.length - 1] };
  }

  /** 기간 요약(화면) — 날짜별 합과 덮은 날 수 */
  async summary(from: string, to: string) {
    const a = dateOnlyValue(from); const b = dateOnlyValue(to);
    if (!a || !b) throw new BadRequestException({ code: 'QI_PATIENT_DAY_DATE', message: '날짜를 YYYY-MM-DD 로 지정해주세요' });
    const rows = await this.prisma.patientDaySnapshot.findMany({ where: { date: { gte: a, lte: b } }, orderBy: { date: 'asc' } });
    const byDate = new Map<string, number>();
    const byWard = new Map<string, number>();
    for (const r of rows) {
      const k = r.date.toISOString().slice(0, 10);
      byDate.set(k, (byDate.get(k) ?? 0) + r.patientDays);
      byWard.set(r.wardKey, (byWard.get(r.wardKey) ?? 0) + r.patientDays);
    }
    const wards = await this.prisma.ward.findMany({ where: { id: { in: [...byWard.keys()].filter(Boolean) } }, select: { id: true, name: true } });
    const name = new Map(wards.map((w) => [w.id, w.name]));
    return {
      from, to, coveredDays: byDate.size,
      total: [...byDate.values()].reduce((s, n) => s + n, 0),
      byDate: [...byDate.entries()].map(([date, patientDays]) => ({ date, patientDays })),
      byWard: [...byWard.entries()].map(([wardKey, patientDays]) => ({ wardKey, wardName: wardKey ? name.get(wardKey) ?? null : null, patientDays })),
    };
  }

  /** 매일 00:10 — 어제 하루 */
  @Cron('10 0 * * *', { name: 'qi-patient-days-snapshot' })
  async nightly() {
    const y = new Date(); y.setDate(y.getDate() - 1);
    try {
      const r = await this.snapshotDay(localDateKey(y));
      this.logger.log(`재원일수 스냅샷 ${r.date} — 재원 ${r.total}`);
    } catch (e) {
      this.logger.error(`재원일수 스냅샷 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
