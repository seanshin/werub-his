import { Module } from '@nestjs/common';
import { AiOversightController } from './ai-oversight.controller';
import { AiOversightService } from './ai-oversight.service';
import { AiCallLogModule } from '../ai-call-log/ai-call-log.module';
import { AuditModule } from '../audit/audit.module';

/**
 * AI 감독 관제 — 기획서 `docs/01-plan/features/ai-judgment-governance.plan.md` P2.
 *
 * 🔴 `AiCallLogModule` 을 **import 한다**(같은 싱글턴 인스턴스를 공유). 호출 분포의 정본은
 *    그쪽 `callStats` 이고, 여기서 같은 집계를 다시 짜면 두 화면이 다른 숫자를 말한다(P12).
 *    provider 로 복제하지 않는 이유이기도 하다 — 복제하면 `onModuleInit` 의 egress 싱크가
 *    두 번 꽂혀 호출 1건이 원장에 2행으로 남는다.
 *
 * 🔴 `AuditModule` 은 CSV 반출 감사행(`AiOversightExport`)을 남기기 위해서다.
 *    GET 은 기본 감사 대상이 아니라 컨트롤러가 직접 적는다.
 *
 * 🔴 app.module 등록 1줄이 이 모듈의 실제 배선이다(등록 안 하면 EP 는 존재하지 않는다).
 */
@Module({
  imports: [AiCallLogModule, AuditModule],
  controllers: [AiOversightController],
  providers: [AiOversightService],
  exports: [AiOversightService],
})
export class AiOversightModule {}
