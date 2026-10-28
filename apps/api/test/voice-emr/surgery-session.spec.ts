import { describe, it, expect, vi } from 'vitest';
import { VoiceEmrService } from '../../src/modules/voice-emr/voice-emr.service';

/**
 * 수술 단위 음성 세션(2026-10-05 수술방 차트 P1).
 *  · 수술팀 자리(집도·보조·마취(원장·마취 기록)·소독·순회 간호)에 있는 사람만 연다 — 아니면 SURGERY_TEAM_ONLY
 *  · 구술만(DICTATE) — 명령·조회 모드는 거절 · 구술 게이트(voiceEmr.dictate.enabled)는 그대로 지난다
 *  · 진료/수술 둘 중 하나만 · 확정(confirm) 경로는 쓰지 않는다
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
const ON = { 'voiceEmr.enabled': true, 'voiceEmr.pilotUserIds': [], 'voiceEmr.dictate.enabled': true };
const SURG = { id: 'sg1', patientId: 'p1', status: 'IN_PROGRESS', surgeonId: 'doc', assistantId: null, anesthetistId: null, scrubNurseId: 'n1', circulatingNurseId: 'n2' };

function svcWith(cfg: Record<string, unknown> = ON, over: { surgery?: unknown; anes?: unknown; mode?: string } = {}) {
  const config: any = { get: vi.fn((k: string) => Promise.resolve(cfg[k])) };
  const audit: any = { log: vi.fn().mockResolvedValue(undefined) };
  const stt: any = { warm: vi.fn().mockResolvedValue(undefined), registerVocab: vi.fn().mockResolvedValue(undefined) };
  const create = vi.fn((a: { data: Record<string, unknown> }) => Promise.resolve({ id: 'vs1', ...a.data }));
  const prisma: any = {
    voiceUserProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    surgery: { findUnique: vi.fn().mockResolvedValue('surgery' in over ? over.surgery : SURG) },
    anesthesiaRecord: { findUnique: vi.fn().mockResolvedValue('anes' in over ? over.anes : null) },
    encounter: { findUnique: vi.fn() },
    voiceCommandSession: { create, findUnique: vi.fn().mockResolvedValue({ id: 'vs1', doctorId: 'n2', surgeryId: 'sg1', encounterId: null, status: 'ACTIVE', mode: 'DICTATE' }) },
    voiceCustomPhrase: { findMany: vi.fn().mockResolvedValue([]) },
    patient: { findUnique: vi.fn().mockResolvedValue({ familyName: '김', givenName: '하나', mrn: 'M1', gender: 'FEMALE', dateOfBirth: null }) },
  };
  const hisMode: any = over.mode ? { effective: vi.fn(async () => over.mode) } : undefined;
  return { svc: new VoiceEmrService(prisma, config, audit, stt, {} as any, undefined, hisMode), prisma, create };
}

describe('수술 단위 음성 세션', () => {
  it('순회 간호(수술팀)는 연다 — 진료 없이 수술·환자로 묶인다', async () => {
    const { svc, create } = svcWith();
    const r = await svc.startSession('n2', { surgeryId: 'sg1', mode: 'dictate' });
    expect(r.mode).toBe('DICTATE');
    expect(create.mock.calls[0][0].data).toMatchObject({ encounterId: null, surgeryId: 'sg1', patientId: 'p1', doctorId: 'n2' });
  });

  it('🔴 수술팀 자리에 없는 사람은 거절(SURGERY_TEAM_ONLY) · 세션을 만들지 않는다', async () => {
    const { svc, create } = svcWith();
    await expect(svc.startSession('stranger', { surgeryId: 'sg1', mode: 'dictate' })).rejects.toMatchObject({ response: { code: 'SURGERY_TEAM_ONLY' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('마취 기록의 마취의도 수술팀이다(수술 원장 칸이 비어 있어도)', async () => {
    const { svc } = svcWith(ON, { anes: { anesthetistId: 'mae' } });
    await expect(svc.startSession('mae', { surgeryId: 'sg1', mode: 'dictate' })).resolves.toMatchObject({ mode: 'DICTATE' });
  });

  it('🔴 구술만 — 조회·명령 모드는 거절', async () => {
    const { svc } = svcWith();
    await expect(svc.startSession('n2', { surgeryId: 'sg1', mode: 'read' })).rejects.toMatchObject({ response: { code: 'SURGERY_SESSION_DICTATE_ONLY' } });
    await expect(svc.startSession('n2', { surgeryId: 'sg1' })).rejects.toMatchObject({ response: { code: 'SURGERY_SESSION_DICTATE_ONLY' } });
  });

  it('🔴 구술 게이트 OFF 면 수술팀이어도 거절(VOICE_DICTATE_OFF) — 게이트를 돌아가지 않는다', async () => {
    const { svc, create } = svcWith({ ...ON, 'voiceEmr.dictate.enabled': false });
    await expect(svc.startSession('n2', { surgeryId: 'sg1', mode: 'dictate' })).rejects.toMatchObject({ response: { code: 'VOICE_DICTATE_OFF' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('진료·수술 둘 다/둘 다 없음은 거절 · 취소된 수술은 거절', async () => {
    const { svc } = svcWith();
    await expect(svc.startSession('n2', { surgeryId: 'sg1', encounterId: 'e1', mode: 'dictate' })).rejects.toMatchObject({ response: { code: 'VOICE_CONTEXT_REQUIRED' } });
    await expect(svc.startSession('n2', { mode: 'dictate' })).rejects.toMatchObject({ response: { code: 'VOICE_CONTEXT_REQUIRED' } });
    const c = svcWith(ON, { surgery: { ...SURG, status: 'CANCELLED' } });
    await expect(c.svc.startSession('n2', { surgeryId: 'sg1', mode: 'dictate' })).rejects.toMatchObject({ response: { code: 'SURGERY_CANCELLED' } });
  });

  it('🔴 수술 단위 세션은 확정 경로를 쓰지 않는다', async () => {
    const { svc } = svcWith();
    await expect(svc.confirm('n2', 'vs1', { intent: 'dictate' })).rejects.toMatchObject({ response: { code: 'SURGERY_SESSION_NO_CONFIRM' } });
  });
});

describe('수술 단위 음성 — 운영 모드', () => {
  it('🔴 리허설은 수술팀이 아니어도 연다 · 리얼은 수술팀만 · 모드 모르면 리얼', async () => {
    await expect(svcWith(ON, { mode: 'REHEARSAL' }).svc.startSession('stranger', { surgeryId: 'sg1', mode: 'dictate' })).resolves.toMatchObject({ mode: 'DICTATE' });
    await expect(svcWith(ON, { mode: 'REAL' }).svc.startSession('stranger', { surgeryId: 'sg1', mode: 'dictate' })).rejects.toMatchObject({ response: { code: 'SURGERY_TEAM_ONLY' } });
    await expect(svcWith(ON).svc.startSession('stranger', { surgeryId: 'sg1', mode: 'dictate' })).rejects.toMatchObject({ response: { code: 'SURGERY_TEAM_ONLY' } });
  });
});
