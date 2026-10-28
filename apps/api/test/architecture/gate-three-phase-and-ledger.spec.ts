import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { enforceGate, recordGateViolation } from '../../src/common/gate-enforce';

/**
 * 구조 가드 — **게이트의 3상이 실제로 3상인가 · 위반이 실제로 어딘가에 남는가.**
 *
 * 🔴 왜 필요한가(2026-08-26 A4 전수 판정):
 *   ① **WARN == OFF** — 게이트 4종이 호출부에서 `gateMode(...) === 'BLOCK'` **하나만** 분기했다.
 *      설정 설명은 `OFF|WARN|BLOCK` 3상을 말하고 관제 화면은 WARN 버튼을 그리는데,
 *      WARN 으로 올려도 차단도 기록도 경고도 없어 **OFF 와 완전히 동일**했다.
 *      → 이 저장소의 게이트 규약(OFF → WARN 으로 근거 수집 → BLOCK 승격)이 원리적으로 작동 불가.
 *   ② **위반이 아무 곳에도 영속되지 않는 ON 게이트** — 예외만 던지거나 `logger.warn` 뿐이라
 *      관제의 "위반 0건"이 **준수인지 미평가인지 구분되지 않았다**(v4.4.0 DUR 43룰과 같은 유형).
 *
 * 🔴 이 가드는 **결함을 재주입하면 실패해야** 가드다. 재주입 검증:
 *   · `radiation.service.ts` 의 `enforceGate({ gateKey: 'radiation.igrtEnforce' …})` 를
 *     `if (gateMode(await this.config?.get('radiation.igrtEnforce'), 'OFF') === 'BLOCK')` 로 되돌리면
 *     ①·② 두 케이스가 동시에 실패한다(2026-08-26 실제로 되돌려 확인).
 *   · `SafetyGateService.NON_VIOLATION_SEVERITIES` 에서 `'EXEMPT'` 를 빼면 ④ 가 실패한다.
 *   · `wiredGates()` 에서 새 항목을 지우면 ③ 이 실패한다.
 *
 * 대조군도 함께 둔다 — **성공하는 코드를 실패로 말하지 않는다**(무조건 실패하는 가드는 가드가 아니다).
 */

const API_SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel: string) => fs.readFileSync(path.join(API_SRC, rel), 'utf-8');
/** 줄바꿈·들여쓰기로 갈라진 호출을 놓치지 않는다 — 포매팅이 가드를 통과시키면 가드가 아니다 */
const flat = (rel: string) => read(rel).replace(/\s+/g, ' ');

/**
 * 3상(OFF|WARN|BLOCK)으로 선언된 게이트 중, 종전에 `=== 'BLOCK'` 단일 분기였던 것들.
 * 이 넷은 반드시 3상 정본(`common/gate-enforce`)을 통과해야 한다.
 */
const THREE_PHASE_GATES: { key: string; file: string }[] = [
  { key: 'radiation.igrtEnforce', file: 'modules/radiation/radiation.service.ts' },
  { key: 'obgyn.newbornId.enforce', file: 'modules/obgyn/obgyn.service.ts' },
  { key: 'cssd.biCiEnforce', file: 'modules/cssd/cssd.service.ts' },
  { key: 'dialysis.ufRateEnforce', file: 'modules/dialysis/dialysis.service.ts' },
];

/**
 * 켜져 있는데 위반이 아무 데도 남지 않던 게이트 — 이제 원장(`SafetyGateService.record`)에 남아야 한다.
 *
 * 🔴 2026-08-26 후속: `pharmacy.highAlertDoubleCheck` · `asp.enforce` 도 배선돼 여기로 옮겼다.
 *    (종전 `PENDING_LEDGER_GATES` 목록은 비었으므로 그 항목과 그 항목만 보던 테스트를 삭제했다 —
 *     비지 않았는데 지우는 것이 결함이고, 비었는데 남겨두면 "아직 남았다"는 거짓말이 된다.)
 */
const LEDGER_GATES: { key: string; file: string }[] = [
  { key: 'inpatient.dischargeGate', file: 'modules/inpatient/inpatient.service.ts' },
  { key: 'surgery.preAnesthesiaGate', file: 'modules/surgery/surgery-advanced.service.ts' },
  { key: 'queue.completeRequiresSign', file: 'modules/waiting-queue/waiting-queue.service.ts' },
  { key: 'pharmacy.highAlertDoubleCheck', file: 'modules/pharmacy/pharmacy.service.ts' },
  { key: 'asp.enforce', file: 'modules/pharmacy/pharmacy.service.ts' },
  { key: 'bloodBank.bedsideScan.enforce', file: 'modules/blood-bank/blood-bank.service.ts' },
  { key: 'bloodbank.issueEnforce', file: 'modules/blood-bank/blood-bank.service.ts' },
  { key: 'radiation.doseEnforce', file: 'modules/radiation/radiation.service.ts' },
  ...THREE_PHASE_GATES,
];

