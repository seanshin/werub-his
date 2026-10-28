/**
 * 문진 폼 판 원장(2026-10-21 임상 규칙·템플릿 P5 A7 · R10).
 *  · 🔴 문항이 바뀌면 판을 올리고 새 판을 원장에 · 첫 수정이면 직전 문항을 BEFORE_LEDGER 로 먼저 · 한 트랜잭션
 *  · 문항이 같으면(제목·설명만) 판 그대로 · 동시 수정 409 · 만들 때 판 1 원장
 *  · 판 기록 — 판별 제출 수 · 판 원장 시작 전 제출(null)은 따로 · 원장에 없는 현재 판은 그렇다고
 *  · 🔴 제출 경로 셋 전부 판을 찍는다(포털 둘 · 토큰 문진 = 채점한 그 행의 판) · 폼 못 찾으면 null(지어내지 않음)
 *  · 🔴 회수한 직원 EP 2개(부르는 화면 0)는 라우트가 없다
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { FormEngineService, currentFormRevision } from '../../src/modules/form-engine/form-engine.service';

const SRC = join(__dirname, '../../src/modules');

function prismaMock(existing: Record<string, unknown> | null, moved = 1) {
  const p: any = {
    formSchema: {
      findUnique: vi.fn(async () => existing),
      update: vi.fn(async ({ data }: any) => ({ ...existing, ...data })),
      updateMany: vi.fn(async () => ({ count: moved })),
      findUniqueOrThrow: vi.fn(async () => ({ ...existing, revision: (existing?.revision as number) + 1 })),
      create: vi.fn(async ({ data }: any) => ({ id: 'f-new', revision: 1, ...data })),
    },
    formSchemaRevision: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    formSubmission: { groupBy: vi.fn() },
  };
  p.$transaction = vi.fn(async (fn: any) => fn(p));
  return p;
}
const PHQ = { id: 'f1', name: 'phq9', revision: 3, version: '1.0', schema: { title: 'PHQ-9', fields: [{ id: 'q1', label: '문항1' }] } };

describe('🔴 문항 수정 = 새 판', () => {
  it('문항이 바뀌면 — 직전 문항 BEFORE_LEDGER(중복 무시) → 조건부 판 올림 → 새 판 EDIT · 수정자', async () => {
    const p = prismaMock(PHQ);
    await new FormEngineService(p).updateSchema('f1', { schema: { fields: [{ id: 'q1', label: '문항1(개정)' }] } }, 'u1');
    expect(p.$transaction).toHaveBeenCalledTimes(1);
    expect(p.formSchemaRevision.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ formSchemaId: 'f1', revision: 3, origin: 'BEFORE_LEDGER', schema: PHQ.schema, changedBy: null })],
      skipDuplicates: true,
    });
    expect(p.formSchema.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'f1', revision: 3 }, data: expect.objectContaining({ revision: 4 }) }));
    expect(p.formSchemaRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ revision: 4, origin: 'EDIT', changedBy: 'u1' }) });
    expect(p.formSchema.update).not.toHaveBeenCalled();
  });
  it('문항이 같으면(키 순서만 다름·제목만) 판 그대로 · 원장 쓰기 없음', async () => {
    const p = prismaMock(PHQ);
    await new FormEngineService(p).updateSchema('f1', { description: '설명', schema: { fields: [{ label: '문항1', id: 'q1' }] } }, 'u1');
    expect(p.formSchema.update).toHaveBeenCalledWith({ where: { id: 'f1' }, data: expect.objectContaining({ description: '설명' }) });
    expect(p.formSchemaRevision.create).not.toHaveBeenCalled();
    expect(p.formSchema.updateMany).not.toHaveBeenCalled();
  });
  it('🔴 편집기가 다시 싣는 제목·설명만 바뀌면 판 그대로(저장할 때마다 새 판이 되지 않는다) · 제목은 저장된다', async () => {
    const p = prismaMock(PHQ);
    await new FormEngineService(p).updateSchema('f1', { schema: { title: 'phq9', description: '안내 문구', fields: PHQ.schema.fields } }, 'u1');
    expect(p.formSchema.updateMany).not.toHaveBeenCalled();
    expect(p.formSchemaRevision.create).not.toHaveBeenCalled();
    expect(p.formSchema.update.mock.calls[0][0].data.schema).toMatchObject({ title: 'phq9', description: '안내 문구' });
  });
  it('🔴 채점 규칙만 바뀌어도 새 판(해석 기준이 바뀐다)', async () => {
    const p = prismaMock(PHQ);
    await new FormEngineService(p).updateSchema('f1', { schema: { scoring: { ranges: [{ min: 0, max: 4 }] } } }, 'u1');
    expect(p.formSchema.updateMany).toHaveBeenCalled();
  });
  it('🔴 동시 수정 — 판이 이미 바뀌었으면 409 · 새 판 원장 없음', async () => {
    const p = prismaMock(PHQ, 0);
    const e = await new FormEngineService(p).updateSchema('f1', { schema: { fields: [{ id: 'q2' }] } }, 'u1').catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as ConflictException).getResponse()).toMatchObject({ code: 'FORM_REVISION_RACE' });
    expect(p.formSchemaRevision.create).not.toHaveBeenCalled();
  });
  it('만들 때 판 1 원장(CREATE · 만든 사람) — 한 트랜잭션', async () => {
    const p = prismaMock(null);
    await new FormEngineService(p).createSchema({ name: 'n', version: '1.0', schema: { fields: [{ id: 'a' }] } } as never, 'u9');
    expect(p.$transaction).toHaveBeenCalledTimes(1);
    expect(p.formSchemaRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ formSchemaId: 'f-new', revision: 1, origin: 'CREATE', changedBy: 'u9' }) });
  });
});

describe('판 기록', () => {
  it('판별 제출 수 · 🔴 판 원장 시작 전 제출(null)은 따로 · 원장에 없는 현재 판', async () => {
    const p = prismaMock({ id: 'f1', name: 'phq9', revision: 1, version: '1.0' });
    p.formSchemaRevision.findMany.mockResolvedValue([]);
    p.formSubmission.groupBy.mockResolvedValue([{ formSchemaRevision: null, _count: { _all: 5 } }, { formSchemaRevision: 1, _count: { _all: 2 } }]);
    const r = await new FormEngineService(p).revisions('f1');
    expect(r).toMatchObject({ currentRecorded: false, revisions: [], submissionsBeforeLedger: 5, submissionsOnUnrecordedCurrent: 2 });
  });
  it('원장에 있는 판 — 판마다 제출 수 · 현재 판 기록됨', async () => {
    const p = prismaMock({ id: 'f1', name: 'phq9', revision: 2, version: '1.0' });
    p.formSchemaRevision.findMany.mockResolvedValue([{ revision: 2, origin: 'EDIT' }, { revision: 1, origin: 'BEFORE_LEDGER' }]);
    p.formSubmission.groupBy.mockResolvedValue([{ formSchemaRevision: 1, _count: { _all: 3 } }]);
    const r = await new FormEngineService(p).revisions('f1');
    expect(r.currentRecorded).toBe(true);
    expect(r.revisions.map((x: any) => x.submissions)).toEqual([0, 3]);
    expect(r.submissionsOnUnrecordedCurrent).toBe(0);
  });
  it('없는 판 404', async () => {
    const p = prismaMock(PHQ);
    p.formSchemaRevision.findUnique.mockResolvedValue(null);
    await expect(new FormEngineService(p).revision('f1', 9)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('🔴 제출 경로가 판을 찍는다', () => {
  it('정본 함수 — 지금 판 · 폼을 못 찾으면 null(지어내지 않음)', async () => {
    expect(await currentFormRevision({ formSchema: { findUnique: vi.fn(async () => ({ revision: 7 })) } } as never, 'f')).toBe(7);
    expect(await currentFormRevision({ formSchema: { findUnique: vi.fn(async () => null) } } as never, 'f')).toBeNull();
  });
  it('구조 가드 — formSubmission.create 를 쓰는 곳마다 formSchemaRevision 을 넣는다(포털 둘·토큰 문진)', () => {
    const files = ['portal/portal.service.ts', 'questionnaire/questionnaire.service.ts'];
    let creates = 0;
    for (const f of files) {
      const s = readFileSync(join(SRC, f), 'utf8');
      for (const m of s.matchAll(/formSubmission\.create\(\{[\s\S]*?\n\s{4,6}\}\);/g)) {
        creates++;
        expect(m[0], f).toMatch(/formSchemaRevision:/);
      }
    }
    expect(creates).toBe(3);
    // 토큰 문진은 채점에 쓴 바로 그 행의 판
    expect(readFileSync(join(SRC, 'questionnaire/questionnaire.service.ts'), 'utf8')).toMatch(/formSchemaRevision: schema\?\.revision \?\? null/);
  });
  it('🔴 회수한 직원 EP — 제출·환자 폼 데이터 라우트가 없다(부르는 화면 0)', () => {
    const c = readFileSync(join(SRC, 'form-engine/form-engine.controller.ts'), 'utf8');
    expect(c).not.toMatch(/forms\/:name\/submit/);
    expect(c).not.toMatch(/form-data/);
    // 대조군 — 판 기록 EP 는 있다
    expect(c).toMatch(/@Get\('forms\/:id\/revisions'\)/);
  });
});
