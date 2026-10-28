import { Controller, Get, Post, Put, Patch, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeatureAccessGuard } from '../access-control/feature-access.guard';
import { RequireFeature } from '../access-control/require-feature.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DistributorService } from './distributor.service';
import { VoucherTradeService } from './voucher-trade.service';
import { DistributorAuthService } from './distributor-auth.service';
import { DistributorAuthGuard, assertDistributorScope } from './distributor-auth.guard';
import { RegisterDistributorDto, SetDistributorStatusDto, AllocateDto, SellDto, DistributorLoginDto, ChangePasswordDto, SetupAccountDto, UpdateDealerDto, MfaLoginDto, MfaCodeDto, SendBatchToDealerDto, ConfirmReceiptDto } from './dto/distributor.dto';

// ── 관리자: 딜러 심사·배분(voucher.admin) ──
@ApiTags('Voucher Distributor (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, FeatureAccessGuard)
@RequireFeature('voucher.admin')
@Controller('api/v1/voucher')
export class VoucherDistributorAdminController {
  constructor(private readonly dist: DistributorService, private readonly trade: VoucherTradeService) {}

  @Post('distributors') @ApiOperation({ summary: '딜러 등록(국내 유치업자/해외 딜러)(PENDING)+포털계정' })
  async register(@Body() dto: RegisterDistributorDto) { return { data: await this.dist.register(dto) }; }

  @Get('distributors') @ApiOperation({ summary: '딜러 목록(status·type 필터·관리번호/이름 검색)' })
  async list(@Query('status') status?: string, @Query('type') type?: string, @Query('search') search?: string) { return { data: await this.dist.list({ status, dealerType: type, search }) }; }

  @Post('distributors/sync-erp') @ApiOperation({ summary: '딜러 거래처 마스터 ERP 일괄 동기화(백필)' })
  async syncErp() { return { data: await this.dist.syncAllToErp() }; }

  @Get('distributors/:id') @ApiOperation({ summary: '딜러 상세' })
  async get(@Param('id') id: string) { return { data: await this.dist.get(id) }; }

  @Post('distributors/:id/approve') @ApiOperation({ summary: '딜러 심사 승인(국내=유치업 등록 / 해외=제휴계약)' })
  async approve(@Param('id') id: string, @CurrentUser('id') uid: string) { return { data: await this.dist.approve(id, uid) }; }

  @Post('distributors/:id/resend-setup') @ApiOperation({ summary: '초기설정 인증코드 재발송(미인증 계정)' })
  async resendSetup(@Param('id') id: string) { return { data: await this.dist.resendSetupCode(id) }; }

  @Put('distributors/:id/status') @ApiOperation({ summary: '딜러 상태(정지/해지·해지 시 재고 회수)' })
  async setStatus(@Param('id') id: string, @Body() dto: SetDistributorStatusDto, @CurrentUser('id') uid: string) {
    return { data: await this.dist.setStatus(id, dto.status, uid) };
  }

  @Patch('distributors/:id') @ApiOperation({ summary: '딜러 정보 수정(변경분 감사로그)' })
  async update(@Param('id') id: string, @Body() dto: UpdateDealerDto, @CurrentUser('id') uid: string) {
    return { data: await this.dist.updateDealer(id, dto, uid) };
  }

  @Get('distributors/:id/audit') @ApiOperation({ summary: '딜러 수정/상태변경 감사 로그' })
  async auditLog(@Param('id') id: string) { return { data: await this.dist.auditLog(id) }; }

  @Get('distributors/:id/inventory') @ApiOperation({ summary: '딜러 재고(발급된 검진권 목록)' })
  async inventory(@Param('id') id: string) { return { data: await this.dist.inventory(id) }; }

  @Post('allocations') @ApiOperation({ summary: '선결제 매입 배분(병원→딜러)' })
  async allocate(@Body() dto: AllocateDto, @CurrentUser('id') uid: string) {
    return { data: await this.trade.allocate(dto, { type: 'HOSPITAL', id: null, actorId: uid, actorType: 'ADMIN' }) };
  }

  @Post('batches/:batchId/send-to-dealer') @ApiOperation({ summary: '발행 배치를 딜러에 발송(배분 + 활성화코드 별도 이메일·채널분리)' })
  async sendBatchToDealer(
    @Param('batchId') batchId: string,
    @Body() dto: SendBatchToDealerDto,
    @CurrentUser('id') uid: string,
  ) {
    return { data: await this.trade.sendBatchToDealer(batchId, dto, { actorId: uid, actorType: 'ADMIN' }) };
  }
}

// ── 딜러 별도 포털(DistributorAuthGuard) ──
@ApiTags('Voucher Distributor Portal')
@Controller('api/v1/distributor')
export class DistributorPortalController {
  constructor(private readonly auth: DistributorAuthService, private readonly dist: DistributorService, private readonly trade: VoucherTradeService) {}

  @Post('auth/login') @ApiOperation({ summary: '딜러 로그인(독립 인증·잠금·MFA 2단계)' })
  async login(@Body() dto: DistributorLoginDto) { return { data: await this.auth.login(dto.email, dto.password) }; }

  @Post('auth/login-mfa') @ApiOperation({ summary: '로그인 2단계 — TOTP 코드 검증' })
  async loginMfa(@Body() dto: MfaLoginDto) { return { data: await this.auth.loginVerifyMfa(dto.mfaToken, dto.code) }; }

  @Post('auth/setup') @ApiOperation({ summary: '초기설정 — 이메일 인증코드로 비밀번호 등록(무인증)' })
  async setup(@Body() dto: SetupAccountDto) { return { data: await this.auth.setupAccount(dto.email, dto.code, dto.password) }; }

  @Get('account/mfa') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: 'MFA 상태' })
  async mfaStatus(@Req() req: { distributor: { accountId: string } }) { return { data: await this.auth.mfaStatus(req.distributor.accountId) }; }

  @Post('account/mfa/setup') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: 'MFA 등록 시작(QR)' })
  async mfaSetup(@Req() req: { distributor: { accountId: string } }) { return { data: await this.auth.mfaSetup(req.distributor.accountId) }; }

  @Post('account/mfa/enable') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: 'MFA 등록 확정(코드 검증)' })
  async mfaEnable(@Body() dto: MfaCodeDto, @Req() req: { distributor: { accountId: string } }) { return { data: await this.auth.mfaEnable(req.distributor.accountId, dto.code) }; }

  @Post('account/mfa/disable') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: 'MFA 해제(코드 검증)' })
  async mfaDisable(@Body() dto: MfaCodeDto, @Req() req: { distributor: { accountId: string } }) { return { data: await this.auth.mfaDisable(req.distributor.accountId, dto.code) }; }

  @Get('me') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: '내 딜러 정보' })
  async me(@Req() req: { distributor: { distributorId: string } }) { return { data: await this.dist.get(req.distributor.distributorId) }; }

  @Get('inventory') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: '내 재고' })
  async inventory(@Req() req: { distributor: { distributorId: string } }) { return { data: await this.dist.inventory(req.distributor.distributorId) }; }

  @Get('summary') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: '내 실적 요약' })
  async summary(@Req() req: { distributor: { distributorId: string } }) { return { data: await this.dist.summary(req.distributor.distributorId) }; }

  @Get('allocations') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: '내 배분(매입) 이력' })
  async allocations(@Req() req: { distributor: { distributorId: string } }) { return { data: await this.dist.myAllocations(req.distributor.distributorId) }; }

  @Post('account/password') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: '비밀번호 변경' })
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: { distributor: { accountId: string } }) {
    return { data: await this.auth.changePassword(req.distributor.accountId, dto.oldPassword, dto.newPassword) };
  }

  @Post('sales') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: '재판매(L1 외국인·L4 수수료)' })
  async sell(@Body() dto: SellDto, @Req() req: { distributor: { distributorId: string; accountId: string } }) {
    return { data: await this.trade.sell(dto, req.distributor.distributorId, req.distributor.accountId) };
  }

  @Get('sales') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: '내 재판매 내역' })
  async sales(@Req() req: { distributor: { distributorId: string } }) { return { data: await this.trade.mySales(req.distributor.distributorId) }; }

  @Get('vouchers/pending-receipt') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: '수령확인 대기 검진권(미확인·시리얼만)' })
  async pendingReceipt(@Req() req: { distributor: { distributorId: string } }) {
    return { data: await this.trade.pendingReceipts(req.distributor.distributorId) };
  }

  @Post('vouchers/confirm-receipt') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: '수령확인 — 이메일로 받은 활성화코드 입력(판매 게이트 해제)' })
  async confirmReceipt(@Body() dto: ConfirmReceiptDto, @Req() req: { distributor: { distributorId: string; accountId: string } }) {
    return { data: await this.trade.confirmReceipt(req.distributor.distributorId, dto.activationCodes ?? [], req.distributor.accountId) };
  }

  @Get('vouchers/:serial/activation-code') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: '활성화코드 재발급(분실 시·본인 보유/판매 한정)' })
  async activationCode(@Param('serial') serial: string, @Req() req: { distributor: { distributorId: string; accountId: string } }) {
    return { data: await this.trade.dealerActivationCode(serial, req.distributor.distributorId, req.distributor.accountId) };
  }

  @Get('children') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: '내 하위 딜러 목록' })
  async children(@Req() req: { distributor: { distributorId: string } }) { return { data: await this.dist.children(req.distributor.distributorId) }; }

  @Post('sub-allocations') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: '하위 딜러 배분(내 재고)' })
  async subAllocate(@Body() dto: AllocateDto, @Req() req: { distributor: { distributorId: string; accountId: string } }) {
    // 스코프: 본인 재고에서만 배분
    assertDistributorScope(req, req.distributor.distributorId);
    return { data: await this.trade.allocate(dto, { type: 'DISTRIBUTOR', id: req.distributor.distributorId, actorId: req.distributor.accountId, actorType: 'DISTRIBUTOR' }) };
  }
}
