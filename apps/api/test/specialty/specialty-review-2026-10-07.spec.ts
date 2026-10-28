/**
 * 전문진료 검토 서버 몫(2026-10-07).
 *  · 치과 기공: 정본 흐름 한 단계씩만(건너뜀·되돌림·어휘 밖 거부) · 동시 클릭은 읽은 상태일 때만
 *  · 정신과 계속입원심사: 결과 필수 · 보호·행정입원만 · '계속입원'만 3개월 연장 · '퇴원'은 퇴원 · 이력은 덧붙임
 *  · 이비인후과 수면검사: CPAP 권고를 시스템이 AHI 로 지어 기록하지 않는다(미기록 null)
 *  · 재활 완료: 치료 시간은 사람이 적은 값 → 없으면 시작~완료 실측 → 시작 기록도 없으면 비움(30 지어내지 않음)
 *  · 투석 세션: 카드가 읽는 BFR·UF 목표가 select 에 있다
 *  · 방사선: 조사 기록을 여는 역할이 오늘 일정 목록도 본다
 * 재주입: 위 규칙 하나를 되돌리면 실패한다.
 */
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DentalService } from '../../src/modules/dental/dental.service';
import { PsychiatryService } from '../../src/modules/psychiatry/psychiatry.service';
import { ContinuationReviewDto } from '../../src/modules/psychiatry/dto/psychiatry.dto';
import { EntService } from '../../src/modules/ent/ent.service';
import { RehabService } from '../../src/modules/rehab/rehab.service';
import { DialysisService } from '../../src/modules/dialysis/dialysis.service';
import { RadiationController } from '../../src/modules/radiation/radiation.controller';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';

