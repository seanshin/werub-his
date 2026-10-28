import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { eventHash, merkleRoot, GENESIS_PREV } from './voucher-serial';

/** 해시 함수의 출력 형식 — 이게 아니면 원장에 들어와서는 안 될 값이다 */
const HEX64 = /^[0-9a-f]{64}$/;

type Tx = Prisma.TransactionClient;

/**
 * 검진권 해시체인 원장. append-only 이벤트(prevHash→hash) + 배치 merkle 앵커.
 * ⚠️ 신뢰 한계(설계 §14.3): 이벤트가 가변 DB에 저장되므로 INTERNAL 앵커는 운영자 신뢰 가정.
 *    실제 append-only 강제(UPDATE/DELETE 차단 트리거)는 별도 마이그레이션 SQL로 적용(P1 후속).
 *    제3자 검증가능 불변성은 외부 체인 앵커 연동 시 확보.
 */
@Injectable()
export class VoucherLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** 이벤트 추가(트랜잭션 내). prevHash=현재 headHash(genesis는 GENESIS_PREV). 반환 hash. */
  async append(tx: Tx, input: {
    voucherId: string; serial: string; type: string; prevHash: string;
    actorType: string; actorId: string | null; payload: unknown;
  }): Promise<string> {
    const ts = new Date().toISOString();
    const hash = eventHash({ prevHash: input.prevHash, serial: input.serial, type: input.type, payload: input.payload, actorId: input.actorId, ts });
    await tx.voucherEvent.create({
      data: {
        voucherId: input.voucherId, serial: input.serial, type: input.type,
        prevHash: input.prevHash, hash, actorType: input.actorType, actorId: input.actorId ?? undefined,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        createdAt: new Date(ts), // 해시에 쓴 ts와 일치(verifyChain 재현성)
      },
    });
    return hash;
  }

  /**
   * 배치 검진권 head 해시 → merkleRoot → BlockchainAnchor(기존 재사용) 기록 + 이벤트 앵커표시.
   *
   * 🔴 (2026-09-17 L1) 종전엔 세 쓰기가 **트랜잭션 밖에서 순차**였다. 앵커 행만 커밋되고 배치 갱신이
   *    실패하면 배치는 `merkleRoot`·`anchorId` 가 비고 ISSUE 이벤트는 `PENDING` 인 채 남는데,
   *    **재시도는 `issueBatch` 의 멱등 분기(이미 전량 발행)에 막혀 다시 오지 않는다** — 그 배치는
   *    영영 미앵커로 굳고, 고아 앵커 행만 append-only 원장에 쌓인다(금전 가치·지울 수 없다).
   *    H4 가 같은 모양을 `voucher.service` 쪽에서 고쳤는데(중복 앵커) 원장 서비스 쪽 쌍둥이는
   *    **스캐너가 반환 타입 `Promise<{…}>` 에 눈이 멀어 분모에 없었다**(L1 에서 드러남).
   *    이제 셋을 한 트랜잭션으로 묶고, 이미 앵커된 배치는 **새 앵커를 만들지 않고 기존 것을 돌려준다**.
   */
  async anchorBatch(batchId: string, chainType: string): Promise<{ merkleRoot: string; anchorId: string; count: number }> {
    const vouchers = await this.prisma.checkupVoucher.findMany({ where: { batchId }, select: { headHash: true } });
    const root = merkleRoot(vouchers.map((v) => v.headHash));
    return this.prisma.$transaction(async (tx) => {
      // 이미 앵커된 배치 — 두 번째 앵커를 만들지 않는다(원장은 append-only 라 되돌릴 수 없다)
      const cur = await tx.voucherBatch.findUnique({ where: { id: batchId }, select: { anchorId: true, merkleRoot: true } });
      if (cur?.anchorId) return { merkleRoot: cur.merkleRoot ?? root, anchorId: cur.anchorId, count: vouchers.length };

      const anchor = await tx.blockchainAnchor.create({
        data: { anchorType: 'CHECKUP_VOUCHER', referenceId: batchId, dataHash: root, merkleRoot: root, chainType, status: chainType === 'INTERNAL' ? 'ANCHORED' : 'PENDING' }, // B4 — 내부 원장은 외부 확정(CONFIRMED)이 아니다
      });
      await tx.voucherBatch.update({ where: { id: batchId }, data: { merkleRoot: root, anchorId: anchor.id } });
      await tx.voucherEvent.updateMany({
        where: { voucher: { batchId }, type: 'ISSUE', anchorStatus: 'PENDING' },
        data: { anchorId: anchor.id, anchorStatus: 'ANCHORED', anchoredAt: new Date() },
      });
      return { merkleRoot: root, anchorId: anchor.id, count: vouchers.length };
    });
  }

  /** 체인 무결성 검증 — prevHash 연쇄 + 해시 재계산 일치(변조탐지). */
  /**
   * 🔴 **불일치의 종류를 구분해서 말한다** (2026-08-30 운영 실측).
   *    종전에는 두 가지를 뭉뚱그려 "체인 변조 의심"이라 단정했다:
   *      · `LINK_BROKEN`   — 앞 이벤트의 hash 와 이번 prevHash 가 다르다 = **연결이 끊겼다**
   *      · `HASH_MISMATCH` — 연결은 맞는데 저장된 값으로 **재계산이 안 맞는다**
   *    운영에서 걸린 10건은 전부 후자였고 **prevHash 연결은 완벽**했으며,
   *    `checkup_vouchers.genesis_hash` 와 ISSUE 이벤트 hash 도 **전건 일치**했다.
   *    즉 저장은 일관되고 재계산만 어긋난다 — 데이터를 지운 흔적이 아니라
   *    **해시 입력 규약이 기록 시점과 달라졌을 때** 나는 모양이다.
   *    🔴 원인은 아직 특정하지 못했다(payload·ts·actorId 후보를 모두 대입해 재현 실패).
   *    그래서 **"변조"라고 단정하지 않고 종류만 사실대로 돌려준다** — 판단은 사람이 한다.
   */
  async verifyChain(serial: string): Promise<{
    valid: boolean; events: number; brokenAt?: string; reason?: 'NOT_A_HASH' | 'LINK_BROKEN' | 'HASH_MISMATCH';
  }> {
    const events = await this.prisma.voucherEvent.findMany({ where: { serial }, orderBy: { createdAt: 'asc' } });
    let prev = GENESIS_PREV;
    for (const e of events) {
      /**
       * 🔴 **코드가 만들 수 없는 값**은 따로 말한다(2026-08-30 운영 실측 3건).
       *    `prevHash`/`hash` 가 64자리 16진수가 아니면(예: `g` 64개) 해시 함수의 출력일 수 없다 —
       *    체인이 "끊긴" 것이 아니라 **원장에 들어와서는 안 될 값이 들어와 있는** 것이다.
       *    그 셋은 ISSUE 이벤트 없이 REDEEM 으로 시작하고 상태가 REVOKED 다.
       *    저장소에 그 값을 만드는 코드는 없다 — 원인 미상이므로 **사실만 분류**한다.
       */
      if (!HEX64.test(e.prevHash) || !HEX64.test(e.hash)) {
        return { valid: false, events: events.length, brokenAt: e.id, reason: 'NOT_A_HASH' };
      }
      if (e.prevHash !== prev) return { valid: false, events: events.length, brokenAt: e.id, reason: 'LINK_BROKEN' };
      const recomputed = eventHash({ prevHash: e.prevHash, serial: e.serial, type: e.type, payload: e.payload, actorId: e.actorId, ts: e.createdAt.toISOString() });
      if (recomputed !== e.hash) return { valid: false, events: events.length, brokenAt: e.id, reason: 'HASH_MISMATCH' };
      prev = e.hash;
    }
    return { valid: true, events: events.length };
  }
}
