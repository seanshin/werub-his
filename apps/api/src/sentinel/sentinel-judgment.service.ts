import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import type { SentinelJudgmentVerdict } from '@hospital-run/shared';
import { audienceOf } from './sentinel-audience';

/**
 * 발견 항목 판정 원장 — 쓰기와 판정 로그 조회.
 *
 * 🔴 판정은 발견을 없애지 않는다(기록 ≠ 적용). `resolvedAt` 은 스윕만 만든다.
 * 🔴 append-only — 재판정은 새 행이고 최신이 화면 표시를 이긴다. 수정·삭제 EP 는 두지 않는다
 *    (판정을 지울 수 있으면 판정 이력 전체를 못 믿는다).
 */
@Injectable()
export class SentinelJudgmentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 판정 기록. 🔴 판정 시점 건수는 클라이언트가 아니라 **발견 행에서 직접** 스냅샷한다 —
   * 화면이 낡은 값을 들고 있어도 원장에는 판정 순간의 사실이 남아야 한다.
   */
  async record(input: {
    axis: string;
    checkKey: string;
    verdict: SentinelJudgmentVerdict;
    basis: string;
    userId: string;
  }) {
    const finding = await this.prisma.sentinelFinding.findUnique({
      where: { axis_checkKey: { axis: input.axis, checkKey: input.checkKey } },
    });
    // 🔴 존재하지 않는 발견에 판정을 받지 않는다 — 지어낸 checkKey 가 원장에 남으면
    //    판정 커버리지 집계가 오염된다.
    if (!finding) throw new NotFoundException('해당 발견 항목이 없습니다');

    return this.prisma.sentinelJudgment.create({
      data: {
        axis: input.axis,
        checkKey: input.checkKey,
        verdict: input.verdict,
        valueAtJudgment: finding.value,
        basis: input.basis,
        source: 'SCREEN',
        judgedBy: input.userId,
      },
    });
  }

  /**
   * (axis, checkKey)별 **최신** 판정 맵 — 발견 목록에 붙일 때 쓴다.
   * 판정자 이름은 여기서 해석한다(못 찾으면 null — 이름을 지어내지 않는다).
   */
  async latestByKey(axis?: string) {
    const rows = await this.prisma.sentinelJudgment.findMany({
      where: axis ? { axis } : {},
      orderBy: { judgedAt: 'desc' },
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const k = `${r.axis}:${r.checkKey}`;
      if (!latest.has(k)) latest.set(k, r);
    }
    const named = await this.withJudgeNames([...latest.values()]);
    const out = new Map<string, (typeof named)[number]>();
    for (const r of named) out.set(`${r.axis}:${r.checkKey}`, r);
    return out;
  }

  /** 판정 로그(대시보드) — 최신순 전체 이력. append-only 라 그대로가 감사 추적이다. */
  async log(opts: { axis?: string; checkKey?: string; limit?: number } = {}) {
    const rows = await this.prisma.sentinelJudgment.findMany({
      where: {
        ...(opts.axis ? { axis: opts.axis } : {}),
        ...(opts.checkKey ? { checkKey: opts.checkKey } : {}),
      },
      orderBy: { judgedAt: 'desc' },
      take: Math.min(opts.limit ?? 50, 200),
    });
    return this.withJudgeNames(rows);
  }

  /**
   * 적색 판정 커버리지 — 미해결 RED 를 판정됨/판정 이후 증가/미판정/관측 불가로 가른다.
   *
   * 🔴 "판정됨"의 조건은 최신 판정이 있고 **현재 건수가 판정 당시 건수를 넘지 않는 것**이다.
   *    판정 이후 값이 늘었다면 그 판정은 새 행을 설명하지 못한다 — 판정됨으로 접으면
   *    옛 판정이 새 위반을 조용히 덮는다(그것이 이 원장이 막으려는 거짓 안심이다).
   * 🔴 체류일은 사실이다. "지연"이라 판정하지 않는다(임계를 지어내지 않는다).
   */
  async redCoverage() {
    const open = await this.prisma.sentinelFinding.findMany({
      where: { resolvedAt: null, severity: 'RED' },
      orderBy: { firstSeenAt: 'asc' },
    });
    const latest = await this.latestByKey();
    const now = Date.now();

    const items = open.map((f) => {
      const j = latest.get(`${f.axis}:${f.checkKey}`) ?? null;
      const state: 'UNOBSERVABLE' | 'UNJUDGED' | 'STALE_INCREASED' | 'JUDGED' = f.unobservable
        ? 'UNOBSERVABLE'
        : !j
          ? 'UNJUDGED'
          : f.value > j.valueAtJudgment
            ? 'STALE_INCREASED'
            : 'JUDGED';
      return {
        axis: f.axis,
        checkKey: f.checkKey,
        label: f.label,
        value: f.value,
        firstSeenAt: f.firstSeenAt,
        dwellDays: Math.floor((now - f.firstSeenAt.getTime()) / 86_400_000),
        state,
        audience: audienceOf(f.axis, f.checkKey),
        verdict: j?.verdict ?? null,
        judgedAt: j?.judgedAt ?? null,
        increasedBy: j && f.value > j.valueAtJudgment ? f.value - j.valueAtJudgment : null,
      };
    });

    return {
      openRed: open.length,
      judged: items.filter((i) => i.state === 'JUDGED').length,
      staleIncreased: items.filter((i) => i.state === 'STALE_INCREASED').length,
      unjudged: items.filter((i) => i.state === 'UNJUDGED').length,
      unobservable: items.filter((i) => i.state === 'UNOBSERVABLE').length,
      items,
    };
  }

  /**
   * 발견 1건에 붙일 판정 표시 — 🔴 값이 판정 당시보다 늘었으면 `staleIncreased` 로
   * 되돌린다(화면은 이것을 "판정됨"으로 그리지 않는다). 관측 불가 항목은 값 비교 자체를
   * 하지 않는다(믿을 수 없는 값으로 판정 신선도를 재지 않는다).
   */
  static judgmentView(
    finding: { value: number; unobservable: boolean },
    j: {
      verdict: string; valueAtJudgment: number; basis: string; source: string;
      judgedAt: Date; judgedByName: string | null;
    } | null,
  ) {
    if (!j) return null;
    return {
      verdict: j.verdict,
      valueAtJudgment: j.valueAtJudgment,
      basis: j.basis,
      source: j.source,
      judgedAt: j.judgedAt,
      judgedByName: j.judgedByName,
      staleIncreased: !finding.unobservable && finding.value > j.valueAtJudgment,
      increasedBy: !finding.unobservable && finding.value > j.valueAtJudgment
        ? finding.value - j.valueAtJudgment
        : null,
    };
  }

  private async withJudgeNames<T extends { judgedBy: string | null }>(rows: T[]) {
    const ids = [...new Set(rows.map((r) => r.judgedBy).filter((v): v is string => !!v))];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, familyName: true, givenName: true },
        })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, `${u.familyName}${u.givenName}`]));
    // 🔴 DOC 이관분(judgedBy null)은 판정자를 지어내지 않는다 — null 을 그대로 준다
    return rows.map((r) => ({ ...r, judgedByName: r.judgedBy ? (nameOf.get(r.judgedBy) ?? null) : null }));
  }
}
