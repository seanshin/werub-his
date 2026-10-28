import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma, AuditAction } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Permission } from '../auth/rbac/permission.types';

const CRED_PERMISSIONS = new Set<string>([
  Permission.CRED_DEVICE_MANAGE,
  Permission.CRED_CERT_ISSUE,
  Permission.CRED_CERT_REVOKE,
  Permission.CRED_RECOVERY_APPROVE,
  Permission.CRED_POLICY_MANAGE,
  Permission.CRED_AUDIT_READ,
]);

// FR-40/54: per-user 자격증명 관리 권한 grant (SECURITY_ADMIN/AUDITOR 지정·위임)
@Injectable()
export class GrantService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId?: string) {
    return this.prisma.adminPermissionGrant.findMany({
      where: userId ? { userId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async grant(grantedBy: string, userId: string, permission: string, expiresAt?: string) {
    if (!CRED_PERMISSIONS.has(permission)) {
      throw new BadRequestException(`허용되지 않은 권한: ${permission}`);
    }
    const exp = expiresAt ? new Date(expiresAt) : null;
    const row = await this.prisma.adminPermissionGrant.upsert({
      where: { userId_permission: { userId, permission } },
      create: { userId, permission, grantedBy, expiresAt: exp },
      update: { grantedBy, expiresAt: exp },
    });
    await this.audit(grantedBy, AuditAction.CREATE, userId, { op: 'GRANT', permission, expiresAt: exp?.toISOString() ?? null });
    return row;
  }

  async revoke(actorId: string, id: string) {
    const row = await this.prisma.adminPermissionGrant.findUnique({ where: { id } });
    if (!row) throw new BadRequestException('grant 없음');
    await this.prisma.adminPermissionGrant.delete({ where: { id } });
    await this.audit(actorId, AuditAction.DELETE, row.userId, { op: 'REVOKE', permission: row.permission });
    return { ok: true };
  }

  private async audit(actorId: string, action: AuditAction, targetUserId: string, changes: Prisma.InputJsonObject) {
    await this.prisma.auditLog
      .create({
        data: {
          userId: actorId,
          action,
          resourceType: 'ADMIN_PERMISSION_GRANT',
          resourceId: targetUserId,
          changes,
        },
      })
      .catch(() => undefined);
  }
}
