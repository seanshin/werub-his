import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from '../../modules/config/config-runtime.module';
import { HisModeService } from './his-mode.service';
import { HisModeController } from './his-mode.controller';

@Module({
  imports: [ConfigRuntimeModule],
  controllers: [HisModeController],
  providers: [HisModeService],
  exports: [HisModeService],
})
export class HisModeModule {}
