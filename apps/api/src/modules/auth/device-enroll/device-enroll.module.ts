import { Module } from '@nestjs/common';
import { DeviceEnrollController } from './device-enroll.controller';
import { DeviceEnrollPublicController } from './device-enroll-public.controller';
import { DeviceFcmController } from './device-fcm.controller';
import { DeviceEnrollService } from './device-enroll.service';
import { PasskeyModule } from '../passkey/passkey.module';
import { NotificationModule } from '../../notification/notification.module';
import { MobileModule } from '../../mobile/mobile.module';
import { PatientAuthModule } from '../../patient-auth/patient-auth.module';

@Module({
  imports: [PasskeyModule, NotificationModule, MobileModule, PatientAuthModule], // PasskeyService·NotificationService·AppKeyService·SmsOtpService 재사용
  controllers: [DeviceEnrollController, DeviceEnrollPublicController, DeviceFcmController],
  providers: [DeviceEnrollService],
  exports: [DeviceEnrollService],
})
export class DeviceEnrollModule {}
