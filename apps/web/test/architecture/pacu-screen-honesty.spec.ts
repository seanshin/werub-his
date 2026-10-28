import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 🔴 회복실(PACU) 화면 정직성 가드 (2026-08-26).
 *
 * 실측 결함 4종을 못 박는다 — 각 항목은 결함을 그대로 재주입하면 실패한다.
 *
 *  1. **척도 만점을 화면이 적지 않는다.** 이 병원의 Aldrete 는 6항목 × 2 = 0~12 인데
 *     `pacu/page.tsx` 재실 배지와 `workstation/post-op` 표·상세가 **`/10`** 이라 적고 있었다
 *     (같은 화면 안에서 입력 폼은 `/12`). `9/12` 와 `9/10` 은 다른 임상 사실이다.
 *     → 만점·기준은 서버(`GET /api/v1/pacu/settings`)가 준다.
 *  2. **미측정을 교과서 정상값으로 접지 않는다.** post-op 표의 `(item.vitals?.spo2 ?? 100) < 95`
 *     — 상세 패널은 2026-08-19 에 `warnIf` 로 고쳤는데 **표는 그대로 남아 있었다**.
 *  3. **쓰기 폼 초기값이 정상값이 아니다.** Aldrete 6항목·PADSS 5항목이 전부 `2`(만점)로
 *     시작해서, 아무것도 누르지 않고 저장하면 **만점 평가**가 남았다.
 *  4. `queryFn` 안에서 조회 실패를 기본값으로 접지 않는다(`QueryErrorFallback` 이 죽는다).
 */
const APP = path.join(__dirname, '..', '..', 'src', 'app', '(main)');
const TARGETS = [
  path.join(APP, 'pacu', 'page.tsx'),
  path.join(APP, 'workstation', 'post-op', 'page.tsx'),
];

const read = (f: string) => fs.readFileSync(f, 'utf8');
const rel = (f: string) => path.relative(path.join(__dirname, '..', '..'), f);
/** 주석은 결함을 설명하려고 옛 코드를 인용한다 — 실제 코드 줄만 본다 */
const codeLines = (src: string) =>
  src.split('\n')
    .map((l, i) => ({ n: i + 1, t: l }))
    .filter(({ t }) => !/^\s*(\/\/|\/\*|\*)/.test(t));

describe('PACU 화면 — 척도 만점은 서버가 정본이다', () => {
  it.each(TARGETS)('%s 는 Aldrete·PADSS 만점을 화면에 적지 않는다', (file) => {
    const hits = codeLines(read(file))
      .filter(({ t }) => /aldret|padss/i.test(t) && /\/\s*1[0-9]\b/.test(t))
      .map(({ n, t }) => `${rel(file)}:${n} ${t.trim()}`);
    expect(hits, '만점은 settings.scales.*.max 로 받는다').toEqual([]);
  });

  it('두 화면 모두 서버 설정 EP 를 읽는다(만점·주기·임계의 출처)', () => {
    for (const f of TARGETS) {
      expect(read(f), `${rel(f)} 가 /api/v1/pacu/settings 를 읽지 않는다`).toContain('/api/v1/pacu/settings');
    }
  });
});

describe('PACU 화면 — 미측정을 정상값으로 접지 않는다', () => {
  it.each(TARGETS)('%s 에 교과서 정상값 폴백이 없다', (file) => {
    // `?? 100`(SpO2)·`?? 36.5`(체온)·`?? 72`(HR) 류 — 활력을 하나도 안 잰 환자를 정상으로 만든다
    const hits = codeLines(read(file))
      .filter(({ t }) => /\?\?\s*(100|98|95|72|36\.5|37)\b/.test(t))
      .map(({ n, t }) => `${rel(file)}:${n} ${t.trim()}`);
    expect(hits).toEqual([]);
  });

  it.each(TARGETS)('%s 에서 점수·활력을 숫자 폴백으로 접지 않는다', (file) => {
    const hits = codeLines(read(file))
      .filter(({ t }) => /(aldretScore|padssScore|painScore|ponvScore|spo2|lastTemp|\bhr\b|\brr\b)\s*\?\?\s*-?\d/.test(t))
      .map(({ n, t }) => `${rel(file)}:${n} ${t.trim()}`);
    expect(hits, '미평가·미측정은 null 로 두고 "미평가/미측정"이라 쓴다').toEqual([]);
  });
});

describe('PACU 화면 — 쓰기 폼은 미선택으로 시작한다', () => {
  const src = read(TARGETS[0]);

  it('🔴 Aldrete·PADSS 초기값이 만점(정상)이 아니다', () => {
    const hits = codeLines(src)
      .filter(({ t }) => /(activity|respiration|circulation|ambulation|bleeding|nausea)\s*:\s*\d/.test(t))
      .map(({ n, t }) => `${TARGETS[0]}:${n} ${t.trim()}`);
    expect(hits, '초기값은 emptyScores() — 누르지 않은 항목이 정상으로 저장되면 안 된다').toEqual([]);
    expect(src).toContain('emptyScores(ALDRETE_ITEMS)');
    expect(src).toContain('emptyScores(PADSS_ITEMS)');
  });

  it('의식수준·PONV·통증도 정상값으로 시작하지 않는다', () => {
    expect(src).not.toMatch(/consciousnessLevel:\s*'명료'/);
    expect(src).toMatch(/useState<number \| null>\(null\)/); // ponv·pain
  });

  it('전 항목을 평가하기 전에는 총점을 저장하지 않는다', () => {
    expect(src).toContain('aldreteComplete');
    expect(src).toContain('padssComplete');
    expect(src).toMatch(/disabled=\{saveAldreteMut\.isPending \|\| !aldreteComplete\}/);
  });
});

describe('PACU 화면 — 조회 실패를 "없음"으로 번역하지 않는다', () => {
  it.each(TARGETS)('%s 의 queryFn 에 폴백 catch 가 없다', (file) => {
    const src = read(file);
    const hits = codeLines(src)
      .filter(({ t }) => /queryFn/.test(t) && /\.catch\(/.test(t))
      .map(({ n, t }) => `${rel(file)}:${n} ${t.trim()}`);
    expect(hits).toEqual([]);
    expect(src, 'isError 를 화면이 말해야 한다').toContain('QueryErrorFallback');
  });
});

describe('PACU 화면 — 퇴실 게이트는 한 곳에만 있다', () => {
  it('🔴 워크스테이션 보드는 퇴실을 자기 손으로 처리하지 않는다', () => {
    const src = read(TARGETS[1]);
    // 종전엔 `/workstation/order/:id/complete` 를 불러 orders 행만 COMPLETED 로 바꿨다
    // — PACU 퇴실 게이트(Aldrete/PADSS·사유·인계)를 통째로 우회하는 두 번째 정본이었다.
    expect(src).not.toContain('/workstation/order/');
    expect(src).not.toMatch(/pacu\/[^'"`]*\/discharge/);
  });

  it('회복실 화면의 강제 퇴실은 사유 없이는 눌리지 않는다', () => {
    const src = read(TARGETS[0]);
    expect(src).toMatch(/belowThreshold && !overrideReason\.trim\(\)/);
  });
});
