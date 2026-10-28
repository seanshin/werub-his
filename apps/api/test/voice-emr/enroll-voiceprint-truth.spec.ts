import { describe, it, expect, vi } from 'vitest';
import { VoiceEmrService } from '../../src/modules/voice-emr/voice-emr.service';

/**
 * VoiceEMR 정직성 가드 (2026-08 W7 화면 실사용 점검)
 *
 * 🔴 운영 실측: voice_user_profiles 유일 행이 `status=enrolled, sample_count=4, voiceprint_ref IS NULL`.
 *    성문이 서버에 없는데 화면은 "● 등록됨 / 표본 4개로 등록 완료" 라고 말했다(P16).
 *    원인 3중: enrollSample fail-open 카운트 · completeEnroll 이 로컬 표본만 확인 ·
 *    getEnrollStatus 가 voiceprintRef 유무를 응답에 담지 않아 FE 가 알 방법이 없음.
 *  + pollDiarizeTest(_userId, jobId) 가 userId 를 버려 jobId 만 알면 타인 진료 대화 전문을 열람(IDOR).
 */
const ON = { 'voiceEmr.enabled': true, 'voiceEmr.pilotUserIds': [] as string[] };

function svcWith(cfg: Record<string, unknown>, prisma: any = {}, sttOverride: any = {}, scribeAi: any = {}) {
  const config: any = { get: vi.fn((k: string) => Promise.resolve(cfg[k])) };
  const audit: any = { log: vi.fn().mockResolvedValue(undefined) };
  const stt: any = {
    warm: vi.fn().mockResolvedValue(undefined),
    registerVocab: vi.fn().mockResolvedValue({}),
    sendChunk: vi.fn().mockResolvedValue({ text: '' }),
    enrollSample: vi.fn().mockResolvedValue({ ok: true, ref: 'spk-u1' }),
    deleteSpeaker: vi.fn().mockResolvedValue({ ok: true }),
    ...sttOverride,
  };
  return { svc: new VoiceEmrService(prisma, config, audit, stt, scribeAi), stt, audit, config };
}
const profile = (over: Record<string, unknown> = {}) => ({
  userId: 'u1', defaultMode: 'READ', pttEnabled: true, speakerGateEnabled: false, language: 'ko',
  biometricConsentAt: new Date(), biometricConsentVer: '2026-07-v1',
  voiceprintStatus: 'none', voiceprintSampleCount: 0, voiceprintRef: null, voiceprintEnrolledAt: null,
  ...over,
});

