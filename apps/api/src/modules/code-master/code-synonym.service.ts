import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DIAGNOSIS_SYNONYM_SEED, seedNote } from './builtin-synonyms';
import { serverMsg, renderServerMessageKo, type ServerMessage } from '@hospital-run/shared';
import {
  NARROW_EMPTY_NOTE,
  NARROW_NOTE,
  WIDENED_NOTE,
  SYNONYM_KINDS,
  SYNONYM_SOURCE_TABLES,
  SynonymSourceTable,
  isShortLatinQuery,
  normalizeTerm,
  wordBoundaryPattern,
} from '../../common/code-search';

/** 검색어를 넓힌 근거 — 화면이 "왜 이것이 나왔는지" 말할 수 있어야 한다 */
export interface SynonymHit {
  term: string;
  expandsTo: string | null;
  code: string | null;
  kind: string;
}

export interface CodeSearchPlan {
  /** 이름 매칭에 쓸 질의어들(원 질의 + 승인된 확장어) */
  terms: string[];
  /** 동의어가 직접 지목한 코드 — 결과 위로 올린다 */
  pinnedCodes: string[];
  /** 무엇을 통해 넓혔나 */
  via: SynonymHit[];
  /** 좁힘이 일어났나(짧은 영문 약어) */
  narrowed: boolean;
  narrowNote: string | null;
  /** 사람이 명시적으로 넓혀 달라고 했나(`wide=1`) */
  widenedByRequest: boolean;
  /** 단어경계 후보 id — 좁힘이 일어난 경우에만 채워진다(빈 배열 = 단어 단위로 없음) */
  boundaryIds: string[] | null;
  /** 후보를 잘랐나(자르면 잘랐다고 말한다) */
  boundaryTruncated: boolean;
  /**
   * 넓히면 몇 건인가 — 🔴 **넓힌 결과를 주는 대신 건수를 준다.**
   * `PE` 는 부분일치로 7,592건이고 그중 폐색전은 사실상 없다(운영 실측).
   */
  wideCount: number | null;
}

/** 좁힘 후보 상한 — 넘으면 자르고 그 사실을 응답에 싣는다 */
const BOUNDARY_LIMIT = 2000;

const TABLE_SQL: Record<SynonymSourceTable, { table: string; nameCols: string[] }> = {
  DiagnosisCode: { table: 'diagnosis_codes', nameCols: ['name_ko', 'name_en'] },
  ProcedureCode: { table: 'procedure_codes', nameCols: ['name_ko'] },
  MedicationCode: { table: 'medication_codes', nameCols: ['name_ko', 'name_en', 'ingredient'] },
  LabTestCode: { table: 'lab_test_codes', nameCols: ['name_ko', 'name_en'] },
};

/**
 * 코드 동의어·약어 사전과 검색 확장.
 *
 * 🔴 **승인된 것만 검색에 쓴다.** 동의어가 틀리면 다른 병을 고르게 된다.
 *    배포분에 담긴 사전은 전부 `PROPOSED` 이며 **승인 전에는 검색을 바꾸지 않는다**
 *    ("초기 견본은 원내 표준이 아니다").
 */
@Injectable()
export class CodeSynonymService {
  private readonly logger = new Logger(CodeSynonymService.name);

  constructor(private readonly prisma: PrismaService) {}

  private assertTable(t: string): SynonymSourceTable {
    if (!(SYNONYM_SOURCE_TABLES as readonly string[]).includes(t)) {
      throw new BadRequestException(`알 수 없는 코드 종류입니다: ${t}`);
    }
    return t as SynonymSourceTable;
  }

