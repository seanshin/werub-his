import { Module } from '@nestjs/common';
import { AuditEnhancedController } from './audit-enhanced.controller';
import { BtgService } from './btg.service';
import { BreakTheGlassGuard } from './btg.guard';
import { VipPatientService } from './vip-patient.service';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule], // 이상징후 ADMIN 통보(leaf 모듈 — 순환 없음)
  controllers: [AuditEnhancedController],
  providers: [BtgService, BreakTheGlassGuard, VipPatientService, AnomalyDetectionService],
  exports: [BtgService, BreakTheGlassGuard, VipPatientService, AnomalyDetectionService],
})
export class AuditEnhancedModule {}
