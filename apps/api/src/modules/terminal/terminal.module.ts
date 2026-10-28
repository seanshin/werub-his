import { Module } from '@nestjs/common';
import { TerminalController } from './terminal.controller';
import { TerminalService } from './terminal.service';
import { TerminalPinService } from './terminal-pin.service';
import { TerminalDraftService } from './terminal-draft.service';
import { TerminalCronService } from './terminal-cron.service';
import { DailyPinGuard } from './daily-pin.guard';
import { AuditModule } from '../audit/audit.module';
import { EssModule } from '../ess/ess.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { SsoIdpModule } from '../auth/sso-idp/sso-idp.module';
import { PasskeyModule } from '../auth/passkey/passkey.module';

// 제로 트러스트 단말 보안 — D1~D4 (골격·데일리 PIN·Draft·Kill-Switch·페일모드·BTG)
// PrismaModule·AuthModule·RedisModule은 @Global → import 불요.
@Module({
  imports: [AuditModule, EssModule, ConfigRuntimeModule, SsoIdpModule, PasskeyModule],
  controllers: [TerminalController],
  providers: [TerminalService, TerminalPinService, TerminalDraftService, TerminalCronService, DailyPinGuard],
  // DailyPinGuard 는 사용 모듈(예: PrescriptionModule)에서 인스턴스화되므로 그 의존성을 함께 노출:
  // TerminalPinService(직접) + ConfigRuntimeService(ConfigRuntimeModule 재노출).
  exports: [TerminalService, DailyPinGuard, TerminalPinService, ConfigRuntimeModule],
})
export class TerminalModule {}
