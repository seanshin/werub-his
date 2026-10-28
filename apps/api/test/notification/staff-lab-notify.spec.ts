/**
 * 🔴 직원 검사 결과 알림 — **개통 이래 한 번도 발화하지 않던 것**을 켤 수 있게 배선했다 (2026-08-20).
 *
 * 실측: 리스너 구독은 `lab.result_completed`(밑줄)인데 실제 발행은 `lab.result.completed`(점)였다
 * (`lab.service.ts:412·1047`, 다른 구독자 3곳은 점 표기). 어휘가 갈라져 알림이 한 번도 안 갔다.
 *
 * 🔴 이름만 고치면 **모든 검사 완료마다** 주치의에게 알림이 나간다 — 그래서 함께 붙였다:
 *  · 설정 게이트(**기본 OFF**) — 켜는 것은 원내 위원회 결정(`policy.labResult.staffNotify`)
 *  · 위급값 결과 제외 — `lab.critical.value` 가 더 급하게 알린다(두 번 알리면 급한 쪽이 묻힌다)
 *  · 60분 중복 억제
 *
 * 재주입: 게이트·위급값 분리·중복 억제 중 하나를 지우면 이 파일이 실패한다.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NotificationListener } from '../../src/modules/notification/notification.listener';

const SRC = path.join(__dirname, '..', '..', 'src', 'modules', 'notification', 'notification.listener.ts');

function mk(opts?: { enabled?: boolean; recent?: unknown }) {
  const created: unknown[] = [];
  const notificationService: any = {
    create: vi.fn(async (_u: string, d: unknown) => { created.push(d); return { id: 'n1', ...(d as object) }; }),
    pushNotification: vi.fn(),
  };
  const prisma: any = {
    encounter: { findUnique: vi.fn(async () => ({ doctorId: 'doc1', patient: { familyName: '김', givenName: '환자' } })) },
    notification: { findFirst: vi.fn(async () => opts?.recent ?? null) },
  };
  const config: any = { get: vi.fn(async () => opts?.enabled ?? false) };
  const l = new NotificationListener(notificationService, { pushPatientNotification: vi.fn() } as never, prisma, { deliver: vi.fn() } as never, config);
  return { l, created, prisma };
}
const P = { orderId: 'o1', encounterId: 'e1', patientId: 'p1' };

describe('구독 어휘 — 실제 발행되는 이름을 구독한다', () => {
  it('🔴 점 표기(`lab.result.completed`)를 구독한다 — 밑줄 표기는 발행되지 않는다', () => {
    const src = fs.readFileSync(SRC, 'utf8');
    expect(src, '밑줄 표기가 남아 있다 — 그 이벤트는 아무도 발행하지 않는다').not.toContain("@OnEvent('lab.result_completed')");
    expect(src).toContain("@OnEvent('lab.result.completed')");
  });
});

describe('게이트 — 기본은 나가지 않는다', () => {
  it('🔴 설정이 꺼져 있으면(기본) 한 건도 만들지 않는다', async () => {
    const { l, created } = mk({ enabled: false });
    await l.handleLabResultCompleted(P);
    expect(created).toHaveLength(0);
  });

  it('켜져 있으면 만든다', async () => {
    const { l, created } = mk({ enabled: true });
    await l.handleLabResultCompleted(P);
    expect(created).toHaveLength(1);
    expect((created[0] as { type: string }).type).toBe('LAB_RESULT');
  });

  it('🔴 위급값 포함 결과는 건너뛴다 — 위급 경로가 이미 더 급하게 알린다', async () => {
    const { l, created } = mk({ enabled: true });
    await l.handleLabResultCompleted({ ...P, hasCritical: true });
    expect(created).toHaveLength(0);
  });

  it('🔴 60분 내 같은 오더는 억제한다 — 재검증·부분 확정이 여러 번 발행된다', async () => {
    const { l, created } = mk({ enabled: true, recent: { id: 'prev' } });
    await l.handleLabResultCompleted(P);
    expect(created).toHaveLength(0);
  });

  it('진료 문맥이 없으면 보내지 않는다(수신자를 지어내지 않는다)', async () => {
    const { l, created } = mk({ enabled: true });
    await l.handleLabResultCompleted({ orderId: 'o1' });
    expect(created).toHaveLength(0);
  });

  it('🔴 페이로드에 검사명이 없으면 지어내지 않는다 — "검사"로 나간다', async () => {
    const { l, created } = mk({ enabled: true });
    await l.handleLabResultCompleted(P);
    expect((created[0] as { message: string }).message).toContain('검사');
  });
});
