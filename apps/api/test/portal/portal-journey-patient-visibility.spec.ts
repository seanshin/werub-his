/**
 * 🔴 (2026-09-14) 환자 포털 여정 타임라인이 유형 필터 없이 직원 내부 이벤트(암등록 후보·청구 심사·청구 생성 실패 오류 메시지)를 돌려줬다.
 * 지키는 것: ① 조회가 환자 노출 유형만 요청하고 metadata 를 싣지 않는다 ② 내부 유형은 목록에 없다 ③ 어휘 밖 이름은 숨긴다(fail-closed)
 *           ④ 대조군 — 일반 여정(접수·결과·수납·퇴원)은 보인다 ⑤ 숨김 목록은 어휘 안의 이름만·사유 필수
 */
import { describe, expect, it, vi } from 'vitest';
import {
  JOURNEY_EVENT_PATIENT_HIDDEN, JOURNEY_EVENT_TYPES, PATIENT_VISIBLE_JOURNEY_EVENT_TYPES, isPatientVisibleJourneyEvent,
} from '@hospital-run/shared';
import { PortalService } from '../../src/modules/portal/portal.service';

describe('포털 여정 타임라인 — 환자 노출 필터', () => {
  it('① 조회가 노출 유형만 요청하고 metadata 를 싣지 않는다', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const svc = Object.create(PortalService.prototype) as PortalService;
    (svc as any).prisma = { patientJourneyEvent: { findMany } };
    await svc.getJourneyTimeline('p1');
    const arg = findMany.mock.calls[0][0];
    expect(arg.where.eventType.in).toEqual([...PATIENT_VISIBLE_JOURNEY_EVENT_TYPES]);
    expect(arg.where.patientId).toBe('p1');
    expect(arg.select.metadata).toBeUndefined();
  });

  it.each(['CANCER_REGISTRY_CANDIDATE', 'BILLING_CREATE_FAILED', 'CLAIM_REVIEW', 'BILLING_AMEND_REVIEW'])('② 내부 유형 %s 는 숨긴다', (t) => {
    expect(isPatientVisibleJourneyEvent(t)).toBe(false);
    expect(PATIENT_VISIBLE_JOURNEY_EVENT_TYPES).not.toContain(t);
  });

  it('③ 어휘 밖 이름은 숨긴다', () => {
    expect(isPatientVisibleJourneyEvent('ATTENDING_CHANGE')).toBe(false);
    expect(isPatientVisibleJourneyEvent('SOMETHING_NEW')).toBe(false);
  });

  it.each(['RECEPTION_CHECKIN', 'LAB_RESULT', 'BILLING_PAID', 'DISCHARGE'])('④ 대조군 — %s 는 보인다', (t) => {
    expect(isPatientVisibleJourneyEvent(t)).toBe(true);
  });

  it('⑤ 숨김 목록은 어휘 안의 이름만이고 사유가 비어 있지 않다', () => {
    for (const [k, reason] of Object.entries(JOURNEY_EVENT_PATIENT_HIDDEN)) {
      expect((JOURNEY_EVENT_TYPES as readonly string[]).includes(k), k).toBe(true);
      expect(String(reason).trim().length, k).toBeGreaterThan(0);
    }
  });
});
