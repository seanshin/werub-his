import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { PermissionService } from './rbac/permission.service';
import { PermissionOverrideService } from './rbac/permission-override.service';
import { SsoIdpModule } from './sso-idp/sso-idp.module';
import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { AuditModule } from '../audit/audit.module';
import { MobileModule } from '../mobile/mobile.module';
import { MobileAuthController } from './mobile/mobile-auth.controller';
import { MobileAuthService } from './mobile/mobile-auth.service';

@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('AUTH_SECRET'),
        signOptions: { expiresIn: '8h' },
      }),
    }),
    SsoIdpModule, // SLO 연동(FR-18) — AuthService가 SsoIdpService 사용
    ConfigRuntimeModule, // ERP 접근 권한(erp.allowedRoles) 강제용
    // 🔴 직원 접속기록(로그인·로그아웃) 감사 — 미임포트 시 조용한 no-op 이 되므로 @Optional 주입 금지
    AuditModule,
    MobileModule, // 앱 개별키 검증(App Attest) — 네이티브 세션 발급 조건
  ],
  controllers: [AuthController, MobileAuthController],
  providers: [AuthService, MobileAuthService, JwtStrategy, JwtAuthGuard, RolesGuard, PermissionService, PermissionOverrideService],
  exports: [AuthService, JwtAuthGuard, RolesGuard, PermissionService, PermissionOverrideService],
})
export class AuthModule {}
