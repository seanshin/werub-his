/**
 * 인계 종류·인수 확인자(2026-10-26).
 *  · 🔴 같은 간호 교대에 두 단어(SHIFT_CHANGE·NURSING_SHIFT) — 간호사 인계 111건이 "담당 인수" 단추를 못 받았다
 *    → 판정 종류 `kind`(종류 + 보낸 사람 직종)를 서버가 내려 준다 · 쌓인 기록은 고치지 않는다
 *  · 새 인계: 정본 어휘만(DTO) · 교대 인계 종류는 보낸 사람 직종으로 서버가 정한다 · 업무그룹 경로·시드도 NURSING_SHIFT
 *  · 🔴 인수 확인한 사람을 남긴다 — 관리자 대리 확인을 본인 확인과 구별 · 기록 전 확인분은 모른다(null)
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { InpatientService, withHandoffView } from '../../src/modules/inpatient/inpatient.service';
import { InpatientController } from '../../src/modules/inpatient/inpatient.controller';
import { CreateHandoffDto } from '../../src/modules/inpatient/dto/inpatient.dto';

const API = join(__dirname, '../..');

describe('🔴 판정 종류 kind', () => {
  it('간호사가 보낸 SHIFT_CHANGE(옛 기록·시드) = 간호 교대 · 의사가 보낸 SHIFT_CHANGE = 의사 교대 · 모르는 종류 = 미상', () => {
    const base = { toDoctorId: 'u2', acknowledgedAt: null, acknowledgedBy: null };
    expect(withHandoffView({ ...base, type: 'SHIFT_CHANGE', fromDoctor: { role: 'NURSE' } }).kind).toBe('NURSING_SHIFT');
    expect(withHandoffView({ ...base, type: 'SHIFT_CHANGE', fromDoctor: { role: 'DOCTOR' } }).kind).toBe('PHYSICIAN_SHIFT');
    expect(withHandoffView({ ...base, type: 'NURSING_SHIFT', fromDoctor: null }).kind).toBe('NURSING_SHIFT');
    expect(withHandoffView({ ...base, type: 'WHATEVER', fromDoctor: { role: 'NURSE' } }).kind).toBe('UNKNOWN');
  });
  it('미확인 목록이 보낸 사람 직종을 읽어 kind 를 싣는다', async () => {
    const prisma: any = { clinicalHandoff: { findMany: vi.fn(async () => [{ id: 'h1', type: 'SHIFT_CHANGE', toDoctorId: 'n2', acknowledgedAt: null, acknowledgedBy: null, fromDoctor: { role: 'NURSE' } }]) } };
    const svc = new InpatientService(prisma);
    const rows: any[] = await svc.getPendingHandoffs('n2');
    expect(rows[0].kind).toBe('NURSING_SHIFT');
    expect(prisma.clinicalHandoff.findMany.mock.calls[0][0].include.fromDoctor.select.role).toBe(true);
  });
});

describe('새 인계 종류', () => {
  it('DTO — 정본 어휘만(아무 문자열 거부) · 대조군 간호 교대', async () => {
    const errs = async (type: string) => (await validate(plainToInstance(CreateHandoffDto, { type, patientId: '00000000-0000-4000-a000-000000000001', toDoctorId: '00000000-0000-4000-a000-000000000002', summary: 's' }))).map((e) => e.property);
    expect(await errs('FOO')).toContain('type');
    expect(await errs('NURSING_SHIFT')).not.toContain('type');
  });
  it('🔴 교대 인계 종류는 보낸 사람 직종으로 서버가 정한다 · 다른 종류는 그대로', async () => {
    const svc: any = { createHandoff: vi.fn(async (d: unknown) => ({ data: d })) };
    const c = new InpatientController(svc);
    const dto = { type: 'SHIFT_CHANGE', patientId: 'p', toDoctorId: 't', summary: 's' } as CreateHandoffDto;
    await c.createHandoff(dto, 'n1', 'NURSE');
    expect(svc.createHandoff.mock.calls[0][0]).toMatchObject({ type: 'NURSING_SHIFT', fromDoctorId: 'n1' });
    await c.createHandoff({ ...dto, type: 'NURSING_SHIFT' }, 'd1', 'DOCTOR');
    expect(svc.createHandoff.mock.calls[1][0].type).toBe('SHIFT_CHANGE');
    await c.createHandoff({ ...dto, type: 'ER_TO_ADMISSION' }, 'n1', 'NURSE');
    expect(svc.createHandoff.mock.calls[2][0].type).toBe('ER_TO_ADMISSION');
  });
  it('업무그룹 교대 경로·간호 시드는 NURSING_SHIFT(구조)', () => {
    const wg = readFileSync(join(API, 'src/modules/workgroup/workgroup.service.ts'), 'utf8');
    expect(wg).toMatch(/type: 'NURSING_SHIFT', \/\/ 간호사 → 간호사 교대/);
    const seed = readFileSync(join(API, 'prisma/seeds/clinical-volume-nursing.ts'), 'utf8');
    expect(seed).toMatch(/type: 'NURSING_SHIFT',/);
    expect(seed).not.toMatch(/type: 'SHIFT_CHANGE',/);
  });
});

describe('🔴 인수 확인한 사람', () => {
  function svcWith(row: any) {
    const writes: any[] = [];
    const prisma: any = {
      clinicalHandoff: {
        findUnique: vi.fn(async (q: any) => (q.include ? { ...row, ...(writes.at(-1) ?? {}) } : { toDoctorId: row.toDoctorId })),
        updateMany: vi.fn(async ({ where, data }: any) => { if (row.acknowledgedAt && where.acknowledgedAt === null) return { count: 0 }; writes.push(data); return { count: 1 }; }),
      },
    };
    return { svc: new InpatientService(prisma), writes };
  }
  const ROW = { id: 'h1', type: 'NURSING_SHIFT', toDoctorId: 'n2', acknowledgedAt: null, acknowledgedBy: null, fromDoctor: { role: 'NURSE' } };
  it('인수자 본인 확인 → 확인자 기록 · 대리 아님', async () => {
    const m = svcWith(ROW);
    const r: any = await m.svc.acknowledgeHandoff('h1', 'n2', 'NURSE');
    expect(m.writes[0]).toMatchObject({ acknowledgedBy: 'n2' });
    expect(r.data).toMatchObject({ acknowledgedBy: 'n2', acknowledgedByProxy: false, kind: 'NURSING_SHIFT' });
  });
  it('🔴 관리자 대리 확인 → 대리라고 남는다', async () => {
    const m = svcWith(ROW);
    const r: any = await m.svc.acknowledgeHandoff('h1', 'admin1', 'ADMIN');
    expect(r.data).toMatchObject({ acknowledgedBy: 'admin1', acknowledgedByProxy: true });
  });
  it('확인자 기록 전 확인분은 모른다(null) · 다시 눌러도 확인자를 덮어쓰지 않는다', async () => {
    const legacy = withHandoffView({ type: 'NURSING_SHIFT', toDoctorId: 'n2', acknowledgedAt: new Date(), acknowledgedBy: null, fromDoctor: null });
    expect(legacy.acknowledgedByProxy).toBeNull();
    const m = svcWith({ ...ROW, acknowledgedAt: new Date(), acknowledgedBy: 'n2' });
    const r: any = await m.svc.acknowledgeHandoff('h1', 'admin1', 'ADMIN');
    expect(m.writes).toHaveLength(0);
    expect(r.data).toMatchObject({ alreadyAcknowledged: true, acknowledgedBy: 'n2', acknowledgedByProxy: false });
  });
});
