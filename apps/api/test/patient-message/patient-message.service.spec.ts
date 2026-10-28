/**
 * 🔴 (2026-09-14) 환자↔담당의 메시지 직원 측 — 환자 메시지를 읽는 곳이 환자 본인 목록뿐이라 **아무에게도 도달하지 않았다.**
 * 지키는 것:
 *  ① DOCTOR 는 자기 지정분 + 담당 미지정분만 본다(다른 의사 것은 안 본다) — 전건 역할은 전건
 *  ② 열람 역할이 아니면 거부(LAB_TECH 등)
 *  ③ 담당 미지정은 "누가 받는지 모른다"로 드러난다(임의 배정 없음 · 열람만으로 읽음 처리하지 않음)
 *  ④ 답변은 DOCTOR 만 · sender 'DOCTOR' 로 저장 · 범위 안 환자 메시지가 없으면 거부
 *  ⑤ 환자 앱 알림 결과는 게이트가 준 그대로(리스너 0 이면 NO_LISTENER — 보냈다고 하지 않는다)
 *  ⑥ 환자 전송 시 지정 의사에게만 알린다 · 미지정은 알리지 않는다 · 알림에 본문을 싣지 않는다
 */
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientMessageService } from '../../src/modules/patient-message/patient-message.service';
import { PatientMessageListener } from '../../src/modules/patient-message/patient-message.listener';
import { messageScopeFor, scopeWhere } from '../../src/modules/patient-message/patient-message.policy';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PID = '33333333-3333-4333-8333-333333333333';
const at = (m: number) => new Date(Date.UTC(2026, 8, 14, 0, m));

type Row = { id: string; patientId: string; doctorId: string | null; sender: string; isRead: boolean; content: string; createdAt: Date };

function matches(row: Row, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR') { if (!(v as any[]).some((w) => matches(row, w))) return false; continue; }
    if ((row as any)[k] !== v) return false;
  }
  return true;
}

function makePrisma(rows: Row[]) {
  const doctor = (id: string | null) => (id ? { id, familyName: id === ME ? '나' : '타', givenName: '의사', department: '내과' } : null);
  const prisma: any = {
    patient: { findUnique: vi.fn().mockResolvedValue({ id: PID, familyName: '홍', givenName: '길동', mrn: 'P-1' }) },
    patientMessage: {
      findMany: vi.fn(async ({ where, take }: any) =>
        rows.filter((r) => matches(r, where)).sort((a, b) => +b.createdAt - +a.createdAt).slice(0, take ?? 999)
          .map((r) => ({ ...r, doctor: doctor(r.doctorId), patient: { familyName: '홍', givenName: '길동', mrn: 'P-1' } }))),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
      create: vi.fn(async ({ data }: any) => { const r = { id: `new-${rows.length}`, isRead: false, createdAt: at(99), ...data }; rows.push(r); return r; }),
    },
  };
  prisma.$transaction = vi.fn(async (fn: any) => fn(prisma));
  return prisma;
}

const baseRows = (): Row[] => [
  { id: 'm1', patientId: PID, doctorId: ME, sender: 'PATIENT', isRead: false, content: '내게 온 것', createdAt: at(1) },
  { id: 'm2', patientId: PID, doctorId: OTHER, sender: 'PATIENT', isRead: false, content: '다른 의사 것', createdAt: at(2) },
  { id: 'm3', patientId: PID, doctorId: null, sender: 'PATIENT', isRead: false, content: '미지정', createdAt: at(3) },
];

describe('정책 — 열람 범위', () => {
  it('① DOCTOR=본인+미지정 · 전건 역할=ALL · ② 열람 역할 아님=null', () => {
    expect(messageScopeFor('DOCTOR')).toBe('MINE_AND_UNASSIGNED');
    expect(messageScopeFor('NURSE')).toBe('ALL');
    expect(messageScopeFor('ADMIN')).toBe('ALL');
    expect(messageScopeFor('LAB_TECH')).toBeNull();
    expect(messageScopeFor('RECEPTIONIST')).toBeNull();
    expect(scopeWhere('MINE_AND_UNASSIGNED', ME)).toEqual({ OR: [{ doctorId: ME }, { doctorId: null }] });
    expect(scopeWhere('ALL', ME)).toEqual({});
  });
});

