import { describe, it, expect } from 'vitest';
import { screenOutput, appendDisclaimer, validateContentText, NON_DEVICE_DISCLAIMER } from './guardrail';

describe('checkup-explainer guardrail', () => {
  it('허용: 정보 제공·권유형은 통과하고 면책이 부착된다', () => {
    const r = screenOutput('공복혈당이 당뇨병 진단 기준 범위에 해당할 수 있습니다. 전문의 상담을 권합니다.');
    expect(r.blocked).toBe(false);
    expect(r.safeText).toContain(NON_DEVICE_DISCLAIMER);
  });

  it('차단: 진단 확정 표현', () => {
    expect(screenOutput('당신은 당뇨병입니다.').blocked).toBe(true);
    expect(screenOutput('검사 결과 고혈압으로 진단됩니다.').blocked).toBe(true);
  });

  it('차단: 처방·용량 지시', () => {
    expect(screenOutput('메트포르민 500mg을 복용하세요.').blocked).toBe(true);
    expect(screenOutput('혈압약을 처방해 드립니다.').blocked).toBe(true);
    expect(screenOutput('하루 3회 복용해야 합니다.').blocked).toBe(true);
  });

  it('차단: 진료 회피 조장', () => {
    expect(screenOutput('이 정도면 병원에 갈 필요 없습니다.').blocked).toBe(true);
  });

  it('허용: 정상범위 설명·재검 권고', () => {
    expect(screenOutput('이 수치는 정상범위보다 약간 높은 편입니다.').blocked).toBe(false);
    expect(screenOutput('이 범위는 재검 권고 대상일 수 있습니다.').blocked).toBe(false);
  });

  it('면책 중복 부착 방지', () => {
    const once = appendDisclaimer('설명');
    expect(appendDisclaimer(once)).toBe(once);
  });

  it('validateContentText: 금칙 hit 반환', () => {
    expect(validateContentText('당신은 당뇨병입니다.').length).toBeGreaterThan(0);
    expect(validateContentText('전문의 상담을 권합니다.').length).toBe(0);
    expect(validateContentText(null).length).toBe(0);
  });
});
