import { Module } from '@nestjs/common';
import { WaitingQueueController } from './waiting-queue.controller';
import { WaitingQueueService } from './waiting-queue.service';
import { QueueDisplayController } from './queue-display.controller';
import { QueueDisplayService } from './queue-display.service';
import { GuideController } from './guide.controller';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { DisplayKeysAdminController } from './display-keys.admin.controller';
import { DisplayBoxController } from './display-box.controller';
import { SafetyGateModule } from '../safety-gate/safety-gate.module';
import { DisplayKeyStreamGuard } from './display-key-stream.guard';
import { SpaceModelModule } from '../space-model/space-model.module';

@Module({
  // 🔴 2026-08-26: `WaitingQueueService` 는 `@Optional() gates?: SafetyGateService` 로
  //    `queue.completeRequiresSign` 위반을 기록하는데 이 모듈이 SafetyGateModule 을 import 하지 않아
  //    **주입이 undefined** 였다 — 차단은 되면서 원장만 비어, 관제가 다시 "위반 0건"이라 말했다.
  imports: [ConfigRuntimeModule, SafetyGateModule, SpaceModelModule],
  controllers: [WaitingQueueController, QueueDisplayController, GuideController, DisplayKeysAdminController, DisplayBoxController],
  // 🔴 가드를 provider 로 등록하지 않으면 주입이 안 돼 조용히 무시된다(정본: sse-auth-honesty)
  providers: [WaitingQueueService, QueueDisplayService, DisplayKeyStreamGuard],
  exports: [WaitingQueueService, QueueDisplayService],
})
export class WaitingQueueModule {}
