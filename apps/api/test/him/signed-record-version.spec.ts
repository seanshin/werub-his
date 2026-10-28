/**
 * 서명본 보존·정정 이력(2026-10-03).
 *  🔴 종전: 서명된 진료기록·퇴원요약 정정(SIGNED→AMENDED)이 서명본을 제자리에서 덮어썼다 —
 *     정정 전 내용·원래 서명 시각·서명자가 사라지고 감사 로그엔 바뀐 필드 이름만 남았다(환자 차트에 정정 이력 화면도 없었다).
 *  · 정정 순간 직전 서명본(내용·서명 시각·서명자)을 **같은 트랜잭션**에 보존 · 정정한 사람 · 실제로 바뀐 항목만
 *  · 같은 값을 다시 보내면 정정이 아니다(서명본을 AMENDED 로 뒤집지 않는다)
 *  · 정정 이력: 보존본·미보존(보존 이전 정정)·간호 정정문·검사 수정을 출처별로 · 재서명 대기는 가장 최근 판에만
 *  · 보존본 열람은 그 환자 경로로만(다른 환자 id → 404) · 그 뒤 정정이 더 있으면 말한다
 * 재주입: 보존 호출·트랜잭션·실제 변경 판정·무변경 무동작·출처 분류·환자 대조를 되돌리면 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EncounterService, encounterChangedFields, ENCOUNTER_AMENDABLE_FIELDS } from '../../src/modules/encounter/encounter.service';
import { DischargeSummaryService, dischargeChangedFields } from '../../src/modules/discharge-summary/discharge-summary.service';
import { PatientMedicalRecordService } from '../../src/modules/him/patient-medical-record.service';

const SIGNED_AT = new Date('2026-09-01T02:00:00Z');
const dx = (id: string, type = 'PRIMARY') => ({ diagnosisCodeId: id, type, rank: 1, certainty: null, notes: null, diagnosisCode: { code: `C-${id}`, nameKo: `진단-${id}` } });
const signedEncounter = (over: Record<string, unknown> = {}) => ({
  id: 'e1', patientId: 'p1', status: 'SIGNED', signedAt: SIGNED_AT, signedBy: 'doc-1',
  subjective: '기침 3일', objective: 'T 38.2', assessment: '폐렴', plan: '항생제', pregnancyStatus: null,
  diagnoses: [dx('d1')], ...over,
});

function encounterSvc(existing: unknown) {
  const tx = {
    signedRecordVersion: { create: vi.fn(async () => ({ id: 'v1' })) },
    encounterDiagnosis: { deleteMany: vi.fn(async () => ({})) },
    encounter: { update: vi.fn(async (a: any) => ({ id: 'e1', ...a.data })) },
  };
  const prisma: any = {
    // 첫 조회 = 정정 판정용 기존 기록 · 그다음 = 무변경일 때 돌려줄 지금 기록
    encounter: { findUnique: vi.fn().mockResolvedValueOnce(existing).mockResolvedValue({ id: 'e1', current: true }) },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  const svc = new EncounterService(prisma, { emit: vi.fn() } as never);
  return { svc, prisma, tx };
}

describe('진료기록 정정 — 직전 서명본 보존', () => {
  it('🔴 서명본 정정: 같은 트랜잭션에 직전 서명본(내용·서명 시각·서명자) · 정정한 사람 · 실제로 바뀐 항목만 · AMENDED', async () => {
    const { svc, tx } = encounterSvc(signedEncounter());
    await svc.update('e1', { subjective: '기침 3일', assessment: '폐렴 의증 — 결핵 감별' } as never, 'doc-2');
    expect(tx.signedRecordVersion.create).toHaveBeenCalledTimes(1);
    const data = (tx.signedRecordVersion.create.mock.calls[0] as any)[0].data;
    expect(data).toMatchObject({ patientId: 'p1', recordType: 'ENCOUNTER', recordId: 'e1', signedAt: SIGNED_AT, signedBy: 'doc-1', supersededBy: 'doc-2' });
    expect(data.content).toMatchObject({ assessment: '폐렴', plan: '항생제', diagnoses: [{ code: 'C-d1', name: '진단-d1', type: 'PRIMARY' }] });
    expect(data.changedFields).toEqual(['assessment']); // subjective 는 같은 값 — 바뀐 항목이 아니다
    expect((tx.encounter.update.mock.calls[0] as any)[0].data.status).toBe('AMENDED');
    // 보존이 진료 쓰기보다 먼저(같은 트랜잭션)
    expect(tx.signedRecordVersion.create.mock.invocationCallOrder[0]).toBeLessThan(tx.encounter.update.mock.invocationCallOrder[0]);
  });

  it('🔴 같은 값을 다시 보내면 정정이 아니다 — 쓰지 않고 지금 기록을 돌려준다', async () => {
    const { svc, prisma, tx } = encounterSvc(signedEncounter());
    const r: any = await svc.update('e1', { subjective: '기침 3일', diagnoses: [{ diagnosisCodeId: 'd1', type: 'PRIMARY' }] } as never, 'doc-2');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.signedRecordVersion.create).not.toHaveBeenCalled();
    expect(r.current).toBe(true);
  });

  it('대조군 — 서명 전(DRAFT) 수정은 보존하지 않는다(정정이 아니다)', async () => {
    const { svc, tx } = encounterSvc(signedEncounter({ status: 'DRAFT', signedAt: null, signedBy: null }));
    await svc.update('e1', { assessment: '바뀜' } as never, 'doc-2');
    expect(tx.signedRecordVersion.create).not.toHaveBeenCalled();
    expect((tx.encounter.update.mock.calls[0] as any)[0].data.status).toBeUndefined();
  });

  it('상병 비교는 집합 — 순서만 바뀌면 그대로 · 구분이 바뀌면 바뀐 것', () => {
    const ex = { ...signedEncounter({ diagnoses: [dx('a'), dx('b', 'SECONDARY')] }) } as never;
    const n = (arr: Array<[string, string]>) => arr.map(([id, type]) => ({ diagnosisCodeId: id, type, certainty: null, notes: null }));
    expect(encounterChangedFields(ex, { diagnoses: [] }, n([['b', 'SECONDARY'], ['a', 'PRIMARY']]))).toEqual([]);
    expect(encounterChangedFields(ex, { diagnoses: [] }, n([['a', 'SECONDARY'], ['b', 'PRIMARY']]))).toEqual(['diagnoses']);
    expect(encounterChangedFields(ex, { plan: undefined }, undefined)).toEqual([]); // 보내지 않은 항목은 바뀌지 않은 것
  });
});

describe('퇴원요약 정정 — 직전 서명본 보존', () => {
  const signedDs = (over: Record<string, unknown> = {}) => ({
    id: 'ds1', admissionId: 'a1', status: 'SIGNED', signedAt: SIGNED_AT, signedBy: 'doc-1', createdAt: new Date(), updatedAt: new Date(),
    admitDate: new Date('2026-08-20T00:00:00Z'), dischargeDate: new Date('2026-08-30T00:00:00Z'),
    hospitalCourse: '호전', conditionAtDischarge: '안정', admission: { patientId: 'p1' }, ...over,
  });
  const make = (existing: unknown) => {
    const tx = { signedRecordVersion: { create: vi.fn(async () => ({})) }, dischargeSummary: { update: vi.fn(async (a: any) => a.data) } };
    const prisma: any = {
      dischargeSummary: { findUnique: vi.fn().mockResolvedValueOnce(existing).mockResolvedValue({ id: 'ds1', current: true }), update: vi.fn() },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    return { svc: new DischargeSummaryService(prisma, {} as never), prisma, tx };
  };

  it('🔴 서명본 정정: 보존(서명 시각·서명자·내용 — 식별자·상태는 빼고) · 바뀐 항목만 · AMENDED · 한 트랜잭션', async () => {
    const { svc, tx } = make(signedDs());
    await svc.update('a1', { hospitalCourse: '호전 후 재악화 없음', admitDate: '2026-08-20' } as never, 'doc-2');
    const data = (tx.signedRecordVersion.create.mock.calls[0] as any)[0].data;
    expect(data).toMatchObject({ patientId: 'p1', recordType: 'DISCHARGE_SUMMARY', recordId: 'ds1', signedAt: SIGNED_AT, signedBy: 'doc-1', supersededBy: 'doc-2', changedFields: ['hospitalCourse'] });
    expect(data.content).toMatchObject({ hospitalCourse: '호전', conditionAtDischarge: '안정' });
    expect(Object.keys(data.content)).not.toEqual(expect.arrayContaining(['id', 'status', 'signedAt', 'admission']));
    expect((tx.dischargeSummary.update.mock.calls[0] as any)[0].data.status).toBe('AMENDED');
  });

  it('같은 값(날짜 포함)을 다시 보내면 서명본을 뒤집지 않는다', async () => {
    const { svc, prisma } = make(signedDs());
    const r: any = await svc.update('a1', { hospitalCourse: '호전', dischargeDate: '2026-08-30' } as never, 'doc-2');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(r.current).toBe(true);
    expect(dischargeChangedFields({ followUpDate: new Date('2026-09-10T00:00:00Z') }, { followUpDate: new Date('2026-09-10') })).toEqual([]);
  });
});

describe('정정 이력 — 출처별', () => {
  const T = (d: string) => new Date(`2026-10-0${d}T01:00:00Z`);
  const prisma: any = {
    signedRecordVersion: {
      findMany: vi.fn(async () => [
        { id: 'v2', recordType: 'ENCOUNTER', recordId: 'e1', signedAt: T('2'), signedBy: 'doc-1', supersededAt: T('3'), supersededBy: 'doc-2', changedFields: ['plan'] },
        { id: 'v1', recordType: 'ENCOUNTER', recordId: 'e1', signedAt: T('1'), signedBy: 'doc-1', supersededAt: T('2'), supersededBy: 'doc-1', changedFields: ['assessment'] },
      ]),
      findUnique: vi.fn(), count: vi.fn(async () => 1),
    },
    encounter: { findMany: vi.fn(async () => [{ id: 'e1', updatedAt: T('3') }, { id: 'e9', updatedAt: T('1') }]), findUnique: vi.fn() },
    dischargeSummary: { findMany: vi.fn(async () => []) },
    nursingNote: { findMany: vi.fn(async () => [
      { id: 'nn2', content: '[정정 addendum of 11111111-2222-3333-4444-555555555555] 투약 시각 정정', signedAt: T('4'), createdAt: T('4'), nurseId: 'rn-1' },
      { id: 'nn3', content: '[정정 addendum of 잘못된표식] x', signedAt: T('4'), createdAt: T('4'), nurseId: 'rn-1' },
    ]) },
    labResultAmendment: { findMany: vi.fn(async () => [{ id: 'la1', labResultId: 'lr1', amendedBy: 'lab-1', reason: '검체 오표기', previousStatus: 'VERIFIED', createdAt: T('5') }]) },
    user: { findMany: vi.fn(async () => [{ id: 'doc-1', familyName: '김', givenName: '의사' }, { id: 'doc-2', familyName: '이', givenName: '의사' }]) },
  };
  const svc = new PatientMedicalRecordService(prisma, {} as never);

  it('🔴 출처를 섞지 않는다 · 재서명 대기는 가장 최근 판에만 · 보존본 없는 정정 중 기록은 미보존 · 시각순', async () => {
    const r = await (svc as any).amendments('p1');
    expect(r.items.map((i: any) => [i.source, i.recordId, i.resignPending ?? null])).toEqual([
      ['LAB_RESULT_AMENDMENT', 'lr1', null],
      ['NURSING_ADDENDUM', '11111111-2222-3333-4444-555555555555', null], // 표식이 깨진 정정문은 원본을 지어내지 않는다(빠짐)
      ['SIGNED_VERSION', 'e1', true],
      ['SIGNED_VERSION', 'e1', false],
      ['UNPRESERVED', 'e9', true],
    ]);
    expect(r.items[2]).toMatchObject({ changedFields: ['plan'], by: { id: 'doc-2', name: '이의사' }, priorSignedBy: { id: 'doc-1', name: '김의사' } });
    expect(r.items[4].by).toBeNull(); // 미보존 — 누가 정정했는지 모른다(지어내지 않는다)
    expect(r.total).toBe(5);
    expect(r.preservedSince).toBe('2026-10-03');
  });

  it('🔴 보존본은 그 환자 경로로만 — 다른 환자의 판이면 404 · 그 뒤 정정 수를 말한다', async () => {
    prisma.signedRecordVersion.findUnique = vi.fn(async () => ({ id: 'v1', patientId: 'p2', recordType: 'ENCOUNTER', recordId: 'e1', content: {}, supersededAt: T('2') }));
    await expect(svc.signedVersion('p1', 'v1')).rejects.toThrow(/이 환자의/);
    prisma.signedRecordVersion.findUnique = vi.fn(async () => ({ id: 'v1', patientId: 'p1', recordType: 'ENCOUNTER', recordId: 'e1', content: { plan: '옛 계획' }, changedFields: ['plan'], signedAt: T('1'), supersededAt: T('2') }));
    prisma.encounter.findUnique = vi.fn(async () => ({ status: 'SIGNED', subjective: null, objective: null, assessment: null, plan: '새 계획', pregnancyStatus: null, diagnoses: [] }));
    const v = await svc.signedVersion('p1', 'v1');
    expect(v).toMatchObject({ prior: { plan: '옛 계획' }, current: { plan: '새 계획' }, laterVersions: 1, currentStatus: 'SIGNED' });
  });
});

describe('구조화 문진 저장(2026-10-03 — DTO 에 없어 개통 이래 저장 0)', () => {
  it('🔴 초안: 일곱 칸을 실제로 쓴다 · 빈 문자열은 null', async () => {
    const { svc, tx } = encounterSvc(signedEncounter({ status: 'DRAFT', signedAt: null, signedBy: null }));
    await svc.update('e1', { chiefComplaint: '기침', historyPresentIllness: '3일 전부터', familyHistory: '  ', reviewOfSystems: { resp: { normal: false, findings: '기침' } } } as never, 'doc-1');
    const data = (tx.encounter.update.mock.calls[0] as any)[0].data;
    expect(data).toMatchObject({ chiefComplaint: '기침', historyPresentIllness: '3일 전부터', familyHistory: null, reviewOfSystems: { resp: { normal: false, findings: '기침' } } });
    expect('pastMedicalHistory' in data).toBe(false); // 보내지 않은 칸은 건드리지 않는다
  });

  it('🔴 서명본: 문진만 바뀌어도 정정 · 보존본에 문진도 담긴다 · 빈 칸·빈 사회력 재전송은 정정이 아니다', async () => {
    const a = encounterSvc(signedEncounter({ historyPresentIllness: '옛 현병력', socialHistory: null }));
    await a.svc.update('e1', { historyPresentIllness: '새 현병력' } as never, 'doc-2');
    const v = (a.tx.signedRecordVersion.create.mock.calls[0] as any)[0].data;
    expect(v.changedFields).toEqual(['historyPresentIllness']);
    expect(v.content).toMatchObject({ historyPresentIllness: '옛 현병력', socialHistory: null });
    const b = encounterSvc(signedEncounter({ familyHistory: null, socialHistory: null }));
    await b.svc.update('e1', { familyHistory: '', socialHistory: { smoking: '', alcohol: '', occupation: '' }, reviewOfSystems: {} } as never, 'doc-2');
    expect(b.tx.signedRecordVersion.create).not.toHaveBeenCalled();
  });

  it('DTO 가 일곱 칸을 안다(whitelist 가 지우지 않는다)', () => {
    const dto = readFileSync(join(__dirname, '../../src/modules/encounter/dto/update-encounter.dto.ts'), 'utf8');
    for (const f of ['chiefComplaint', 'historyPresentIllness', 'pastMedicalHistory', 'familyHistory', 'socialHistory', 'reviewOfSystems', 'physicalExamination']) {
      expect(dto).toMatch(new RegExp(`@IsOptional\\(\\)[^\\n]*${f}\\?:`));
    }
  });
});

describe('정정 사유(선택 입력 · 2026-10-03)', () => {
  it('🔴 서명본 정정 때만 보존본에 사유가 남는다 · 앞뒤 공백 제거 · 비우면 null(지어내지 않는다) · 정정 항목으로 세지 않는다', async () => {
    const a = encounterSvc(signedEncounter());
    await a.svc.update('e1', { assessment: '바뀜', amendmentReason: '  검사 결과 반영  ' } as never, 'doc-2');
    const d1 = (a.tx.signedRecordVersion.create.mock.calls[0] as any)[0].data;
    expect(d1.reason).toBe('검사 결과 반영');
    expect(d1.changedFields).toEqual(['assessment']);
    const b = encounterSvc(signedEncounter());
    await b.svc.update('e1', { assessment: '바뀜', amendmentReason: '   ' } as never, 'doc-2');
    expect((b.tx.signedRecordVersion.create.mock.calls[0] as any)[0].data.reason).toBeNull();
    // 사유만 보내고 내용은 같으면 정정이 아니다(사유가 정정을 만들지 않는다)
    const c = encounterSvc(signedEncounter());
    await c.svc.update('e1', { subjective: '기침 3일', amendmentReason: '오타' } as never, 'doc-2');
    expect(c.tx.signedRecordVersion.create).not.toHaveBeenCalled();
  });

  it('DTO — 선택 · 500자 · 진료기록·퇴원요약 둘 다', () => {
    const enc = readFileSync(join(__dirname, '../../src/modules/encounter/dto/update-encounter.dto.ts'), 'utf8');
    expect(enc).toMatch(/@IsOptional\(\) @IsString\(\) @MaxLength\(500\) amendmentReason\?: string;/);
    const ds = readFileSync(join(__dirname, '../../src/modules/discharge-summary/dto/create-discharge-summary.dto.ts'), 'utf8');
    expect(ds).toMatch(/class UpdateDischargeSummaryDto[\s\S]*@MaxLength\(500\) amendmentReason\?: string;/);
  });

  it('정정 이력에 사유가 있으면 싣고 없으면 싣지 않는다', async () => {
    const prisma: any = {
      signedRecordVersion: { findMany: vi.fn(async () => [
        { id: 'v1', recordType: 'ENCOUNTER', recordId: 'e1', signedAt: SIGNED_AT, signedBy: null, supersededAt: SIGNED_AT, supersededBy: null, changedFields: [], reason: '검사 결과 반영' },
        { id: 'v0', recordType: 'ENCOUNTER', recordId: 'e2', signedAt: SIGNED_AT, signedBy: null, supersededAt: SIGNED_AT, supersededBy: null, changedFields: [], reason: null },
      ]) },
      encounter: { findMany: vi.fn(async () => []) }, dischargeSummary: { findMany: vi.fn(async () => []) },
      nursingNote: { findMany: vi.fn(async () => []) }, labResultAmendment: { findMany: vi.fn(async () => []) }, user: { findMany: vi.fn(async () => []) },
    };
    const r = await (new PatientMedicalRecordService(prisma, {} as never) as any).amendments('p1');
    expect(r.items.find((i: any) => i.versionId === 'v1').reason).toBe('검사 결과 반영');
    expect('reason' in r.items.find((i: any) => i.versionId === 'v0')).toBe(false);
  });
});

describe('배선 — 정정한 사람이 서버까지 온다', () => {
  it('🔴 진료기록·퇴원요약 수정 EP 가 로그인 사용자를 서비스에 넘긴다 · 정정 항목 어휘', () => {
    const enc = readFileSync(join(__dirname, '../../src/modules/encounter/encounter.controller.ts'), 'utf8');
    expect(enc).toMatch(/@CurrentUser\('id'\) userId: string,\s*\)\s*\{\s*const encounter = await this\.encounterService\.update\(id, dto, userId\)/);
    const ds = readFileSync(join(__dirname, '../../src/modules/discharge-summary/discharge-summary.controller.ts'), 'utf8');
    expect(ds).toMatch(/this\.service\.update\(admissionId, dto, userId\)/);
    expect([...ENCOUNTER_AMENDABLE_FIELDS]).toEqual(['subjective', 'objective', 'assessment', 'plan', 'pregnancyStatus', 'diagnoses',
      'chiefComplaint', 'historyPresentIllness', 'pastMedicalHistory', 'familyHistory', 'socialHistory', 'reviewOfSystems', 'physicalExamination']);
  });
});
