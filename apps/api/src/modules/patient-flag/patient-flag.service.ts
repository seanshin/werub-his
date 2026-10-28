import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

const TYPES = ['MALICIOUS', 'VIP', 'ACQUAINTANCE'];

@Injectable()
export class PatientFlagService {
  constructor(private readonly prisma: PrismaService) {}

  private async userMap(ids: (string | null | undefined)[]) {
    const uniq = [...new Set(ids.filter(Boolean) as string[])];
    const users = uniq.length ? await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, familyName: true, givenName: true, role: true, department: true } }) : [];
    return new Map(users.map((u) => [u.id, u]));
  }

  /** 마킹 — 악성('루비')은 누구나, VIP/지인은 발견 시. 1인 1유형 1회(upsert) */
  async flag(data: { patientId: string; flagType: string; reason?: string; relatedUserId?: string; relation?: string; flaggedBy: string }) {
    if (!TYPES.includes(data.flagType)) throw new BadRequestException('유효하지 않은 마킹 유형입니다');
    if ((data.flagType === 'ACQUAINTANCE' || data.flagType === 'VIP') && !data.relatedUserId) {
      throw new BadRequestException('VIP/지인 마킹은 "누구의 지인인지"(직원)를 지정해야 합니다');
    }
    return this.prisma.patientFlag.upsert({
      where: { patientId_flaggedBy_flagType: { patientId: data.patientId, flaggedBy: data.flaggedBy, flagType: data.flagType } },
      create: { patientId: data.patientId, flagType: data.flagType, reason: data.reason?.slice(0, 1000), relatedUserId: data.relatedUserId, relation: data.relation, flaggedBy: data.flaggedBy },
      update: { reason: data.reason?.slice(0, 1000), relatedUserId: data.relatedUserId, relation: data.relation, isActive: true },
    });
  }

  /** 환자별 마킹 요약 — 악성 카운트(루비 N) + VIP + 지인 목록 */
  async getForPatient(patientId: string) {
    const flags = await this.prisma.patientFlag.findMany({ where: { patientId, isActive: true }, orderBy: { createdAt: 'desc' } });
    const umap = await this.userMap([...flags.map((f) => f.flaggedBy), ...flags.map((f) => f.relatedUserId)]);
    const decorate = (f: typeof flags[number]) => ({ ...f, flagger: umap.get(f.flaggedBy) ?? null, related: f.relatedUserId ? umap.get(f.relatedUserId) ?? null : null });
    const malicious = flags.filter((f) => f.flagType === 'MALICIOUS');
    return {
      rubyCount: malicious.length,                       // '루비' 마킹 수
      malicious: malicious.map(decorate),
      vip: flags.filter((f) => f.flagType === 'VIP').map(decorate),
      acquaintance: flags.filter((f) => f.flagType === 'ACQUAINTANCE').map(decorate),
    };
  }

  /** 여러 환자 마킹 요약 (목록 배지용) — { patientId: { ruby, vip, acq } } */
  async summaryFor(patientIds: string[]) {
    const ids = [...new Set(patientIds.filter(Boolean))].slice(0, 200);
    if (!ids.length) return {};
    const flags = await this.prisma.patientFlag.findMany({ where: { patientId: { in: ids }, isActive: true }, select: { patientId: true, flagType: true } });
    const map: Record<string, { ruby: number; vip: number; acq: number }> = {};
    for (const f of flags) {
      const e = map[f.patientId] ?? { ruby: 0, vip: 0, acq: 0 };
      if (f.flagType === 'MALICIOUS') e.ruby++;
      else if (f.flagType === 'VIP') e.vip++;
      else if (f.flagType === 'ACQUAINTANCE') e.acq++;
      map[f.patientId] = e;
    }
    return map;
  }

  /** 내가 이 환자에 남긴 마킹(토글용) */
  async myFlags(patientId: string, userId: string) {
    const flags = await this.prisma.patientFlag.findMany({ where: { patientId, flaggedBy: userId, isActive: true }, select: { flagType: true } });
    return flags.map((f) => f.flagType);
  }

  /** 마킹 해제 (본인 또는 관리자) */
  async unflag(patientId: string, flagType: string, userId: string) {
    await this.prisma.patientFlag.updateMany({ where: { patientId, flagType, flaggedBy: userId, isActive: true }, data: { isActive: false } });
    return { removed: true };
  }

  async removeById(id: string) {
    await this.prisma.patientFlag.update({ where: { id }, data: { isActive: false } });
    return { removed: true };
  }

  /** 관리자 목록 — 유형별 마킹된 환자 (악성은 환자별 집계) */
  async list(flagType?: string) {
    const where: any = { isActive: true };
    if (flagType) where.flagType = flagType;
    const flags = await this.prisma.patientFlag.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 500,
      include: { patient: { select: { id: true, familyName: true, givenName: true, mrn: true } } },
    });
    const umap = await this.userMap([...flags.map((f) => f.flaggedBy), ...flags.map((f) => f.relatedUserId)]);

    if (flagType === 'MALICIOUS' || !flagType) {
      // 악성은 환자별 집계(루비 N)
      const map = new Map<string, { patient: any; rubyCount: number; reasons: string[]; lastAt: Date }>();
      for (const f of flags.filter((x) => x.flagType === 'MALICIOUS')) {
        const e = map.get(f.patientId) ?? { patient: f.patient, rubyCount: 0, reasons: [], lastAt: f.createdAt };
        e.rubyCount++; if (f.reason) e.reasons.push(f.reason);
        if (f.createdAt > e.lastAt) e.lastAt = f.createdAt;
        map.set(f.patientId, e);
      }
      const malicious = [...map.values()].sort((a, b) => b.rubyCount - a.rubyCount);
      if (flagType === 'MALICIOUS') return { malicious };
      const others = flags.filter((x) => x.flagType !== 'MALICIOUS').map((f) => ({ ...f, flagger: umap.get(f.flaggedBy) ?? null, related: f.relatedUserId ? umap.get(f.relatedUserId) ?? null : null }));
      return { malicious, others };
    }
    return { items: flags.map((f) => ({ ...f, flagger: umap.get(f.flaggedBy) ?? null, related: f.relatedUserId ? umap.get(f.relatedUserId) ?? null : null })) };
  }
}
