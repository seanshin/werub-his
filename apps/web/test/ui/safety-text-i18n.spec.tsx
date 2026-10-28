import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { stripComments } from '../../../../scripts/i18n-unwired-scan.mjs';
import { tOf } from '@hospital-run/shared';

/**
 * 🔴 **안전·정직성 문구는 로케일을 타야 한다**(정본 `ui-locale-i18n.plan.md` §12-A).
 *
 * 이 자리들은 카탈로그를 채워도 소용이 없던 곳이다 — 문구가 `<T>`/`tAttr` 를 **지나지 않아서**
 * 스캐너에도 안 잡혔다. 화면 언어를 English 로 둬도 한국어로 나갔고, 그 문구가 말하는 사실
 * (AI 출처 3상태 · 고위험 판정 · 서명 차단 사유 · 임상 판정문)이 영어권 사용자에게 전달되지 않았다.
 *
 * 🔴 여기서 지키는 것은 "번역이 예쁜가"가 아니라 **그 사실이 전달되는가**다.
 *    되돌아가면(생문자열·템플릿 조립) 이 가드가 실패한다.
 */
const SRC = path.join(__dirname, '..', '..', 'src');
const read = (p: string) => stripComments(fs.readFileSync(path.join(SRC, p), 'utf8')) as string;

describe('🔴 안전·정직성 문구 — 로케일을 탄다', () => {
  it('대조군 — 파일을 실제로 읽었다(0 이면 이 가드는 아무것도 보증하지 않는다)', () => {
    expect(read('components/ai/AiSuggestionPanel.tsx').length).toBeGreaterThan(500);
    expect(read('components/specialty/ScoreCalculator.tsx').length).toBeGreaterThan(2000);
  });

  it('① AI 출처 3상태 문구가 보간으로 배선돼 있다 — 생 JSX 텍스트로 되돌아가지 않는다', () => {
    const s = read('components/ai/AiSuggestionPanel.tsx');
    for (const k of [
      '{출처} 호출 실패: {사유}',
      '{출처}를 호출하지 않았습니다 — 원자료가 생기면 다시 산출됩니다.',
      '{출처} 미응답 · 규칙 대체',
      '규칙 기반 대체 결과입니다({출처} 소견 아님) — 최종 판단은 의료진이 합니다.',
    ]) {
      expect(s, `3상태 문구가 배선에서 빠졌다: ${k}`).toContain(k);
      expect(tOf(k, 'en').missing, `카탈로그에 없다: ${k}`).toBe(false);
    }
    // 옛 형태(생 텍스트 + AI_ORIGIN_TEXT 조립)가 돌아오지 않았는지
    expect(s, '3상태 문구가 다시 생 JSX 텍스트로 조립되고 있다').not.toMatch(/\{AI_ORIGIN_TEXT\}\s*(호출 실패|미응답)/);
  });

  it('② 고위험 배지의 **모든** 값이 등재돼 있다 — 동적 키는 하나만 빠져도 그 상태에서 한국어가 남는다', () => {
    const s = read('components/voice-emr/VoiceConfirmCard.tsx');
    expect(s, '배지가 동적 키를 넘기지 않는다 — 이 검사의 전제가 깨졌다').toContain('<T k={badge.text}');
    for (const k of ['⚠ 고위험', '고위험 여부 미확인']) {
      expect(s, `배지 값이 소스에서 사라졌다: ${k}`).toContain(k);
      expect(tOf(k, 'en').missing, `안전 배지 값이 카탈로그에 없다: ${k}`).toBe(false);
    }
  });

  it('③ 서명 차단 사유·킬스위치가 로케일을 탄다', () => {
    const s = read('components/voice-emr/ConversationStreamPanel.tsx');
    expect(s, '서명 차단 사유가 다시 한국어로 조립되고 있다').toContain('대화 전사 누락 {초}초');
    expect(s, '차단 사유가 tfAttr 를 지나지 않는다').toMatch(/tfAttr\(\s*'대화 전사 누락/);
    expect(s, '킬스위치 배너가 tAttr 를 지나지 않는다').toMatch(/tAttr\(\s*'대화 기록이 관리자 설정으로 중단/);
  });

  it('④ 임상 판정문이 템플릿 조립으로 되돌아가지 않는다(점수가 문장 가운데 든 자리)', () => {
    const s = read('components/specialty/ScoreCalculator.tsx');
    // 24건 전부 tfAttr 경유 — 하나라도 백틱 조립이면 그 판정문만 한국어로 남는다
    expect(s, '판정문을 다시 템플릿 리터럴로 조립하고 있다').not.toMatch(/interpretation\s*=\s*`/);
    expect(s, '판정문에 생 한국어 문자열이 남았다').not.toMatch(/interpretation\s*=\s*'[^']*[가-힣]/);
    const n = (s.match(/interpretation = tfAttr\(/g) ?? []).length;
    expect(n, `판정문 배선이 24건이 아니다: ${n}`).toBe(24);
  });

  it('⑤ 임상 판정문 키가 전부 카탈로그에 있다(EN× 거짓 티가 뜨지 않는다)', () => {
    const s = read('components/specialty/ScoreCalculator.tsx');
    const keys = [...s.matchAll(/interpretation = tfAttr\('((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
    expect(keys.length).toBe(24);
    const missing = keys.filter((k) => tOf(k, 'en').missing);
    expect(missing, `카탈로그에 없는 판정문:\n  ${missing.join('\n  ')}`).toEqual([]);
  });
});
