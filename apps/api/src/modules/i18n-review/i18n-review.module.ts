import { Module } from '@nestjs/common';
import { I18nReviewController } from './i18n-review.controller';
import { I18nReviewService } from './i18n-review.service';

/**
 * 언어팩 사람 검수(오버레이 원장) — 정본 `docs/01-plan/features/i18n-human-review.plan.md`.
 * 🔴 기존 `I18nModule`(자동 번역 엔진)과 **다른 축**이다: 저쪽은 기계 번역, 여기는 사람 검수 결과 원장.
 */
@Module({
  controllers: [I18nReviewController],
  providers: [I18nReviewService],
  exports: [I18nReviewService],
})
export class I18nReviewModule {}
