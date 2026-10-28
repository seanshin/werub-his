import { Module } from '@nestjs/common';
import { CommandCenterController } from './command-center.controller';
import { CommandCenterService } from './command-center.service';
import { CommandCenterSpaceService } from './command-center-space.service';
import { CommandCenterTrendService } from './command-center-trend.service';
import { NursingModule } from '../nursing/nursing.module';
import { EmergencyModule } from '../emergency/emergency.module';
import { BedBoardService } from '../bed/bed-board.service';
import { PharmacyModule } from '../pharmacy/pharmacy.module';
import { ReceptionBillingBoardService } from '../billing/reception-billing-board.service';
import { DiagnosticsBoardService } from '../lab/diagnostics-board.service';
import { SafetyQualityBoardService } from '../qi/safety-quality-board.service';
import { SentinelModule } from '../../sentinel/sentinel.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  // 🔴 약국 보드는 PharmacyService(재고 정본 getLowStock)를 쓰게 되면서 'thin 재공급' 전제가 깨졌다 —
  //    직접 재공급하면 DI 미해결로 **부팅 자체가 죽는다**(2026-08-13 배포 크래시 루프 실측).
  //    정본 모듈(PharmacyModule)을 임포트한다. 나머지 보드 3종은 여전히 Prisma-only thin 집계.
  // 🔴 SentinelModule — 키 드리프트를 로그가 아니라 원장에 남기기 위해 물린다.
  //    빠뜨리면 `@Optional()` 주입이 undefined 가 되어 **조용히 아무것도 안 남는다**
  //    (이 저장소에서 그 사고가 이미 있었다 — 차단은 되면서 원장만 비었다).
  // ConfigRuntimeModule — 검사 보드의 위급값 허용시간 기준(lab.criticalValue.escalateAfterMinutes)을 읽는다.
  imports: [NursingModule, EmergencyModule, PharmacyModule, SentinelModule, ConfigRuntimeModule],
  controllers: [CommandCenterController],
  providers: [
    CommandCenterService,
    CommandCenterSpaceService,
    CommandCenterTrendService,
    BedBoardService,
    ReceptionBillingBoardService,
    DiagnosticsBoardService,
    SafetyQualityBoardService,
  ],
})
export class CommandCenterModule {}
