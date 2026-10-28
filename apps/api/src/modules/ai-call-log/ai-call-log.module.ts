import { Module } from '@nestjs/common';
import { AiCallLogController } from './ai-call-log.controller';
import { AiCallLogService } from './ai-call-log.service';

/**
 * AI 호출 원장 + 모델 릴리즈 레지스트리 — 기획서 §2.2.
 *
 * 🔴 이 모듈이 등록되지 않으면 `aiEgressFetch` 의 싱크가 비어 **원장이 한 줄도 남지 않는다**
 *    (그때는 프로세스당 1회 warn 이 뜬다 — 0행을 "호출 없음"으로 읽지 않게).
 *    그래서 app.module 등록 1줄이 이 축의 실제 배선이다.
 */
@Module({
  controllers: [AiCallLogController],
  providers: [AiCallLogService],
  exports: [AiCallLogService],
})
export class AiCallLogModule {}
