import { ConfigRuntimeModule } from '../config/config-runtime.module';
import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  // 🔴 (2026-10-01) ConfigRuntimeModule 미import → `@Optional() config` 가 조용히 undefined 였다(설정이 개통 이래 무시됨)
  //    — 비밀번호 최소 길이 정책(security.password.minLength)이 늘 기본값이었다
  imports: [ConfigRuntimeModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
