import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { AppKeyController } from './app-key/app-key.controller';
import { AppKeyService } from './app-key/app-key.service';
import { AppAssertionGuard } from './app-key/app-assertion.guard';
import { ExternalCredentialsController } from './external-credentials.controller';
import { ExternalCredentialsService } from './external-credentials.service';
import { MobileConfigController } from './mobile-config.controller';
import { AasaController } from './aasa.controller';
import { PushTokenController } from './push-token.controller';
import { PushTokenService } from './push-token.service';
import { IdentityController } from './identity/identity.controller';
import { IdentityService } from './identity/identity.service';
import { LocalFakeIdentityAdapter } from './identity/local-fake.adapter';
import { EncryptionService } from '../patient-auth/services/encryption.service';
import { PatientAuthModule } from '../patient-auth/patient-auth.module';

/**
 * 네이티브 앱 공통 — 앱 무결성(App Attest)·외부 자격증명 관제·앱 설정·딥링크·푸시 토큰.
 *
 * 🔴 이 모듈이 **외부 자격증명을 만나는 유일한 층**이다. 다른 도메인은 값이 아니라
 *    `ExternalCredentialsService` 를 통해 "설정됐는가"만 묻는다 — 그래야 미설정이
 *    조용히 기본값으로 흘러가지 않는다.
 */
@Module({
    /**
   * 🔴 PatientAuthModule 과 **양방향**이다 — 환자 푸시 EP 가 `PatientAccountAuthGuard` 를 쓰고,
   *    환자 가입이 `IdentityService` 를 쓴다. `forwardRef` 로 양쪽을 연결한다.
   *    (한쪽만 걸면 부팅 시 `UnknownDependenciesException` 으로 **서버가 뜨지 않는다** — 실제로 겪었다)
   *    `EncryptionService` 는 ConfigService 만 쓰는 순수 서비스라 여기서도 직접 제공한다.
   */
  imports: [PrismaModule, RedisModule, ConfigRuntimeModule, forwardRef(() => PatientAuthModule)],
  controllers: [
    AppKeyController,
    ExternalCredentialsController,
    MobileConfigController,
    AasaController,
    PushTokenController,
    IdentityController,
  ],
  providers: [AppKeyService, AppAssertionGuard, ExternalCredentialsService, PushTokenService, IdentityService, LocalFakeIdentityAdapter, EncryptionService],
  exports: [AppKeyService, AppAssertionGuard, ExternalCredentialsService, PushTokenService, IdentityService],
})
export class MobileModule {}
