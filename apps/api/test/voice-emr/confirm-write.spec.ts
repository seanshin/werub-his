import { describe, it, expect, vi } from 'vitest';
import { VoiceEmrService } from '../../src/modules/voice-emr/voice-emr.service';

/**
 * 음성 확정 → 실 EMR 쓰기 계약(2026-07-30 배선).
 * 불변: ①게이트 OFF 면 쓰기 불가 ②활력은 정본(VitalsService) 경유 ③오더는 서버가 직접 만들지 않고
 *       정본 CPOE EP 로 handoff(step-up·DUR·역할 가드 우회 금지) ④확정은 항상 로그+감사.
 */
const SESSION = { id: 's1', doctorId: 'doc1', patientId: 'p1', encounterId: 'e1', mode: 'READ', status: 'ACTIVE' };

function build(cfg: Record<string, unknown> = {}) {
  const merged: Record<string, unknown> = { 'voiceEmr.enabled': true, ...cfg }; // 마스터는 기본 ON — 개별 게이트 검증에 집중
  const prisma: any = {
    voiceCommandSession: { findUnique: vi.fn().mockResolvedValue(SESSION) },
    voiceCommandLog: { create: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue(null) },
  };
  const config: any = { get: vi.fn((k: string) => Promise.resolve(merged[k])) };
  const audit: any = { log: vi.fn().mockResolvedValue(undefined) };
  // 🔴 2026-08-20 계약 변경: `record()` 는 행과 **수집 판정**을 함께 돌려준다
  //    (`{ vitals, ingest }`). 저장되지 않은 경우를 `null` 하나로 말하지 않기 위해서다.
  const vitals: any = {
    record: vi.fn().mockResolvedValue({
      vitals: { id: 'v9' },
      ingest: { status: 'STORED', pendingReason: null, duplicateOfId: null, timeFlags: [], dedupeChecked: true, measuredAt: new Date() },
    }),
  };
  const svc = new VoiceEmrService(prisma, config, audit, {} as never, {} as never, vitals);
  return { svc, prisma, vitals, audit };
}

describe('T1 활력 — 정본 쓰기', () => {
  it('write.enabled OFF 면 차단(VOICE_WRITE_OFF)', async () => {
    const { svc, vitals } = build({ 'voiceEmr.write.enabled': false });
    await expect(svc.confirm('doc1', 's1', { intent: 'vital', slots: { metric: 'BP', values: [130, 85] } }))
      .rejects.toMatchObject({ response: { code: 'VOICE_WRITE_OFF' } });
    expect(vitals.record).not.toHaveBeenCalled();
  });

  it('ON 이면 활력 정본(VitalsService.record)으로 기록 — 환자·진료 문맥 결속', async () => {
    const { svc, vitals } = build({ 'voiceEmr.write.enabled': true });
    const r = await svc.confirm('doc1', 's1', { intent: 'vital', slots: { metric: 'BP', values: [130, 85] } });
    expect(vitals.record).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'p1', encounterId: 'e1', systolicBp: 130, diastolicBp: 85 }),
      'doc1',
    );
    expect(r).toMatchObject({ ok: true, written: { kind: 'VITALS', ref: 'v9' } });
  });

  it('metric 별 필드 매핑(HR·TEMP·SPO2·RR)', async () => {
    for (const [metric, values, expected] of [
      ['HR', [88], { heartRate: 88 }],
      ['TEMP', [38.2], { temperature: 38.2 }],
      ['SPO2', [97], { spo2: 97 }],
      ['RR', [18], { respiratoryRate: 18 }],
    ] as [string, number[], Record<string, number>][]) {
      const { svc, vitals } = build({ 'voiceEmr.write.enabled': true });
      await svc.confirm('doc1', 's1', { intent: 'vital', slots: { metric, values } });
      expect(vitals.record.mock.calls[0][0]).toMatchObject(expected);
    }
  });

  it('혈압인데 값이 하나면 거부(수축/이완 미확정 상태로 기록 금지)', async () => {
    const { svc } = build({ 'voiceEmr.write.enabled': true });
    await expect(svc.confirm('doc1', 's1', { intent: 'vital', slots: { metric: 'BP', values: [130] } }))
      .rejects.toMatchObject({ response: { code: 'VOICE_VITAL_UNSUPPORTED' } });
  });

  it('혈당(BST)은 정본에 컬럼이 없어 미지원 — 조용히 버리지 않고 명시 거부', async () => {
    const { svc } = build({ 'voiceEmr.write.enabled': true });
    await expect(svc.confirm('doc1', 's1', { intent: 'vital', slots: { metric: 'BST', values: [146] } }))
      .rejects.toMatchObject({ response: { code: 'VOICE_VITAL_UNSUPPORTED' } });
  });
});

