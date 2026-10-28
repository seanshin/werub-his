import { describe, it, expect, vi } from 'vitest';
import { VoiceEmrService } from '../../src/modules/voice-emr/voice-emr.service';

/**
 * 구술(dictate) 게이트 — **발화마다** 본다(기획서 voice-emr-ambient-conversation §13.2 P0-1 · §13.4 D1 · 2026-09-22).
 *
 * 🔴 무엇이 틀려 있었나: `voiceEmr.dictate.enabled` 는 `assertEnabled(mode=DICTATE)` 에서만 읽혔다 — 세션을 DICTATE 로
 *    **시작할 때만**. FE 는 세션을 READ 로 시작했고, 파서는 규칙에 안 걸린 발화(잡담·환자의 말·의문형)를 전부 DICTATE 로
 *    폴백한다. 그래서 운영에서 게이트가 OFF 인데 dictate outcome 이 게이트를 한 번도 지나지 않고 화면으로 나갔고,
 *    화면은 그것을 확인 없이 S 에 덮어썼다. 이 경로를 보는 테스트는 **없었다**.
 *
 * 🔴 아래 outcome 모양은 손으로 짓지 않았다 — `processUtterance('오늘 날씨가 좋네요', …)` 실제 출력을 그대로 옮겼다:
 *    `[{"kind":"dictate","patient":{…},"text":"오늘 날씨가 좋네요","needsConfirm":true}]` · READ 발화는
 *    `[{"kind":"read","target":"lab"}]` · 저신뢰는 `[{"kind":"hold","reason":"low_confidence"}]`.
 *
 * 재주입 역검증(각각 주입 성공을 먼저 확인):
 *   · `parse()` 의 `this.gateDictate(s.mode, …)` 래핑을 벗기면 ①②가 실패한다.
 *   · `gateDictate` 의 `mode === VoiceMode.DICTATE &&` 를 지우면 ①만 실패한다(②는 config 로 여전히 막힌다).
 *   · `confirm()` 의 dictate 분기를 지우면 ⑤가 실패한다.
 */
const PATIENT = { familyName: '홍', givenName: '길동', mrn: '00012345', gender: 'MALE', dateOfBirth: null };

function build(sessionMode: 'READ' | 'DICTATE' | 'COMMAND', cfg: Record<string, unknown>) {
  const merged: Record<string, unknown> = { 'voiceEmr.enabled': true, ...cfg };
  const logCreate = vi.fn().mockResolvedValue({});
  const prisma: any = {
    voiceCommandSession: { findUnique: vi.fn().mockResolvedValue({ id: 's1', doctorId: 'doc1', patientId: 'p1', encounterId: 'e1', mode: sessionMode, status: 'ACTIVE' }) },
    voiceCustomPhrase: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({}) },
    voiceCommandLog: { create: logCreate, findFirst: vi.fn().mockResolvedValue(null) },
    patient: { findUnique: vi.fn().mockResolvedValue(PATIENT) },
  };
  const config: any = { get: vi.fn((k: string) => Promise.resolve(merged[k])) };
  const audit: any = { log: vi.fn().mockResolvedValue(undefined) };
  const svc = new VoiceEmrService(prisma, config, audit, {} as never, {} as never);
  return { svc, config, logCreate };
}

const DICTATE_UTTERANCE = '오늘 날씨가 좋네요'; // 어떤 규칙에도 안 걸린다 → 파서 DICTATE 폴백
const READ_UTTERANCE = '지난 검사 결과 보여줘';

