/**
 * 🔴 이식 정직성 — 2026-09-15 T1.
 *  ① KONOS 대기자 등록이 전송 코드 없이 `KONOS-<시각>` 번호·REGISTERED·접수 시각을 지어냈다(P16).
 *  ② 상세 교차시험이 값 없는 CDC/FCXM 을 NEGATIVE·MFI 0·가상 COMPATIBLE 로 채워 저장했다("안 한 검사"="음성").
 *  ③ 같은 모듈 동류 — HLA PRA 0%·검사법/검사실 상수 · TDM 목표범위 5~15·약물 tacrolimus 추정 ·
 *     추적관찰 이식편 기능 GOOD·거부 징후 false · 이식편 생존율 곡선 전체 상수.
 * 각 묶음에 "값이 있으면 그대로" 대조군을 둔다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { TransplantService } from '../../src/modules/transplant/transplant.service';
import { KONOS_CHANNEL } from '../../src/modules/transplant/transplant-konos-channel';

describe('이식 정직성(T1)', () => {
  let service: TransplantService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      transplantWaitlist: {
        findUnique: vi.fn().mockResolvedValue({ id: 'wl-1', patientId: 'p-1', organType: 'KIDNEY', bloodType: 'A', urgency: 'ROUTINE', konosId: null }),
      },
      transplantDonor: {
        findUnique: vi.fn().mockResolvedValue({ id: 'td-1', status: 'APPROVED', organType: 'KIDNEY', bloodType: 'A' }),
        update: vi.fn().mockResolvedValue({}),
      },
      transplantCrossmatch: { create: vi.fn().mockResolvedValue({ id: 'xm-1', validUntil: new Date('2099-01-01') }) },
      transplantHla: { create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'h-1', ...data })) },
      transplantRecord: {
        findUnique: vi.fn().mockResolvedValue({ id: 'tr-1' }),
        count: vi.fn().mockResolvedValue(0),
      },
      transplantTdm: { create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 't-1', ...data })) },
      transplantFollowUp: { create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'f-1', ...data })) },
    };
    // 🔴 (G3) 교차시험 기록과 기증자 요약 갱신은 한 트랜잭션 — tx 는 같은 목을 재사용한다
    prisma.$transaction = vi.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    );
    service = new TransplantService(prisma);
  });

  describe('① KONOS 등록', () => {
    it('🔴 미구축 채널 — 보내지 않았다고 말하고 기관 번호·시각을 지어내지 않는다', async () => {
      const r = await service.registerKonos('wl-1', { urgency: 'URGENT' });
      expect(KONOS_CHANNEL.implemented).toBe(false);
      expect(r).toMatchObject({ attempted: false, sent: false, reason: 'KONOS_CHANNEL_NOT_IMPLEMENTED', konosRegistrationId: null, registeredAt: null });
      expect(JSON.stringify(r)).not.toMatch(/KONOS-\d|REGISTERED/);
      expect(r.urgency).toBe('URGENT');
    });
    it('대조군 — 사람이 수기로 기록해 둔 대기자 KONOS 번호는 출처를 달아 그대로 준다', async () => {
      prisma.transplantWaitlist.findUnique.mockResolvedValue({ id: 'wl-1', organType: 'KIDNEY', bloodType: 'A', urgency: 'ROUTINE', konosId: 'K2026-77' });
      const r = await service.registerKonos('wl-1', {});
      expect(r.recordedKonosId).toBe('K2026-77');
      expect(r.konosRegistrationId).toBeNull();
      expect(r.urgency).toBe('ROUTINE');
    });
    it('원장에 쓰지 않는다 — 다시 불러도 같은 결과(재전송 가능)', async () => {
      await service.registerKonos('wl-1', {});
      await service.registerKonos('wl-1', {});
      expect(prisma.transplantWaitlist.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('② 상세 교차시험 세부', () => {
    it('🔴 보내지 않은 CDC/FCXM/MFI/가상 교차시험은 null 로 저장·반환(음성으로 채우지 않음)', async () => {
      const r: any = await service.recordCrossmatch('td-1', { recipientId: 'p-1', finalResult: 'COMPATIBLE' }, 'doc-1');
      const saved = prisma.transplantCrossmatch.create.mock.calls[0][0].data.details;
      for (const d of [saved, r]) {
        expect(d.cdcCrossmatch).toEqual({ tCell: null, bCell: null });
        expect(d.flowCrossmatch).toEqual({ tCell: null, bCell: null, mfi: null });
        expect(d.virtualCrossmatch).toBeNull();
      }
    });
    it('대조군 — 실제 NEGATIVE/POSITIVE·MFI 0 은 그대로', async () => {
      await service.recordCrossmatch('td-1', { recipientId: 'p-1', finalResult: 'INCOMPATIBLE', cdcTCell: 'POSITIVE', cdcBCell: 'NEGATIVE', fcxmTCell: 'NEGATIVE', fcxmBCell: 'POSITIVE', mfi: 0, virtualCrossmatch: 'INCOMPATIBLE' }, 'doc-1');
      const call = prisma.transplantCrossmatch.create.mock.calls[0][0].data;
      expect(call.result).toBe('POSITIVE');
      expect(call.details.cdcCrossmatch).toEqual({ tCell: 'POSITIVE', bCell: 'NEGATIVE' });
      expect(call.details.flowCrossmatch).toEqual({ tCell: 'NEGATIVE', bCell: 'POSITIVE', mfi: 0 });
      expect(call.details.virtualCrossmatch).toBe('INCOMPATIBLE');
    });
  });

  describe('③ HLA', () => {
    it('🔴 PRA·검사법·검사실·항체·좌위를 보내지 않으면 null(PRA 0% = 감작 없음으로 적지 않음)', async () => {
      await service.recordHla('wl-1', {}, 'u-1');
      const d = prisma.transplantHla.create.mock.calls[0][0].data;
      expect(d.pra).toBeNull();
      expect(d.method).toBeNull();
      expect(d.lab).toBeNull();
      expect(d.antibodies).toBe(Prisma.JsonNull);
      expect(d.classI).toEqual({ hlaA: null, hlaB: null, hlaC: null });
    });
    it('대조군 — 측정된 PRA 0 은 0', async () => {
      await service.recordHla('wl-1', { pra: 0, method: 'NGS', lab: 'L', hlaA: ['A*02'] }, 'u-1');
      const d = prisma.transplantHla.create.mock.calls[0][0].data;
      expect(d.pra).toBe(0);
      expect(d.method).toBe('NGS');
      expect(d.classI.hlaA).toEqual(['A*02']);
    });
  });

  describe('③ TDM', () => {
    it('🔴 목표범위를 모르면 범위 판정도 null — 5~15 로 이탈 경고를 만들지 않는다', async () => {
      const r: any = await service.recordTdm('tr-1', { drug: 'cyclosporine', troughLevel: 150, sampledAt: '2026-10-09T23:00:00Z' }, 'u-1');
      const d = prisma.transplantTdm.create.mock.calls[0][0].data;
      expect(d.targetLow).toBeNull();
      expect(d.targetHigh).toBeNull();
      expect(d.inRange).toBeNull();
      expect(r.outOfRangeWarning).toBeUndefined();
    });
    it('🔴 약물이 없으면 400 — tacrolimus 로 추정해 쓰지 않는다', async () => {
      await expect(service.recordTdm('tr-1', { troughLevel: 8 }, 'u-1')).rejects.toThrow(/drug/);
      expect(prisma.transplantTdm.create).not.toHaveBeenCalled();
    });
    it('🔴 채혈 시각이 없으면 400 — 지금 시각으로 채우지 않는다(2026-10-10) · 미래도 400', async () => {
      await expect(service.recordTdm('tr-1', { drug: 'tacrolimus', troughLevel: 8 }, 'u-1')).rejects.toMatchObject({ response: { code: 'TDM_SAMPLED_AT_REQUIRED' } });
      await expect(service.recordTdm('tr-1', { drug: 'tacrolimus', troughLevel: 8, sampledAt: new Date(Date.now() + 3_600_000).toISOString() }, 'u-1')).rejects.toMatchObject({ response: { code: 'TDM_SAMPLED_AT_FUTURE' } });
      expect(prisma.transplantTdm.create).not.toHaveBeenCalled();
    });
    it('🔴 목표 하한 > 상한이면 400 — 판정을 지어내지 않는다', async () => {
      await expect(service.recordTdm('tr-1', { drug: 'tacrolimus', troughLevel: 8, targetLow: 10, targetHigh: 5, sampledAt: '2026-10-09T23:00:00Z' }, 'u-1')).rejects.toMatchObject({ response: { code: 'TDM_TARGET_INVERTED' } });
      expect(prisma.transplantTdm.create).not.toHaveBeenCalled();
    });
    it('채혈 시각은 받은 그대로 저장', async () => {
      await service.recordTdm('tr-1', { drug: 'tacrolimus', troughLevel: 8, sampledAt: '2026-10-09T23:00:00Z' }, 'u-1');
      expect(prisma.transplantTdm.create.mock.calls[0][0].data.sampledAt).toEqual(new Date('2026-10-09T23:00:00Z'));
    });
    it('대조군 — 목표범위가 있으면 이탈을 판정한다', async () => {
      const r: any = await service.recordTdm('tr-1', { drug: 'tacrolimus', troughLevel: 20, targetLow: 5, targetHigh: 10, sampledAt: '2026-10-09T23:00:00Z' }, 'u-1');
      expect(prisma.transplantTdm.create.mock.calls[0][0].data.inRange).toBe(false);
      expect(r.outOfRangeWarning).toBeTruthy();
    });
  });

  describe('③ 추적관찰', () => {
    it('🔴 기록하지 않은 이식편 기능·거부 징후는 null(GOOD·false 로 채우지 않음)', async () => {
      await service.recordFollowUp('tr-1', {}, 'u-1');
      const d = prisma.transplantFollowUp.create.mock.calls[0][0].data;
      expect(d.graftFunction).toBeNull();
      expect(d.rejectionSigns).toBeNull();
      expect(d.complications).toBe(Prisma.JsonNull);
      expect(d.infections).toBe(Prisma.JsonNull);
    });
    it('대조군 — 적은 값(거부 징후 false 포함)은 그대로', async () => {
      await service.recordFollowUp('tr-1', { graftFunction: 'DELAYED', rejectionSigns: false, complications: [] }, 'u-1');
      const d = prisma.transplantFollowUp.create.mock.calls[0][0].data;
      expect(d.graftFunction).toBe('DELAYED');
      expect(d.rejectionSigns).toBe(false);
      expect(d.complications).toEqual([]);
    });
  });

  describe('③ 이식편 생존율', () => {
    it('🔴 산출 로직이 없으면 곡선·장기별 생존율을 상수로 주지 않는다 — 분모만 사실로', async () => {
      prisma.transplantRecord.count.mockResolvedValue(3);
      const r: any = await service.getGraftSurvival();
      expect(r).toMatchObject({ available: false, reason: 'NOT_COMPUTED', kaplanMeier: null, byOrgan: null, totalTransplants: 3 });
    });
    it('소스에 상수 생존율이 되살아나지 않는다', () => {
      const src = readFileSync(join(__dirname, '../../src/modules/transplant/transplant.service.ts'), 'utf8');
      expect(src).not.toMatch(/survivalRate:\s*\d/);
      expect(src).not.toMatch(/KONOS-\$\{/);
    });
  });

  describe('TDM 목표범위 이탈 경보(2026-10-10)', () => {
    it('🔴 이탈이면 이식 수술의·담당의에게 갈 사건을 낸다 · 범위 안·판정 불가면 내지 않는다', async () => {
      const events = { emit: vi.fn() };
      const svc = new TransplantService(prisma, undefined, events as never);
      prisma.transplantRecord.findUnique.mockResolvedValue({ id: 'tr-1', recipientId: 'p-9', surgeonId: 'sg-1' });
      await svc.recordTdm('tr-1', { drug: 'tacrolimus', troughLevel: 18, targetLow: 5, targetHigh: 10, sampledAt: '2026-10-09T23:00:00Z' }, 'u-1');
      expect(events.emit).toHaveBeenCalledWith('transplant.tdm.out_of_range', expect.objectContaining({ patientId: 'p-9', surgeonId: 'sg-1', recordedBy: 'u-1', trough: 18 }));
      events.emit.mockClear();
      await svc.recordTdm('tr-1', { drug: 'tacrolimus', troughLevel: 7, targetLow: 5, targetHigh: 10, sampledAt: '2026-10-09T23:00:00Z' }, 'u-1');
      await svc.recordTdm('tr-1', { drug: 'tacrolimus', troughLevel: 18, sampledAt: '2026-10-09T23:00:00Z' }, 'u-1');
      expect(events.emit).not.toHaveBeenCalled();
    });
  });
});
