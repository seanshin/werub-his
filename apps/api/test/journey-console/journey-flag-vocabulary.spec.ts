import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_JOURNEY_STAGE_KEYS,
  JOURNEY_FLAG_META,
  JOURNEY_FLAG_ORDER,
  journeyFlagLabel,
} from '@hospital-run/shared';

/**
 * 🔴 여정 지연 플래그 어휘 — **서버가 내는 것과 화면이 아는 것이 같아야 한다.**
 *
 * 2026-08-26 실측: 상황판 라벨표에 `WAIT_DELAY` 가 **없었다.** 운영 지연 198명 중 **194명**이
 * 그 플래그라, 상황판 지연 목록의 대부분이 **영문 enum 을 그대로 찍고** 있었다.
 * 반대로 상황판만 갖고 있던 `EXAM_DELAY`·`PHARMACY_DELAY` 는 **서버가 낸 적이 없는 어휘**였다
 * — 아무도 만나지 못하는 라벨이라 가드도 헛돌 수 있었다.
 *
 * 이 저장소가 반복해서 겪은 유형이다(DUR 43룰 한글 vs 영문 · 검사 알림 `_` vs `.`).
 */
const SVC_DIR = join(process.cwd(), 'src/modules/journey-console');

function serverFlags(): Set<string> {
  const out = new Set<string>();
  for (const f of readdirSync(SVC_DIR)) {
    if (!f.endsWith('.ts')) continue;
    const src = readFileSync(join(SVC_DIR, f), 'utf8');
    for (const m of src.matchAll(/flags\.push\('([A-Z_]+)'\)/g)) out.add(m[1]);
  }
  return out;
}

describe('여정 지연 플래그 어휘', () => {
  const server = serverFlags();

  it('스캔이 실제로 무언가를 찾았다 — 0을 통과로 읽지 않는다', () => {
    expect(server.size).toBeGreaterThanOrEqual(6);
  });

  it('🔴 서버가 내는 플래그는 전부 정본에 라벨이 있다(영문이 새지 않는다)', () => {
    const missing = [...server].filter((f) => !(f in JOURNEY_FLAG_META));
    expect(missing, `정본에 없는 서버 플래그: ${missing.join(', ')}`).toEqual([]);
  });

  it('🔴 정본에 서버가 내지 않는 어휘를 두지 않는다(만나지 못하는 라벨은 가드도 헛돈다)', () => {
    const orphan = JOURNEY_FLAG_ORDER.filter((f) => !server.has(f));
    expect(orphan, `서버가 내지 않는 정본 어휘: ${orphan.join(', ')}`).toEqual([]);
  });

  it('표시 순서에 모든 플래그가 정확히 한 번씩 들어 있다', () => {
    expect([...JOURNEY_FLAG_ORDER].sort()).toEqual(Object.keys(JOURNEY_FLAG_META).sort());
    expect(new Set(JOURNEY_FLAG_ORDER).size).toBe(JOURNEY_FLAG_ORDER.length);
  });

  it('진료가 멈춘 것은 danger 로 구분한다 — 전부 같은 색이면 구분이 없다', () => {
    const danger = JOURNEY_FLAG_ORDER.filter((f) => JOURNEY_FLAG_META[f].tone === 'danger');
    expect(danger.length).toBeGreaterThan(0);
    expect(danger.length).toBeLessThan(JOURNEY_FLAG_ORDER.length);
  });

  it('🔴 모르는 플래그를 한국어인 척하지 않는다 — 원문 그대로 보여준다', () => {
    expect(journeyFlagLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    // 대조군: 아는 것은 한국어로 번역한다(무조건 원문 반환이면 이 가드는 헛돈다)
    expect(journeyFlagLabel('WAIT_DELAY')).toBe('접수 지연');
  });

  it('화면이 라벨을 다시 정의하지 않는다 — 정본은 shared 하나', () => {
    const webDir = join(process.cwd(), '../web/src/app/(main)');
    for (const rel of ['command-center/journey-view.ts', 'journey-console/page.tsx']) {
      const src = readFileSync(join(webDir, rel), 'utf8');
      expect(src, `${rel} 이 라벨을 다시 정의한다`).not.toMatch(/WAIT_DELAY:\s*['"][^'"]*지연/);
    }
  });
});

/**
 * 🔴 단계 어휘도 같은 대조를 받는다(2026-08-26).
 *    상황판에는 서버가 낸 적 없는 **유령 단계 4종**(`WAITING`·`POST_CONSULT`·`EXAM`·`PHARMACY`)이
 *    영구 `0` 으로 떠 있었고, 입원 키 2종은 **오타**(`ADMIT`/`DISCHARGE_PLAN`)였다.
 */
function serverStages(): Set<string> {
  const src = readFileSync(join(SVC_DIR, 'journey-console.service.ts'), 'utf8');
  const out = new Set<string>();
  // 삼항으로 조립되는 자리까지 포함해 문자열 리터럴 후보를 모은다
  for (const m of src.matchAll(/stage: '([A-Z_]+)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/\?\s*'([A-Z_]{4,})'\s*\n?\s*:/g)) out.add(m[1]);
  for (const m of src.matchAll(/:\s*'(ER_[A-Z_]+|ADMITTED|INWARD|DISCHARGE_PLANNED|DISCHARGED)'/g)) out.add(m[1]);
  return out;
}

describe('여정 단계 어휘', () => {
  const server = serverStages();

  it('스캔이 실제로 무언가를 찾았다 — 0을 통과로 읽지 않는다', () => {
    expect(server.size).toBeGreaterThanOrEqual(10);
  });

  it('🔴 정본에 서버가 내지 않는 단계를 두지 않는다(영구 0 은 "아무도 없다"로 읽힌다)', () => {
    const ghosts = ALL_JOURNEY_STAGE_KEYS.filter((k) => !server.has(k));
    expect(ghosts, `서버가 내지 않는 단계: ${ghosts.join(', ')}`).toEqual([]);
  });

  it('🔴 서버가 내는 단계는 전부 정본에 라벨이 있다(영문이 새지 않는다)', () => {
    const missing = [...server].filter((k) => !ALL_JOURNEY_STAGE_KEYS.includes(k));
    expect(missing, `정본에 없는 서버 단계: ${missing.join(', ')}`).toEqual([]);
  });
});
