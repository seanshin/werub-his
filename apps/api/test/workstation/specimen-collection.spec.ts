/**
 * 검체 채취 시각 분리 기록(2026-10-01).
 * 🔴 종전: 채취를 따로 남기는 단계가 없었고, 검사실 접수 두 경로가 접수 순간을 `labResult.collectedAt` 으로 찍었다
 *    (병동에서 2시간 전에 채혈해도 채취 = 접수 · 채취→접수 운반 시간은 늘 0).
 * 지키는 것
 *  ① 채취 시각 규칙 — 검사 오더만·취소 불가·이미 기록 409(덮어쓰지 않음)·미래/발행 전/접수 뒤 불가·지난 시각 입력은 출처 ENTERED_LATER
 *  ② 기록 — 조건부 갱신(동시 기록 하나만)·결과 행이 있으면 채취 시각으로 바로잡음
 *  ③ 접수 경로(워크스테이션 접수·검사실 접수·장비 수신·결과 입력)는 **접수 순간을 채취로 찍지 않는다** — 기록된 채취를 옮겨 적거나 null
 *  ④ EP — 실제 ValidationPipe·역할·병동 채혈 대기(재원·접수 전·채취 기록 없음)
 */
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentMetadata, BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCollectionTime } from '../../src/modules/workstation/specimen-collection';
import { WorkstationService } from '../../src/modules/workstation/workstation.service';
import { WorkstationController } from '../../src/modules/workstation/workstation.controller';
import { RecordSpecimenCollectionDto } from '../../src/modules/workstation/dto/workstation-write.dto';
import { LabService } from '../../src/modules/lab/lab.service';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

const t = (iso: string) => new Date(iso);
const NOW = t('2026-10-01T10:00:00Z');
const base = { department: 'LAB', status: 'ORDERED', createdAt: t('2026-10-01T08:00:00Z'), receivedAt: null as Date | null, specimenCollectedAt: null as Date | null };

describe('① 채취 시각 규칙', () => {
  it('시각을 안 주면 지금(채취하며 누름) · 주면 그 시각(나중 입력)', () => {
    expect(resolveCollectionTime(base, {}, NOW)).toEqual({ at: NOW, source: 'POINT_OF_CARE' });
    expect(resolveCollectionTime(base, { collectedAt: '2026-10-01T09:00:00Z' }, NOW)).toEqual({ at: t('2026-10-01T09:00:00Z'), source: 'ENTERED_LATER' });
  });
  it('🔴 미래·발행 전·검사실 접수 뒤는 400 · 형식 오류 400', () => {
    const code = (fn: () => unknown) => { try { fn(); } catch (e) { return ((e as BadRequestException).getResponse() as { code: string }).code; } return null; };
    expect(code(() => resolveCollectionTime(base, { collectedAt: '2026-10-01T10:05:00Z' }, NOW))).toBe('FUTURE_TIME');
    expect(code(() => resolveCollectionTime(base, { collectedAt: '2026-10-01T07:59:00Z' }, NOW))).toBe('BEFORE_ORDER');
    expect(code(() => resolveCollectionTime({ ...base, status: 'RECEIVED', receivedAt: t('2026-10-01T09:00:00Z') }, { collectedAt: '2026-10-01T09:30:00Z' }, NOW))).toBe('AFTER_RECEIPT');
    expect(code(() => resolveCollectionTime(base, { collectedAt: 'yesterday' }, NOW))).toBe('INVALID_TIME');
    // 대조군 — 접수 전 시각은 접수된 뒤에도 남길 수 있다(늦은 기록)
    expect(resolveCollectionTime({ ...base, status: 'RECEIVED', receivedAt: t('2026-10-01T09:00:00Z') }, { collectedAt: '2026-10-01T08:40:00Z' }, NOW).source).toBe('ENTERED_LATER');
  });
  it('🔴 검사 오더만 · 취소 불가 · 이미 기록이면 409(덮어쓰지 않는다)', () => {
    expect(() => resolveCollectionTime({ ...base, department: 'IMAGING' }, {}, NOW)).toThrow(BadRequestException);
    expect(() => resolveCollectionTime({ ...base, status: 'CANCELLED' }, {}, NOW)).toThrow(ConflictException);
    expect(() => resolveCollectionTime({ ...base, specimenCollectedAt: t('2026-10-01T09:00:00Z') }, {}, NOW)).toThrow(ConflictException);
  });
});

function fakePrisma(order: Record<string, unknown>, labResult: Record<string, unknown> | null = null) {
  const state = { order: { ...order }, labResult: labResult ? { ...labResult } : null };
  const api: Record<string, unknown> = {
    state,
    order: {
      findUnique: vi.fn(async () => ({ ...state.order })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(state.order, data); return { ...state.order }; }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if ('specimenCollectedAt' in where && where.specimenCollectedAt === null && state.order.specimenCollectedAt) return { count: 0 };
        Object.assign(state.order, data);
        return { count: 1 };
      }),
    },
    labResult: {
      findUnique: vi.fn(async () => (state.labResult ? { ...state.labResult } : null)),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { Object.assign(state.labResult!, data); return state.labResult; }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { state.labResult = { id: 'lr1', ...data }; return state.labResult; }),
    },
  };
  api.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(api));
  return api as unknown as { state: typeof state } & Record<string, any>;
}

