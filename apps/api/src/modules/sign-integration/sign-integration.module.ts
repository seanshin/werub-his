import { Module } from '@nestjs/common';
import { SignIntegrationController, SignPublicController } from './sign-integration.controller';
import { SignIntegrationService } from './sign-integration.service';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { DocumentModule } from '../document/document.module';
import { KeyCustodyModule } from '../../common/crypto/key-custody.module';
import { IntegrationAuthModule } from '../integration/integration-auth.module';
import { MedicalRecordCopyModule } from '../medical-record-copy/medical-record-copy.module';

@Module({
  imports: [ConfigRuntimeModule, PrismaModule, DocumentModule, KeyCustodyModule, IntegrationAuthModule, MedicalRecordCopyModule], // 동의서 정본 HTML(서명 대상 본문 동결)
  controllers: [SignIntegrationController, SignPublicController],
  providers: [SignIntegrationService],
  exports: [SignIntegrationService],
})
export class SignIntegrationModule {}
