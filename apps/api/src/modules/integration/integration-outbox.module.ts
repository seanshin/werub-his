import { Global, Module } from '@nestjs/common';
import { IntegrationOutboxService } from './integration-outbox.service';
import { IntegrationAdminController } from './integration-admin.controller';
import { ErpAccessSyncController } from './erp-access-sync.controller';
import { ErpAccessSyncService } from './erp-access-sync.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { HisModeModule } from '../../common/his-mode/his-mode.module';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';

// 전 도메인이 enqueue 가능하도록 Global
@Global()
@Module({
  imports: [ConfigRuntimeModule, HisModeModule],
  controllers: [IntegrationAdminController, ErpAccessSyncController],
  // 🔴 DriftRecorderService 등록이 빠지면 @Optional() drift 가 undefined 로 조용히 아무것도 안 남는다(Prisma 리프 재등록 관례)
  providers: [IntegrationOutboxService, ErpAccessSyncService, DriftRecorderService],
  exports: [IntegrationOutboxService],
})
export class IntegrationOutboxModule {}
