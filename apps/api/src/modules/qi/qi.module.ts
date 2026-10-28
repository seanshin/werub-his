import { Module } from '@nestjs/common';
import { QiController } from './qi.controller';
import { QiService } from './qi.service';
import { SafetyQualityBoardController } from './safety-quality-board.controller';
import { SafetyQualityBoardService } from './safety-quality-board.service';
import { SurgerySafetyController } from './surgery-safety.controller';
import { SurgerySafetyService } from './surgery-safety.service';
import { SurgerySafetyCron } from './surgery-safety.cron';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  // ConfigRuntimeModule 비글로벌 — 게이트 모드·좌우구분 키워드 정본 조회에 필요
  imports: [ConfigRuntimeModule, NotificationModule],
  controllers: [QiController, SafetyQualityBoardController, SurgerySafetyController],
  providers: [QiService, SafetyQualityBoardService, SurgerySafetyService, SurgerySafetyCron],
  exports: [QiService, SurgerySafetyService],
})
export class QiModule {}
