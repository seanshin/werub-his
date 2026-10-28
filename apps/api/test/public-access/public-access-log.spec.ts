import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublicAccessLogService } from '../../src/modules/public-access/public-access-log.service';

/**
 * 무인증 채널 접근 원장 가드.
 *
 * 🔴 `AuditLog.userId` 는 User FK(NOT NULL)라 주체가 사람이 아닌 접근을 담을 수 없고,
 *    감사 인터셉터도 `if (!user?.id) return;` 로 탈락한다 → 공개 예약 챗·무인 키오스크 조회가
 *    **개통 이래 무기록**이었다(2026-08-19 실측). 이 원장이 그 자리를 메운다.
 *
 * 🔴 원장 자체가 열거 소스가 되면 안 된다 — 등록번호 원문은 저장하지 않는다.
 */
describe('공개 채널 접근 원장', () => {
  let service: PublicAccessLogService;
  let prisma: any;

  beforeEach(() => {
    prisma = { publicAccessLog: { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(3) } };
    service = new PublicAccessLogService(prisma as any);
  });

  const saved = () => prisma.publicAccessLog.create.mock.calls[0][0].data;

  it('🔴 등록번호 원문을 저장하지 않는다 — 해시만 남는다', async () => {
    await service.record({ channel: 'KIOSK', action: 'verify', path: '/api/v1/kiosk', result: 'FAIL', subject: 'P2026-0001' });

    const d = saved();
    expect(JSON.stringify(d)).not.toContain('P2026-0001');
    expect(d.subjectHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('같은 등록번호는 같은 해시 — 반복 시도를 셀 수 있다(대소문자·공백 무시)', () => {
    const a = PublicAccessLogService.hashSubject('P2026-0001');
    expect(PublicAccessLogService.hashSubject(' p2026-0001 ')).toBe(a);
    expect(PublicAccessLogService.hashSubject('P2026-0002')).not.toBe(a);
    expect(PublicAccessLogService.hashSubject('')).toBeNull();
    expect(PublicAccessLogService.hashSubject(null)).toBeNull();
  });

  it('🔴 본인확인을 통과한 경우에만 환자를 지목한다', async () => {
    await service.record({ channel: 'BOOKING', action: 'verify', path: '/x', result: 'FAIL', subject: 'P2026-0001' });
    expect(saved().patientId).toBeNull();

    prisma.publicAccessLog.create.mockClear();
    await service.record({ channel: 'BOOKING', action: 'verify', path: '/x', result: 'OK', subject: 'P2026-0001', patientId: 'p-1' });
    expect(saved().patientId).toBe('p-1');
  });

  it('🔴 기록 실패가 공개 창구 업무를 막지 않는다(비차단)', async () => {
    prisma.publicAccessLog.create.mockRejectedValue(new Error('DB down'));
    await expect(
      service.record({ channel: 'KIOSK', action: 'pay', path: '/x', result: 'OK' }),
    ).resolves.toBeUndefined();
  });

  it('반복 실패를 셀 수 있다 — 무인증 채널의 대입 시도 탐지', async () => {
    const n = await service.recentFailures('P2026-0001', 15);
    expect(n).toBe(3);
    const where = prisma.publicAccessLog.count.mock.calls[0][0].where;
    expect(where.result.in).toEqual(['FAIL', 'LOCKED']);
    expect(where.subjectHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('userAgent 는 잘라서 저장한다(원장 비대화 방지)', async () => {
    await service.record({ channel: 'KIOSK', action: 'verify', path: '/x', result: 'OK', userAgent: 'U'.repeat(900) });
    expect(saved().userAgent.length).toBe(500);
  });
});
