import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { Module } from '@nestjs/common';
import { NutritionController } from './nutrition.controller';
import { NutritionService } from './nutrition.service';
import { NutritionAdvancedController } from './nutrition-advanced.controller';
import { NutritionAdvancedService } from './nutrition-advanced.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  // 🔴 (2026-10-01) ConfigRuntimeModule 미import → `@Optional() config` 가 조용히 undefined 였다(설정이 개통 이래 무시됨)
  //    — 급양 워크리스트 기준(nutrition.screeningWithinHours·reassessDays)이 늘 기본값이었고 화면은 '원내 정책 미확정'이라 말했다
  imports: [NotificationModule, ConfigRuntimeModule],
  controllers: [NutritionController, NutritionAdvancedController],
  providers: [NutritionService, NutritionAdvancedService],
})
export class NutritionModule {}
