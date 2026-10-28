import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { VoucherController, VoucherPublicController, VoucherPortalController, VoucherClaimController } from './voucher.controller';
import { VoucherDistributorAdminController, DistributorPortalController } from './distributor.controller';
import { VoucherSettlementController, DealerSettlementController, VoucherErpCallbackController } from './voucher-settlement.controller';
import { VoucherService } from './voucher.service';
import { VoucherPolicyService } from './voucher-policy.service';
import { VoucherLedgerService } from './voucher-ledger.service';
import { VoucherBillingService } from './voucher-billing.service';
import { VoucherSettlementService } from './voucher-settlement.service';
import { DistributorService } from './distributor.service';
import { VoucherTradeService } from './voucher-trade.service';
import { DistributorAuthService } from './distributor-auth.service';
import { DistributorAuthGuard } from './distributor-auth.guard';
import { VoucherCronService } from './voucher-cron.service';
import { VoucherBackfillService } from './voucher-backfill.service';
import { AccessControlModule } from '../access-control/access-control.module';
import { PatientAuthModule } from '../patient-auth/patient-auth.module';
import { PortalModule } from '../portal/portal.module';
import { NotificationModule } from '../notification/notification.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { IntegrationAuthModule } from '../integration/integration-auth.module';
import { AuditModule } from '../audit/audit.module';
import { VoucherFxService } from './voucher-fx.service';
import { VoucherEmailService } from './voucher-email.service';
import { HisModeModule } from '../../common/his-mode/his-mode.module';

// 건강검진권(블록체인) — P1 코어 + P2 유통(딜러·배분·재판매·별도 포털)
// AccessControlModule: FeatureAccessGuard(voucher.admin/policy)
// JwtModule: 딜러 독립 토큰(typ=distributor, AUTH_SECRET) — staff 가드와 분리
@Module({
  imports: [
    AccessControlModule,
    PatientAuthModule,
    PortalModule,
    ConfigRuntimeModule,
    HisModeModule, // 🔴 대외 발신 모드 차단 — 리허설에서 검진권 메일이 실제로 나가고 있었다
    IntegrationAuthModule,
    AuditModule,
    NotificationModule, // 체인 무결성 위반 ADMIN 통보(leaf 모듈 — 순환 없음)
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('AUTH_SECRET') }),
    }),
  ],
  controllers: [
    VoucherController, VoucherPublicController, VoucherPortalController, VoucherClaimController, VoucherDistributorAdminController, DistributorPortalController,
    VoucherSettlementController, DealerSettlementController, VoucherErpCallbackController,
  ],
  providers: [
    VoucherService, VoucherPolicyService, VoucherLedgerService, VoucherBillingService, VoucherSettlementService, VoucherFxService, VoucherEmailService,
    DistributorService, VoucherTradeService, DistributorAuthService, DistributorAuthGuard,
    VoucherCronService, VoucherBackfillService,
  ],
  exports: [VoucherService],
})
export class VoucherModule {}
