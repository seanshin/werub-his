import { Module } from '@nestjs/common';
import { RemoteConsultationController } from './remote-consultation.controller';
import { RemoteConsultationService } from './remote-consultation.service';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { PreAuthGateService } from '../pre-auth/pre-auth-gate.service';
import { FormularyGateService } from '../formulary/formulary-gate.service';
import { DurModule } from '../prescription/dur/dur.module';

// 🔴 W8-R3(2026-08-14) — FormularyGateService 등록이 빠지면 비대면 처방 발행에서 게이트가 조용히
//    no-op 이 된다(서비스가 @Optional 주입). 배선 가드 스펙이 이 providers 목록을 검사한다.
@Module({
  // DurModule: 원격 처방에 DUR(상호작용·중복·금기) 점검 적용 — 처방 파이프라인 순환 회피 위해 leaf DUR만 import
  imports: [PrismaModule, NotificationModule, ConfigRuntimeModule, DurModule],
  controllers: [RemoteConsultationController],
  providers: [RemoteConsultationService, PreAuthGateService, FormularyGateService], // 발행 게이트(순수·provider 직접등록)
  exports: [RemoteConsultationService],
})
export class RemoteConsultationModule {}
