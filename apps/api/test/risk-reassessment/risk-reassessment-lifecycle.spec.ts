import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RiskReassessmentListener } from '../../src/modules/risk-reassessment/risk-reassessment.listener';

/**
 * 위험 재평가 스케줄 생명주기 가드.
 *
 * 🔴 배선 전 실측: `autoCreateOnAdmission` 은 호출처가 전역 0이라 스케줄이 0행이었다.
 *    배선을 미뤄둔 3개 사유 중 두 개(퇴원 종료 경로 부재·입원 이벤트 반쪽)를 해소하고 붙였고,
 *    남은 하나(주기 표 위원회 미확정)는 **생성만** config 게이트 뒤에 두어 해결했다.
 *
 * 결함 재주입 시 실패한다:
 *   - 게이트 검사를 지우면 → '기본 OFF' 케이스 실패(잘못된 주기로 법정기록이 쌓이는 회귀)
 *   - 종료 처리를 게이트 뒤로 옮기면 → '종료는 게이트와 무관' 케이스 실패(퇴원 후 무한 알림 회귀)
 */
describe('재평가 스케줄 생명주기 (입원 생성 · 재원 종료)', () => {
  let service: any;
  let config: any;
  let listener: RiskReassessmentListener;

  beforeEach(() => {
    service = {
      autoCreateOnAdmission: vi.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
      deactivateByAdmission: vi.fn().mockResolvedValue(2),
    };
    config = { get: vi.fn().mockResolvedValue(false) };
    listener = new RiskReassessmentListener(service, config);
  });

  it('기본은 OFF — 입원해도 스케줄을 만들지 않는다(주기 표가 위원회 미확정 잠정값)', async () => {
    await listener.onAdmissionCreated({ admissionId: 'a-1', patientId: 'p-1' });
    expect(service.autoCreateOnAdmission).not.toHaveBeenCalled();
  });

  it('게이트를 켜면 입원마다 스케줄이 생긴다', async () => {
    config.get.mockResolvedValue(true);
    await listener.onAdmissionCreated({ admissionId: 'a-1', patientId: 'p-1' });
    expect(service.autoCreateOnAdmission).toHaveBeenCalledWith('p-1', 'a-1');
  });

  it('게이트 값이 문자열 "true" 여도 켜진 것으로 오해하지 않는다(=== true)', async () => {
    config.get.mockResolvedValue('true');
    await listener.onAdmissionCreated({ admissionId: 'a-1', patientId: 'p-1' });
    // config 는 boolean 으로 저장된다. 문자열이 들어오면 그것은 값이 오염된 것이므로 켜지 않는다.
    expect(service.autoCreateOnAdmission).not.toHaveBeenCalled();
  });

  it('🔴 재원 종료는 게이트와 무관하게 항상 스케줄을 닫는다 — 수동 생성분도 닫아야 한다', async () => {
    config.get.mockResolvedValue(false); // 생성은 꺼져 있어도
    await listener.onAdmissionClosed({ admissionId: 'a-1', reason: 'DISCHARGE' });
    expect(service.deactivateByAdmission).toHaveBeenCalledWith('a-1');
  });

  it('전원·입원취소도 같은 구독점으로 닫힌다(취소분만 남으면 또 갈라진다)', async () => {
    for (const reason of ['TRANSFER', 'CANCELLED']) {
      await listener.onAdmissionClosed({ admissionId: `a-${reason}`, reason });
    }
    expect(service.deactivateByAdmission).toHaveBeenCalledTimes(2);
  });

  it('스케줄 생성 실패가 입원을 막지 않는다(비차단)', async () => {
    config.get.mockResolvedValue(true);
    service.autoCreateOnAdmission.mockRejectedValue(new Error('DB down'));
    await expect(listener.onAdmissionCreated({ admissionId: 'a-1', patientId: 'p-1' })).resolves.toBeUndefined();
  });

  it('config 미주입(부분 부트)이면 켜지 않는다 — 모르면 안전측으로 접는다', async () => {
    const bare = new RiskReassessmentListener(service, undefined);
    await bare.onAdmissionCreated({ admissionId: 'a-1', patientId: 'p-1' });
    expect(service.autoCreateOnAdmission).not.toHaveBeenCalled();
    // 종료는 config 없이도 돈다
    await bare.onAdmissionClosed({ admissionId: 'a-1' });
    expect(service.deactivateByAdmission).toHaveBeenCalledWith('a-1');
  });
});
