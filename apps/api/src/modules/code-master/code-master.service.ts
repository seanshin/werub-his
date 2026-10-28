import { Injectable, Optional, BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { todayDateOnly } from '../../common/day-range';
import { serverMsg, renderServerMessageKo } from '@hospital-run/shared';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { CodeQueryDto } from './dto/code-query.dto';
import { medicationSearchOrTerms } from '../../common/medication-search';
import { CodeUsageService } from './code-usage.service';
import { CodeSynonymService, CodeSearchPlan } from './code-synonym.service';

// 🔴 입력 DTO 는 class-validator 클래스로 승격돼 dto/ 로 옮겼다(interface 는 metatype Object 라 검증 스킵).
//    컨트롤러가 `./code-master.service` 에서 import 하므로 재export 로 경로를 유지한다.
export {
  CreateDiagnosisInput, UpdateDiagnosisInput,
  CreateProcedureInput, UpdateProcedureInput,
  CreateMedicationInput, UpdateMedicationInput,
} from './dto/code-master.dto';
import type {
  CreateDiagnosisInput, UpdateDiagnosisInput,
  CreateProcedureInput, UpdateProcedureInput,
  CreateMedicationInput, UpdateMedicationInput,
} from './dto/code-master.dto';

export interface CreateLabTestInput {
  code: string;
  loincCode?: string;
  nameKo: string;
  nameEn?: string;
  category?: string;
  specimen?: string;
  unit?: string;
  refRangeMale?: string;
  refRangeFemale?: string;
  turnaroundMin?: number | string;
  ediCode?: string;
  [key: string]: unknown;
}

@Injectable()
export class CodeMasterService {
  private readonly logger = new Logger(CodeMasterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly codeUsage: CodeUsageService,
    private readonly synonyms: CodeSynonymService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  // ── Diagnosis Codes (KCD) ──

  async searchDiagnosis(query: CodeQueryDto) {
    const plan = await this.synonyms.plan('DiagnosisCode', query.q, { wide: query.wide });
    const where = this.buildDiagnosisWhere(query, plan);
    const [data, total, pinned] = await Promise.all([
      this.prisma.diagnosisCode.findMany({
        where,
        skip: ((query.page ?? 1) - 1) * (query.limit ?? 20),
        take: query.limit ?? 20,
        orderBy: { code: 'asc' },
      }),
      this.prisma.diagnosisCode.count({ where }),
      // 🔴 동의어가 지목한 코드는 **목록에 섞지 않고 따로** 낸다.
      //    목록 안에서 위로 올리면 페이지 수·총 건수가 어긋나 화면이 거짓말을 한다.
      plan.pinnedCodes.length
        ? this.prisma.diagnosisCode.findMany({ where: { code: { in: plan.pinnedCodes } }, take: 20 })
        : Promise.resolve([]),
    ]);
    return this.withSearchMeta(this.paginate(data, total, query), plan, pinned);
  }

  async getDiagnosisByCode(code: string, codeSystem: string = 'KCD-8') {
    if (this.cache) {
      return this.cache.getOrSet(`dx:${codeSystem}:${code}`, 300, () =>
        this.prisma.diagnosisCode.findUnique({ where: { codeSystem_code: { codeSystem, code } } }),
      );
    }
    return this.prisma.diagnosisCode.findUnique({
      where: { codeSystem_code: { codeSystem, code } },
    });
  }

  /** KCD 트리 탐색용 3자리 분류 그룹 — 챕터 범위(left3 BETWEEN) 내 그룹·대표명·건수 (마스터 데이터라 10분 캐시) */
  async diagnosisGroups(from: string, to: string) {
    const f = (from ?? '').toUpperCase().slice(0, 3);
    const t = (to ?? '').toUpperCase().slice(0, 3);
    if (!/^[A-Z]\d\d$/.test(f) || !/^[A-Z]\d\d$/.test(t)) return [];
    if (this.cache) {
      return this.cache.getOrSet(`dx-groups:${f}:${t}`, 600, () => this.computeDiagnosisGroups(f, t));
    }
    return this.computeDiagnosisGroups(f, t);
  }

  private async computeDiagnosisGroups(f: string, t: string) {
    const rows = await this.prisma.$queryRaw<{ prefix: string; cnt: number }[]>`
      SELECT left(code,3) AS prefix, count(*)::int AS cnt
      FROM diagnosis_codes
      WHERE code_system='KCD-8' AND is_active AND left(code,3) BETWEEN ${f} AND ${t}
      GROUP BY 1 ORDER BY 1`;
    if (!rows.length) return [];
    // 그룹명: 3자리 코드 자체(예: I10)가 있으면 그 이름, 없으면 그룹 첫 코드명
    const names = await this.prisma.diagnosisCode.findMany({
      where: { codeSystem: 'KCD-8', code: { in: rows.map((r) => r.prefix) } },
      select: { code: true, nameKo: true },
    });
    const nmap = new Map(names.map((n) => [n.code, n.nameKo]));
    const missing = rows.filter((r) => !nmap.has(r.prefix)).map((r) => r.prefix);
    if (missing.length) {
      const reps = await this.prisma.diagnosisCode.findMany({
        where: { codeSystem: 'KCD-8', isActive: true, OR: missing.map((p) => ({ code: { startsWith: p } })) },
        orderBy: { code: 'asc' },
        select: { code: true, nameKo: true },
      });
      for (const r of reps) {
        const pfx = r.code.slice(0, 3);
        if (!nmap.has(pfx)) nmap.set(pfx, r.nameKo);
      }
    }
    return rows.map((r) => ({ prefix: r.prefix, name: nmap.get(r.prefix) ?? r.prefix, count: r.cnt }));
  }

  /**
   * 출처 필터 — `UNKNOWN` 은 **표기 없음**(`null`)이다.
   * 🔴 기존 209,000행은 일괄로 `HIRA` 라고 찍지 않았다 — 그 행들이 어디서 왔는지 우리는 모른다.
   */
  private originCondition(origin?: string) {
    if (!origin) return null;
    return origin === 'UNKNOWN' ? { origin: null } : { origin };
  }

  private buildDiagnosisWhere(query: CodeQueryDto, plan?: CodeSearchPlan): Prisma.DiagnosisCodeWhereInput {
    const conditions: Prisma.DiagnosisCodeWhereInput[] = [];

    if (query.active !== undefined) {
      conditions.push({ isActive: query.active });
    }
    const originCond = this.originCondition(query.origin) as Prisma.DiagnosisCodeWhereInput | null;
    if (originCond) conditions.push(originCond);
    if (query.codeSystem) {
      conditions.push({ codeSystem: query.codeSystem });
    }
    if (query.category) {
      conditions.push({ category: { contains: query.category, mode: 'insensitive' } });
    }
    if (query.q) {
      const qUp = query.q.toUpperCase();
      const or: Prisma.DiagnosisCodeWhereInput[] = [
        { code: { startsWith: qUp } },
        { icd10Code: { startsWith: qUp } },
        { icd11Code: { startsWith: qUp } },
      ];
      // 🔴 이름 매칭은 좁힘 여부에 따라 갈린다.
      //    좁혔으면 단어경계로 걸러진 id 집합만 쓴다(부분일치를 **함께** 넣으면 좁힌 것이 아니다).
      if (plan?.boundaryIds) {
        or.push({ id: { in: plan.boundaryIds } });
      } else {
        for (const t of plan?.terms?.length ? plan.terms : [query.q]) {
          or.push({ nameKo: { contains: t, mode: 'insensitive' } });
          or.push({ nameEn: { contains: t, mode: 'insensitive' } });
        }
      }
      // 무점 코드 검색(J000) → dotted 변형(J00.0) OR 추가 — KCD 마스터는 점 표기 정본
      if (/^[A-Za-z]\d{3,}$/.test(query.q)) {
        or.push({ code: { startsWith: `${qUp.slice(0, 3)}.${qUp.slice(3)}` } });
      }
      conditions.push({ OR: or });
    }

    return conditions.length > 0 ? { AND: conditions } : {};
  }

  // ── Procedure Codes (EDI) ──

  async searchProcedure(query: CodeQueryDto) {
    const plan = await this.synonyms.plan('ProcedureCode', query.q, { wide: query.wide });
    const where = this.buildProcedureWhere(query, plan);
    const [data, total, pinned] = await Promise.all([
      this.prisma.procedureCode.findMany({
        where,
        skip: ((query.page ?? 1) - 1) * (query.limit ?? 20),
        take: query.limit ?? 20,
        orderBy: { code: 'asc' },
      }),
      this.prisma.procedureCode.count({ where }),
      plan.pinnedCodes.length
        ? this.prisma.procedureCode.findMany({ where: { code: { in: plan.pinnedCodes } }, take: 20 })
        : Promise.resolve([]),
    ]);
    return this.withSearchMeta(this.paginate(data, total, query), plan, pinned);
  }

  /** 시점 유효 수가 버전 조회(temporal: asOf 기준 최신 적용 버전) */
  async getProcedureByCode(code: string, asOf: Date = new Date()) {
    return this.prisma.procedureCode.findFirst({
      where: { code, validFrom: { lte: asOf }, OR: [{ validTo: null }, { validTo: { gte: asOf } }] },
      orderBy: { validFrom: 'desc' },
    });
  }

  private buildProcedureWhere(query: CodeQueryDto, plan?: CodeSearchPlan): Prisma.ProcedureCodeWhereInput {
    const conditions: Prisma.ProcedureCodeWhereInput[] = [];

    if (query.active !== undefined) {
      conditions.push({ isActive: query.active });
    }
    const originCond = this.originCondition(query.origin) as Prisma.ProcedureCodeWhereInput | null;
    if (originCond) conditions.push(originCond);
    if (query.category) {
      conditions.push({ category: { contains: query.category, mode: 'insensitive' } });
    }
    if (query.q) {
      const or: Prisma.ProcedureCodeWhereInput[] = [{ code: { startsWith: query.q.toUpperCase() } }];
      if (plan?.boundaryIds) {
        or.push({ id: { in: plan.boundaryIds } });
      } else {
        for (const t of plan?.terms?.length ? plan.terms : [query.q]) {
          or.push({ nameKo: { contains: t, mode: 'insensitive' } });
        }
      }
      conditions.push({ OR: or });
    }

    return conditions.length > 0 ? { AND: conditions } : {};
  }

  // ── Medication Codes ──

  async searchMedication(query: CodeQueryDto) {
    const plan = await this.synonyms.plan('MedicationCode', query.q, { wide: query.wide });
    const where = this.buildMedicationWhere(query, plan);
    const [data, total, pinned] = await Promise.all([
      this.prisma.medicationCode.findMany({
        where,
        skip: ((query.page ?? 1) - 1) * (query.limit ?? 20),
        take: query.limit ?? 20,
        orderBy: { code: 'asc' },
      }),
      this.prisma.medicationCode.count({ where }),
      plan.pinnedCodes.length
        ? this.prisma.medicationCode.findMany({ where: { code: { in: plan.pinnedCodes } }, take: 20 })
        : Promise.resolve([]),
    ]);
    return this.withSearchMeta(this.paginate(data, total, query), plan, pinned);
  }

  async getMedicationByCode(code: string) {
    return this.prisma.medicationCode.findUnique({ where: { code } });
  }

  private buildMedicationWhere(query: CodeQueryDto, plan?: CodeSearchPlan): Prisma.MedicationCodeWhereInput {
    const conditions: Prisma.MedicationCodeWhereInput[] = [];

    if (query.active !== undefined) {
      conditions.push({ isActive: query.active });
    }
    const originCond = this.originCondition(query.origin) as Prisma.MedicationCodeWhereInput | null;
    if (originCond) conditions.push(originCond);
    if (query.q) {
      // 한/영 병용 P1(D2): 공용 빌더로 수렴 — 종전 이 EP 의 규약이 정본으로 승격된 형태라 동작 동일.
      // 🔴 동의어 확장이 붙어도 **정본 빌더를 갈라 쓰지 않는다** — 확장어마다 같은 빌더를 부른다.
      if (plan?.boundaryIds) {
        conditions.push({
          OR: [{ code: { startsWith: query.q.toUpperCase() } }, { id: { in: plan.boundaryIds } }],
        });
      } else {
        // 🔴 확장어마다 정본 빌더의 항을 펼쳐 **한 겹으로** 합친다.
        //    `{OR:[{OR:[…]}]}` 로 감싸면 확장어가 없을 때도 종전과 모양이 달라진다(동작 동일이 깨진다).
        const terms = plan?.terms?.length ? plan.terms : [query.q];
        conditions.push({ OR: terms.flatMap((t) => medicationSearchOrTerms(t)) });
      }
    }
    if (query.category) {
      conditions.push({ category: query.category }); // 약효분류(HIRA 급여표 백필값) 정확 일치
    }

    return conditions.length > 0 ? { AND: conditions } : {};
  }

  // ── Seed ──

  async runSeed() {
    const diagCount = await this.prisma.diagnosisCode.count();
    const procCount = await this.prisma.procedureCode.count();
    const medCount = await this.prisma.medicationCode.count();
    return {
      message: 'Use `npm run db:seed` for full seeding. Current counts:',
      diagnosisCodes: diagCount,
      procedureCodes: procCount,
      medicationCodes: medCount,
    };
  }

  // ── Pagination Helper ──

  private paginate<T>(data: T[], total: number, query: CodeQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return {
      data,
      pagination: {
        total,
        page,
        limit,
        hasMore: page * limit < total,
      },
    };
  }

  /**
   * 검색 응답에 "어떻게 찾았는지"를 붙인다.
   * 🔴 아무 확장·좁힘도 없었으면 아무 말도 하지 않는다 — 늘 붙는 안내는 읽히지 않는다.
   */
  private withSearchMeta<T>(
    page: { data: T[]; pagination: unknown },
    plan: CodeSearchPlan,
    pinned: T[],
  ) {
    const search = CodeSynonymService.describe(plan);
    if (!search && pinned.length === 0) return page;
    return { ...page, search: search ?? null, pinned };
  }

  /**
   * 분류 목록 — 실데이터 집계. 🔴 **분류 없음(`null`)을 숨기지 않는다.**
   * 숨기면 166,689건이 어느 분류로도 도달할 수 없고, 화면은 "수가가 다 반영되지 않았다"로 읽힌다.
   */
  async categoriesOf(kind: string) {
    const table =
      kind === 'diagnosis' ? 'diagnosis_codes'
      : kind === 'procedure' ? 'procedure_codes'
      : kind === 'medication' ? 'medication_codes'
      : null;
    if (!table) throw new BadRequestException(`알 수 없는 코드 종류입니다: ${kind}`);

    const rows = await this.prisma.$queryRawUnsafe<{ category: string | null; n: bigint }[]>(
      `SELECT category, count(*)::bigint AS n FROM ${table} WHERE is_active GROUP BY category ORDER BY n DESC`,
    );
    const named = rows
      .filter((r) => r.category !== null && r.category !== '')
      .map((r) => ({ name: r.category as string, count: Number(r.n) }));
    const uncategorized = rows
      .filter((r) => r.category === null || r.category === '')
      .reduce((a, r) => a + Number(r.n), 0);
    const total = named.reduce((a, r) => a + r.count, 0) + uncategorized;
    const noteMsg = uncategorized > 0
      ? serverMsg('분류가 비어 있는 코드가 {건수}건입니다 — 분류로 거르면 보이지 않습니다.', { 건수: uncategorized.toLocaleString() })
      : null;

    return {
      categories: named,
      /** 🔴 분류가 비어 있는 건수 — 0 이 아니라 실제 값. 화면이 이것을 고를 수 있어야 한다 */
      uncategorized,
      total,
      /** 화면이 그대로 말한다 — `noteMsg` 가 정본(2026-09-15 I2), `note` 는 한국어 파생 */
      note: noteMsg ? renderServerMessageKo(noteMsg) : null,
      noteMsg,
    };
  }

  // ── CRUD ──

  /** 🔴 (L1) 코드↔매핑은 한 트랜잭션 — 매핑만 빠진 코드가 남으면 다시 만들 수도 없다(코드 유니크) */
  async createDiagnosis(data: CreateDiagnosisInput) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.diagnosisCode.create({
        // 🔴 사람이 화면에서 만든 코드는 **원내 등록**이다 — 고시 파일에 없는 것이 정상이고,
        //    고시 반영 미리보기가 이것을 '폐지 후보'로 세지 않게 한다.
        data: { codeSystem: data.codeSystem ?? 'KCD-8', code: data.code, nameKo: data.nameKo, nameEn: data.nameEn, category: data.category, chapter: data.chapter, icd10Code: data.icd10Code, icd11Code: data.icd11Code, validFrom: todayDateOnly(), origin: 'LOCAL' },
      });
      // 자동 매핑: ICD-10 코드가 있으면 ICD-10 매핑 자동 생성
      if (data.icd10Code) {
        await tx.terminologyMapping.upsert({
          where: { sourceTable_sourceId_targetSystem_targetCode: { sourceTable: 'diagnosis_codes', sourceId: created.id, targetSystem: 'ICD-10', targetCode: data.icd10Code } },
          update: {},
          create: { sourceTable: 'diagnosis_codes', sourceId: created.id, sourceCode: data.code, targetSystem: 'ICD-10', targetCode: data.icd10Code, targetDisplay: data.nameEn ?? data.nameKo, equivalence: 'equivalent', mapSource: 'AUTO' },
        });
      }
      return created;
    });
  }

  async updateDiagnosis(id: string, data: UpdateDiagnosisInput) {
    return this.prisma.diagnosisCode.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
  }

  /**
   * 🔴 **사용 중인 코드를 확인 없이 중지하지 못한다**(2026-08-26).
   *
   *    지금까지 `delete*` 는 곧바로 `isActive:false` 로 만들었다. 그 코드를 쓰던 처방·오더·문제목록은
   *    조용히 깨졌고, 무엇이 깨졌는지 아무도 몰랐다.
   *
   *    🔴 **막는 것이 목적이 아니다** — 폐지해야 하는 코드는 폐지해야 한다.
   *    사용처를 **본 뒤에** 진행했다는 사실을 남기는 것이 목적이라, `force` 를 주면 진행하되
   *    그때 사용 건수를 함께 기록한다(사유 없는 강행을 허용하지 않는다).
   *
   *    🔴 **세지 못했을 때도 막는다.** "사용처 없음"과 "못 셈"은 다른 사실이고,
   *    후자를 통과시키면 이 가드는 있으나 마나다.
   */
  private async assertDeactivatable(sourceTable: string, id: string, opts?: { force?: boolean; reason?: string }) {
    const usage = await this.codeUsage.getUsage(sourceTable, id);
    if (usage.safeToDeactivate) return usage;

    if (opts?.force) {
      if (!opts.reason?.trim()) {
        throw new BadRequestException({
          code: 'CODE_DEACTIVATE_REASON_REQUIRED',
          message: '사용 중인 코드를 중지하려면 사유가 필요합니다',
          usage,
        });
      }
      this.logger.warn(
        `코드 강제 중지 — ${sourceTable}/${id} · 사용 ${usage.total ?? '집계 실패'}건 · 사유: ${opts.reason}`,
      );
      return usage;
    }

    throw new BadRequestException({
      code: usage.total === null ? 'CODE_USAGE_UNKNOWN' : 'CODE_IN_USE',
      message:
        usage.total === null
          ? `사용처를 전부 확인하지 못했습니다(${usage.countedRefs}/${usage.totalRefs}) — 확인 전에는 중지하지 않습니다`
          : `이 코드는 ${usage.total}건에서 사용 중입니다 — 중지하면 해당 기록·오더가 영향을 받습니다`,
      usage,
    });
  }

  async deleteDiagnosis(id: string, opts?: { force?: boolean; reason?: string }) {
    await this.assertDeactivatable('diagnosis', id, opts);
    return this.prisma.diagnosisCode.update({ where: { id }, data: { isActive: false } });
  }

  /** 🔴 (L1) 코드↔매핑은 한 트랜잭션 — `createMedication` 과 같은 쌍둥이(종전엔 매핑 실패를 삼켰다) */
  async createProcedure(data: CreateProcedureInput) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.procedureCode.create({
        /**
         * 🔴 (2026-09-15 D3) 종전 `unitPrice ?? 0` · `copayRate ?? 0.3` — 미입력을 **0원·본인부담 30%** 라는
         *    수가 사실로 박았다. 두 칸 모두 nullable 이고, 청구는 본인부담 우선순위 정본이 판정한다(§본인부담).
         *    모르는 수가를 지어내면 그 코드로 나간 청구가 조용히 틀린다 — 미입력은 null(미설정)로 남긴다.
         */
        data: { code: data.code, nameKo: data.nameKo, category: data.category, unitPrice: data.unitPrice ?? null, copayRate: data.copayRate ?? null, insuranceCovered: data.insuranceCovered ?? true, validFrom: todayDateOnly(), origin: 'LOCAL' },
      });
      if (data.snomedCode) {
        await tx.terminologyMapping.create({
          data: { sourceTable: 'procedure_codes', sourceId: created.id, sourceCode: data.code, targetSystem: 'SNOMED_CT', targetCode: data.snomedCode, targetDisplay: data.nameEn ?? data.nameKo, equivalence: 'equivalent', mapSource: 'AUTO' },
        });
      }
      return created;
    });
  }

  async updateProcedure(id: string, data: UpdateProcedureInput) {
    return this.prisma.procedureCode.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
  }

  async deleteProcedure(id: string, opts?: { force?: boolean; reason?: string }) {
    await this.assertDeactivatable('procedure', id, opts);
    return this.prisma.procedureCode.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * 🔴 (2026-09-17 L1) 코드 생성과 용어 매핑이 **트랜잭션 밖 순차**였고, 게다가 매핑 실패를
   *    `.catch(() => {})` 로 삼켰다 — 사용자가 SNOMED 코드를 **입력했는데** 코드만 생기고 매핑은
   *    말없이 사라진다. 코드는 유니크라 다시 만들 수도 없어(중복) 그 코드의 매핑은 영영 비고,
   *    FHIR 반출·용어 대조는 그 코드를 매핑 없는 코드로 본다.
   *    이제 한 트랜잭션으로 묶는다 — 매핑이 실패하면 코드도 서지 않아 **다시 시도할 수 있다**.
   */
  async createMedication(data: CreateMedicationInput) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.medicationCode.create({
        data: { code: data.code, nameKo: data.nameKo, nameEn: data.nameEn, ingredient: data.ingredient, manufacturer: data.manufacturer, dosageForm: data.dosageForm, unit: data.unit, unitPrice: data.unitPrice ?? 0, validFrom: todayDateOnly(), origin: 'LOCAL' },
      });
      if (data.snomedCode) {
        await tx.terminologyMapping.create({
          data: { sourceTable: 'medication_codes', sourceId: created.id, sourceCode: data.code, targetSystem: 'SNOMED_CT', targetCode: data.snomedCode, targetDisplay: data.nameEn ?? data.nameKo, equivalence: 'equivalent', mapSource: 'AUTO' },
        });
      }
      return created;
    });
  }

  async updateMedication(id: string, data: UpdateMedicationInput) {
    return this.prisma.medicationCode.update({ where: { id }, data: { ...data, updatedAt: new Date() } });
  }

  async deleteMedication(id: string, opts?: { force?: boolean; reason?: string }) {
    await this.assertDeactivatable('medication', id, opts);
    return this.prisma.medicationCode.update({ where: { id }, data: { isActive: false } });
  }

  // ── 검사항목 코드 ──
  async searchLabTests(query: string, category?: string) {
    const where: Prisma.LabTestCodeWhereInput = { isActive: true };
    if (query) where.OR = [{ code: { contains: query, mode: 'insensitive' } }, { nameKo: { contains: query } }, { nameEn: { contains: query, mode: 'insensitive' } }];
    if (category) where.category = category;
    return this.prisma.labTestCode.findMany({ where, orderBy: { code: 'asc' }, take: 50 });
  }

  /** 🔴 (L1) 코드↔매핑은 한 트랜잭션 — 네 생성 경로(진단·수가·약품·검사)가 같은 쌍둥이다 */
  async createLabTest(data: CreateLabTestInput) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.labTestCode.create({
        data: { code: data.code, loincCode: data.loincCode ?? null, nameKo: data.nameKo, nameEn: data.nameEn ?? null, category: data.category ?? '', specimen: data.specimen ?? null, unit: data.unit ?? null, refRangeMale: data.refRangeMale ?? null, refRangeFemale: data.refRangeFemale ?? null, turnaroundMin: data.turnaroundMin ? Number(data.turnaroundMin) : null, ediCode: data.ediCode ?? null },
      });
      // LOINC 자동 매핑
      if (data.loincCode) {
        await tx.terminologyMapping.upsert({
          where: { sourceTable_sourceId_targetSystem_targetCode: { sourceTable: 'lab_test_codes', sourceId: created.id, targetSystem: 'LOINC', targetCode: data.loincCode } },
          update: {},
          create: { sourceTable: 'lab_test_codes', sourceId: created.id, sourceCode: data.code, targetSystem: 'LOINC', targetCode: data.loincCode, targetDisplay: data.nameEn ?? data.nameKo, equivalence: 'equivalent', mapSource: 'AUTO' },
        });
      }
      return created;
    });
  }

  // ── 투여경로 ──
  async listRoutes() {
    return this.prisma.medicationRoute.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  }

  // ── 진료과 코드 ──
  async listDepartments(category?: string) {
    const where: Prisma.DepartmentCodeWhereInput = { isActive: true };
    if (category) where.category = category;
    return this.prisma.departmentCode.findMany({ where, orderBy: { sortOrder: 'asc' } });
  }

  // ── 수술/마취 코드 ──
  async listSurgeryAnesthesia(codeType?: string) {
    const where: Prisma.SurgeryAnesthesiaCodeWhereInput = { isActive: true };
    if (codeType) where.codeType = codeType;
    return this.prisma.surgeryAnesthesiaCode.findMany({ where, orderBy: [{ codeType: 'asc' }, { sortOrder: 'asc' }] });
  }

  // ── 표준 매핑 ──

  async getMappings(sourceTable?: string, sourceCode?: string, targetSystem?: string) {
    const where: Prisma.TerminologyMappingWhereInput = { isActive: true };
    if (sourceTable) where.sourceTable = sourceTable;
    if (sourceCode) where.sourceCode = sourceCode;
    if (targetSystem) where.targetSystem = targetSystem;
    return this.prisma.terminologyMapping.findMany({ where, orderBy: { targetSystem: 'asc' }, take: 100 });
  }

  async getMappingsForCode(sourceTable: string, sourceId: string) {
    return this.prisma.terminologyMapping.findMany({
      where: { sourceTable, sourceId, isActive: true },
      orderBy: { targetSystem: 'asc' },
    });
  }

  async getMappingAuditLogs(sourceTable: string, sourceId: string) {
    const mappings = await this.prisma.terminologyMapping.findMany({
      where: { sourceTable, sourceId },
      select: { id: true },
    });
    if (mappings.length === 0) return [];
    const mappingIds = mappings.map(m => m.id);
    return this.prisma.mappingAuditLog.findMany({
      where: { mappingId: { in: mappingIds } },
      orderBy: { performedAt: 'desc' },
      take: 50,
    });
  }

  /**
   * 표준 매핑 수동 추가 — 작성자(`createdBy`)는 **호출한 인증 사용자**만(본문에서 받지 않는다·지어내지 않는다).
   * 인증 사용자를 모르면 null(추정 금지). 기존 null 행은 소급하지 않는다.
   */
  async createMapping(data: Omit<Prisma.TerminologyMappingUncheckedCreateInput, 'createdBy'>, userId?: string | null) {
    return this.prisma.terminologyMapping.create({ data: { ...data, createdBy: userId ?? null } });
  }

  // ── 간호 코드 ──

  /**
   * 간호코드 검색(NANDA-I/NIC/NOC/MedDRA/ICF).
   *
   * 🔴 2026-08-14 W8 — 종전엔 `take: 100` 만 있고 총건수도 페이지도 없었다. 운영 167건을
   *    `codeSystem asc` 로 정렬해 100건에서 자르면 ICF 13·MedDRA 34·NANDA_I 53 까지만 나오고
   *    **NIC 50 과 NOC 12 는 화면에서 통째로 사라졌다**(잘렸다는 표시도 없었다).
   *    관리 화면의 분류 필터에도 NOC 가 빠져 있어 **NOC 12건은 어느 경로로도 도달 불가**였다.
   *    → 총건수와 페이지를 돌려주어 전건에 도달할 수 있게 한다(상한은 남기되 화면이 잘림을 안다).
   */
  async searchNursingCodes(codeSystem?: string, domain?: string, q?: string, limit = 100, page = 1) {
    const where: Prisma.NursingCodeWhereInput = { isActive: true };
    if (codeSystem) where.codeSystem = codeSystem;
    if (domain) where.domain = domain;
    if (q) where.OR = [{ code: { contains: q } }, { nameKo: { contains: q } }, { nameEn: { contains: q, mode: 'insensitive' } }];

    const take = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500);
    const currentPage = Math.max(Math.trunc(page) || 1, 1);
    const [items, total] = await Promise.all([
      this.prisma.nursingCode.findMany({
        where,
        orderBy: [{ codeSystem: 'asc' }, { sortOrder: 'asc' }],
        skip: (currentPage - 1) * take,
        take,
      }),
      this.prisma.nursingCode.count({ where }),
    ]);
    return { items, total, page: currentPage, limit: take, hasMore: currentPage * take < total };
  }
}
