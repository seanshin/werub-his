import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// 계측 정본은 스캐너 스크립트다 — 세는 규칙을 두 곳에 적으면 갈라진다.
import { scanScreens, stripComments, catalogKeysOf } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 **환자 메시지함**(`/patient-messages` · 2106) 배선 가드 (2026-09-14 · 카탈로그 `patientmessage`).
 *
 * 실측 경위: 환자가 포털·앱에서 담당의에게 보낸 메시지를 **읽는 직원 측 화면이 없었다** — 아무에게도 도달하지 않았다.
 *
 * 못박는 것:
 *   (a) 한글 잔여·식 옆 텍스트·배선 수 — 정확 일치(여유 0)
 *   (b) 화면이 넘기는 한국어 키가 어느 카탈로그엔가 있다(배선 수는 등재를 보증하지 않는다)
 *   (c) 고아 키 0 · (d) 앞 카탈로그와 중복 0 · (e) 세 언어·자리표시자
 *   (f) 🔴 담당 미지정 사실·의사 전용 답변 사실을 화면이 말한다 — 지우면 "배정됐다/누구나 답한다"로 읽힌다
 *   (g) 🔴 진입점 — 사이드바 항목이 API 열람 역할 정본(shared CHART_CLINICAL_ROLES)을 쓰고 화면번호가 고정돼 있다
 */

const ROOT = resolve(__dirname, '../../../..');
const APP = join(ROOT, 'apps/web/src/app');
const MSG = join(ROOT, 'packages/shared/src/i18n/messages');
const read = (p: string) => readFileSync(p, 'utf-8');
const HAN = /[가-힣]/;

const PAGE = '(main)/patient-messages/page.tsx';
const BASELINE = { ko: 0, koExpr: 0, t: 20 };

function registeredOrder(): string[] {
  const reg = read(join(MSG, 'registry.ts'));
  const files = [...reg.matchAll(/from '\.\/([a-z0-9_-]+)'/gi)].map((m) => `${m[1]}.ts`);
  return [...new Set(['common.ts', ...files])];
}
const keysOf = (file: string) => catalogKeysOf(read(join(MSG, file))) as Set<string>;
const ORDER = registeredOrder();
const AT = ORDER.indexOf('patientmessage.ts');
const MINE = keysOf('patientmessage.ts');
const BEFORE = new Set<string>();
for (const f of ORDER.slice(0, AT)) for (const k of keysOf(f)) BEFORE.add(k);
const ALL_KEYS = new Set<string>();
for (const f of ORDER) for (const k of keysOf(f)) ALL_KEYS.add(k);

function literals(expr: string): string[] {
  return [...expr.matchAll(/'((?:\\.|[^'\\\n])*)'/g)].map((m) => m[1].replace(/\\'/g, "'"));
}
function usedKeys(): Set<string> {
  const src = stripComments(read(join(APP, PAGE)));
  const out = new Set<string>();
  for (const m of src.matchAll(/<Tf?\s+k="((?:\\.|[^"\\])+)"/g)) out.add(m[1]);
  for (const m of src.matchAll(/<Tf?\s+k=\{([^{}]*)\}/g)) for (const l of literals(m[1])) out.add(l);
  for (const m of src.matchAll(/\btAttr\(\s*'((?:\\.|[^'\\])*)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/\btitle="([^"]*)"/g)) out.add(m[1]);
  return new Set([...out].filter((k) => HAN.test(k)));
}
const USED = usedKeys();

