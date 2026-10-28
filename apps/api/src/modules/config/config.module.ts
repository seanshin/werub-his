import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from './config-runtime.module';

@Module({
  imports: [ConfigRuntimeModule],
  exports: [ConfigRuntimeModule],
})
export class ConfigModule {}
