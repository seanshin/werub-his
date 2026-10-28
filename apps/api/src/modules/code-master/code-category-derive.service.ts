import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { serverMsg, renderServerMessageKo, type ServerMessage } from '@hospital-run/shared';

/**
 * 수가 분류를 **코드 접두에서 유도**한다 — 사람 결정(2026-08-26, 선택지 c).
 *
 * 🔴 **규칙을 기억에서 적지 않는다.** HIRA 접두 규칙을 내가 안다고 적으면 그 추정이 정책인 척한다.
 *    대신 **운영에 이미 분류가 붙은 행에서 규칙을 역산**한다 — 증거가 있는 것만 쓴다.
 *
 * 🔴 실측이 이 방법의 한계를 그대로 말한다(2026-08-26):
 *    · 미분류 **166,689건** 중 증거 있는 2자리 접두가 덮는 것은 **5,084건(3.0%)**
 *    · 그중에도 `E6`·`MM`·`X2` 는 **증거 자체가 두 분류로 갈린다**
 *    → **97% 는 접두로 채울 수 없다.** 그것은 고시 원본 파일(고시 반영 탭)로만 채워진다.
 *
 * 그래서 이 도구는 **제안만** 하고, 적용분에는 `categorySource='PREFIX_DERIVED'` 를 남긴다.
 */
export interface CategorySuggestion {
  prefix: string;
  category: string;
  /** 이 접두에 이 분류가 붙어 있는 기존 행 수(= 근거의 두께) */
  evidence: number;
  /** 이 제안이 채울 미분류 행 수 */
  affects: number;
}

export interface CategorySuggestionReport {
  suggestions: CategorySuggestion[];
  /** 🔴 증거가 두 분류로 갈려 **제안하지 않은** 접두 — 숨기면 "규칙이 깨끗하다"로 읽힌다 */
  ambiguous: { prefix: string; categories: { category: string; evidence: number }[]; affects: number }[];
  uncategorizedTotal: number;
  coveredBySuggestions: number;
  /**
   * 수가 코드 전체 행수(분류됨 + 미분류) — 🔴 (2026-09-11) 화면이 이 수를 **상수 166744** 로 박아 두고 실측처럼 말했다.
   *    증거 행수와 미분류 행수의 합이라 추가 조회가 없다.
   */
  codeTotal: number;
  /** `notesMsg` 의 한국어 파생(같은 순서) — 화면은 `notesMsg` 를 `<ServerText>` 로 조립한다(2026-09-15 I2) */
  notes: string[];
  notesMsg: ServerMessage[];
}

/** 접두 길이 — 1자리는 갈리는 것이 많아(H→영상/방사선치료) 2자리로 본다 */
const PREFIX_LEN = 2;

@Injectable()
export class CodeCategoryDeriveService {
  private readonly logger = new Logger(CodeCategoryDeriveService.name);

  constructor(private readonly prisma: PrismaService) {}