  /**
   * 검색 계획을 세운다 — 확장어·지목 코드·좁힘 여부.
   * 🔴 조회에 실패하면 **원 질의만으로 진행하되 그 사실을 남긴다**.
   *    동의어를 못 읽은 것을 "동의어 없음"으로 번역하지 않는다.
   */
  async plan(
    sourceTableRaw: string,
    q: string | undefined,
    opts: { wide?: boolean } = {},
  ): Promise<CodeSearchPlan> {
    const base: CodeSearchPlan = {
      terms: q ? [q] : [],
      pinnedCodes: [],
      via: [],
      narrowed: false,
      narrowNote: null,
      widenedByRequest: false,
      boundaryIds: null,
      boundaryTruncated: false,
      wideCount: null,
    };
    const query = (q ?? '').trim();
    if (!query) return base;
    const sourceTable = this.assertTable(sourceTableRaw);

    // ── 1. 승인된 동의어 조회
    let hits: SynonymHit[] = [];
    try {
      const rows = await this.prisma.codeSynonym.findMany({
        where: { sourceTable, status: 'APPROVED', termNorm: normalizeTerm(query) },
        select: { term: true, expandsTo: true, code: true, kind: true },
        take: 50,
      });
      hits = rows;
    } catch (e) {
      // 🔴 실패를 "없음"으로 접지 않는다 — 확장이 없었다는 사실을 로그로 남긴다
      this.logger.error(`동의어 조회 실패(확장 없이 진행): ${(e as Error).message}`);
    }

    const terms = [query];
    for (const h of hits) {
      if (h.expandsTo && !terms.includes(h.expandsTo)) terms.push(h.expandsTo);
    }
    const pinnedCodes = hits.map((h) => h.code).filter((c): c is string => !!c);

    // ── 2. 짧은 영문 약어 좁힘
    //    확장어가 생겼다면 그 말로 제대로 찾을 수 있으므로 좁힘은 하지 않는다.
    if (!isShortLatinQuery(query) || terms.length > 1) {
      return { ...base, terms, pinnedCodes, via: hits };
    }
    // 사람이 명시적으로 넓혀 달라고 했으면 넓히되, **넓혔다고 말한다**
    if (opts.wide) {
      return {
        ...base,
        terms,
        pinnedCodes,
        via: hits,
        widenedByRequest: true,
        narrowNote: WIDENED_NOTE,
      };
    }

    let ids: string[] = [];
    let truncated = false;
    try {
      const spec = TABLE_SQL[sourceTable];
      const pattern = wordBoundaryPattern(query);
      const cond = spec.nameCols.map((c) => `${c} ~* $1`).join(' OR ');
      const rows = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM ${spec.table} WHERE ${cond} LIMIT ${BOUNDARY_LIMIT + 1}`,
        pattern,
      );
      truncated = rows.length > BOUNDARY_LIMIT;
      ids = rows.slice(0, BOUNDARY_LIMIT).map((r: { id: string }) => r.id);
    } catch (e) {
      // 🔴 좁히지 못했으면 **좁혔다고 말하지 않는다**(넓은 결과를 좁은 것처럼 보이면 더 나쁘다)
      this.logger.error(`단어경계 좁힘 실패(부분일치로 진행): ${(e as Error).message}`);
      return { ...base, terms, pinnedCodes, via: hits };
    }

    // 🔴 넓히면 몇 건인지 미리 센다 — **넓힌 결과를 주는 대신 건수를 준다.**
    //    `PE` 는 부분일치로 7,592건이고 그중 폐색전은 사실상 없다(운영 실측 2026-08-26).
    //    자동으로 되넓히면 좁힌 의미가 사라진다.
    let wideCount: number | null = null;
    try {
      const spec = TABLE_SQL[sourceTable];
      const cond = spec.nameCols.map((c) => `${c} ILIKE $1`).join(' OR ');
      const rows = await this.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM ${spec.table} WHERE ${cond}`,
        `%${query}%`,
      );
      wideCount = Number(rows[0]?.n ?? 0);
    } catch (e) {
      // 🔴 못 셌으면 0 이라고 하지 않는다 — null 은 "산출 불가"다
      this.logger.error(`넓힘 건수 산출 실패: ${(e as Error).message}`);
    }

