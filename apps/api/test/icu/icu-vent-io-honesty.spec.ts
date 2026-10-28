import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException, ValidationPipe } from '@nestjs/common';
import { IcuService, ioSummary } from '../../src/modules/icu/icu.service';
import { UpdateVentilatorDto } from '../../src/modules/icu/dto/icu.dto';

/**
 * ICU 인공호흡기 설정·I/O 합계 정직성(2026-09-15 M3).
 * 🔴 ① PATCH :id/ventilator 가 ventMode·fio2·peep·tidalVolume 을 받고 **사용 여부만** 저장 — 설정값은 성공 응답과 함께
 *    조용히 버려졌다. 게다가 `ventilator` 에 검증 데코레이터가 없어 전역 whitelist 가 그 키마저 지웠다(무동작).
 *    없는 입원 id 는 Prisma 오류(500). ② I/O 합계가 `?? 0` 이라 **I/O 를 한 번도 적지 않은 날을 0ml** 로 말했다.
 */
const ADM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function mk(admissionExists = true) {
  const prisma: any = {
    icuAdmission: {
      findUnique: vi.fn(async () => (admissionExists ? { id: ADM, patientId: 'p1' } : null)),
      update: vi.fn(async ({ data }: any) => ({ id: ADM, ...data })),
    },
    icuRecord: { findMany: vi.fn(async () => []) },
  };
  const svc = new IcuService(prisma, {} as any);
  const addRecord = vi.spyOn(svc, 'addRecord').mockResolvedValue({ id: 'rec-1' } as any);
  return { svc, prisma, addRecord };
}

describe('🔴 인공호흡기 설정값은 정본(활력 기록)으로 저장된다', () => {
  it('설정값이 오면 addRecord 로 기록 · 기록자=로그인 사용자 · 응답이 저장 사실을 말한다', async () => {
    const { svc, addRecord } = mk();
    const r: any = await svc.updateVentilator(ADM, { ventilator: true, ventMode: 'SIMV', fio2: 50, peep: 5, tidalVolume: 450 }, 'doc-1');
    expect(addRecord).toHaveBeenCalledWith(ADM, expect.objectContaining({ recordedBy: 'doc-1', ventMode: 'SIMV', fio2: 50, peep: 5, tidalVolume: 450 }));
    expect(r.ventilator).toBe(true);
    expect(r.settings).toEqual({ provided: ['ventMode', 'fio2', 'peep', 'tidalVolume'], stored: true, recordId: 'rec-1', reason: null });
  });

  it('🔴 PEEP 0 은 설정값이다 — 미입력으로 버리지 않는다', async () => {
    const { svc, addRecord } = mk();
    const r: any = await svc.updateVentilator(ADM, { ventilator: true, peep: 0 }, 'doc-1');
    expect(addRecord).toHaveBeenCalledWith(ADM, expect.objectContaining({ peep: 0 }));
    expect(r.settings.provided).toEqual(['peep']);
  });

  it('대조군 — 사용 여부만 바꾸면 기록을 만들지 않고 그 사실을 말한다', async () => {
    const { svc, addRecord, prisma } = mk();
    const r: any = await svc.updateVentilator(ADM, { ventilator: false }, 'doc-1');
    expect(addRecord).not.toHaveBeenCalled();
    expect(prisma.icuAdmission.update).toHaveBeenCalledWith({ where: { id: ADM }, data: { ventilator: false } });
    expect(r.settings).toEqual({ provided: [], stored: false, recordId: null, reason: 'NO_SETTINGS_PROVIDED' });
  });

  it('🔴 기록이 보류되면(저장 안 됨) stored=false 로 말한다 — 성공처럼 보이지 않게', async () => {
    const { svc, addRecord } = mk();
    addRecord.mockResolvedValue(null as any);
    const r: any = await svc.updateVentilator(ADM, { ventilator: true, fio2: 40 }, 'doc-1');
    expect(r.settings.stored).toBe(false);
    expect(r.settings.reason).toBe('RECORD_NOT_STORED');
  });

  it('🔴 없는 입원은 404 · 아무것도 쓰지 않는다', async () => {
    const { svc, prisma, addRecord } = mk(false);
    await expect(svc.updateVentilator(ADM, { ventilator: true, fio2: 40 }, 'doc-1')).rejects.toThrow(NotFoundException);
    expect(prisma.icuAdmission.update).not.toHaveBeenCalled();
    expect(addRecord).not.toHaveBeenCalled();
  });

  it('🔴 DTO — ventilator 가 whitelist 에 지워지지 않고, boolean 이 아니면 400', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const meta = { type: 'body' as const, metatype: UpdateVentilatorDto };
    const ok: any = await pipe.transform({ ventilator: true, fio2: 50 }, meta);
    expect(ok.ventilator).toBe(true);
    await expect(pipe.transform({ ventilator: 'false', fio2: 50 }, meta)).rejects.toBeTruthy();
  });
});

describe('🔴 I/O 합계 — 기록이 없으면 0 이 아니라 null', () => {
  it('I/O 를 한 번도 적지 않은 날: 모든 합계·균형 null', () => {
    const r = ioSummary([{ intakeOral: null, outputUrine: null }, {}]);
    expect(r.totalIntake).toBeNull();
    expect(r.totalOutput).toBeNull();
    expect(r.balance).toBeNull();
  });

  it('섭취만 기록되고 배출 기록이 없으면 균형은 산출 불가(null) — 섭취량 전체를 양의 균형으로 말하지 않는다', () => {
    const r = ioSummary([{ intakeIv: 500 }]);
    expect(r.totalIntake).toBe(500);
    expect(r.totalOutput).toBeNull();
    expect(r.balance).toBeNull();
  });

  it('대조군 — 실측 0 은 0 이다(배출 0ml 는 기록이 있는 사실)', () => {
    const r = ioSummary([{ intakeOral: 200, outputUrine: 0 }]);
    expect(r.totalOutput).toBe(0);
    expect(r.balance).toBe(200);
  });

  it('상세 조회(getPatientDetail)와 흐름표(getFlowsheet)가 같은 규칙을 쓴다', async () => {
    const now = new Date();
    const prisma: any = {
      icuAdmission: { findUnique: vi.fn(async () => ({ id: ADM, records: [{ recordTime: now, heartRate: 80 }] })) },
      icuRecord: { findMany: vi.fn(async () => [{ recordTime: now, heartRate: 80 }]) },
    };
    const svc = new IcuService(prisma, {} as any);
    const d: any = await svc.getPatientDetail(ADM);
    expect(d.ioTotal.totalIntake).toBeNull();
    expect(d.ioTotal.balance).toBeNull();
    const f: any = await svc.getFlowsheet(ADM);
    expect(f.summary.ioBalance).toBeNull();
  });
});