  async suggest(): Promise<CategorySuggestionReport> {
    // ① 증거 — 이미 분류가 붙은 행에서 접두별 분류 분포
    const evidenceRows = await this.prisma.$queryRawUnsafe<
      { prefix: string; category: string; n: bigint }[]
    >(
      `SELECT left(code, ${PREFIX_LEN}) AS prefix, category, count(*)::bigint AS n
       FROM procedure_codes
       WHERE category IS NOT NULL AND category <> ''
       GROUP BY 1, 2`,
    );

    const byPrefix = new Map<string, { category: string; evidence: number }[]>();
    for (const r of evidenceRows) {
      const list = byPrefix.get(r.prefix) ?? [];
      list.push({ category: r.category, evidence: Number(r.n) });
      byPrefix.set(r.prefix, list);
    }

    // ② 미분류 행수 — 접두별
    const uncatRows = await this.prisma.$queryRawUnsafe<{ prefix: string; n: bigint }[]>(
      `SELECT left(code, ${PREFIX_LEN}) AS prefix, count(*)::bigint AS n
       FROM procedure_codes
       WHERE category IS NULL OR category = ''
       GROUP BY 1`,
    );
    const uncatBy = new Map(uncatRows.map((r) => [r.prefix, Number(r.n)]));
    const uncategorizedTotal = uncatRows.reduce((a, r) => a + Number(r.n), 0);
    const codeTotal = evidenceRows.reduce((a, r) => a + Number(r.n), 0) + uncategorizedTotal;

    const suggestions: CategorySuggestion[] = [];
    const ambiguous: CategorySuggestionReport['ambiguous'] = [];

    for (const [prefix, cats] of byPrefix) {
      const affects = uncatBy.get(prefix) ?? 0;
      if (affects === 0) continue; // 채울 것이 없으면 제안하지 않는다
      if (cats.length > 1) {
        // 🔴 증거가 갈리면 **고르지 않는다.** 다수결로 정하면 그것이 규칙인 척한다.
        ambiguous.push({
          prefix,
          categories: cats.sort((a, b) => b.evidence - a.evidence),
          affects,
        });
        continue;
      }
      suggestions.push({ prefix, category: cats[0].category, evidence: cats[0].evidence, affects });
    }

    suggestions.sort((a, b) => b.affects - a.affects);
    ambiguous.sort((a, b) => b.affects - a.affects);
    const covered = suggestions.reduce((a, s) => a + s.affects, 0);

    const notesMsg: ServerMessage[] = [
      serverMsg('🔴 접두 {자리}자리 증거로 채울 수 있는 것은 미분류 {미분류}건 중 {채움}건({비율}%)입니다.', {
        자리: PREFIX_LEN,
        미분류: uncategorizedTotal.toLocaleString(),
        채움: covered.toLocaleString(),
        비율: uncategorizedTotal ? Math.round((covered / uncategorizedTotal) * 1000) / 10 : 0,
      }),
      serverMsg('🔴 나머지는 접두로 채울 수 없습니다 — 고시 원본 파일을 [고시 반영] 탭으로 올려야 채워집니다.'),
      serverMsg('🔴 적용분에는 출처가 `PREFIX_DERIVED` 로 남습니다. 고시 분류와 구분해서 읽으세요.'),
    ];
    if (ambiguous.length) {
      notesMsg.push(serverMsg('🔴 증거가 두 갈래 이상인 접두 {개수}개({건수}건)는 제안하지 않았습니다 — 다수결로 정하면 그 추정이 규칙인 척합니다.', {
        개수: ambiguous.length,
        건수: ambiguous.reduce((a, x) => a + x.affects, 0).toLocaleString(),
      }));
    }

    return {
      suggestions, ambiguous, uncategorizedTotal, coveredBySuggestions: covered, codeTotal,
      notes: notesMsg.map(renderServerMessageKo), notesMsg,
    };
  }

  /**
   * 제안 적용 — 🔴 **사람이 고른 접두만** 적용한다. 전량 자동 적용은 없다.
   * 🔴 이미 분류가 있는 행은 건드리지 않는다(고시 분류를 추정으로 덮지 않는다).
   */
  async apply(prefixes: string[], userId: string) {
    const report = await this.suggest();
    const allowed = new Map(report.suggestions.map((s) => [s.prefix, s.category]));

    const applied: { prefix: string; category: string; count: number }[] = [];
    const rejected: string[] = [];

    for (const p of [...new Set(prefixes)]) {
      const category = allowed.get(p);
      if (!category) {
        // 🔴 제안 목록에 없는 접두는 적용하지 않는다(모호하거나 증거가 없다)
        rejected.push(p);
        continue;
      }
      const res = await this.prisma.$executeRawUnsafe(
        `UPDATE procedure_codes
            SET category = $1, category_source = 'PREFIX_DERIVED', updated_at = now()
          WHERE left(code, ${PREFIX_LEN}) = $2
            AND (category IS NULL OR category = '')`,
        category,
        p,
      );
      applied.push({ prefix: p, category, count: Number(res) });
    }

    this.logger.log(
      `수가 분류 접두 유도 적용 — ${applied.map((a) => `${a.prefix}→${a.category}(${a.count})`).join(', ')} · 거절 ${rejected.length}건${rejected.length ? `(${rejected.join(',')})` : ''} · by ${userId}`,
    );

    return {
      applied,
      rejected,
      totalUpdated: applied.reduce((a, x) => a + x.count, 0),
      notice:
        '적용분의 출처는 `PREFIX_DERIVED` 입니다 — 고시 분류가 아닙니다. ' +
        '고시 원본 파일을 반영하면 그 값으로 덮입니다.',
    };
  }
}
