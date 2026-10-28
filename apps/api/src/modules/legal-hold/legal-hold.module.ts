import { Module } from '@nestjs/common';
import { LegalHoldController } from './legal-hold.controller';
import { LegalHoldService } from './legal-hold.service';
import { CredentialAdminModule } from '../credential-admin/credential-admin.module';

// 법적 보존명령(상용 릴리즈 T10-7) — 해제는 4-eyes(ApprovalService 재사용). PrismaModule·AuthModule 은 @Global.
// `LegalHoldService.isHeld()` 를 내보낸다 — 파기(retention)·향후 아카이브·스크라이브가 소비처다(연결은 본선 병합 후).
@Module({
  imports: [CredentialAdminModule],
  controllers: [LegalHoldController],
  providers: [LegalHoldService],
  exports: [LegalHoldService],
})
export class LegalHoldModule {}
