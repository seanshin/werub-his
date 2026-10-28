import { Module } from '@nestjs/common';
import { CssdController } from './cssd.controller';
import { CssdService } from './cssd.service';
import { CssdPackageController } from './cssd-package.controller';
import { CssdPackageService } from './cssd-package.service';
import { CssdInventoryController } from './cssd-inventory.controller';
import { CssdInventoryService } from './cssd-inventory.service';
import { CssdPoController } from './cssd-po.controller';
import { CssdPoService } from './cssd-po.service';
import { ErpIntegrationController } from './erp-integration.controller';
import { CssdUnitController } from './cssd-unit.controller';
import { CssdUnitService } from './cssd-unit.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
// 게이트 위반 원장 — BI/CI 게이트(cssd.biCiEnforce) 의 WARN/BLOCK 이 남아야 승격 근거가 생긴다
import { SafetyGateModule } from '../safety-gate/safety-gate.module';

@Module({
  imports: [ConfigRuntimeModule, SafetyGateModule],
  controllers: [CssdPoController, CssdController, CssdPackageController, CssdInventoryController, ErpIntegrationController, CssdUnitController],
  providers: [CssdService, CssdPackageService, CssdInventoryService, CssdPoService, CssdUnitService],
})
export class CssdModule {}
