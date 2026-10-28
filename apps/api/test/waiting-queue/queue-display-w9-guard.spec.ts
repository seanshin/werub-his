import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueueDisplayService } from '../../src/modules/waiting-queue/queue-display.service';
import { WaitingQueueService } from '../../src/modules/waiting-queue/waiting-queue.service';

/**
 * 공개 전광판 W9 가드 — 2026-08-14 화면 실사용 점검(공개 화면 웨이브).
 *
 * 기존 `queue-display-public-contract.spec.ts` 는 **마스킹·화이트리스트**를 고정한다.
 * 이 스펙은 그 옆의 세 가지, 운영 실측에서 실제로 새어나온 것들을 고정한다:
 *  ① 🔴 `waitMinutes: -93` — 아직 오지 않은 접수 시각을 **경과 시간처럼** 실어 보냈다.
 *  ② 🔴 환자가 QR 로 여는 대기 확인이 **예상 대기 = 앞대기 × 상수 8분**을 날조했다.
 *  ③ 🔴 그 토큰 화면은 무인증인데 마스킹 계약 테스트가 없었다.
 */

const NOW = new Date('2026-08-14T06:00:00Z');

const QUEUE_ROW = {
  id: 'q1', queueNumber: 5, status: 'WAITING', roomName: '3진료실',
  type: 'OUTPATIENT', visitType: 'FIRST', departmentName: '순환기내과',
  checkedInAt: new Date('2026-08-14T05:00:00Z'), calledAt: null, startedAt: null, callCount: 0,
  priorityOrder: 0,
  patient: { familyName: '홍', givenName: '길동' },
  doctor: { familyName: '김', givenName: '의사' },
};

/** 🔴 실측(2026-08-14 운영 SSE): 현재보다 **앞선** 접수 시각이 섞여 있었다 */
const FUTURE_ROW = {
  ...QUEUE_ROW, id: 'q2', queueNumber: 26,
  checkedInAt: new Date('2026-08-14T07:33:00Z'), // 지금(06:00)보다 93분 뒤
};

function build(prisma: unknown) {
  const queueSvc = new WaitingQueueService(prisma as never, { emit: vi.fn() } as never);
  return new QueueDisplayService(prisma as never, queueSvc);
}

