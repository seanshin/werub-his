import { Module } from '@nestjs/common';
import { FeeIntegrationController } from './fee-integration.controller';
import { FeeIntegrationService } from './fee-integration.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [ConfigRuntimeModule],
  controllers: [FeeIntegrationController],
  providers: [FeeIntegrationService],
})
export class FeeIntegrationModule {}