describe('치과 기공의뢰 상태 전이', () => {
  function dental(status: string, raced = false) {
    const prisma: any = {
      dentalLabOrder: {
        findUnique: vi.fn(async () => ({ id: 'l1', status })),
        updateMany: vi.fn(async () => ({ count: raced ? 0 : 1 })),
      },
    };
    return { s: new DentalService(prisma), prisma };
  }
  it('🔴 다음 단계만 — 건너뜀·되돌림 409 · 어휘 밖 400', async () => {
    await expect(dental('ORDERED').s.updateLabOrderStatus('l1', 'CEMENTED')).rejects.toBeInstanceOf(ConflictException);
    await expect(dental('SENT').s.updateLabOrderStatus('l1', 'ORDERED')).rejects.toBeInstanceOf(ConflictException);
    await expect(dental('ORDERED').s.updateLabOrderStatus('l1', 'WHATEVER')).rejects.toBeInstanceOf(BadRequestException);
    await expect(dental('CEMENTED').s.updateLabOrderStatus('l1', 'CEMENTED')).rejects.toBeInstanceOf(ConflictException);
  });
  it('다음 단계는 통과 · 발송 시각은 발송 때 · 읽은 상태 조건', async () => {
    const { s, prisma } = dental('IMPRESSION_TAKEN');
    await s.updateLabOrderStatus('l1', 'SENT');
    const arg = prisma.dentalLabOrder.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'l1', status: 'IMPRESSION_TAKEN' });
    expect(arg.data.status).toBe('SENT');
    expect(arg.data.sentAt).toBeInstanceOf(Date);
  });
  it('동시 클릭 — 먼저 바뀌었으면 409', async () => {
    await expect(dental('ORDERED', true).s.updateLabOrderStatus('l1', 'IMPRESSION_TAKEN')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('정신과 계속입원심사', () => {
  function psych(row: Record<string, unknown>) {
    const rec: Record<string, unknown> = { id: 'p1', status: 'ACTIVE', notes: null, continuationReviewDue: new Date('2026-10-01'), ...row };
    const prisma: any = {
      psychiatricAdmission: {
        findUnique: vi.fn(async () => rec),
        update: vi.fn(async ({ data }: any) => ({ ...rec, ...data })),
      },
    };
    return { s: new PsychiatryService(prisma), prisma };
  }
  it('🔴 결과 없는 바디는 DTO 에서 거부 · 어휘 밖도', async () => {
    expect((await validate(plainToInstance(ContinuationReviewDto, {}))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(ContinuationReviewDto, { result: '연장' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(ContinuationReviewDto, { result: '계속입원' }))).length).toBe(0);
  });
  it('🔴 응급·자의입원은 대상이 아니다(72시간이 3개월로 늘던 것)', async () => {
    const { s, prisma } = psych({ legalType: 'EMERGENCY', continuationReviewDue: null });
    await expect(s.recordContinuationReview('p1', { result: '계속입원' } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.psychiatricAdmission.update).not.toHaveBeenCalled();
    const v = psych({ legalType: 'VOLUNTARY' });
    await expect(v.s.recordContinuationReview('p1', { result: '계속입원' } as never)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('계속입원 = 3개월 연장 + 이력 덧붙임 · 퇴원 = 퇴원(연장 없음)', async () => {
    const a = psych({ legalType: 'GUARDIAN', notes: '기존 메모' });
    await a.s.recordContinuationReview('p1', { result: '계속입원', notes: '증상 지속' } as never);
    const d1 = a.prisma.psychiatricAdmission.update.mock.calls[0][0].data;
    expect(d1.legalExpiryAt).toBeInstanceOf(Date);
    expect(d1.notes).toMatch(/^기존 메모\n\[계속입원심사 \d{4}-\d{2}-\d{2} 계속입원\] 증상 지속$/);
    expect(d1.status).toBeUndefined();
    const b = psych({ legalType: 'ADMINISTRATIVE' });
    await b.s.recordContinuationReview('p1', { result: '퇴원' } as never);
    const d2 = b.prisma.psychiatricAdmission.update.mock.calls[0][0].data;
    expect(d2.status).toBe('DISCHARGED');
    expect(d2.legalExpiryAt).toBeUndefined();
  });
});

describe('이비인후과 수면검사 CPAP', () => {
  function ent() {
    const prisma: any = { sleepStudy: { create: vi.fn(async ({ data }: any) => data) } };
    return { s: new EntService(prisma), prisma };
  }
  it('🔴 의사가 고르지 않으면 null — AHI 30 이어도 시스템이 "권고"를 쓰지 않는다', async () => {
    const { s, prisma } = ent();
    await s.createSleepStudy({ patientId: 'p', studyType: 'PSG', studyDate: '2026-10-01', ahi: 32, interpretedBy: 'u' });
    const data = prisma.sleepStudy.create.mock.calls[0][0].data;
    expect(data.cpapRecommended).toBeNull();
    expect(data.severity).toBe('SEVERE');
  });
  it('고른 값은 그대로(비권고도)', async () => {
    const { s, prisma } = ent();
    await s.createSleepStudy({ patientId: 'p', studyType: 'PSG', studyDate: '2026-10-01', ahi: 32, cpapRecommended: false, interpretedBy: 'u' });
    expect(prisma.sleepStudy.create.mock.calls[0][0].data.cpapRecommended).toBe(false);
  });
});

describe('재활 치료 완료 시간', () => {
  function rehab(startTime: Date | null) {
    const prisma: any = {
      rehabSession: { findUnique: vi.fn(async () => ({ id: 's1', therapyType: 'PT', startTime })), update: vi.fn(async ({ data }: any) => data) },
      procedureCode: { findFirst: vi.fn(async () => null) },
    };
    return { s: new RehabService(prisma), prisma };
  }
  it('🔴 적은 값 > 시작~완료 실측 > 비움(30 지어내지 않음)', async () => {
    const a = rehab(null);
    await a.s.completeSession('s1', {});
    expect(a.prisma.rehabSession.update.mock.calls[0][0].data.duration).toBeUndefined();
    const b = rehab(new Date(Date.now() - 42 * 60000 - 5000));
    await b.s.completeSession('s1', {});
    expect(b.prisma.rehabSession.update.mock.calls[0][0].data.duration).toBe(42);
    const c = rehab(new Date(Date.now() - 42 * 60000));
    await c.s.completeSession('s1', { duration: 20 });
    expect(c.prisma.rehabSession.update.mock.calls[0][0].data.duration).toBe(20);
  });
});

describe('투석 세션 select', () => {
  it('🔴 카드가 읽는 BFR·UF 목표·투석액 유량·항응고제를 내려준다', async () => {
    const prisma: any = { dialysisSession: { findMany: vi.fn(async () => []) } };
    await new DialysisService(prisma).getSessions({});
    const sel = prisma.dialysisSession.findMany.mock.calls[0][0].include.order.select;
    for (const k of ['bloodFlowRate', 'ufGoal', 'dialysateFlow', 'anticoagulant', 'dryWeight', 'dialyzerType']) expect(sel[k]).toBe(true);
  });
});

describe('방사선 오늘 일정 역할', () => {
  it('🔴 조사 기록(deliver)을 여는 역할 = 오늘 일정 목록을 보는 역할', () => {
    const proto = RadiationController.prototype as unknown as Record<string, unknown>;
    const today = Reflect.getMetadata(ROLES_KEY, proto.getTodayFractions as object) as string[];
    const deliver = Reflect.getMetadata(ROLES_KEY, proto.deliverFraction as object) as string[];
    expect(today).toBeTruthy();
    expect([...today].sort()).toEqual([...deliver].sort());
    expect(today).toEqual(expect.arrayContaining(['NURSE', 'LAB_TECH']));
  });
});