describe('성문 없는 "등록됨" 금지', () => {
  it('status=enrolled 인데 성문 참조가 없으면 등록됨이라 답하지 않는다', async () => {
    const prisma: any = { voiceUserProfile: { upsert: vi.fn().mockResolvedValue(profile({ voiceprintStatus: 'enrolled', voiceprintSampleCount: 4, voiceprintRef: null })) } };
    const { svc } = svcWith(ON, prisma);
    const st = await svc.getEnrollStatus('u1');
    expect(st.status).not.toBe('enrolled');
    expect(st.status).toBe('pending');
    expect(st.voiceprintPresent).toBe(false);
    expect(st.voiceprintMissing).toBe(true);
    expect(st.storedStatus).toBe('enrolled'); // 저장값은 숨기지 않는다(표시만 정정)
  });

  it('성문 참조가 있으면 등록됨 그대로', async () => {
    const prisma: any = { voiceUserProfile: { upsert: vi.fn().mockResolvedValue(profile({ voiceprintStatus: 'enrolled', voiceprintSampleCount: 4, voiceprintRef: 'spk-u1' })) } };
    const { svc } = svcWith(ON, prisma);
    const st = await svc.getEnrollStatus('u1');
    expect(st.status).toBe('enrolled');
    expect(st.voiceprintPresent).toBe(true);
    expect(st.voiceprintMissing).toBe(false);
  });

  it('성문 서버 미가용이면 표본 수를 올리지 않는다(fail-open 금지)', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma: any = { voiceUserProfile: { upsert: vi.fn().mockResolvedValue(profile({ voiceprintSampleCount: 2 })), update } };
    const { svc } = svcWith(ON, prisma, { enrollSample: vi.fn().mockResolvedValue({ ok: false, unavailable: true }) });
    const r = await svc.enrollSample('u1', new Uint8Array(40000), 16000);
    expect(r.accepted).toBe(false);
    expect(r.sampleCount).toBe(2); // 그대로
    expect(r.serverUnavailable).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it('표본이 충분해도 성문 참조가 없으면 완료 불가(ENROLL_NO_VOICEPRINT)', async () => {
    const prisma: any = { voiceUserProfile: { upsert: vi.fn().mockResolvedValue(profile({ voiceprintSampleCount: 4, voiceprintRef: null })) } };
    const { svc } = svcWith(ON, prisma);
    await expect(svc.completeEnroll('u1')).rejects.toMatchObject({ response: { code: 'ENROLL_NO_VOICEPRINT' } });
  });

  it('표본 + 성문 참조가 모두 있으면 완료된다', async () => {
    const update = vi.fn().mockResolvedValue(profile({ voiceprintStatus: 'enrolled', voiceprintSampleCount: 4, voiceprintRef: 'spk-u1', voiceprintEnrolledAt: new Date() }));
    const prisma: any = {
      voiceUserProfile: {
        upsert: vi.fn()
          .mockResolvedValueOnce(profile({ voiceprintSampleCount: 4, voiceprintRef: 'spk-u1' }))
          .mockResolvedValue(profile({ voiceprintStatus: 'enrolled', voiceprintSampleCount: 4, voiceprintRef: 'spk-u1' })),
        update,
      },
    };
    const { svc } = svcWith(ON, prisma);
    const st = await svc.completeEnroll('u1');
    expect(update).toHaveBeenCalled();
    expect(st.status).toBe('enrolled');
  });
});

describe('화자분리 잡 소유 바인딩(IDOR)', () => {
  const scribeAi = { pollJob: vi.fn().mockResolvedValue({ status: 'done', raw: {} }), parseTranscription: vi.fn().mockReturnValue({ segments: [], fullText: '', diarized: true }) };

  it('내 잡이 아니면 전문을 주지 않는다(404) — AI 서버 호출도 하지 않는다', async () => {
    scribeAi.pollJob.mockClear();
    const prisma: any = { auditLog: { findFirst: vi.fn().mockResolvedValue(null) } };
    const { svc } = svcWith(ON, prisma, {}, scribeAi);
    await expect(svc.pollDiarizeTest('u1', 'job-of-someone-else')).rejects.toMatchObject({ response: { code: 'DIARIZE_JOB_NOT_FOUND' } });
    expect(scribeAi.pollJob).not.toHaveBeenCalled();
  });

  it('제출 기록이 있는 본인 잡은 조회된다', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'a1' });
    const prisma: any = { auditLog: { findFirst } };
    const { svc } = svcWith(ON, prisma, {}, scribeAi);
    const r = await svc.pollDiarizeTest('u1', 'job-1');
    expect(r.jobId).toBe('job-1');
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ resourceType: 'VoiceDiarizeTest', resourceId: 'u1', userId: 'u1' });
  });
});

