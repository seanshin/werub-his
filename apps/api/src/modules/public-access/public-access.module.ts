import { Global, Module } from '@nestjs/common';
import { PublicAccessLogService } from './public-access-log.service';

/**
 * 무인증 채널 접근 원장 — 공개 EP 를 가진 모듈이 어디서든 주입할 수 있게 @Global.
 * 🔴 @Optional 주입 금지: 미주입이면 조용한 no-op 이 되어 "기록된다"고 믿게 된다(GldModule 전례).
 */
@Global()
@Module({
  providers: [PublicAccessLogService],
  exports: [PublicAccessLogService],
})
export class PublicAccessModule {}