describe('parse() — 구술 outcome 은 세션 mode·게이트를 발화마다 지난다', () => {
  it('① 🔴 READ 세션의 구술은 hold(DICTATE_OFF) — 게이트가 켜져 있어도 mode 가 아니면 쓰지 않는다', async () => {
    const { svc, logCreate } = build('READ', { 'voiceEmr.dictate.enabled': true });
    const { outcomes } = await svc.parse('doc1', 's1', { transcript: DICTATE_UTTERANCE });
    expect(outcomes).toEqual([{ kind: 'hold', reason: 'DICTATE_OFF' }]);
    // 로그에도 **바뀐 뒤**의 outcome 이 남는다(화면이 받은 것과 원장이 다르면 원장이 거짓이 된다)
    expect(logCreate.mock.calls[0][0].data.slots).toEqual([{ kind: 'hold', reason: 'DICTATE_OFF' }]);
  });

  it('② 🔴 DICTATE 세션이라도 voiceEmr.dictate.enabled OFF 면 hold(DICTATE_OFF)', async () => {
    const { svc } = build('DICTATE', { 'voiceEmr.dictate.enabled': false });
    const { outcomes } = await svc.parse('doc1', 's1', { transcript: DICTATE_UTTERANCE });
    expect(outcomes).toEqual([{ kind: 'hold', reason: 'DICTATE_OFF' }]);
  });

  it('②-b 설정 조회 실패는 닫는 쪽(hold)으로 접는다 — 실패를 "켜짐"으로 번역하지 않는다', async () => {
    const { svc, config } = build('DICTATE', {});
    config.get.mockImplementation((k: string) => (k === 'voiceEmr.dictate.enabled' ? Promise.reject(new Error('config down')) : Promise.resolve(undefined)));
    const { outcomes } = await svc.parse('doc1', 's1', { transcript: DICTATE_UTTERANCE });
    expect(outcomes).toEqual([{ kind: 'hold', reason: 'DICTATE_OFF' }]);
  });

  it('③ DICTATE 세션 + 게이트 ON 이면 구술이 환자 신원·needsConfirm 을 달고 그대로 나간다(확인 카드 경로)', async () => {
    const { svc } = build('DICTATE', { 'voiceEmr.dictate.enabled': true });
    const { outcomes } = await svc.parse('doc1', 's1', { transcript: DICTATE_UTTERANCE });
    expect(outcomes).toEqual([{
      kind: 'dictate',
      patient: { name: '홍길동', mrn: '00012345', sexAge: '남' },
      text: DICTATE_UTTERANCE,
      needsConfirm: true,
    }]);
  });

  it('④ 대조군 — 다른 outcome(read)은 READ 세션·게이트 OFF 에서도 건드리지 않는다 · 구술이 없으면 게이트 설정을 읽지도 않는다', async () => {
    const { svc, config } = build('READ', { 'voiceEmr.dictate.enabled': false });
    const { outcomes } = await svc.parse('doc1', 's1', { transcript: READ_UTTERANCE });
    expect(outcomes).toEqual([{ kind: 'read', target: 'lab' }]);
    expect(config.get.mock.calls.map((c: unknown[]) => c[0])).not.toContain('voiceEmr.dictate.enabled');
  });

  it('④-b 저신뢰 hold 의 사유는 low_confidence 그대로 — DICTATE_OFF 로 바꿔 말하지 않는다', async () => {
    const { svc } = build('READ', { 'voiceEmr.dictate.enabled': false });
    const { outcomes } = await svc.parse('doc1', 's1', { transcript: DICTATE_UTTERANCE, confidence: 0.3 });
    expect(outcomes).toEqual([{ kind: 'hold', reason: 'low_confidence' }]);
  });
});

describe('confirm() — 구술 확정도 같은 게이트를 다시 본다(확정은 독립 EP)', () => {
  const slots = { kind: 'dictate', text: DICTATE_UTTERANCE, field: 'subjective' };

  it('⑤ 🔴 READ 세션의 dictate confirm 은 403 VOICE_DICTATE_OFF — 로그·감사도 남기지 않는다', async () => {
    const { svc, logCreate } = build('READ', { 'voiceEmr.dictate.enabled': true });
    await expect(svc.confirm('doc1', 's1', { intent: 'dictate', slots }))
      .rejects.toMatchObject({ response: { code: 'VOICE_DICTATE_OFF' } });
    expect(logCreate).not.toHaveBeenCalled();
  });

  it('⑤-b DICTATE 세션 + 게이트 OFF 도 403', async () => {
    const { svc } = build('DICTATE', { 'voiceEmr.dictate.enabled': false });
    await expect(svc.confirm('doc1', 's1', { intent: 'dictate', slots }))
      .rejects.toMatchObject({ response: { code: 'VOICE_DICTATE_OFF' } });
  });

  it('⑥ DICTATE 세션 + 게이트 ON 이면 ok — 서버는 쓰지 않는다(written·handoff 없음 · SOAP 는 화면 append)', async () => {
    const { svc, logCreate } = build('DICTATE', { 'voiceEmr.dictate.enabled': true });
    const r = await svc.confirm('doc1', 's1', { intent: 'dictate', slots, resultKind: 'dictate_draft' });
    expect(r).toEqual({ ok: true });
    expect(logCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ intent: 'dictate', confirmedByUser: true }) }));
  });
});
