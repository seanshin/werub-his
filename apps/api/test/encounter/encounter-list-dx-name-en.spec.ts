import { describe, it, expect, vi } from 'vitest';
import { EncounterService } from '../../src/modules/encounter/encounter.service';

/**
 * 진료 목록 응답의 진단명에 영문명(nameEn)이 실린다 — 의료용어 한/영 토글 계약(2026-09-11).
 *
 * 🔴 결함: 목록(findAll)·환자별(findByPatient) 쿼리가 diagnosisCode 를 `code·nameKo` 만 select 했다.
 *    운영 KCD `name_en` 은 100% 채워져 있는데도 진료 이력·과거 진료 기록 화면(<Term>)이 영문 모드에서
 *    전부 'EN×'(영문명 미등록)로 그렸다 — **있는 사실을 없다고 말했다**. 상세(fullInclude)만 nameEn 이 있었다.
 *
 * 목(mock) 원칙: 인자만 보는 테스트는 "select 에 키를 적었는가"만 본다. 여기서는 목이 **Prisma 의 실제
 * 반환 모양**(select 한 키만 돌아온다)을 재현하도록 DB 행 전체에서 투영한다 — select 에서 nameEn 이 빠지면
 * 응답에서도 빠지고, 화면이 받는 모양 그대로 실패한다.
 */

type Spec = { select?: Record<string, unknown>; include?: Record<string, unknown> };

/** Prisma select/include 투영 재현 — select=적은 키만 · include=스칼라 전부+적은 관계 */
function project(row: unknown, spec: Spec | true | undefined): unknown {
  if (row == null || spec === true || spec === undefined) return row;
  if (Array.isArray(row)) return row.map((r) => project(r, spec));
  const src = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (spec.select) {
    for (const [k, v] of Object.entries(spec.select)) {
      if (!v) continue;
      out[k] = v === true ? src[k] : project(src[k], v as Spec);
    }
    return out;
  }
  // include: 스칼라(관계 아닌 값)는 전부 돌아오고, 관계는 적은 것만 돌아온다
  for (const [k, v] of Object.entries(src)) {
    const isRelation = Array.isArray(v) || (v !== null && typeof v === 'object' && !(v instanceof Date));
    if (!isRelation) out[k] = v;
  }
  for (const [k, v] of Object.entries(spec.include ?? {})) {
    if (!v) continue;
    out[k] = v === true ? src[k] : project(src[k], v as Spec);
  }
  return out;
}

/** DB 에 있는 그대로의 행(DiagnosisCode 전 컬럼) — 무엇이 돌아오는지는 select 가 정한다 */
const DX_ROW = {
  id: 'dx-1', codeSystem: 'KCD-8', code: 'I10', nameKo: '본태성(원발성) 고혈압', nameEn: 'Essential (primary) hypertension',
  category: '순환계통의 질환', notPrimary: false, sexRestriction: null, ageMin: null, ageMax: null, chapter: 'IX',
  parentCode: 'I10-I15', icd10Code: 'I10', icd11Code: null, isActive: true, validFrom: new Date('2021-01-01'), validTo: null,
};
const ENCOUNTER_ROW = {
  id: 'enc-1', patientId: 'p-1', doctorId: 'd-1', status: 'SIGNED', createdAt: new Date('2026-09-01T01:00:00Z'),
  subjective: 'S', objective: 'O', assessment: 'A', plan: 'P',
  patient: { id: 'p-1', mrn: 'MRN-1', familyName: '홍', givenName: '길동', gender: 'M', dateOfBirth: new Date('1970-01-01'), insuranceType: 'NHI' },
  doctor: { id: 'd-1', familyName: '김', givenName: '의사', department: '내과', specialty: null },
  diagnoses: [{ id: 'ed-1', encounterId: 'enc-1', diagnosisCodeId: 'dx-1', type: 'PRIMARY', rank: 1, diagnosisCode: DX_ROW }],
  prescriptions: [],
};

function makeService() {
  const prisma = {
    encounter: {
      findMany: vi.fn(async (args: Spec) => [project(ENCOUNTER_ROW, { include: args.include })]),
      findUnique: vi.fn(async (args: Spec) => project(ENCOUNTER_ROW, { include: args.include })),
      count: vi.fn().mockResolvedValue(1),
    },
  };
  return { prisma, service: new EncounterService(prisma as never, { emit: vi.fn() } as never) };
}

type DxOut = { diagnosisCode: Record<string, unknown> };

describe('진료 목록 진단명 nameEn 계약 — 영문 모드가 있는 영문명을 미등록으로 그리지 않는다', () => {
  it('🔴 findAll(진료 이력·과거 진료 기록 화면의 출처) — diagnosisCode 에 nameEn 이 실린다', async () => {
    const { service } = makeService();
    const res = await service.findAll({ patientId: 'p-1' });
    const dx = (res.data[0] as unknown as { diagnoses: DxOut[] }).diagnoses[0].diagnosisCode;
    expect(dx.nameEn).toBe('Essential (primary) hypertension');
    expect(dx.nameKo).toBe('본태성(원발성) 고혈압');
    expect(dx.code).toBe('I10');
  });

  it('🔴 findByPatient(/patients/:id/encounters) — 목록과 같은 모양으로 nameEn 이 실린다', async () => {
    const { service } = makeService();
    const rows = await service.findByPatient('p-1');
    const dx = (rows[0] as unknown as { diagnoses: DxOut[] }).diagnoses[0].diagnosisCode;
    expect(dx.nameEn).toBe('Essential (primary) hypertension');
  });

  it('대조군: 상세(findById)도 nameEn — 세 경로가 같은 진단을 같은 모양으로 낸다', async () => {
    const { service } = makeService();
    const enc = await service.findById('enc-1');
    const dx = (enc as unknown as { diagnoses: DxOut[] }).diagnoses[0].diagnosisCode;
    expect(dx.nameEn).toBe('Essential (primary) hypertension');
  });

  it('대조군: 투영 목이 실제로 좁힌다 — select 에 없는 컬럼(category 등)은 돌아오지 않는다', async () => {
    // 목이 행 전체를 돌려주면 위 테스트는 select 와 무관하게 통과한다(가드가 헛돈다) — 그렇지 않음을 확인
    const { service } = makeService();
    const res = await service.findAll({});
    const dx = (res.data[0] as unknown as { diagnoses: DxOut[] }).diagnoses[0].diagnosisCode;
    expect(dx).not.toHaveProperty('category');
    expect(dx).not.toHaveProperty('icd10Code');
    expect(Object.keys(dx).sort()).toEqual(['code', 'nameEn', 'nameKo']);
  });
});
