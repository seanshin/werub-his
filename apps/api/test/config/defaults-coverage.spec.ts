import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULTS } from '../../src/modules/config/config-runtime.service';
import { PacuService } from '../../src/modules/pacu/pacu.service';

/**
 * 런타임 설정 키의 관리 화면 노출 계약 — 2026-08-03.
 *
 * 🔴 `ConfigRuntimeService.get('...')` 로 읽는 키가 `DEFAULTS` 에 없으면 **관리 화면에 뜨지 않는다**
 *    (`getAll` 이 DEFAULTS 를 순회하며 DB 값으로 덮어쓰는 구조라, DB 에 행이 있어도 안 뜬다).
 *    기능은 구현돼 있는데 켜고 끌 방법이 화면에 없는 상태가 된다 — 실제로 그렇게 잠겨 있던 것:
 *      · `appointment.autoNoShow` 3키 → 지난 예약 118건이 SCHEDULED 로 적체
 *      · `encounter.requireDiagnosisOnSign` → 진단 없는 서명 78건
 *      · BCMA·수혈 bedside·마취전평가·퇴원요약 게이트 → 화면에서 조작 불가
 *
 * 이 테스트는 **새로 추가되는 키**가 같은 함정에 빠지는 것을 막는다.
 * 아래 KNOWN_UNREGISTERED 는 2026-08-03 시점 기존 잔여분이다 — 등재할 때마다 목록에서 지운다.
 * (시크릿류는 화면 노출 여부 자체가 판단 대상이라 일괄 등재하지 않았다)
 */
const API_SRC = join(process.cwd(), 'src');
const CONFIG_FILE = join(API_SRC, 'modules/config/config-runtime.service.ts');

/**
 * 등재하지 않은 채 남아 있는 기존 키 — **새 키를 여기 추가하지 말 것**. 등재가 정답이다.
 * 2026-08-03 일괄 등재로 전량 소진(48키 — 시크릿 11 은 응답 마스킹(*key/*secret/*token 패턴)
 * 확인 후 등재·쓰기는 ADMIN 전용). 빈 값 의미는 각 소비부의 폴백과 일치시켰다(fail-closed 유지).
 */
const KNOWN_UNREGISTERED = new Set<string>([]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.includes('.spec.')) out.push(p);
  }
  return out;
}

/**
 * 🔴 2026-08-26 확장 — **리터럴만 세면 한 겹의 간접이 그대로 빠져나간다.**
 *
 * 회복실 3키(`pacu.vitalsIntervalMin`·`pacu.prolongedStayMin`·`pacu.hypothermiaWarnC`)가
 * 이 가드를 통과한 채 미등재로 남아 있었다. 코드가
 *   `const CONFIG_KEYS = { vitalsIntervalMin: 'pacu.vitalsIntervalMin', ... }`
 *   → `this.config!.get(key)`   (인자가 **변수**라 위 정규식에 안 걸린다)
 * 형태였기 때문이다. 상수로 한 번 접어 두면 "관리 화면에 안 뜬다"는 함정이 다시 열린다.
 *
 * 그래서 **이름 붙은 키 상수**(`*_KEY` 스칼라 / `*_KEYS`·`CONFIG_KEYS` 맵)를 한 겹 풀어 함께 센다.
 * 범위를 파일 전체 문자열로 넓히지 않은 이유: 그러면 이벤트명(`encounter.signed` 등)까지 끌려와
 * 기존 위반 126건이 쏟아지고, 쏟아지는 가드는 꺼지는 가드가 된다(대상은 0 이 아니어야 하되 소음도 아니어야 한다).
 */
const SHARED_SRC = join(process.cwd(), '..', '..', 'packages', 'shared', 'src');
/** 설정 키 모양 — 소문자 시작 + 점 구분(이벤트명과 형태가 겹치므로 "키 상수" 안에 있는 것만 본다) */
const KEY_SHAPE = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/;
/** 키 상수 이름 규약 — `HIS_MODE_CONFIG_KEY`(스칼라) · `CONFIG_KEYS`(맵) */
const KEY_CONST_NAME = /^[A-Z][A-Z0-9_]*_?KEYS?$/;

