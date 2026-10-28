import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BlockchainCertService } from '../blockchain-cert/blockchain-cert.service';
import { PolicyService } from './policy.service';
import { ApprovalService } from './approval.service';

// FR-10~14/44: 인증서 통합 관리(발급/갱신/정지/복원/폐기 4-eyes/CRL)
@Injectable()
export class CertAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cert: BlockchainCertService,
    private readonly policy: PolicyService,
    private readonly approvals: ApprovalService,
  ) {}

  listByUser(userId: string) {
    return this.cert.getMyCerts(userId);
  }

  /** 발급 — 정책 기반 유효기간 적용 */
  async issue(
    actorId: string,
    dto: { userId: string; subjectDn: string; publicKey: string; algorithm: string; licenseNumber?: string; licenseType?: string; department?: string; specialty?: string },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { role: true, department: true } });
    if (!user) throw new NotFoundException('직원 없음');
    // 🔴 (2026-10-13 결함 발굴 C2) 종전엔 `identityVerified: true` 를 근거 없이 찍었다(갱신도 승격) — 이 경로는 본인확인을
    //    기록하지도 증빙을 받지도 않고, 공개키도 관리자가 넣는다. 하지 않은 확인을 했다고 적지 않는다(자체 발급 경로와 같은 규칙).
    //    본문이 그 값을 실어 와도 덮는다(뒤에 둔다).
    const created = await this.cert.issue({ ownerType: 'STAFF', ...dto, identityVerified: undefined });
    const pol = await this.policy.resolve(user.role, dto.department ?? user.department);
    const expiresAt = new Date(Date.now() + pol.certValidityDays * 86400000);
    const updated = await this.prisma.blockchainCertificate.update({ where: { id: created.id }, data: { expiresAt } });
    await this.audit(actorId, AuditAction.CREATE, created.id, { op: 'ISSUE', userId: dto.userId, expiresAt: expiresAt.toISOString() });
    return updated;
  }

  /** 갱신(rekey) — 새 키로 재발급(기존 ACTIVE 자동 폐기) + 정책 유효기간 */
  async renew(actorId: string, id: string, dto: { publicKey: string; algorithm: string; subjectDn?: string }) {
    const c = await this.require(id);
    if (!c.userId) throw new BadRequestException('STAFF 인증서만 갱신 가능');
    const issued = await this.issue(actorId, {
      userId: c.userId,
      subjectDn: dto.subjectDn ?? c.subjectDn,
      publicKey: dto.publicKey,
      algorithm: dto.algorithm,
      licenseNumber: c.licenseNumber ?? undefined,
      licenseType: c.licenseType ?? undefined,
      department: c.department ?? undefined,
      specialty: c.specialty ?? undefined,
    });
    await this.audit(actorId, AuditAction.UPDATE, id, { op: 'RENEW', newCertId: issued.id });
    return issued;
  }

  async suspend(actorId: string, id: string, reason?: string) {
    const c = await this.require(id);
    if (c.userId === actorId) throw new ForbiddenException('본인 인증서는 직접 정지할 수 없습니다(타 권한자 경유).'); // FR-42
    if (c.status !== 'ACTIVE') throw new BadRequestException('ACTIVE 인증서만 정지 가능');
    const r = await this.prisma.blockchainCertificate.update({ where: { id }, data: { status: 'SUSPENDED', revokeReason: reason ?? '관리자 정지' } });
    await this.audit(actorId, AuditAction.UPDATE, id, { op: 'SUSPEND', reason: reason ?? null });
    return r;
  }

  async restore(actorId: string, id: string) {
    const r = await this.cert.restore(id);
    await this.audit(actorId, AuditAction.UPDATE, id, { op: 'RESTORE' });
    return r;
  }

  /**
   * 폐기 — 4-eyes. 승인 없으면 요청 생성(pending). 승인 후 재호출 시 실제 폐기.
   * ⚠️ 폐기는 미래 서명만 차단(step-up 동기화). 과거 서명·블록체인 타임스탬프는 유지(FR-44).
   */
  async revoke(actorId: string, id: string, reason: string) {
    const c = await this.require(id);
    if (c.userId === actorId) throw new ForbiddenException('본인 인증서는 직접 폐기할 수 없습니다(타 권한자 경유).'); // FR-42
    try {
      await this.approvals.consume('CERT_REVOKE', id, actorId); // 승인된 건만 통과
    } catch (e) {
      if (e instanceof ForbiddenException) {
        const ap = await this.approvals.request('CERT_REVOKE', 'CERT', id, actorId, reason);
        return { pending: true, approvalId: ap.id, message: '2인 승인(4-eyes)이 필요합니다. 승인 후 폐기됩니다.' };
      }
      throw e;
    }
    const revoked = await this.cert.revoke(id, reason);
    await this.audit(actorId, AuditAction.DELETE, id, { op: 'REVOKE', reason });
    return { pending: false, cert: revoked };
  }

  crl() {
    return this.cert.getCrl();
  }

  private async require(id: string) {
    const c = await this.prisma.blockchainCertificate.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('인증서 없음');
    return c;
  }

  private async audit(actorId: string, action: AuditAction, certId: string, changes: Prisma.InputJsonObject) {
    await this.prisma.auditLog
      .create({ data: { userId: actorId, action, resourceType: 'BLOCKCHAIN_CERTIFICATE', resourceId: certId, changes } })
      .catch(() => undefined);
  }
}
