import { describe, it, expect } from 'vitest';
import {
  matchPhrase,
  normalizeSymptomText,
  isPatientActionableEmergencyMsg,
  TRIAGE_EXAMPLE_PHRASES,
  PATIENT_EMERGENCY_ACTION,
  PATIENT_EMERGENCY_UNDETERMINED,
} from '../../src/modules/triage/symptom-match';

/**
 * 🔴 원 결함 T1 — 증상 매칭이 `text.includes(alias)` 단순 부분일치였다.
 *    DB 별칭은 "머리 아파요"·"가슴 답답" 형태인데 환자는 "머리가 아파요"·"가슴이 답답해요" 라고 쓴다.
 *    조사 한 글자에 매칭이 통째로 빗나가, 시스템이 스스로 제시한 예시 문장의 과반이 실패했고
 *    실운영 공개 예약 16건 중 6건이 "내과 · 기본 추천(50%)" 으로 흘렀다(T2).
 *
 * 아래 별칭 표는 **운영 DB 실측 스냅샷**(2026-08-14, triage_aliases/triage_symptoms)에서 뽑은 것이다.
 * 가짜 데이터로 통과하는 스펙은 이 결함을 다시 놓친다.
 */
const DB_ALIASES: ReadonlyArray<readonly [symptom: string, alias: string]> = [
  ['두통', '머리 아파요'], ['두통', '뒷머리 아파요'], ['두통', '관자놀이 아파요'], ['두통', '편두통'], ['두통', '두통'],
  ['복통', '배가 아파요'], ['복통', '배아파요'], ['복통', '위가 아파요'], ['복통', '옆구리 아파요'], ['복통', '복통'],
  ['발열', '열이 나요'], ['발열', '고열'], ['발열', '오한'], ['발열', '발열'],
  ['요통', '허리 아파요'], ['요통', '허리통증'], ['요통', '요통'],
  ['관절통', '관절이 아파요'], ['관절통', '무릎 아파요'], ['관절통', '어깨 아파요'], ['관절통', '손목 아파요'], ['관절통', '관절통'],
  ['발진', '발진'], ['발진', '두드러기'], ['발진', '피부가 빨개요'],
  ['안구 통증', '눈이 아파요'], ['안구 통증', '눈이 빨개요'], ['안구 통증', '안구 통증'],
  ['어지러움', '어지러워요'], ['어지러움', '현기증'], ['어지러움', '어지러움'],
  ['흉통', '가슴 답답'], ['흉통', '가슴 아파요'], ['흉통', '가슴통증'], ['흉통', '심장 아파요'], ['흉통', '흉통'],
  ['호흡곤란', '숨이 차요'], ['호흡곤란', '숨쉬기 힘들어요'], ['호흡곤란', '호흡곤란'],
  ['인후통', '목 아파요'], ['인후통', '목이 아파요'], ['인후통', '인후통'],
  ['배뇨장애', '소변 볼 때 아파요'], ['배뇨장애', '빈뇨'], ['배뇨장애', '배뇨장애'],
  ['소아 발열', '아이가 열이 나요'], ['소아 발열', '아이 고열'], ['소아 발열', '소아 발열'],
  ['우울/불안', '잠이 안 와요'], ['우울/불안', '우울해요'],
  ['임신 관련 증상', '임신 중 배 아파요'], ['임신 관련 증상', '진통이 와요'],
];

/** 지금 매칭기로 문장을 돌렸을 때 붙는 증상들 */
function symptomsFor(text: string): string[] {
  return [...new Set(DB_ALIASES.filter(([, alias]) => matchPhrase(text, alias)).map(([s]) => s))];
}
/** 결함 그대로의 옛 매칭 — 회귀 비교용 */
function symptomsForLegacy(text: string): string[] {
  return [...new Set(DB_ALIASES.filter(([, alias]) => text.includes(alias)).map(([s]) => s))];
}

