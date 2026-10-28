import { describe, it, expect, vi } from 'vitest';
import { AmbientScribeService } from '../../src/modules/scribe/ambient.service';

/**
 * 앰비언트 대화 스트림 P0 — 게이트·소유·동의·멱등 계약 회귀.
 * 기획: docs/01-plan/features/voice-emr-ambient-conversation.plan.md §7·§8
 */
function svcWith(cfg: Record<string, unknown>, prisma: any = {}) {
  const config: any = { get: vi.fn((k: string) => Promise.resolve(cfg[k])) };
  return { svc: new AmbientScribeService(prisma, config), prisma };
}
const ON = { 'voiceEmr.ambient.enabled': true, 'voiceEmr.pilotUserIds': [] };
const ENC = { id: 'e1', patientId: 'p1', doctorId: 'doc1' };
const SESSION = { id: 's1', doctorId: 'doc1', patientId: 'p1', encounterId: 'e1', status: 'RECORDING', source: 'AMBIENT' };

describe('게이트·동의', () => {
  it('ambient.enabled OFF 면 차단(AMBIENT_DISABLED)', async () => {
    const { svc } = svcWith({ 'voiceEmr.ambient.enabled': false });
    await expect(svc.startSession('e1', 'doc1')).rejects.toMatchObject({ response: { code: 'AMBIENT_DISABLED' } });
  });

  it('파일럿 한정 목록에 없으면 차단', async () => {
    const { svc } = svcWith({ ...ON, 'voiceEmr.pilotUserIds': ['other'] });
    await expect(svc.startSession('e1', 'doc1')).rejects.toMatchObject({ response: { code: 'AMBIENT_NOT_PILOT' } });
  });

  it('담당의 아니면 차단(IDOR)', async () => {
    const prisma: any = { encounter: { findUnique: vi.fn().mockResolvedValue(ENC) } };
    const { svc } = svcWith(ON, prisma);
    await expect(svc.startSession('e1', 'intruder')).rejects.toMatchObject({ response: { code: 'AMBIENT_NOT_OWNER' } });
  });

  it('RECORDING 동의 없으면 400(RECORDING_CONSENT_REQUIRED)', async () => {
    const prisma: any = {
      encounter: { findUnique: vi.fn().mockResolvedValue(ENC) },
      consentForm: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const { svc } = svcWith(ON, prisma);
    await expect(svc.startSession('e1', 'doc1')).rejects.toMatchObject({ response: { code: 'RECORDING_CONSENT_REQUIRED' } });
  });

  it('동의 있으면 source=AMBIENT 세션 생성 + 환자 신원(G3) 동봉', async () => {
    const create = vi.fn().mockResolvedValue({ id: 's1', encounterId: 'e1', patientId: 'p1', status: 'RECORDING', createdAt: new Date() });
    const prisma: any = {
      encounter: { findUnique: vi.fn().mockResolvedValue(ENC) },
      consentForm: { findFirst: vi.fn().mockResolvedValue({ id: 'c1' }) },
      scribeSession: { create },
      patient: { findUnique: vi.fn().mockResolvedValue({ familyName: '강', givenName: '미경', mrn: 'P2026-1370' }) },
    };
    const { svc } = svcWith(ON, prisma);
    const r = await svc.startSession('e1', 'doc1');
    expect(create.mock.calls[0][0].data).toMatchObject({ source: 'AMBIENT', consentId: 'c1' });
    expect(r.patient).toMatchObject({ name: '강미경', mrn: 'P2026-1370' });
  });
});

describe('발화 저장·수정', () => {
  const base = (over: any = {}) => ({
    scribeSession: { findUnique: vi.fn().mockResolvedValue(SESSION) },
    ...over,
  });

  it('발화 upsert 멱등 + 규칙 NER 동봉', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const { svc } = svcWith(ON, base({ voiceUtterance: { upsert } }));
    const r = await svc.addUtterance('s1', 'doc1', { seq: 3, text: '삼일 전부터 기침이 심하고 열이 나요' } as any);
    expect(upsert.mock.calls[0][0].where).toEqual({ sessionId_seq: { sessionId: 's1', seq: 3 } });
    expect(r.entities.symptoms.length).toBeGreaterThan(0);
  });

  it('빈 발화는 거부', async () => {
    const { svc } = svcWith(ON, base({ voiceUtterance: { upsert: vi.fn() } }));
    await expect(svc.addUtterance('s1', 'doc1', { seq: 0, text: '   ' } as any)).rejects.toMatchObject({ response: { code: 'AMBIENT_EMPTY_TEXT' } });
  });

  it('세션 시작 후 마스터 OFF 면 발화 저장 차단(킬스위치·프라이버시 — 녹음 동의 철회 대응)', async () => {
    const upsert = vi.fn();
    const { svc } = svcWith({ ...ON, 'voiceEmr.ambient.enabled': false }, base({ voiceUtterance: { upsert } }));
    await expect(svc.addUtterance('s1', 'doc1', { seq: 0, text: '기침이 나요' } as any))
      .rejects.toMatchObject({ response: { code: 'AMBIENT_DISABLED' } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('종료된 세션에는 발화 저장 불가', async () => {
    const prisma = base();
    prisma.scribeSession.findUnique = vi.fn().mockResolvedValue({ ...SESSION, status: 'TRANSCRIBED' });
    const { svc } = svcWith(ON, prisma);
    await expect(svc.addUtterance('s1', 'doc1', { seq: 0, text: 'x' } as any)).rejects.toMatchObject({ response: { code: 'AMBIENT_SESSION_CLOSED' } });
  });

  it('타인 세션 접근 차단', async () => {
    const { svc } = svcWith(ON, base());
    await expect(svc.getSession('s1', 'intruder')).rejects.toMatchObject({ response: { code: 'AMBIENT_NOT_OWNER' } });
  });

  it('화자 수동 토글 시 speakerSource=MANUAL 승격·원문 보존(editedText)', async () => {
    const update = vi.fn().mockResolvedValue({ seq: 1, text: '원문', editedText: '수정본', speaker: 'PATIENT', speakerSource: 'MANUAL', deleted: false });
    const prisma = base({ voiceUtterance: { findUnique: vi.fn().mockResolvedValue({ seq: 1 }), update } });
    const { svc } = svcWith(ON, prisma);
    const r = await svc.patchUtterance('s1', 1, 'doc1', { text: '수정본', speaker: 'PATIENT' } as any);
    expect(update.mock.calls[0][0].data).toMatchObject({ editedText: '수정본', speaker: 'PATIENT', speakerSource: 'MANUAL' });
    expect(r.entities).not.toBeNull(); // 수정본 기준 NER 재계산
  });
});

describe('종료 — transcript 스냅샷', () => {
  it('삭제 제외 발화를 화자 세그먼트로 고정·상태 TRANSCRIBED·dropped 합산', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma: any = {
      scribeSession: { findUnique: vi.fn().mockResolvedValue(SESSION), update },
      voiceUtterance: {
        findMany: vi.fn().mockResolvedValue([
          { seq: 0, text: '어디가 불편하세요', editedText: null, speaker: 'DOCTOR', droppedSec: null },
          { seq: 1, text: '기침이 나요', editedText: '기침이 심해요', speaker: 'PATIENT', droppedSec: 2.1 },
        ]),
      },
    };
    const { svc } = svcWith(ON, prisma);
    const r = await svc.closeSession('s1', 'doc1');
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('TRANSCRIBED');
    expect(data.transcript[1]).toMatchObject({ speaker: 'PATIENT', text: '기침이 심해요', droppedSec: 2.1 }); // 수정본 우선
    expect(r).toMatchObject({ utteranceCount: 2, droppedTotal: 2.1 });
  });
});
