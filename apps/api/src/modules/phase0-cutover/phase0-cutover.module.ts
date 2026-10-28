import { Module } from '@nestjs/common';
import { Phase0CutoverController } from './phase0-cutover.controller';
import { Phase0CutoverService } from './phase0-cutover.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [ConfigRuntimeModule],
  controllers: [Phase0CutoverController],
  providers: [Phase0CutoverService],
})
export class Phase0CutoverModule {}
