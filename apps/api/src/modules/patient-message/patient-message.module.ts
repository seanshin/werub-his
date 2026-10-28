import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { PatientMessageController } from './patient-message.controller';
import { PatientMessageService } from './patient-message.service';
import { PatientMessageListener } from './patient-message.listener';

@Module({
  imports: [NotificationModule],
  controllers: [PatientMessageController],
  providers: [PatientMessageService, PatientMessageListener],
})
export class PatientMessageModule {}
