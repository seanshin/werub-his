import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SsoIdpController } from './sso-idp.controller';
import { SsoIdpService } from './sso-idp.service';

// 독립 서명키 사용 — sign/verify 시 옵션으로 secret 명시(FR-06)
@Module({
  imports: [JwtModule.register({})],
  controllers: [SsoIdpController],
  providers: [SsoIdpService],
  exports: [SsoIdpService],
})
export class SsoIdpModule {}
