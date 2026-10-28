import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditService } from '../../src/modules/audit/audit.service';

/**
 * 🔴 P0-C R5 — 앵커 해시가 `changes` 를 덮는다.
 *
 * 원 결함(2026-09-09 실측): `anchorAuditLogs()`/`verifyIntegrity()` 가 해시를
 * `{id,userId,action,resourceType,resourceId,timestamp}` **6필드만**으로 계산했다.
 * 감사 로그의 알맹이인 `changes`(무엇이 어떻게 바뀌었나)를 통째로 바꿔도 검증이 "무결"을 돌려줬다 —
 * 변조탐지를 한다면서 변조를 탐지하지 못했다.
 *
 * 계약:
 *   ① v2 앵커 + changes 변조 → 검증 실패
 *   ② 대조군: 변조 없으면 통과(가드가 "성공을 실패로" 말하지 않는다)
 *   ③ v1 앵커(종전 6필드)는 여전히 검증 통과 — 단 `coversChanges:false` 로 **덮지 않은 것을 말한다**
 *   ④ 키 순서가 바뀐 `changes` 는 같은 해시(결정론 직렬화) — 변조가 아닌 것을 변조라 말하지 않는다
 *
 * 재주입 역검증(수동 확인함): 해시 payload 에서 `changes` 를 빼면 ①이 실패한다.
 */

const L1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const U1 = '11111111-1111-4111-8111-111111111111';
const P1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeLog(changes: unknown) {
  return {
    id: L1,
    userId: U1,
    action: 'UPDATE',
    resourceType: 'Patient',
    resourceId: P1,
    timestamp: new Date('2026-09-09T01:00:00.000Z'),
    changes,
    ipAddress: null,
    userAgent: null,
  };
}

/** 앵커 저장소 목 — 실제 BlockchainAnchorService 의 반환 모양(있으면 `anchor`, 없으면 message)을 그대로 흉내낸다. */
function makeAnchorStore() {
  const stored = new Map<string, { anchorType: string; dataHash: string; status: string }>();
  return {
    stored,
    createAnchor: vi.fn(async (d: { anchorType: string; referenceId: string; dataHash: string; chainType: string }) => {
      stored.set(d.dataHash, { anchorType: d.anchorType, dataHash: d.dataHash, status: 'PENDING' });
      return d;
    }),
    batchAnchor: vi.fn(async () => {
      for (const v of stored.values()) v.status = 'CONFIRMED';
      return { anchored: stored.size, merkleRoot: 'root-abc', txHash: 'internal-test' };
    }),
    verifyByDataHash: vi.fn(async (dataHash: string) => {
      const a = stored.get(dataHash);
      if (!a) return { verified: false, message: '해당 해시의 앵커가 없습니다' };
      return { verified: a.status === 'CONFIRMED', anchor: { dataHash: a.dataHash, anchorType: a.anchorType, status: a.status } };
    }),
  };
}

describe('감사 앵커 — changes 를 덮는다(v2) · v1 은 하위호환 검증', () => {
  let prisma: any;
  let anchors: ReturnType<typeof makeAnchorStore>;
  let service: AuditService;

  beforeEach(() => {
    prisma = {
      auditLog: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    };
    anchors = makeAnchorStore();
    service = new AuditService(prisma, {} as never, anchors as never);
  });

  async function anchorOne(log: ReturnType<typeof makeLog>) {
    prisma.auditLog.findMany.mockResolvedValue([log]);
    const r = await service.anchorAuditLogs();
    expect(r.anchored).toBeGreaterThan(0);
  }

  it('② 대조군 — 변조가 없으면 v2 앵커로 검증 통과하고 coversChanges 가 true 다', async () => {
    const log = makeLog({ familyName: { old: '이', new: '김' } });
    await anchorOne(log);
    // 앵커 레코드가 버전을 스스로 말한다(스키마 변경 없이 anchorType 에 실었다)
    expect([...anchors.stored.values()][0].anchorType).toBe('AUDIT_LOG_V2');

    prisma.auditLog.findUnique.mockResolvedValue(log);
    const v = await service.verifyIntegrity(L1);
    expect(v.verified).toBe(true);
    expect(v.hashVersion).toBe(2);
    expect(v.coversChanges).toBe(true);
  });

  it('🔴 ① changes 를 바꾸면 검증이 실패한다(종전엔 통과했다)', async () => {
    const log = makeLog({ familyName: { old: '이', new: '김' } });
    await anchorOne(log);

    // 6필드는 그대로 두고 changes 만 변조 — 종전 해시는 이 차이를 보지 못했다
    const tampered = { ...log, changes: { familyName: { old: '이', new: '박' } } };
    prisma.auditLog.findUnique.mockResolvedValue(tampered);

    const v = await service.verifyIntegrity(L1);
    expect(v.verified).toBe(false);
    expect(v.hashVersion).toBeNull();
    // 미앵커인지 변조인지 단정하지 않는다
    expect(v.message).toMatch(/변조/);
  });

  it('🔴 ①-b changes 를 통째로 지워도(null) 검증이 실패한다', async () => {
    const log = makeLog({ diagnosis: { old: 'I10', new: 'C34' } });
    await anchorOne(log);

    prisma.auditLog.findUnique.mockResolvedValue({ ...log, changes: null });
    const v = await service.verifyIntegrity(L1);
    expect(v.verified).toBe(false);
  });

  it('③ v1 앵커(종전 6필드)는 여전히 검증 통과 — 다만 changes 를 덮지 않는다고 말한다', async () => {
    const log = makeLog({ familyName: { old: '이', new: '김' } });

    // v2 도입 이전에 찍힌 앵커를 재현 — 종전 방식 그대로의 해시 + anchorType 'AUDIT_LOG'
    const { createHash } = await import('crypto');
    const legacyHash = createHash('sha256')
      .update(JSON.stringify({
        id: log.id, userId: log.userId, action: log.action,
        resourceType: log.resourceType, resourceId: log.resourceId, timestamp: log.timestamp.toISOString(),
      }))
      .digest('hex');
    anchors.stored.set(legacyHash, { anchorType: 'AUDIT_LOG', dataHash: legacyHash, status: 'CONFIRMED' });

    prisma.auditLog.findUnique.mockResolvedValue(log);
    const v = await service.verifyIntegrity(L1);
    expect(v.verified).toBe(true);
    expect(v.hashVersion).toBe(1);
    expect(v.coversChanges).toBe(false);
    expect(v.message).toMatch(/changes/);
  });

  it('④ changes 키 순서가 달라도 같은 해시다(결정론 직렬화) — 변조가 아닌 것을 변조라 말하지 않는다', async () => {
    const log = makeLog({ b: { old: 1, new: 2 }, a: { old: 'x', new: 'y' } });
    await anchorOne(log);

    // 같은 내용, 삽입 순서만 다름(JSONB 왕복에서 흔하다)
    prisma.auditLog.findUnique.mockResolvedValue({ ...log, changes: { a: { new: 'y', old: 'x' }, b: { new: 2, old: 1 } } });
    const v = await service.verifyIntegrity(L1);
    expect(v.verified).toBe(true);
    expect(v.hashVersion).toBe(2);
  });
});
