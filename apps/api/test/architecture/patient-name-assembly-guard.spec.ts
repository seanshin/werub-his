/**
 * 🔴 이름을 `${familyName}${givenName}` 로 붙여 쓰는 자리 — 늘지 않는다(2026-10-06 기준선 동결).
 *
 * 외국 이름은 붙이면 `Бат-ЭрдэнэСарнай`·`Al-RashidFatima` 가 되고, 한국식 호칭(`Patient.koreanName`)은 보이지 않는다.
 * 정본은 shared `joinPatientName`(띄어쓰기) · `patientNameView`/`patientNameLabel`(한국식 호칭) · 화면 부품 `<PatientName koreanName>`.
 * 수백 곳을 한 번에 고치지 않았다 — 많이 보는 화면(오더 추적·매트릭스·간호 보드·수술·환자 목록/머리)만 옮기고 **기준선을 동결**한다.
 * 🔴 이 수에는 직원 이름(StaffName 영역)도 섞여 있다 — "결함 N건"이 아니라 "늘지 않는다"를 지킨다. 줄었으면 기준선을 내린다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const TEMPLATE = /\$\{[^}]*familyName[^}]*\}\$\{[^}]*givenName[^}]*\}/g;
const JSX = /\{[a-zA-Z_.?]*familyName\}\{[a-zA-Z_.?]*givenName\}/g;

function count(dir: string, exts: string[], re: RegExp): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') n += count(p, exts, re); continue; }
    if (!exts.some((x) => e.name.endsWith(x)) || /\.(spec|test)\.tsx?$/.test(e.name)) continue;
    n += (fs.readFileSync(p, 'utf8').match(re) ?? []).length;
  }
  return n;
}

// 328 → 326 (2026-10-07 의사 할 일함 차트 연계): 구두 처방 확인·갱신 대기의 환자 링크를 <PatientName> 으로
const BASELINE = { apiTemplate: 367, webTemplate: 280, webJsx: 324 }; // 2026-10-20 −1 환자 목록 내 환자 · P2 −2·−1 병합 창·중복 검토(정본 PatientName)

describe('🔴 이름 붙여 쓰기 자리 — 늘지 않는다', () => {
  const now = {
    apiTemplate: count(path.join(ROOT, 'apps/api/src'), ['.ts'], TEMPLATE),
    webTemplate: count(path.join(ROOT, 'apps/web/src'), ['.ts', '.tsx'], TEMPLATE),
    webJsx: count(path.join(ROOT, 'apps/web/src'), ['.tsx'], JSX),
  };
  it('대조군 — 스캐너가 살아 있다(하한)', () => {
    expect(now.apiTemplate).toBeGreaterThan(50);
    expect(now.webJsx).toBeGreaterThan(50);
  });
  it('늘지 않는다 — 새 자리는 joinPatientName·<PatientName koreanName> 를 쓴다', () => {
    for (const k of Object.keys(BASELINE) as (keyof typeof BASELINE)[]) {
      expect(now[k], `${k}: 기준선 ${BASELINE[k]} 을 넘었다 — 정본을 쓰라`).toBeLessThanOrEqual(BASELINE[k]);
    }
  });
  it('기준선이 낡지 않았다 — 줄었으면 내려라', () => {
    expect(now).toEqual(BASELINE);
  });
});
