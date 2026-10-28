import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SmartAuthController } from './smart-auth.controller';
import { SmartAuthService } from './smart-auth.service';
import { KeyCustodyModule } from '../../common/crypto/key-custody.module';
import { AuditModule } from '../audit/audit.module';
import { SmartAuthGuard, FhirDualAuthGuard } from './smart-auth.guard';
import { ConfigRuntimeModule } from '../config/config-runtime.module';

@Module({
  imports: [
    ConfigRuntimeModule, // FHIR 직원 역할 설정(security.fhir.staffRoles)
    KeyCustodyModule, // id_token RS256 서명·JWKS
    AuditModule,      // launch 발급 PHI READ 감사
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('AUTH_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
    }),
  ],
  controllers: [SmartAuthController],
  providers: [SmartAuthService, SmartAuthGuard, FhirDualAuthGuard],
  exports: [SmartAuthService, SmartAuthGuard, FhirDualAuthGuard],
})
export class SmartAuthModule {}
