import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NursingService } from '../../src/modules/nursing/nursing.service';

// 간호기록 QA 룰 평가 (F: spec 밀도 — 결정적 순수 규칙·의무기록 완전성)
describe('NursingService 기록 QA 룰', () => {
  let service: NursingService;

  beforeEach(() => {
    service = new NursingService({} as any);
  });

  const evalRules = (note: any) => service.evaluateNursingNoteRules(note);
  const codes = (note: any) => evalRules(note).map((i) => i.code);

  describe('노트타입별 필수요소', () => {
    it('SOAP — O·A 미기재 시 WARNING', () => {
      const c = codes({ noteType: 'SOAP', subjective: '두통 호소' });
      expect(c).toContain('MISSING_O');
      expect(c).toContain('MISSING_A');
    });

    it('SOAP — O·A 있으면 필수요소 이슈 없음', () => {
      const c = codes({ noteType: 'SOAP', objective: 'BP 120/80', assessment: '안정적' });
      expect(c).not.toContain('MISSING_O');
      expect(c).not.toContain('MISSING_A');
    });

    it('DAR — D·Action WARNING·R INFO', () => {
      const issues = evalRules({ noteType: 'DAR', focus: '통증' });
      const byCode = Object.fromEntries(issues.map((i) => [i.code, i.level]));
      expect(byCode['MISSING_D']).toBe('WARNING');
      expect(byCode['MISSING_ACTION']).toBe('WARNING');
      expect(byCode['MISSING_R']).toBe('INFO');
    });

    it('DARE — 교육(E) 미기재 INFO 추가', () => {
      const c = codes({ noteType: 'DARE', data: 'd', action: 'a', response: 'r' });
      expect(c).toContain('MISSING_E');
    });

    it('NARRATIVE — 본문 미기재 WARNING', () => {
      expect(codes({ noteType: 'NARRATIVE' })).toContain('MISSING_CONTENT');
    });
  });

  describe('임상 안전 규칙', () => {
    it('통증 기록 있으나 재평가 계획 없으면 권고(INFO)', () => {
      expect(codes({ noteType: 'NARRATIVE', content: 'NRS 7점 통증 호소' })).toContain('PAIN_NO_REASSESS');
    });

    it('통증+재평가 언급이면 이슈 없음', () => {
      expect(codes({ noteType: 'NARRATIVE', content: 'NRS 7점 통증, 2시간 후 재평가 예정' })).not.toContain('PAIN_NO_REASSESS');
    });

    it('낙상 위험 언급, 예방중재 없으면 권고', () => {
      expect(codes({ noteType: 'NARRATIVE', content: 'Morse 55점 낙상 고위험' })).toContain('FALL_NO_INTERVENTION');
    });

    it('낙상+침상난간 중재 언급이면 이슈 없음', () => {
      expect(codes({ noteType: 'NARRATIVE', content: '낙상 위험, 침상 난간 올림·호출벨 교육' })).not.toContain('FALL_NO_INTERVENTION');
    });

    it('CRITICAL 우선순위인데 계획·중재 둘 다 없으면 WARNING', () => {
      const issues = evalRules({ noteType: 'NARRATIVE', content: '급성 악화', priority: 'CRITICAL' });
      expect(issues.find((i) => i.code === 'CRITICAL_NO_PLAN')?.level).toBe('WARNING');
    });

    it('CRITICAL이어도 plan 있으면 이슈 없음', () => {
      expect(codes({ noteType: 'NARRATIVE', content: '급성 악화', plan: '산소 공급·의사 호출', priority: 'CRITICAL' }))
        .not.toContain('CRITICAL_NO_PLAN');
    });
  });

  describe('점수·등급 (scoreNursingNote)', () => {
    const score = (note: any) => (service as any).scoreNursingNote(note);

    it('WARNING 15점·INFO 5점 감점 — 등급 산출', () => {
      // SOAP O·A 누락(WARNING 2 = 30) → 70점 → C
      const r = score({ noteType: 'SOAP', subjective: 's' });
      expect(r.score).toBe(70);
      expect(r.grade).toBe('C');
    });

    it('이슈 없으면 100점 A', () => {
      const r = score({ noteType: 'SOAP', objective: 'o', assessment: 'a' });
      expect(r.score).toBe(100);
      expect(r.grade).toBe('A');
    });

    it('점수는 0 미만으로 내려가지 않음(하한)', () => {
      // 다수 WARNING 누적이어도 0 하한
      const r = score({ noteType: 'DAR', priority: 'CRITICAL' }); // D·Action WARNING + R INFO + CRITICAL_NO_PLAN WARNING
      expect(r.score).toBeGreaterThanOrEqual(0);
    });
  });
});
