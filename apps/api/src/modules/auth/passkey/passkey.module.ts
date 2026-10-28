import { Module } from '@nestjs/common';
import { PasskeyController } from './passkey.controller';
import { PasskeyService } from './passkey.service';

// AuthService(Global AuthModule)·PrismaService·RedisService·ConfigService 는 전역 모듈에서 주입
@Module({
  controllers: [PasskeyController],
  providers: [PasskeyService],
  exports: [PasskeyService],
})
export class PasskeyModule {}
