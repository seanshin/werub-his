import { BadRequestException, ConflictException, Injectable, Optional } from '@nestjs/common';
import { QI_DEVICE_TYPES } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { monthRangeLocal } from '../../common/day-range';

/**
 * 기구일수 월 입력(QI 흐름 2026-10-08) — CLABSI·CAUTI·VAP 발생률의 분모.
 * 🔴 결정 qi.deviceDays.source = MANUAL 일 때만 받는다(미설정·NONE 이면 409 — 화면이 그 사실을 말한다).
 * 같은 달·병동·기구는 한 행 — 다시 넣으면 고친다(변이 감사가 이전 값을 남긴다).
 */
@Injectable()
export class DeviceDaysService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly config?: ConfigRuntimeService) {}

  async source(): Promise<string | null> {
    try { const v = await this.config?.get('qi.deviceDays.source'); return typeof v === 'string' ? v : null; } catch { return null; }
  }

  async list(period: string) {
    monthRangeLocal(period);
    const [rows, source, wards] = await Promise.all([
      this.prisma.deviceDayEntry.findMany({ where: { period }, orderBy: [{ wardKey: 'asc' }, { deviceType: 'asc' }] }),
      this.source(),
      this.prisma.ward.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return { period, source, accepting: source === 'MANUAL', wards, rows };
  }

  async upsert(dto: { period: string; wardKey?: string; deviceType: string; days: number }, actorId: string) {
    const source = await this.source();
    if (source !== 'MANUAL') {
      throw new ConflictException({ code: 'QI_DEVICE_DAYS_NOT_ACCEPTING', message: '기구일수 수기 입력이 열려 있지 않습니다(결정 qi.deviceDays.source)', source });
    }
    const { end } = monthRangeLocal(dto.period);
    if (end > new Date(Date.now() + 31 * 86_400_000)) throw new BadRequestException({ code: 'QI_DEVICE_DAYS_FUTURE', message: '미래 달은 입력할 수 없습니다' });
    if (!(QI_DEVICE_TYPES as readonly string[]).includes(dto.deviceType)) throw new BadRequestException({ code: 'QI_DEVICE_TYPE', message: '기구 종류가 올바르지 않습니다' });
    if (!Number.isInteger(dto.days) || dto.days < 0 || dto.days > 100_000) throw new BadRequestException({ code: 'QI_DEVICE_DAYS_RANGE', message: '기구일수는 0 이상 정수입니다' });
    const wardKey = dto.wardKey ?? '';
    if (wardKey) {
      const w = await this.prisma.ward.findUnique({ where: { id: wardKey }, select: { id: true } });
      if (!w) throw new BadRequestException({ code: 'QI_DEVICE_WARD', message: '병동을 찾을 수 없습니다' });
    }
    return this.prisma.deviceDayEntry.upsert({
      where: { period_wardKey_deviceType: { period: dto.period, wardKey, deviceType: dto.deviceType } },
      create: { period: dto.period, wardKey, deviceType: dto.deviceType, days: dto.days, enteredBy: actorId },
      update: { days: dto.days, enteredBy: actorId },
    });
  }
}
