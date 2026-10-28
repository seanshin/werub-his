import { Module } from '@nestjs/common';
import { PacsProxyController } from './pacs-proxy.controller';
import { PacsWebhookController } from './pacs-webhook.controller';
import { PacsProxyService } from './pacs-proxy.service';
import { PacsIntegrationListener } from './pacs-integration.listener';
import { IntegrationAuthModule } from '../integration/integration-auth.module';
import { SsoIdpModule } from '../auth/sso-idp/sso-idp.module';
import { DriftRecorderService } from '../../sentinel/drift-recorder.service';

@Module({
  // 🔴 SsoIdpModule — 뷰어 URL 의 단기·1회용 토큰 발급(외부 점검). 그 모듈은 JwtModule.register({}) 만 물고
  //    PacsProxyModule 을 되물지 않는다(순환 없음 — 부트 검증으로 확인한다. terminal 모듈도 같은 식으로 문다).
  imports: [IntegrationAuthModule, SsoIdpModule],
  controllers: [PacsProxyController, PacsWebhookController],
  // 🔴 DriftRecorderService 등록이 빠지면 @Optional() drift 가 undefined 로 조용히 아무것도 안 남는다.
  //    SentinelModule 은 Notification 등 허브를 물고 있어 순환 위험 — Prisma 리프 클래스 재등록 관례를 따른다.
  providers: [PacsProxyService, PacsIntegrationListener, DriftRecorderService],
  exports: [PacsProxyService],
})
export class PacsProxyModule {}
