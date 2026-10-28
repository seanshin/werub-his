import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 구조 가드 — **투약 확인(MAR) 화면과 `AdministerMedDto` 를 기계로 대조한다.**
 *
 * 🔴 이 가드가 생긴 이유(2026-08-18 재현):
 *   BE 의 고위험약 독립 이중확인(IPSG.3) 로직은 견고했는데 **투약 EP 를 부르는 화면 4곳이
 *   전부 `verifiedBy` 를 보내지 않아** 고위험약이 전건 우회됐다. 2차 확인자를 고르는 UI 자체가 없었다.
 *
 * 🔴 그리고 전역 `whitelist: true` 는 **DTO 에 없는 키를 조용히 지운다.**
 *   화면이 `verifiedBy`·`doubleCheckBypassReason` 를 보내도 DTO 에 없으면 성공 응답과 함께 사라진다.
 *   → 두 방향을 모두 기계로 못박는다:
 *      ① 화면이 보내는 모든 키가 DTO 에 실재하는가(whitelist 소실 방지)
 *      ② 이중확인 경로가 **모든** 투약 화면에 배선돼 있는가(EP 를 고치면 부르는 화면까지가 한 벌)
 */

const REPO = path.join(__dirname, '..', '..', '..', '..');
const WEB_SRC = path.join(REPO, 'apps', 'web', 'src');
const DTO_FILE = path.join(__dirname, '..', '..', 'src', 'modules', 'nursing', 'dto', 'nursing-extra.dto.ts');
const DC_COMPONENT = path.join(WEB_SRC, 'components', 'nursing', 'MedDoubleCheck.tsx');

/** 투약 확인 EP 를 부르는 화면 — 새 화면이 늘면 이 목록도 늘려야 한다(누락 감지) */
const EXPECTED_CALLERS = [
  'app/(main)/inpatient/[admissionId]/nursing/mar/page.tsx',
  'app/(main)/nurse-station/page.tsx',
  'app/(main)/workstation/nursing/page.tsx',
  'app/tablet/nursing/[admissionId]/page.tsx',
].sort();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** `AdministerMedDto` 가 실제로 받는 속성명(= whitelist 통과 키) */
function administerDtoProps(): string[] {
  const src = fs.readFileSync(DTO_FILE, 'utf8');
  const m = /export class AdministerMedDto\s*\{([\s\S]*?)\n\}/.exec(src);
  if (!m) throw new Error('AdministerMedDto 를 찾지 못했다 — DTO 위치가 바뀌었으면 가드를 고쳐야 한다');
  return [...m[1].matchAll(/^\s{2}(\w+)\??\s*:/gm)].map((x) => x[1]);
}

/** 여는 중괄호 위치에서 균형 잡힌 블록 본문을 잘라낸다 */
function balanced(src: string, openBraceIdx: number): string {
  let depth = 1;
  let i = openBraceIdx + 1;
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(openBraceIdx + 1, i - 1);
}

/**
 * 투약 EP 로 실제 전송되는 키 뭉치.
 * ① `.../administer`, { … })` 인라인 리터럴
 * ② 페이로드를 변수로 넘기는 화면(MAR)은 `interface …Payload { … }` 선언을 본다
 *    — 그 인터페이스가 곧 전송 계약이다.
 */
function administerPayloads(src: string): string[] {
  const out: string[] = [];
  const re = /medication-administrations\/\$\{[^}]*\}\/administer`\s*,\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(balanced(src, m.index + m[0].length - 1));

  if (out.length === 0) {
    const i = /interface \w*AdministerPayload\w*\s*\{/.exec(src);
    if (i) out.push(balanced(src, i.index + i[0].length - 1));
  }
  return out;
}

/** 전송 키 이름을 뽑는다 — `key:` / `key?:` / 조건부 스프레드 안의 `{ key: … }` 모두. `id` 는 URL 파라미터라 제외 */
function literalKeys(payload: string): string[] {
  const keys = [...payload.matchAll(/(\w+)\??\s*:/g)].map((x) => x[1]);
  return [...new Set(keys)].filter((k) => k !== 'id');
}

describe('MAR 투약 확인 — FE ↔ AdministerMedDto 기계 대조', () => {
  const dtoProps = administerDtoProps();
  const callers = walk(WEB_SRC)
    .filter((f) => /medication-administrations\/\$\{[^}]*\}\/administer/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(WEB_SRC, f));

  it('이중확인에 필요한 키가 DTO 에 실재한다 (whitelist 가 지우지 못하게)', () => {
    expect(dtoProps).toContain('verifiedBy');
    expect(dtoProps).toContain('doubleCheckBypassReason');
  });

  it('투약 EP 호출 화면 목록이 알려진 4곳과 정확히 일치한다 (새 화면 누락 감지)', () => {
    expect(callers.sort()).toEqual(EXPECTED_CALLERS);
  });

  it.each(EXPECTED_CALLERS)('%s — 보내는 키가 전부 DTO 에 있다', (rel) => {
    const src = fs.readFileSync(path.join(WEB_SRC, rel), 'utf8');
    const payloads = administerPayloads(src);
    expect(payloads.length).toBeGreaterThan(0);
    for (const p of payloads) {
      for (const k of literalKeys(p)) {
        expect(dtoProps, `${rel} 가 보내는 '${k}' 는 DTO 에 없다 — whitelist 가 조용히 지운다`).toContain(k);
      }
    }
  });

  it.each(EXPECTED_CALLERS)('%s — 독립 이중확인 경로가 배선돼 있다 (verifiedBy 미전송 = 전건 우회)', (rel) => {
    const src = fs.readFileSync(path.join(WEB_SRC, rel), 'utf8');
    expect(src, `${rel} 가 doubleCheckPayload 를 쓰지 않는다 — verifiedBy 가 절대 전송되지 않는다`)
      .toMatch(/doubleCheckPayload\s*\(/);
    expect(src, `${rel} 에 2차 확인자 선택 UI(MedDoubleCheckPanel)가 없다`)
      .toMatch(/MedDoubleCheckPanel/);
    expect(src, `${rel} 가 우회 사실을 표시하지 않는다 — 표식이 notes 에만 남아 아무도 못 본다`)
      .toMatch(/DoubleCheckBypassBadge/);
  });

  it('공용 컴포넌트가 만들어내는 payload 키도 DTO 안에 있다', () => {
    const src = fs.readFileSync(DC_COMPONENT, 'utf8');
    const start = src.indexOf('export function doubleCheckPayload');
    expect(start).toBeGreaterThan(-1);
    const bounds = ['\nexport ', '\ninterface ', '\nfunction ']
      .map((t) => src.indexOf(t, start + 1)).filter((i) => i > -1);
    const block = src.slice(start, bounds.length ? Math.min(...bounds) : src.length);
    const keys = [...new Set([...block.matchAll(/(\w+)\??\s*:\s*(?:string|v\.|reason)/g)].map((x) => x[1]))];
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(dtoProps).toContain(k);
  });

  it('용량 자리표시 문자열을 서버로 보내지 않는다 (임상기록 날조)', () => {
    for (const rel of EXPECTED_CALLERS) {
      const src = fs.readFileSync(path.join(WEB_SRC, rel), 'utf8');
      for (const p of administerPayloads(src)) {
        expect(p, `${rel} 가 dose 자리에 자리표시 문자열을 보낸다`).not.toMatch(/dose\s*:\s*[^,]*['"]처방 용량['"]/);
        expect(p, `${rel} 가 route 를 'PO' 로 날조한다`).not.toMatch(/route\s*:\s*[^,]*\?\?\s*['"]PO['"]/);
      }
    }
  });
});
