import { Module } from '@nestjs/common';
import { IssuanceService } from './issuance.service';
import { DocumentBundleService } from './document-bundle.service';
import { StaffDocumentController } from './staff-document.controller';
import { PortalDownloadController } from './portal-download.controller';
import { PortalDocumentBundleController } from './portal-document-bundle.controller';
import { DocumentModule } from '../document/document.module';
import { AuditModule } from '../audit/audit.module';
import { PatientAuthModule } from '../patient-auth/patient-auth.module';
import { PortalModule } from '../portal/portal.module';
import { ChronicModule } from '../chronic/chronic.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { BillingModule } from '../billing/billing.module';

// 의무기록 사본(A그룹) 발급 P0 — 환자요청→의료진 스냅샷·발급→포털 다운로드.
// PrismaService·EventEmitter2 는 글로벌. DocumentService(발급·PDF)·AuditService 재사용.
// PortalModule: PortalDownloadController 의 PortalOrPatientGuard(PortalService 의존) 해석용.
// ChronicModule: 증명서 초안 만성질환 경과 자동채움(P2b).
// F-4 실손보험 서류 번들: DocumentBundleService + PortalDocumentBundleController(리터럴 라우트 — ':id' 선점 방지 위해 앞에 등록).
// BillingModule: 서류 수수료 ↔ 수납 연결(2026-10-10 · PortalModule 이 이미 BillingModule 을 가져온다 — 순환 없음).
// ConfigRuntimeModule: leaf 모듈(imports 없음) — 전이 순환 없음(portal.insuranceDocBundle 게이트용).
@Module({
  imports: [DocumentModule, AuditModule, PatientAuthModule, PortalModule, ChronicModule, ConfigRuntimeModule, BillingModule],
  controllers: [StaffDocumentController, PortalDocumentBundleController, PortalDownloadController],
  providers: [IssuanceService, DocumentBundleService],
  exports: [IssuanceService],
})
export class MedicalRecordIssuanceModule {}
