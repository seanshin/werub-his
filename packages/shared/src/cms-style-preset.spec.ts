/**
 * 🔴 CMS 표현 정본 ↔ 홈페이지 사본 드리프트 가드.
 *
 * `apps/homepage` 는 격리 빌드(자체 `npm install`)라 `@hospital-run/shared` 를 참조할 수 없다.
 * 그래서 `cms-style-preset.ts` 를 사본으로 둔다 — **사본은 갈라진다**(이 저장소에서 반복해서 나온 유형).
 * 이 가드는 두 파일의 본문이 한 글자라도 다르면 실패한다.
 *
 * 재주입: 사본에서 프리셋 하나의 hex 를 바꾸면 이 테스트가 실패한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

import { CMS_STYLE_PRESETS, cmsResolveStyle, cmsIsLight, cmsShade } from './cms-style-preset';

const CANON = join(__dirname, 'cms-style-preset.ts');
const COPY = join(__dirname, '../../../apps/homepage/src/lib/cms-style-preset.ts');

/** 사본 머리말(대조 안내 주석)만 걷어낸다 — 본문은 한 글자도 달라선 안 된다. */
const stripCopyHeader = (s: string) => s.replace(/^\/\* eslint-disable \*\/\n(?:\/\/.*\n)+/, '');

describe('CMS 표현 정본 ↔ apps/homepage 사본', () => {
  it('사본이 존재한다', () => {
    expect(existsSync(COPY), `사본이 없다: ${COPY}`).toBe(true);
  });

  it('🔴 사본이 정본과 한 글자도 다르지 않다', () => {
    const canon = readFileSync(CANON, 'utf8');
    const copy = stripCopyHeader(readFileSync(COPY, 'utf8'));
    expect(copy, '홈페이지 사본이 shared 정본과 갈라졌다 — `npm run sync:cms-style` 로 다시 복사하라').toBe(canon);
  });
});

describe('표현 해석 — 단색 사각형으로 그리지 않는다', () => {
  it('프리셋을 고르면 그 프리셋의 그라디언트가 나온다', () => {
    const p = CMS_STYLE_PRESETS[1];
    const r = cmsResolveStyle({ stylePreset: p.key });
    expect(r.source).toBe('PRESET');
    expect(r.gradient).toBe(p.gradient);
    expect(r.text).toBe(p.text);
  });

  it('🔴 직접 지정 hex 하나만 있어도 그라디언트를 만들어 준다(단색 아님)', () => {
    const r = cmsResolveStyle({ bgColor: '#1e40af' });
    expect(r.source).toBe('CUSTOM');
    expect(r.bg).toBe('#1e40af');
    expect(r.gradient).toMatch(/^linear-gradient\(135deg, #[0-9a-f]{6} 0%, #1e40af 55%, #[0-9a-f]{6} 100%\)$/);
  });

  it('밝은 배경엔 어두운 글자를 준다 — 흰 글자로 안 읽히게 두지 않는다', () => {
    expect(cmsIsLight('#eef4fb')).toBe(true);
    expect(cmsResolveStyle({ bgColor: '#eef4fb' }).text).toBe('#111827');
    expect(cmsIsLight('#0f2a4a')).toBe(false);
    expect(cmsResolveStyle({ bgColor: '#0f2a4a' }).text).toBe('#ffffff');
  });

  it('아무것도 지정 안 하면 기본 프리셋 — 비어 있다고 흰 화면을 내지 않는다', () => {
    const r = cmsResolveStyle({});
    expect(r.source).toBe('DEFAULT');
    expect(r.gradient).toBe(CMS_STYLE_PRESETS[0].gradient);
  });

  it('잘못된 hex 는 무시하고 기본으로 — 깨진 CSS 를 내보내지 않는다', () => {
    expect(cmsResolveStyle({ bgColor: 'red; background:url(x)' }).source).toBe('DEFAULT');
    expect(cmsResolveStyle({ bgColor: '#12' }).source).toBe('DEFAULT');
  });

  it('모든 프리셋은 배경과 글자의 명암이 갈린다 — 목록에 있다는 것은 읽힌다는 약속이다', () => {
    for (const p of CMS_STYLE_PRESETS) {
      expect(cmsIsLight(p.bg), `${p.key}: 배경/글자 대비`).not.toBe(cmsIsLight(p.text));
      expect(cmsIsLight(p.accent), `${p.key}: 버튼 배경/글자 대비`).not.toBe(cmsIsLight(p.accentText));
    }
  });

  it('shade 는 범위를 벗어나지 않는다', () => {
    expect(cmsShade('#000000', 1)).toBe('#ffffff');
    expect(cmsShade('#ffffff', -1)).toBe('#000000');
  });
});
