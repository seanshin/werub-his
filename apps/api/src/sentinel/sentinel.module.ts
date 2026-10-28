import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '../infrastructure/prisma/prisma.module';
import { HospitalInfoModule } from '../modules/hospital-info/hospital-info.module';
import { NotificationModule } from '../modules/notification/notification.module';
import { ConfigRuntimeModule } from '../modules/config/config-runtime.module';
// 🔴 순환 없음 확인(2026-09-04): MedicalAiModule 그래프는 SentinelModule 을 import 하지 않는다 —
//    DriftRecorderService 를 provider 재등록으로 쓰는 관례가 정확히 그 순환을 피하기 위한 것.
//    별도 프로세스(sentinel.main.ts)는 자기 모듈(PrismaModule 만)이라 AI 그래프를 끌지 않는다.
import { MedicalAiModule } from '../modules/medical-ai/medical-ai.module';
import { SentinelService } from './sentinel.service';
import { CronLivenessService } from './cron-liveness.service';
import { DriftRecorderService } from './drift-recorder.service';
import { SentinelNotifyService } from './sentinel-notify.service';
import { SentinelReadService } from './sentinel-read.service';
import { SentinelJudgmentService } from './sentinel-judgment.service';
import { SentinelAdvisorService } from './sentinel-advisor.service';
import { SentinelController } from './sentinel.controller';

/**
 * 상시 감시자 — 쓰기(스윕)는 별도 프로세스가, 읽기(화면)는 API 가 한다.
 * 같은 모듈을 양쪽이 쓰되 **컨트롤러는 API 프로세스에서만** 뜬다.
 */
@Module({
  imports: [PrismaModule, ScheduleModule, HospitalInfoModule, NotificationModule, ConfigRuntimeModule, MedicalAiModule],
  controllers: [SentinelController],
  providers: [SentinelService, SentinelReadService, SentinelJudgmentService, SentinelAdvisorService, CronLivenessService, DriftRecorderService, SentinelNotifyService],
  exports: [SentinelService, SentinelReadService, SentinelJudgmentService, SentinelAdvisorService, CronLivenessService, DriftRecorderService, SentinelNotifyService],
})
export class SentinelModule {}
