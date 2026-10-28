/**
 * 🔴 CMS 필드 정본 ↔ 공개 홈페이지 렌더 코드 드리프트 가드.
 *
 * 정본(`CMS_CATEGORIES`)이 "공개 화면이 무엇을 읽는가"를 적는데, 그 정본이 렌더 코드와 갈라지면
 * 편집자는 **필요 없는 값을 채우고 필요한 값을 비운 채** 저장하게 된다.
 * 그래서 `apps/homepage` 소스를 실제로 읽어 대조한다.
 *
 * 재주입: 정본에서 `departmentName` 을 지우면 "렌더가 읽는데 정본에 없다"로 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { CMS_CATEGORIES, cmsCategoryDef, cmsDisplayGaps, cmsUnknownKeys, cmsValueIsEmpty } from './cms-field-schema';

const HP = join(__dirname, '../../../apps/homepage/src/app');

/** 실측으로 확인한 "그 파일이 그 카테고리를 그린다" 대응(2026-08-21). */
const RENDER_FILES: { category: string; file: string }[] = [
  { category: 'DEPARTMENT', file: 'care/departments/[slug]/page.tsx' },
  { category: 'CENTER', file: 'care/centers/page.tsx' },
  { category: 'NEWS', file: 'news/page.tsx' },
  { category: 'RECRUIT', file: 'news/recruit/page.tsx' },
  { category: 'HEALTH_INFO', file: 'health-info/page.tsx' },
  { category: 'CSR', file: 'about/csr/page.tsx' },
  { category: 'GALLERY', file: 'about/gallery/page.tsx' },
];

/** 렌더 코드가 읽는 metadata 키 추출(선언형 인터페이스 + 접근 표현 둘 다). */
function metadataKeysIn(src: string): Set<string> {
  const keys = new Set<string>();
  for (const m of src.matchAll(/met(?:a|adata)\s*(?:as\s+[^)]*\))?\??\.([a-zA-Z_]\w*)/g)) keys.add(m[1]);
  for (const m of src.matchAll(/met(?:a|adata)\??\[['"](\w+)['"]\]/g)) keys.add(m[1]);
  // 🔴 선언형 `metadata?: { … }` — **중괄호 깊이를 세서 최상위 키만** 집는다.
  //    종전 `\{([^}]*)\}` 는 중첩 객체(`images?: { url; caption; order }[]`)의 안쪽 키까지 집어
  //    "렌더가 url·caption·order 를 읽는다"는 거짓 결론을 냈다(내 스캐너가 먼저 거짓말한다).
  for (const m of src.matchAll(/metadata\??:\s*\{/g)) {
    let depth = 0, i = m.index! + m[0].length - 1, body = '';
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '{') { depth++; if (depth === 1) continue; }
      else if (ch === '}') { depth--; if (depth === 0) break; }
      if (depth >= 1) body += depth === 1 ? ch : ' '; // 중첩 안쪽은 공백으로 지운다
    }
    for (const k of body.matchAll(/(?:^|[;,{])\s*(\w+)\??\s*:/g)) keys.add(k[1]);
  }
  return keys;
}

describe('CMS 필드 정본 ↔ 공개 화면 렌더', () => {
  for (const { category, file } of RENDER_FILES) {
    it(`${category} — 렌더가 읽는 키가 모두 정본에 있다 (${file})`, () => {
      const path = join(HP, file);
      expect(existsSync(path), `렌더 파일이 없다: ${file} — 정본의 publicPaths 가 낡았을 수 있다`).toBe(true);
      const def = cmsCategoryDef(category)!;
      const declared = new Set(def.fields.map((f) => f.key));
      const missing = [...metadataKeysIn(readFileSync(path, 'utf8'))].filter((k) => !declared.has(k));
      expect(missing, `공개 화면이 읽는데 정본에 없는 키: ${missing.join(', ')}`).toEqual([]);
    });
  }

  it('모든 카테고리 정의가 최소 계약을 지킨다', () => {
    for (const c of CMS_CATEGORIES) {
      expect(c.category, '카테고리 키').toMatch(/^[A-Z_]+$/);
      expect(c.label.length, `${c.category}: 라벨`).toBeGreaterThan(0);
      // 대표 이미지가 필수인 카테고리는 **없을 때 무엇이 되는지**를 반드시 말한다
      if (c.imageRole === 'REQUIRED') {
        expect(c.imageFallbackNote, `${c.category}: 이미지 필수인데 폴백 설명이 없다`).toBeTruthy();
      }
      for (const f of c.fields) {
        expect(f.usedFor.length, `${c.category}.${f.key}: usedFor 가 비었다 — 편집자가 읽을 문장이 없다`).toBeGreaterThan(5);
        if (f.type === 'select') {
          expect(f.options?.length, `${c.category}.${f.key}: select 인데 옵션이 없다`).toBeGreaterThan(0);
        }
      }
      // 키 중복 금지
      const keys = c.fields.map((f) => f.key);
      expect(new Set(keys).size, `${c.category}: 중복 키`).toBe(keys.length);
    }
  });

  it('전용 편집 화면 경로는 admin 경로 형식이다', () => {
    for (const c of CMS_CATEGORIES) {
      if (c.adminHref) expect(c.adminHref, c.category).toMatch(/^\/admin\//);
    }
  });
});

describe('미충족 판정 — 없는 것을 없다고 말한다', () => {
  it('🔴 BANNER: 이미지·링크가 비면 그 사실을 낸다(운영 실측 3건이 그 상태였다)', () => {
    const gaps = cmsDisplayGaps('BANNER', { metadata: { subType: 'HERO' }, imageUrl: '' });
    const keys = gaps.map((g) => g.key);
    expect(keys).toContain('imageUrl');
    expect(keys).toContain('linkUrl');
    expect(keys).toContain('linkText');
    expect(gaps.find((g) => g.key === 'imageUrl')?.usedFor).toContain('배경색');
  });

  it('다 채우면 아무것도 말하지 않는다 — 거짓 경보를 만들지 않는다', () => {
    const gaps = cmsDisplayGaps('BANNER', {
      metadata: { subType: 'HERO', linkUrl: '/checkup', linkText: '검진 예약' },
      imageUrl: '/media/hero.png',
    });
    expect(gaps).toEqual([]);
  });

  it('빈 문자열·빈 배열은 "비어 있음"이고, 0 과 false 는 값이다', () => {
    expect(cmsValueIsEmpty('')).toBe(true);
    expect(cmsValueIsEmpty('  ')).toBe(true);
    expect(cmsValueIsEmpty([])).toBe(true);
    expect(cmsValueIsEmpty({})).toBe(true);
    expect(cmsValueIsEmpty(0)).toBe(false);
    expect(cmsValueIsEmpty(false)).toBe(false);
  });

  it('정본에 없는 카테고리는 조용히 통과시키지 않고 빈 목록을 낸다(판정 불가)', () => {
    expect(cmsDisplayGaps('NOT_A_CATEGORY', { metadata: {}, imageUrl: '' })).toEqual([]);
    expect(cmsCategoryDef('NOT_A_CATEGORY')).toBeUndefined();
  });

  it('🔴 정본에 없는 키는 "미지"로 보고되고 편집기가 보존한다 — 조용히 지우지 않는다', () => {
    const unknown = cmsUnknownKeys('NEWS', { subType: 'NOTICE', legacyField: 'x', anotherOld: 1 });
    expect(unknown.sort()).toEqual(['anotherOld', 'legacyField']);
  });
});