describe('안전 게이트 — 3상 집행과 위반 원장', () => {
  // ── ① WARN 이 OFF 와 같아지는 단일 분기가 남아 있지 않은가 ──
  it.each(THREE_PHASE_GATES)('$key — `=== \'BLOCK\'` 단일 분기가 없다(WARN 이 OFF 와 같아지면 승격 근거가 안 생긴다)', ({ key, file }) => {
    const src = read(file);
    // `get('<key>')` 와 `=== 'BLOCK'` 이 같은 표현식(한 줄)에 있으면 3상이 아니다
    const singleBranch = new RegExp(`get\\(\\s*'${key.replace(/\./g, '\\.')}'\\s*\\)[^\\n]*===\\s*'BLOCK'`);
    expect(src, `${file}: ${key} 가 BLOCK 만 분기한다 — WARN 이 OFF 와 동일해진다`).not.toMatch(singleBranch);
  });

  it.each(THREE_PHASE_GATES)('$key — 3상 정본 enforceGate 를 통과한다', ({ key, file }) => {
    const src = read(file);
    expect(src, `${file}: ${key} 가 enforceGate 로 집행되지 않는다`).toContain(`gateKey: '${key}'`);
  });

  // ── ② 위반이 실제로 원장에 남는가 ──
  it.each(LEDGER_GATES)('$key — 위반이 GateViolationLog 로 간다(예외만 던지면 관제의 0건이 무의미하다)', ({ key, file }) => {
    const src = flat(file);
    const recorded = src.includes(`record( '${key}'`) || src.includes(`record('${key}'`) || src.includes(`gateKey: '${key}'`);
    expect(recorded, `${file}: ${key} 위반이 SafetyGateService.record 로 가지 않는다`).toBe(true);
  });

  // ── ③ 원장에 쌓기만 하고 관제가 보지 않으면 절반이다 ──
  it('원장에 기록하는 모든 게이트가 관제(wiredGates)에 등재돼 있다', () => {
    const console_ = read('modules/safety-gate/safety-gate.service.ts');
    const missing = LEDGER_GATES.map((g) => g.key).filter((k) => !console_.includes(`key: '${k}'`));
    expect(missing, `관제 wiredGates 에 없는 게이트: ${missing.join(', ')}`).toEqual([]);
  });

  /**
   * 🔴 원장에 남기는 코드가 있다는 것과, 런타임에 그 기록자가 **주입돼 있다**는 것은 다른 일이다.
   *    `SafetyGateService` 는 비글로벌이고 소비처가 전부 `@Optional()` 이라,
   *    소비 모듈이 `SafetyGateModule` 을 import 하지 않으면 `this.gates` 가 undefined 가 되어
   *    **집행은 그대로 되면서 기록만 조용히 사라진다**(= 관제가 다시 "위반 0건"이라 말한다).
   *    구조 검사로는 이 층이 안 잡히므로 모듈 배선을 함께 못박는다.
   */
  it.each([...new Set(LEDGER_GATES.map((g) => g.file))])(
    '%s 의 모듈이 SafetyGateModule 을 import 한다(주입 안 되면 기록만 조용히 사라진다)',
    (file) => {
      const moduleFile = file.replace(/\.service\.ts$/, '.module.ts').replace(/-advanced\.module\.ts$/, '.module.ts');
      const dir = path.dirname(path.join(API_SRC, moduleFile));
      const candidates = fs.readdirSync(dir).filter((f) => f.endsWith('.module.ts'));
      // 🔴 `import { SafetyGateModule }` 줄이 있는 것만으로는 주입되지 않는다 —
      //    실제로 `@Module({ imports: [...] })` **배열 안**에 들어가야 한다.
      //    (재주입 검증 중 발견: 배열에서만 지우면 종전 조준의 가드가 통과해버렸다.)
      const wired = candidates.some((f) =>
        /imports:\s*\[[^\]]*SafetyGateModule/.test(fs.readFileSync(path.join(dir, f), 'utf-8').replace(/\/\/[^\n]*/g, '')),
      );
      expect(wired, `${dir}: SafetyGateModule 을 import 하는 모듈이 없다 — @Optional() 기록자가 undefined 가 된다`).toBe(true);
    },
  );

  // ── ④ 면제(EXEMPT)를 위반으로 세지 않는다 — 거짓 경보는 진짜 경보를 죽인다 ──
  it('EXEMPT/OVERRIDE 는 위반 집계에서 빠지고, 실제 위반 등급은 빠지지 않는다', () => {
    const src = read('modules/safety-gate/safety-gate.service.ts');
    const m = src.match(/NON_VIOLATION_SEVERITIES\s*=\s*\[([^\]]*)\]/);
    expect(m, 'NON_VIOLATION_SEVERITIES 정본이 없다').toBeTruthy();
    const list = (m![1].match(/'([^']+)'/g) ?? []).map((s) => s.replace(/'/g, ''));
    expect(list).toContain('EXEMPT');
    expect(list).toContain('OVERRIDE');
    // 대조군 — 진짜 위반 등급까지 빼면 위반이 영원히 0 이 된다
    expect(list).not.toContain('BLOCK');
    expect(list).not.toContain('WARN');
  });

  // ── ⑤ 사망 퇴원 면제가 코드에 적혀 있는가(적히지 않은 우회는 우회다) ──
  it('퇴원 게이트 면제(전원·사망)가 한 곳에 명시돼 있다', () => {
    const src = read('modules/inpatient/inpatient.service.ts');
    expect(src).toContain('GATE_EXEMPT_DISPOSITIONS');
    expect(src).toMatch(/TRANSFER:\s*'/);
    expect(src).toMatch(/DECEASED:\s*'/);
  });

  it('markDeceased 의 자동 퇴원이 면제 사실을 원장에 남긴다(우회를 침묵시키지 않는다)', () => {
    const src = flat('modules/patient/patient.service.ts');
    // 사망 자동 퇴원 블록 안에서 퇴원 게이트 면제를 기록해야 한다.
    // 🔴 호출 **모양**이 아니라 (게이트키 · 등급 EXEMPT · 정본 함수) 세 가지가 한 자리에 있는지를 본다 —
    //    모양만 단언하면 정본을 바꿀 때 가드가 사실이 아닌 이유로 깨진다(2026-08-26 실제로 깨졌다).
    expect(src).toMatch(/recordGateViolation\(\s*\{[^}]*gateKey:\s*'inpatient\.dischargeGate'[^}]*\}\s*,\s*'EXEMPT'/);
  });
});

