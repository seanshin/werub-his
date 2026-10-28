import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../infrastructure/prisma/prisma.service';

export type DriftKind = 'KEY_MISSING' | 'NULL_FOLDED';

export interface DriftSignal {
  kind: DriftKind;
  /** 값을 내는 쪽 — 'bed-board.getBoard' */
  producer: string;
  /** 값을 읽는 쪽 — 'command-center.buildKpi' */
  consumer: string;
  detail: string;
}

/**
 * 계약 드리프트 기록기 — **요청 경로 안에서만 보이는 것**을 원장에 적는다.
 *
 * 🔴 왜 필요한가(2026-09-02 실측): 롤업이 `bed.summary.totalBeds` 를 `'total'` 로 읽어
 *    분모를 잃었고, 화면은 그것을 "산출 불가 — 등록 병상 없음"이라 그렸다(운영엔 병상 57개).
 *    양쪽이 `Record<string, unknown>` 이라 **타입도 테스트도 잡지 못하는 자리**였고,
 *    그때 남긴 것은 로그 한 줄뿐이라 아무도 보지 않았다.
 *
 * 설계 규약
 *  - **적기만 한다.** 판정·집계는 감시자(별도 프로세스)가 한다.
 *  - **같은 드리프트는 한 줄.** 규모는 `hitCount` 가 말한다.
 *  - 🔴 **임상 요청 경로를 절대 막지 않는다.** 메모리에 모았다가 주기적으로 한 번에 쓴다.
 *    쓰기가 실패해도 요청을 죽이지 않되, **삼키지 않고 사유를 로그에 남긴다**
 *    (여기서 조용히 접으면 이 기록기 자체가 "실패를 없음으로 번역하는 코드"가 된다).
 */
@Injectable()
export class DriftRecorderService implements OnModuleDestroy {
  private readonly logger = new Logger(DriftRecorderService.name);
  /** key = kind|producer|consumer */
  private readonly pending = new Map<string, DriftSignal & { hits: number }>();
  private readonly timer: NodeJS.Timeout;

  /** 플러시 주기 — 요청마다 DB 를 때리지 않기 위한 유일한 이유다 */
  static readonly FLUSH_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {
    this.timer = setInterval(() => void this.flush(), DriftRecorderService.FLUSH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
    // 🔴 종료 시 남은 것을 흘리지 않는다 — 마지막 관측이 사라지면 그만큼 화면이 낙관적이 된다
    void this.flush();
  }

  /** 관측 1회. 동기·비차단 — DB 를 건드리지 않는다 */
  record(sig: DriftSignal): void {
    const k = `${sig.kind}|${sig.producer}|${sig.consumer}`;
    const cur = this.pending.get(k);
    if (cur) { cur.hits += 1; cur.detail = sig.detail; }
    else this.pending.set(k, { ...sig, hits: 1 });
  }

  /** 모아둔 것을 원장에 반영. 실패는 삼키지 않고 남긴다 */
  async flush(): Promise<{ attempted: number; succeeded: number; failed: number }> {
    if (this.pending.size === 0) return { attempted: 0, succeeded: 0, failed: 0 };
    const batch = [...this.pending.values()];
    this.pending.clear();

    let succeeded = 0;
    const failures: string[] = [];
    const now = new Date();
    for (const s of batch) {
      try {
        await this.prisma.sentinelRuntimeSignal.upsert({
          where: { kind_producer_consumer: { kind: s.kind, producer: s.producer, consumer: s.consumer } },
          create: {
            kind: s.kind, producer: s.producer, consumer: s.consumer,
            detail: s.detail, hitCount: s.hits, lastSeenAt: now,
          },
          update: {
            detail: s.detail, hitCount: { increment: s.hits }, lastSeenAt: now,
          },
        });
        succeeded += 1;
      } catch (e) {
        failures.push(`${s.kind}|${s.consumer}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (failures.length) {
      this.logger.warn(`드리프트 신호 적재 실패 ${failures.length}/${batch.length}: ${failures.slice(0, 3).join(' | ')}`);
    }
    return { attempted: batch.length, succeeded, failed: failures.length };
  }

  /** 테스트·진단용 — 아직 원장에 안 간 것 */
  pendingCount(): number { return this.pending.size; }
}
