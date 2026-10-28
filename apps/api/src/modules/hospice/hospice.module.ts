import { Module } from '@nestjs/common';
import { HospiceController } from './hospice.controller';
import { HospiceService } from './hospice.service';
import { ControlledSubstanceModule } from '../controlled-substance/controlled-substance.module';

@Module({
  imports: [ControlledSubstanceModule], // 완화의료 마약류 처방 발행 연동(P3)
  controllers: [HospiceController],
  providers: [HospiceService],
  exports: [HospiceService],
})
export class HospiceModule {}
