import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { CRITICAL_VALUE_ACK_ROLES } from '@hospital-run/shared';
import { LabService } from '../../src/modules/lab/lab.service';
import { LabController } from '../../src/modules/lab/lab.controller';
import { matchesWhere } from '../common/prisma-where-eval';

/**
 * 🔴 (2026-09-30) **상향된(ESCALATED) 위급값이 아무에게도 닿지 않았다.**
 *
 * 크론(`CriticalValueEscalationService`)은 허용시간을 넘긴 미확인 경보를 ESCALATED 로 표시했지만,
 * 미확인 목록은 여전히 "담당의 본인 + 담당의 미지정"만 보여줬다 — 부재라서 넘긴 경보를 **그 부재한 담당의에게만**.
 * 대리 확인 경로(사유 필수)는 서버에 있었는데, 남의 경보가 화면에 뜨지 않으니 도달할 수 없었다.
 *
 * 지키는 것:
 *  ① ESCALATED 는 위급값 통보 대상 역할(shared `CRITICAL_VALUE_ACK_ROLES`) **전원**의 목록에 뜬다
 *  ② 남의 PENDING 은 여전히 뜨지 않는다(대조군 — 전건을 풀어 경보 피로를 만들지 않는다)
 *  ③ 남의 경보임을 표시한다(escalatedFromOther·assignedDoctor) · 확인 권한은 서버가 판정(canAcknowledge)
 *  ④ 남의 상향 경보를 확인하려면 기존 대리 확인 경로 — 사유 없으면 403
 *  ⑤ 상한에서 잘릴 때 상향 경보가 먼저 잘리지 않는다 · 총수를 함께 말한다
 */

const ME = 'doc-me';
const OTHER = 'doc-other';
const base = { labResultId: 'lr', patientId: 'p-1', testName: 'K', value: '7.2', unit: 'mEq/L', reason: '위급 고치', readBackConfirmed: false, acknowledgedBy: null, acknowledgedAt: null, escalatedAt: null };
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

function alerts() {
  return [
    { ...base, id: 'mine-pending', doctorId: ME, status: 'PENDING', notifiedAt: minutesAgo(1) },
    { ...base, id: 'other-pending', doctorId: OTHER, status: 'PENDING', notifiedAt: minutesAgo(2) },
    { ...base, id: 'other-escalated', doctorId: OTHER, status: 'ESCALATED', notifiedAt: minutesAgo(90), escalatedAt: minutesAgo(60) },
    { ...base, id: 'unassigned-pending', doctorId: null, status: 'PENDING', notifiedAt: minutesAgo(3) },
    { ...base, id: 'other-acked', doctorId: OTHER, status: 'ACKNOWLEDGED', notifiedAt: minutesAgo(200) },
  ];
}

function makeLab(rows = alerts()) {
  const prisma: any = {
    criticalValueAlert: {
      findMany: vi.fn(async ({ where, orderBy, take }: any) => {
        let out = rows.filter((r) => matchesWhere(r, where));
        // orderBy [{status:'asc'},{notifiedAt:'desc'}] 를 그대로 적용한다(서비스가 넘긴 순서대로)
        const ob = Array.isArray(orderBy) ? orderBy : [orderBy];
        out = out.sort((a: any, b: any) => {
          for (const o of ob) {
            const [k, dir] = Object.entries(o)[0] as [string, 'asc' | 'desc'];
            const av = a[k] instanceof Date ? a[k].getTime() : a[k];
            const bv = b[k] instanceof Date ? b[k].getTime() : b[k];
            if (av < bv) return dir === 'asc' ? -1 : 1;
            if (av > bv) return dir === 'asc' ? 1 : -1;
          }
          return 0;
        });
        return take ? out.slice(0, take) : out;
      }),
      count: vi.fn(async ({ where }: any) => rows.filter((r) => matchesWhere(r, where)).length),
      findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => ({ ...rows.find((r) => r.id === where.id), ...data })),
    },
    patient: { findMany: vi.fn().mockResolvedValue([{ id: 'p-1', familyName: '홍', givenName: '길동', mrn: 'M1' }]) },
    user: { findMany: vi.fn(async ({ where }: any) => (where.id.in as string[]).includes(OTHER) ? [{ id: OTHER, familyName: '김', givenName: '담당' }] : []) },
  };
  return { service: new LabService(prisma, {} as any, {} as any, {} as any), prisma };
}

