import { Module } from '@nestjs/common';
import { RegistrationConsentController } from './registration-consent.controller';
import { RegistrationConsentService } from './registration-consent.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [RegistrationConsentController],
  providers: [RegistrationConsentService],
  exports: [RegistrationConsentService],
})
export class RegistrationConsentModule {}
