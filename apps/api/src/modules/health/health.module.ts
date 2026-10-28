import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PublicVersionController } from './public-version.controller';
import { SystemHealthController } from './system-health.controller';
import { HisModeModule } from '../../common/his-mode/his-mode.module';

@Module({
  imports: [HisModeModule],
  controllers: [HealthController, PublicVersionController, SystemHealthController],
})
export class HealthModule {}
