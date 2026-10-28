import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { SsoIdpService } from '../auth/sso-idp/sso-idp.service';
import { RegisterTerminalDto, OverrideTerminalDto, KillSwitchDto } from './dto/terminal.dto';

// 제로 트러스트 단말 보안 — D1 골격 (terminal-zero-trust 설계 §1·§3·§4)
// 단말 mode(공용/전용)와 로그인 직군(role)으로 보안 프로파일을 동적 결정.
// PIN/세션풀/draft(§6.4~6.5)는 D2, 페일모드/Kill-Switch(§6.7~)는 D4.

const CLINICIAN_ROLES = ['DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH'];
const PUBLIC_LOCK_SEC = 180; // §6.7.1 공용 3분
const PRIVATE_LOCK_SEC = 600; // §6.7.1 전용 10분

const isClinician = (role: string) => CLINICIAN_ROLES.includes(role);

export interface SecurityProfile {
  deviceUuid: string;
  mode: 'PUBLIC' | 'PRIVATE';
  roleClass: 'CLINICIAN' | 'STAFF';
  ui: string[]; // BLE_PROXIMITY | MULTI_SESSION_POOL | DAILY_PIN | FACE_TRACKING
  clinicalFeatures: boolean;
  stepUpHighRisk: boolean;
  lockTimeoutSec: number;
  selfScopeOnly: boolean;
  dedicated: boolean; // 본인이 전용 단말 전담자인지
  registered: boolean; // 미등록 단말이면 보수적 PUBLIC
  emergencyBypass: boolean; // 응급 Break-glass 활성 → 잠금/PIN 게이트 우회(§6.7.3)
}

@Injectable()
export class TerminalService {
  private readonly logger = new Logger(TerminalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly ssoIdp: SsoIdpService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService,
  ) {}

