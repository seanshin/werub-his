import { Injectable, BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { FloorService } from '../floor/floor.service';
import { currentLocationScope } from '../floor/current-location';

const PATIENT_SELECT = { id: true, mrn: true, familyName: true, givenName: true } as const;

// 환자 QR 동선 체크인 — 장소 스테이션이 환자 위치 QR(plt)을 스캔 → PatientLocation 기록 + floor SSE.
@Injectable()
export class PatientFlowService {
  constructor(private readonly prisma: PrismaService, private readonly floor: FloorService) {}

  private hash(s: string) { return createHash('sha256').update(s).digest('hex'); }

  // ── 스테이션(기기 위치 등록) ──
  async registerStation(zoneId: string, label: string, deviceType: string) {
    const zone = await this.prisma.spaceNode.findUnique({ where: { id: zoneId }, select: { id: true, name: true } });
    if (!zone) throw new BadRequestException('유효한 구역(SpaceNode)이 아닙니다.');
    const key = `stn_${randomBytes(24).toString('hex')}`;
    const st = await this.prisma.locationStation.create({
      data: { zoneId, label, deviceType, keyHash: this.hash(key) },
    });
    // 키 평문은 1회만 반환(이후 해시만 보관)
    return { id: st.id, zoneId, zoneName: zone.name, label, deviceType, stationKey: key };
  }

  async listStations() {
    const stations = await this.prisma.locationStation.findMany({ orderBy: { createdAt: 'desc' } });
    const zoneIds = [...new Set(stations.map((s) => s.zoneId))];
    const zones = await this.prisma.spaceNode.findMany({ where: { id: { in: zoneIds } }, select: { id: true, name: true, code: true, floor: true } });
    const byId = new Map(zones.map((z) => [z.id, z]));
    return stations.map((s) => ({
      id: s.id, label: s.label, deviceType: s.deviceType, isActive: s.isActive, lastSeenAt: s.lastSeenAt,
      zoneId: s.zoneId, zone: byId.get(s.zoneId) ?? null,
    }));
  }

  async setStationActive(id: string, isActive: boolean) {
    return this.prisma.locationStation.update({ where: { id }, data: { isActive } });
  }

  /** 등록용 구역 목록(활성 SpaceNode). */
  async zones() {
    return this.prisma.spaceNode.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true, floor: true, spaceType: true, department: true },
      orderBy: [{ floor: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  // ── 위치추적 동의(가입/접수 시) ──
  private async hasLocationConsent(patientId: string): Promise<boolean> {
    const c = await this.prisma.registrationConsent.findFirst({
      where: { patientId, type: 'LOCATION', agreed: true, revokedAt: null },
      select: { id: true },
    });
    return !!c;
  }

  async recordLocationConsent(patientId: string, signedBy?: string) {
    const exists = await this.prisma.registrationConsent.findFirst({ where: { patientId, type: 'LOCATION', revokedAt: null } });
    if (exists) {
      return this.prisma.registrationConsent.update({ where: { id: exists.id }, data: { agreed: true, signedAt: new Date(), signedBy, signMethod: 'HIS' } });
    }
    return this.prisma.registrationConsent.create({
      data: { patientId, type: 'LOCATION', agreed: true, signedAt: new Date(), signedBy, signMethod: 'HIS' },
    });
  }

  // ── 환자 위치 QR 토큰(plt) 발급 ──
  async issueToken(patientId: string, mode: string, issuedVia?: string, consent?: boolean, signedBy?: string) {
    const patient = await this.prisma.patient.findUnique({ where: { id: patientId }, select: PATIENT_SELECT });
    if (!patient) throw new NotFoundException('환자를 찾을 수 없습니다.');
    if (consent) await this.recordLocationConsent(patientId, signedBy);
    const token = randomBytes(24).toString('base64url'); // 32자
    const now = new Date();
    let expiresAt: Date;
    if (mode === 'ADMISSION') {
      expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 재원기간(최대 30일·재발급 가능)
    } else {
      expiresAt = new Date(now); expiresAt.setHours(24, 0, 0, 0); // 당일 자정
    }
    await this.prisma.patientLocToken.create({ data: { token, patientId, mode, issuedVia, expiresAt } });
    const qrDataUrl = await QRCode.toDataURL(token, { width: 320, margin: 2 }).catch(() => undefined);
    return { token, mode, expiresAt: expiresAt.toISOString(), qrDataUrl, patient, consent: await this.hasLocationConsent(patientId) };
  }

  // ── 체크인(스테이션 스캔) ──
  async checkin(stationKey: string | undefined, plt: string) {
    if (!stationKey) throw new UnauthorizedException('스테이션 키가 필요합니다.');
    const station = await this.prisma.locationStation.findFirst({ where: { keyHash: this.hash(stationKey), isActive: true } });
    if (!station) throw new UnauthorizedException('등록되지 않았거나 비활성 스테이션입니다.');

    const tok = await this.prisma.patientLocToken.findUnique({ where: { token: plt } });
    if (!tok || tok.revokedAt || tok.expiresAt < new Date()) {
      throw new BadRequestException('만료되었거나 유효하지 않은 환자 QR입니다.');
    }
    const patientId = tok.patientId;
    const toZoneId = station.zoneId;
    const consentMissing = !(await this.hasLocationConsent(patientId)); // 위치추적 미동의 환자 표시(소프트)

    const open = await this.prisma.patientLocation.findFirst({
      where: { patientId, leftAt: null }, orderBy: { enteredAt: 'desc' },
    });
    const fromZoneId = open?.zoneId ?? null;

    // 같은 구역 재스캔 → 중복 기록 없이 통과(touch)
    if (fromZoneId === toZoneId) {
      await this.prisma.locationStation.update({ where: { id: station.id }, data: { lastSeenAt: new Date() } });
      const [p, z] = await Promise.all([
        this.prisma.patient.findUnique({ where: { id: patientId }, select: PATIENT_SELECT }),
        this.prisma.spaceNode.findUnique({ where: { id: toZoneId }, select: { id: true, name: true } }),
      ]);
      return { patient: p, fromZone: null, toZone: z, duplicate: true, consentMissing };
    }

    // 이전 구역 마감 + 새 구역 기록 + 동선 보드 SSE — 위치 원장의 단일 쓰기 경로(관측: QR 스캔)
    await this.floor.recordLocation({
      patientId, zoneId: toZoneId, source: 'OBSERVED_QR', granularity: 'ZONE', status: 'PRESENT', // QR 스테이션은 구역에 묶인다
      eventType: 'QR_CHECKIN',
      metadata: { stationId: station.id, deviceType: station.deviceType } as Prisma.InputJsonValue,
    });
    await this.prisma.locationStation.update({ where: { id: station.id }, data: { lastSeenAt: new Date() } });

    const [p, toZone, fromZone] = await Promise.all([
      this.prisma.patient.findUnique({ where: { id: patientId }, select: PATIENT_SELECT }),
      this.prisma.spaceNode.findUnique({ where: { id: toZoneId }, select: { id: true, name: true, floor: true } }),
      fromZoneId ? this.prisma.spaceNode.findUnique({ where: { id: fromZoneId }, select: { id: true, name: true } }) : Promise.resolve(null),
    ]);
    return { patient: p, fromZone, toZone, enteredAt: new Date().toISOString(), consentMissing };
  }

  // ── 구역별 체류/대기 통계(동선 모니터) ──
  async zoneStats() {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    // 현재 = 정본 판정(오래된 열린 기록은 '현재' 칸에 세지 않는다 · current-location.ts)
    const scope = await currentLocationScope(this.prisma);
    const [openRows, closed] = await Promise.all([
      this.prisma.patientLocation.groupBy({ by: ['zoneId'], where: scope.current, _count: { _all: true } }),
      this.prisma.patientLocation.findMany({
        where: { leftAt: { not: null }, enteredAt: { gte: startOfDay }, duration: { not: null } },
        select: { zoneId: true, duration: true },
      }),
    ]);
    const dwell = new Map<string, { sum: number; n: number }>();
    for (const r of closed) {
      const d = dwell.get(r.zoneId) ?? { sum: 0, n: 0 };
      d.sum += r.duration ?? 0; d.n += 1; dwell.set(r.zoneId, d);
    }
    const zoneIds = [...new Set([...openRows.map((o) => o.zoneId), ...dwell.keys()])];
    const zones = await this.prisma.spaceNode.findMany({
      where: { id: { in: zoneIds } },
      select: { id: true, name: true, code: true, floor: true, spaceType: true, department: true },
    });
    const openById = new Map(openRows.map((o) => [o.zoneId, o._count._all]));
    return zones
      .map((z) => {
        const d = dwell.get(z.id);
        return {
          zoneId: z.id, name: z.name, code: z.code, floor: z.floor, spaceType: z.spaceType, department: z.department,
          current: openById.get(z.id) ?? 0,
          avgDwellMin: d && d.n ? Math.round(d.sum / d.n) : null,
          completedToday: d?.n ?? 0,
        };
      })
      .sort((a, b) => (b.current - a.current) || (a.floor ?? 0) - (b.floor ?? 0));
  }

  // ── 환자 동선 타임라인 ──
  async patientTimeline(patientId: string, limit = 50) {
    const rows = await this.prisma.patientLocation.findMany({
      where: { patientId },
      orderBy: { enteredAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    const zoneIds = [...new Set(rows.map((r) => r.zoneId))];
    const zones = await this.prisma.spaceNode.findMany({ where: { id: { in: zoneIds } }, select: { id: true, name: true, code: true, floor: true } });
    const byId = new Map(zones.map((z) => [z.id, z]));
    return rows.map((r) => ({
      id: r.id, zoneId: r.zoneId, zone: byId.get(r.zoneId) ?? null,
      enteredAt: r.enteredAt, leftAt: r.leftAt, duration: r.duration, eventType: r.eventType,
    }));
  }
}