/** 이름 붙은 키 상수 → 그 안의 설정 키들 (api/src + packages/shared/src) */
function namedKeyConstants(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const files = [...walk(API_SRC)];
  try { files.push(...walk(SHARED_SRC)); } catch { /* shared 없으면 api 만 */ }
  for (const file of files) {
    const txt = readFileSync(file, 'utf-8');
    // 스칼라: const NAME = 'a.b';
    for (const m of txt.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([\w.]+)['"]/g)) {
      const [, name, key] = m;
      if (!KEY_CONST_NAME.test(name) || !KEY_SHAPE.test(key)) continue;
      out.set(name, [...(out.get(name) ?? []), key]);
    }
    // 맵: const NAME = { x: 'a.b', ... }  (첫 `}` 까지 — 키 상수 맵은 평평하다)
    for (const m of txt.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*\{([^}]*)\}/g)) {
      const [, name, body] = m;
      if (!KEY_CONST_NAME.test(name)) continue;
      const keys = [...body.matchAll(/['"]([\w.]+)['"]/g)].map((k) => k[1]).filter((k) => KEY_SHAPE.test(k));
      if (keys.length) out.set(name, [...(out.get(name) ?? []), ...keys]);
    }
  }
  return out;
}

/** ConfigRuntimeService 로 주입된 프로퍼티를 통해 읽는 키만 수집(NestJS ConfigService=env 는 제외) */
function runtimeConfigKeys(): Map<string, string> {
  const found = new Map<string, string>();
  const call = /(?:this\.)?(\w+)\??\.get(?:Bool|Number|String)?\(\s*['"]([a-z][\w.]*)['"]/g;
  const constants = namedKeyConstants();
  for (const file of walk(API_SRC)) {
    const txt = readFileSync(file, 'utf-8');
    const rel = file.slice(API_SRC.length + 1);
    const usesConfigSvc = /ConfigRuntimeService/.test(txt);
    for (const m of txt.matchAll(call)) {
      const [, prop, key] = m;
      const decl = new RegExp(`(?:private|public|readonly)\\s+(?:readonly\\s+)?${prop}\\??\\s*:\\s*(\\w+)`).exec(txt);
      if (decl?.[1] === 'ConfigRuntimeService') found.set(key, rel);
    }
    // 한 겹 간접 — 설정 서비스를 쓰는 파일이 키 상수를 참조하면 그 키도 "코드가 읽는 키"다.
    if (!usesConfigSvc) continue;
    for (const [name, keys] of constants) {
      if (!new RegExp(`\\b${name}\\b`).test(txt)) continue;
      for (const k of keys) if (!found.has(k)) found.set(k, `${rel} (${name})`);
    }
  }
  return found;
}

function declaredKeys(): Set<string> {
  const src = readFileSync(CONFIG_FILE, 'utf-8');
  const start = src.indexOf('const DEFAULTS');
  const end = src.indexOf('\n};', start);
  expect(start).toBeGreaterThan(-1);
  return new Set([...src.slice(start, end).matchAll(/^\s*'([\w.]+)':\s*\{/gm)].map((m) => m[1]));
}

describe('런타임 설정 키는 관리 화면에 노출된다', () => {
  it('코드가 읽는 키는 DEFAULTS 에 등재돼 있다 (기존 잔여분 제외)', () => {
    const used = runtimeConfigKeys();
    const declared = declaredKeys();
    const missing = [...used.keys()]
      .filter((k) => !declared.has(k) && !KNOWN_UNREGISTERED.has(k))
      .map((k) => `${k}  (${used.get(k)})`);
    expect(missing).toEqual([]);
  });

  it('이번에 등재한 게이트들이 실제로 들어 있다', () => {
    const declared = declaredKeys();
    for (const k of [
      'encounter.requireDiagnosisOnSign', 'appointment.autoNoShow', 'appointment.autoNoShow.lookbackHours',
      'reception.staleQueueAutoCloseHours', 'nursing.bcma.enforce', 'bloodBank.bedsideScan.enforce',
      'surgery.preAnesthesiaGate', 'inpatient.dischargeGate', 'queue.completeRequiresSign',
    ]) {
      expect(declared.has(k), `${k} 미등재`).toBe(true);
    }
  });

  it('잔여 목록이 줄어들면 목록에서도 지운다(등재된 키가 남아 있으면 실패)', () => {
    const declared = declaredKeys();
    const stale = [...KNOWN_UNREGISTERED].filter((k) => declared.has(k));
    expect(stale, '등재됐으니 KNOWN_UNREGISTERED 에서 지울 것').toEqual([]);
  });

  it('한 겹 간접(키 상수)도 실제로 수집된다 — 대상이 0 이면 이 가드는 아무것도 지키지 않는다', () => {
    const used = runtimeConfigKeys();
    const viaConstant = [...used.entries()].filter(([, where]) => where.includes('('));
    expect(viaConstant.length, '키 상수 경유로 수집된 키가 하나도 없다 = 수집기가 죽었다').toBeGreaterThan(0);
    // 실제로 그 경로로만 도달하는 키(회복실 3키)를 지목해 둔다
    expect([...used.keys()]).toContain('pacu.vitalsIntervalMin');
  });
});

/**
 * 🔴 회복실(PACU) 감시 기준 — **등재는 했는데 그 등재가 화면을 거짓말시키면 안 된다**.
 *
 * `ConfigRuntimeService.get()` 은 DB 행이 없으면 `DEFAULTS[key].value` 를 돌려준다.
 * 그래서 여기에 15·120·36 을 박으면 **아무도 설정하지 않았는데도** 값이 돌아오고,
 * `PacuService.getMonitoringSettings` 의 `source` 가 `DEFAULT` → `CONFIG` 로 뒤집혀
 * 회복실 화면 두 곳이 "원내 정책 미설정 — 기본값 적용 중"을 멈춘다(= 개발자 기본값을 병원 정책인 척).
 *
 * 재주입 검증:
 *  · DEFAULTS 에서 `pacu.*` 를 지우면 → 위 '코드가 읽는 키는 DEFAULTS 에 등재돼 있다' 가 실패
 *  · DEFAULTS 의 `pacu.*` 값을 15/120/36 으로 채우면 → 아래 'source 는 DEFAULT' 가 실패
 *  · 코드 폴백(PACU_MONITORING_DEFAULTS)을 바꾸면 → 아래 임계 단언이 실패(조용한 변경 방지)
 */
describe('회복실 설정 키 — 등재하되 정책인 척하지 않는다', () => {
  /** 실제 get() 의미(“DB 행 없음 → DEFAULTS 값 ?? null”)를 그대로 흉내낸다 */
  const configFromDefaultsOnly = { get: async (key: string) => (DEFAULTS[key]?.value ?? null) };
  const svc = (config: { get: (k: string) => Promise<unknown> }) =>
    new PacuService({} as never, undefined, undefined, config as never);

  it('3키가 DEFAULTS 에 등재돼 있다(= 관리 화면 시스템 설정 · clinical 탭에 뜬다)', () => {
    for (const k of ['pacu.vitalsIntervalMin', 'pacu.prolongedStayMin', 'pacu.hypothermiaWarnC']) {
      expect(DEFAULTS[k], `${k} 미등재 — 관리 화면에 뜨지 않는다`).toBeTruthy();
      expect(DEFAULTS[k].category).toBe('clinical');
    }
  });

  it('🔴 아무도 설정하지 않았으면 source 는 DEFAULT 다 — 임계는 코드 폴백 그대로(15·120·36.0)', async () => {
    const s = await svc(configFromDefaultsOnly).getMonitoringSettings();
    expect(s.source, 'DEFAULTS 에 값을 박으면 미설정이 "원내 설정값"으로 둔갑한다').toBe('DEFAULT');
    expect(s.vitalsIntervalMin).toBe(15);
    expect(s.prolongedStayMin).toBe(120);
    expect(s.hypothermiaWarnC).toBe(36.0);
  });

  it('대조군 — 원내가 실제로 값을 넣으면 CONFIG 라 말하고 그 값을 쓴다(무조건 DEFAULT 라 말하지 않는다)', async () => {
    const set: Record<string, unknown> = { 'pacu.vitalsIntervalMin': 30 };
    const s = await svc({ get: async (k: string) => (k in set ? set[k] : DEFAULTS[k]?.value ?? null) }).getMonitoringSettings();
    expect(s.source).toBe('CONFIG');
    expect(s.vitalsIntervalMin).toBe(30);
    expect(s.prolongedStayMin).toBe(120); // 나머지는 폴백 유지
  });

  it('설명이 코드 폴백 수치를 그대로 적는다 — 화면에서 "무엇이 적용 중인지" 읽을 수 있어야 한다', () => {
    const expected: Record<string, string> = {
      'pacu.vitalsIntervalMin': '15',
      'pacu.prolongedStayMin': '120',
      'pacu.hypothermiaWarnC': '36.0',
    };
    for (const [k, n] of Object.entries(expected)) {
      expect(DEFAULTS[k].description, `${k} 설명에 폴백 ${n} 이 없다(설명과 코드가 갈라진다)`).toContain(n);
    }
  });
});