describe('개인 설정이 실제로 읽힌다', () => {
  it('mode 미지정이면 개인 기본 모드로 세션이 시작된다', async () => {
    const create = vi.fn().mockResolvedValue({ id: 's1' });
    const prisma: any = {
      voiceUserProfile: { findUnique: vi.fn().mockResolvedValue(profile({ defaultMode: 'DICTATE', language: 'en' })) },
      encounter: { findUnique: vi.fn().mockResolvedValue({ id: 'e1', patientId: 'p1', doctorId: 'u1' }) },
      voiceCommandSession: { create },
      patient: { findUnique: vi.fn().mockResolvedValue({ familyName: '홍', givenName: '길동', mrn: 'M1', gender: 'MALE', dateOfBirth: new Date('1990-01-01') }) },
      voiceCustomPhrase: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const { svc } = svcWith({ ...ON, 'voiceEmr.dictate.enabled': true }, prisma);
    const r = await svc.startSession('u1', { encounterId: 'e1' });
    expect(r.mode).toBe('DICTATE');
    expect(r.language).toBe('en');
    expect(create.mock.calls[0][0].data.mode).toBe('DICTATE');
  });

  it('세션 언어가 STT 청크의 lang 으로 전달된다', async () => {
    const prisma: any = {
      voiceUserProfile: { findUnique: vi.fn().mockResolvedValue(profile({ language: 'en' })) },
      encounter: { findUnique: vi.fn().mockResolvedValue({ id: 'e1', patientId: 'p1', doctorId: 'u1' }) },
      voiceCommandSession: { create: vi.fn().mockResolvedValue({ id: 's1' }) },
      patient: { findUnique: vi.fn().mockResolvedValue({ familyName: '홍', givenName: '길동', mrn: 'M1' }) },
      voiceCustomPhrase: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const { svc, stt } = svcWith(ON, prisma);
    await svc.startSession('u1', { encounterId: 'e1' });
    await svc.chunk('s1', new Uint8Array(10), 'final', 16000);
    expect(stt.sendChunk.mock.calls[0][0].lang).toBe('en');
  });

  it('적용된 맞춤 문구는 hitCount 가 올라간다(영구 0 금지)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma: any = {
      voiceCommandSession: { findUnique: vi.fn().mockResolvedValue({ id: 's1', doctorId: 'u1', patientId: 'p1', encounterId: 'e1', status: 'ACTIVE' }) },
      voiceCustomPhrase: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'ph1', type: 'HABIT', pattern: '혈압', action: { canonical: 'BP' }, enabled: true, priority: 100 },
          { id: 'ph2', type: 'HABIT', pattern: '체온', action: { canonical: 'BT' }, enabled: true, priority: 100 },
        ]),
        updateMany,
      },
      patient: { findUnique: vi.fn().mockResolvedValue({ familyName: '홍', givenName: '길동', mrn: 'M1' }) },
      voiceCommandLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const { svc } = svcWith(ON, prisma);
    await svc.parse('u1', 's1', { transcript: '혈압 120에 80' });
    await new Promise((r) => setTimeout(r, 0)); // fire-and-forget 계측 flush
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].where.id.in).toEqual(['ph1']); // 등장하지 않은 '체온'은 세지 않는다
  });
});

/**
 * 철회 ≠ 파기 (2026-09-27)
 *
 * 🔴 종전: `revokeEnroll` 이 `this.stt.deleteSpeaker(userId).catch(() => undefined)` 로 **반환값을 버렸다**
 *    (삭제 클라이언트는 던지지 않고 `{ok, unavailable}` 로 답한다 — `.catch` 는 아무것도 안 잡고 있었다).
 *    원격 성문이 남아 있어도 로컬 `voiceprintRef` 까지 지워서 화면은 '철회·삭제 완료'라 말하고
 *    참조가 사라져 재시도조차 불가했다. 개인정보보호법 §21 파기의무 경로에서 파기 못한 것을 파기했다고 말한 자리.
 */
function profileStore(initial: Record<string, unknown> = {}) {
  let row: any = profile(initial);
  return {
    findUnique: vi.fn().mockImplementation(() => Promise.resolve(row)),
    upsert: vi.fn().mockImplementation(({ update }: any) => { row = { ...row, ...(update ?? {}) }; return Promise.resolve(row); }),
    update: vi.fn().mockImplementation(({ data }: any) => { row = { ...row, ...(data ?? {}) }; return Promise.resolve(row); }),
    current: () => row,
  };
}
const ENROLLED = { voiceprintStatus: 'enrolled', voiceprintSampleCount: 4, voiceprintRef: 'spk-u1', voiceprintEnrolledAt: new Date(), speakerGateEnabled: true };

