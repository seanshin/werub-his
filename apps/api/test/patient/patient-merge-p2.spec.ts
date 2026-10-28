/**
 * 🔴 환자 병합 P2·P2b(2026-10-20 · `patients-list-refinement-2026-10.plan.md` §2.3·§2.4).
 *  - 종전: 환자에 딸린 190 모델 중 6개만 옮겼다 — 화면은 "모든 진료기록 이관"이라 말했다
 *  - 이미 병합되었거나 비활성인 기록도 원·대상으로 받았다
 * 이제 정책 등록부(MOVE·UNIQUE·STAY·MANUAL·BLOCK)대로 옮기고, 남는 것을 세어 말하며, 확인해야 병합한다.
 */
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import { PatientService } from '../../src/modules/patient/patient.service';
import {
  MERGE_EXPLICIT_MODELS, MERGE_SAFETY_MODELS, patientLinkedModels, mergePolicyOf, uniqueKeyOf, countSourceRecords,
} from '../../src/modules/patient/patient-merge';

const lower = (m: string) => m.charAt(0).toLowerCase() + m.slice(1);

/**
 * 가짜 prisma — 모델별 원 환자 행 수. UNIQUE 모델은 `collide` 에 든 행 id 가 대상과 겹친다.
 * 없는 모델은 0 건 · updateMany 호출을 모델별로 기록한다.
 */
function fakePrisma(opts: {
  counts?: Record<string, number | 'throw'>;
  activeHolds?: number;
  uniqueRows?: Record<string, Array<{ id: string; collide?: boolean }>>;
  patients?: Record<string, Record<string, unknown>>;
} = {}) {
  const counts = opts.counts ?? {};
  const moves: Array<{ model: string; where: unknown }> = [];
  const history = { create: vi.fn(async () => ({})) };
  const patient = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
      id: where.id, mrn: `M-${where.id}`, validTo: null, mergedIntoId: null, validFrom: new Date(), ...(opts.patients?.[where.id] ?? {}),
    })),
    update: vi.fn(async () => ({})),
  };
  const delegates: Record<string, unknown> = {};
  for (const model of patientLinkedModels()) {
    const rows = opts.uniqueRows?.[model] ?? [];
    delegates[lower(model)] = {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (model === 'LegalHold') return 'release' in where ? opts.activeHolds ?? 0 : 0;
        if (opts.uniqueRows?.[model]) return rows.length;
        const c = counts[model];
        if (c === 'throw') throw new Error('db');
        return c ?? 0;
      }),
      findMany: vi.fn(async () => rows.map((r) => ({ id: r.id }))),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        void where;
        // 원 행 하나씩 차례로 묻는다 — 호출 순서 = rows 순서
        const i = (delegates[lower(model)] as { findFirst: { mock: { calls: unknown[] } } }).findFirst.mock.calls.length - 1;
        return rows[i % Math.max(rows.length, 1)]?.collide ? { id: 'tgt-row' } : null;
      }),
      updateMany: vi.fn(async (a: { where: unknown }) => { moves.push({ model, where: a.where }); return { count: 0 }; }),
    };
  }
  const db: Record<string, unknown> = {
    ...delegates,
    patient, patientHistory: { ...(delegates.patientHistory as object), create: history.create },
    encounter: { ...(delegates.encounter as object), findMany: vi.fn(async () => []) },
    $executeRaw: vi.fn(async () => 1),
  };
  db.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return { db, history, moves };
}
const svcOf = (db: unknown) => new PatientService(db as never, { getOrThrow: vi.fn(() => '0'.repeat(64)) } as unknown as ConfigService);

describe('🔴 정책 등록부 — 데이터 모델과 기계 대조', () => {
  it('환자 연결 모델 190 남짓 · 명시 목록의 모델은 전부 실재(낡은 이름 0)', () => {
    const linked = new Set(patientLinkedModels());
    expect(linked.size).toBeGreaterThanOrEqual(180);
    const stale = MERGE_EXPLICIT_MODELS.filter((m) => !linked.has(m));
    expect(stale, `데이터 모델에 없는 명시 모델: ${stale.join(', ')}`).toEqual([]);
    for (const m of Object.keys(MERGE_SAFETY_MODELS)) expect(linked.has(m), m).toBe(true);
  });

  it('🔴 고유 제약에 patientId 가 든 모델은 MOVE 가 아니다(그대로 옮기면 병합 트랜잭션이 깨진다)', () => {
    const offenders = Prisma.dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === 'patientId' && f.kind === 'scalar'))
      .filter((m) => m.fields.some((f) => f.name === 'patientId' && f.isUnique) || (m.uniqueFields as string[][]).some((u) => u.includes('patientId')))
      .filter((m) => mergePolicyOf(m.name) === 'MOVE')
      .map((m) => m.name);
    expect(offenders).toEqual([]);
  });

  it('해시 사슬·서명본·발급본·덧붙이기 원장은 STAY · 법적 보존명령은 BLOCK · 포털 계정은 MANUAL', () => {
    for (const m of ['OrderSignLog', 'SignedDocument', 'SignedRecordVersion', 'IssuedDocument', 'PatientJourneyEvent', 'PatientLocation', 'Claim', 'ControlledSubstanceLog']) {
      expect(mergePolicyOf(m), m).toBe('STAY');
    }
    expect(mergePolicyOf('LegalHold')).toBe('BLOCK');
    expect(mergePolicyOf('PatientAccount')).toBe('MANUAL');
    // 안전 기록은 옮긴다
    for (const m of ['Allergy', 'ProblemList', 'Surgery', 'ImagingResult', 'MedicationAdministration', 'EmergencyVisit']) expect(mergePolicyOf(m), m).toBe('MOVE');
  });

  it('UNIQUE 고유 키는 데이터 모델에서', () => {
    expect(uniqueKeyOf('PatientBloodTyping')).toEqual(['patientId']);
    expect(uniqueKeyOf('PatientFlag')).toEqual(['patientId', 'flaggedBy', 'flagType']);
  });
});

