import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { RecoveryModule } from '../auth/recovery/recovery.module';
import { BlockchainCertModule } from '../blockchain-cert/blockchain-cert.module';
import { DeviceEnrollModule } from '../auth/device-enroll/device-enroll.module';
import { GrantController } from './grant.controller';
import { ApprovalController } from './approval.controller';
import { DeviceController } from './device.controller';
import { PolicyController } from './policy.controller';
import { Staff360Controller } from './staff360.controller';
import { RecoveryQueueController } from './recovery-queue.controller';
import { CertAdminController } from './cert-admin.controller';
import { LifecycleAdminController } from './lifecycle-admin.controller';
import { BulkController } from './bulk.controller';
import { GrantService } from './grant.service';
import { ApprovalService } from './approval.service';
import { DevicePolicyService } from './device-policy.service';
import { PolicyService } from './policy.service';
import { CredentialCronService } from './credential-cron.service';
import { Staff360Service } from './staff360.service';
import { AnomalyService } from './anomaly.service';
import { CertAdminService } from './cert-admin.service';
import { LifecycleAdminService } from './lifecycle-admin.service';
import { BulkService } from './bulk.service';
import { CredentialGuard } from './cred.guard';
import { AccessControlModule } from '../access-control/access-control.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

// 직원 인증·자격증명 통합 관리 콘솔
// P0: RBAC grant + 4-eyes / P1: 디바이스 보안규정 + 정책 + cron / P2: 직원360 + 세션 + 복구큐 / P3: 인증서 통합
@Module({
  // AccessControlModule: CredentialGuard 가 FeatureAccessService(기능 접근 매트릭스) 사용
  imports: [
    ConfigRuntimeModule,NotificationModule, RecoveryModule, BlockchainCertModule, DeviceEnrollModule, AccessControlModule],
  controllers: [
    GrantController,
    ApprovalController,
    DeviceController,
    PolicyController,
    Staff360Controller,
    RecoveryQueueController,
    CertAdminController,
    LifecycleAdminController,
    BulkController,
  ],
  providers: [
    GrantService,
    ApprovalService,
    DevicePolicyService,
    PolicyService,
    CredentialCronService,
    Staff360Service,
    AnomalyService,
    CertAdminService,
    LifecycleAdminService,
    BulkService,
    CredentialGuard,
  ],
  exports: [ApprovalService, GrantService, PolicyService, CredentialGuard],
})
export class CredentialAdminModule {}
