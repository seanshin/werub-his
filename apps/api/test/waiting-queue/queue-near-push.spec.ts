/**
 * 포털 B3 — 진료 차례 임박 푸시(2026-10-26).
 *  · 🔴 기준(앞 인원)은 원내 정책 — 미설정·형식 밖이면 아무것도 만들지 않는다(지어낸 기본값 없음)
 *  · 앞 인원 = 같은 과 오늘 WAITING 중 번호가 앞선 수(대기 현황 화면과 같은 정의) · 기준 이하 대기표만
 *  · 🔴 같은 대기표에 두 번 보내지 않는다(원장 data.queueId) · 실패가 대기열 동작을 막지 않는다
 *  · 수신부 문구에 이름·진료실 없음 · 대기표 id 를 원장에 남긴다 · 계약: 옵트인 없음·야간 억제 예외·기본 OFF
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { WaitingQueueService } from '../../src/modules/waiting-queue/waiting-queue.service';
import { NotificationListener } from '../../src/modules/notification/notification.listener';
import { normalizeQueueNearAhead, PATIENT_PUSH_TYPES, PATIENT_PUSH_QUEUE_NEAR_AHEAD_KEY } from '../../src/modules/notification/patient-push.contract';

function svcWith(opts: { ahead?: unknown; dept?: string | null; waiting?: { id: string; patientId: string; queueNumber: number }[]; notified?: string[]; fail?: boolean }) {
  const emitted: any[] = [];
  const prisma: any = {
    waitingQueue: {
      findUnique: vi.fn(async () => { if (opts.fail) throw new Error('db down'); return opts.dept === null ? null : { departmentName: opts.dept ?? '내과' }; }),
      findMany: vi.fn(async ({ take }: any) => (opts.waiting ?? []).slice(0, take)),
    },
    patientNotification: { findFirst: vi.fn(async ({ where }: any) => ((opts.notified ?? []).includes(where.data.equals) ? { id: 'n' } : null)) },
  };
  const ee: any = { emit: vi.fn(), emitAsync: vi.fn(async (name: string, p: any) => { emitted.push({ name, ...p }); return []; }) };
  const config: any = { get: vi.fn(async () => opts.ahead) };
  return { svc: new WaitingQueueService(prisma, ee, undefined, config), prisma, emitted, config };
}
const W = [{ id: 'q1', patientId: 'p1', queueNumber: 3 }, { id: 'q2', patientId: 'p2', queueNumber: 5 }, { id: 'q3', patientId: 'p3', queueNumber: 9 }];

describe('🔴 차례 임박 — 기준이 없으면 만들지 않는다', () => {
  it('미설정·형식 밖 = null · 0~10 정수만', () => {
    for (const v of [null, undefined, '', '3명', -1, 11, 1.5, {}, true]) expect(normalizeQueueNearAhead(v), String(v)).toBeNull();
    expect(normalizeQueueNearAhead(0)).toBe(0);
    expect(normalizeQueueNearAhead('2')).toBe(2);
    expect(normalizeQueueNearAhead(10)).toBe(10);
  });
  it('기준 미설정이면 대기열을 읽지도 않는다 · 아무것도 안 보낸다', async () => {
    const m = svcWith({ ahead: null, waiting: W });
    expect(await m.svc.notifyQueueNear({ queueId: 'q1' })).toBe(0);
    expect(m.config.get).toHaveBeenCalledWith(PATIENT_PUSH_QUEUE_NEAR_AHEAD_KEY);
    expect(m.prisma.waitingQueue.findMany).not.toHaveBeenCalled();
    expect(m.emitted).toHaveLength(0);
  });
});

describe('기준 이하 대기표에 한 번', () => {
  it('기준 1 → 앞 0명·1명까지(번호순) · 앞 인원을 실어 보낸다 · 2명 이상은 안 보낸다', async () => {
    const m = svcWith({ ahead: 1, waiting: W });
    expect(await m.svc.notifyQueueNear({ queueId: 'qX' })).toBe(2);
    expect(m.emitted).toEqual([
      { name: 'patient.queue_near', patientId: 'p1', queueId: 'q1', departmentName: '내과', aheadCount: 0 },
      { name: 'patient.queue_near', patientId: 'p2', queueId: 'q2', departmentName: '내과', aheadCount: 1 },
    ]);
    expect(m.prisma.waitingQueue.findMany.mock.calls[0][0]).toMatchObject({ where: { departmentName: '내과', status: 'WAITING' }, orderBy: { queueNumber: 'asc' }, take: 2 });
  });
  it('🔴 같은 대기표에는 두 번 보내지 않는다(원장 data.queueId)', async () => {
    const m = svcWith({ ahead: 1, waiting: W, notified: ['q1'] });
    await m.svc.notifyQueueNear({ queueId: 'qX' });
    expect(m.emitted.map((e) => e.queueId)).toEqual(['q2']);
    expect(m.prisma.patientNotification.findFirst.mock.calls[0][0].where).toEqual({ type: 'QUEUE_NEAR', data: { path: ['queueId'], equals: 'q1' } });
  });
  it('대기표를 못 찾거나 과가 없으면 아무것도 안 한다 · 실패는 삼키고 0(대기열 동작을 막지 않는다)', async () => {
    expect(await svcWith({ ahead: 1, dept: null, waiting: W }).svc.notifyQueueNear({ queueId: 'q?' })).toBe(0);
    const f = svcWith({ ahead: 1, fail: true, waiting: W });
    expect(await f.svc.notifyQueueNear({ queueId: 'q1' })).toBe(0);
    expect(f.emitted).toHaveLength(0);
  });
});

describe('수신부·계약', () => {
  it('게이트로 보낸다 · 대기표 id 를 원장에 · 문구에 이름·진료실 없음 · 앞 0명은 "다음 차례"', async () => {
    const deliver = vi.fn(async () => ({ attempted: true, sent: true, reason: 'SENT', pushChannel: 'ATTEMPTED' }));
    const l = Object.create(NotificationListener.prototype);
    l.patientPush = { deliver };
    await l.handlePatientQueueNear({ patientId: 'p2', queueId: 'q2', departmentName: '내과', aheadCount: 1 });
    expect(deliver).toHaveBeenCalledWith('p2', 'QUEUE_NEAR', '진료 차례가 다가왔습니다', '내과 앞 대기 1명입니다. 진료실 근처에서 기다려 주세요.', { data: { queueId: 'q2' } });
    await l.handlePatientQueueNear({ patientId: 'p1', queueId: 'q1', departmentName: '내과', aheadCount: 0 });
    expect((deliver.mock.calls[1] as unknown[])[3]).toContain('다음 차례');
  });
  it('계약 — 옵트인 없음(시스템)·야간 억제 예외(원내 대기)·설정 기본 OFF·기준 기본값 없음', () => {
    expect(PATIENT_PUSH_TYPES.QUEUE_NEAR).toMatchObject({ requiresOptIn: false, quietHoursExempt: true, alertCode: 'PATIENT_PUSH_QUEUE_NEAR' });
    const src = readFileSync(join(__dirname, '../../src/modules/config/config-runtime.service.ts'), 'utf8');
    expect(src).toMatch(/'notification\.patientPush\.types\.QUEUE_NEAR': \{ key: 'notification\.patientPush\.types\.QUEUE_NEAR', value: false,/);
    expect(src).toMatch(/'notification\.patientPush\.queueNearAhead': \{ key: 'notification\.patientPush\.queueNearAhead', value: null,/);
  });
});

describe('🔴 관리 화면 설정 응답 — 기준 미설정이면 켜도 안 나간다고 말한다', () => {
  async function settingsWith(cfg: Record<string, unknown>) {
    const { PatientPushGateService } = await import('../../src/modules/notification/patient-push-gate.service');
    const svc = new PatientPushGateService({} as never, { isEnabled: true } as never, { get: vi.fn(async (k: string) => cfg[k] ?? null) } as never);
    return (await svc.settings()).types.find((t: { type: string }) => t.type === 'QUEUE_NEAR') as Record<string, unknown>;
  }
  const ON = { 'notification.patientPush.enabled': true, 'notification.patientPush.types.QUEUE_NEAR': true };
  it('마스터·유형 켜짐 + 기준 미설정 → effective false · THRESHOLD_UNSET · 기준 null', async () => {
    const t = await settingsWith(ON);
    expect(t).toMatchObject({ enabled: true, effective: false, blockedBy: 'THRESHOLD_UNSET', threshold: { key: 'notification.patientPush.queueNearAhead', aheadCount: null } });
  });
  it('대조군 — 기준 2 → effective true · 막힘 없음 · 마스터 꺼짐이면 MASTER_OFF', async () => {
    expect(await settingsWith({ ...ON, 'notification.patientPush.queueNearAhead': 2 })).toMatchObject({ effective: true, blockedBy: null, threshold: { aheadCount: 2 } });
    expect(await settingsWith({ 'notification.patientPush.types.QUEUE_NEAR': true, 'notification.patientPush.queueNearAhead': 2 })).toMatchObject({ effective: false, blockedBy: 'MASTER_OFF' });
  });
});
