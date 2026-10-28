import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { QI_DEVICE_TYPES } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** 기록 시각 허용 오차 — 기기 시계 차이만큼(미래 시각을 기록하지 않는다) */
const FUTURE_SLACK_MS = 5 * 60_000;

/**
 * 기구 삽입·제거 원장(QI 흐름 2026-10-09).
 *
 * 결정 `qi.deviceDays.source` 의 선택지 DEVICE_LEDGER 를 **고를 수 있게** 만드는 원천이다 — 기록 자체는 임상 사실이라
 * 결정과 무관하게 받는다(결정 전 기록이 있어야 결정 후 첫 달부터 분모가 찬다). 분모로 쓰는지는 설정이 정한다.
 *  · 지우지 않는다 — 잘못 넣은 행은 무효(사유 5자 이상) · 제거는 한 번(제거 ≥ 삽입 · 미래 불가)
 *  · 동시에 두 사람이 제거를 누르면 한 쪽은 409(조건부 갱신)
 */
@Injectable()
export class DeviceLineService {
  constructor(private readonly prisma: PrismaService) {}

  private parseInstant(v: string, field: string): Date {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new BadRequestException({ code: 'DEVICE_LINE_TIME', message: '시각 형식이 올바르지 않습니다', details: { field } });
    if (d.getTime() > Date.now() + FUTURE_SLACK_MS) throw new BadRequestException({ code: 'DEVICE_LINE_FUTURE', message: '미래 시각은 기록할 수 없습니다', details: { field } });
    return d;
  }

  async list(q: { patientId?: string; admissionId?: string; includeVoided?: boolean }) {
    if (!q.patientId && !q.admissionId) throw new BadRequestException({ code: 'DEVICE_LINE_SCOPE', message: '환자 또는 입원을 지정해주세요' });
    return this.prisma.deviceLine.findMany({
      where: {
        ...(q.patientId ? { patientId: q.patientId } : {}),
        ...(q.admissionId ? { admissionId: q.admissionId } : {}),
        ...(q.includeVoided ? {} : { voidedAt: null }),
      },
      orderBy: [{ removedAt: { sort: 'desc', nulls: 'first' } }, { insertedAt: 'desc' }],
      take: 200,
    });
  }

  async record(dto: { patientId: string; admissionId?: string; deviceType: string; site?: string; insertedAt: string; note?: string }, actorId: string) {
    if (!(QI_DEVICE_TYPES as readonly string[]).includes(dto.deviceType)) throw new BadRequestException({ code: 'DEVICE_LINE_TYPE', message: '기구 종류가 올바르지 않습니다' });
    const insertedAt = this.parseInstant(dto.insertedAt, 'insertedAt');
    const patient = await this.prisma.patient.findUnique({ where: { id: dto.patientId }, select: { id: true } });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다');
    if (dto.admissionId) {
      const adm = await this.prisma.admission.findUnique({ where: { id: dto.admissionId }, select: { patientId: true } });
      if (!adm || adm.patientId !== dto.patientId) throw new BadRequestException({ code: 'DEVICE_LINE_ADMISSION', message: '이 환자의 입원이 아닙니다' });
    }
    return this.prisma.deviceLine.create({
      data: {
        patientId: dto.patientId, admissionId: dto.admissionId ?? null, deviceType: dto.deviceType,
        site: dto.site?.trim() || null, insertedAt, insertedBy: actorId, note: dto.note?.trim() || null,
      },
    });
  }

  async remove(id: string, dto: { removedAt: string }, actorId: string) {
    const row = await this.prisma.deviceLine.findUnique({ where: { id }, select: { insertedAt: true, removedAt: true, voidedAt: true } });
    if (!row) throw new NotFoundException('기구 기록을 찾을 수 없습니다');
    const removedAt = this.parseInstant(dto.removedAt, 'removedAt');
    if (removedAt < row.insertedAt) throw new BadRequestException({ code: 'DEVICE_LINE_ORDER', message: '제거 시각이 삽입 시각보다 이릅니다' });
    const r = await this.prisma.deviceLine.updateMany({ where: { id, removedAt: null, voidedAt: null }, data: { removedAt, removedBy: actorId } });
    if (!r.count) throw new ConflictException({ code: 'DEVICE_LINE_CLOSED', message: '이미 제거됐거나 무효 처리된 기록입니다' });
    return this.prisma.deviceLine.findUnique({ where: { id } });
  }

  async void(id: string, reason: string, actorId: string) {
    if (!reason || reason.trim().length < 5) throw new BadRequestException({ code: 'DEVICE_LINE_VOID_REASON', message: '무효 사유를 5자 이상 적어주세요' });
    const r = await this.prisma.deviceLine.updateMany({ where: { id, voidedAt: null }, data: { voidedAt: new Date(), voidedBy: actorId, voidReason: reason.trim() } });
    if (!r.count) {
      const exists = await this.prisma.deviceLine.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundException('기구 기록을 찾을 수 없습니다');
      throw new ConflictException({ code: 'DEVICE_LINE_VOIDED', message: '이미 무효 처리된 기록입니다' });
    }
    return this.prisma.deviceLine.findUnique({ where: { id } });
  }
}
