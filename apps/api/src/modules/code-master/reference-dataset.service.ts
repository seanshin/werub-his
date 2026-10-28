import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { isValidGtin, GRADE_FEE_COLUMN, gazetteFeeOf, type InstitutionGrade } from '@hospital-run/shared';
import { ConfigRuntimeService } from '../config/config-runtime.service';

/**
 * 올린 **기초 데이터의 출처 원장**과, 그 위에 얹히는 표준코드 반영.
 *
 * 🔴 사람 지시(2026-08-26): *"올리는 데이터들이 **해당 날짜와 고시에 맞춰서** 저장되면 됨."*
 *    기준일이 없으면 다음 사람이 그 값을 **현재로 읽는다.**
 */
export const DATASET_KINDS = [
  'DRUG_PRICE_LIST',      // 약제급여목록 및 급여상한금액표
  'ATC_MAPPING',          // ATC ↔ EDI 매핑
  'DRUG_STANDARD_CODE',   // 의약품 표준코드(GS1 GTIN-13)
  'PROCEDURE_GAZETTE',    // 행위 급여 고시
  'OTHER',
] as const;
export type DatasetKind = (typeof DATASET_KINDS)[number];

@Injectable()
export class ReferenceDatasetService {
  private readonly logger = new Logger(ReferenceDatasetService.name);

