import { Module } from '@nestjs/common';
import { ConfigRuntimeModule } from '../../modules/config/config-runtime.module';
import { KeyCustodyService } from './key-custody.service';

// 키 수탁 모듈 — HSM 기획 Phase 1. RS256 키 라이프사이클을 provider 경계로 격리.
@Module({
  imports: [ConfigRuntimeModule],
  providers: [KeyCustodyService],
  exports: [KeyCustodyService],
})
export class KeyCustodyModule {}