describe('② 채취 기록', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });
  it('🔴 결과 행이 있으면(과거 경로가 접수 순간을 채취로 찍은 행) 기록된 채취 시각으로 바로잡는다', async () => {
    const prisma = fakePrisma({ id: 'o1', ...base, status: 'RECEIVED', receivedAt: t('2026-10-01T09:30:00Z') }, { id: 'lr1', collectedAt: t('2026-10-01T09:30:00Z') });
    const svc = new WorkstationService(prisma as never);
    await svc.recordSpecimenCollection('o1', 'nurse-1', { collectedAt: '2026-10-01T09:00:00.000Z', note: ' 좌측 정맥 ' });
    expect(prisma.state.order).toMatchObject({ specimenCollectedAt: t('2026-10-01T09:00:00Z'), specimenCollectedById: 'nurse-1', specimenCollectionSource: 'ENTERED_LATER', specimenCollectionNote: '좌측 정맥' });
    expect(prisma.state.order.specimenCollectionRecordedAt).toBeInstanceOf(Date);
    expect(prisma.state.labResult!.collectedAt).toEqual(t('2026-10-01T09:00:00Z'));
  });
  it('🔴 동시 기록 — 조건부 갱신이 0건이면 409(먼저 기록한 사람이 이긴다)', async () => {
    const prisma = fakePrisma({ id: 'o1', ...base });
    prisma.order.updateMany = vi.fn(async () => ({ count: 0 }));
    const svc = new WorkstationService(prisma as never);
    await expect(svc.recordSpecimenCollection('o1', 'n', {})).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('③ 접수 경로는 접수 순간을 채취로 찍지 않는다', () => {
  it('🔴 워크스테이션 접수 — 결과 행이 있어도 채취 기록이 없으면 건드리지 않는다 · 대조군: 기록이 있으면 그 값', async () => {
    const p1 = fakePrisma({ id: 'o1', ...base }, { id: 'lr1', collectedAt: null });
    await new WorkstationService(p1 as never).receiveOrder('o1', 'lab-1');
    expect(p1.state.labResult!.collectedAt).toBeNull();
    expect(p1.state.order.status).toBe('RECEIVED');
    const ward = t('2026-10-01T08:30:00Z');
    const p2 = fakePrisma({ id: 'o1', ...base, specimenCollectedAt: ward }, { id: 'lr1', collectedAt: null });
    await new WorkstationService(p2 as never).receiveOrder('o1', 'lab-1');
    expect(p2.state.labResult!.collectedAt).toEqual(ward);
  });
  it('🔴 검사실 접수(lab.collect) — 결과 행의 채취 시각은 오더의 채취 기록(없으면 null)', async () => {
    for (const [collected, expected] of [[null, null], [t('2026-10-01T08:30:00Z'), t('2026-10-01T08:30:00Z')]] as const) {
      const prisma = fakePrisma({ id: 'o1', ...base, specimenCollectedAt: collected, prescription: { encounter: { patientId: 'p1' } } });
      const lab = new LabService(prisma as never, {} as never, {} as never, {} as never);
      await lab.collect('o1', 'lab-1');
      expect(prisma.state.labResult!.collectedAt).toEqual(expected);
    }
  });
  it('구조 — 장비 수신·결과 입력·검사 취소가 `collectedAt: new Date()` 를 쓰지 않는다', () => {
    const lab = readFileSync(join(__dirname, '../../src/modules/lab/lab.service.ts'), 'utf8');
    const ws = readFileSync(join(__dirname, '../../src/modules/workstation/workstation.service.ts'), 'utf8');
    expect(lab).not.toMatch(/collectedAt:\s*new Date\(\)/);
    expect(ws).not.toMatch(/collectedAt:\s*(new Date\(\)|now)\b/);
  });
});

describe('④ EP', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
  const meta: ArgumentMetadata = { type: 'body', metatype: RecordSpecimenCollectionDto };
  it('DTO — 실제 ValidationPipe: ISO 시각·메모 200자 · 키가 지워지지 않는다', async () => {
    await expect(pipe.transform({ collectedAt: '2026-10-01T09:00:00Z', note: 'x' }, meta)).resolves.toMatchObject({ collectedAt: '2026-10-01T09:00:00Z', note: 'x' });
    await expect(pipe.transform({ collectedAt: '어제' }, meta)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ note: 'x'.repeat(201) }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('역할 — 간호·검사·의사·관리자', () => {
    for (const h of ['recordSpecimenCollection', 'getPendingSpecimenCollections'] as const) {
      expect(Reflect.getMetadata(ROLES_KEY, WorkstationController.prototype[h])).toEqual([UserRole.NURSE, UserRole.LAB_TECH, UserRole.DOCTOR, UserRole.ADMIN]);
    }
  });
  it('병동 채혈 대기 — 재원·접수 전·채취 기록 없음·활성 처방 · 잘림을 말한다', async () => {
    const findMany = vi.fn(async () => Array.from({ length: 3 }, (_, i) => ({
      id: `o${i}`, priority: 'ROUTINE', createdAt: t('2026-10-01T08:00:00Z'),
      prescription: { instructions: null, procedureCode: { code: 'CBC', nameKo: 'CBC' }, encounter: { patient: { id: 'p', mrn: 'M', familyName: '김', givenName: '환자', admissions: [{ bed: { roomNumber: '501', bedNumber: 'A', ward: { id: 'w', name: '5병동' } } }] } } },
    })));
    const svc = new WorkstationService({ order: { findMany } } as never);
    const r = await svc.getPendingSpecimenCollections({ wardId: 'w' });
    const where = (findMany.mock.calls[0] as unknown as [{ where: Record<string, any> }])[0].where;
    expect(where).toMatchObject({ department: 'LAB', status: 'ORDERED', specimenCollectedAt: null, prescription: { status: 'ACTIVE' } });
    expect(where.prescription.encounter.patient.admissions.some).toMatchObject({ status: 'ADMITTED', bed: { wardId: 'w' } });
    expect(r.items[0]).toMatchObject({ testName: 'CBC', room: '501-A', ward: { name: '5병동' } });
    expect(r.truncated).toBe(false);
  });
});
