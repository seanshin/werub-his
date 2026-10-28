/**
 * R3(2026-09-14) — patient-crm 기획 `GET campaigns/:id/logs`·`GET automation/reminders`.
 *
 * 지키는 것:
 *  ① 캠페인 기록은 발송 판정을 그대로(SIMULATED 를 SENT 로 합치지 않는다)·요약은 필터와 무관한 캠페인 전체·도달은 NOT_AVAILABLE
 *  ② 없는 캠페인 404 · 잘못된 status 필터 400(DTO)
 *  ③ 자동 연락 현황은 크론 정본(CRM_OUTBOUND_JOBS) 제목으로만 귀속·마지막 실행 시각은 null·수동 실행 없음
 *  ④ 크론이 정본 상수를 쓴다(제목·주기 리터럴이 크론 파일에 다시 적히지 않는다 — 정본 둘 금지)
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { CrmService } from '../../src/modules/crm/crm.service';
import { CRM_OUTBOUND_JOBS, CRM_OUTBOUND_JOB_LIST } from '../../src/modules/crm/crm-reminder-jobs';
import { CampaignLogsQueryDto } from '../../src/modules/crm/dto/crm-logs-query.dto';

function makeService(prisma: Record<string, unknown>) {
  return new CrmService(prisma as never, {} as never);
}

describe('GET campaigns/:id/logs', () => {
  const rows = [
    { id: 'l1', patientId: 'p1', channel: 'SMS', status: 'SIMULATED', errorMessage: 'SIMULATED_NO_PROVIDER', sentAt: new Date(), deliveredAt: null, openedAt: null, createdAt: new Date(), patient: { familyName: '김', givenName: '가' } },
    { id: 'l2', patientId: 'p2', channel: 'SMS', status: 'FAILED', errorMessage: 'NO_CONTACT', sentAt: null, deliveredAt: null, openedAt: null, createdAt: new Date(), patient: { familyName: '이', givenName: '나' } },
  ];
  const groups = [
    { status: 'SENT', errorMessage: null, _count: { _all: 3 } },
    { status: 'SIMULATED', errorMessage: 'SIMULATED_NO_PROVIDER', _count: { _all: 5 } },
    { status: 'FAILED', errorMessage: 'NO_CONTACT', _count: { _all: 2 } },
    { status: 'FAILED', errorMessage: 'CONSENT_DENIED', _count: { _all: 1 } },
  ];

  function prismaWith() {
    return {
      crmCampaign: { findUnique: vi.fn().mockResolvedValue({ id: 'c1' }) },
      crmCampaignLog: {
        findMany: vi.fn().mockResolvedValue(rows),
        count: vi.fn().mockResolvedValue(2),
        groupBy: vi.fn().mockResolvedValue(groups),
      },
    };
  }

  it('① 판정을 그대로 — SIMULATED 는 따로·요약은 캠페인 전체(필터 무관)·도달 NOT_AVAILABLE', async () => {
    const prisma = prismaWith();
    const r = await makeService(prisma).getCampaignLogs('c1', { status: 'FAILED', page: 1, limit: 50 });
    expect(r.summary.byStatus).toEqual({ SENT: 3, SIMULATED: 5, FAILED: 3 });
    expect(r.summary.total).toBe(11);
    expect(r.summary.deliveryTracking).toBe('NOT_AVAILABLE');
    expect(r.summary.byReason.find((x) => x.reason === 'CONSENT_DENIED')?.count).toBe(1);
    // 목록만 필터를 받는다
    expect(prisma.crmCampaignLog.findMany.mock.calls[0][0].where).toEqual({ campaignId: 'c1', status: 'FAILED' });
    expect(prisma.crmCampaignLog.groupBy.mock.calls[0][0].where).toEqual({ campaignId: 'c1' });
    expect(r.data[0]).toMatchObject({ status: 'SIMULATED', reason: 'SIMULATED_NO_PROVIDER', patientName: '김가' });
  });

  it('② 없는 캠페인은 404 · 잘못된 status 필터는 DTO 에서 거절', async () => {
    const prisma = prismaWith();
    prisma.crmCampaign.findUnique.mockResolvedValue(null);
    await expect(makeService(prisma).getCampaignLogs('x', {})).rejects.toBeInstanceOf(NotFoundException);
    const bad = validateSync(plainToInstance(CampaignLogsQueryDto, { status: 'DELIVERED_OK', limit: '999' }));
    expect(bad.map((e) => e.property).sort()).toEqual(['limit', 'status']);
    expect(validateSync(plainToInstance(CampaignLogsQueryDto, { status: 'SIMULATED', page: '2', limit: '50' }))).toEqual([]);
  });
});

describe('GET automation/reminders', () => {
  it('③ 크론 정본 제목으로만 귀속·마지막 실행 null·수동 실행 없음', async () => {
    const prisma = {
      patientCommunicationLog: {
        groupBy: vi.fn()
          .mockResolvedValueOnce([
            { subject: CRM_OUTBOUND_JOBS.appointment.subjects[0], status: 'SIMULATED', _count: { _all: 4 } },
            { subject: CRM_OUTBOUND_JOBS.checkup.subjects[1], status: 'FAILED', _count: { _all: 1 } },
          ])
          .mockResolvedValueOnce([
            { subject: CRM_OUTBOUND_JOBS.appointment.subjects[0], _max: { createdAt: new Date('2026-09-13T00:00:00Z') } },
          ]),
      },
    };
    const r = await makeService(prisma).getReminderAutomation(7);
    const where = prisma.patientCommunicationLog.groupBy.mock.calls[0][0].where;
    expect(where.subject.in).toEqual(CRM_OUTBOUND_JOB_LIST.flatMap((j) => [...j.subjects]));
    const appt = r.jobs.find((j) => j.key === CRM_OUTBOUND_JOBS.appointment.key)!;
    expect(appt.tally).toEqual({ SIMULATED: 4 });
    expect(appt.lastRecordedAt?.toISOString()).toBe('2026-09-13T00:00:00.000Z');
    const dental = r.jobs.find((j) => j.key === CRM_OUTBOUND_JOBS.dental.key)!;
    expect(dental).toMatchObject({ attempted: 0, lastRecordedAt: null });
    expect(r.lastRunAt).toBeNull();
    expect(r.manualRun.available).toBe(false);
    expect(r.configGate).toBeNull();
  });

  it('④ 크론 파일이 제목·주기 리터럴을 다시 적지 않는다(정본 상수 사용)', () => {
    const src = readFileSync(join(__dirname, '../../src/modules/crm/crm-cron.service.ts'), 'utf8');
    for (const j of CRM_OUTBOUND_JOB_LIST) {
      for (const s of j.subjects) expect(src.includes(`'${s}'`), `${j.key} 제목 리터럴: ${s}`).toBe(false);
      expect(src.includes(`'${j.cron}', { name: '${j.key}'`), `${j.key} 주기 리터럴`).toBe(false);
      expect(src).toMatch(new RegExp(`@Cron\\(J\\.\\w+\\.cron, \\{ name: J\\.\\w+\\.key \\}\\)`));
    }
  });
});
