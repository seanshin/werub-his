import { Module } from '@nestjs/common';
import { StandardGovernanceService } from './standard-governance.service';
import { DecisionPathwayService } from './decision-pathway.service';

/**
 * 표준 발효 요건 평가 — **전용 모듈**.
 *
 * 🔴 2026-08-27 배포 사고: 처음에는 `ClinicalPathwayModule` 이 `GldModule` 을 통째로 import 했는데,
 *    `GldModule` 이 (여러 단계를 거쳐) 다시 `ClinicalPathwayModule` 로 돌아와 **순환 의존**이 됐다.
 *    `tsc` 도 10,150 테스트도 통과했지만 **Nest 부팅에서 죽었다**(운영 502).
 *    규약 §8 "타입 0·테스트 초록이 배포 가능을 보장하지 않는다 — Nest 부팅만 잡는 층이 있다".
 *
 * 이 서비스는 `PrismaService` 말고는 아무것도 필요 없다. 그래서 **고리를 끊는 가장 작은 단위**로
 * 떼어 낸다 — 쓰는 쪽(임상경로·프로토콜·거버넌스)이 이 모듈만 가져간다.
 */
@Module({
  // 🔴 결정 경로 엔진도 `PrismaService` 외 의존이 없다 — 같은 전용 모듈에 둔다
  //    (2026-08-27 순환 의존 부팅 사고의 교훈: 필요한 서비스만 가져간다)
  providers: [StandardGovernanceService, DecisionPathwayService],
  exports: [StandardGovernanceService, DecisionPathwayService],
})
export class StandardGovernanceModule {}