function rowsOf(): Array<{ key: string; v: string[] }> {
  const src = read(join(MSG, 'patientmessage.ts'));
  const body = src.slice(src.indexOf('const TRANSLATIONS'), src.indexOf('const en: Record'));
  const out: Array<{ key: string; v: string[] }> = [];
  for (const m of body.matchAll(/^ {2}'((?:\\.|[^'\\])+)':\s*\[([\s\S]*?)\],$/gm)) {
    const vals = [...m[2].matchAll(/'((?:\\.|[^'\\])*)'/g)].map((x) => x[1].replace(/\\'/g, "'"));
    out.push({ key: m[1].replace(/\\'/g, "'"), v: vals });
  }
  return out;
}

describe('🔴 환자 메시지함 i18n 배선 (patientmessage)', () => {
  it('대조군 — 스캐너·파서·추출기가 실제로 대상을 읽는다', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string }>;
    expect(rows.find((r) => r.file === PAGE), '스캔 대상에 없다').toBeTruthy();
    expect(AT, 'registry 에서 patientmessage 를 찾지 못했다').toBeGreaterThan(0);
    expect(MINE.size).toBeGreaterThan(15);
    expect(USED.has('답변 보내기')).toBe(true); // <T k>
    expect(USED.has('답변 저장에 실패했습니다.')).toBe(true); // tAttr
    expect(USED.has('받은 환자 메시지가 없습니다.')).toBe(true); // EmptyState title
    expect(USED.has('안 읽음 {건수}')).toBe(true); // <Tf>
  });

  it('(a) 한글 잔여·식 옆 텍스트·배선 수가 기준선과 정확히 일치한다', () => {
    const rows = scanScreens(APP, APP) as Array<{ file: string; ko: number; koExpr: number; t: number }>;
    const r = rows.find((x) => x.file === PAGE)!;
    expect({ ko: r.ko, koExpr: r.koExpr, t: r.t }).toEqual(BASELINE);
  });

  it('(b) 화면이 넘기는 한국어 키가 카탈로그에 있다', () => {
    const missing = [...USED].filter((k) => !ALL_KEYS.has(k));
    expect(missing, `미등록 키(원문+EN× 로 나간다):\n${missing.join('\n')}`).toEqual([]);
  });

  it('(c) 고아 키 0 · (d) 앞 카탈로그와 중복 0', () => {
    expect([...MINE].filter((k) => !USED.has(k))).toEqual([]);
    expect([...MINE].filter((k) => BEFORE.has(k))).toEqual([]);
  });

  it('(e) 세 언어 · 빈 값 0 · 자리표시자 일치', () => {
    const rows = rowsOf();
    expect(rows.length).toBe(MINE.size);
    const bad: string[] = [];
    for (const { key, v } of rows) {
      if (v.length !== 3 || v.some((x) => !x.trim())) { bad.push(`${key}: 언어·빈 값`); continue; }
      const want = [...key.matchAll(/\{([^{}\s]+)\}/g)].map((m) => m[1]).sort().join(',');
      for (const x of v) {
        const got = [...x.matchAll(/\{([^{}\s]+)\}/g)].map((m) => m[1]).sort().join(',');
        if (got !== want) bad.push(`${key}: 자리표시자 ${got} ≠ ${want}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('(f) 🔴 담당 미지정·의사 전용 답변·옵트인 사실을 화면이 말한다', () => {
    const src = stripComments(read(join(APP, PAGE)));
    expect(src).toContain('담당 미지정 — 누가 받는지 정해지지 않았습니다');
    expect(src).toContain('답변은 의사만 할 수 있습니다');
    // 🔴 옵트인 초기값은 "미선택" — 쓰기 폼이 알림을 켠 채로 시작하지 않는다
    expect(src).toMatch(/useState\(false\);\s*\n\s*\n?\s*const inboxQ/);
    // 조회 실패를 빈 목록으로 그리지 않는다
    expect(src).toContain('inboxQ.isError');
    expect(src).toContain('threadQ.isError');
  });

  it('(g) 🔴 진입점 — 사이드바가 API 열람 역할 정본을 쓰고 화면번호 2106 이 고정돼 있다', () => {
    const sidebar = read(join(ROOT, 'apps/web/src/components/layout/Sidebar.tsx'));
    expect(sidebar).toMatch(/href: '\/patient-messages'[^}]*roles: \[\.\.\.CHART_CLINICAL_ROLES\]/);
    expect(read(join(ROOT, 'apps/web/src/components/layout/screen-codes.frozen.ts'))).toContain("'/patient-messages': '2106'");
    expect(read(join(ROOT, 'apps/api/src/modules/patient-message/patient-message.policy.ts'))).toContain('PATIENT_MESSAGE_READ_ROLES = CHART_CLINICAL_ROLES');
  });
});
