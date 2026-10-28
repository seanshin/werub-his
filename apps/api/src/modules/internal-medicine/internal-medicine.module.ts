import { Module } from '@nestjs/common';
import { InternalMedicineController } from './internal-medicine.controller';
import { InternalMedicineService } from './internal-medicine.service';

@Module({
  controllers: [InternalMedicineController],
  providers: [InternalMedicineService],
})
export class InternalMedicineModule {}
