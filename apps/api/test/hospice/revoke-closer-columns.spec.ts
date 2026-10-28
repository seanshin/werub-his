import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { HospiceService } from '../../src/modules/hospice/hospice.service';
import { ConsultationService } from '../../src/modules/consultation/consultation.service';
import { RevokeAdvanceDirectiveDto } from '../../src/modules/hospice/dto/hospice.dto';

/**
 * 누가·언제·왜를 남기는 열(2026-10-10).
 * 🔴 사전연명의료 철회는 상태·시각만 남겨 **누가 철회를 기록했고 왜인지**가 없었다 — 환자의 연명의료 결정을 거둔 근거가 원장에 없다.
 * 🔴 협진 종결은 상태만 바꿔 누가·언제 닫았는지 없었다(종결 권한을 세 사람으로 좁혔는데 그 행사 기록이 없다).
 * 기존 행은 null = 기록 없음 — 지어내지 않는다.
 */
const prismaAd = (status = 'ACTIVE') => ({
  advanceDirective: {
    findUnique: vi.fn(async () => ({ id: 'ad1', status })),
    updateMany: vi.fn(async () => ({ count: 1 })),
    findMany: vi.fn(async () => []),
  },
});
const hospice = (p: unknown) => new HospiceService(p as never, {} as never);

describe('사전연명의료 철회 — 기록자·사유', () => {
  it('🔴 철회는 기록자(로그인한 사람)·사유(앞뒤 공백 정리)를 함께 남긴다', async () => {
    const p = prismaAd();
    await hospice(p).revokeDirective('ad1', '  환자 본인 구두 철회(보호자 입회)  ', 'u-nurse');
    expect(p.advanceDirective.updateMany).toHaveBeenCalledWith({
      where: { id: 'ad1', status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: expect.any(Date), revokedById: 'u-nurse', revokeReason: '환자 본인 구두 철회(보호자 입회)' },
    });
  });
  it('🔴 사유가 비면 400 · 원장 변경 0', async () => {
    const p = prismaAd();
    await expect(hospice(p).revokeDirective('ad1', '   ', 'u1')).rejects.toMatchObject({ response: { code: 'DIRECTIVE_REVOKE_REASON_REQUIRED' } });
    expect(p.advanceDirective.updateMany).not.toHaveBeenCalled();
  });
  it('이미 철회면 다시 쓰지 않는다(첫 철회의 기록자·사유 보존)', async () => {
    const p = prismaAd('REVOKED');
    await hospice(p).revokeDirective('ad1', '다른 사유', 'u2');
    expect(p.advanceDirective.updateMany).not.toHaveBeenCalled();
  });
  it('DTO — 사유 필수·500자 · 기록자는 본문으로 받지 않는다', () => {
    expect(validateSync(plainToInstance(RevokeAdvanceDirectiveDto, {})).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(RevokeAdvanceDirectiveDto, { reason: 'x'.repeat(501) })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(RevokeAdvanceDirectiveDto, { reason: '본인 철회' }))).toEqual([]);
    expect(Object.keys(new RevokeAdvanceDirectiveDto())).not.toContain('revokedById');
  });
  it('조회 — 기본은 유효 문서만(안전 표시줄 그대로) · includeRevoked 면 철회 포함 + 기록자 이름', async () => {
    const p = prismaAd();
    const s = hospice(p);
    await s.getDirectives('p1');
    expect(p.advanceDirective.findMany.mock.calls[0][0]).toEqual({ where: { patientId: 'p1', status: 'ACTIVE' }, orderBy: { registeredAt: 'desc' } });
    await s.getDirectives('p1', true);
    expect(p.advanceDirective.findMany.mock.calls[1][0]).toMatchObject({ where: { patientId: 'p1' }, include: { revokedBy: { select: { familyName: true, givenName: true } } } });
  });
  it('컨트롤러 — 기록자는 로그인 사용자 · 본문 DTO 는 class', () => {
    const c = readFileSync(join(__dirname, '../../src/modules/hospice/hospice.controller.ts'), 'utf8');
    expect(c).toMatch(/revokeDirective\(@Param\('id', ParseUUIDPipe\) id: string, @Body\(\) body: RevokeAdvanceDirectiveDto, @CurrentUser\(\) user/);
    expect(c).toContain('this.service.revokeDirective(id, body.reason, user.id)');
  });
});

describe('협진 종결 — 종결자·시각', () => {
  const consult = (status: string) => ({ id: 'c1', status, requestingDoctorId: 'doc-req', toDoctorId: 'doc-to', toDepartment: '외과' });
  const svc = (status = 'REPLIED') => {
    const p = {
      consultation: { findUnique: vi.fn(async () => consult(status)), updateMany: vi.fn(async () => ({ count: 1 })), findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
      user: { findUnique: vi.fn(async () => ({ department: '외과' })) },
    };
    return { s: new ConsultationService(p as never, {} as never), p };
  };
  it('🔴 종결은 누가(로그인한 사람)·언제를 남긴다', async () => {
    const { s, p } = svc();
    await s.close('c1', 'doc-req', 'DOCTOR');
    expect(p.consultation.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', status: 'REPLIED' }, data: { status: 'CLOSED', closedAt: expect.any(Date), closedById: 'doc-req' } });
  });
  it('이미 종결이면 다시 쓰지 않는다(첫 종결자 보존)', async () => {
    const { s, p } = svc('CLOSED');
    await s.close('c1', 'doc-to', 'DOCTOR');
    expect(p.consultation.updateMany).not.toHaveBeenCalled();
  });
  it('목록·환자 전체·진료별 조회가 종결자 이름을 싣는다(화면이 "종결: 누구")', async () => {
    const { s, p } = svc();
    await s.findAll({});
    await s.findByPatient('p1');
    await s.findByEncounter('e1');
    for (const call of p.consultation.findMany.mock.calls) expect(call[0].include.closedBy).toEqual({ select: { familyName: true, givenName: true } });
  });
});

describe('스키마·마이그레이션 — 추가만(nullable)', () => {
  const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
  const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261010000601_ad_revoke_consult_closed_by/migration.sql'), 'utf8');
  it('열이 스키마에 있고 nullable', () => {
    expect(schema).toMatch(/revokedById\s+String\?\s+@map\("revoked_by"\) @db\.Uuid/);
    expect(schema).toMatch(/revokeReason\s+String\?\s+@map\("revoke_reason"\) @db\.Text/);
    expect(schema).toMatch(/closedAt\s+DateTime\? @map\("closed_at"\) @db\.Timestamptz\(\)/);
    expect(schema).toMatch(/closedById\s+String\?\s+@map\("closed_by"\) @db\.Uuid/);
  });
  it('🔴 마이그레이션은 ADD COLUMN·FK 만(기존 행을 채우지 않는다 · NOT NULL 없음)', () => {
    const stmts = sql.split('\n').filter((l) => /^(ALTER|UPDATE|DELETE|DROP|CREATE)/.test(l.trim()));
    expect(stmts.every((l) => l.startsWith('ALTER TABLE'))).toBe(true);
    expect(sql).not.toMatch(/NOT NULL|^\s*UPDATE |DEFAULT/m);
  });
});
