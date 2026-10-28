/**
 * 진단별 POA(입원 시 존재 · 2026-10-09) — 결정 safety.poaFlag 의 REQUIRE 선택지를 기능으로.
 *  · 진단 목록 정본 = 입원 기간 진료 진단(코드별 하나) · 그 밖의 코드는 기록 거부
 *  · 🔴 필수(설정 true)일 때만 서명이 빈 진단을 말하며 거부 — 필수 아님이면 막지 않는다(대조군)
 *  · 서명 경로가 실제로 이 검사를 지난다
 */
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DiagnosisPoaService } from '../../src/modules/discharge-summary/diagnosis-poa.service';
import { DischargeSummaryService } from '../../src/modules/discharge-summary/discharge-summary.service';

const cfg = (required: unknown) => ({ get: vi.fn(async (k: string) => (k === 'safety.poa.required' ? required : null)) });
const prisma = (poaRows: Array<{ diagnosisCode: string; poa: string }> = []) => ({
  admission: { findUnique: vi.fn(async () => ({ patientId: 'p1', admitDate: new Date(2026, 8, 1), dischargeDate: null })) },
  encounter: { findMany: vi.fn(async () => [
    { diagnoses: [{ diagnosisCode: { code: 'I21.9', nameKo: '급성 심근경색' } }, { diagnosisCode: { code: 'L89.1', nameKo: '욕창' } }] },
    { diagnoses: [{ diagnosisCode: { code: 'I21.9', nameKo: '급성 심근경색' } }] },
  ]) },
  diagnosisPoa: { findMany: vi.fn(async () => poaRows), upsert: vi.fn(async (a: unknown) => a) },
});

describe('진단별 POA', () => {
  it('입원 기간 진단을 코드별 하나로 · 미기록을 말한다(채우지 않는다)', async () => {
    const r = await new DiagnosisPoaService(prisma([{ diagnosisCode: 'I21.9', poa: 'Y' }]) as never, cfg(false) as never).list('a1');
    expect(r.items.map((i) => [i.code, i.poa])).toEqual([['I21.9', 'Y'], ['L89.1', null]]);
    expect(r.missing).toEqual(['L89.1']);
    expect(r.required).toBe(false);
  });
  it('🔴 입원 진단이 아닌 코드·어휘 밖 값은 거부', async () => {
    const svc = new DiagnosisPoaService(prisma() as never, cfg(false) as never);
    await expect(svc.set('a1', 'J18.9', 'Y', 'u1')).rejects.toMatchObject({ response: { code: 'POA_NOT_ADMISSION_DIAGNOSIS' } });
    await expect(svc.set('a1', 'I21.9', 'W', 'u1')).rejects.toThrow(BadRequestException);
  });
  it('🔴 필수일 때만 빈 진단이 있으면 서명 거부 — 대조군: 필수 아님이면 막지 않는다', async () => {
    await expect(new DiagnosisPoaService(prisma([{ diagnosisCode: 'I21.9', poa: 'Y' }]) as never, cfg(true) as never).assertReadyToSign('a1'))
      .rejects.toMatchObject({ response: { code: 'POA_REQUIRED', details: { missing: ['L89.1'] } } });
    await expect(new DiagnosisPoaService(prisma([]) as never, cfg(false) as never).assertReadyToSign('a1')).resolves.toBeUndefined();
    await expect(new DiagnosisPoaService(prisma([{ diagnosisCode: 'I21.9', poa: 'Y' }, { diagnosisCode: 'L89.1', poa: 'N' }]) as never, cfg(true) as never).assertReadyToSign('a1')).resolves.toBeUndefined();
  });
  it('🔴 퇴원요약 서명 경로가 POA 검사를 지난다(거부되면 상태를 바꾸지 않는다)', async () => {
    const p = { dischargeSummary: { findUnique: vi.fn(async () => ({ id: 's1', status: 'DRAFT', admission: { patientId: 'p1' } })), update: vi.fn() } };
    const poa = { assertReadyToSign: vi.fn(async () => { throw new ConflictException({ code: 'POA_REQUIRED' }); }) };
    const svc = new DischargeSummaryService(p as never, {} as never, poa as never);
    await expect(svc.sign('a1', 'd1')).rejects.toThrow(ConflictException);
    expect(p.dischargeSummary.update).not.toHaveBeenCalled();
  });
});
