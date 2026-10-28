import { Module } from '@nestjs/common';
import { I18nModule } from '../i18n/i18n.module';
import { ConsentTemplateController } from './consent-template.controller';
import { ConsentTemplateService } from './consent-template.service';

@Module({
  imports: [I18nModule], // AI 번역 초안(언어판 생성)
  
  controllers: [ConsentTemplateController],
  providers: [ConsentTemplateService],
  exports: [ConsentTemplateService],
})
export class ConsentTemplateModule {}
