import { Module } from '@nestjs/common';
import { EquipmentController } from './equipment.controller';
import { EquipmentService } from './equipment.service';
import { EquipmentErpController } from './equipment-erp.controller';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [ConfigRuntimeModule],
  controllers: [EquipmentController, EquipmentErpController],
  providers: [EquipmentService],
})
export class EquipmentModule {}
