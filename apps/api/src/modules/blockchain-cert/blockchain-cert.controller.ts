import {
  Controller, Get, Put, Post, Param, Body, Query,
  UseGuards, ParseUUIDPipe, ParseIntPipe, DefaultValuePipe, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BlockchainCertService } from './blockchain-cert.service';
import { NotifySetupDto } from './dto/notify-setup.dto';
import { BlockchainCertPolicyDto, CertPinEventDto, CertReasonDto, IssueMyCertificateDto, RenewCertificateDto } from './dto/blockchain-cert-write.dto';
import { ConfigRuntimeService } from '../config/config-runtime.service';

const POLICY_KEYS = [
  'blockchain.allowedAlgorithms',
  'blockchain.pinLength',
  'blockchain.pinLockAttempts',
  'blockchain.pinLockMinutes',
  'blockchain.pinAutoSuspendAttempts',
  'blockchain.anchorInterval',
  'blockchain.patientCertPolicy',
  'blockchain.autoIssuePolicy',
] as const;

@ApiTags('Blockchain Certificate (전자인증서)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/blockchain-cert')
export class BlockchainCertController {
  constructor(
    private readonly service: BlockchainCertService,
    private readonly configService: ConfigRuntimeService,
  ) {}

  /**
   * 🔴 W7: 본문(`@Body()`)을 그대로 service.issue() 에 넘겨 `userId`·`subjectDn`·`licenseNumber`·
   *    `identityVerified` 를 요청자가 지정할 수 있었다 → 타인 명의 발급 + 피해자 기존 ACTIVE 인증서 자동 REVOKE.
   *    이제 명의는 토큰에서만 취한다(service.issueForSelf). 본문에서 받는 것은 공개키/알고리즘뿐이다.
   *    타인 명의 발급이 필요한 관리 경로는 `/api/v1/admin/credential/certs/issue`(CredentialGuard) 가 정본.
   */
  @Post('issue')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: '내 인증서 발급 (명의는 로그인 사용자 고정)' })
  async issue(@Body() body: IssueMyCertificateDto, @CurrentUser('id') userId: string) {
    // 🔴 FE(/settings/my-certificate)는 `publicKeyPem` 으로 보내고 서버는 `publicKey` 를 읽던 계약 불일치(P11) —
    //    둘 다 받아 흡수한다(FE 정리는 이 배치 범위 밖).
    const publicKey = typeof body.publicKey === 'string' && body.publicKey
      ? body.publicKey
      : typeof body.publicKeyPem === 'string' ? body.publicKeyPem : '';
    const algorithm = typeof body.algorithm === 'string' && body.algorithm ? body.algorithm : '';
    if (!publicKey || !algorithm) {
      throw new BadRequestException({ code: 'CERT_ISSUE_INVALID', message: '공개키(publicKey)와 알고리즘(algorithm)이 필요합니다' });
    }
    return {
      data: await this.service.issueForSelf(userId, {
        publicKey,
        algorithm,
        keyCustody: typeof body.keyCustody === 'string' ? body.keyCustody : undefined,
        attestationRef: typeof body.attestationRef === 'string' ? body.attestationRef : undefined,
      }),
    };
  }

  /** 🔴 (2026-09-03) 관리 화면 '안내 발송'이 toast 만 띄우던 P16 봉합 — 실제 원내 알림 발송(결과 정직) */
  @Post('notify-setup')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '인증서 미발급 직원에게 설정 안내 발송(원내 알림 · {attempted,sent,failed})' })
  async notifySetup(@Body() dto: NotifySetupDto) {
    return { data: await this.service.notifySetup(dto.target) };
  }

  @Get('capability')
  @ApiOperation({ summary: '발급 가능 여부(sign 단독 전환 — 자체발급 UI 노출 결정)' })
  async capability() {
    return { data: await this.service.capability() };
  }

  @Get('sign-certs')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'sign 인증서 현황(읽기전용 미러) — 직원별 sign 발급 serial' })
  async signCertStatus() {
    return { data: await this.service.signCertStatus() };
  }

  @Get('sign-certs/patients')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'sign 인증서 현황 — 환자별 발급 serial(읽기전용 미러)' })
  async patientSignCerts() {
    return { data: await this.service.patientSignCerts() };
  }

  @Get('my')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: '내 인증서 목록' })
  async getMyCerts(@CurrentUser('id') userId: string) {
    return { data: await this.service.getMyCerts(userId) };
  }

  @Get('crl')
  @ApiOperation({ summary: 'CRL (폐기/정지 목록)' })
  async getCrl() {
    return { data: await this.service.getCrl() };
  }

  @Get('audit-log')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '감사 로그 조회' })
  async getAuditLog(
    @Query('certificateId') certificateId?: string,
    @Query('userId') userId?: string,
    @Query('eventType') eventType?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return await this.service.getAuditLog({ certificateId, userId, eventType, page, limit });
  }

  @Get('stats')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '인증서 상태별 통계' })
  async getStats() {
    return { data: await this.service.getStats() };
  }

  @Get('all')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '전체 인증서 목록 (관리자)' })
  async getAllCerts(
    @Query('status') status?: string,
    @Query('ownerType') ownerType?: string,
    @Query('search') search?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return await this.service.getAllCerts({ status, ownerType, search, page, limit });
  }

  @Get('expiring')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '만료 임박 인증서' })
  async getExpiringCerts(
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return { data: await this.service.getExpiringCerts(days) };
  }

  @Get('policy')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '블록체인 인증서 정책 조회' })
  async getPolicy() {
    const policy: Record<string, unknown> = {};
    for (const key of POLICY_KEYS) {
      const short = key.replace('blockchain.', '');
      policy[short] = await this.configService.get(key);
    }
    return { data: policy };
  }

  @Put('policy')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '블록체인 인증서 정책 저장' })
  async setPolicy(
    @Body() body: BlockchainCertPolicyDto,
    @CurrentUser('id') userId: string,
  ) {
    const keyMap: Record<string, string> = {
      allowedAlgorithms: 'blockchain.allowedAlgorithms',
      pinLength: 'blockchain.pinLength',
      pinLockAttempts: 'blockchain.pinLockAttempts',
      pinLockMinutes: 'blockchain.pinLockMinutes',
      pinAutoSuspendAttempts: 'blockchain.pinAutoSuspendAttempts',
      anchorInterval: 'blockchain.anchorInterval',
      patientCertPolicy: 'blockchain.patientCertPolicy',
      autoIssuePolicy: 'blockchain.autoIssuePolicy',
    };
    for (const [field, configKey] of Object.entries(keyMap)) {
      const value = (body as Record<string, unknown>)[field];
      if (value !== undefined) {
        await this.configService.set(configKey, value, userId);
      }
    }
    return { data: { success: true } };
  }

  @Get('policies')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '자동발급 정책 조회' })
  async getAutoIssuePolicy() {
    const policy = await this.configService.get('blockchain.autoIssuePolicy');
    return { data: policy };
  }

  @Put('policies')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '자동발급 정책 저장' })
  async setAutoIssuePolicy(
    @Body() body: Record<string, boolean>,
    @CurrentUser('id') userId: string,
  ) {
    await this.configService.set('blockchain.autoIssuePolicy', body, userId);
    return { data: { success: true } };
  }

  @Get('verify/:fingerprint')
  @ApiOperation({ summary: '지문 기반 인증서 검증' })
  async verifyByFingerprint(@Param('fingerprint') fingerprint: string) {
    return { data: await this.service.verifyByFingerprint(fingerprint) };
  }

  // 🔴 W7: 소유 무관하게 임상 4역할이 임의 인증서 상세(소유자 성명·MRN·면허번호 포함)를 열람하던 것 —
  //    본인 것 또는 ADMIN 만. 남의 것과 없는 것을 똑같이 404 로 답한다.
  @Get(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: '인증서 상세 (본인 또는 관리자)' })
  async getCertById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
  ) {
    if (role !== UserRole.ADMIN) await this.service.requireOwnership(id, userId);
    return { data: await this.service.getCertById(id) };
  }

  @Post(':id/approve')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '인증서 승인 (PENDING → ACTIVE · 이미 활성이면 approved=false)' })
  async approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.approve(id, userId) };
  }

  @Post(':id/reject')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '인증서 반려' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CertReasonDto,
  ) {
    return { data: await this.service.reject(id, body.reason) };
  }

  /**
   * 🔴 W7: 소유 검증이 없어 certId 만 알면 **타인 인증서를 공격자 공개키로 재발급**할 수 있었다
   *    (= 타인 명의 서명 위조 + 피해자 기존 키 자동 폐기). 갱신은 소유자만 — 새 키쌍은 소유자만 만든다.
   *    관리자 대행 갱신은 `/api/v1/admin/credential/certs/:id/renew`(CredentialGuard·감사기록) 가 정본이므로
   *    여기서는 ADMIN 도 예외로 두지 않는다.
   */
  @Post(':id/renew')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: '내 인증서 갱신 (소유자만)' })
  async renew(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenewCertificateDto,
    @CurrentUser('id') userId: string,
  ) {
    await this.service.requireOwnership(id, userId);
    return { data: await this.service.renew(id, body.publicKey) };
  }

  @Post(':id/suspend')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '인증서 일시정지' })
  async suspend(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.suspend(id) };
  }

  @Post(':id/revoke')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '인증서 폐기' })
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CertReasonDto,
  ) {
    return { data: await this.service.revoke(id, body.reason) };
  }

  @Post(':id/restore')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '인증서 복원' })
  async restore(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.service.restore(id) };
  }

  /**
   * 🔴 W7: 소유 검증이 없어 certId 만 알면 타인 인증서를 10회 호출로 SUSPENDED(서명 불가) 시킬 수 있었다.
   *    자체발급 게이트(selfIssuanceEnabled=false)를 타지 않는 경로라, 인증서가 하나라도 생기면 즉시 노출된다.
   */
  @Post('pin-fail')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: 'PIN 실패 기록 (소유자만)' })
  async recordPinFail(@Body() body: CertPinEventDto, @CurrentUser('id') userId: string) {
    await this.service.requireOwnership(body.certId, userId);
    return { data: await this.service.recordPinFail(body.certId) };
  }

  /** 🔴 W7: 소유 검증 부재 — 타인의 PIN 실패 카운터/잠금을 임의로 리셋할 수 있었다(잠금 우회 조력). */
  @Post('pin-success')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN, UserRole.PHARMACIST)
  @ApiOperation({ summary: 'PIN 성공 기록 (소유자만)' })
  async recordPinSuccess(@Body() body: CertPinEventDto, @CurrentUser('id') userId: string) {
    await this.service.requireOwnership(body.certId, userId);
    return { data: await this.service.recordPinSuccess(body.certId) };
  }
}
