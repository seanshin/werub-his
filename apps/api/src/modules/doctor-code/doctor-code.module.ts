import { Module } from '@nestjs/common';
import { DoctorCodeController } from './doctor-code.controller';
import { DoctorCodeService } from './doctor-code.service';

@Module({
  
  controllers: [DoctorCodeController],
  providers: [DoctorCodeService],
  exports: [DoctorCodeService],
})
export class DoctorCodeModule {}
