import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClinicApiService } from './clinic-api.service';
import { SsoController } from './sso.controller';
import { ClinicIntegrationController, WebhookController } from './clinic-integration.controller';
import { ErpEapprovalService } from './erp-eapproval.service';
import { ErpEapprovalController } from './erp-eapproval.controller';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { IntegrationAuthModule } from '../integration/integration-auth.module';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';

@Module({
  imports: [
    ConfigRuntimeModule,
    IntegrationAuthModule, // S-3 대상토큰(approvers drafter IDOR)

    JwtModule.registerAsync({
      imports: [ConfigModule,
],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('AUTH_SECRET'),
        signOptions: { expiresIn: '8h' },
      }),
    }),
  ],
  controllers: [SsoController, ClinicIntegrationController, WebhookController, ErpEapprovalController],
  // 🔴 DriftRecorderService 등록이 빠지면 @Optional() drift 가 undefined 로 조용히 아무것도 안 남는다(Prisma 리프 재등록 관례)
  providers: [ClinicApiService, ErpEapprovalService, DriftRecorderService],
  exports: [ClinicApiService, ErpEapprovalService],
})
export class ClinicIntegrationModule {}
