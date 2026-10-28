import { Module } from '@nestjs/common';
import { VitalsIngestModule } from '../vitals/vitals-ingest.module';
import { NurseStationController } from './nurse-station.controller';
import { NurseStationService } from './nurse-station.service';
import { NurseStationListener } from './nurse-station.listener';
import { NotificationModule } from '../notification/notification.module';
import { PatientSafetyModule } from '../patient-safety/patient-safety.module';
import { VitalsModule } from '../vitals/vitals.module';

@Module({
  imports: [VitalsIngestModule, NotificationModule, PatientSafetyModule, VitalsModule],
  controllers: [NurseStationController],
  providers: [NurseStationService, NurseStationListener],
  exports: [NurseStationService],
})
export class NurseStationModule {}
