import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryErpController } from './inventory-erp.controller';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [ConfigRuntimeModule],
  controllers: [InventoryController, InventoryErpController],
  providers: [InventoryService],
})
export class InventoryModule {}
