import { Module } from '@nestjs/common';
import { ExecutiveController } from './executive.controller';
import { ExecutiveService } from './executive.service';
import { AccessControlModule } from '../access-control/access-control.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  // AccessControlModule: FeatureAccessGuard/FeatureAccessService(기능 접근 매트릭스) 사용
  // ConfigRuntimeModule: 경영 KPI 목표치(exec.target.*) — 비글로벌이라 명시 import 필수
  imports: [AccessControlModule, ConfigRuntimeModule],
  controllers: [ExecutiveController],
  providers: [ExecutiveService],
})
export class ExecutiveModule {}
