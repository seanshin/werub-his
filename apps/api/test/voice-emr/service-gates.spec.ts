import { describe, it, expect, vi } from 'vitest';
import { VoiceEmrService } from '../../src/modules/voice-emr/voice-emr.service';

/**
 * VoiceEMR 안전 게이트 계약 회귀(§12) — 마스터/파일럿/오더 게이트, 생체(성문) 동의 게이트,
 * 표본 방어, 완료 최소표본, 철회 파기. 실행부(오더 실쓰기)는 별도 EP라 여기선 게이트만 고정.
 */
function svcWith(cfg: Record<string, unknown>, prisma: any = {}) {
  const config: any = { get: vi.fn((k: string) => Promise.resolve(cfg[k])) };
  const audit: any = { log: vi.fn().mockResolvedValue(undefined) };
  const stt: any = {
    enrollSample: vi.fn().mockResolvedValue({ ok: true, ref: 'u1', samples: 1, quality: 0.8 }),
    deleteSpeaker: vi.fn().mockResolvedValue({ ok: true }),
  };
  const scribeAi: any = {};
  return { svc: new VoiceEmrService(prisma, config, audit, stt, scribeAi), stt, audit };
}
const ON = { 'voiceEmr.enabled': true, 'voiceEmr.pilotUserIds': [], 'voiceEmr.order.enabled': false, 'voiceEmr.dictate.enabled': false };

describe('VoiceEMR 마스터/파일럿/모드 게이트', () => {
  it('voiceEmr.enabled OFF 면 차단', async () => {
    const { svc } = svcWith({ 'voiceEmr.enabled': false });
    await expect((svc as any).assertEnabled('u1', 'READ')).rejects.toMatchObject({ response: { code: 'VOICE_EMR_DISABLED' } });
  });

  it('파일럿 한정 목록에 없으면 차단', async () => {
    const { svc } = svcWith({ ...ON, 'voiceEmr.pilotUserIds': ['other'] });
    await expect((svc as any).assertEnabled('u1', 'READ')).rejects.toMatchObject({ response: { code: 'VOICE_EMR_NOT_PILOT' } });
  });

  it('COMMAND(오더) 는 order.enabled OFF 면 차단', async () => {
    const { svc } = svcWith(ON);
    await expect((svc as any).assertEnabled('u1', 'COMMAND')).rejects.toMatchObject({ response: { code: 'VOICE_ORDER_OFF' } });
  });

  it('READ 는 기본 개방(통과)', async () => {
    const { svc } = svcWith(ON);
    await expect((svc as any).assertEnabled('u1', 'READ')).resolves.toBeUndefined();
  });

  it('pilotUserIds=["*"] 는 전원 통과', async () => {
    const { svc } = svcWith({ ...ON, 'voiceEmr.pilotUserIds': ['*'] });
    await expect((svc as any).assertEnabled('anyone', 'READ')).resolves.toBeUndefined();
  });
});

describe('성문 등록 — 생체 동의 게이트·표본 방어', () => {
  it('동의 없으면 표본 수신 거부(BIOMETRIC_CONSENT_REQUIRED)', async () => {
    const prisma: any = { voiceUserProfile: { upsert: vi.fn().mockResolvedValue({ userId: 'u1', biometricConsentAt: null, voiceprintSampleCount: 0 }) } };
    const { svc } = svcWith(ON, prisma);
    await expect(svc.enrollSample('u1', new Uint8Array(40000), 16000)).rejects.toMatchObject({ response: { code: 'BIOMETRIC_CONSENT_REQUIRED' } });
  });

  it('동의 있어도 표본이 너무 짧으면 거부(SAMPLE_TOO_SHORT)', async () => {
    const prisma: any = { voiceUserProfile: { upsert: vi.fn().mockResolvedValue({ userId: 'u1', biometricConsentAt: new Date(), voiceprintSampleCount: 0 }) } };
    const { svc } = svcWith(ON, prisma);
    await expect(svc.enrollSample('u1', new Uint8Array(1000), 16000)).rejects.toMatchObject({ response: { code: 'SAMPLE_TOO_SHORT' } });
  });

  it('동의+충분 길이면 표본 수신·성문 전송·카운트 증가', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma: any = { voiceUserProfile: { upsert: vi.fn().mockResolvedValue({ userId: 'u1', biometricConsentAt: new Date(), voiceprintSampleCount: 1 }), update } };
    const { svc, stt } = svcWith(ON, prisma);
    const r = await svc.enrollSample('u1', new Uint8Array(40000), 16000);
    expect(stt.enrollSample).toHaveBeenCalled();
    expect(r.sampleCount).toBe(2);
    expect(update).toHaveBeenCalled();
  });

  it('완료는 최소 표본 미달 시 거부(ENROLL_INSUFFICIENT)', async () => {
    const prisma: any = { voiceUserProfile: { upsert: vi.fn().mockResolvedValue({ userId: 'u1', biometricConsentAt: new Date(), voiceprintSampleCount: 1 }) } };
    const { svc } = svcWith(ON, prisma);
    await expect(svc.completeEnroll('u1')).rejects.toMatchObject({ response: { code: 'ENROLL_INSUFFICIENT' } });
  });

  it('철회는 성문 삭제 + 동의/표본 파기', async () => {
    const upsert = vi.fn().mockResolvedValue({ userId: 'u1', voiceprintStatus: 'none', biometricConsentAt: null, voiceprintSampleCount: 0 });
    const prisma: any = { voiceUserProfile: { findUnique: vi.fn().mockResolvedValue({ userId: 'u1', voiceprintRef: 'u1', voiceprintSampleCount: 3 }), upsert } };
    const { svc, stt } = svcWith(ON, prisma);
    await svc.revokeEnroll('u1');
    expect(stt.deleteSpeaker).toHaveBeenCalledWith('u1');
    const updateArg = upsert.mock.calls[0][0].update;
    expect(updateArg).toMatchObject({ voiceprintStatus: 'none', voiceprintSampleCount: 0, biometricConsentAt: null });
  });
});
