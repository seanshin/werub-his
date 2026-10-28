import { Injectable, Logger, NotFoundException, BadRequestException, ServiceUnavailableException, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { ConfigRuntimeService } from '../../config/config-runtime.service';
import { mergeTargetMap } from '../../../common/qi-targets';

// Break-glass (FR-51) — 인증 연속성. 책임자 승인 하 시간제한 임시 접근.
// TTL 기본값 개정 표면 = config security.btg.defaultMinutes/maxMinutes(§7 P2) — 아래 상수는 폴백.
const DEFAULT_MIN = 30;
const MAX_MIN = 120;

@Injectable()
export class BreakGlassService {
  private readonly logger = new Logger(BreakGlassService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly notify: NotificationService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService,
  ) {}

  async grant(
    approverId: string,
    dto: { staffUserId: string; reason: string; scope?: string; minutes?: number; secondApproverId?: string },
  ) {
    // security.btg.* — 게이트 설정을 **한 번에** 읽는다. 🔴 종전에는 각 조회가
    // `.catch(() => true)` / `.catch(() => null)` 로 실패를 삼켜, 설정 조회가 실패하면
    // ① 비활성 게이트를 통과시켜 **비상열람 토큰을 발급**하고 ② 운영이 좁혀 둔 maxMinutes 를
    // 무시하고 폴백 상한(120분)까지 열어줬다(fail-open). 이 저장소 규약은 **fail-closed** 다
    // — 게이트 값을 모르면 발급하지 않고, 모른다는 사실을 남긴다(2026-08-14 W8).
    const gate = await this.readBtgGate();
    if (gate.enabled === false || gate.enabled === 'false') {
      throw new BadRequestException({ code: 'BTG_DISABLED', message: '직원 응급접근(Break-glass)이 비활성 상태입니다(security.btg.enabled)' });
    }
    if (!dto.reason?.trim()) throw new BadRequestException('사유는 필수입니다.');
    const staff = await this.prisma.user.findUnique({ where: { id: dto.staffUserId } });
    if (!staff) throw new NotFoundException('대상 직원을 찾을 수 없습니다.');

    const ttl = mergeTargetMap({ defaultMinutes: DEFAULT_MIN, maxMinutes: MAX_MIN }, {
      defaultMinutes: gate.defaultMinutes,
      maxMinutes: gate.maxMinutes,
    });
    const minutes = Math.min(dto.minutes ?? ttl.defaultMinutes, ttl.maxMinutes);
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const approvers = [approverId, ...(dto.secondApproverId ? [dto.secondApproverId] : [])];
    const approvalKind = dto.secondApproverId ? 'TWO_PERSON' : 'SUPERVISOR';

    const record = await this.prisma.authEmergencyAccess.create({
      data: {
        userId: dto.staffUserId,
        reason: dto.reason,
        approvers,
        approvalKind,
        scope: dto.scope ?? 'FULL',
        expiresAt,
      },
    });

    // 시간제한 임시 접근 토큰 (refresh 없음 — 하드 만료)
    const accessToken = this.jwt.sign(
      { sub: staff.id, email: staff.email, role: staff.role },
      { secret: this.config.getOrThrow<string>('AUTH_SECRET'), expiresIn: minutes * 60 },
    );

    // 강조 감사
    await this.prisma.auditLog
      .create({
        data: {
          userId: approverId,
          action: 'CREATE',
          resourceType: 'AUTH_EMERGENCY_ACCESS',
          resourceId: record.id,
          changes: { staffUserId: dto.staffUserId, reason: dto.reason, approvalKind, approvers, minutes },
        },
      })
      .catch(() => undefined);

    // 본인 통지 + 보안팀(ADMIN) 실시간 알림
    await this.notifyOne(staff.id, '응급 접근(Break-glass) 발급', `${minutes}분 임시 접근이 부여되었습니다. 본인이 요청하지 않았다면 즉시 보안팀에 알리세요.`, record.id);
    const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
    await Promise.all(
      admins.filter((a) => a.id !== approverId).map((a) =>
        this.notifyOne(a.id, '🚨 Break-glass 발급됨', `${staff.familyName}${staff.givenName} 대상 응급 접근(사유: ${dto.reason})`, record.id),
      ),
    );

    this.logger.warn(`Break-glass GRANT target=${dto.staffUserId} by=${approverId} kind=${approvalKind} ${minutes}m`);
    return { recordId: record.id, accessToken, expiresIn: minutes * 60, expiresAt };
  }

  /**
   * 🔴 fail-closed 게이트 조회 — 조회가 실패하면 **발급을 거부**한다.
   * (게이트 서비스가 아예 배선되지 않은 환경은 '조회 실패'가 아니라 '미배선'이므로,
   *  등재 기본값으로 진행하되 그 사실을 경고로 남긴다 — 조용히 넘어가지 않는다.)
   */
  private async readBtgGate(): Promise<{ enabled: unknown; defaultMinutes: unknown; maxMinutes: unknown }> {
    if (!this.configRuntime) {
      this.logger.warn('security.btg.* 게이트 서비스 미배선 — 등재 기본값으로 진행(발급 정책 확인 필요)');
      return { enabled: undefined, defaultMinutes: null, maxMinutes: null };
    }
    try {
      const [enabled, defaultMinutes, maxMinutes] = await Promise.all([
        this.configRuntime.get('security.btg.enabled'),
        this.configRuntime.get('security.btg.defaultMinutes'),
        this.configRuntime.get('security.btg.maxMinutes'),
      ]);
      return { enabled, defaultMinutes, maxMinutes };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.logger.error(`Break-glass 게이트(security.btg.*) 조회 실패 — 발급 거부(fail-closed): ${reason}`);
      throw new ServiceUnavailableException({
        code: 'BTG_GATE_UNAVAILABLE',
        message: '응급접근 정책(security.btg.*)을 확인할 수 없어 발급을 거부했습니다. 시스템 설정 조회 실패 — 관리자에게 문의하십시오.',
      });
    }
  }

  private async notifyOne(userId: string, title: string, message: string, refId: string) {
    const n = await this.notify
      .create(userId, { type: 'SECURITY', title, message, severity: 'CRITICAL', refType: 'AuthEmergencyAccess', refId })
      .catch(() => null);
    if (n) this.notify.pushNotification(userId, { id: n.id, type: 'SECURITY', title, message, severity: 'CRITICAL', refType: 'AuthEmergencyAccess', refId });
  }

  async list() {
    const rows = await this.prisma.authEmergencyAccess.findMany({
      orderBy: { grantedAt: 'desc' },
      take: 100,
      include: { user: { select: { familyName: true, givenName: true, role: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      staff: `${r.user.familyName}${r.user.givenName}`,
      role: r.user.role,
      reason: r.reason,
      approvalKind: r.approvalKind,
      approvers: r.approvers,
      scope: r.scope,
      grantedAt: r.grantedAt,
      expiresAt: r.expiresAt,
      reviewed: !!r.reviewedAt,
    }));
  }

  async review(reviewerId: string, id: string) {
    const r = await this.prisma.authEmergencyAccess.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('기록을 찾을 수 없습니다.');
    await this.prisma.authEmergencyAccess.update({
      where: { id },
      data: { reviewedBy: reviewerId, reviewedAt: new Date() },
    });
    await this.prisma.auditLog
      .create({ data: { userId: reviewerId, action: 'UPDATE', resourceType: 'AUTH_EMERGENCY_ACCESS', resourceId: id, changes: { action: 'REVIEW' } } })
      .catch(() => undefined);
    return { id, reviewed: true };
  }
}
