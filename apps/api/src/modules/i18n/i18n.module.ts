import { Module } from '@nestjs/common';
import { TranslationService } from './translation.service';
import { TranslationController } from './translation.controller';

@Module({
  controllers: [TranslationController],
  providers: [TranslationService],
  exports: [TranslationService], // 상담실·CMS 등 서버단 재사용
})
export class I18nModule {}
