import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
// 계측 규칙 정본은 스캐너 하나 — 주석·문자열 토크나이저를 여기서 다시 만들지 않는다
import { stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';
import { CATCH_DEFAULT_BASELINE, CATCH_NONLITERAL_BASELINE } from './catch-default-inventory.baseline';

/**
 * 🔴 **`.catch(() => 기본값)` 은 "실패"를 "없음"으로 번역하는 코드다**(판정 규칙 §1 · §부분실패).
 *
 * 2026-09-15 N4 전수: api `src/modules/**` 에 371곳(주석 제외). 위험순으로 읽어 **판정·화면·외부 송신에 '없음'이 흘러간
 * 실결함 17곳**(13항목)을 전파/3상태로 고쳤다(opening 제목·사전승인 고가영상 판정기준·본인부담 자격조회·ERP 입원일 2·
 * 프로토콜 조건 분기 컨텍스트 2·만성질환 담당의 2·내원 전 동의서 체크리스트·서명원장 미기록 취소 집계·
 * DUR 진료 해석 사유·ERP 전자결재 멱등 조회·LIS 중복 결과 가드). 나머지는 대부분 설정 조회의 정본 폴백
 * (`positiveNumberOr` 등 — 폴백 자체가 정본에 명시)·베스트에포트 부수 기록(히트 카운트·파일 삭제)이다.
 *
 * 🔴 **파일별 정확 동결**(총계가 아니라) — 총계로 동결하면 하나 고치고 하나 새로 만들어도 통과한다.
 *    늘면 실패: 삼키지 말고 전파하거나 3상태로 말한다(정당하면 이유와 함께 기준선을 올린다).
 *    줄면 실패: 기준선을 낮춘다(여유 0).
 * 🔴 **상한이지 전수가 아니다** — 화살표 본문이 리터럴 기본값인 모양만 센다(`.catch((e) => { log; return null })` 처럼
 *    흔적을 남기는 3상태 전환은 세지 않는다 — 그것이 고친 모양이다).
 */
const MODULES = path.join(__dirname, '..', '..', 'src', 'modules');
const CATCH_DEFAULT = /\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)?\s*=>\s*(?:null|undefined|\[\]|0|\{\s*\}|false)\s*\)/g;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

export function countCatchDefaults(source: string): number {
  return ((stripComments(source) as string).match(CATCH_DEFAULT) ?? []).length;
}

/**
 * 🔴 위 정규식이 못 보는 모양 — `=> ({...})` `=> ([...])` `=> ''` `=> 숫자` `=> true`.
 *    같은 삼킴인데 리터럴이 아니라서 인벤토리에 한 번도 들어온 적이 없었다(2026-09-27 실측 46곳).
 */
const CATCH_NONLITERAL = /\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)?\s*=>\s*(?:\(\s*[{[]|''|""|``|-?[1-9][0-9]*|true)/g;

export function countCatchNonLiteral(source: string): number {
  return ((stripComments(source) as string).match(CATCH_NONLITERAL) ?? []).length;
}

function inventory(count: (s: string) => number = countCatchDefaults): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of tsFiles(MODULES)) {
    const n = count(fs.readFileSync(f, 'utf8'));
    if (n > 0) out[path.relative(MODULES, f).split(path.sep).join('/')] = n;
  }
  return out;
}

describe('`.catch(() => 기본값)` 인벤토리 — 파일별 정확 동결', () => {
  it('스캐너 대조군 — 리터럴 기본값만 세고, 흔적을 남기는 3상태 전환은 세지 않는다', () => {
    expect(countCatchDefaults('a.catch(() => null); b.catch(() => []); c.catch(e => 0); d.catch(() => {});')).toBe(4);
    expect(countCatchDefaults('a.catch((e) => { log(e); return null; })')).toBe(0);
    expect(countCatchDefaults('// 종전 `.catch(() => null)` 이었다')).toBe(0);
  });

  it('하한 — 스캔이 비어 조용히 통과하지 않는다', () => {
    expect(Object.keys(inventory()).length).toBeGreaterThan(100);
  });

  it('파일별 수가 기준선과 정확히 같다(늘면 새 삼킴 · 줄면 기준선을 낮춘다)', () => {
    expect(inventory()).toEqual(CATCH_DEFAULT_BASELINE);
  });

  it('스캐너 대조군(비리터럴) — 객체·배열·문자열·숫자 폴백을 세고, 3상태 전환은 세지 않는다', () => {
    expect(countCatchNonLiteral("a.catch(() => ({ count: 0 })); b.catch(() => ([])); c.catch(e => ''); d.catch(() => 1); e.catch(() => true);")).toBe(5);
    expect(countCatchNonLiteral('a.catch((e) => { log(e); return { count: 0 }; })'), '흔적을 남기는 전환을 삼킴으로 셌다').toBe(0);
    expect(countCatchNonLiteral('// 종전 `.catch(() => ({ count: 0 }))` 이었다'), '주석을 코드로 셌다').toBe(0);
    expect(countCatchNonLiteral('a.catch(() => null)'), '리터럴 인벤토리와 이중으로 셌다').toBe(0);
  });

  it('🔴 비리터럴 폴백도 파일별 정확 동결 — 리터럴만 세던 사각으로 새 삼킴이 들어오지 않는다', () => {
    expect(inventory(countCatchNonLiteral)).toEqual(CATCH_NONLITERAL_BASELINE);
  });
});
