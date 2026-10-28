import { Injectable, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { encryptField, decryptField } from '../../common/crypto/field-encryption';
import { generateTotpSecret, verifyTotp, otpauthUri } from './totp';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export interface DistributorPrincipal { accountId: string; distributorId: string; tier: string; status: string }

@Injectable()
export class DistributorAuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly config: ConfigService) {}

  private secret() { return this.config.getOrThrow<string>('AUTH_SECRET'); }

  async hashPassword(pw: string) { return bcrypt.hash(pw, 10); }

  /** 전체 접근 토큰 + 딜러 메타 발급(로그인/MFA 검증 공통) */
  private async issueAccess(acc: { id: string; distributorId: string; locale: string; mfaEnabled: boolean; mfaEnrolledAt: Date | null; distributor: { id: string; name: string; tier: string; currency: string } }) {
    await this.prisma.distributorAccount.update({ where: { id: acc.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const token = await this.jwt.signAsync({ sub: acc.id, did: acc.distributorId, typ: 'distributor' }, { secret: this.secret(), expiresIn: '1h' });
    return {
      token,
      mfaSetupRequired: acc.mfaEnabled && !acc.mfaEnrolledAt, // 자금 포털 — MFA 미등록이면 등록 유도
      distributor: { id: acc.distributor.id, name: acc.distributor.name, tier: acc.distributor.tier, locale: acc.locale, currency: acc.distributor.currency },
    };
  }

  private async registerFailure(accId: string, failed: number) {
    await this.prisma.distributorAccount.update({ where: { id: accId }, data: { failedAttempts: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000) : null } });
  }

  /** 딜러 포털 로그인 — 잠금·실패카운트(W-2). 독립 토큰(typ=distributor). */
  async login(email: string, password: string) {
    const acc = await this.prisma.distributorAccount.findUnique({ where: { email }, include: { distributor: true } });
    if (!acc) throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다');
    if (acc.lockedUntil && acc.lockedUntil > new Date())
      throw new ForbiddenException(`계정 잠금 — ${acc.lockedUntil.toISOString()} 이후 재시도`);

    const ok = await bcrypt.compare(password, acc.passwordHash);
    if (!ok) {
      await this.registerFailure(acc.id, acc.failedAttempts + 1);
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다');
    }
    // 초기설정 게이트: 이메일 인증코드로 비밀번호를 등록(setup)하지 않은 계정은 로그인 불가
    if (!acc.emailVerifiedAt)
      throw new ForbiddenException('초기 설정이 필요합니다 — 이메일로 받은 인증코드로 비밀번호를 등록하세요');
    if (acc.distributor.status !== 'ACTIVE')
      throw new ForbiddenException(`딜러 상태가 ${acc.distributor.status} 입니다`);

    // MFA(TOTP) 강제 — 등록 완료 계정은 비번 통과 후 2단계 코드 요구(소프트 롤아웃: 미등록은 통과+등록유도).
    // ⚠️ 비번 통과 시 failedAttempts/lockedUntil 을 리셋하지 않는다 — 리셋하면 비번을 아는 공격자가
    //    재로그인으로 TOTP 시도 카운터를 무한 초기화해 2차 인증 잠금을 우회할 수 있다. 잠금 해제는 issueAccess(완전 성공) 시에만.
    if (acc.mfaEnabled && acc.mfaEnrolledAt) {
      const mfaToken = await this.jwt.signAsync({ sub: acc.id, typ: 'distributor-mfa' }, { secret: this.secret(), expiresIn: '5m' });
      return { mfaRequired: true, mfaToken };
    }
    return this.issueAccess(acc);
  }

  /** 로그인 2단계 — mfaToken + TOTP 코드 검증 후 전체 토큰 발급 */
  async loginVerifyMfa(mfaToken: string, code: string) {
    const payload = await this.jwt.verifyAsync<{ sub: string; typ: string }>(mfaToken, { secret: this.secret() }).catch(() => null);
    if (!payload || payload.typ !== 'distributor-mfa') throw new UnauthorizedException('MFA 세션이 만료되었습니다 — 다시 로그인하세요');
    const acc = await this.prisma.distributorAccount.findUnique({ where: { id: payload.sub }, include: { distributor: true } });
    if (!acc || !acc.mfaSecret) throw new UnauthorizedException();
    if (acc.lockedUntil && acc.lockedUntil > new Date()) throw new ForbiddenException(`계정 잠금 — ${acc.lockedUntil.toISOString()} 이후 재시도`);
    const secret = String(decryptField(acc.mfaSecret));
    if (!verifyTotp(secret, code)) {
      await this.registerFailure(acc.id, acc.failedAttempts + 1);
      throw new UnauthorizedException('인증 코드가 올바르지 않습니다');
    }
    return this.issueAccess(acc);
  }

  // ─────────────────────────── MFA 등록/해제(인증된 본인)
  async mfaStatus(accountId: string) {
    const acc = await this.prisma.distributorAccount.findUnique({ where: { id: accountId }, select: { mfaEnabled: true, mfaEnrolledAt: true } });
    if (!acc) throw new UnauthorizedException();
    return { enabled: acc.mfaEnabled, enrolled: !!acc.mfaEnrolledAt };
  }

  /** 등록 시작 — 시크릿 생성·봉투암호화 저장(미확정), otpauth QR 반환. 이미 등록됨이면 해제 선행. */
  async mfaSetup(accountId: string) {
    const acc = await this.prisma.distributorAccount.findUnique({ where: { id: accountId }, include: { distributor: true } });
    if (!acc) throw new UnauthorizedException();
    if (acc.mfaEnrolledAt) throw new BadRequestException({ code: 'MFA_ALREADY_ENROLLED', message: '이미 MFA가 등록되어 있습니다. 먼저 해제하세요.' });
    const secret = generateTotpSecret();
    await this.prisma.distributorAccount.update({ where: { id: accountId }, data: { mfaSecret: String(encryptField(secret)) } });
    const uri = otpauthUri(secret, acc.email);
    return { secret, otpauthUri: uri, qrDataUrl: await QRCode.toDataURL(uri) };
  }

  /** 등록 확정 — 인증앱 코드 검증 후 활성화 */
  async mfaEnable(accountId: string, code: string) {
    const acc = await this.prisma.distributorAccount.findUnique({ where: { id: accountId }, select: { mfaSecret: true, mfaEnrolledAt: true } });
    if (!acc?.mfaSecret) throw new BadRequestException({ code: 'MFA_NOT_STARTED', message: '먼저 MFA 설정을 시작하세요.' });
    if (acc.mfaEnrolledAt) throw new BadRequestException({ code: 'MFA_ALREADY_ENROLLED', message: '이미 등록되었습니다.' });
    if (!verifyTotp(String(decryptField(acc.mfaSecret)), code)) throw new UnauthorizedException('인증 코드가 올바르지 않습니다');
    await this.prisma.distributorAccount.update({ where: { id: accountId }, data: { mfaEnrolledAt: new Date() } });
    return { ok: true, enrolled: true };
  }

  /** 해제 — 현재 코드 검증 후 시크릿/등록 제거 */
  async mfaDisable(accountId: string, code: string) {
    const acc = await this.prisma.distributorAccount.findUnique({ where: { id: accountId }, select: { mfaSecret: true, mfaEnrolledAt: true } });
    if (!acc?.mfaSecret || !acc.mfaEnrolledAt) throw new BadRequestException({ code: 'MFA_NOT_ENROLLED', message: 'MFA가 등록되어 있지 않습니다.' });
    if (!verifyTotp(String(decryptField(acc.mfaSecret)), code)) throw new UnauthorizedException('인증 코드가 올바르지 않습니다');
    await this.prisma.distributorAccount.update({ where: { id: accountId }, data: { mfaSecret: null, mfaEnrolledAt: null } });
    return { ok: true, enrolled: false };
  }

  /** 초기설정 — 관리자 등록 시 이메일로 받은 인증코드로 비밀번호를 등록(emailVerifiedAt 확정). 무인증 공개. */
  async setupAccount(email: string, code: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) throw new UnauthorizedException('비밀번호는 8자 이상이어야 합니다');
    const acc = await this.prisma.distributorAccount.findUnique({ where: { email } });
    if (!acc) throw new UnauthorizedException('계정을 찾을 수 없습니다');
    if (acc.emailVerifiedAt) throw new ForbiddenException('이미 초기설정이 완료된 계정입니다 — 로그인하거나 비밀번호 변경을 이용하세요');
    if (!acc.setupCodeHash || !acc.setupCodeExpiry || acc.setupCodeExpiry < new Date())
      throw new ForbiddenException('인증코드가 만료되었거나 없습니다 — 관리자에게 재발송을 요청하세요');
    if (!(await bcrypt.compare((code ?? '').trim().toUpperCase(), acc.setupCodeHash)))
      throw new UnauthorizedException('인증코드가 올바르지 않습니다');
    await this.prisma.distributorAccount.update({
      where: { id: acc.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10), emailVerifiedAt: new Date(), setupCodeHash: null, setupCodeExpiry: null, failedAttempts: 0, lockedUntil: null },
    });
    return { ok: true };
  }

  /** 비밀번호 변경(본인) */
  async changePassword(accountId: string, oldPw: string, newPw: string) {
    const acc = await this.prisma.distributorAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new UnauthorizedException();
    if (!(await bcrypt.compare(oldPw, acc.passwordHash))) throw new UnauthorizedException('현재 비밀번호가 올바르지 않습니다');
    await this.prisma.distributorAccount.update({ where: { id: accountId }, data: { passwordHash: await bcrypt.hash(newPw, 10) } });
    return { ok: true };
  }

  async verify(token: string): Promise<DistributorPrincipal> {
    const payload = await this.jwt.verifyAsync<{ sub: string; did: string; typ: string }>(token, { secret: this.secret() }).catch(() => null);
    if (!payload || payload.typ !== 'distributor') throw new UnauthorizedException();
    const acc = await this.prisma.distributorAccount.findUnique({ where: { id: payload.sub }, include: { distributor: true } });
    if (!acc) throw new UnauthorizedException();
    return { accountId: acc.id, distributorId: acc.distributorId, tier: acc.distributor.tier, status: acc.distributor.status };
  }
}
