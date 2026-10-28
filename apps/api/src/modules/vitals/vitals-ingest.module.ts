import { Module } from '@nestjs/common';
import { VitalsIngestService } from './vitals-ingest.service';
import { AdmissionVitalsReader } from './admission-vitals.reader';

/**
 * 활력 수집 포트 모듈 — 의존은 전역(PrismaModule·EventEmitterModule)뿐이라 **어느 도메인 모듈이든
 * 순환 없이** 가져다 쓸 수 있다. `VitalsModule` 을 통째로 import 하면 알림·환자안전 모듈까지
 * 딸려 들어와 입원·중환자 모듈의 의존 그래프가 불필요하게 넓어진다.
 */
@Module({
  // 입원 활력 읽기 정본(두 원장 합침 · 2026-10-10)도 같은 이유로 여기 둔다
  providers: [VitalsIngestService, AdmissionVitalsReader],
  exports: [VitalsIngestService, AdmissionVitalsReader],
})
export class VitalsIngestModule {}
