import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentSessionService } from '../../src/modules/agent-session/agent-session.service';

// 예약 챗봇 결정적 NLP 로직 (F: spec 밀도 — 증상→부서 추천·날짜 파싱 오분류 방지)
describe('AgentSessionService NLP 결정 로직', () => {
  let service: AgentSessionService;

  beforeEach(() => {
    // 병원 정체는 정본 system_configs 의 DB 행(findMany) — 행 없음 = 미설정
    service = new AgentSessionService({ systemConfig: { findMany: async () => [] } } as any, {} as any, {} as any, {} as any, {} as any);
  });

  /**
   * 🔴 이 자리에는 `recommendDepartments (증상→부서 가중 추천)` 스펙이 있었고,
   *    "흉통 → 내과 1순위" 를 정상 동작으로 못박아 원 결함을 계약으로 굳혀두고 있었다(T4/T5).
   *    실제로는 컴파일 타임 하드코딩 맵을 읽고 있어서
   *      · /admin/triage 에서 규칙을 고쳐도 반영되지 않았고
   *      · 타입에 emergency 가 없어 흉통·호흡곤란에 응급 경고가 나가지 않았으며
   *      · DB(순환기내과 1순위) · migrate 맵(응급의학과 1순위)과 함께 같은 흉통에 답이 셋이었다.
   *    이제 추천은 DB 규칙(TriageService) 하나로만 나온다 — 재유입을 코드로 막는다.
   */
  describe('🔴 하드코딩 증상→진료과 맵 재유입 차단 (T4/T5)', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/agent-session/agent-session.service.ts'), 'utf8');
    const codeLines = src.split('\n').filter(l => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    });

    it('SYMPTOM_DEPT_MAP / SYMPTOM_ALIAS 상수가 없다', () => {
      expect(codeLines.some(l => l.includes('SYMPTOM_DEPT_MAP'))).toBe(false);
      expect(codeLines.some(l => l.includes('SYMPTOM_ALIAS'))).toBe(false);
    });

    it('증상→진료과 매핑 리터럴(`depts:` / `reasons:`)이 없다', () => {
      expect(codeLines.some(l => /\bdepts\s*:/.test(l))).toBe(false);
      expect(codeLines.some(l => /\breasons\s*:\s*\[/.test(l))).toBe(false);
    });

    it('진료과 추천은 TriageService 를 통해서만 나온다', () => {
      expect(src).toContain('this.triageService.evaluate');
      expect(src).toContain('this.triageService.extractSymptoms');
    });

    it('응급 안내는 코드 정본 행동 지시를 쓴다 (DB 감별진단 메모를 환자에게 그대로 보내지 않는다·T6)', () => {
      expect(src).toContain('PATIENT_EMERGENCY_ACTION');
      expect(src).toContain('emergencyNotice');
    });
  });

  describe('parseDatePreference (요일·시간대·다음주 파싱)', () => {
    const parse = (input: string) => (service as any).parseDatePreference(input);

    it('요일 추출(중복 제거)', () => {
      expect(parse('월요일 화요일 부탁해요').days).toEqual(['월', '화']);
      expect(parse('수 수요일 다 좋아요').days).toEqual(['수']); // 중복 제거
    });

    it('오전/오후 기간 분류', () => {
      expect(parse('월요일 오전').period).toBe('오전');
      expect(parse('화요일 아침').period).toBe('오전');
      expect(parse('금요일 오후').period).toBe('오후');
      expect(parse('금요일 저녁').period).toBe('오후');
      expect(parse('월요일').period).toBeNull();
    });

    it('다음주 플래그', () => {
      expect(parse('다음 주 화요일').nextWeek).toBe(true);
      expect(parse('차주 수요일').nextWeek).toBe(true);
      expect(parse('이번주 목요일').nextWeek).toBe(false);
    });

    it('요일 없으면 null', () => {
      expect(parse('오전에 아무때나')).toBeNull();
    });
  });
});
