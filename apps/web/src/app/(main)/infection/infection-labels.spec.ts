import { describe, it, expect } from 'vitest';
import {
  HH_MOMENTS,
  INFECTION_TYPE_LABEL,
  complianceBarTone,
  complianceDisplay,
  infectionTypeLabel,
  isolationLabel,
} from './infection-labels';

/** 감염관리 화면 표현 가드 — 화면 실사용 점검 W7(2026-08-14) */
describe('감염관리 화면 라벨/표현 정본', () => {
  describe('표본 부재 → 0% 가 아니라 산출 불가', () => {
    it('관측 0건이면 available=false · 목표 대비 색칠하지 않는다', () => {
      const d = complianceDisplay(null, 0);
      expect(d.available).toBe(false);
      expect(d.text).toBe('산출 불가');
      expect(d.tone).toBe('text-gray-400'); // 🔴 빨강(text-red-600)이면 회귀
      expect(complianceBarTone(null, 0)).toBe('bg-gray-200');
    });

    it('서버가 0 을 보내도 표본이 없으면 산출 불가로 읽는다(방어)', () => {
      expect(complianceDisplay(0, 0).available).toBe(false);
    });

    it('관측된 진짜 0% 는 0 으로 말하고 빨강으로 경고한다', () => {
      const d = complianceDisplay(0, 12);
      expect(d.available).toBe(true);
      expect(d.text).toBe('0');
      expect(d.tone).toBe('text-red-600');
    });

    it('목표(90) 이상은 초록, 80~90 은 주황', () => {
      expect(complianceDisplay(92.5, 40).tone).toBe('text-emerald-600');
      expect(complianceDisplay(85, 40).tone).toBe('text-amber-600');
      expect(complianceDisplay(120, 40).barPct).toBe(100);
    });
  });

  describe('라벨표는 한 벌', () => {
    it('감염유형 코드는 상단 표·HAI 탭이 같은 한글 라벨을 쓴다', () => {
      expect(infectionTypeLabel('SSI')).toBe('수술부위감염');
      expect(infectionTypeLabel('CAUTI')).toBe('요로감염');
      expect(infectionTypeLabel('HAP')).toBe('병원획득 폐렴');
      expect(INFECTION_TYPE_LABEL.CLABSI).toBe('중심정맥관 혈류감염');
    });

    it('코드가 아닌 자유 입력 질병명은 원문 그대로 보여준다', () => {
      expect(infectionTypeLabel('코로나19')).toBe('코로나19');
      expect(infectionTypeLabel(null)).toBe('-');
    });

    it('격리 유형은 한글 라벨로 수렴(MDRO 탭의 CONTACT raw 표기 방지)', () => {
      expect(isolationLabel('CONTACT')).toBe('접촉격리');
      expect(isolationLabel('AIRBORNE')).toBe('공기격리');
    });

    it('WHO Moment 폴백 문구는 BE 정본과 동일하다', () => {
      // BE: InfectionControlService.HH_MOMENTS
      expect(HH_MOMENTS[2]).toBe('체액 노출 위험 후');
      expect(HH_MOMENTS).toHaveLength(5);
    });
  });
});
