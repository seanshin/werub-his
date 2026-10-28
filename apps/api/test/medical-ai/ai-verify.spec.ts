/**
 * 🔴 AI 스킬 검증층 — 기획서 chart-ai-assistant-agent §4.4. 실측 결함 3건을 재주입하면 잡혀야 한다:
 *   ① 검사해석 방향 반전(K 5.9 H → "저하") ② 영어 SOAP + "ACS 아스피린 회피" ③ 여성에 "전립선".
 */
import { describe, it, expect } from 'vitest';
import { checkForbiddenAdvice, checkKorean, checkLabDirection, checkMentionsOnlyProvidedTests, checkNoMixedScript, checkNonEmpty, checkSexAgeAppropriate, failedSkill, finalizeSkill, koreanRatio } from '../../src/modules/medical-ai/ai-verify';

describe('규칙 — 한국어', () => {
  it('영어 문장은 떨어지고 한국어(약어 섞임)는 통과한다', () => {
    expect(checkKorean('Acute Coronary Syndrome with possible pulmonary edema. Administer nitroglycerin.').ok).toBe(false);
    expect(checkKorean('급성 관상동맥증후군 의심 — ECG 즉시, troponin 확인, SpO2 94% 산소 2-4L').ok).toBe(true);
    expect(koreanRatio('120/80 · 36.5')).toBe(1); // 글자 없음 = 위반 아님
  });
});

describe('규칙 — 검사 flag ↔ 해석 방향', () => {
  const inputs = [{ testName: 'K', value: '5.9', flag: 'H' as const }, { testName: 'Hb', value: '9.8', flag: 'L' as const }];
  it('🔴 H 인데 "저하"만 말하면 반전', () => {
    const r = checkLabDirection(inputs, [{ test: 'K', interpretation: 'K 수치는 저하됨' }]);
    expect(r.ok).toBe(false); expect(r.detail).toContain('K:H→저하');
  });
  it('L 인데 "상승"만 말하면 반전 · 방향이 맞으면 통과 · 둘 다 언급은 통과(보수)', () => {
    expect(checkLabDirection(inputs, [{ test: 'Hb', interpretation: '헤모글로빈 상승' }]).ok).toBe(false);
    expect(checkLabDirection(inputs, [{ test: 'K', interpretation: '고칼륨혈증 — 상승' }, { test: 'Hb', interpretation: '빈혈 의심(감소)' }]).ok).toBe(true);
    expect(checkLabDirection(inputs, [{ test: 'K', interpretation: '상승 상태 — 저하 시 재평가' }]).ok).toBe(true);
  });
  it('입력에 없는 검사 언급은 떨어진다(실측: 보내지 않은 WBC)', () => {
    const r = checkMentionsOnlyProvidedTests(inputs, [{ test: 'WBC', interpretation: '정상' }, { test: 'K', interpretation: '상승' }]);
    expect(r.ok).toBe(false); expect(r.detail).toBe('WBC');
  });
});

describe('규칙 — 성별/연령 · 금칙 조언', () => {
  it('여성에 전립선 · 남성에 자궁 · 성인에 신생아 황달', () => {
    expect(checkSexAgeAppropriate('전립선 질환 등 내분비계 질환 의심', 'FEMALE', 51).ok).toBe(false);
    expect(checkSexAgeAppropriate('자궁근종 의심', 'MALE', 40).ok).toBe(false);
    expect(checkSexAgeAppropriate('신생아 황달', 'MALE', 40).ok).toBe(false);
    expect(checkSexAgeAppropriate('전립선 비대', 'MALE', 70).ok).toBe(true);
    expect(checkSexAgeAppropriate('빈혈 의심', 'FEMALE', 51).ok).toBe(true); // 사전에 없으면 통과(거짓 경보 금지)
  });
  it('🔴 "ACS 에서 아스피린 회피" 는 금칙', () => {
    expect(checkForbiddenAdvice('Consider NSAIDs for pain management, avoiding aspirin due to potential bleeding risk in ACS patients.').ok).toBe(false);
    expect(checkForbiddenAdvice('급성 관상동맥증후군 — 아스피린 300mg 저작 투여').ok).toBe(true);
  });
});