describe('enforceGate — 3상 동작(정본 자체를 시험한다)', () => {
  const mkRecorder = () => {
    const calls: unknown[][] = [];
    return { calls, record: async (...a: unknown[]) => { calls.push(a); return undefined; } };
  };

  it('OFF — 위반이어도 아무 일도 없다(끈 게이트가 몰래 막지 않는다)', async () => {
    const r = mkRecorder();
    const out = await enforceGate({ gateKey: 'g', mode: 'OFF', violated: true, code: 'C', message: 'm', recorder: r });
    expect(out).toBeNull();
    expect(r.calls).toHaveLength(0);
  });

  it('WARN + 위반 — 막지 않되 반드시 남긴다', async () => {
    const r = mkRecorder();
    const out = await enforceGate({ gateKey: 'g', mode: 'WARN', violated: true, code: 'C', message: 'm', recorder: r });
    expect(out).toEqual({ gateKey: 'g', code: 'C', message: 'm' });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0][1]).toBe('WARN');
  });

  it('BLOCK + 위반 — 남기고 막는다(코드·문구는 호출부가 준 그대로)', async () => {
    const r = mkRecorder();
    await expect(
      enforceGate({ gateKey: 'g', mode: 'BLOCK', violated: true, code: 'C', message: 'm', blockMessage: '차단', recorder: r }),
    ).rejects.toMatchObject({ response: { code: 'C', message: '차단', gateKey: 'g' } });
    expect(r.calls).toHaveLength(1);
  });

  it('원장이 WARN 에는 사실을, BLOCK 문구는 응답에만 쓴다(원장이 "차단했다"고 거짓말하지 않는다)', async () => {
    const r = mkRecorder();
    await enforceGate({ gateKey: 'g', mode: 'WARN', violated: true, code: 'C', message: '상한 초과', blockMessage: '조사 불가: 상한 초과', recorder: r });
    expect(r.calls[0][2]).toBe('상한 초과');
  });

  // 🔴 대조군 — 위반이 아닌데 경보를 만들지 않는다(평가 모집단 0 인 축에 붉은 숫자를 만들면 진짜 경보가 묻힌다)
  it.each(['OFF', 'WARN', 'BLOCK'] as const)('%s + 위반 아님 — 기록도 차단도 없다', async (mode) => {
    const r = mkRecorder();
    const out = await enforceGate({ gateKey: 'g', mode, violated: false, code: 'C', message: 'm', recorder: r });
    expect(out).toBeNull();
    expect(r.calls).toHaveLength(0);
  });

  it('원장 기록이 실패해도 BLOCK 은 그대로 막는다(기록 장애가 게이트를 뚫지 않는다)', async () => {
    const failing = { record: async () => { throw new Error('ledger down'); } };
    await expect(
      enforceGate({ gateKey: 'g', mode: 'BLOCK', violated: true, code: 'C', message: 'm', recorder: failing }),
    ).rejects.toMatchObject({ response: { code: 'C' } });
  });
});