describe('T3 오더 — 정본 EP 위임(우회 금지)', () => {
  it('order.enabled OFF 면 차단', async () => {
    const { svc } = build({ 'voiceEmr.order.enabled': false });
    await expect(svc.confirm('doc1', 's1', { intent: 'order-rx', slots: {} }))
      .rejects.toMatchObject({ response: { code: 'VOICE_ORDER_OFF' } });
  });

  it('ON 이면 서버가 처방을 만들지 않고 정본 CPOE EP handoff 를 반환 — 카드의 실제 오더를 draft 로 실어보냄', async () => {
    const { svc } = build({ 'voiceEmr.order.enabled': true });
    // 확인 카드는 selectedCode·dose·freq 를 쓴다(과거 버그: 서버가 slots.code/draft 만 읽어 payload 가 늘 비었음)
    const r: any = await svc.confirm('doc1', 's1', { intent: 'order-rx', slots: { selectedCode: 'A1', dose: 500, unit: 'mg', freq: 'TID' } });
    expect(r.handoff).toMatchObject({ ep: '/api/v1/encounters/e1/prescriptions', method: 'POST' });
    expect(r.handoff.payload).toMatchObject({ type: 'MEDICATION', code: 'A1', dosage: '500', doseUnit: 'mg', frequency: 'TID' });
    expect(r.written).toBeUndefined(); // 서버 직접 생성 금지
  });

  it('검사는 선택된 검사 목록을, 영상은 modality·부위를 draft 로 전달', async () => {
    const lab: any = await build({ 'voiceEmr.order.enabled': true }).svc.confirm('doc1', 's1', { intent: 'order-lab', slots: { labs: [{ term: 'CBC', selectedCode: 'L01' }, { term: 'CRP' }] } });
    expect(lab.handoff.payload.type).toBe('LAB');
    expect(lab.handoff.payload.labs).toEqual([{ code: 'L01', term: 'CBC' }, { code: null, term: 'CRP' }]);
    const img: any = await build({ 'voiceEmr.order.enabled': true }).svc.confirm('doc1', 's1', { intent: 'order-imaging', slots: { modality: 'CT', bodyPart: 'CHEST' } });
    expect(img.handoff.payload).toMatchObject({ type: 'IMAGING', modality: 'CT', bodyPart: 'CHEST' });
  });

  it('진료 문맥이 없으면 오더 불가', async () => {
    const { svc, prisma } = build({ 'voiceEmr.order.enabled': true });
    prisma.voiceCommandSession.findUnique.mockResolvedValue({ ...SESSION, encounterId: null });
    await expect(svc.confirm('doc1', 's1', { intent: 'order-rx', slots: {} }))
      .rejects.toMatchObject({ response: { code: 'VOICE_ORDER_NO_ENCOUNTER' } });
  });
});

