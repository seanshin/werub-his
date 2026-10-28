import { Controller, Get, Post, Param, Body, Query, UseGuards, Req, Headers } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeatureAccessGuard } from '../access-control/feature-access.guard';
import { RequireFeature } from '../access-control/require-feature.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IntegrationAuthService } from '../integration/integration-auth.service';
import { DistributorAuthGuard } from './distributor-auth.guard';
import { VoucherSettlementService } from './voucher-settlement.service';
import { RefundVoucherDto, GenerateSettlementDto, ErpSettlementCallbackDto } from './dto/settlement.dto';

// ── 관리자: 환불·정산·대시보드(voucher.admin) ──
@ApiTags('Voucher Settlement (Admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, FeatureAccessGuard)
@RequireFeature('voucher.admin')
@Controller('api/v1/voucher')
export class VoucherSettlementController {
  constructor(private readonly svc: VoucherSettlementService) {}

  @Get('dashboard') @ApiOperation({ summary: '검진권 대시보드(발행·유통·사용·환불·앵커)' })
  async dashboard() { return { data: await this.svc.dashboard() }; }

  @Post('vouchers/:serial/refund') @ApiOperation({ summary: '환불(+딜러 수수료 claw-back)' })
  async refund(@Param('serial') serial: string, @Body() dto: RefundVoucherDto, @CurrentUser('id') uid: string) {
    return { data: await this.svc.refund(serial, dto, uid) };
  }

  @Post('settlements') @ApiOperation({ summary: '딜러 기간 정산 산출' })
  async generate(@Body() dto: GenerateSettlementDto, @CurrentUser('id') uid: string) {
    return { data: await this.svc.generate(dto, uid) };
  }

  @Post('settlements/:id/confirm') @ApiOperation({ summary: '정산 확정(4-eyes: 산출자≠확정자)' })
  async confirm(@Param('id') id: string, @CurrentUser('id') uid: string) { return { data: await this.svc.confirm(id, uid) }; }

  @Get('settlements') @ApiOperation({ summary: '정산 목록' })
  async list(@Query('distributorId') distributorId?: string) { return { data: await this.svc.list(distributorId) }; }
}

// ── 딜러 포털: 내 정산 ──
@ApiTags('Voucher Settlement (Dealer)')
@Controller('api/v1/distributor')
export class DealerSettlementController {
  constructor(private readonly svc: VoucherSettlementService) {}

  @Get('settlements') @UseGuards(DistributorAuthGuard) @ApiOperation({ summary: '내 정산 내역' })
  async mine(@Req() req: { distributor: { distributorId: string } }) {
    return { data: await this.svc.listForDealer(req.distributor.distributorId) };
  }
}

// ── ERP→HIS 인바운드: 정산 지급 회신(settlement.paid·B3/DB-4) ──
// S-2: 키 + 본문 HMAC(X-Signature) + 타임스탬프 신선도(X-Timestamp). 무중단 enforce 플래그.
@ApiTags('Voucher Settlement (ERP Callback)')
@Controller('api/v1/voucher/settlements')
export class VoucherErpCallbackController {
  constructor(
    private readonly svc: VoucherSettlementService,
    private readonly integrationAuth: IntegrationAuthService,
  ) {}

  @Post('erp-callback')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiHeader({ name: 'X-Signature', required: false })
  @ApiHeader({ name: 'X-Timestamp', required: false })
  @ApiOperation({ summary: 'ERP→HIS 정산 지급 회신(settlement.paid) — 재무 웹훅 본문 서명(S-2)' })
  async erpCallback(
    @Headers('x-integration-key') key: string,
    @Headers('x-signature') signature: string,
    @Headers('x-timestamp') timestamp: string,
    @Req() req: { rawBody?: Buffer },
    @Body() dto: ErpSettlementCallbackDto,
  ) {
    await this.integrationAuth.assertFinanceWebhook({ key, rawBody: req.rawBody, signature, timestamp });
    return { data: await this.svc.applyPaymentCallback(dto) };
  }
}