    return {
      terms,
      pinnedCodes,
      via: hits,
      narrowed: true,
      narrowNote: ids.length === 0 ? NARROW_EMPTY_NOTE : NARROW_NOTE,
      widenedByRequest: false,
      boundaryIds: ids,
      boundaryTruncated: truncated,
      wideCount,
    };
  }

  /** 응답 meta 로 나가는 부분만 추린다 — 화면이 그대로 말한다 */
  static describe(plan: CodeSearchPlan) {
    if (!plan.via.length && !plan.narrowed && !plan.widenedByRequest) return undefined;
    return {
      synonyms: plan.via.map((h) => ({
        term: h.term,
        expandsTo: h.expandsTo,
        code: h.code,
        kind: h.kind,
      })),
      narrowed: plan.narrowed,
      widenedByRequest: plan.widenedByRequest,
      note: plan.narrowNote,
      truncated: plan.boundaryTruncated,
      /** 넓히면 몇 건인가 — `null` 은 **산출 불가**이지 0 이 아니다 */
      wideCount: plan.wideCount,
    };
  }

  // ── 사전 관리 ──

  async list(params: {
    sourceTable?: string;
    status?: string;
    q?: string;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 200);
    const where: Record<string, unknown> = {};
    if (params.sourceTable) where.sourceTable = this.assertTable(params.sourceTable);
    if (params.status) where.status = params.status;
    if (params.q?.trim()) {
      const t = params.q.trim();
      where.OR = [
        { term: { contains: t, mode: 'insensitive' } },
        { expandsTo: { contains: t, mode: 'insensitive' } },
        { code: { startsWith: t.toUpperCase() } },
      ];
    }
    const [data, total, pending] = await Promise.all([
      this.prisma.codeSynonym.findMany({
        where,
        orderBy: [{ status: 'asc' }, { term: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.codeSynonym.count({ where }),
      this.prisma.codeSynonym.count({ where: { status: 'PROPOSED' } }),
    ]);
    return {
      data,
      meta: {
        total,
        page,
        limit,
        hasMore: page * limit < total,
        /** 🔴 검토 전 건수 — 승인해야 검색에 반영된다는 사실을 화면이 말한다 */
        pendingReview: pending,
      },
    };
  }

  async propose(input: {
    sourceTable: string;
    term: string;
    kind: string;
    code?: string | null;
    codeSystem?: string | null;
    expandsTo?: string | null;
    note?: string | null;
    userId?: string;
  }) {
    const sourceTable = this.assertTable(input.sourceTable);
    const term = (input.term ?? '').trim();
    if (!term) throw new BadRequestException('동의어를 입력하세요');
    if (!(SYNONYM_KINDS as readonly string[]).includes(input.kind)) {
      throw new BadRequestException(`알 수 없는 종류입니다: ${input.kind}`);
    }
    const code = input.code?.trim() || null;
    const expandsTo = input.expandsTo?.trim() || null;
    // 🔴 코드도 확장어도 없으면 아무 일도 하지 않는 동의어다 — 만들지 않는다
    if (!code && !expandsTo) {
      throw new BadRequestException(
        '이 동의어로 무엇을 찾을지가 없습니다 — 코드를 지목하거나 확장어를 적어 주세요',
      );
    }
    const termNorm = normalizeTerm(term);
    if (normalizeTerm(expandsTo ?? '') === termNorm && !code) {
      throw new BadRequestException('확장어가 동의어와 같아 검색이 달라지지 않습니다');
    }

    const existing = await this.prisma.codeSynonym.findFirst({
      where: { sourceTable, termNorm, code },
    });
    if (existing) {
      throw new BadRequestException(
        `이미 등록된 동의어입니다(${existing.term} · ${existing.status})`,
      );
    }

    return this.prisma.codeSynonym.create({
      data: {
        sourceTable,
        code,
        codeKey: code ?? '',
        codeSystem: input.codeSystem?.trim() || null,
        term,
        termNorm,
        expandsTo,
        kind: input.kind,
        status: 'PROPOSED',
        note: input.note?.trim() || null,
        proposedBy: input.userId ?? null,
      },
    });
  }

  async review(id: string, decision: 'APPROVED' | 'REJECTED', userId?: string, note?: string) {
    const row = await this.prisma.codeSynonym.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('동의어를 찾을 수 없습니다');

    // 🔴 지목형 동의어를 승인할 때는 그 코드가 실재하는지 확인한다.
    //    없는 코드를 가리키는 동의어는 조용히 아무것도 찾지 못한다.
    // `warningMsg` 가 정본(화면이 조립 · 2026-09-15 I2), `warning` 은 한국어 파생
    let warningMsg: ServerMessage | null = null;
    if (decision === 'APPROVED' && row.code) {
      const exists = await this.codeExists(row.sourceTable as SynonymSourceTable, row.code);
      if (exists === false) {
        throw new BadRequestException(
          `지목한 코드 ${row.code} 가 코드 마스터에 없습니다 — 승인하면 아무것도 찾지 못합니다`,
        );
      }
      if (exists === null) {
        // 🔴 확인하지 못한 것을 "있다"로도 "없다"로도 말하지 않는다
        warningMsg = serverMsg('코드 {코드} 의 존재를 확인하지 못했습니다 — 승인은 했으나 검색 결과를 눌러 확인하세요', { 코드: row.code });
      }
    }

    const updated = await this.prisma.codeSynonym.update({
      where: { id },
      data: {
        status: decision,
        reviewedBy: userId ?? null,
        reviewedAt: new Date(),
        reviewNote: note?.trim() || null,
      },
    });
    return { data: updated, warning: warningMsg ? renderServerMessageKo(warningMsg) : null, warningMsg };
  }

  /**
   * 기본 사전을 **검토 전(PROPOSED)** 으로 등재한다.
   *
   * 🔴 시드 스크립트가 아니라 **관리자가 눌러서** 들어온다 — 배포만으로 검색이 달라지지 않는다.
   * 🔴 **이미 있는 항목은 건드리지 않는다**(반려한 것을 되살리지 않는다).
   * 🔴 등재해도 **검색은 그대로다** — 승인해야 반영된다.
   */
  async loadBuiltinDictionary(userId?: string) {
    const sourceTable = 'DiagnosisCode';
    const existing = await this.prisma.codeSynonym.findMany({
      where: { sourceTable },
      select: { termNorm: true, codeKey: true, status: true },
    });
    const seen = new Set(existing.map((e) => `${e.termNorm}|${e.codeKey}`));

    const toCreate = DIAGNOSIS_SYNONYM_SEED.filter((x) => !seen.has(`${normalizeTerm(x.term)}|`));
    if (toCreate.length) {
      await this.prisma.codeSynonym.createMany({
        data: toCreate.map((x) => ({
          sourceTable,
          code: null,
          codeKey: '',
          term: x.term,
          termNorm: normalizeTerm(x.term),
          expandsTo: x.expandsTo,
          kind: x.kind,
          status: 'PROPOSED',
          note: seedNote(x),
          proposedBy: userId ?? null,
        })),
      });
    }
    return {
      created: toCreate.length,
      /** 이미 있어서 건드리지 않은 것 — 반려한 것도 여기 포함된다 */
      skipped: DIAGNOSIS_SYNONYM_SEED.length - toCreate.length,
      total: DIAGNOSIS_SYNONYM_SEED.length,
      notice:
        '등재만 했습니다 — **승인하기 전까지 검색은 달라지지 않습니다**. 확장어가 실제로 무엇을 찾는지는 각 항목의 실측 건수를 보세요.',
    };
  }

  /** true=있다 · false=없다 · null=확인 못 함 */
  private async codeExists(sourceTable: SynonymSourceTable, code: string): Promise<boolean | null> {
    try {
      switch (sourceTable) {
        case 'DiagnosisCode':
          return (await this.prisma.diagnosisCode.count({ where: { code } })) > 0;
        case 'ProcedureCode':
          return (await this.prisma.procedureCode.count({ where: { code } })) > 0;
        case 'MedicationCode':
          return (await this.prisma.medicationCode.count({ where: { code } })) > 0;
        case 'LabTestCode':
          return (await this.prisma.labTestCode.count({ where: { code } })) > 0;
        default:
          return null;
      }
    } catch (e) {
      this.logger.error(`코드 존재 확인 실패(${sourceTable}/${code}): ${(e as Error).message}`);
      return null;
    }
  }
}