describe('등록 철회 — 원격 성문 파기를 3상태로 말한다', () => {
  it('성문 서버가 삭제를 거절하면 파기했다고 말하지 않고 참조를 보존한다(재시도 포인터)', async () => {
    const store = profileStore(ENROLLED);
    const { svc } = svcWith(ON, { voiceUserProfile: store }, { deleteSpeaker: vi.fn().mockResolvedValue({ ok: false }) });
    const st = await svc.revokeEnroll('u1');
    expect(st.remoteVoiceprintPurge).toBe('REMOTE_FAILED');
    expect(st.remotePurgePending).toBe(true);
    expect(store.current().voiceprintRef).toBe('spk-u1'); // 지우지 않는다 — 지우면 재시도 불가
    expect(store.current().voiceprintStatus).toBe('revoked');
    // 동의 철회는 원격 실패에 묶이지 않는다(사용자의 권리) — 게이트·표본·동의는 즉시 회수
    expect(store.current().speakerGateEnabled).toBe(false);
    expect(store.current().voiceprintSampleCount).toBe(0);
    expect(store.current().biometricConsentAt).toBeNull();
    expect(st.consented).toBe(false);
  });

  it('성문 서버에 물어보지 못한 것과 거절당한 것을 구분한다', async () => {
    const store = profileStore(ENROLLED);
    const { svc } = svcWith(ON, { voiceUserProfile: store }, { deleteSpeaker: vi.fn().mockResolvedValue({ ok: false, unavailable: true }) });
    const st = await svc.revokeEnroll('u1');
    expect(st.remoteVoiceprintPurge).toBe('REMOTE_UNAVAILABLE');
    expect(st.remotePurgePending).toBe(true);
  });

  it('대조군 — 삭제가 확인되면 파기 미완료라고 말하지 않는다', async () => {
    const store = profileStore(ENROLLED);
    const { svc } = svcWith(ON, { voiceUserProfile: store }, { deleteSpeaker: vi.fn().mockResolvedValue({ ok: true }) });
    const st = await svc.revokeEnroll('u1');
    expect(st.remoteVoiceprintPurge).toBe('PURGED');
    expect(st.remotePurgePending).toBe(false);
    expect(store.current().voiceprintRef).toBeNull();
    expect(store.current().voiceprintStatus).toBe('none');
  });

  it('지울 성문·표본이 없으면 삭제를 호출하지 않고 NOT_PRESENT — 실패로 말하지 않는다', async () => {
    const store = profileStore();
    const del = vi.fn().mockResolvedValue({ ok: true });
    const { svc } = svcWith(ON, { voiceUserProfile: store }, { deleteSpeaker: del });
    const st = await svc.revokeEnroll('u1');
    expect(del).not.toHaveBeenCalled();
    expect(st.remoteVoiceprintPurge).toBe('NOT_PRESENT');
    expect(st.remotePurgePending).toBe(false);
  });

  it('보존한 참조로 재시도가 실제로 원격 삭제를 다시 부른다', async () => {
    const store = profileStore(ENROLLED);
    const del = vi.fn().mockResolvedValueOnce({ ok: false, unavailable: true }).mockResolvedValueOnce({ ok: true });
    const { svc } = svcWith(ON, { voiceUserProfile: store }, { deleteSpeaker: del });
    await svc.revokeEnroll('u1');
    const again = await svc.revokeEnroll('u1'); // 같은 철회 EP 재호출 = 재시도
    expect(del).toHaveBeenCalledTimes(2);
    expect(again.remoteVoiceprintPurge).toBe('PURGED');
    expect(again.remotePurgePending).toBe(false);
    expect(store.current().voiceprintRef).toBeNull();
  });

  it('감사에 실제 파기 결과가 남는다(미파기를 파기로 적지 않는다)', async () => {
    const store = profileStore(ENROLLED);
    const { svc, audit } = svcWith(ON, { voiceUserProfile: store }, { deleteSpeaker: vi.fn().mockResolvedValue({ ok: false }) });
    await svc.revokeEnroll('u1');
    expect(audit.log.mock.calls[0][0].changes.revoke.new).toMatchObject({ remoteVoiceprintPurge: 'REMOTE_FAILED' });
  });
});
