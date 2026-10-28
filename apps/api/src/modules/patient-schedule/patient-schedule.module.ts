import { Module } from '@nestjs/common';
import { PatientScheduleController } from './patient-schedule.controller';
import { PortalScheduleController } from './portal-schedule.controller';
import { AdminScheduleController } from './admin-schedule.controller';
import { PatientScheduleService } from './patient-schedule.service';
import { ScheduleReminderCronService } from './schedule-reminder.cron';
import { PatientAuthModule } from '../patient-auth/patient-auth.module';
import { PortalModule } from '../portal/portal.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [PatientAuthModule, PortalModule, ConfigRuntimeModule], // PortalOrPatientGuard 의존(PortalService·PatientAuthService) + config 게이트
  controllers: [PatientScheduleController, PortalScheduleController, AdminScheduleController],
  providers: [PatientScheduleService, ScheduleReminderCronService],
})
export class PatientScheduleModule {}
