import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import { serverMessageKeys, tOf, isServerMessage, type ServerMessage } from '@hospital-run/shared';

/**
 * 서버 표시 문장 `{ k, params }` 가드의 공용 부품 — 배치마다 같은 추출·검사를 다시 만들지 않는다.
 * 설계 `docs/01-plan/features/server-display-text-i18n.plan.md` §8.
 *
 * 🔴 `servermsg` 카탈로그의 고아 키 검사는 **전 배치 소스의 합집합**으로 한다 — 배치 하나만 보면
 *    다음 배치의 키가 전부 "고아"로 보이거나(오탐), 반대로 옮긴 배치를 빼먹어도 모른다.
 */

export const ROOT = path.resolve(__dirname, '../../../..');
const API = (rel: string) => path.join(ROOT, 'apps/api/src/modules', rel);
const API_COMMON = (rel: string) => path.join(ROOT, 'apps/api/src/common', rel);

/** 배치별 전환 소스 — 새 배치는 여기에 파일을 더한다 */
export const SERVER_MESSAGE_SOURCES = {
  goLive: [API('go-live/go-live.service.ts')],
  opening: [API('opening/opening.service.ts')],
  codeMaster: [
    'auto-mapper.service.ts', 'code-category-derive.service.ts', 'code-duplicate.service.ts',
    'code-export.service.ts', 'code-import.service.ts', 'code-master.service.ts', 'code-synonym.service.ts',
  ].map((f) => API(`code-master/${f}`)),
  recordTimeline: [API('record-timeline/record-insights.ts')],
  /** 예외 배치(I4) — `msgException(status, serverMsg(…))` · opening 예외는 위 `opening` 파일에 함께 있다 */
  exceptionDiagnosticTest: [API('diagnostic-test/diagnostic-test.service.ts')],
  exceptionQueryPipe: [API_COMMON('pipes/date-query.pipe.ts')],
  /** 예외 배치(D-27 · 2026-09-21) — 원격진료 녹화 서버 프록시(미설정 503·연결 실패 503·거부/해석 실패 502) */
  exceptionTelehealthRecordings: [API('telehealth/telehealth-recordings.service.ts')],
} as const;

/**
 * opening 이 `{ k: it.enactment.label }` 로 옮기는 집행 라벨 — 정본은 결정 서비스다.
 * 소스 리터럴이 opening 에 없으므로 정본 파일의 `enactmentStatusOf` 라벨을 뽑는다(다시 적지 않는다).
 */
export const ENACTMENT_LABEL_SOURCE = API('decision-registry/decision.service.ts');

export const PH = /\{([^{}\s]+)\}/g;
/** 번역 대상 = 자리 이름을 뺀 본문에 한글이 있다(`<Tf>` 는 자리 이름까지 보고 티를 달므로 ASCII 자리 이름만 예외가 된다) */
export const HAN_RAW = /[가-힣]/;
export const HAN = { test: (s: string) => HAN_RAW.test(s.replace(PH, '')) };
export const LOCALES = ['en', 'ja', 'ar'] as const;

export function sourceKeysOf(files: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/serverMsg\(\s*'((?:\\.|[^'\\])+)'/g)) out.add(m[1]);
    for (const m of src.matchAll(/\{ k: '((?:\\.|[^'\\])+)' \}/g)) out.add(m[1]);
    // 기록 값이 비었을 때의 낱말 조각(record-insights `orWord(v, '약품')` → `{ k: '약품' }`)
    for (const m of src.matchAll(/orWord\([^,]+, '([^']+)'\)/g)) out.add(m[1]);
    const lab = src.match(/const LABEL: Record<string, string> = \{([^}]*)\}/);
    for (const m of (lab?.[1] ?? '').matchAll(/'([^']+)'/g)) if (HAN_RAW.test(m[1])) out.add(m[1]);
  }
  return out;
}

export function enactmentLabels(): Set<string> {
  const src = fs.readFileSync(ENACTMENT_LABEL_SOURCE, 'utf8');
  const body = src.slice(src.indexOf('static enactmentStatusOf('));
  return new Set([...body.slice(0, body.indexOf('\n  }\n')).matchAll(/label: '([^']+)'/g)].map((m) => m[1]));
}

/** 전 배치 소스 키의 합집합 — 카탈로그 고아 키 검사용 */
export function allServerMessageKeys(): Set<string> {
  const out = new Set<string>();
  for (const files of Object.values(SERVER_MESSAGE_SOURCES)) for (const k of sourceKeysOf(files)) out.add(k);
  for (const k of enactmentLabels()) out.add(k);
  return out;
}

/** 한글이 든 키 중 en·ja·ar 어느 하나라도 미등재인 것(한글 자리 이름만 쓴 비번역 키도 결함으로) */
export function unregisteredKeys(keys: Iterable<string>): string[] {
  const missing: string[] = [];
  for (const k of keys) {
    if (!HAN.test(k)) { if (HAN_RAW.test(k)) missing.push(`한글 자리 이름(EN× 발생): ${k}`); continue; }
    for (const loc of LOCALES) if (tOf(k, loc).missing) missing.push(`${loc}: ${k}`);
  }
  return missing;
}

export function assertWellFormed(m: ServerMessage) {
  const names = new Set([...m.k.matchAll(PH)].map((x) => x[1]));
  expect(new Set(Object.keys(m.params ?? {})), `자리표시자↔params 불일치: ${m.k}`).toEqual(names);
  for (const v of Object.values(m.params ?? {})) if (isServerMessage(v)) assertWellFormed(v);
  for (const k of serverMessageKeys(m)) {
    // 🔴 자리 이름에만 한글이 있으면 <Tf> 가 번역 대상으로 보고 EN× 를 단다 — 그런 키는 없어야 한다
    if (!HAN.test(k)) { expect(HAN_RAW.test(k), `한글 자리 이름을 쓴 비번역 키: ${k}`).toBe(false); continue; }
    for (const loc of LOCALES) expect(tOf(k, loc).missing, `${loc} 미등재: ${k}`).toBe(false);
  }
}

/** 한글+보간 템플릿 줄 · `serverMsg('…' +` 연결 줄 — 주석·로그 줄 제외(스캐너와 같은 판정) */
export function composedLines(file: string): { composed: string[]; concat: string[] } {
  const src = fs.readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l) && !/logger\./.test(l));
  return {
    composed: src.filter((l) => [...l.matchAll(/`([^`]*)`/g)].some((m) => HAN.test(m[1]) && m[1].includes('${'))),
    concat: src.filter((l) => /serverMsg\(\s*'[^']*'\s*\+/.test(l)),
  };
}