  // 응급 Break-glass 활성 여부 (§6.7.3) — 잠금/PIN 게이트 우회 판단
  async isEmergencyActive(userId: string): Promise<boolean> {
    const active = await this.prisma.authEmergencyAccess.findFirst({
      where: { userId, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    return !!active;
  }

  // ── 프로파일 결정 (§3, effectiveProfile = f(mode, role)) ──
  async resolveContext(
    user: { id: string; role: string },
    deviceUuid?: string,
    ip?: string,
  ): Promise<SecurityProfile> {
    const registry = await this.findRegistry(deviceUuid, ip);
    const mode = (registry?.mode as 'PUBLIC' | 'PRIVATE') ?? 'PUBLIC'; // 미등록 = 보수적 PUBLIC
    const roleClass = isClinician(user.role) ? 'CLINICIAN' : 'STAFF';
    const dedicated = !!registry?.dedicatedUserId && registry.dedicatedUserId === user.id;

    // 전용 단말에 비전담 로그인 → 감사 경고 (§6.1.1)
    if (mode === 'PRIVATE' && registry?.dedicatedUserId && registry.dedicatedUserId !== user.id) {
      await this.audit.safeLog({
        userId: user.id,
        action: AuditAction.READ,
        resourceType: 'TERMINAL',
        resourceId: registry.id,
        changes: { nonDedicatedLogin: { old: registry.dedicatedUserId, new: user.id } },
      });
      this.logger.warn(`전용 단말 비전담 로그인 device=${registry.deviceUuid} user=${user.id}`);
    }

    return {
      deviceUuid: registry?.deviceUuid ?? deviceUuid ?? 'UNKNOWN',
      mode,
      roleClass,
      ui:
        mode === 'PUBLIC'
          ? ['BLE_PROXIMITY', 'MULTI_SESSION_POOL', 'DAILY_PIN']
          : ['FACE_TRACKING'],
      clinicalFeatures: roleClass === 'CLINICIAN', // 스탭=임상 비노출(§6.1.1-B)
      stepUpHighRisk: roleClass === 'CLINICIAN', // 처방·서명·마약류 단말무관 step-up
      lockTimeoutSec:
        registry?.lockTimeoutSec ?? (mode === 'PUBLIC' ? PUBLIC_LOCK_SEC : PRIVATE_LOCK_SEC),
      selfScopeOnly: roleClass === 'STAFF' && mode === 'PRIVATE', // §6.1.1-D
      dedicated,
      registered: !!registry,
      emergencyBypass: await this.isEmergencyActive(user.id), // §6.7.3 응급 우회
    };
  }

  // deviceUuid 우선, 없으면 IP 보조키 (§1)
  private async findRegistry(deviceUuid?: string, ip?: string) {
    if (deviceUuid) {
      const byUuid = await this.prisma.terminalRegistry.findUnique({ where: { deviceUuid } });
      if (byUuid) return byUuid;
    }
    if (ip) {
      return this.prisma.terminalRegistry.findFirst({
        where: { ipAddress: ip, status: 'ACTIVE' },
      });
    }
    return null;
  }

  // ── 단말 등록/수정 (TERMINAL_MANAGE) ──
  async register(dto: RegisterTerminalDto, actorId: string) {
    const existing = await this.prisma.terminalRegistry.findUnique({
      where: { deviceUuid: dto.deviceUuid },
    });
    const data = {
      deviceUuid: dto.deviceUuid,
      ipAddress: dto.ipAddress ?? null,
      macAddress: dto.macAddress ?? null,
      mode: dto.mode ?? 'PUBLIC',
      dedicatedUserId: dto.dedicatedUserId ?? null,
      location: dto.location ?? null,
      label: dto.label ?? null,
      lockTimeoutSec: dto.lockTimeoutSec ?? null,
      registeredById: actorId,
    };
    const saved = existing
      ? await this.prisma.terminalRegistry.update({ where: { id: existing.id }, data })
      : await this.prisma.terminalRegistry.create({ data });

    await this.audit.safeLog({
      userId: actorId,
      action: existing ? AuditAction.UPDATE : AuditAction.CREATE,
      resourceType: 'TERMINAL',
      resourceId: saved.id,
      changes: { mode: { old: existing?.mode ?? null, new: saved.mode } },
    });
    return saved;
  }

  // ── 현장 오버라이드 (TERMINAL_OVERRIDE) — 모드/전담 변경 + 캐시 evict + 감사 (§6.2) ──
  async override(dto: OverrideTerminalDto, actorId: string) {
    const reg = await this.prisma.terminalRegistry.findUnique({
      where: { deviceUuid: dto.deviceUuid },
    });
    if (!reg) throw new NotFoundException('등록되지 않은 단말입니다.');

    const saved = await this.prisma.terminalRegistry.update({
      where: { id: reg.id },
      data: {
        mode: dto.mode ?? reg.mode,
        dedicatedUserId: dto.dedicatedUserId !== undefined ? dto.dedicatedUserId : reg.dedicatedUserId,
        status: dto.status ?? reg.status,
      },
    });

    // 런타임 강제 동기화 — 프론트 재fetch 신호용 캐시 무효화 자리(세션풀은 D2)
    this.logger.log(`단말 오버라이드 device=${reg.deviceUuid} by=${actorId} mode=${saved.mode}`);

    await this.audit.safeLog({
      userId: actorId,
      action: AuditAction.UPDATE,
      resourceType: 'TERMINAL_OVERRIDE',
      resourceId: saved.id,
      changes: {
        mode: { old: reg.mode, new: saved.mode },
        status: { old: reg.status, new: saved.status },
        dedicatedUserId: { old: reg.dedicatedUserId, new: saved.dedicatedUserId },
      },
    });
    return saved;
  }

  async list() {
    return this.prisma.terminalRegistry.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  // ── 분실 Kill-Switch (TERMINAL_KILL, §6.6) — SLO revokeAllForUser 재활용 ──
  async killSwitch(dto: KillSwitchDto, actorId: string) {
    const { targetUserId, deviceId, reason } = dto;

    // 1) 활성 SSO 자식 토큰 일괄 무효화(SLO)
    const revoked = await this.ssoIdp.revokeAllForUser(targetUserId);

    // 2) 분실 기기·패스키 폐기(지정 시)
    let deviceRevoked = 0;
    if (deviceId) {
      await this.prisma.staffDevice.updateMany({
        where: { id: deviceId, userId: targetUserId },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: reason ?? 'kill-switch', lostReportedAt: new Date() },
      });
      const r = await this.prisma.webAuthnCredential.updateMany({
        where: { deviceId, userId: targetUserId, status: 'ACTIVE' },
        data: { status: 'REVOKED' },
      });
      deviceRevoked = r.count;
    }

    // 3) 단말 보안 휘발 상태 제거(데일리 PIN·draft)
    const date = new Date().toLocaleDateString('en-CA');
    await this.redis.del(`daily_pin:${date}:${targetUserId}`, `draft:${targetUserId}`);

    await this.audit.safeLog({
      userId: actorId,
      action: AuditAction.DELETE,
      resourceType: 'TERMINAL_KILL_SWITCH',
      resourceId: targetUserId,
      changes: { revoked: { old: null, new: revoked.revoked }, deviceRevoked: { old: null, new: deviceRevoked }, reason: { old: null, new: reason ?? null } },
    });
    this.logger.warn(`Kill-Switch user=${targetUserId} by=${actorId} sso=${revoked.revoked} cred=${deviceRevoked}`);
    return { targetUserId, ssoRevoked: revoked.revoked, deviceRevoked };
  }

  // ── 페일모드 health (§6.7.2) — Redis 가용성으로 fail-secure/open 판단 신호 ──
  async health() {
    let redisOk = false;
    try {
      await this.redis.set('terminal:health', '1', 'EX', 10);
      redisOk = (await this.redis.get('terminal:health')) === '1';
    } catch {
      redisOk = false;
    }
    // 고위험=fail-secure(차단), 저위험=grace 유지 — 프론트가 이 신호로 분기.
    // 3중화 수렴(§7 P2): terminal.failmode.* config 가 정의만 되고 미소비였던 것을 실배선(폴백=종전 하드코딩)
    const highRisk = String((await this.configRuntime?.get('terminal.failmode.highRisk').catch(() => null)) ?? 'fail-secure');
    const lowRisk = String((await this.configRuntime?.get('terminal.failmode.lowRisk').catch(() => null)) ?? 'grace');
    const graceSec = Number((await this.configRuntime?.get('terminal.failmode.graceSec').catch(() => null)) ?? 300);
    return { redisOk, policy: { highRisk, lowRisk, graceSec: Number.isFinite(graceSec) && graceSec > 0 ? graceSec : 300 } };
  }
}
