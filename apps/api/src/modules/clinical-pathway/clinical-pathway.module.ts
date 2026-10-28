import { Module } from '@nestjs/common';
import { ClinicalPathwayController } from './clinical-pathway.controller';
import { ClinicalPathwayService } from './clinical-pathway.service';
import { StandardGovernanceModule } from '../gld/standard-governance.module';

@Module({
  // 🔴 전용 모듈만 가져간다 — `GldModule` 을 통째로 import 하면 순환 의존이 된다(2026-08-27 부팅 사고)
  imports: [StandardGovernanceModule],
  controllers: [ClinicalPathwayController],
  providers: [ClinicalPathwayService],
  exports: [ClinicalPathwayService],
})
export class ClinicalPathwayModule {}
