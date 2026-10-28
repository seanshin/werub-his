import { assertSeedAllowed } from '../seed-mode-guard';
/**
 * 임상 볼륨 확장 시드 — 전 도메인 일괄 실행기.
 *
 *   cd apps/api && npx ts-node --transpile-only prisma/seeds/clinical-volume-all.ts
 *
 * 도메인별 부분 실행(권장 — 문제가 나면 어느 축인지 바로 보인다):
 *   npx ts-node --transpile-only prisma/seeds/clinical-volume-imaging.ts    # 영상
 *   npx ts-node --transpile-only prisma/seeds/clinical-volume-inpatient.ts  # 입원(간호기록·MAR·입원 이력)
 *   npx ts-node --transpile-only prisma/seeds/clinical-volume-nursing.ts    # 병동 간호(flow sheet·회진·인수인계)
 *   npx ts-node --transpile-only prisma/seeds/clinical-volume-critical.ts   # 중환자·응급
 *   npx ts-node --transpile-only prisma/seeds/clinical-volume-surgery.ts    # 수술
 *   npx ts-node --transpile-only prisma/seeds/clinical-volume-safety.ts     # 환자안전·감염
 *
 * ── 전제 ────────────────────────────────────────────────────────────────
 * 메인 `prisma/seed.ts` 가 먼저 적용돼 있어야 한다(환자·직원·병상·진료·응급방문·ICU 병상).
 * 참조가 없는 도메인은 **0건으로 건너뛰고 그 사실을 로그로 말한다** — 조용히 성공하지 않는다.
 *
 * ── 성격 ────────────────────────────────────────────────────────────────
 * 🔴 이 시드는 **개발·시연용 가상 데이터**다. 실환자 데이터가 아니며, 실서비스 전환 시
 *    전량 제거·격리 대상이다(CLAUDE.md "운영 DB 는 가상 병원의 시드 데이터다").
 *    서술형 필드는 전부 `[시연]` 접두로 가상임이 드러나게 썼다.
 *
 * ── 멱등 ────────────────────────────────────────────────────────────────
 * 결정적 UUID(`00000000-0000-4000-b000-…`) + `upsertArgs`(create 에서 id 만 뺀 것을 update 로).
 * 🔴 `update: {}` 를 쓰지 않는다 — 재실행하면 시각이 오늘 기준으로 다시 굴러간다.
 * 1:1 테이블(surgeryId·visitId·incidentId 유니크)은 자연키 upsert 라 남의 기록을 덮지 않는다.
 *
 * ── 여기서 다루지 않는 것(의도적 제외) ──────────────────────────────────
 * · 수혈(transfusion_orders·blood_transfusions·MTP·반응신고) — 혈액제제 유효기한·상태 파생
 *   규칙의 정본이 코드에 없고 `prisma/seed.ts` 안에만 인라인으로 있다. 시드가 그 표를 복제하면
 *   "만료 혈소판이 AVAILABLE" 결함을 다시 만든다. 별도 축으로 남긴다.
 * · `critical_value_alerts` — 위급 flag(HH/LL) 검사결과가 운영 DB 에 **0건**이라 근거 없는 경보가 된다.
 * · `advance_directives`·`clinical_chart_verifications`·`lab_result_amendments` — 각각
 *   연명의료 결정·차트 검증 완료·검사결과 정정이라는 **행위가 있었다는 주장**이다. FE 생성 경로가
 *   없는 상태에서 시드가 심으면 P16(실행하지 않고 성공 상태만 기록)이 된다.
 * · 마스터(`wards` 5·`operating_rooms` 5·`clinical_pathways` 5) — 이 규모 병원에서 5행은
 *   빈약한 게 아니라 사실일 수 있다. 임의로 늘리면 없는 병동·수술실이 화면에 뜬다.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// 🔴 inpatient 가 nursing 보다 **먼저** 돈다 — 입원 이력을 먼저 만들고, nursing 은 그것을 제외한 채 돈다
const DOMAINS = ['imaging', 'inpatient', 'nursing', 'critical', 'surgery', 'safety'] as const;

function main(): void {
  const here = __dirname;
  const failed: string[] = [];
  for (const d of DOMAINS) {
    const file = join(here, `clinical-volume-${d}.ts`);
    console.log(`\n──────── clinical-volume:${d} ────────`);
    try {
      // 자식 프로세스로 돌린다 — 한 도메인이 죽어도 어디서 죽었는지 남고 나머지는 계속 간다
      execFileSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--transpile-only', file], {
        stdio: 'inherit',
        cwd: join(here, '..', '..'),
      });
    } catch {
      failed.push(d);
      console.error(`[clinical-volume:${d}] 실패 — 위 오류 확인`);
    }
  }
  console.log('\n════════ 요약 ════════');
  if (failed.length) {
    console.error(`실패 도메인: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log(`전 도메인 완료: ${DOMAINS.join(', ')}`);
}

if (require.main === module) assertSeedAllowed(__filename, 'DEMO'); // 🔴 실행 진입에서만 판정 — 테스트가 이 모듈을 import 하므로 최상단에 두지 않는다(상용 릴리즈 T2-3)
if (require.main === module) main();
