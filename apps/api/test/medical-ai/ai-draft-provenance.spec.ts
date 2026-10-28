/**
 * 🔴 초안 ≠ 확정 — AI 초안이 폼에 적용된 사실의 프로비넌스(§7.6-b · 2026-08-19).
 *
 * 실측: 패널 안에서는 "AI 제안"이던 글이 적용 버튼을 누르는 순간 사람이 쓴 글자와 같아졌다.
 * `Encounter.aiScribed` 는 스크라이브 전용이라 진료 AI 보조·퇴원요약·동의서 초안은 흔적이 없었다.
 * 스키마 일반화(사람 게이트) 전까지 `POST /api/v1/ai/draft-applied` 가 감사 원장에 남기는 것이 유일한 흔적이다.
 *
 * 재주입하면 실패한다: EP 가 audit.log 를 안 부르거나 recorded 를 거짓으로 돌려주면 잡힌다.
 */
import { describe, it, expect, vi } from 'vitest';
import { MedicalAiController } from '../../src/modules/medical-ai/medical-ai.controller';
import { VocAdminService } from '../../src/modules/voc/voc-admin.service';
import { ZERO_UUID } from '../../src/modules/audit/audit-routes';

const PATIENT = '11111111-1111-4111-8111-111111111111';

describe('POST /api/v1/ai/draft-applied — 감사 원장 프로비넌스', () => {
  const mk = (audit: any) => new MedicalAiController({} as any, audit);

  it('환자를 알면 patientId 로 귀속해 AiDraftApply 행을 남기고 recorded=true', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const r = await mk(audit).draftApplied({ resourceType: 'ENCOUNTER_SOAP', source: 'ASSISTANT', patientId: PATIENT, field: 'A,P', textLength: 120 } as any, 'user-1');
    expect(r.data.recorded).toBe(true);
    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = audit.log.mock.calls[0][0];
    expect(entry.resourceType).toBe('AiDraftApply');
    expect(entry.resourceId).toBe(PATIENT);
    expect(entry.userId).toBe('user-1');
    expect(JSON.stringify(entry.changes)).toContain('"source":"ASSISTANT"');
    expect(JSON.stringify(entry.changes)).toContain('"textLength":120');
  });

  it('🔴 환자를 모르면 추정하지 않는다 — ZERO_UUID', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    await mk(audit).draftApplied({ resourceType: 'DISCHARGE_SUMMARY', source: 'GENERATOR', textLength: 10 } as any, 'user-1');
    expect(audit.log.mock.calls[0][0].resourceId).toBe(ZERO_UUID);
  });

  it('🔴 기록하지 못하면 recorded=false 라고 정직하게 돌려준다(감사 미주입·예외 둘 다)', async () => {
    const none = await mk(undefined).draftApplied({ resourceType: 'CONSENT', source: 'GENERATOR', textLength: 1 } as any, 'user-1');
    expect(none.data.recorded).toBe(false);
    const failing = { log: vi.fn().mockRejectedValue(new Error('db down')) };
    const r = await mk(failing).draftApplied({ resourceType: 'CONSENT', source: 'GENERATOR', textLength: 1 } as any, 'user-1');
    expect(r.data.recorded).toBe(false);
  });
});

describe('VoC 답변 — AI 초안에서 출발한 답변은 aiDraft 로 남는다', () => {
  const mkSvc = () => {
    const prisma: any = {
      vocTicket: { findUnique: vi.fn().mockResolvedValue({ id: 't1', patientId: null, firstResponseAt: null, status: 'OPEN', type: 'QUESTION', title: 'x' }), update: vi.fn().mockResolvedValue({}) },
      vocMessage: { create: vi.fn().mockResolvedValue({}) },
    };
    return { svc: new VocAdminService(prisma), prisma };
  };
  it('aiDraft=true 가 메시지 행에 저장된다(저자는 STAFF 그대로)', async () => {
    const { svc, prisma } = mkSvc();
    await svc.addStaffMessage('t1', 'u1', '담당자', 'AI 초안을 검토한 답변', false, true);
    const data = prisma.vocMessage.create.mock.calls[0][0].data;
    expect(data.aiDraft).toBe(true);
    expect(data.authorType).toBe('STAFF');
  });
  it('기본값은 false — 사람이 처음부터 쓴 답변에 초안 표식을 붙이지 않는다', async () => {
    const { svc, prisma } = mkSvc();
    await svc.addStaffMessage('t1', 'u1', '담당자', '직접 쓴 답변', false);
    expect(prisma.vocMessage.create.mock.calls[0][0].data.aiDraft).toBe(false);
  });
});
