import { Module } from '@nestjs/common';
import { LegalHoldModule } from '../legal-hold/legal-hold.module';
import { RetentionController } from './retention.controller';
import { RetentionService } from './retention.service';
import { RetentionCronService } from './retention-cron.service';
import { AuditModule } from '../audit/audit.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { CredentialAdminModule } from '../credential-admin/credential-admin.module';

// 데이터 보유/파기 (security-governance G1+G6) — DRY-RUN·3중 게이트 + 4-eyes(ApprovalService 재사용)
// PrismaModule·AuthModule은 @Global → import 불요.
@Module({
  imports: [AuditModule, ConfigRuntimeModule, CredentialAdminModule, LegalHoldModule],
  controllers: [RetentionController],
  providers: [RetentionService, RetentionCronService],
  exports: [RetentionService],
})
export class RetentionModule {}
