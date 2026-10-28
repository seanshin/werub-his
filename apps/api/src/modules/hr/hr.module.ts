import { Module } from '@nestjs/common';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { HrErpController } from './hr-erp.controller';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { IntegrationAuthModule } from '../integration/integration-auth.module';

@Module({
  imports: [ConfigRuntimeModule, IntegrationAuthModule],
  controllers: [HrController, HrErpController],
  providers: [HrService],
  exports: [HrService],
})
export class HrModule {}
