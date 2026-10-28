import { Module } from '@nestjs/common';
import { DevDemoService } from './dev-demo.service';
import { DevDemoCronService } from './dev-demo-cron.service';
import { DevDemoController } from './dev-demo.controller';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { FloorModule } from '../floor/floor.module';
import { HisModeModule } from '../../common/his-mode/his-mode.module';
import { DemoMovementService } from './demo-movement.service';
import { WifiLocationModule } from '../wifi-location/wifi-location.module';

// 개발용 데모 데이터 날짜 롤포워드(예약·접수). 운영 안전: config dev.demoDateRoll=false 면 무동작.
@Module({
  imports: [ConfigRuntimeModule, FloorModule, HisModeModule, WifiLocationModule],
  controllers: [DevDemoController],
  providers: [DevDemoService, DevDemoCronService, DemoMovementService],
  exports: [DevDemoService],
})
export class DevDemoModule {}
