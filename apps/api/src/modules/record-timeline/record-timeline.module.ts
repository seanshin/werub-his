import { Module } from '@nestjs/common';
import { RecordTimelineService } from './record-timeline.service';
import { RecordTimelineController } from './record-timeline.controller';
import { MedicalAiModule } from '../medical-ai/medical-ai.module';
import { AuditModule } from '../audit/audit.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

// 임상 기록 통합 시계열(뷰어·단건 상세·AI 정리). PrismaService 글로벌.
// AI 요약은 부가 기능이라 MedicalAiModule 을 import 하되 서비스는 @Optional 로 주입(미가용 시 규칙 요약).
@Module({
  imports: [MedicalAiModule, AuditModule, ConfigRuntimeModule], // 활력 범위 정본(clinical.vitals.thresholds) — @Optional 주입이 조용히 undefined 가 되지 않게
  controllers: [RecordTimelineController],
  providers: [RecordTimelineService],
  exports: [RecordTimelineService],
})
export class RecordTimelineModule {}
