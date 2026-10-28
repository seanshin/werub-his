import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ALL_JOURNEY_STAGE_KEYS, JOURNEY_FLAG_META } from '@hospital-run/shared';

/**
 * 여정 지연 **확인·조치 기록**.
 *
 * 🔴 관제 보드는 지연을 보여주지만 무엇을 했는지 남는 자리가 없었다. 같은 카드가 교대 내내
 *    빨갛게 떠 있고, 다음 근무자는 앞 사람이 이미 연락했는지 알 수 없었다.
 *
 * 고정 규칙
 *  - 🔴 **확인이 지연을 숨기지 않는다** — 카드는 그대로 지연이고 확인 사실이 덧붙는다.
 *  - 🔴 **확인은 만료된다** — 임계 시간이 한 번 더 지나면 다시 미확인이다.
 *  - 🔴 **새 지연이 붙으면 미확인이다** — `flagKey` 가 달라져 이전 확인이 덮지 못한다.
 *  - 🔴 **사유를 강제하되 어휘를 지어내지 않는다** — 비어 있으면 안 된다는 것만 강제하고,
 *    무엇을 적을지는 화면이 **보기만** 제시한다.
 */
export interface AckInput {
  patientId: string;
  track: string;
  stage: string;
  flags: string[];
  note: string;
}

export interface AckView {
  note: string;
  ackedByName: string | null;
  ackedAt: Date;
  expiresAt: Date;
}

/** 확인 유효 시간이 산출되지 않을 때의 폴백(분) — 화면이 "언제까지"를 항상 말할 수 있어야 한다 */
const FALLBACK_TTL_MIN = 30;
/** 확인 유효 시간 상한 — 임계가 아무리 길어도 하루를 넘겨 덮지 않는다 */
const MAX_TTL_MIN = 8 * 60;

const TRACKS = ['OPD', 'IPD', 'ER'];

/** 플래그 조합 키 — 순서가 달라도 같은 조합이면 같은 키 */
export function flagKeyOf(flags: string[]): string {
  return [...new Set(flags)].sort().join(',');
}

@Injectable()
export class JourneyAckService {
  private readonly logger = new Logger(JourneyAckService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 이 확인이 얼마나 유효한가 — **그 지연을 판정한 임계와 같은 시간**.
   * 🔴 임계보다 길게 잡으면 확인이 다음 지연까지 덮어버린다.
   */
  ttlMinutes(flags: string[], thresholds: Record<string, number>): number {
    const perFlag: Record<string, string> = {
      WAIT_DELAY: 'opdWaitMin',
      CALL_DELAY: 'callDelayMin',
      CASHIER_DELAY: 'cashierDelayMin',
      CONSULT_DELAY: 'consultDelayMin',
    };
    const mins = flags
      .map((f) => thresholds[perFlag[f]])
      .filter((v): v is number => typeof v === 'number' && v > 0);
    // 여러 지연이 겹치면 **가장 짧은 것**을 따른다 — 급한 쪽이 먼저 다시 떠야 한다
    const base = mins.length ? Math.min(...mins) : FALLBACK_TTL_MIN;
    return Math.min(base, MAX_TTL_MIN);
  }

  async ack(input: AckInput, userId: string, thresholds: Record<string, number>) {
    const note = (input.note ?? '').trim();
    // 🔴 무엇을 했는지 없으면 확인이 아니다 — 빈 확인은 "봤다"는 흔적조차 되지 못한다
    if (!note) throw new BadRequestException('무엇을 확인했는지 적어 주세요');
    if (!TRACKS.includes(input.track)) throw new BadRequestException(`알 수 없는 트랙입니다: ${input.track}`);
    if (!ALL_JOURNEY_STAGE_KEYS.includes(input.stage)) {
      throw new BadRequestException(`알 수 없는 단계입니다: ${input.stage}`);
    }
    const flags = (input.flags ?? []).filter((f) => f in JOURNEY_FLAG_META);
    // 🔴 지연이 아닌 카드에 확인을 남기지 않는다 — 남기면 "확인했다"가 아무 뜻도 없어진다
    if (flags.length === 0) {
      throw new BadRequestException('지연으로 표시된 항목만 확인할 수 있습니다');
    }

    const ttl = this.ttlMinutes(flags, thresholds);
    const now = new Date();
    const row = await this.prisma.journeyDelayAck.create({
      data: {
        patientId: input.patientId,
        track: input.track,
        stage: input.stage,
        flagKey: flagKeyOf(flags),
        note: note.slice(0, 300),
        ackedBy: userId,
        ackedAt: now,
        expiresAt: new Date(now.getTime() + ttl * 60_000),
      },
    });
    this.logger.log(
      `여정 지연 확인 — 환자 ${input.patientId} · ${input.track}/${input.stage} · ${row.flagKey} · ${ttl}분 유효 · by ${userId}`,
    );
    return {
      ackedAt: row.ackedAt,
      expiresAt: row.expiresAt,
      validForMinutes: ttl,
      /** 🔴 확인해도 지연 표시는 그대로다 — 화면이 그 사실을 말한다 */
      notice: '확인을 기록했습니다. 지연 표시는 그대로 남습니다 — 조치가 끝나야 사라집니다.',
    };
  }

  /**
   * 지금 유효한 확인을 환자별로 모은다.
   * 🔴 조회에 실패하면 **확인이 없는 것으로 그리지 않고** 빈 Map 과 함께 실패를 알린다 —
   *    "확인 안 됨"으로 보이면 같은 환자에게 두 번 연락한다.
   */
  async activeAcks(patientIds: string[]): Promise<{ map: Map<string, AckView>; failed: boolean }> {
    if (patientIds.length === 0) return { map: new Map(), failed: false };
    try {
      const rows = await this.prisma.journeyDelayAck.findMany({
        where: { patientId: { in: patientIds }, expiresAt: { gt: new Date() } },
        orderBy: { ackedAt: 'desc' },
        include: { user: { select: { familyName: true, givenName: true } } },
      });
      const map = new Map<string, AckView>();
      for (const r of rows) {
        // 같은 환자에 여러 건이면 가장 최근 것 하나만(orderBy desc 라 첫 건)
        const key = `${r.patientId}|${r.flagKey}`;
        if (map.has(key)) continue;
        map.set(key, {
          note: r.note,
          ackedByName: r.user ? `${r.user.familyName ?? ''}${r.user.givenName ?? ''}`.trim() || null : null,
          ackedAt: r.ackedAt,
          expiresAt: r.expiresAt,
        });
      }
      return { map, failed: false };
    } catch (e) {
      this.logger.error(`확인 기록 조회 실패: ${(e as Error).message}`);
      return { map: new Map(), failed: true };
    }
  }
}
