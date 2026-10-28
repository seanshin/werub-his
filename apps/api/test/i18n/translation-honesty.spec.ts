import { describe, it, expect, vi } from 'vitest';
import { TranslationService, engineSupportsLanguage } from '../../src/modules/i18n/translation.service';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 번역 정직성 (2026-08-28 · 발굴 모드).
 *
 * 🔴 이 축의 위험은 **원문이 번역문 행세를 하는 것**이다. 원문이 돌아오는 이유가 넷인데
 *    종전에는 셋을 한 줄로 묶어 `{cached: true}` 로 답했다 — 엔진이 모르는 언어에도
 *    "캐시에서 번역됨"이라 말하며 한국어를 돌려줬고, 소비처는 그것을 번역문으로 저장했다.
 */
function makeSvc(opts: { cacheHit?: { translated: string } | null } = {}) {
  const prisma = {
    translation: {
      findUnique: vi.fn(async () => opts.cacheHit ?? null),
      create: vi.fn(async () => ({})),
    },
    systemConfig: { findMany: vi.fn(async () => []) },
  };
  const config = { get: vi.fn(() => '') };
  return new TranslationService(prisma as never, config as never);
}

describe('🔴 원문이 돌아온 이유를 구분한다 — 넷은 다른 사실이다', () => {
  it('빈 문자열은 폴백이 아니다(번역할 것이 없다)', async () => {
    const r = await makeSvc().translate('   ', 'en', 'ko');
    expect(r.reason).toBe('EMPTY');
    expect(r.fallback).toBeFalsy();
  });

  it('같은 언어는 폴백이 아니다', async () => {
    const r = await makeSvc().translate('안녕', 'ko', 'ko');
    expect(r.reason).toBe('SAME_LANG');
    expect(r.fallback).toBeFalsy();
  });

  it('🔴 엔진이 모르는 언어는 **폴백이다** — "캐시에서 번역됨"이라 말하지 않는다', async () => {
    // th·kk 는 언어 마스터(patient.supportedLanguages)에는 있고 엔진에는 없다
    for (const lang of ['th', 'kk']) {
      const r = await makeSvc().translate('수술 동의서', lang, 'ko');
      expect(r.fallback, `${lang} 는 번역되지 않는다`).toBe(true);
      expect(r.reason).toBe('UNSUPPORTED_LANG');
      expect(r.cached, '캐시에서 온 것이 아니다').toBe(false);
      expect(r.translated, '원문이 그대로 돌아온다').toBe('수술 동의서');
    }
  });

  it('엔진이 아는 언어는 미지원으로 분류되지 않는다(대조군)', () => {
    for (const lang of ['en', 'zh', 'ja', 'ru', 'vi', 'mn', 'ar']) {
      expect(engineSupportsLanguage(lang), lang).toBe(true);
    }
    expect(engineSupportsLanguage('th')).toBe(false);
  });

  it('🔴 엔진 호출이 실패하면 폴백이다 — 원문을 주면서 "번역됨"이라 하지 않는다', async () => {
    const svc = makeSvc({ cacheHit: null });
    // 🔴 목이 엔진에 닿지 않으면 이 분기를 **한 번도 안 지난다**(재주입이 이 구멍을 찾았다)
    const spy = vi.spyOn(svc as unknown as { callOllama: () => Promise<string> }, 'callOllama')
      .mockRejectedValue(new Error('engine down'));
    const r = await svc.translate('수술 동의서', 'en', 'ko');
    expect(spy, '엔진 경로를 실제로 지났다').toHaveBeenCalledOnce();
    expect(r.fallback).toBe(true);
    expect(r.reason).toBe('ENGINE_FAILED');
    expect(r.cached).toBe(false);
    expect(r.translated, '원문이 돌아온다').toBe('수술 동의서');
  });

  it('엔진이 성공하면 폴백이 아니다(대조군 — 성공을 실패로 말하지 않는다)', async () => {
    const svc = makeSvc({ cacheHit: null });
    vi.spyOn(svc as unknown as { callOllama: () => Promise<string> }, 'callOllama')
      .mockResolvedValue('Surgical Consent Form');
    const r = await svc.translate('수술 동의서', 'en', 'ko');
    expect(r.translated).toBe('Surgical Consent Form');
    expect(r.fallback).toBeFalsy();
    expect(r.reason).toBeUndefined();
  });

  it('캐시 적중은 폴백이 아니다(대조군 — 성공을 실패로 말하지 않는다)', async () => {
    const r = await makeSvc({ cacheHit: { translated: 'Surgical Consent' } }).translate('수술 동의서', 'en', 'ko');
    expect(r.translated).toBe('Surgical Consent');
    expect(r.fallback).toBeFalsy();
    expect(r.cached).toBe(true);
  });
});