  /**
   * 🔴 `config` 는 **필수 주입**이다. `@Optional()` 로 두면 모듈이 `ConfigRuntimeModule` 을
   *    import 하지 않았을 때 조용히 `undefined` 가 되어 `feeOn` 이 **영원히 종별 미설정**을 답한다
   *    (같은 유형으로 안전 게이트 3종이 개통 이래 기록을 못 남기고 있었다 — 2026-08-26).
   *    빠지면 부팅이 실패하는 편이 낫다.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigRuntimeService,
  ) {}

  /** 목록 — 어느 고시가 언제 반영됐는지 한눈에 */
  async list(kind?: string) {
    const rows = await this.prisma.referenceDataset.findMany({
      where: kind ? { kind } : {},
      orderBy: [{ effectiveDate: 'desc' }, { importedAt: 'desc' }],
      take: 100,
      include: { importer: { select: { familyName: true, givenName: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      effectiveDate: r.effectiveDate,
      sourceName: r.sourceName,
      fileName: r.fileName,
      rowCount: r.rowCount,
      appliedCount: r.appliedCount,
      skippedCount: r.skippedCount,
      notes: r.notes,
      importedAt: r.importedAt,
      importedByName: r.importer
        ? `${r.importer.familyName ?? ''}${r.importer.givenName ?? ''}`.trim() || null
        : null,
    }));
  }

  /** 🔴 같은 파일을 두 번 올렸는지 기계로 안다 — 사람 기억에 맡기지 않는다 */
  hashOf(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  async record(input: {
    kind: string;
    effectiveDate: string;
    sourceName: string;
    fileName?: string;
    contentHash?: string;
    rowCount: number;
    appliedCount: number;
    skippedCount: number;
    notes?: string;
    userId: string;
  }) {
    if (!(DATASET_KINDS as readonly string[]).includes(input.kind)) {
      throw new BadRequestException(`알 수 없는 기초 데이터 종류입니다: ${input.kind}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) {
      throw new BadRequestException('고시 기준일(effectiveDate)은 YYYY-MM-DD 여야 합니다');
    }
    return this.prisma.referenceDataset.create({
      data: {
        kind: input.kind,
        effectiveDate: new Date(`${input.effectiveDate}T00:00:00.000Z`),
        sourceName: input.sourceName.slice(0, 300),
        fileName: input.fileName?.slice(0, 300) || null,
        contentHash: input.contentHash || null,
        rowCount: input.rowCount,
        appliedCount: input.appliedCount,
        skippedCount: input.skippedCount,
        notes: input.notes || null,
        importedBy: input.userId,
      },
    });
  }

  /**
   * 의약품 **포장단위 표준코드** 반영.
   *
   * 🔴 우리 `medication_codes.barcode` 는 전부 **대표코드**였다(실측 22,305/22,306).
   *    실제 약 상자에 찍히는 것은 **포장단위 표준코드**라 스캔하면 못 찾았다.
   * 🔴 체크디지트가 틀려도 **저장한다** — 심평원 공식 파일에도 1건 있었다.
   *    막으면 그 약을 아예 못 찾는다. 대신 `checkDigitValid:false` 로 사실을 남긴다.
   */
  async importStandardCodes(
    rows: { standardCode: string; representativeCode?: string; ediCode?: string; productName?: string; maker?: string; packageSpec?: string }[],
    meta: { effectiveDate: string; sourceName: string; fileName?: string; contentHash?: string; userId: string },
  ) {
    const clean = rows.filter((r) => /^\d{13,14}$/.test((r.standardCode ?? '').trim()));
    const ediCodes = [...new Set(clean.map((r) => (r.ediCode ?? '').trim()).filter(Boolean))];
    const meds = await this.prisma.medicationCode.findMany({
      where: { code: { in: ediCodes } },
      select: { id: true, code: true },
    });
    const medBy = new Map(meds.map((m) => [m.code, m.id]));

    let badCheck = 0;
    let linked = 0;
    const ds = await this.record({
      kind: 'DRUG_STANDARD_CODE',
      effectiveDate: meta.effectiveDate,
      sourceName: meta.sourceName,
      fileName: meta.fileName,
      contentHash: meta.contentHash,
      rowCount: rows.length,
      appliedCount: 0,
      skippedCount: rows.length - clean.length,
      notes:
        rows.length !== clean.length
          ? `13~14자리가 아닌 표준코드 ${rows.length - clean.length}건은 반영하지 않았습니다.`
          : undefined,
      userId: meta.userId,
    });

    const data = clean.map((r) => {
      const sc = r.standardCode.trim();
      const valid = isValidGtin(sc);
      if (!valid) badCheck += 1;
      const ediCode = (r.ediCode ?? '').trim() || null;
      const medicationCodeId = ediCode ? medBy.get(ediCode) ?? null : null;
      if (medicationCodeId) linked += 1;
      return {
        standardCode: sc,
        representativeCode: (r.representativeCode ?? '').trim() || null,
        ediCode,
        medicationCodeId,
        productName: (r.productName ?? '').slice(0, 300) || null,
        maker: (r.maker ?? '').slice(0, 200) || null,
        packageSpec: (r.packageSpec ?? '').slice(0, 200) || null,
        checkDigitValid: valid,
        datasetId: ds.id,
      };
    });

    // 🔴 `skipDuplicates` — 같은 표준코드를 다시 올려도 덮지 않는다(먼저 들어온 출처를 지키다)
    let created = 0;
    for (let i = 0; i < data.length; i += 2000) {
      const chunk = data.slice(i, i + 2000);
      const res = await this.prisma.drugBarcode.createMany({ data: chunk, skipDuplicates: true });
      created += res.count;
    }

    const notes = [
      `약품 마스터에 연결된 것 ${linked.toLocaleString()}건 / 표준코드 ${clean.length.toLocaleString()}건.`,
      badCheck > 0
        ? `🔴 체크디지트가 맞지 않는 표준코드 ${badCheck}건 — **저장은 했습니다**(막으면 그 약을 못 찾습니다). 원본 확인이 필요합니다.`
        : '체크디지트 불일치 없음.',
      created !== data.length
        ? `이미 있던 표준코드 ${(data.length - created).toLocaleString()}건은 덮지 않았습니다.`
        : '',
    ].filter(Boolean);

    await this.prisma.referenceDataset.update({
      where: { id: ds.id },
      data: { appliedCount: created, notes: notes.join(' ') },
    });

    this.logger.log(
      `표준코드 반영 — 기준 ${meta.effectiveDate} · 신규 ${created} · 연결 ${linked} · 체크디지트 불일치 ${badCheck} · by ${meta.userId}`,
    );
    return { datasetId: ds.id, total: rows.length, created, linked, badCheckDigit: badCheck, notes };
  }

  /**
   * 🔴 **최신 고시에 없는 원내 약품** — 급여 목록에서 빠졌는데 여전히 처방할 수 있는 것.
   *
   * 실측(2026-08-26): 2026.6.1 → 7.1 한 달 사이 **삭제 38건** 중 **31건이 우리 마스터에 활성**이었다.
   * 급여에서 빠진 약을 처방하면 **삭감**된다.
   *
   * 🔴 **자동으로 폐지하지 않는다.** 급여에서 빠졌다고 원내에서 안 쓰는 것은 아니다
   *    (비급여로 계속 쓸 수 있다). 보여주고 사람이 정한다.
   * 🔴 **고시 코드 목록을 함께 받는다** — 원장에 목록을 저장하지 않으므로, 판정하려면 파일이 필요하다.
   *    목록 없이 "이 약은 급여에서 빠졌다"고 말할 수 없다.
   */
  async notInGazette(gazetteCodes: string[]) {
    const codes = [...new Set(gazetteCodes.map((c) => (c ?? '').trim()).filter(Boolean))];
    // 🔴 목록이 비면 **전건이 "빠졌다"로 나온다** — 그것은 판정이 아니라 사고다
    if (codes.length < 100) {
      throw new BadRequestException(
        `고시 코드 목록이 ${codes.length}건뿐입니다 — 전체 목록이어야 판정할 수 있습니다(부분 목록이면 전 약품이 "빠짐"으로 나옵니다)`,
      );
    }
    const rows = await this.prisma.medicationCode.findMany({
      where: { isActive: true, code: { notIn: codes } },
      select: { id: true, code: true, nameKo: true, unitPrice: true, validTo: true },
      orderBy: { nameKo: 'asc' },
      take: 500,
    });
    const total = await this.prisma.medicationCode.count({
      where: { isActive: true, code: { notIn: codes } },
    });
    return {
      gazetteSize: codes.length,
      total,
      returned: rows.length,
      truncated: total > rows.length,
      items: rows,
      notice:
        '급여 목록에 없는 원내 약품입니다. 🔴 **자동으로 폐지하지 않습니다** — ' +
        '비급여로 계속 쓰는 약일 수 있습니다. 폐지는 [정비] 탭에서 사유와 후속 코드를 지정해 하십시오.',
    };
  }

  /**
   * 🔴 **스캔한 바코드로 약 찾기** — 포장단위 표준코드 → 약품.
   *    대표코드만 갖고 있던 종전에는 이 조회가 성립하지 않았다.
   */
  async lookupByBarcode(gtin: string) {
    const g = (gtin ?? '').replace(/\D/g, '');
    if (!g) throw new BadRequestException('바코드를 입력하세요');
    // 14자리로 들어와도 앞의 0 을 떼고 13자리로 맞춰 본다(둘 다 시도)
    const candidates = [...new Set([g, g.replace(/^0+/, ''), g.padStart(14, '0')])];

    const rows = await this.prisma.drugBarcode.findMany({
      where: { OR: [{ standardCode: { in: candidates } }, { representativeCode: { in: candidates } }] },
      include: {
        medicationCode: { select: { id: true, code: true, nameKo: true, ingredient: true, unitPrice: true } },
        dataset: { select: { effectiveDate: true, sourceName: true } },
      },
      take: 10,
    });

    return {
      query: g,
      found: rows.length,
      items: rows.map((r) => ({
        standardCode: r.standardCode,
        representativeCode: r.representativeCode,
        ediCode: r.ediCode,
        productName: r.productName,
        maker: r.maker,
        packageSpec: r.packageSpec,
        checkDigitValid: r.checkDigitValid,
        medication: r.medicationCode,
        /** 🔴 어느 고시 기준 데이터인지 함께 말한다 */
        basis: { effectiveDate: r.dataset.effectiveDate, sourceName: r.dataset.sourceName },
      })),
      /** 🔴 0건은 "없는 약"이 아니다 — 우리가 그 표준코드를 아직 안 받았을 수 있다 */
      caveat:
        rows.length === 0
          ? '이 바코드를 표준코드 원장에서 찾지 못했습니다 — 그 약이 없다는 뜻이 아니라, 아직 반영하지 않은 표준코드일 수 있습니다.'
          : null,
    };
  }

  /**
   * 「약제급여목록 및 급여상한금액표」 반영 — **고시 시점별로 쌓는다(덮어쓰지 않는다).**
   *
   * 🔴 왜 시점별인가(2026-08-26 실측): 2026.6.1 → 7.1 **한 달** 사이에
   *    가격변동 **13건**(줄토피플렉스터치주 38,482 → 103,406 = 2.7배 · 렉라자 63,363 → 41,000) ·
   *    신규 99 · 삭제 38. **현재가 한 벌만 두면 6월 진료를 7월 값으로 청구한다.**
   *
   * 🔴 직전 고시의 `validTo` 를 이 고시 **전날**로 닫는다. 안 닫으면 한 시점에 정본이 둘이 되고,
   *    소비처가 어느 것을 쓸지 모른다(이 저장소에서 반복된 함정).
   *
   * 🔴 이 고시에서 빠진 코드를 **지우지 않는다** — 삭제는 "그날부터 급여가 아니다"라는 사실이지
   *    "그런 약이 없었다"가 아니다. 과거 청구는 그대로 재계산되어야 한다.
   */
  async importDrugPriceList(
    rows: {
      code: string; nameKo?: string; price?: number | null; ingredientCode?: string;
      route?: string; spec?: string; unit?: string; manufacturer?: string; classNo?: string; note?: string;
    }[],
    meta: { effectiveDate: string; sourceName: string; fileName?: string; contentHash?: string; userId: string },
  ) {
    const from = new Date(`${meta.effectiveDate}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime())) throw new BadRequestException('기준일(effectiveDate)이 날짜가 아닙니다');

    const clean = rows.filter((r) => (r.code ?? '').trim().length > 0);
    const byCode = new Map<string, (typeof clean)[number]>();
    for (const r of clean) byCode.set(r.code.trim(), r); // 같은 코드 중복 행은 마지막 것을 쓴다

    // 직전 고시(이 기준일보다 앞선 것 중 가장 최근)와 대조해 무엇이 바뀌었는지 **판정만** 한다
    // (2026-10-01 SQL 튜닝) 직전 고시의 기준일을 먼저 찾고 그 묶음만 읽는다 — 종전엔 기준일 이전 **전 행**을 읽어 메모리에서 걸렀다
    const prevHead = await this.prisma.drugPrice.findFirst({ where: { validFrom: { lt: from } }, orderBy: { validFrom: 'desc' }, select: { validFrom: true } });
    const prevFrom = prevHead?.validFrom ?? null;
    const prev = prevFrom
      ? await this.prisma.drugPrice.findMany({ where: { validFrom: prevFrom }, select: { code: true, price: true, validFrom: true } })
      : [];
    const prevMap = new Map(prev.map((x) => [x.code, x.price]));

    let created = 0, changed = 0, unchanged = 0;
    for (const [code, r] of byCode) {
      if (!prevMap.has(code)) created += 1;
      else if ((prevMap.get(code) ?? null) !== (r.price ?? null)) changed += 1;
      else unchanged += 1;
    }
    const delisted = [...prevMap.keys()].filter((c) => !byCode.has(c));

    const ds = await this.record({
      kind: 'DRUG_PRICE_LIST',
      effectiveDate: meta.effectiveDate,
      sourceName: meta.sourceName,
      fileName: meta.fileName,
      contentHash: meta.contentHash,
      rowCount: rows.length,
      appliedCount: byCode.size,
      skippedCount: rows.length - clean.length,
      notes:
        `직전 고시 ${prevFrom ? prevFrom.toISOString().slice(0, 10) : '없음'} 대비 ` +
        `신규 ${created} · 가격변동 ${changed} · 동일 ${unchanged} · 이 고시에서 빠진 코드 ${delisted.length}건` +
        (rows.length !== clean.length ? ` · 코드 없는 행 ${rows.length - clean.length}건 미반영` : ''),
      userId: meta.userId,
    });

    await this.prisma.drugPrice.createMany({
      data: [...byCode.values()].map((r) => ({
        code: r.code.trim(),
        nameKo: r.nameKo?.slice(0, 300) ?? null,
        price: r.price ?? null,
        ingredientCode: r.ingredientCode?.slice(0, 30) ?? null,
        route: r.route?.slice(0, 20) ?? null,
        spec: r.spec?.slice(0, 60) ?? null,
        unit: r.unit?.slice(0, 40) ?? null,
        manufacturer: r.manufacturer?.slice(0, 200) ?? null,
        classNo: r.classNo?.slice(0, 20) ?? null,
        note: r.note?.slice(0, 60) ?? null,
        validFrom: from,
        validTo: null,
        datasetId: ds.id,
      })),
      skipDuplicates: true,
    });

    // 🔴 직전 고시를 이 고시 **전날**로 닫는다(열어두면 한 시점에 정본이 둘이 된다)
    const closeAt = new Date(from); closeAt.setUTCDate(closeAt.getUTCDate() - 1);
    const closed = await this.prisma.drugPrice.updateMany({
      where: { validFrom: { lt: from }, validTo: null },
      data: { validTo: closeAt },
    });

    return {
      datasetId: ds.id,
      effectiveDate: meta.effectiveDate,
      applied: byCode.size,
      created, changed, unchanged,
      delisted: delisted.length,
      delistedSample: delisted.slice(0, 20),
      closedPreviousRows: closed.count,
      previousEffectiveDate: prevFrom ? prevFrom.toISOString().slice(0, 10) : null,
      caveat:
        '이 고시에서 빠진 코드는 삭제하지 않고 직전 고시의 기간을 닫는 것으로만 처리했습니다 — ' +
        '"그날부터 급여가 아니다"이지 "그런 약이 없었다"가 아닙니다.',
    };
  }

  /**
   * **그 시점의** 급여상한금액. 🔴 모르면 `null` 이며 **`0` 이 아니다**(0 은 "무료"라는 다른 사실).
   *
   * `basis` 3상태 — `GAZETTE`(그 시점 고시에 있다) / `NOT_LISTED`(그 시점 고시에 없다) /
   * `NO_GAZETTE_LOADED`(그 시점을 덮는 고시가 아직 등재되지 않았다 = **판정 불가**).
   * 🔴 뒤의 둘을 합치면 "급여 아님"과 "우리가 모름"이 같은 말이 된다.
   */
  async priceOn(codes: string[], onDate?: string) {
    if (!codes?.length) throw new BadRequestException('약품 코드를 1개 이상 주세요');
    const at = onDate ? new Date(`${onDate}T00:00:00.000Z`) : new Date();
    if (Number.isNaN(at.getTime())) throw new BadRequestException('조회 시점(onDate)이 날짜가 아닙니다');

    const covering = await this.prisma.drugPrice.findFirst({
      where: { validFrom: { lte: at }, OR: [{ validTo: null }, { validTo: { gte: at } }] },
      orderBy: { validFrom: 'desc' },
      select: { validFrom: true },
    });
    const wanted = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];

    if (!covering) {
      return {
        onDate: at.toISOString().slice(0, 10),
        gazetteEffectiveDate: null,
        items: wanted.map((code) => ({ code, price: null, basis: 'NO_GAZETTE_LOADED' as const })),
        caveat: '그 시점을 덮는 약제급여 고시가 등재되지 않아 **판정 불가**입니다 — 급여 대상이 아니라는 뜻이 아닙니다.',
      };
    }

    const found = await this.prisma.drugPrice.findMany({
      where: { code: { in: wanted }, validFrom: covering.validFrom },
      select: { code: true, nameKo: true, price: true },
    });
    const by = new Map(found.map((f) => [f.code, f]));
    return {
      onDate: at.toISOString().slice(0, 10),
      gazetteEffectiveDate: covering.validFrom.toISOString().slice(0, 10),
      items: wanted.map((code) => {
        const hit = by.get(code);
        return hit
          ? { code, nameKo: hit.nameKo, price: hit.price, basis: 'GAZETTE' as const }
          : { code, price: null, basis: 'NOT_LISTED' as const };
      }),
      caveat: '`price: null` 은 금액을 모른다는 뜻이며 0원이 아닙니다.',
    };
  }


  /**
   * 요양기관 종별 — 고시 단가 열과 1:1 로 맞춘다.
   * 🔴 **기본값을 두지 않는다.** 종별은 면허 사실이고 코드가 알 수 없다.
   *    모르는 채로 하나를 고르면 **모든 청구가 한 방향으로 틀린다**(실측: 의원 ≠ 병원급 97.4%).
   */
  /**
   * 🔴 **정본은 `billing.institution.grade` 하나다**(신규 키를 만들지 않았다).
   *    그 값은 이미 ERP 종별가산·의료급여 정액을 가르고 있었고, 화면도 `/admin/billing-calc` 에 있다.
   *    여기서 하는 일은 **그 어휘를 고시 단가 열로 옮기는 것**뿐이다.
   *
   *    종별가산 어휘(4)와 고시 단가 열(7)은 **다른 축**이다 —
   *    병원·종합병원·상급종합은 고시상 모두 **병원급이상단가** 한 열을 쓴다.
   *    🔴 치과·한방·보건기관·조산원·요양정신은 이 어휘가 표현하지 못한다.
   *       임의로 끼워 맞추지 않고 `TIER_UNKNOWN` 으로 둔다(모르는 것을 아는 척하지 않는다).
   */
  static readonly GRADE_TO_FEE_COLUMN: Record<string, string> = GRADE_FEE_COLUMN; // 정본 shared `fee-tier.ts`(종별 계산기와 같은 표)
  static readonly INSTITUTION_GRADE_KEY = 'billing.institution.grade';

  /**
   * 「수가반영내역」 반영 — 종별 단가를 **전부** 시점별로 쌓는다(약가와 같은 규약).
   *
   * 🔴 고시의 `0` 을 `null` 로 바꾸지 않는다 — 원문 그대로 둔다.
   *    "그 종별에서 산정하지 않는다"와 "우리가 모른다"는 다른 사실이고,
   *    가르는 일은 저장이 아니라 **조회(`feeOn`)** 가 한다.
   */
  async importProcedureFees(
    rows: {
      code: string; gazetteClass?: string; nameKo?: string; nameEn?: string;
      benefitType?: string; domain?: string;
      priceClinic?: number | null; priceHospital?: number | null; priceDental?: number | null;
      priceHealthCtr?: number | null; priceMidwife?: number | null;
      priceOriental?: number | null; priceNursing?: number | null;
      rvu?: number | null; copay50?: boolean; copay80?: boolean; copay90?: boolean;
      duplicateOk?: string; calcName?: string; isSurgery?: string; appliedOn?: string;
    }[],
    meta: { effectiveDate: string; sourceName: string; fileName?: string; contentHash?: string; userId: string },
  ) {
    const from = new Date(`${meta.effectiveDate}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime())) throw new BadRequestException('기준일(effectiveDate)이 날짜가 아닙니다');

    const byCode = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const c = (r.code ?? '').trim();
      if (c) byCode.set(c, r);
    }
    if (!byCode.size) throw new BadRequestException('수가코드가 있는 행이 없습니다');

    // (2026-10-01 SQL 튜닝) 직전 고시 기준일을 먼저 찾고 그 묶음만 — 종전엔 기준일 이전 전 행(수가 41.9만)을 읽어 메모리에서 걸렀다
    const prevHead = await this.prisma.procedureFee.findFirst({ where: { validFrom: { lt: from } }, orderBy: { validFrom: 'desc' }, select: { validFrom: true } });
    const prevFrom = prevHead?.validFrom ?? null;
    const prev = prevFrom
      ? await this.prisma.procedureFee.findMany({ where: { validFrom: prevFrom }, select: { code: true, priceHospital: true, priceClinic: true, validFrom: true } })
      : [];
    const prevMap = new Map(prev.map((x) => [x.code, x]));
    let created = 0, changed = 0, unchanged = 0;
    for (const [code, r] of byCode) {
      const old = prevMap.get(code);
      if (!old) created += 1;
      else if (old.priceHospital !== (r.priceHospital ?? null) || old.priceClinic !== (r.priceClinic ?? null)) changed += 1;
      else unchanged += 1;
    }
    const delisted = [...prevMap.keys()].filter((c) => !byCode.has(c));

    const ds = await this.record({
      kind: 'PROCEDURE_GAZETTE',
      effectiveDate: meta.effectiveDate,
      sourceName: meta.sourceName,
      fileName: meta.fileName,
      contentHash: meta.contentHash,
      rowCount: rows.length,
      appliedCount: byCode.size,
      skippedCount: rows.length - byCode.size,
      notes:
        `직전 고시 ${prevFrom ? prevFrom.toISOString().slice(0, 10) : '없음'} 대비 ` +
        `신규 ${created} · 단가변동 ${changed} · 동일 ${unchanged} · 이 고시에서 빠진 코드 ${delisted.length}건`,
      userId: meta.userId,
    });

    const toDate = (v?: string) => {
      if (!v) return null;
      const d = new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const all = [...byCode.values()].map((r) => ({
      code: r.code.trim(),
      gazetteClass: r.gazetteClass?.slice(0, 40) ?? null,
      nameKo: r.nameKo?.slice(0, 500) ?? null,
      nameEn: r.nameEn?.slice(0, 500) ?? null,
      benefitType: r.benefitType?.slice(0, 20) ?? null,
      domain: r.domain?.slice(0, 20) ?? null,
      priceClinic: r.priceClinic ?? null, priceHospital: r.priceHospital ?? null,
      priceDental: r.priceDental ?? null, priceHealthCtr: r.priceHealthCtr ?? null,
      priceMidwife: r.priceMidwife ?? null, priceOriental: r.priceOriental ?? null,
      priceNursing: r.priceNursing ?? null,
      rvu: r.rvu ?? null,
      copay50: !!r.copay50, copay80: !!r.copay80, copay90: !!r.copay90,
      duplicateOk: r.duplicateOk?.slice(0, 5) ?? null,
      calcName: r.calcName?.slice(0, 300) ?? null,
      isSurgery: r.isSurgery?.slice(0, 5) ?? null,
      appliedOn: toDate(r.appliedOn),
      validFrom: from, validTo: null, datasetId: ds.id,
    }));
    // 41만 행이라 한 번에 넣지 않는다(파라미터 상한·메모리)
    const CHUNK = 2000;
    for (let i = 0; i < all.length; i += CHUNK) {
      await this.prisma.procedureFee.createMany({ data: all.slice(i, i + CHUNK), skipDuplicates: true });
    }

    const closeAt = new Date(from); closeAt.setUTCDate(closeAt.getUTCDate() - 1);
    const closed = await this.prisma.procedureFee.updateMany({
      where: { validFrom: { lt: from }, validTo: null },
      data: { validTo: closeAt },
    });

    return {
      datasetId: ds.id, effectiveDate: meta.effectiveDate, applied: byCode.size,
      created, changed, unchanged, delisted: delisted.length, delistedSample: delisted.slice(0, 20),
      closedPreviousRows: closed.count,
      previousEffectiveDate: prevFrom ? prevFrom.toISOString().slice(0, 10) : null,
      caveat:
        '종별 단가를 전부 보관했습니다. 🔴 우리 기관이 어느 종별인지는 이 반영이 정하지 않습니다 — ' +
        '`billing.institution.grade` 설정(사람 결정 · /admin/billing-calc)이 정해야 조회가 금액을 말할 수 있습니다.',
    };
  }

  /**
   * **그 시점 · 그 종별의** 수가. 🔴 세 가지를 갈라서 답한다.
   *
   * `basis` — `GAZETTE`(그 종별에 금액이 있다) / `NOT_BILLABLE_AT_TIER`(고시에 있으나 **그 종별 미산정** = 0) /
   * `NOT_LISTED`(그 시점 고시에 코드가 없다) / `NO_GAZETTE_LOADED`(그 시점 고시 미등재) /
   * 🔴 `TIER_UNKNOWN`(**우리 기관 종별이 미설정** — 금액을 말할 수 없다).
   *
   * 🔴 `TIER_UNKNOWN` 에 기본 종별을 끼워 넣지 않는다. 실측(2026-08-26): 의원 ≠ 병원급이 97.4%,
   *    그중 우리 운영 단가는 의원단가와 98.8% 일치했다 — 기본값을 골랐으면 그 오류가 정책이 된다.
   */
  async feeOn(codes: string[], opts?: { onDate?: string; tier?: string }) {
    if (!codes?.length) throw new BadRequestException('수가코드를 1개 이상 주세요');
    const at = opts?.onDate ? new Date(`${opts.onDate}T00:00:00.000Z`) : new Date();
    if (Number.isNaN(at.getTime())) throw new BadRequestException('조회 시점(onDate)이 날짜가 아닙니다');

    const tiers = ReferenceDatasetService.GRADE_TO_FEE_COLUMN;
    const configured =
      opts?.tier ?? ((await this.config.get(ReferenceDatasetService.INSTITUTION_GRADE_KEY)) as string | null);
    const column = configured ? tiers[configured] : null;
    const wanted = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];

    if (!column) {
      return {
        onDate: at.toISOString().slice(0, 10),
        institutionType: configured,
        items: wanted.map((code) => ({ code, price: null, basis: 'TIER_UNKNOWN' as const })),
        caveat:
          configured
            ? `이 종별은 고시 단가 열로 옮길 수 없습니다: ${configured} ` +
              `(옮길 수 있는 값: ${Object.keys(tiers).join('·')}). ` +
              '치과·한방·보건기관·조산원·요양정신은 종별가산 어휘가 표현하지 못해 임의로 끼워 맞추지 않았습니다.'
            : '🔴 요양기관 종별(`billing.institution.grade`)이 설정되지 않아 금액을 말할 수 없습니다 — ' +
              '기본값을 고르지 않았습니다. 의원 단가와 병원급 단가가 다른 코드가 97.4% 입니다. ' +
              '설정 화면: /admin/billing-calc',
      };
    }

    const covering = await this.prisma.procedureFee.findFirst({
      where: { validFrom: { lte: at }, OR: [{ validTo: null }, { validTo: { gte: at } }] },
      orderBy: { validFrom: 'desc' },
      select: { validFrom: true },
    });
    if (!covering) {
      return {
        onDate: at.toISOString().slice(0, 10), institutionType: configured,
        items: wanted.map((code) => ({ code, price: null, basis: 'NO_GAZETTE_LOADED' as const })),
        caveat: '그 시점을 덮는 수가 고시가 등재되지 않아 **판정 불가**입니다.',
      };
    }
    const found = await this.prisma.procedureFee.findMany({
      where: { code: { in: wanted }, validFrom: covering.validFrom },
    });
    const by = new Map(found.map((f) => [f.code, f as unknown as Record<string, unknown>]));
    return {
      onDate: at.toISOString().slice(0, 10),
      institutionType: configured,
      gazetteEffectiveDate: covering.validFrom.toISOString().slice(0, 10),
      items: wanted.map((code) => {
        const hit = by.get(code);
        // 판정은 shared `gazetteFeeOf` 하나(종별 계산기와 같은 규칙) — 🔴 고시의 0 은 "그 종별에서 산정하지 않는다" · 0원 청구가 아니다
        const fee = gazetteFeeOf(hit as { priceClinic?: number | null; priceHospital?: number | null } | undefined, configured as InstitutionGrade);
        if (!hit || fee.basis === 'NOT_LISTED') return { code, price: null, basis: 'NOT_LISTED' as const };
        const v = fee.price;
        if (fee.basis === 'NOT_BILLABLE_AT_TIER') {
          return {
            code, nameKo: hit.nameKo as string | null, price: null,
            basis: 'NOT_BILLABLE_AT_TIER' as const,
            note: '이 종별에서는 산정하지 않는 항목입니다(고시 단가 0) — 0원으로 청구하는 것이 아닙니다',
          };
        }
        return {
          code, nameKo: hit.nameKo as string | null, price: v, basis: 'GAZETTE' as const,
          copaySpecial: [hit.copay50 && '50/100', hit.copay80 && '80/100', hit.copay90 && '90/100'].filter(Boolean),
        };
      }),
      caveat: '`price: null` 은 금액을 모르거나 그 종별에서 산정하지 않는다는 뜻이며 0원이 아닙니다.',
    };
  }

}
