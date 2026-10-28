import { describe, it, expect, vi } from 'vitest';
import { QueueDisplayService } from '../../src/modules/waiting-queue/queue-display.service';
import { WaitingQueueService } from '../../src/modules/waiting-queue/waiting-queue.service';

/**
 * 외래 대기 전광판 공개 표면 계약 — `/api/v1/queue/public/*` (무인증·대기실 TV).
 *
 * 이 스펙이 깨지면 대기실 화면을 보는 누구나 PHI 를 본다.
 * `public-display-masking.spec.ts`(maskName 단위)를 **서비스 응답 레벨**로 끌어올려,
 * 개별 대기 행·호출 이벤트가 마스킹 이름과 화이트리스트 필드만 내보내도록 고정한다.
 * (ER 흐름 보드 `er-flow-display.spec.ts` 선례와 같은 등급.)
 */

const QUEUE_ROW = {
  id: 'q1', queueNumber: 5, status: 'WAITING', roomName: '3진료실',
  type: 'OUTPATIENT', visitType: 'FIRST', departmentName: '순환기내과',
  checkedInAt: new Date('2026-08-06T00:10:00Z'), calledAt: null, startedAt: null, callCount: 0,
  priorityOrder: 0,
  patient: { familyName: '홍', givenName: '길동' },
  doctor: { familyName: '김', givenName: '의사' },
};

const CALLED_ROW = {
  ...QUEUE_ROW, id: 'q2', queueNumber: 6, status: 'CALLED',
  calledAt: new Date('2026-08-06T00:20:00Z'), callCount: 1,
};

function build(prisma: unknown) {
  const queueSvc = new WaitingQueueService(prisma as never, { emit: vi.fn() } as never);
  return new QueueDisplayService(prisma as never, queueSvc);
}

/** getDisplay: findMany 를 2회(표시 대기 행 → 통계용 전체) 호출한다. */
function makeDisplaySvc(opts: { queues?: unknown[]; lastCalled?: unknown } = {}) {
  const rows = opts.queues ?? [QUEUE_ROW];
  const prisma = {
    waitingQueue: {
      findMany: vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce(rows),
      findFirst: vi.fn().mockResolvedValue(opts.lastCalled ?? CALLED_ROW),
    },
  };
  return build(prisma);
}

/** getCallEvents: findMany 를 1회(이벤트 목록) 호출한다. */
function makeEventsSvc(events: unknown[] = [CALLED_ROW]) {
  const prisma = {
    waitingQueue: {
      findMany: vi.fn().mockResolvedValue(events),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  return build(prisma);
}

const ROW_ALLOWED = [
  'queueNumber', 'status', 'patientName', 'roomName', 'doctorName',
  'type', 'visitType', 'checkedInAt', 'calledAt', 'startedAt', 'waitMinutes', 'callCount',
].sort();

const EVENT_ALLOWED = [
  'eventId', 'eventType', 'departmentName', 'queueNumber',
  'patientName', 'roomName', 'doctorName', 'calledAt', 'callCount', 'ttsText',
].sort();

describe('QueueDisplayService.getDisplay (공개 전광판)', () => {
  it('환자 이름은 마스킹(홍○동) — 원본 실명·familyName 이 절대 없다', async () => {
    const res = await makeDisplaySvc().getDisplay({});
    const row = res.data.departments[0].queues[0] as Record<string, unknown>;
    expect(row.patientName).toBe('홍○동');
    expect(JSON.stringify(res)).not.toContain('홍길동'); // 어디에도 원본 실명 없음
  });

  it('대기 행 화이트리스트 — mrn·phone·birthDate·patient(원본) 이 새지 않는다', async () => {
    const res = await makeDisplaySvc().getDisplay({});
    const row = res.data.departments[0].queues[0] as Record<string, unknown>;
    for (const banned of ['mrn', 'phone', 'dateOfBirth', 'birthDate', 'patient', 'familyName', 'givenName', 'patientId']) {
      expect(row).not.toHaveProperty(banned);
    }
    expect(Object.keys(row).sort()).toEqual(ROW_ALLOWED);
  });

  it('의료진 이름도 공개 전광판에선 마스킹(김○사) — 실명 노출 금지', async () => {
    const res = await makeDisplaySvc().getDisplay({});
    const row = res.data.departments[0].queues[0] as Record<string, unknown>;
    expect(row.doctorName).toBe('김○사');
    expect(JSON.stringify(res)).not.toContain('김의사');
  });

  it('lastCall.ttsText 는 진료실 번호를 정확히 방송한다("3번 진료실로 오세요")', async () => {
    const res = await makeDisplaySvc().getDisplay({});
    expect(res.data.lastCall?.ttsText).toBe('순환기내과 6번 홍○동님, 3번 진료실로 오세요');
  });

  it('🔴 검사실 roomName 도 조사 안 깨진다("심전도실로 오세요") — 종전 "심전도실번 진료실로" 회귀 차단', async () => {
    const res = await makeDisplaySvc({ lastCalled: { ...CALLED_ROW, roomName: '심전도실' } }).getDisplay({});
    expect(res.data.lastCall?.ttsText).toBe('순환기내과 6번 홍○동님, 심전도실로 오세요');
    expect(res.data.lastCall?.ttsText).not.toContain('번 진료실');
  });
});

describe('QueueDisplayService.getCallEvents (공개 호출 이벤트)', () => {
  it('이벤트 이름 마스킹 + 화이트리스트 — 원본 실명·patient 원본 없음', async () => {
    const res = await makeEventsSvc().getCallEvents({});
    const ev = res.data.events[0] as Record<string, unknown>;
    expect(ev.patientName).toBe('홍○동');
    expect(ev.doctorName).toBe('김○사');
    for (const banned of ['mrn', 'patient', 'familyName', 'givenName', 'patientId']) {
      expect(ev).not.toHaveProperty(banned);
    }
    expect(Object.keys(ev).sort()).toEqual(EVENT_ALLOWED);
    expect(JSON.stringify(res)).not.toContain('홍길동');
  });

  it('이벤트 ttsText 도 정확 문구(마스킹 이름 사용)', async () => {
    const res = await makeEventsSvc().getCallEvents({});
    expect(res.data.events[0].ttsText).toBe('순환기내과 6번 홍○동님, 3번 진료실로 오세요');
  });
});
