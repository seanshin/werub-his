import { Module } from '@nestjs/common';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';
import { PharmacyBoardController } from './pharmacy-board.controller';
import { PharmacyBoardService } from './pharmacy-board.service';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { SafetyGateModule } from '../safety-gate/safety-gate.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  // SafetyGateModule: 조제 게이트 위반 원장(pharmacy.highAlertDoubleCheck · asp.enforce).
  // 🔴 비글로벌이라 명시 import 가 없으면 `@Optional() gates` 가 undefined 가 되어
  //    "기록하는 코드는 있는데 아무것도 기록되지 않는" 상태가 된다(집행은 그대로 되므로 조용히 지나간다).
  // NotificationModule: 대체조제 요청 → 책임 처방의 인앱 알림(잎 모듈 — 순환 없음)
  imports: [MedicalAiModule, ConfigRuntimeModule, SafetyGateModule, NotificationModule],
  controllers: [PharmacyController, PharmacyBoardController],
  providers: [PharmacyService, PharmacyBoardService],
  exports: [PharmacyService, PharmacyBoardService], // 워크스테이션 위임 + 통합상황판(보드 재공급 대신 모듈 임포트)
})
export class PharmacyModule {}
