import { describe, it, expect, vi } from 'vitest';
import { WaitingQueueService } from '../../src/modules/waiting-queue/waiting-queue.service';

/**
 * 환자 길안내 공개 표면 계약 — `/api/v1/guide/:queueId` (무인증·QR 스캔).
 *
 * QR 을 찍은 누구나 보는 화면이라, `getGuide` 는 성(姓)만 남기고 이름을 전부 가려야 한다
 * (getGuide 는 `maskName`(홍○동)이 아니라 자체 규칙 `홍○○` = 성+이름길이만큼 ○ 을 쓴다).
 * 화면에 없어야 할 필드(mrn·환자 원본)가 새면 이 스펙이 실패한다.
 */

/**
 * 🔴 (2026-09-16 H2) 픽스처 시각은 **오늘**이어야 한다 — `getGuide` 에 "접수일 다음날 자정" 만료가
 *    생겼고(형제 `getWaiting` 과 같은 규칙), 고정 과거 날짜를 쓰면 이 마스킹 계약들이 만료 예외에
 *    가려 **다른 이유로 통과/실패**한다. 만료 자체는 아래 별도 describe 가 겨눈다.
 */
const TODAY_CHECKIN = new Date(new Date().setHours(9, 5, 0, 0));
const YESTERDAY_CHECKIN = new Date(new Date().setHours(9, 5, 0, 0) - 24 * 60 * 60 * 1000);

const GUIDE_QUEUE = {
  id: 'g1', queueNumber: 7, status: 'WAITING', departmentName: '이비인후과',
  roomName: '2진료실', visitType: 'FIRST', queueNumber2: undefined,
  checkedInAt: TODAY_CHECKIN,
  patient: { familyName: '임', givenName: '영수' },
  doctor: { familyName: '박', givenName: '원장' },
};

function makeSvc(queue: unknown = GUIDE_QUEUE) {
  const prisma = {
    waitingQueue: {
      findUnique: vi.fn().mockResolvedValue(queue),
      count: vi.fn().mockResolvedValue(3),
    },
    // 진료실 ↔ 공간 연결(2026-09-28 P0-5) — 연결 없음(위치 null)
    clinicRoom: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  return new WaitingQueueService(prisma as never, { emit: vi.fn() } as never);
}

const GUIDE_ALLOWED = [
  // roomLocation = 진료실이 공간에 연결됐을 때 층 표식·구역 이름뿐(환자 정보 아님 · 2026-09-28)
  'queueNumber', 'status', 'departmentName', 'roomName', 'roomLocation', 'visitType',
  'doctorName', 'patientName', 'aheadCount', 'checkedInAt',
].sort();

describe('WaitingQueueService.getGuide (공개 QR 길안내)', () => {
  it('이름은 성만 남기고 전부 가린다(임영수 → 임○○) — 원본 실명 없음', async () => {
    const g = (await makeSvc().getGuide('g1'))!;
    expect(g.patientName).toBe('임○○');
    expect(g.patientName).not.toContain('영수');
  });

  it('길안내 화이트리스트 — mrn·phone·patient 원본·생년월일 이 새지 않는다', async () => {
    const g = (await makeSvc().getGuide('g1'))! as Record<string, unknown>;
    for (const banned of ['mrn', 'phone', 'dateOfBirth', 'birthDate', 'patient', 'familyName', 'givenName', 'patientId']) {
      expect(g).not.toHaveProperty(banned);
    }
    expect(Object.keys(g).sort()).toEqual(GUIDE_ALLOWED);
    expect(JSON.stringify(g)).not.toContain('영수');
  });

  it('외자 이름도 성만 노출(김철 → 김○)', async () => {
    const g = (await makeSvc({ ...GUIDE_QUEUE, patient: { familyName: '김', givenName: '철' } }).getGuide('g1'))!;
    expect(g.patientName).toBe('김○');
    expect(g.patientName).not.toContain('철');
  });

  it('없는 접수는 null (존재 오라클 없음)', async () => {
    expect(await makeSvc(null).getGuide('nope')).toBeNull();
  });
});

/**
 * 🔴 (2026-09-16 H2) 만료 — 종전엔 **없었다.** 형제 `queue-display.getWaiting`(환자 QR·토큰)은
 *    접수일 다음날 자정에 만료시키는데, 같은 성격의 공개 QR 인 길안내만 영구히 답했다.
 *    사진으로 남은 QR 이 몇 달 뒤에도 대기번호·진료과·진료실·접수시각을 돌려주던 자리다.
 */
describe('getGuide 만료 — 접수일이 지나면 답하지 않는다', () => {
  it('🔴 어제 접수는 410(GUIDE_EXPIRED) — 오래된 QR 이 계속 답하지 않는다', async () => {
    const svc = makeSvc({ ...GUIDE_QUEUE, checkedInAt: YESTERDAY_CHECKIN });
    await expect(svc.getGuide('g1')).rejects.toMatchObject({ status: 410 });
  });

  it('대조군 — 오늘 접수는 그대로 답한다(만료가 정상 이용을 막지 않는다)', async () => {
    const g = (await makeSvc().getGuide('g1'))!;
    expect(g.queueNumber).toBe(7);
    expect(g.patientName).toBe('임○○');
  });

  it('대조군 — 없는 접수는 만료가 아니라 null (두 사실을 뒤바꾸지 않는다)', async () => {
    expect(await makeSvc(null).getGuide('nope')).toBeNull();
  });
});
