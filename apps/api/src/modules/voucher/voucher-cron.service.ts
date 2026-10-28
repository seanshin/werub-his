import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { VoucherPolicyService } from './voucher-policy.service';
import { VoucherLedgerService } from './voucher-ledger.service';
import { NotificationService } from '../notification/notification.service';
import { merkleRoot } from './voucher-serial';

// P4 운영 무결성 cron — 앵커·만료·유치업만료·체인검증
@Injectable()
export class VoucherCronService {
  private readonly logger = new Logger('VoucherCron');
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: VoucherPolicyService,
    private readonly ledger: VoucherLedgerService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  /** 미앵커 이벤트(ALLOCATE/TRANSFER/REDEEM 등) 주기 앵커 — merkle root → BlockchainAnchor. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'voucher-anchor-pending' })
  async anchorPending() {
    const pending = await this.prisma.voucherEvent.findMany({ where: { anchorStatus: 'PENDING' }, select: { id: true, hash: true }, take: 5000, orderBy: { createdAt: 'asc' } });
    if (pending.length === 0) return;
    const pol = await this.policy.getActive();
    const root = merkleRoot(pending.map((e) => e.hash));
    try {
      /**
       * 🔴 (2026-09-16 H4) 앵커 생성과 이벤트 결속은 **한 트랜잭션**이다. 종전엔 앵커를 먼저 커밋하고
       *    이벤트를 따로 묶었다 — 뒤가 실패하면 이벤트는 PENDING 으로 남아 **다음 주기에 같은 이벤트가
       *    새 앵커로 다시 앵커된다**. 앵커는 append-only 원장이라 어느 앵커가 그 이벤트를 담았는지가
       *    영구히 갈라지고, 고아 앵커는 지울 수도 없다.
       */
      await this.prisma.$transaction(async (tx) => {
        const anchor = await tx.blockchainAnchor.create({
          data: { anchorType: 'CHECKUP_VOUCHER', referenceId: pending[0].id, dataHash: root, merkleRoot: root, chainType: pol.anchorChainType, status: pol.anchorChainType === 'INTERNAL' ? 'ANCHORED' : 'PENDING' }, // B4 — 내부 원장은 외부 확정이 아니다
        });
        await tx.voucherEvent.updateMany({
          where: { id: { in: pending.map((e) => e.id) } },
          data: { anchorId: anchor.id, anchorStatus: 'ANCHORED', anchoredAt: new Date() },
        });
      });
      this.logger.log(`앵커 완료: ${pending.length} 이벤트 → ${root.slice(0, 12)}`);
    } catch (e) {
      // 앵커 실패 — 재시도 카운트 증가(다음 주기 재시도)
      await this.prisma.voucherEvent.updateMany({ where: { id: { in: pending.map((x) => x.id) } }, data: { anchorAttempts: { increment: 1 } } });
      this.logger.error(`앵커 실패(재시도 예약): ${(e as Error).message}`);
    }
  }

  /** 만료 처리 — expiresAt 경과 검진권(미활성/활성) EXPIRED + 이벤트. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'voucher-expire' })
  async expireVouchers() {
    const now = new Date();
    let total = 0;
    for (;;) {
      const batch = await this.prisma.checkupVoucher.findMany({
        where: { expiresAt: { lt: now }, status: { in: ['ISSUED', 'ALLOCATED', 'SOLD', 'ACTIVE'] } },
        select: { id: true, serial: true, headHash: true }, take: 1000,
      });
      if (batch.length === 0) break;
      let batchFailed = 0;
      for (const v of batch) {
        // 🔴 (2026-09-16 E4) per-item 보호가 없어, 한 장에서 원장 append 가 실패하면(해시 체인 불일치 등)
        //    **나머지 검진권이 통째로 만료되지 못했다.** 게다가 같은 조건으로 다시 조회하므로 그 한 장이
        //    매일 맨 앞에 와 스윕 전체를 영구 차단한다. 개별 실패는 끊고 다음 장으로 간다.
        try {
          await this.prisma.$transaction(async (tx) => {
            const head = await this.ledger.append(tx, { voucherId: v.id, serial: v.serial, type: 'EXPIRE', prevHash: v.headHash, actorType: 'SYSTEM', actorId: null, payload: { at: now.toISOString() } });
            await tx.checkupVoucher.update({ where: { id: v.id }, data: { status: 'EXPIRED', headHash: head } });
          });
          total++;
        } catch (e) {
          batchFailed++;
          this.logger.error(`검진권 만료 실패 serial=${v.serial}: ${(e as Error).message}`);
        }
      }
      // 🔴 실패분은 상태가 그대로라 다음 배치 조회에 다시 잡힌다 — 무한 루프가 되지 않게 배치를 끝낸다
      if (batchFailed === batch.length) break;
      if (batch.length < 1000) break;
    }
    if (total) this.logger.log(`만료 처리: ${total} 검진권`);
  }

  /** 유치업 등록 만료 딜러 자동 정지(L3). */
  @Cron(CronExpression.EVERY_DAY_AT_5AM, { name: 'voucher-license-expiry' })
  async suspendExpiredLicenses() {
    const r = await this.prisma.distributor.updateMany({
      where: { status: 'ACTIVE', licenseExpiry: { lt: new Date() } },
      data: { status: 'SUSPENDED' },
    });
    if (r.count) this.logger.warn(`유치업 등록 만료 → 자동 정지: ${r.count} 딜러`);
  }

  /** 체인 무결성 표본 검증(변조탐지). */
  /**
   * 해시체인 무결성 검증. 변조 탐지는 로그로 끝내면 아무도 못 보므로 ADMIN 통보까지가 정본.
   * 커버리지: 최신 100건만 보면 오래된 검진권은 영구 미검증 → 미검증분 우선(lastVerifiedAt asc)으로 순회.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM, { name: 'voucher-chain-verify' })
  async verifyChainSample() {
    const sample = await this.prisma.checkupVoucher.findMany({
      select: { id: true, serial: true },
      take: 200,
      orderBy: [{ chainVerifiedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
    });
    const broken: { id: string; serial: string; brokenAt?: string; reason?: string }[] = [];
    let unrecorded = 0;
    /**
     * 🔴 **같은 10건을 매일 06:00 에 다시 외치고 있었다**(운영 실측 70회).
     *    이미 알려 놓은 건을 반복 발화하면 진짜 새 위반이 묻힌다(§규약 1: 거짓 경보가 진짜 경보를 죽인다).
     *    `chainValid=false` 로 이미 표시된 건은 **조용히 세기만** 하고, 새로 깨진 것만 외친다.
     */
    const alreadyFlagged = new Set(
      (await this.prisma.checkupVoucher.findMany({ where: { chainValid: false }, select: { id: true } })).map((v) => v.id),
    );
    for (const v of sample) {
      const r = await this.ledger.verifyChain(v.serial);
      if (!r.valid) {
        broken.push({ id: v.id, serial: v.serial, brokenAt: r.brokenAt, reason: r.reason });
        // 🔴 "변조"라고 단정하지 않는다 — 종류만 사실대로 적고 판단은 사람이 한다
        if (!alreadyFlagged.has(v.id)) {
          this.logger.error(`🔴 검진권 체인 불일치(${r.reason}): ${v.serial} (brokenAt ${r.brokenAt})`);
        }
      }
      // 🔴 (2026-09-14) 결과 쓰기 실패를 삼키면 화면은 옛 검증 시각을 본다 — 검증은 했지만 기록되지 않은 건을 세어 말한다
      try {
        await this.prisma.checkupVoucher.update({
          where: { id: v.id },
          data: { chainVerifiedAt: new Date(), chainValid: r.valid },
        });
      } catch (e) {
        unrecorded += 1;
        this.logger.warn(`체인 검증 결과 기록 실패 ${v.serial}: ${(e as Error).message}`);
      }
    }
    if (unrecorded === 0) this.logger.log(`체인 검증: 표본 ${sample.length}, 이상 ${broken.length}`);
    else this.logger.warn(`체인 검증: 표본 ${sample.length}, 이상 ${broken.length}, 결과 미기록 ${unrecorded}건(화면의 검증 시각은 이 건들에서 옛 값이다)`);

    if (broken.length > 0) {
      // 무결성 위반은 자동 복구 금지(재해시는 증거 인멸) — 사람 조사 대상으로 올린다.
      const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
      /** 이미 상신된 건만 남으면 새로 알릴 것이 없다 — 매일 같은 CRITICAL 을 보내지 않는다 */
      const fresh = broken.filter((b) => !alreadyFlagged.has(b.id));
      if (fresh.length === 0) {
        this.logger.log(`체인 불일치 ${broken.length}건 — 전부 기존 상신분(새 위반 없음). 조사 대기 중입니다.`);
        return;
      }
      const head = fresh.slice(0, 5).map((b) => `${b.serial}(${b.reason})`).join(', ');
      let sent = 0;
      for (const a of admins) {
        // 🔴 종전엔 refId 에 일련번호(`WGC-…`)를 넘겨 Prisma P2023 으로 죽었고, await 도 없어
        //    unhandled rejection 으로만 남았다 — 탐지 로그는 정상인데 상신은 **0건**이었다
        //    (운영 실측: VOUCHER_CHAIN_BROKEN 알림 0건). refId 는 엔티티 id(UUID)여야 한다.
        try {
          await this.notifications?.notify(a.id, {
            type: 'VOUCHER_CHAIN_BROKEN',
            title: '🔴 검진권 해시체인 무결성 위반',
            message: `체인 검증 신규 ${fresh.length}건 불일치(누적 ${broken.length}건) — ${head}${fresh.length > 5 ? ' 외' : ''}. `
              + `NOT_A_HASH=해시 형식이 아닌 값(코드가 만들 수 없음) / LINK_BROKEN=연결 끊김 / `
              + `HASH_MISMATCH=저장값으로 재계산 불일치. 자동 복구하지 않으며 원인 조사가 필요합니다.`,
            severity: 'CRITICAL',
            refType: 'CheckupVoucher',
            refId: fresh[0].id,
          });
          sent += 1;
        } catch (e) {
          this.logger.error(`체인 위반 상신 실패 admin=${a.id}: ${(e as Error).message}`);
        }
      }
      // 탐지와 상신은 분리할 수 없다 — 아무에게도 못 갔으면 그 사실이 로그에 남아야 한다
      if (sent === 0) this.logger.error(`🔴 체인 위반 ${broken.length}건을 탐지했으나 관리자 상신에 모두 실패했습니다(대상 ${admins.length}명).`);
      else this.logger.warn(`체인 위반 상신: 관리자 ${sent}/${admins.length}명`);
    }
  }
}
