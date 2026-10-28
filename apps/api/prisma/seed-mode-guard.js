'use strict';
/**
 * 시드 실행 모드 가드 — **REAL 모드에서 데모 시드가 돌면 즉시 중단한다**(2026-09-13 상용 릴리즈 T2-3).
 *
 * 🔴 왜: 이 저장소의 시드는 필수 마스터와 **가상 병원 데모**(환자 874명 중 830명이 시드 UUID)가 한 덩어리다
 *    (`seed.ts` 11,629줄 · `seed-*` 38파일). 판매본(REAL)에서 `npx prisma db seed` 한 번이면 실환자 DB 에
 *    가상 환자·가짜 기관 데이터가 섞인다 — 되돌리기 어렵고, 섞인 뒤에는 "0행/실측"을 믿을 수 없게 된다
 *    (CLAUDE.md §운영 DB 는 가상 병원의 시드). 시드 분할(필수 마스터/기관 초기/데모) 전 단계의 안전장치다.
 *
 * 모드 판정 — **정본은 shared `parseHisMode`·`HIS_MODE_FALLBACK`**(파싱 규칙 사본을 만들지 않는다):
 *   ① 환경변수 `HIS_MODE` → ② 저장소 루트 `.env` 의 `HIS_MODE=`(deploy.sh `--mode` 가 서버에 못박는 곳과 같다)
 *   → ③ 둘 다 없거나 해석 불가면 **REAL**(모르면 안전측 — `his-mode.ts` HIS_MODE_FALLBACK).
 *   🔴 그래서 로컬 개발에서 시드를 돌리려면 `HIS_MODE=DEV` 를 명시해야 한다. 이것은 의도다 —
 *      "환경을 모르는 채로 데모를 넣는" 경로를 없애는 것이 이 가드의 전부다.
 *
 * kind:
 *   · 'DEMO'   — 가상 병원 데이터·기관 특정 설정·일회성 샘플. REAL 에서 **중단**.
 *   · 'MASTER' — 기관과 무관한 표준 템플릿·참조 콘텐츠. REAL 에서도 허용.
 *     🔴 MASTER 로 표시하는 파일은 가드 테스트(`test/architecture/install-reproducibility.spec.ts` `MASTER_ALLOW`)의 허용 목록과
 *        기계 대조한다 — 목록 밖에서 MASTER 를 자칭하면 테스트가 실패한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT_ENV = path.resolve(__dirname, '../../../.env');

function readRootEnvMode(rootEnvPath) {
  try {
    const m = fs.readFileSync(rootEnvPath, 'utf8').match(/^HIS_MODE=(.*)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined;
  } catch {
    return undefined;
  }
}

function currentSeedMode(env = process.env, rootEnvPath = ROOT_ENV) {
  // 🔴 shared 를 못 읽으면 판정할 수 없다 — 그 경우도 REAL 로 접는다(throw 로 중단)
  const { parseHisMode, HIS_MODE_FALLBACK } = require('@hospital-run/shared');
  const fromEnv = parseHisMode(env.HIS_MODE);
  if (fromEnv) return { mode: fromEnv, source: 'env HIS_MODE' };
  const fromFile = parseHisMode(readRootEnvMode(rootEnvPath));
  if (fromFile) return { mode: fromFile, source: `${rootEnvPath} HIS_MODE` };
  return { mode: HIS_MODE_FALLBACK, source: '미설정 → 폴백(REAL)' };
}

function assertSeedAllowed(file, kind = 'DEMO', env = process.env, rootEnvPath = ROOT_ENV) {
  if (kind !== 'DEMO' && kind !== 'MASTER') {
    throw new Error(`[seed-mode-guard] 알 수 없는 kind: ${kind} — 'DEMO' 또는 'MASTER'`);
  }
  if (kind === 'MASTER') return;
  const { mode, source } = currentSeedMode(env, rootEnvPath);
  if (mode === 'REAL') {
    throw new Error(
      `[seed-mode-guard] 🔴 REAL 모드에서 데모 시드를 실행하지 않습니다 — ${path.basename(file)} (판정 출처: ${source}).\n` +
        '  이 시드는 가상 병원 데이터(환자·진료·기관 설정)를 넣습니다. 실환자 DB 에 섞이면 되돌리기 어렵습니다.\n' +
        '  개발·리허설 DB 라면 HIS_MODE=DEV 또는 HIS_MODE=REHEARSAL 을 명시하세요.\n' +
        '  판매본 필수 마스터는 infra/install/install.sh 의 적재 절차를 따릅니다.',
    );
  }
}

module.exports = { assertSeedAllowed, currentSeedMode };