describe('① 상향된 경보는 통보 대상 역할 전원에게 보인다', () => {
  for (const role of CRITICAL_VALUE_ACK_ROLES) {
    it(`🔴 ${role} 목록에 남의 ESCALATED 경보가 있다`, async () => {
      const { service } = makeLab();
      const rows = await service.getPendingCriticalAlerts(ME, role);
      expect(rows.map((r) => r.id)).toContain('other-escalated');
    });
  }

  it('② 대조군: 남의 PENDING·이미 확인된 경보는 어느 역할에도 뜨지 않는다', async () => {
    for (const role of CRITICAL_VALUE_ACK_ROLES) {
      const { service } = makeLab();
      const ids = (await service.getPendingCriticalAlerts(ME, role)).map((r) => r.id);
      expect(ids, role).not.toContain('other-pending');
      expect(ids, role).not.toContain('other-acked');
    }
  });

  it('대조군: 의사는 종전처럼 내 것 + 담당의 미지정을 계속 본다 · 간호는 담당의 미지정 PENDING 을 보지 않는다', async () => {
    const doc = (await makeLab().service.getPendingCriticalAlerts(ME, 'DOCTOR')).map((r) => r.id);
    expect(doc).toEqual(expect.arrayContaining(['mine-pending', 'unassigned-pending', 'other-escalated']));
    const nurse = (await makeLab().service.getPendingCriticalAlerts('nurse-1', 'NURSE')).map((r) => r.id);
    expect(nurse).toEqual(['other-escalated']);
  });
});

describe('③ 남의 경보임을 말하고, 확인 권한은 서버가 판정한다', () => {
  it('escalatedFromOther·assignedDoctor 가 실린다 — 내 것·미지정에는 붙지 않는다', async () => {
    const rows = await makeLab().service.getPendingCriticalAlerts(ME, 'DOCTOR');
    const esc = rows.find((r) => r.id === 'other-escalated')!;
    expect(esc.escalatedFromOther).toBe(true);
    expect(esc.assignedDoctor).toEqual({ id: OTHER, familyName: '김', givenName: '담당' });
    expect(rows.find((r) => r.id === 'mine-pending')!.escalatedFromOther).toBe(false);
    expect(rows.find((r) => r.id === 'unassigned-pending')!.escalatedFromOther).toBe(false);
  });

  it('canAcknowledge — 의사·관리자 true, 간호·검사 false(보되 확인 EP 는 403 이라 버튼을 주지 않는다)', async () => {
    for (const [role, can] of [['DOCTOR', true], ['ADMIN', true], ['NURSE', false], ['LAB_TECH', false]] as const) {
      const rows = await makeLab().service.getPendingCriticalAlerts(ME, role);
      expect(rows.every((r) => r.canAcknowledge === can), role).toBe(true);
    }
  });
});

describe('④ 남의 상향 경보 확인은 기존 대리 확인 경로(사유 필수)', () => {
  it('🔴 사유 없이 확인하면 403 — 상향됐다고 사유 요구가 풀리지 않는다', async () => {
    const { service } = makeLab();
    await expect(service.acknowledgeCriticalAlert('other-escalated', ME, { readBack: false, responseAction: '당직 조치' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('사유가 있으면 대리 확인으로 기록된다(조치란 머리 [대리확인])', async () => {
    const { service, prisma } = makeLab();
    await service.acknowledgeCriticalAlert('other-escalated', ME, { readBack: false, responseAction: '당직 조치', delegationReason: '담당의 수술 중' });
    const data = prisma.criticalValueAlert.update.mock.calls[0][0].data;
    expect(data.status).toBe('ACKNOWLEDGED');
    expect(data.acknowledgedBy).toBe(ME);
    expect(String(data.responseAction)).toContain(LabService.DELEGATED_ACK_PREFIX);
  });
});

describe('⑤ 상한과 총수', () => {
  it('상한(50)보다 많으면 상향 경보가 앞에 서고, 컨트롤러가 총수를 meta 로 함께 준다', async () => {
    const rows = [
      ...Array.from({ length: 60 }, (_, i) => ({ ...base, id: `mine-${i}`, doctorId: ME, status: 'PENDING', notifiedAt: minutesAgo(i) })),
      { ...base, id: 'old-escalated', doctorId: OTHER, status: 'ESCALATED', notifiedAt: minutesAgo(600), escalatedAt: minutesAgo(500) },
    ];
    const { service } = makeLab(rows as never);
    const ctl = new LabController(service, {} as never);
    const res = await ctl.getPendingCriticalAlerts(ME, 'DOCTOR');
    expect(res.data).toHaveLength(LabService.PENDING_CRITICAL_LIMIT);
    expect(res.data[0].id).toBe('old-escalated');
    expect(res.meta).toEqual({ total: 61, limit: LabService.PENDING_CRITICAL_LIMIT });
  });
});