function makeDisplaySvc(rows: unknown[]) {
  const prisma = {
    waitingQueue: {
      findMany: vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce(rows),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  return build(prisma);
}

describe('🔴 전광판 대기시간 — 아직 오지 않은 시각은 경과가 아니다(P1)', () => {
  it('미래 접수 시각은 음수가 아니라 null 로 나간다', async () => {
    vi.setSystemTime(NOW);
    const res = await makeDisplaySvc([FUTURE_ROW]).getDisplay({});
    const row = res.data.departments[0].queues[0];
    // 종전엔 -93 이 그대로 실려 전광판이 '-1시간 33분'을 그렸다
    expect(row.waitMinutes).toBeNull();
    vi.useRealTimers();
  });

  it('정상 행은 종전대로 경과 분을 그대로 낸다(과잉 차단 아님)', async () => {
    vi.setSystemTime(NOW);
    const res = await makeDisplaySvc([QUEUE_ROW]).getDisplay({});
    expect(res.data.departments[0].queues[0].waitMinutes).toBe(60);
    vi.useRealTimers();
  });

  it('🔴 음수 대기 표본은 평균에서 제외한다 — 섞이면 대기가 실제보다 짧아 보인다', async () => {
    // 40분 정상 1건 + 접수보다 앞선 진료시작(-60분) 1건
    const good = { ...QUEUE_ROW, startedAt: new Date('2026-08-14T05:40:00Z') };
    const broken = {
      ...QUEUE_ROW, id: 'q3',
      checkedInAt: new Date('2026-08-14T05:00:00Z'),
      startedAt: new Date('2026-08-14T04:00:00Z'),
    };
    vi.setSystemTime(NOW);
    const res = await makeDisplaySvc([good, broken]).getDisplay({});
    const stats = res.data.departments[0].stats;
    expect(stats.avgWaitMinutes).toBe(40); // (40 + -60)/2 = -10 이 되면 안 된다
    expect(stats.waitSampleN).toBe(1);
    vi.useRealTimers();
  });
});

/** 환자가 번호표 QR 로 여는 무인증 화면 — `/api/v1/queue/public/waiting/:token` */
function makeWaitingSvc(opts: { status?: string; samples?: { checkedInAt: Date; startedAt: Date }[] } = {}) {
  const queue = {
    ...QUEUE_ROW,
    status: opts.status ?? 'WAITING',
    waitingToken: 'tok-1',
    doctorId: 'd1',
    doctor: { familyName: '김', givenName: '의사' },
  };
  const prisma = {
    waitingQueue: {
      findUnique: vi.fn().mockResolvedValue(queue),
      count: vi.fn().mockResolvedValue(5), // 앞대기 5명
      findMany: vi.fn().mockResolvedValue(opts.samples ?? []),
    },
  };
  return build(prisma);
}

describe('🔴 환자 대기 확인(무인증 토큰) — 예상 대기를 지어내지 않는다(P15)', () => {
  // 🔴 토큰 만료는 **접수일 다음날 자정** 기준이라 시각을 고정하지 않으면 며칠 뒤 전부 GONE 으로 죽는다.
  //    (2026-08-18 실측: 이 블록 4건이 시간 경과만으로 실패하고 있었다 — 썩은 가드는 가드가 아니다.)
  beforeEach(() => vi.setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  it('표본 0건이면 산출 불가(null) — 종전 `앞대기 × 8분` 상수 회귀 차단', async () => {
    const res = await makeWaitingSvc().getWaiting('tok-1');
    // 종전: Math.max(1, 5 * 8) = 40 이라는 근거 없는 숫자를 환자에게 보여줬다
    expect(res.data.estimatedWaitMinutes).toBeNull();
    expect(res.data.estimatedWaitMinutes).not.toBe(40);
    expect(res.data.estimatedWaitSampleN).toBe(0);
    expect(res.data.estimatedWaitBasis).toBe(
      '순환기내과 오늘 진료 시작 시각 기록이 없어 예상 대기시간을 산출할 수 없습니다',
    );
  });

  it('표본이 있으면 실측 평균으로 산출하고 근거를 함께 말한다', async () => {
    const samples = [
      { checkedInAt: new Date('2026-08-14T04:00:00Z'), startedAt: new Date('2026-08-14T04:20:00Z') }, // 20분
      { checkedInAt: new Date('2026-08-14T04:00:00Z'), startedAt: new Date('2026-08-14T04:40:00Z') }, // 40분
    ];
    const res = await makeWaitingSvc({ samples }).getWaiting('tok-1');
    // 평균 30분 · 앞대기 5 → round(30 * 6 / 2) = 90
    expect(res.data.estimatedWaitMinutes).toBe(90);
    expect(res.data.estimatedWaitSampleN).toBe(2);
    expect(res.data.estimatedWaitBasis).toBe('순환기내과 오늘 진료 시작 2건 기준(평균 대기 30분)');
  });

  it('대기 단계가 지났으면 0분이 아니라 null — 0 은 "곧 부른다"는 다른 뜻이다', async () => {
    const res = await makeWaitingSvc({ status: 'IN_CONSULTATION' }).getWaiting('tok-1');
    expect(res.data.estimatedWaitMinutes).toBeNull();
    expect(res.data.estimatedWaitBasis).toBe('진료 대기 단계가 지나 예상 대기시간을 안내하지 않습니다');
  });

  it('🔴 마스킹 계약 — 무인증 토큰 응답에 실명·MRN·생년월일이 어떤 경로로도 없다', async () => {
    const res = await makeWaitingSvc().getWaiting('tok-1');
    const body = JSON.stringify(res);
    expect(body).not.toContain('홍길동');
    expect(body).not.toContain('김의사'); // 의료진 실명도 공개 표면엔 싣지 않는다
    expect(res.data.doctorName).toBe('김○사');
    for (const banned of ['patientName', 'mrn', 'dateOfBirth', 'birthDate', 'patient', 'familyName', 'givenName', 'patientId', 'phone']) {
      expect(res.data, `공개 대기 확인 응답에 ${banned} 가 실린다`).not.toHaveProperty(banned);
    }
  });
});

describe('🔴 호출 방송 문구 — 진료실이 아닌 방에서 깨지지 않는다(정확 비교)', () => {
  const svc = build({ waitingQueue: { findMany: vi.fn(), findFirst: vi.fn() } });
  const tts = (room: string | null) =>
    (svc as unknown as { queueService: WaitingQueueService }).queueService
      .buildTtsText('순환기내과', 6, '홍○동', room, 1);

  it.each([
    ['3진료실', '순환기내과 6번 홍○동님, 3번 진료실로 오세요'],
    ['심전도실', '순환기내과 6번 홍○동님, 심전도실로 오세요'],
    ['내시경실1', '순환기내과 6번 홍○동님, 내시경실1로 오세요'],
    ['운동부하실', '순환기내과 6번 홍○동님, 운동부하실로 오세요'],
    ['채혈실', '순환기내과 6번 홍○동님, 채혈실로 오세요'],
  ])('%s → 정확히 "%s"', (room, expected) => {
    // 🔴 부분 문자열 단언은 깨진 출력을 숨긴다("심전도실번 진료실로" 가 그렇게 살아남았다) — 전문 비교
    expect(tts(room)).toBe(expected);
  });

  it('진료실 미배정(null)은 접수 창구로 — 방 이름 없이 "으로 오세요"가 되면 안 된다', () => {
    expect(tts(null)).toBe('순환기내과 6번 홍○동님, 접수 창구로 오세요');
  });
});
