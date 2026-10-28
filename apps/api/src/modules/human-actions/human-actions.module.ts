import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { HumanActionsController } from './human-actions.controller';
import { HumanActionsService } from './human-actions.service';

/** 사람 몫 할 일(2026-10-26) — 읽기 전용 파생(잎 모듈 · FCM 판정은 ModuleRef 로 늦게 찾는다 — 알림 모듈 import 순환을 만들지 않는다) */
@Module({
  imports: [ConfigRuntimeModule],
  controllers: [HumanActionsController],
  providers: [HumanActionsService],
})
export class HumanActionsModule {}
