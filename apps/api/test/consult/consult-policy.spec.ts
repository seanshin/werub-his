import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConsultService } from '../../src/modules/consult/consult.service';

/**
 * 상담 운영 정책 config 화 (2026-08-28 · 발굴 4회차).
 *
 * 🔴 발단: 영업시간·SLA 임계가 **환경변수**였고 **운영 .env 에 하나도 없었다** —
 *    즉 화면 어디에도 없는 코드 상수가 정책이었다(형제 `voc.sla.*` 는 설정 화면에 있다).
 *
 * 🔴 이 축의 위험은 **설정이 운영을 망가뜨리는 것**이다: 영업 시작 25시, 종료 0시,
 *    상신 임계가 경고보다 작은 값 — 전부 화면에서 저장될 수 있다.
 */
function makeSvc(cfgValues: Record<string, unknown> = {}, env: Record<string, string> = {}) {
  const cfg = { get: vi.fn(async (k: string) => cfgValues[k]) };
  const config = { get: vi.fn((k: string) => env[k]) };
  const svc = new ConsultService(
    {} as never, {} as never, config as never, {} as never,
    undefined, undefined, undefined, undefined, cfg as never,
  );
  return { svc, cfg, config };
}

/** 평일 정오로 고정 — 요일·시각이 흔들리면 이 테스트가 다른 이유로 통과한다 */
function atWeekdayHour(hour: number) {
  vi.useFakeTimers();
  const d = new Date(2026, 7, 26, hour, 0, 0); // 2026-08-26 = 수요일
  expect(d.getDay(), '픽스처가 평일이어야 한다').toBe(3);
  vi.setSystemTime(d);
}
afterEach(() => vi.useRealTimers());

describe('영업시간 — 설정 > 환경변수 > 상수', () => {
  it('설정이 없으면 종전 동작(평일 09~18시)', async () => {
    atWeekdayHour(10);
    const { svc } = makeSvc();
    await expect(svc.serviceOnline()).resolves.toBe(true);
    atWeekdayHour(20);
    await expect(makeSvc().svc.serviceOnline()).resolves.toBe(false);
  });

  it('설정이 있으면 설정이 이긴다', async () => {
    atWeekdayHour(20);
    const { svc } = makeSvc({ 'voc.consult.hourStart': 8, 'voc.consult.hourEnd': 22 });
    await expect(svc.serviceOnline()).resolves.toBe(true);
  });

  it('🔴 설정이 비면 환경변수를 본다 — 이미 env 로 운영 중인 배포가 조용히 바뀌면 안 된다', async () => {
    atWeekdayHour(20);
    const { svc } = makeSvc({}, { CONSULT_HOUR_START: '8', CONSULT_HOUR_END: '22' });
    await expect(svc.serviceOnline()).resolves.toBe(true);
  });

  it('🔴 범위를 벗어난 값은 쓰지 않는다 — 영업 시작 25시는 상담을 영영 닫는다', async () => {
    atWeekdayHour(10);
    const { svc } = makeSvc({ 'voc.consult.hourStart': 25, 'voc.consult.hourEnd': 99 });
    await expect(svc.serviceOnline(), '종전 동작으로 돌아간다').resolves.toBe(true);
  });

  it('🔴 시작 ≥ 종료인 모순 설정도 상담을 닫지 않는다', async () => {
    atWeekdayHour(10);
    const { svc } = makeSvc({ 'voc.consult.hourStart': 18, 'voc.consult.hourEnd': 9 });
    await expect(svc.serviceOnline()).resolves.toBe(true);
  });

  it('주말은 시간과 무관하게 영업시간 밖이다(대조군)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 29, 10, 0, 0)); // 토요일
    const { svc } = makeSvc({ 'voc.consult.hourStart': 0, 'voc.consult.hourEnd': 24 });
    await expect(svc.serviceOnline()).resolves.toBe(false);
  });
});

describe('🔴 소스 규약 — 설정이 조용히 무시되지 않는다', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');

  it('🔴 consult 모듈이 ConfigRuntimeModule 을 받는다 — @Optional() 이라 안 주면 설정이 무시된다', () => {
    const mod = read('modules/consult/consult.module.ts');
    // 🔴 **`imports:` 배열만 본다.** 파일 전체를 보면 상단 `import { ConfigRuntimeModule }`
    //    문이 검사를 대신 통과한다 — 배열에서 빼도 통과했다(실제로 재주입에서 잡혔다).
    const m = /imports:\s*\[([^\]]*)\]/.exec(mod);
    expect(m, 'imports 배열을 찾았다').toBeTruthy();
    expect(m![1], 'imports 배열에 없다').toMatch(/ConfigRuntimeModule/);
  });

  it('SLA 임계가 설정을 읽는다(환경변수만 보던 코드가 아니다)', () => {
    const src = read('modules/consult/consult.service.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).toMatch(/voc\.consult\.slaWarnSec/);
    expect(src).toMatch(/voc\.consult\.slaEscalateSec/);
    // 🔴 상신이 경고보다 작으면 경고 없이 바로 상신된다 — 그 보정이 있어야 한다
    expect(src).toMatch(/escSec <= warnSec/);
  });

  it('설정 정본에 5키가 등재돼 있다', () => {
    const def = read('modules/config/config-runtime.service.ts');
    for (const k of ['hourStart', 'hourEnd', 'slaWarnSec', 'slaEscalateSec', 'autoClassify']) {
      expect(def, `voc.consult.${k}`).toContain(`'voc.consult.${k}'`);
    }
  });
});
