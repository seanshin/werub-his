import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { FloorModule } from '../floor/floor.module';
import { SpaceModelModule } from '../space-model/space-model.module';
import { WifiLocationController } from './wifi-location.controller';
import { WifiPositioningService } from './wifi-positioning.service';
import { WifiRegistryService } from './wifi-registry.service';
import { WifiAutoUnbindListener } from './wifi-auto-unbind.listener';

/** 무선 AP 기반 원내 위치 — `docs/01-plan/features/wifi-ap-location.plan.md` */
@Module({
  imports: [ConfigRuntimeModule, FloorModule, SpaceModelModule],
  controllers: [WifiLocationController],
  providers: [WifiPositioningService, WifiRegistryService, WifiAutoUnbindListener],
  exports: [WifiPositioningService],
})
export class WifiLocationModule {}
