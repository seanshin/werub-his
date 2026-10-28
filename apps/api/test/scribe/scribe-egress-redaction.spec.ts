import { describe, it, expect, vi } from 'vitest';
import { AmbientScribeService } from '../../src/modules/scribe/ambient.service';
import { ScribeService } from '../../src/modules/scribe/scribe.service';
import { loadEgressNames, EgressNamesUnavailableError } from '../../src/modules/scribe/scribe-egress-names';
import { PATIENT_NAME_PLACEHOLDER, STAFF_NAME_PLACEHOLDER, redactForAiEgress } from '../../src/common/util/ai-phi-redact';

/**
 * 🔴 D5 — 진료 대화 원문이 **비식별 없이** AI 서버로 나가던 결함(§13.2 P0-3)의 동작 가드.
 *  ① AI 로 나가는 conversation 에 환자·의사 실명·주민번호가 없다(플레이스홀더로 치환)
 *  ② 치환 건수가 응답 `redacted:{names,ids}` 로 돌아온다(0 은 세었더니 0 · null 은 보내지 않았다)
 *  ③ 이름 조회가 실패하면 **보내지 않고** `aiSkipped='NAMES_UNAVAILABLE'` 로 말한다("이름 없음"으로 접어 실명을 보내지 않는다)
 *  ④ AI 응답의 플레이스홀더는 서버 안에서 실명으로 되돌아온다(정본 표기 하나로)
 */
const PATIENT = { familyName: '강', givenName: '미경', koreanName: null, mrn: 'P2026-1370' };
const DOCTOR = { familyName: '박', givenName: '지훈' };
const SESSION = { id: 's1', doctorId: 'doc1', patientId: 'p1', encounterId: 'e1', status: 'TRANSCRIBED', source: 'AMBIENT' };
const UTTS = [
  { seq: 0, text: '강미경 님, 어디가 불편하세요? 박지훈입니다', editedText: null, speaker: 'DOCTOR', confidence: 0.9, droppedSec: null },
  { seq: 1, text: '미경이 사흘 전부터 기침이 나요. 주민번호는 900101-2345678 이에요', editedText: null, speaker: 'PATIENT', confidence: 0.9, droppedSec: null },
];

function ambientWith(over: { patient?: unknown; user?: unknown; autoRecord?: ReturnType<typeof vi.fn> }) {
  const autoRecord = over.autoRecord ?? vi.fn().mockResolvedValue({ soap: { subjective: `${PATIENT_NAME_PLACEHOLDER} 기침 호소` } });
  const prisma: any = {
    scribeSession: { findUnique: vi.fn().mockResolvedValue(SESSION) },
    voiceUtterance: { findMany: vi.fn().mockResolvedValue(UTTS) },
    patient: { findUnique: vi.fn().mockResolvedValue('patient' in over ? over.patient : PATIENT) },
    user: { findUnique: vi.fn().mockResolvedValue('user' in over ? over.user : DOCTOR) },
  };
  const cfg: Record<string, unknown> = { 'voiceEmr.ambient.enabled': true, 'voiceEmr.ambient.aiDraft.enabled': true, 'voiceEmr.ambient.confidenceFloor': 0.5 };
  const config: any = { get: vi.fn((k: string) => Promise.resolve(cfg[k])) };
  const svc = new AmbientScribeService(prisma, config, undefined, { autoRecord } as any);
  return { svc, autoRecord, prisma };
}

