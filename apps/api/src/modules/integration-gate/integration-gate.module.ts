import { Module } from '@nestjs/common';
import { IntegrationGateController } from './integration-gate.controller';
import { IntegrationGateService } from './integration-gate.service';

@Module({
  controllers: [IntegrationGateController],
  providers: [IntegrationGateService],
})
export class IntegrationGateModule {}
