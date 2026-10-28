import { Injectable, BadRequestException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface EffectivePolicy {
  reEnrollDays: number;
  idleExpireDays: number;
  certValidityDays: number;
  expiryWarnDays: number;
  maxDevices: number;
  inPersonRoles: string[];
  syncedPasskey: string;
}

const DEFAULTS: EffectivePolicy = {
  reEnrollDays: 180,
  idleExpireDays: 60,
  certValidityDays: 365,
  expiryWarnDays: 14,
  maxDevices: 3,
  inPersonRoles: ['DOCTOR'],
  syncedPasskey: 'ROLE_BASED',
};

const FIELDS: (keyof EffectivePolicy)[] = [
  'reEnrollDays', 'idleExpireDays', 'certValidityDays', 'expiryWarnDays', 'maxDevices', 'inPersonRoles', 'syncedPasskey',
];

// FR-25: 인증 정책 — GLOBAL ← ROLE ← DEPARTMENT 오버라이드
@Injectable()
export class PolicyService {
  constructor(private readonly prisma: PrismaService) {}

  /** 역할/부서에 적용되는 실효 정책 (고보증 역할은 재등록 주기 절반) */
  async resolve(role?: string | null, department?: string | null): Promise<EffectivePolicy> {
    const rows = await this.prisma.authPolicy.findMany({
      where: {
        OR: [
          { scope: 'GLOBAL', scopeRef: '*' },
          ...(role ? [{ scope: 'ROLE', scopeRef: role }] : []),
          ...(department ? [{ scope: 'DEPARTMENT', scopeRef: department }] : []),
        ],
      },
    });
    const byScope = (s: string, ref: string) => rows.find((r) => r.scope === s && r.scopeRef === ref);
    const layers = [byScope('GLOBAL', '*'), role ? byScope('ROLE', role) : undefined, department ? byScope('DEPARTMENT', department) : undefined];

    const eff: EffectivePolicy = { ...DEFAULTS };
    for (const layer of layers) {
      if (!layer) continue;
      for (const f of FIELDS) {
        const v = (layer as unknown as Record<string, unknown>)[f];
        if (v !== undefined && v !== null) (eff as unknown as Record<string, unknown>)[f] = v;
      }
    }
    // 고보증 역할: 재등록 주기 단축(절반, 최소 30)
    if (role && eff.inPersonRoles.includes(role)) {
      eff.reEnrollDays = Math.max(30, Math.floor(eff.reEnrollDays / 2));
    }
    return eff;
  }

  list() {
    return this.prisma.authPolicy.findMany({ orderBy: [{ scope: 'asc' }, { scopeRef: 'asc' }] });
  }

  async upsert(actorId: string, scope: string, scopeRef: string, data: Partial<EffectivePolicy>) {
    if (!['GLOBAL', 'ROLE', 'DEPARTMENT'].includes(scope)) throw new BadRequestException('scope 오류');
    const ref = scope === 'GLOBAL' ? '*' : scopeRef;
    if (scope !== 'GLOBAL' && (!ref || ref === '*')) throw new BadRequestException('ROLE/DEPARTMENT는 scopeRef 필수');
    const clean = this.sanitize(data);
    const row = await this.prisma.authPolicy.upsert({
      where: { scope_scopeRef: { scope, scopeRef: ref } },
      create: { scope, scopeRef: ref, ...clean, updatedBy: actorId },
      update: { ...clean, updatedBy: actorId },
    });
    await this.prisma.auditLog
      .create({ data: { userId: actorId, action: AuditAction.UPDATE, resourceType: 'AUTH_POLICY', resourceId: row.id, changes: clean as Prisma.InputJsonObject } })
      .catch(() => undefined);
    return row;
  }

  /** FR-45: 적용 전 영향 미리보기 (대상 디바이스 수) */
  async preview(scope: string, scopeRef: string, data: Partial<EffectivePolicy>) {
    const eff = { ...(await this.resolve(scope === 'ROLE' ? scopeRef : null, scope === 'DEPARTMENT' ? scopeRef : null)), ...this.sanitize(data) };
    const where: Prisma.UserWhereInput =
      scope === 'ROLE' ? { role: scopeRef as never } : scope === 'DEPARTMENT' ? { department: scopeRef } : {};
    const users = await this.prisma.user.findMany({ where: { ...where, isActive: true }, select: { id: true } });
    const userIds = users.map((u) => u.id);
    const devices = await this.prisma.staffDevice.findMany({
      where: { userId: { in: userIds }, status: 'ACTIVE' },
      select: { lastUsedAt: true, verifiedAt: true },
    });
    const now = Date.now();
    const idleMs = eff.idleExpireDays * 86400000;
    const wouldExpire = devices.filter((d) => now - (d.lastUsedAt ?? d.verifiedAt).getTime() > idleMs).length;
    return { scope, scopeRef, effective: eff, affectedUsers: userIds.length, affectedDevices: devices.length, wouldExpireNow: wouldExpire };
  }

  private sanitize(d: Partial<EffectivePolicy>): Partial<EffectivePolicy> {
    const out: Partial<EffectivePolicy> = {};
    for (const f of FIELDS) if (d[f] !== undefined) (out as unknown as Record<string, unknown>)[f] = d[f];
    return out;
  }
}