describe('앰비언트 analyze — AI 전송 전 비식별', () => {
  it('🔴 AI 로 나가는 대화에 환자·의사 실명·주민번호가 없다 · 응답에 치환 건수', async () => {
    const { svc, autoRecord } = ambientWith({});
    const r = await svc.analyze('s1', 'doc1');
    expect(autoRecord).toHaveBeenCalledTimes(1);
    const sent = autoRecord.mock.calls[0][0].conversation as string;
    expect(sent).not.toContain('강미경');
    expect(sent).not.toContain('미경');
    expect(sent).not.toContain('박지훈');
    expect(sent).not.toContain('900101-2345678');
    expect(sent).toContain(PATIENT_NAME_PLACEHOLDER);
    expect(sent).toContain(STAFF_NAME_PLACEHOLDER);
    expect(sent).toContain('[주민번호]');
    // 강미경 1 · 미경 1 · 박지훈 1 = 이름 3 · 주민번호 1
    expect(r.redacted).toEqual({ names: 3, ids: 1 });
    expect(r.aiSkipped).toBeNull();
    // ④ AI 가 돌려준 플레이스홀더는 실명으로
    const aiSug = r.suggestions.filter((s) => s.engine === 'AI');
    expect(aiSug.length).toBeGreaterThan(0);
    expect(aiSug[0].text).toContain('강미경');
    expect(aiSug[0].text).not.toContain(PATIENT_NAME_PLACEHOLDER);
  });

  it('🔴 환자 행을 못 찾으면 보내지 않는다 — redacted=null · aiSkipped=NAMES_UNAVAILABLE · 규칙 제안은 그대로', async () => {
    const { svc, autoRecord } = ambientWith({ patient: null });
    const r = await svc.analyze('s1', 'doc1');
    expect(autoRecord).not.toHaveBeenCalled();
    expect(r.redacted).toBeNull();
    expect(r.aiSkipped).toBe('NAMES_UNAVAILABLE');
    expect(r.engine).toBe('RULE');
    expect(r.suggestions.length).toBeGreaterThan(0);
  });

  it('의사 행을 못 찾아도 같다(둘 중 하나라도 모르면 안 보낸다)', async () => {
    const { svc, autoRecord } = ambientWith({ user: null });
    const r = await svc.analyze('s1', 'doc1');
    expect(autoRecord).not.toHaveBeenCalled();
    expect(r.aiSkipped).toBe('NAMES_UNAVAILABLE');
  });

  it('AI 호출이 실패하면 aiSkipped=AI_ERROR 로 말한다(조용히 규칙만 주지 않는다) — 치환 건수는 보낸 텍스트 기준', async () => {
    const { svc } = ambientWith({ autoRecord: vi.fn().mockRejectedValue(new Error('upstream 503')) });
    const r = await svc.analyze('s1', 'doc1');
    expect(r.aiSkipped).toBe('AI_ERROR');
    expect(r.redacted).toEqual({ names: 3, ids: 1 });
    expect(r.engine).toBe('RULE');
  });

  it('AI 경로가 꺼져 있으면 redacted=null(보내지 않았다 — 0 이 아니다)', async () => {
    const { svc, autoRecord } = ambientWith({});
    (svc as any).configRuntime.get = vi.fn((k: string) => Promise.resolve(k === 'voiceEmr.ambient.aiDraft.enabled' ? false : true));
    const r = await svc.analyze('s1', 'doc1');
    expect(autoRecord).not.toHaveBeenCalled();
    expect(r.redacted).toBeNull();
    expect(r.aiSkipped).toBeNull();
  });
});

describe('스크라이브 draft — AI 전송 전 비식별', () => {
  const ENC = { id: 'e1', patientId: 'p1', doctorId: 'doc1' };
  const SEGS = [{ role: 'DOCTOR', text: '강미경 님 어디가 불편하세요' }, { role: 'PATIENT', text: '두통이 있어요. 연락처 010-1234-5678' }];
  function make(over: { patient?: unknown; user?: unknown } = {}) {
    const autoRecord = vi.fn().mockResolvedValue({ soap: { subjective: `${PATIENT_NAME_PLACEHOLDER} 두통 호소` }, model_used: 'm' });
    const update = vi.fn().mockResolvedValue({});
    const prisma: any = {
      encounter: { findUnique: vi.fn().mockResolvedValue(ENC) },
      scribeSession: { findUnique: vi.fn().mockResolvedValue({ id: 's1', encounterId: 'e1', patientId: 'p1', doctorId: 'doc1', transcript: SEGS }), update },
      patient: { findUnique: vi.fn().mockResolvedValue('patient' in over ? over.patient : PATIENT) },
      user: { findUnique: vi.fn().mockResolvedValue('user' in over ? over.user : DOCTOR) },
    };
    const config: any = { get: vi.fn((k: string) => Promise.resolve(k === 'scribe.enabled' ? true : undefined)) };
    const svc = new ScribeService(prisma, {} as any, {} as any, config, undefined, { autoRecord } as any);
    return { svc, autoRecord, update };
  }

  it('🔴 실명·전화번호가 지워진 전사가 나가고, 초안에 redacted 건수가 실리며, 플레이스홀더는 되돌아온다', async () => {
    const { svc, autoRecord, update } = make();
    const r = (await svc.draft('e1', 's1', 'doc1')) as any;
    const sent = autoRecord.mock.calls[0][0].conversation as string;
    expect(sent).not.toContain('강미경');
    expect(sent).not.toContain('010-1234-5678');
    expect(sent).toContain(PATIENT_NAME_PLACEHOLDER);
    expect(r.redacted).toEqual({ names: 1, ids: 1 });
    expect(r.soap.subjective).toBe('강미경 두통 호소');
    expect(update.mock.calls[0][0].data.draftSnapshot.redacted).toEqual({ names: 1, ids: 1 });
  });

  it('🔴 이름을 못 찾으면 AI 를 부르지 않고 규칙 초안으로 저하 + aiSkipped 를 남긴다', async () => {
    const { svc, autoRecord, update } = make({ patient: null });
    const r = (await svc.draft('e1', 's1', 'doc1')) as any;
    expect(autoRecord).not.toHaveBeenCalled();
    expect(r.source).toBe('rule');
    expect(r.aiSkipped).toBe('NAMES_UNAVAILABLE');
    expect(update.mock.calls[0][0].data.aiPromptVersion).toBe('scribe-soap-rule-v1');
  });
});

