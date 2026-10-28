import { Module } from '@nestjs/common';
import { AccessControlController } from './access-control.controller';
import { AccessControlService } from './access-control.service';
import { FeatureAccessService } from './feature-access.service';
import { FeatureAccessGuard } from './feature-access.guard';

@Module({
  controllers: [AccessControlController],
  providers: [AccessControlService, FeatureAccessService, FeatureAccessGuard],
  exports: [AccessControlService, FeatureAccessService, FeatureAccessGuard], // AccessControlService: 거버넌스 ACCESS 바인딩(P3)이 주입
})
export class AccessControlModule {}
