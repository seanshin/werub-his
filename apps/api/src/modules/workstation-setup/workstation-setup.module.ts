import { Module } from '@nestjs/common';
import { WorkstationSetupController } from './workstation-setup.controller';
import { WorkstationSetupService } from './workstation-setup.service';
import { PrintService } from './print.service';

@Module({
  controllers: [WorkstationSetupController],
  providers: [WorkstationSetupService, PrintService],
})
export class WorkstationSetupModule {}
