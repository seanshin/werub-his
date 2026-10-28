/**
 * 🔴 (2026-09-15 SC) UUID·외래키 컬럼에 들어갈 수 없는 값을 넣어 저장이 늘 실패하던 두 자리.
 *  ① 코드 매핑 자동 배치 크론 — mapping_batch_jobs.created_by(UUID)에 'SYSTEM_CRON' → 스키마 nullable + null
 *  ② 전원 수신 알레르기 — allergies.recorded_by(users FK)에 환자 id → catch 가 삼켜 0행 → TransferRecord.allergies 로 보존
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TransferService } from '../../src/modules/transfer/transfer.service';

const src = (p: string) => readFileSync(join(__dirname, '../../src', p), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('① 코드 매핑 크론 created_by', () => {
  it('스키마가 created_by 를 NULL 허용으로 선언한다', () => {
    const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
    const block = schema.slice(schema.indexOf('model MappingBatchJob'), schema.indexOf('@@map("mapping_batch_jobs")'));
    expect(block).toMatch(/createdBy\s+String\?\s+@map\("created_by"\) @db\.Uuid/);
  });
  it('크론 배치 생성이 UUID 아닌 문자열 행위자를 넣지 않는다(null)', () => {
    const s = src('modules/code-master/auto-mapper.service.ts');
    expect(s).not.toContain("'SYSTEM_CRON'");
    const i = s.indexOf("filter: 'CRON_SCHEDULED'");
    expect(i).toBeGreaterThan(-1);
    expect(s.slice(i, i + 300)).toMatch(/createdBy:\s*null/);
  });
});

describe('② 전원 수신 알레르기 보존', () => {
  const bundle = {
    resourceType: 'Bundle',
    entry: [
      { resource: { resourceType: 'Patient', id: 'ext-1', name: [{ family: '김', given: ['수신'] }], birthDate: '1980-01-01', gender: 'female' } },
      { resource: { resourceType: 'AllergyIntolerance', code: { text: '페니실린' }, category: ['medication'], criticality: 'high' } },
      { resource: { resourceType: 'AllergyIntolerance', code: { coding: [{ display: '땅콩' }] }, category: ['food'] } },
    ],
  };

  function make() {
    const transferRecordCreate = vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'tr1', ...data }));
    const allergyCreate = vi.fn();
    const prisma = {
      organization: { findFirst: vi.fn().mockResolvedValue({ id: 'org-self' }) },
      smartClient: { findUnique: vi.fn().mockResolvedValue(null) },
      transferRecord: { create: transferRecordCreate },
      allergy: { create: allergyCreate, findFirst: vi.fn().mockResolvedValue(null) },
    };
    const svc = Object.create(TransferService.prototype) as TransferService;
    (svc as any).prisma = prisma;
    (svc as any).logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    vi.spyOn(svc as any, 'matchOrCreatePatient').mockResolvedValue({ id: 'p1' });
    return { svc, transferRecordCreate, allergyCreate };
  }

  it('수신 알레르기를 TransferRecord.allergies 에 원문 그대로 보존하고, 원내 알레르기 목록에 FK 위반 쓰기를 하지 않는다', async () => {
    const { svc, transferRecordCreate, allergyCreate } = make();
    const r = await svc.receiveBundle(bundle as any);
    expect(allergyCreate).not.toHaveBeenCalled();
    const data = transferRecordCreate.mock.calls[0][0].data;
    expect(data.allergies).toEqual([
      { name: '페니실린', severity: 'high', category: 'medication', criticality: 'high' },
      { name: '땅콩', severity: '', category: 'food', criticality: undefined },
    ]);
    expect(r.importResult.allergies).toBe(2);
  });

  it('대조군 — 알레르기가 없으면 allergies 를 싣지 않는다', async () => {
    const { svc, transferRecordCreate } = make();
    await svc.receiveBundle({ ...bundle, entry: [bundle.entry[0]] } as any);
    expect(transferRecordCreate.mock.calls[0][0].data.allergies).toBeUndefined();
  });

  it('서비스 소스에 환자 id 를 recordedBy 로 넣는 쓰기가 없다', () => {
    expect(src('modules/transfer/transfer.service.ts')).not.toMatch(/recordedBy:\s*patientId/);
  });
});
