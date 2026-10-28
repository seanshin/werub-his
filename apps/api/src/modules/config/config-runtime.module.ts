import { Module } from '@nestjs/common';
import { ConfigRuntimeController } from './config-runtime.controller';
import { ConfigRuntimeService } from './config-runtime.service';

@Module({
  
  controllers: [ConfigRuntimeController],
  providers: [ConfigRuntimeService],
  exports: [ConfigRuntimeService],
})
export class ConfigRuntimeModule {}