describe('loadEgressNames — 표기 변형·실패 전파', () => {
  it('성명·띄어쓴 성명·이름만·한글 호칭·MRN 을 모으고 되돌릴 정본 표기를 준다', async () => {
    const prisma: any = {
      patient: { findUnique: vi.fn().mockResolvedValue({ familyName: 'Smith', givenName: 'John', koreanName: '스미스 존', mrn: 'M1' }) },
      user: { findUnique: vi.fn().mockResolvedValue({ familyName: '박', givenName: '지훈' }) },
    };
    const n = await loadEgressNames(prisma, { patientId: 'p', doctorId: 'd' });
    expect(n.patientNames).toEqual(['SmithJohn', 'Smith John', 'John', '스미스 존']);
    expect(n.staffNames).toEqual(['박지훈', '박 지훈', '지훈']);
    expect(n.recordNumbers).toEqual(['M1']);
    expect(n.rehydrateTo).toEqual({ patient: 'SmithJohn', staff: '박지훈' });
  });

  it('🔴 행이 없으면 던진다 — 빈 목록으로 접지 않는다', async () => {
    const prisma: any = {
      patient: { findUnique: vi.fn().mockResolvedValue(null) },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    await expect(loadEgressNames(prisma, { patientId: 'p', doctorId: 'd' })).rejects.toBeInstanceOf(EgressNamesUnavailableError);
    await expect(loadEgressNames(prisma, { patientId: 'p', doctorId: 'd' })).rejects.toMatchObject({ missing: ['patient', 'doctor'] });
  });
});

describe('정본 확장 — counts · rehydrateTo', () => {
  it('counts 는 실제 치환 수(긴 표기 먼저 — 이중 계수 없음) · identifiers 는 형식 기반', () => {
    const r = redactForAiEgress('강미경 님과 미경 씨, 010-1234-5678', { patientNames: ['미경', '강미경'] });
    expect(r.text).toBe(`${PATIENT_NAME_PLACEHOLDER} 님과 ${PATIENT_NAME_PLACEHOLDER} 씨, [전화번호]`);
    expect(r.counts).toEqual({ names: 2, identifiers: 1 });
  });

  it('여러 표기가 한 사람이면 rehydrateTo 로 되돌린다(없으면 종전 규칙 — 여럿이면 되돌리지 않는다)', () => {
    const many = redactForAiEgress('강미경', { patientNames: ['강미경', '미경'] });
    expect(many.rehydrate(`${PATIENT_NAME_PLACEHOLDER} 호소`)).toBe(`${PATIENT_NAME_PLACEHOLDER} 호소`);
    const explicit = redactForAiEgress('강미경', { patientNames: ['강미경', '미경'], rehydrateTo: { patient: '강미경' } });
    expect(explicit.rehydrate(`${PATIENT_NAME_PLACEHOLDER} 호소`)).toBe('강미경 호소');
  });
});
