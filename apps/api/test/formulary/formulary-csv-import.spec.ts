/**
 * 포뮬러리 CSV 일괄 등재 — 드라이런 무변경·행별 오류·확정 멱등·부분 실패 행 단위.
 * 목(mock)은 등재 정본 `add()` 가 실제로 쓰는 prisma 모양(findFirst·create·update)을 **상태를 가진 가짜 저장소**로 흉내 낸다 —
 * 호출 여부만 보는 목으로는 "같은 CSV 재업로드 시 중복 없음"을 증명할 수 없다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { FormularyService } from '../../src/modules/formulary/formulary.service';
import { parseCsvText, pickMaster } from '../../src/modules/formulary/formulary-csv';

type Item = { id: string; domain: string; codeType: string; codeId: string | null; presetKey: string | null; status: string; note: string | null; committee: string | null; createdAt: Date };

function makePrisma() {
  const items: Item[] = [];
  let seq = 0;
  const match = (where: Record<string, unknown>) => (i: Item) =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return (v as Record<string, unknown>[]).some((w) => match(w)(i));
      if (v && typeof v === 'object' && 'in' in (v as object)) return ((v as { in: unknown[] }).in).includes((i as never)[k]);
      return (i as never)[k] === v;
    });
  const prisma = {
    items,
    formularyItem: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => items.find(match(where)) ?? null),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => items.filter(match(where))),
      create: vi.fn(async ({ data }: { data: Omit<Item, 'id' | 'status' | 'createdAt'> }) => {
        const row: Item = { ...data, id: `f${++seq}`, status: 'ACTIVE', createdAt: new Date() } as Item;
        items.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Item> }) => {
        const row = items.find((i) => i.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    medicationCode: {
      findMany: vi.fn(async ({ where }: { where: { code: { in: string[] } } }) =>
        [
          { id: 'm1', code: 'A001', nameKo: '아세트아미노펜정', isActive: true },
          { id: 'm2', code: 'A002', nameKo: '이부프로펜정', isActive: true },
          { id: 'm3', code: 'OLD9', nameKo: '중지약', isActive: false },
        ].filter((m) => where.code.in.includes(m.code)),
      ),
    },
    procedureCode: {
      findMany: vi.fn(async ({ where }: { where: { code: { in: string[] } } }) =>
        [
          { id: 'p1', code: 'L100', nameKo: '혈당(2025)', isActive: true, validFrom: new Date('2025-01-01T00:00:00Z') },
          { id: 'p2', code: 'L100', nameKo: '혈당(2026)', isActive: true, validFrom: new Date('2026-01-01T00:00:00Z') },
        ].filter((m) => where.code.in.includes(m.code)),
      ),
    },
    nursingCode: { findMany: vi.fn(async () => []) },
  };
  return prisma;
}

describe('포뮬러리 CSV 파서', () => {
  it('따옴표·쉼표·"" 이스케이프·CRLF·BOM·빈 줄을 읽는다', () => {
    const grid = parseCsvText('﻿code,note\r\nA001,"성인, 1일 4g ""이내"""\r\n\r\n,,\nA002,\n');
    expect(grid).toEqual([['code', 'note'], ['A001', '성인, 1일 4g "이내"'], ['A002', '']]);
  });

  it('여러 활성 버전은 고르지 않는다(AMBIGUOUS) · 적용일로 좁히면 하나', () => {
    const c = [
      { id: 'p1', code: 'L100', nameKo: 'x', isActive: true, validFrom: new Date('2025-01-01T00:00:00Z') },
      { id: 'p2', code: 'L100', nameKo: 'y', isActive: true, validFrom: new Date('2026-01-01T00:00:00Z') },
    ];
    expect(pickMaster(c, {})).toEqual({ ok: false, error: 'AMBIGUOUS' });
    expect(pickMaster(c, { validFrom: '2026-01-01' })).toMatchObject({ ok: true, master: { id: 'p2' } });
  });
});

describe('FormularyService.importCsv', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: FormularyService;
  const U = 'admin-1';

  beforeEach(() => {
    prisma = makePrisma();
    svc = new FormularyService(prisma as never);
  });

  it('드라이런은 아무것도 쓰지 않고 행별 판정을 돌려준다', async () => {
    const r = await svc.importCsv(U, { domain: 'MEDICATION', csv: 'code\nA001\nA002', dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.summary).toEqual({ total: 2, create: 2, reactivate: 0, unchanged: 0, error: 0 });
    expect(r.applied).toBeNull();
    expect(prisma.formularyItem.create).not.toHaveBeenCalled();
    expect(prisma.formularyItem.update).not.toHaveBeenCalled();
  });

  it('행별 오류 — 없는 코드·비활성 마스터·파일 내 중복·빈 코드 · 코드는 정확 일치만(이름·소문자 매칭 없음)', async () => {
    const r = await svc.importCsv(U, { domain: 'MEDICATION', csv: 'code,note\nA001,\nZZZ,\nOLD9,\nA001,\n,메모만\na001,', dryRun: true });
    expect(r.rows.map((x) => [x.line, x.action, x.error])).toEqual([
      [2, 'CREATE', null],
      [3, 'ERROR', 'NOT_FOUND'],
      [4, 'ERROR', 'MASTER_INACTIVE'],
      [5, 'ERROR', 'DUPLICATE_IN_FILE'],
      [6, 'ERROR', 'MISSING_CODE'],
      [7, 'ERROR', 'NOT_FOUND'],
    ]);
    expect(r.summary).toMatchObject({ total: 6, create: 1, error: 5 });
  });

  it('수가 코드가 여러 적용일 버전이면 AMBIGUOUS · validFrom 열로 좁히면 CREATE · 형식 오류는 BAD_VALID_FROM', async () => {
    const r = await svc.importCsv(U, { domain: 'LAB', csv: 'code,validFrom\nL100,\nL100,2026-01-01\nL100,2026/01/01', dryRun: true });
    expect(r.rows.map((x) => [x.action, x.error, x.codeId])).toEqual([
      ['ERROR', 'AMBIGUOUS', null],
      ['CREATE', null, 'p2'],
      ['ERROR', 'BAD_VALID_FROM', null],
    ]);
  });

  it('프리셋 영역은 shared 정본에 있는 키만', async () => {
    const r = await svc.importCsv(U, { domain: 'THERAPY', csv: 'presetKey\nPT_EXERCISE\nMADE_UP', dryRun: true });
    expect(r.rows.map((x) => [x.action, x.error])).toEqual([['CREATE', null], ['ERROR', 'UNKNOWN_PRESET']]);
  });

  it('필수 열이 없거나 데이터 행이 없으면 파일 단위 400', async () => {
    await expect(svc.importCsv(U, { domain: 'MEDICATION', csv: 'name\n아세트', dryRun: true })).rejects.toThrow(BadRequestException);
    await expect(svc.importCsv(U, { domain: 'THERAPY', csv: 'code\nPT_EXERCISE', dryRun: true })).rejects.toThrow(BadRequestException);
    await expect(svc.importCsv(U, { domain: 'MEDICATION', csv: 'code\n', dryRun: true })).rejects.toThrow(BadRequestException);
  });

  it('확정은 유효 행만 등재 정본(add)으로 넣고, 같은 CSV 를 다시 올리면 전부 UNCHANGED — 중복 행 없음', async () => {
    const csv = 'code,note\nA001,성인 한정\nA002,\nZZZ,';
    const first = await svc.importCsv(U, { domain: 'MEDICATION', csv, dryRun: false, committee: '약사위원회' });
    expect(first.applied).toEqual({ created: 2, reactivated: 0, applyFailed: 0 });
    expect(first.summary).toMatchObject({ create: 2, error: 1 });
    expect(prisma.items).toHaveLength(2);
    expect(prisma.items.find((i) => i.codeId === 'm1')).toMatchObject({ note: '성인 한정', committee: '약사위원회' });

    const second = await svc.importCsv(U, { domain: 'MEDICATION', csv, dryRun: false });
    expect(second.summary).toMatchObject({ create: 0, reactivate: 0, unchanged: 2, error: 1 });
    expect(second.applied).toEqual({ created: 0, reactivated: 0, applyFailed: 0 });
    expect(prisma.items).toHaveLength(2);
  });

  it('중지(SUSPENDED)된 항목은 미리보기에서 REACTIVATE 로 드러난다(이전 상태 병기)', async () => {
    prisma.items.push({ id: 'x', domain: 'MEDICATION', codeType: 'MEDICATION_CODE', codeId: 'm1', presetKey: null, status: 'SUSPENDED', note: null, committee: null, createdAt: new Date() });
    const r = await svc.importCsv(U, { domain: 'MEDICATION', csv: 'code\nA001', dryRun: true });
    expect(r.rows[0]).toMatchObject({ action: 'REACTIVATE', previousStatus: 'SUSPENDED' });
  });

  it('적용 중 한 행이 실패해도 나머지는 진행하고, 실패 행은 APPLY_FAILED 로 남는다(전체 성공 가장 금지)', async () => {
    const realCreate = prisma.formularyItem.create.getMockImplementation()!;
    prisma.formularyItem.create.mockImplementation(async (args: { data: { codeId: string | null } }) => {
      if (args.data.codeId === 'm1') throw new Error('db down');
      return realCreate(args as never);
    });
    const r = await svc.importCsv(U, { domain: 'MEDICATION', csv: 'code\nA001\nA002', dryRun: false });
    expect(r.applied).toEqual({ created: 1, reactivated: 0, applyFailed: 1 });
    expect(r.rows.map((x) => [x.line, x.action, x.error])).toEqual([[2, 'ERROR', 'APPLY_FAILED'], [3, 'CREATE', null]]);
    expect(r.summary.error).toBe(1);
  });
});
