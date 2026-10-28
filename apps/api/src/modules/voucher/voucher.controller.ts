import { Controller, Get, Post, Put, Param, Body, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeatureAccessGuard } from '../access-control/feature-access.guard';
import { RequireFeature } from '../access-control/require-feature.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PortalOrPatientGuard } from '../patient-auth/guards/portal-or-patient.guard';
import { PortalRequest } from '../../common/interfaces/portal-request.interface';
import { VoucherService } from './voucher.service';
import { VoucherPolicyService } from './voucher-policy.service';
import { VoucherBackfillService } from './voucher-backfill.service';
import { SetPolicyDto, IssueBatchDto, ActivateVoucherDto, ActivateSelfDto, RedeemVoucherDto, ClaimVoucherDto } from './dto/voucher.dto';

// 관리자/직원 — 검진권 발행·정책·직원보조 활성화/상환. (소비자 셀프 포털은 P4)
@ApiTags('Checkup Voucher')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, FeatureAccessGuard)
@Controller('api/v1/voucher')
export class VoucherController {
  constructor(
    private readonly svc: VoucherService,
    private readonly policy: VoucherPolicyService,
    private readonly backfill: VoucherBackfillService,
  ) {}

  // ── ERP 백필(voucher.admin) — webhook 활성화 전 기존 거래를 ERP로 재emit(멱등) ──
  @Post('backfill-erp') @RequireFeature('voucher.admin')
  @ApiOperation({ summary: '기존 검진권 거래 ERP 재emit(allocate/sale/redeem/refund/settlement, 멱등)' })
  async backfillErp() {
    return { data: await this.backfill.run() };
  }

  // ── 정책(voucher.policy) ──
  @Get('policy') @RequireFeature('voucher.admin')
  @ApiOperation({ summary: '활성 정책 + 법정 하한 조회' })
  async getPolicy() {
    return { data: { active: await this.policy.getActive(), legalFloors: await this.policy.legalFloors(), versions: await this.policy.listVersions() } };
  }

  @Put('policy') @RequireFeature('voucher.policy')
  @ApiOperation({ summary: '정책 새 버전 생성(법정 클램프·비활성)' })
  async setPolicy(@Body() dto: SetPolicyDto, @CurrentUser('id') userId: string) {
    return { data: await this.policy.createVersion(dto, userId) };
  }

  @Post('policy/:version/activate') @RequireFeature('voucher.policy')
  @ApiOperation({ summary: '정책 버전 활성화(4-eyes)' })
  async activatePolicy(@Param('version') version: string, @CurrentUser('id') userId: string) {
    return { data: await this.policy.activateVersion(Number(version), userId) };
  }

  // ── 발행(voucher.admin) ──
  @Post('batches') @RequireFeature('voucher.admin')
  @ApiOperation({ summary: '검진권 배치 발행(시리얼·genesis·앵커)' })
  async issueBatch(@Body() dto: IssueBatchDto, @CurrentUser('id') userId: string) {
    return { data: await this.svc.issueBatch(dto, userId) };
  }

  @Get('batches') @RequireFeature('voucher.admin')
  @ApiOperation({ summary: '발행 배치 목록(최근순)' })
  async listBatches() {
    return { data: await this.svc.listBatches() };
  }

  @Get('batches/:id') @RequireFeature('voucher.admin')
  @ApiOperation({ summary: '배치 상세·상태집계' })
  async getBatch(@Param('id') id: string) {
    return { data: await this.svc.getBatch(id) };
  }

  @Get('vouchers') @RequireFeature('voucher.admin')
  @ApiOperation({ summary: '개별 검진권 목록/검색(상태·배치·시리얼·페이지)' })
  async listVouchers(
    @Query('status') status?: string,
    @Query('batchId') batchId?: string,
    @Query('serial') serial?: string,
    @Query('ownerType') ownerType?: string,
    @Query('dealer') dealer?: string,
    @Query('issuedFrom') issuedFrom?: string,
    @Query('issuedTo') issuedTo?: string,
    @Query('expiresFrom') expiresFrom?: string,
    @Query('expiresTo') expiresTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return { data: await this.svc.listVouchers({ status, batchId, serial, ownerType, dealer, issuedFrom, issuedTo, expiresFrom, expiresTo, page: page ? Number(page) : undefined, limit: limit ? Number(limit) : undefined }) };
  }

  // ── 직원보조 활성화·상환(voucher.admin) ──
  @Post('vouchers/:serial/activate') @RequireFeature('voucher.admin')
  @ApiOperation({ summary: '검진권 활성화(외국인환자 바인딩·L1·L8)' })
  async activate(@Param('serial') serial: string, @Body() dto: ActivateVoucherDto) {
    return { data: await this.svc.activate(serial, dto) };
  }

  @Post('vouchers/:serial/redeem') @RequireFeature('voucher.admin')
  @ApiOperation({ summary: '검진권 상환(검진 사용·원자·이중사용 차단)' })
  async redeem(@Param('serial') serial: string, @Body() dto: RedeemVoucherDto) {
    return { data: await this.svc.redeem(serial, dto) };
  }

  @Get('vouchers/:serial/chain') @RequireFeature('voucher.admin')
  @ApiOperation({ summary: '해시체인 무결성 검증' })
  async verifyChain(@Param('serial') serial: string) {
    return { data: await this.svc.verifyChain(serial) };
  }
}

// 소비자(외국인환자) 셀프 포털 — 본인 활성화·내 검진권 (PortalOrPatientGuard)
@ApiTags('Checkup Voucher Portal')
@UseGuards(PortalOrPatientGuard)
@Controller('api/v1/portal/vouchers')
export class VoucherPortalController {
  constructor(private readonly svc: VoucherService) {}

  @Get('mine')
  @ApiHeader({ name: 'X-Portal-Token', required: true })
  @ApiOperation({ summary: '내 검진권 목록' })
  async mine(@Req() req: PortalRequest) {
    return { data: await this.svc.listMine(req.portalPatientId) };
  }

  @Post(':serial/activate')
  @ApiHeader({ name: 'X-Portal-Token', required: true })
  @ApiOperation({ summary: '검진권 본인 셀프 활성화(L1 외국인·L8 동의)' })
  async activate(@Param('serial') serial: string, @Body() dto: ActivateSelfDto, @Req() req: PortalRequest) {
    return { data: await this.svc.activateSelf(serial, req.portalPatientId, dto.activationCode, dto.consent) };
  }
}

// 외국인 구매자 셀프 claim(무인증·자체검증=활성화코드) — 코드검증→외국인환자·포털계정 생성→활성화→즉시로그인(G1+G2)
@ApiTags('Checkup Voucher Claim')
@Controller('api/v1/portal/vouchers')
export class VoucherClaimController {
  constructor(private readonly svc: VoucherService) {}

  @Post('claim')
  @ApiOperation({ summary: '검진권 등록(외국인 구매자 셀프 온보딩·활성화)' })
  async claim(@Body() dto: ClaimVoucherDto) {
    return { data: await this.svc.claim(dto) };
  }
}

// 공개 진위검증(무인증·PHI 없음)
@ApiTags('Checkup Voucher Public')
@Controller('api/v1/public/vouchers')
export class VoucherPublicController {
  constructor(private readonly svc: VoucherService) {}

  @Get(':serial/verify')
  @ApiOperation({ summary: '시리얼/QR 공개 진위·잔여 검증' })
  async verify(@Param('serial') serial: string) {
    return { data: await this.svc.publicVerify(serial) };
  }
}