/**
 * 🔴 **"실패"를 "없음"으로 번역하지 않는다** — 게이트 위반 원장 편.
 *
 * 2026-08-26 실측: 게이트 위반 기록 호출 10지점이 `.catch(() => undefined)` 로 끝나고 있었다.
 * 그 한 줄이 **두 가지를 동시에 지운다**:
 *   ① 원장 쓰기 실패 ② 🔴 **`recorder` 자체가 주입되지 않은 경우**(`?.` 가 조용히 통과)
 *
 * ②가 실제로 일어나 있었다 — `SafetyGateService` 는 `@Global` 이 아니고 소비처가 전부 `@Optional()`
 * 이라, 모듈이 `SafetyGateModule` 을 import 하지 않으면 **집행은 되고 기록만 사라진다.**
 * `blood-bank`(4지점)·`waiting-queue`(1지점)가 그 상태였고 화면에는 "위반 0건"으로 보였다.
 *
 * 정본은 `common/gate-enforce.ts` `recordGateViolation()` — 실패해도 집행을 막지 않되 **로그로 남긴다.**
 */
describe('위반 원장 기록이 실패를 지우지 않는다', () => {
  const SRC = path.resolve(__dirname, '../../src');

  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.resolve(dir, e.name)) : e.name.endsWith('.ts') ? [path.resolve(dir, e.name)] : [],
    );

  /** 주석을 걷어낸다 — 내 설명문이 내 가드를 깨뜨린 사고가 이 저장소에서 4번 있었다 */
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('🔴 `record(...).catch(() => 기본값)` 이 없다 — 실패도 미주입도 남아야 한다', () => {
    const bad: string[] = [];
    for (const f of walk(SRC)) {
      const src = strip(fs.readFileSync(f, 'utf8'));
      // record( … ) 뒤에 곧바로 오는 .catch(() => …) 만 본다
      const re = /\.record\((?:[^()]|\([^()]*\))*\)\s*\.catch\(\s*\(\s*\)\s*=>/g;
      if (re.test(src)) bad.push(f.replace(SRC, 'src'));
    }
    expect(bad, `게이트 위반 기록을 삼키는 자리 — common/gate-enforce 의 recordGateViolation() 을 쓰세요:\n${bad.join('\n')}`).toEqual([]);
  });

  it('🔴 대조군: 정본 recordGateViolation 이 실제로 존재하고 로거로 남긴다(빈 가드 방지)', () => {
    const canon = fs.readFileSync(path.resolve(SRC, 'common/gate-enforce.ts'), 'utf8');
    expect(canon).toMatch(/export async function recordGateViolation/);
    const body = canon.slice(canon.indexOf('export async function recordGateViolation'));
    expect(body, 'recorder 미주입을 조용히 넘기면 안 된다').toMatch(/if \(!recorder\)[\s\S]{0,300}logger\?\.error/);
    expect(body, '기록 실패를 삼키면 안 된다').toMatch(/catch \(e\)[\s\S]{0,200}logger\?\.error/);
  });

  it('🔴 미주입이면 그 사실을 로그로 남긴다 — 조용히 넘어가지 않는다', async () => {
    const lines: string[] = [];
    const logger = { warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
    await recordGateViolation({ gateKey: 'x.y', recorder: undefined, logger, refType: 'A', refId: 'b' }, 'BLOCK', '사유');
    expect(lines.join('\n')).toMatch(/미주입/);
    expect(lines.join('\n')).toMatch(/SafetyGateModule/);
  });

  it('🔴 기록이 던져도 예외가 밖으로 나가지 않는다(집행을 뚫지 않는다) — 다만 로그는 남는다', async () => {
    const lines: string[] = [];
    const logger = { warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
    const recorder = { record: () => Promise.reject(new Error('DB down')) };
    await expect(
      recordGateViolation({ gateKey: 'x.y', recorder, logger, refType: 'A', refId: 'b' }, 'WARN', '사유'),
    ).resolves.toBeUndefined();
    expect(lines.join('\n')).toMatch(/기록 실패/);
  });

  it('대조군: 성공하면 조용하다 — 거짓 경보를 만들지 않는다', async () => {
    const lines: string[] = [];
    const logger = { warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
    const recorder = { record: () => Promise.resolve({}) };
    await recordGateViolation({ gateKey: 'x.y', recorder, logger }, 'WARN', '사유');
    expect(lines).toEqual([]);
  });
});
