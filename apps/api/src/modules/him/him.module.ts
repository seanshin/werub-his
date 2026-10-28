import { Module } from '@nestjs/common';
import { HimController } from './him.controller';
import { HimService } from './him.service';
import { PatientMedicalRecordController } from './patient-medical-record.controller';
import { PatientMedicalRecordService } from './patient-medical-record.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [ConfigRuntimeModule, NotificationModule],
  controllers: [HimController, PatientMedicalRecordController],
  providers: [HimService, PatientMedicalRecordService],
})
export class HimModule {}