describe('봉투 — finalizeSkill / failedSkill', () => {
  const t0 = Date.now() - 50;
  it('전부 통과 → AI · 하나라도 실패 → FALLBACK + VERIFY_REJECTED:<첫 실패>', () => {
    const ok = finalizeSkill({ a: 1 }, t0, [checkNonEmpty('x', [1])]);
    expect(ok.source).toBe('AI'); expect(ok.latencyMs).toBeGreaterThanOrEqual(50); expect(ok.verify.failed).toEqual([]);
    const bad = finalizeSkill({ a: 1 }, t0, [checkNonEmpty('x', []), checkKorean('english only text here')]);
    expect(bad.source).toBe('FALLBACK'); expect(bad.reason).toBe('VERIFY_REJECTED:KOREAN'); expect(bad.verify.failed.length).toBe(2);
    // 비어 있기만 하면 검증 실패가 아니라 EMPTY_RESULT(계측 분모가 갈린다)
    expect(finalizeSkill({ a: 1 }, t0, [checkNonEmpty('x', [])]).reason).toBe('EMPTY_RESULT');
    expect((bad as { a: number }).a).toBe(1); // 본문은 지우지 않는다
  });
  it('sourceOverride 는 검증 결과보다 우선(규칙 기반 폴백은 통과해도 AI 가 아니다)', () => {
    const r = finalizeSkill({ items: [1] }, t0, [checkNonEmpty('items', [1])], { sourceOverride: { source: 'FALLBACK', reason: 'UPSTREAM_FALLBACK' } });
    expect(r.source).toBe('FALLBACK'); expect(r.reason).toBe('UPSTREAM_FALLBACK');
    expect(failedSkill({}, t0, 'TIMEOUT').reason).toBe('TIMEOUT');
  });
});

import { extractJsonObject } from '../../src/modules/medical-ai/ai-verify';
describe('extractJsonObject — LLM 답변의 첫 균형 JSON 객체(운영 재실측: 탐욕 정규식이 뒤 설명·펜스에 걸려 파싱 실패)', () => {
  it('코드펜스·후행 설명·문자열 안 중괄호·후행 콤마를 견딘다', () => {
    expect(extractJsonObject('```json\n{"a":1,"b":{"c":"x } y"}}\n```\n참고: 위 결과는 …')).toEqual({ a: 1, b: { c: 'x } y' } });
    expect(extractJsonObject('설명 먼저. {"differentials":[{"name":"협심증",}],}  {"other":1}')).toEqual({ differentials: [{ name: '협심증' }] });
    expect(extractJsonObject('JSON 없음')).toBeNull();
    expect(extractJsonObject('{"a": [1,2')).toBeNull();
  });
});
describe('extractJsonObject — 중괄호로 감싼 객체 집합(운영 실측 감별진단 답변)', () => {
  it('`{ {…}, {…} }` 를 __array 로 읽는다', () => {
    const r = extractJsonObject('{\n {\n "name": "협심증", "reasoning": "흉통" },\n { "name": "폐렴", "reasoning": "호흡곤란" }\n }') as { __array?: unknown[] };
    expect(r.__array).toHaveLength(2);
  });
});
describe('extractJsonObject — 토큰 상한으로 잘린 답변', () => {
  it('끝이 안 닫혀도 완결된 안쪽 객체는 살리고 __truncated 로 말한다', () => {
    const r = extractJsonObject('{\n {"name":"협심증","reasoning":"흉통"},\n {"name":"폐렴","reasoning":"호흡곤란"},\n {"name":"기흉","reaso') as { __array?: unknown[]; __truncated?: boolean };
    expect(r.__array).toHaveLength(2); expect(r.__truncated).toBe(true);
  });
});

describe('규칙 — 혼합 문자(운영 실측 "D-다имер"·"에나르プリ")', () => {
  it('키릴·가나가 섞이면 떨어지고 한글·영문 약어는 통과', () => {
    expect(checkNoMixedScript('D-다имер 측정').ok).toBe(false);
    expect(checkNoMixedScript('에나르プリ 5mg').ok).toBe(false);
    expect(checkNoMixedScript('D-dimer 측정 · 암로디핀 5mg · SpO2').ok).toBe(true);
  });
});
