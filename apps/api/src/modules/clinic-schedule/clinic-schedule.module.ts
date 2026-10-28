import { Module } from '@nestjs/common';
import { ClinicScheduleController } from './clinic-schedule.controller';
import { ClinicScheduleService } from './clinic-schedule.service';

@Module({
  
  controllers: [ClinicScheduleController],
  providers: [ClinicScheduleService],
  exports: [ClinicScheduleService],
})
export class ClinicScheduleModule {}
