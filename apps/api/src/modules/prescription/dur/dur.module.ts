import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../infrastructure/prisma/prisma.module';
import { AllergyModule } from '../../allergy/allergy.module';
import { DurService } from './dur.service';
import { DurRulesRepo } from './dur-rules.repo';
import { DurRulesController } from './dur-rules.controller';

/**
 * DUR leaf 모듈 — 처방 파이프라인(PrescriptionModule)은 Order/StepUp/ControlledSubstance 등
 * 깊은 순환 그래프라 외부 import가 부팅 순환을 유발. DUR 점검만 필요한 소비처(원격진료 등)가
 * PrescriptionModule 전체를 끌어오지 않고 DurService만 안전하게 주입받도록 분리.
 * 의존: Prisma(leaf) + AllergyModule(leaf·import 0) — 순환 없음.
 */
@Module({
  imports: [PrismaModule, AllergyModule],
  controllers: [DurRulesController],
  providers: [DurService, DurRulesRepo],
  exports: [DurService, DurRulesRepo],
})
export class DurModule {}
