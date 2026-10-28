import { Module } from '@nestjs/common';
import { DeviceUsageController } from './device-usage.controller';
import { DeviceUsageService } from './device-usage.service';

@Module({
  controllers: [DeviceUsageController],
  providers: [DeviceUsageService],
  exports: [DeviceUsageService],
})
export class DeviceUsageModule {}