describe('PatientMessageService', () => {
  let rows: Row[];
  let prisma: any;
  let journey: any;
  let events: any;
  let svc: PatientMessageService;

  beforeEach(() => {
    rows = baseRows();
    prisma = makePrisma(rows);
    journey = { emit: vi.fn() };
    events = { emitAsync: vi.fn().mockResolvedValue([]) };
    svc = new PatientMessageService(prisma, journey, events);
  });

  it('① DOCTOR 스레드는 다른 의사에게 온 메시지를 싣지 않는다 · 미지정은 UNASSIGNED 로 드러난다', async () => {
    const t = await svc.thread({ id: ME, role: 'DOCTOR' }, PID);
    expect(t.messages.map((m) => m.id).sort()).toEqual(['m1', 'm3']);
    expect(t.messages.find((m) => m.id === 'm3')!.assignment).toBe('UNASSIGNED');
    expect(t.messages.find((m) => m.id === 'm1')!.assignment).toBe('MINE');
  });

  it('① 대조군 — NURSE 는 전건을 본다(다른 의사 것 포함) · 읽음 처리는 하지 않는다', async () => {
    const t = await svc.thread({ id: ME, role: 'NURSE' }, PID);
    expect(t.messages).toHaveLength(3);
    expect(t.canReply).toBe(false);
    expect(t.replyBlocked).toBe('NOT_DOCTOR');
    expect(prisma.patientMessage.updateMany).not.toHaveBeenCalled();
  });

  it('② 열람 역할이 아니면 거부한다', async () => {
    await expect(svc.inbox({ id: ME, role: 'LAB_TECH' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.thread({ id: ME, role: 'RECEPTIONIST' }, PID)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('③ DOCTOR 가 열면 **나에게 지정된** 환자 메시지만 읽음 — 미지정·다른 의사 것은 그대로', async () => {
    await svc.thread({ id: ME, role: 'DOCTOR' }, PID);
    expect(rows.find((r) => r.id === 'm1')!.isRead).toBe(true);
    expect(rows.find((r) => r.id === 'm3')!.isRead).toBe(false);
    expect(rows.find((r) => r.id === 'm2')!.isRead).toBe(false);
  });

  it('받은편지함은 본문을 싣지 않고, 미지정이 섞였음을 말한다', async () => {
    const box = await svc.inbox({ id: ME, role: 'DOCTOR' });
    expect(box.threads).toHaveLength(1);
    expect(box.threads[0].hasUnassigned).toBe(true);
    expect(box.threads[0].assignment).toBe('MINE');
    expect(box.threads[0].unreadFromPatient).toBe(2);
    expect(JSON.stringify(box)).not.toContain('내게 온 것');
    expect(box.truncated).toBe(false);
  });

  it('④ 답변은 sender DOCTOR 로 저장되고, 미지정 메시지는 답한 의사가 담당으로 기록된다', async () => {
    const r = await svc.reply({ id: ME, role: 'DOCTOR' }, PID, ' 네, 내원하세요 ');
    const created = rows.find((x) => x.id === r.id)!;
    expect(created.sender).toBe('DOCTOR');
    expect(created.doctorId).toBe(ME);
    expect(created.content).toBe('네, 내원하세요');
    expect(r.claimedUnassigned).toBe(1);
    expect(rows.find((x) => x.id === 'm3')!.doctorId).toBe(ME);
    // 다른 의사에게 온 것은 가져오지 않는다
    expect(rows.find((x) => x.id === 'm2')!.doctorId).toBe(OTHER);
    expect(journey.emit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'PATIENT_MESSAGE_REPLIED', refId: r.id }));
  });

  it('④ DOCTOR 가 아니면 답할 수 없다 · 범위 안 환자 메시지가 없으면 답할 수 없다', async () => {
    await expect(svc.reply({ id: ME, role: 'NURSE' }, PID, 'x')).rejects.toBeInstanceOf(ForbiddenException);
    rows.splice(0, rows.length, { id: 'o', patientId: PID, doctorId: OTHER, sender: 'PATIENT', isRead: false, content: 'x', createdAt: at(1) });
    await expect(svc.reply({ id: ME, role: 'DOCTOR' }, PID, 'x')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.patientMessage.create).not.toHaveBeenCalled();
  });

  it('⑤ 리스너가 없으면 NO_LISTENER — 환자 알림을 보냈다고 말하지 않는다', async () => {
    const r = await svc.reply({ id: ME, role: 'DOCTOR' }, PID, 'ok', true);
    expect(r.patientPush).toMatchObject({ sent: false, reason: 'NO_LISTENER' });
    expect(events.emitAsync).toHaveBeenCalledWith('patient.message_replied', expect.objectContaining({ patientId: PID, notifyPatient: true }));
  });

  it('⑤ 대조군 — 게이트가 SENT 를 주면 그대로 전달한다', async () => {
    events.emitAsync.mockResolvedValue([{ attempted: true, sent: true, reason: 'SENT', pushChannel: 'UNAVAILABLE' }]);
    const r = await svc.reply({ id: ME, role: 'DOCTOR' }, PID, 'ok', true);
    expect(r.patientPush).toEqual({ attempted: true, sent: true, reason: 'SENT', pushChannel: 'UNAVAILABLE' });
  });
});

describe('PatientMessageListener — 환자 전송 알림', () => {
  it('⑥ 지정 의사에게만 알리고 본문을 싣지 않는다 · 여정 이벤트는 남긴다', async () => {
    const notification = { notify: vi.fn().mockResolvedValue({}) };
    const journey = { emit: vi.fn() };
    const l = new PatientMessageListener(notification as any, journey as any);
    await l.onPatientMessageSent({ patientId: PID, messageId: 'm9', doctorId: ME });
    expect(notification.notify).toHaveBeenCalledWith(ME, expect.objectContaining({ type: 'PATIENT_MESSAGE', refId: 'm9' }));
    expect(journey.emit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'PATIENT_MESSAGE_SENT' }));
  });

  it('⑥ 담당 미지정이면 아무에게도 알리지 않는다(여정은 남긴다)', async () => {
    const notification = { notify: vi.fn() };
    const journey = { emit: vi.fn() };
    const l = new PatientMessageListener(notification as any, journey as any);
    await l.onPatientMessageSent({ patientId: PID, messageId: 'm9', doctorId: null });
    expect(notification.notify).not.toHaveBeenCalled();
    expect(journey.emit).toHaveBeenCalledTimes(1);
  });
});
