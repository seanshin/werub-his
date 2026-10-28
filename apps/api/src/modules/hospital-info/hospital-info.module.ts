import { Module } from '@nestjs/common';
import { HospitalInfoService } from './hospital-info.service';
import { HospitalInfoController, PublicHospitalInfoController } from './hospital-info.controller';
import { I18nModule } from '../i18n/i18n.module';

@Module({
  imports: [I18nModule],
  controllers: [HospitalInfoController, PublicHospitalInfoController],
  providers: [HospitalInfoService],
  exports: [HospitalInfoService],
})
export class HospitalInfoModule {}