describe('symptom-match — 트리아지 증상 매칭 정본', () => {
  describe('🔴 T1: 조사 하나로 매칭이 빗나가던 것', () => {
    // before/after 는 운영 DB 전체(별칭 169 + 증상 29)로 측정한 값과 같은 방향이다.
    const CASES: ReadonlyArray<readonly [text: string, expected: string]> = [
      ['머리가 아파요', '두통'],       // 별칭 "머리 아파요" — 조사 '가'
      ['허리가 아파요', '요통'],       // 별칭 "허리 아파요" — 조사 '가'
      ['무릎이 아파요', '관절통'],     // 별칭 "무릎 아파요" — 조사 '이'
      ['소변볼 때 아파요', '배뇨장애'], // 별칭 "소변 볼 때 아파요" — 공백 차이
      ['가슴이 답답해요', '흉통'],     // 별칭 "가슴 답답" — 조사 '이' + 어미 '해요'
      ['눈이 아프고 불편해요', '안구 통증'], // 어미 '아프고'
    ];

    for (const [text, expected] of CASES) {
      it(`"${text}" → ${expected} (옛 부분일치로는 실패하던 문장)`, () => {
        expect(symptomsForLegacy(text)).not.toContain(expected);
        expect(symptomsFor(text)).toContain(expected);
      });
    }

    it('🔴 "가슴이 답답해요" 는 응급 증상(흉통)이다 — 못 잡으면 응급 경고가 통째로 사라진다', () => {
      expect(symptomsFor('가슴이 답답해요')).toEqual(['흉통']);
    });
  });

  describe('과매칭 방지 — 거짓 경보는 진짜 경보를 죽인다', () => {
    it('덩어리 사이 틈이 조사가 아니면 매칭하지 않는다', () => {
      expect(matchPhrase('가슴은 멀쩡한데 배가 답답해요', '가슴 답답')).toBeNull();
      expect(matchPhrase('머리 말고 허리 아파요', '머리 아파요')).toBeNull();
    });

    it('덩어리 순서가 뒤바뀌면 매칭하지 않는다', () => {
      expect(matchPhrase('답답한 가슴', '가슴 답답')).toBeNull();
    });

    it('틈이 3글자 이상이면 조사여도 매칭하지 않는다', () => {
      expect(matchPhrase('가슴에서와의 답답', '가슴 답답')).toBeNull();
    });

    it('관계 없는 문장은 아무 증상도 붙지 않는다', () => {
      expect(symptomsFor('주차장이 어디인가요')).toEqual([]);
      expect(symptomsFor('예약을 변경하고 싶어요')).toEqual([]);
      expect(symptomsFor('진료비가 얼마인가요')).toEqual([]);
    });

    it('운영 별칭 전체를 서로 교차해도 새로 붙는 증상은 임상적으로 타당한 1건뿐이다', () => {
      // 운영 실측: 별칭 원문 198건 교차 시 새로 붙은 것은 "임신 중 배 아파요 → +복통" 하나.
      // (임신 관련 증상이 응급 표시라 응급 판정은 그대로 유지된다 — 안전측 추가)
      const added: string[] = [];
      for (const [, alias] of DB_ALIASES) {
        const before = new Set(symptomsForLegacy(alias));
        for (const s of symptomsFor(alias)) if (!before.has(s)) added.push(`${alias} → +${s}`);
      }
      expect(added).toEqual(['임신 중 배 아파요 → +복통']);
    });
  });

  describe('정규화', () => {
    it('공백·문장부호·이모지를 제거하고 어미를 정규화한다(양쪽 동일 적용)', () => {
      expect(normalizeSymptomText(' 머리가  아파요! ')).toBe('머리가아파');
      expect(normalizeSymptomText('아픕니다')).toBe('아파');
      expect(normalizeSymptomText('답답해요')).toBe('답답');
      expect(normalizeSymptomText('어지러워요')).toBe('어지러');
      expect(normalizeSymptomText('어지러움')).toBe('어지러');
    });

    it('닫힌 목록 밖 단어는 건드리지 않는다 — 형태소 분석기를 흉내내지 않는다', () => {
      expect(normalizeSymptomText('아프리카')).toBe('아프리카');
      expect(normalizeSymptomText('기침이나요')).toBe('기침이나요');
    });
  });

  describe('🔴 T6: 응급 문구가 환자용 행동 지시인지 판정', () => {
    it('감별진단 임상 메모는 환자용이 아니다 — 운영 DB 실측 문구', () => {
      expect(isPatientActionableEmergencyMsg('급성 관상동맥증후군/대동맥박리 감별 필요')).toBe(false);
      expect(isPatientActionableEmergencyMsg('뇌졸중/두개내 출혈 즉시 감별 필요')).toBe(false);
      expect(isPatientActionableEmergencyMsg(null)).toBe(false);
      expect(isPatientActionableEmergencyMsg('')).toBe(false);
    });

    it('119/응급실 지시가 있어야 환자용이다', () => {
      expect(isPatientActionableEmergencyMsg('⚠️ 흉통은 응급 상황일 수 있습니다. 119에 연락하세요.')).toBe(true);
      expect(isPatientActionableEmergencyMsg('즉시 응급실로 오세요')).toBe(true);
    });

    it('코드 정본 환자 문구에는 반드시 119 행동 지시가 있다', () => {
      expect(PATIENT_EMERGENCY_ACTION).toContain('119');
      expect(PATIENT_EMERGENCY_UNDETERMINED).toContain('119');
      // 🔴 판단 불가를 '응급 아님'처럼 말하지 않는다
      expect(PATIENT_EMERGENCY_UNDETERMINED).toContain('판단하지 못했습니다');
    });
  });

  describe('예시 문장 정본 — 매칭 실패는 데이터 갭으로 드러나야 한다', () => {
    it('시스템이 환자에게 제시하는 문장 목록이 정본 한 곳에만 있다', () => {
      expect(TRIAGE_EXAMPLE_PHRASES.length).toBeGreaterThan(0);
      expect(new Set(TRIAGE_EXAMPLE_PHRASES.map(p => p.value)).size).toBe(TRIAGE_EXAMPLE_PHRASES.length);
    });

    it('조사·어미 때문에 실패하는 문장은 하나도 없다 (남은 실패는 DB 데이터 부재뿐)', () => {
      // DB 스냅샷에 해당 증상이 존재하는 문장만 검사한다.
      // 기침·소화불량·불면·"아이가 아파요"(무엇이 아픈지 정보 없음)는 운영 DB에 증상 자체가 없어
      // 코드로는 해결되지 않는다 — 자가 점검 화면(/admin/triage 통계 탭)이 갭으로 표시한다.
      const DATA_GAPS = ['기침이 나고 감기 증상이 있어요', '소화가 안 돼요', '잠을 잘 못 자요', '아이가 아파요'];
      const failed = TRIAGE_EXAMPLE_PHRASES
        .filter(p => p.expectSymptom && !DATA_GAPS.includes(p.value))
        .filter(p => symptomsFor(p.value).length === 0)
        .map(p => p.value);
      expect(failed).toEqual([]);
    });

    it('옛 매칭 대비 성공 문장이 늘었다 (5건 → 9건, 운영 DB 스냅샷 기준)', () => {
      const before = TRIAGE_EXAMPLE_PHRASES.filter(p => symptomsForLegacy(p.value).length > 0).length;
      const after = TRIAGE_EXAMPLE_PHRASES.filter(p => symptomsFor(p.value).length > 0).length;
      expect(before).toBe(5);
      expect(after).toBe(9);
    });
  });
});