describe('countSourceRecords — 정책별로 센다 · 모르는 것을 0 으로 말하지 않는다', () => {
  it('MOVE 는 옮김 · STAY·MANUAL 은 남음 · UNIQUE 는 겹친 만큼 남음 · 세지 못하면 uncounted', async () => {
    const { db } = fakePrisma({
      counts: { Allergy: 2, Encounter: 3, PatientJourneyEvent: 5, PatientAccount: 1, Vaccination: 'throw' },
      uniqueRows: { PatientFlag: [{ id: 'f1' }, { id: 'f2', collide: true }] },
    });
    const r = await countSourceRecords(db, 'src', 'tgt');
    expect(r.moved.map((x) => [x.model, x.count]).sort()).toEqual([['Allergy', 2], ['Encounter', 3], ['PatientFlag', 1]]);
    expect(r.unmoved.map((x) => [x.model, x.policy, x.count]).sort()).toEqual([['PatientAccount', 'MANUAL', 1], ['PatientFlag', 'UNIQUE', 1], ['PatientJourneyEvent', 'STAY', 5]]);
    expect(r.uncounted).toEqual(['Vaccination']);
    expect(r.blocking).toEqual([]);
  });
});

describe('mergePatients — 등록부대로 옮긴다 · 막는다 · 확인한다 · 기록한다', () => {
  it('🔴 활성 법적 보존명령이 있으면 확인해도 409 · 옮기지 않음', async () => {
    const { db, moves } = fakePrisma({ counts: { Allergy: 1 }, activeHolds: 1 });
    await expect(svcOf(db).mergePatients({ sourceId: 'src', targetId: 'tgt', reason: 'dup', acknowledgeUnmoved: true }, 'u')).rejects.toMatchObject({ response: { code: 'MERGE_BLOCKED_LEGAL_HOLD' } });
    expect(moves).toEqual([]);
  });

  it('🔴 대상이 이미 병합된 기록이면 409 · 트랜잭션 없음', async () => {
    const { db } = fakePrisma({ patients: { tgt: { mergedIntoId: 'other', validTo: new Date() } } });
    await expect(svcOf(db).mergePatients({ sourceId: 'src', targetId: 'tgt', reason: 'dup' }, 'u')).rejects.toMatchObject({ response: { code: 'MERGE_PATIENT_INACTIVE' } });
    expect((db.$transaction as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('🔴 남는 기록이 있는데 확인이 없으면 409 · 옮기지 않음', async () => {
    const { db, moves } = fakePrisma({ counts: { Encounter: 1, PatientJourneyEvent: 2 } });
    await expect(svcOf(db).mergePatients({ sourceId: 'src', targetId: 'tgt', reason: 'dup' }, 'u')).rejects.toMatchObject({ response: { code: 'MERGE_UNMOVED_RECORDS' } });
    expect(moves).toEqual([]);
  });

  it('🔴 알레르기·수술 등 MOVE 모델은 전부 옮긴다(종전엔 6개뿐) · STAY·MANUAL·BLOCK 은 손대지 않는다 · UNIQUE 는 겹치지 않는 행만 id 로', async () => {
    const { db, moves, history } = fakePrisma({
      counts: { Allergy: 2, Surgery: 1, PatientJourneyEvent: 3, PatientAccount: 1 },
      uniqueRows: { PatientFlag: [{ id: 'f1' }, { id: 'f2', collide: true }] },
    });
    await svcOf(db).mergePatients({ sourceId: 'src', targetId: 'tgt', reason: 'dup', acknowledgeUnmoved: true }, 'u');
    const movedModels = new Set(moves.map((m) => m.model));
    for (const m of ['Allergy', 'Surgery', 'ProblemList', 'Encounter', 'LabResult']) expect(movedModels.has(m), m).toBe(true);
    for (const m of ['PatientJourneyEvent', 'PatientAccount', 'LegalHold', 'OrderSignLog']) expect(movedModels.has(m), m).toBe(false);
    expect(moves.find((m) => m.model === 'PatientFlag')?.where).toEqual({ id: { in: ['f1'] } });
    const data = (history.create.mock.calls[0] as unknown as [{ data: { data: Record<string, unknown> } }])[0].data.data;
    expect(data.acknowledgedUnmoved).toBe(true);
    expect((data.unmovedCounts as Array<{ model: string }>).map((x) => x.model).sort()).toEqual(['PatientAccount', 'PatientFlag', 'PatientJourneyEvent']);
  });

  it('대조군: 남는 기록이 없으면 확인 없이 병합', async () => {
    const { db, history } = fakePrisma({ counts: { Encounter: 2, Allergy: 1 } });
    await svcOf(db).mergePatients({ sourceId: 'src', targetId: 'tgt', reason: 'dup' }, 'u');
    expect(history.create).toHaveBeenCalled();
  });

  it('미리보기 — 되돌리기 없음 · 막는 것 · 비활성 원 환자 거부', async () => {
    const ok = fakePrisma({ counts: { Allergy: 1 }, activeHolds: 1 });
    const p = await svcOf(ok.db).mergePreview('src', 'tgt');
    expect(p.reversible).toBe(false);
    expect(p.records.blocking.map((b) => b.model)).toEqual(['LegalHold']);
    const bad = fakePrisma({ patients: { src: { validTo: new Date() } } });
    await expect(svcOf(bad.db).mergePreview('src', 'tgt')).rejects.toMatchObject({ response: { code: 'MERGE_PATIENT_INACTIVE' } });
  });
});
