import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { EnvelopeKeyService } from './envelope-key.service';
import { EnvelopeKeyController } from './envelope-key.controller';

// 봉투 암호화 키 관리 모듈 — HSM 기획 Phase 3. (가드는 전역 JWT 전략 사용 — sign-integration 동일 패턴)
@Module({
  imports: [PrismaModule],
  controllers: [EnvelopeKeyController],
  providers: [EnvelopeKeyService],
  exports: [EnvelopeKeyService],
})
export class EnvelopeKeyModule {}