describe('공통 — 소유·감사', () => {
  it('타인 세션 확정 차단(IDOR)', async () => {
    const { svc } = build({ 'voiceEmr.write.enabled': true });
    await expect(svc.confirm('intruder', 's1', { intent: 'vital', slots: { metric: 'HR', values: [80] } }))
      .rejects.toMatchObject({ response: { code: 'NOT_OWNER' } });
  });

  it('확정은 로그+감사에 기록되고 쓰기 참조를 남긴다', async () => {
    const { svc, prisma, audit } = build({ 'voiceEmr.write.enabled': true });
    await svc.confirm('doc1', 's1', { intent: 'vital', slots: { metric: 'HR', values: [88] } });
    expect(prisma.voiceCommandLog.create.mock.calls[0][0].data).toMatchObject({ confirmedByUser: true, resultKind: 'VITALS', resultRef: 'v9' });
    expect(audit.log).toHaveBeenCalled();
  });

  it('조회(read) 등 쓰기 아닌 확정은 게이트 없이 로그만', async () => {
    const { svc, vitals, prisma } = build({});
    const r = await svc.confirm('doc1', 's1', { intent: 'read', slots: { target: 'lab' } });
    expect(r).toMatchObject({ ok: true });
    expect(vitals.record).not.toHaveBeenCalled();
    expect(prisma.voiceCommandLog.create).toHaveBeenCalled();
  });
});

describe('confirm 하드닝 — 마스터 킬스위치·세션 상태·멱등', () => {
  it('마스터 OFF 면 write.enabled 가 켜져 있어도 쓰기 차단(비상 정지 우회 봉합)', async () => {
    const { svc, vitals } = build({ 'voiceEmr.enabled': false, 'voiceEmr.write.enabled': true });
    await expect(svc.confirm('doc1', 's1', { intent: 'vital', slots: { metric: 'HR', values: [80] } }))
      .rejects.toMatchObject({ response: { code: 'VOICE_EMR_DISABLED' } });
    expect(vitals.record).not.toHaveBeenCalled();
  });

  it('파일럿 목록에서 제외된 사용자는 확정 불가(세션 시작 후 제외돼도 재확인)', async () => {
    const { svc, vitals } = build({ 'voiceEmr.write.enabled': true, 'voiceEmr.pilotUserIds': ['other'] });
    await expect(svc.confirm('doc1', 's1', { intent: 'vital', slots: { metric: 'HR', values: [80] } }))
      .rejects.toMatchObject({ response: { code: 'VOICE_EMR_NOT_PILOT' } });
    expect(vitals.record).not.toHaveBeenCalled();
  });

  it('종료(CLOSED)된 세션엔 기록 금지 — 지연/재생 확정 차단', async () => {
    const { svc, prisma, vitals } = build({ 'voiceEmr.write.enabled': true });
    prisma.voiceCommandSession.findUnique.mockResolvedValue({ ...SESSION, status: 'CLOSED' });
    await expect(svc.confirm('doc1', 's1', { intent: 'vital', slots: { metric: 'HR', values: [80] } }))
      .rejects.toMatchObject({ response: { code: 'VOICE_SESSION_NOT_ACTIVE' } });
    expect(vitals.record).not.toHaveBeenCalled();
  });

  it('같은 phraseId 재확정은 활력을 재기록하지 않고 기존 참조를 멱등 반환(더블탭 방어)', async () => {
    const { svc, prisma, vitals } = build({ 'voiceEmr.write.enabled': true });
    prisma.voiceCommandLog.findFirst.mockResolvedValue({ resultRef: 'v-prev' });
    const r: any = await svc.confirm('doc1', 's1', { intent: 'vital', slots: { metric: 'HR', values: [80] }, phraseId: 'ph1' });
    expect(vitals.record).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, idempotent: true, written: { kind: 'VITALS', ref: 'v-prev' } });
  });

  it('phraseId 최초 확정은 정상 기록(멱등 조회가 없으면 통과)', async () => {
    const { svc, vitals } = build({ 'voiceEmr.write.enabled': true });
    const r: any = await svc.confirm('doc1', 's1', { intent: 'vital', slots: { metric: 'HR', values: [80] }, phraseId: 'ph1' });
    expect(vitals.record).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, written: { kind: 'VITALS', ref: 'v9' } });
  });
});