describe('🔴 번역 안 된 것을 번역됐다고 기록하지 않는다 — 소스 규약', () => {
  const CONSULT = readFileSync(
    join(process.cwd(), 'src/modules/consult/consult.service.ts'), 'utf-8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('🔴 직원 답변이 폴백이면 `lang` 은 원문 언어다 — 종전엔 `lang: locale` 로 박았다', () => {
    expect(CONSULT).toMatch(/const lang = tr && !tr\.fallback \? locale : 'ko';/);
    // 재발 방지: 번역 결과를 보지 않고 locale 을 그대로 적는 코드가 없어야 한다
    expect(CONSULT).not.toMatch(/contentKo: text, lang: locale/);
  });

  it('🔴 AI 답변도 같다', () => {
    expect(CONSULT).toMatch(/if \(!r\.fallback\) replyLang = locale;/);
    expect(CONSULT).not.toMatch(/contentKo: replyKo, lang: locale/);
  });
});

describe('🔴 번역하지 않으면서 번역 응답 모양을 반환하지 않는다', () => {
  const RAW = readFileSync(join(process.cwd(), 'src/modules/consent/consent.service.ts'), 'utf-8');
  // 🔴 **주석을 벗기고 본다.** 벗기지 않으면 "가짜였다"고 설명한 내 주석이 검사에 걸려
  //    가드가 **다른 이유로 실패**한다(v4.11.0 에서 같은 함정을 9건 겪었다).
  const CONSENT = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('가짜 번역기가 되살아나지 않는다 — 원문 앞에 언어 라벨만 붙이던 코드', () => {
    expect(CONSENT).not.toMatch(/translatedTitle/);
    expect(CONSENT).not.toMatch(/getTranslatedLabel|getTranslatedTitle/);
    expect(CONSENT).not.toMatch(/translatedAt/);
  });

  it('미구현임을 명시한다(조용히 사라지지 않는다)', () => {
    expect(CONSENT).toMatch(/CONSENT_TRANSLATE_NOT_IMPLEMENTED/);
    expect(CONSENT).toMatch(/NotImplementedException/);
  });
});

describe('🔴 읽는 코드가 없는 설정은 화면이 그 사실을 말한다', () => {
  const PAGE = readFileSync(
    join(process.cwd(), '../web/src/app/(main)/admin/ai-settings/page.tsx'), 'utf-8',
  );
  const NOTE = PAGE.slice(PAGE.indexOf('const UNWIRED_CONFIG_NOTE'), PAGE.indexOf('const GATE_ENUM_OPTIONS'));

  it('emr.locale 은 폐기됐다 — 미배선 고지에도, 정본(DEFAULTS)에도 되살아나지 않는다(ui-locale P0)', () => {
    // 2026-09-06: 소비처 0 이던 키를 제거 — 정본은 hospital.defaultUiLocale + UserUiPreference.uiLocale
    expect(NOTE).not.toMatch(/'emr\.locale'/);
    const DEFAULTS_SRC = readFileSync(join(process.cwd(), 'src/modules/config/config-runtime.service.ts'), 'utf8');
    expect(DEFAULTS_SRC).not.toMatch(/'emr\.locale':\s*\{/);
    expect(DEFAULTS_SRC).toMatch(/'hospital\.defaultUiLocale':\s*\{/);
  });

  it('미배선 표시가 실제로 렌더된다(등재만 하고 안 그리면 소용없다)', () => {
    expect(PAGE).toMatch(/UNWIRED_CONFIG_NOTE\[config\.key\] &&/);
  });
});
