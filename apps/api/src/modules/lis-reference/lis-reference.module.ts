import { Module } from '@nestjs/common';
import { LisReferenceController } from './lis-reference.controller';
import { LisReferenceService } from './lis-reference.service';
import { IntegrationAuthModule } from '../integration/integration-auth.module';

@Module({
  imports: [IntegrationAuthModule], // lis.integrationKey 검증(assertLisKey)
  controllers: [LisReferenceController],
  providers: [LisReferenceService],
})
export class LisReferenceModule {}
