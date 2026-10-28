import { describe, it, expect, vi } from 'vitest';
import { InpatientService } from '../../src/modules/inpatient/inpatient.service';

/**
 * 인수인계 통지 계약 — 2026-08-03(기획 v2 P1-1 → 서비스화 결정).
 *
 * 🔴 종전 createHandoff 는 DB create 만 하고 끝 — 인수자가 화면을 열어야만 인계를 알 수 있어
 *    야간 인계가 묻혔다. 인앱 알림(이메일 아님)이 정본 통지 경로다.
 * W.Channel 연동은 `handoff.created` 이벤트 구독 어댑터로 추후 릴레이(훅만 먼저).
 */
const DTO = {
  type: 'NURSING_SHIFT',
  patientId: 'p-1', fromDoctorId: 'nurse-a', toDoctorId: 'nurse-b',
  admissionId: 'adm-1', summary: 'S: 안정. R: 22시 혈당 재측정',
};
const CREATED = {
  id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  patient: { familyName: '김', givenName: '영수', mrn: 'P-1' },
  fromDoctor: { familyName: '이', givenName: '하번' },
};

function build() {
  const prisma: any = { admission: { findUnique: vi.fn().mockResolvedValue({ patientId: 'p-1' }) }, clinicalHandoff: { create: vi.fn().mockResolvedValue(CREATED) } };
  const notifications = { notify: vi.fn().mockResolvedValue({ id: 'n1' }) };
  const events = { emit: vi.fn() };
  const svc = new InpatientService(prisma, undefined, undefined, undefined, undefined, notifications as never, events as never);
  return { svc, prisma, notifications, events };
}

describe('인수인계 생성 통지', () => {
  it('인수자에게 인앱 알림 — refId 는 handoff id(UUID·알림 refId 계약)', async () => {
    const { svc, notifications } = build();
    await svc.createHandoff(DTO);
    const [userId, input] = notifications.notify.mock.calls[0];
    expect(userId).toBe('nurse-b');
    expect(input.type).toBe('CLINICAL_HANDOFF');
    expect(input.refId).toBe(CREATED.id);
    expect(input.message).toContain('김영수');
  });

  it('W.Channel 훅 — handoff.created 이벤트를 낸다(어댑터 향후 구독점)', async () => {
    const { svc, events } = build();
    await svc.createHandoff(DTO);
    expect(events.emit).toHaveBeenCalledWith('handoff.created', expect.objectContaining({
      handoffId: CREATED.id, toUserId: 'nurse-b', handoffType: 'NURSING_SHIFT',
    }));
  });

  it('알림 실패는 인계 등록을 막지 않는다(비차단)', async () => {
    const { svc, notifications } = build();
    notifications.notify.mockRejectedValueOnce(new Error('sse down'));
    const r = await svc.createHandoff(DTO);
    expect(r.data.id).toBe(CREATED.id);
  });

  it('알림 서비스 미주입이어도 동작한다(무중단)', async () => {
    const prisma: any = { admission: { findUnique: vi.fn().mockResolvedValue({ patientId: 'p-1' }) }, clinicalHandoff: { create: vi.fn().mockResolvedValue(CREATED) } };
    const svc = new InpatientService(prisma);
    const r = await svc.createHandoff(DTO);
    expect(r.data.id).toBe(CREATED.id);
  });
});
