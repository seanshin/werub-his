import { Module } from '@nestjs/common';
import { StaffQualificationController } from './staff-qualification.controller';
import { StaffQualificationIntegrationController } from './staff-qualification-integration.controller';
import { StaffQualificationService } from './staff-qualification.service';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { IntegrationAuthModule } from '../integration/integration-auth.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, IntegrationAuthModule, NotificationModule],
  controllers: [StaffQualificationController, StaffQualificationIntegrationController],
  providers: [StaffQualificationService],
  exports: [StaffQualificationService],
})
export class StaffQualificationModule {}
