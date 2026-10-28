import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ReferenceDatasetService } from './reference-dataset.service';

/**
 * DRG(질병군) **참조 자료**와 중증도 점수 산출.
 *
 * 근거: 고시 별표4(기타진단의 중증도 점수) · 별표5(점수를 0으로 결정하는 주진단).
 * 실측(2026-08-26): 별표4 **4,796코드** · 별표5 기타진단 **4,853종 × 주진단 729,446쌍**.
 *
 * 🔴 **이것으로 DRG 를 산정할 수 없다.** 여기서 계산되는 것은 **중증도 점수 합계**뿐이다.
 *    질병군범주(ADRG) 배정은 주진단·시술코드·연령·성별을 함께 보는 별도 규칙이고,
 *    수가는 또 다른 자료다. **할 수 없는 것을 할 수 있는 척하지 않는다** —
 *    응답이 그 한계를 직접 말한다(`limits`).
 */
export interface SeverityResult {
  mainDiagnosis: string;
  /** 기타진단별 판정 — 점수·0처리 여부·근거 */
  items: {
    code: string;
    baseScore: number | null;
    applied: number;
    zeroedByMain: boolean;
    /** 🔴 표에 없는 코드는 0 이 아니라 **모른다** */
    known: boolean;
  }[];
  /** 표에 있는 것만 더한 합계 */
  totalScore: number;
  /** 🔴 표에 없어서 세지 못한 진단 수 — 합계를 그대로 믿으면 안 되는 이유 */
  unknownCount: number;
  basis: { effectiveDate: Date; sourceName: string } | null;
  limits: string[];
}

@Injectable()
export class DrgReferenceService {
  private readonly logger = new Logger(DrgReferenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly refData: ReferenceDatasetService,
  ) {}

  /** 고시 원문은 점 없는 표기다(`A010`). 우리 KCD 는 점 표기(`A01.0`)라 맞춰 준다 */
  private norm(code: string): string {
    return (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  async importSeverity(
    rows: { diagnosisCode: string; score: number }[],
    meta: { effectiveDate: string; sourceName: string; fileName?: string; userId: string },
  ) {
    const clean = rows
      .map((r) => ({ diagnosisCode: this.norm(r.diagnosisCode), score: Number(r.score) }))
      .filter((r) => /^[A-Z]\d{2,5}$/.test(r.diagnosisCode) && Number.isInteger(r.score) && r.score >= 0 && r.score <= 4);

    const ds = await this.refData.record({
      kind: 'OTHER',
      effectiveDate: meta.effectiveDate,
      sourceName: meta.sourceName,
      fileName: meta.fileName,
      rowCount: rows.length,
      appliedCount: 0,
      skippedCount: rows.length - clean.length,
      notes:
        rows.length !== clean.length
          ? `코드 형태가 아니거나 점수가 0~4 밖인 ${rows.length - clean.length}건은 반영하지 않았습니다.`
          : undefined,
      userId: meta.userId,
    });

    let created = 0;
    for (let i = 0; i < clean.length; i += 2000) {
      const res = await this.prisma.drgSeverityScore.createMany({
        data: clean.slice(i, i + 2000).map((r) => ({ ...r, datasetId: ds.id })),
        skipDuplicates: true,
      });
      created += res.count;
    }
    await this.prisma.referenceDataset.update({ where: { id: ds.id }, data: { appliedCount: created } });
    this.logger.log(`DRG 중증도 점수 반영 — 기준 ${meta.effectiveDate} · ${created}건 · by ${meta.userId}`);
    return { datasetId: ds.id, total: rows.length, created, skipped: rows.length - clean.length };
  }

  async importZeroRules(
    rows: { otherDiagnosis: string; mainDiagnoses: string[] }[],
    meta: { effectiveDate: string; sourceName: string; fileName?: string; userId: string },
  ) {
    const clean = rows
      .map((r) => ({
        otherDiagnosis: this.norm(r.otherDiagnosis),
        mainDiagnoses: [...new Set((r.mainDiagnoses ?? []).map((m) => this.norm(m)).filter((m) => /^[A-Z]\d{2,5}$/.test(m)))],
      }))
      .filter((r) => /^[A-Z]\d{2,5}$/.test(r.otherDiagnosis) && r.mainDiagnoses.length > 0);

    const pairs = clean.reduce((a, r) => a + r.mainDiagnoses.length, 0);
    const ds = await this.refData.record({
      kind: 'OTHER',
      effectiveDate: meta.effectiveDate,
      sourceName: meta.sourceName,
      fileName: meta.fileName,
      rowCount: rows.length,
      appliedCount: 0,
      skippedCount: rows.length - clean.length,
      notes: `기타진단 ${clean.length}종 · (기타,주) 쌍 ${pairs.toLocaleString()}건.`,
      userId: meta.userId,
    });

    let created = 0;
    for (let i = 0; i < clean.length; i += 500) {
      const res = await this.prisma.drgZeroScoreRule.createMany({
        data: clean.slice(i, i + 500).map((r) => ({ ...r, datasetId: ds.id })),
        skipDuplicates: true,
      });
      created += res.count;
    }
    await this.prisma.referenceDataset.update({ where: { id: ds.id }, data: { appliedCount: created } });
    this.logger.log(`DRG 0점 규칙 반영 — 기준 ${meta.effectiveDate} · ${created}종 · ${pairs}쌍 · by ${meta.userId}`);
    return { datasetId: ds.id, total: rows.length, created, pairs };
  }

  /**
   * **행위 별도보상 코드** 반영 — 포괄수가에 묶이지 않고 따로 산정하는 행위.
   *
   * 🔴 고시 **분류번호는 원문 그대로** 담는다(`자654-2`). 접두가 무슨 분류인지는 적지 않는다 —
   *    그 대응표는 고시가 정하고, 기억으로 적으면 그 추정이 정책인 척한다.
   * 🔴 같은 반영에서 `ProcedureCode.gazetteClass` 도 채운다(**분류명이 아니라 번호**다).
   */
  async importSeparateBilling(
    rows: { code: string; gazetteClass?: string; name?: string; calcName?: string; rate?: string; benefitType?: string; validFrom?: string; validTo?: string }[],
    meta: { effectiveDate: string; sourceName: string; fileName?: string; userId: string },
  ) {
    const day = (v?: string) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((v ?? '').trim());
      return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`) : null;
    };
    const clean = rows
      .map((r) => ({
        code: (r.code ?? '').trim(),
        gazetteClass: (r.gazetteClass ?? '').trim().slice(0, 40) || null,
        name: (r.name ?? '').slice(0, 300) || null,
        calcName: (r.calcName ?? '').slice(0, 300) || null,
        rate: (r.rate ?? '').slice(0, 20) || null,
        benefitType: (r.benefitType ?? '').slice(0, 20) || null,
        validFrom: day(r.validFrom),
        validTo: day(r.validTo),
      }))
      .filter((r) => r.code.length > 0);

    const ds = await this.refData.record({
      kind: 'PROCEDURE_GAZETTE',
      effectiveDate: meta.effectiveDate,
      sourceName: meta.sourceName,
      fileName: meta.fileName,
      rowCount: rows.length,
      appliedCount: 0,
      skippedCount: rows.length - clean.length,
      userId: meta.userId,
    });

    let created = 0;
    for (let i = 0; i < clean.length; i += 2000) {
      const res = await this.prisma.drgSeparateBilling.createMany({
        data: clean.slice(i, i + 2000).map((r) => ({ ...r, datasetId: ds.id })),
        skipDuplicates: true,
      });
      created += res.count;
    }

    // 🔴 수가 마스터에 **분류번호**를 채운다(분류명이 아니다). 이미 있으면 덮지 않는다.
    let classFilled = 0;
    for (const r of clean) {
      if (!r.gazetteClass) continue;
      const res = await this.prisma.procedureCode.updateMany({
        where: { code: r.code, gazetteClass: null },
        data: { gazetteClass: r.gazetteClass },
      });
      classFilled += res.count;
    }

    await this.prisma.referenceDataset.update({
      where: { id: ds.id },
      data: {
        appliedCount: created,
        notes: `별도보상 코드 ${created.toLocaleString()}건 · 수가 마스터에 분류번호를 채운 것 ${classFilled.toLocaleString()}건. ` +
          '🔴 분류번호는 원문이며 분류명이 아닙니다.',
      },
    });
    this.logger.log(`별도보상 반영 — 기준 ${meta.effectiveDate} · ${created}건 · 분류번호 ${classFilled}건 · by ${meta.userId}`);
    return { datasetId: ds.id, total: rows.length, created, classFilled };
  }

  /**
   * 🔴 이 수가코드가 **DRG 입원에서 따로 산정되는가**.
   *    기간이 지난 코드를 "가능"이라 말하면 그대로 청구된다 — 시점을 받아 판정한다.
   */
  async isSeparatelyBillable(codes: string[], onDate?: string) {
    const list = [...new Set((codes ?? []).map((c) => (c ?? '').trim()).filter(Boolean))];
    if (list.length === 0) throw new BadRequestException('수가코드를 입력하세요');
    const at = onDate ? new Date(`${onDate}T00:00:00.000Z`) : new Date();

    const rows = await this.prisma.drgSeparateBilling.findMany({
      where: { code: { in: list } },
      orderBy: { validFrom: 'desc' },
    });
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.code, [...(by.get(r.code) ?? []), r]);

    return {
      asOf: at,
      items: list.map((code) => {
        const cand = by.get(code) ?? [];
        const active = cand.find(
          (r) => (!r.validFrom || r.validFrom <= at) && (!r.validTo || r.validTo >= at),
        );
        return {
          code,
          /** 🔴 `null` = 목록에 아예 없다(= 판정 불가). `false` = 있으나 기간 밖 */
          separatelyBillable: cand.length === 0 ? null : !!active,
          gazetteClass: active?.gazetteClass ?? cand[0]?.gazetteClass ?? null,
          name: active?.name ?? cand[0]?.name ?? null,
          validFrom: active?.validFrom ?? null,
          validTo: active?.validTo ?? null,
          expiredOnly: cand.length > 0 && !active,
        };
      }),
      /** 🔴 목록에 없다는 것이 "포괄에 묶인다"는 뜻은 아니다 — 우리가 아직 안 받은 목록일 수 있다 */
      caveat:
        '이 판정은 반영된 별도보상 목록에 한합니다. 목록에 없는 코드는 **판정 불가**이며 "포괄 대상"을 뜻하지 않습니다.',
    };
  }

  /**
   * 중증도 점수 합계 — 별표4 점수에 별표5(0점 규칙)를 적용한다.
   *
   * 🔴 **표에 없는 진단은 0 이 아니라 "모른다"** 다. 0 으로 세면 합계가 실제보다 낮게 나오고,
   *    그 합계로 중증도 등급을 말하면 거짓이 된다. `unknownCount` 를 함께 낸다.
   */
  async severity(mainDiagnosis: string, otherDiagnoses: string[]): Promise<SeverityResult> {
    const main = this.norm(mainDiagnosis);
    if (!main) throw new BadRequestException('주진단을 입력하세요');
    const others = [...new Set((otherDiagnoses ?? []).map((c) => this.norm(c)).filter(Boolean))];

    const latest = await this.prisma.drgSeverityScore.findFirst({
      orderBy: { dataset: { effectiveDate: 'desc' } },
      select: { datasetId: true, dataset: { select: { effectiveDate: true, sourceName: true } } },
    });
    // 🔴 자료가 없으면 계산하지 않는다 — 0 을 돌려주면 "중증도 없음"으로 읽힌다
    if (!latest) {
      return {
        mainDiagnosis: main, items: [], totalScore: 0, unknownCount: others.length, basis: null,
        limits: ['🔴 중증도 점수 자료(별표4)가 반영돼 있지 않습니다 — 합계 0 은 "중증도 없음"이 아니라 **산출 불가**입니다.'],
      };
    }

    const [scores, zeros] = await Promise.all([
      this.prisma.drgSeverityScore.findMany({
        where: { datasetId: latest.datasetId, diagnosisCode: { in: others } },
        select: { diagnosisCode: true, score: true },
      }),
      this.prisma.drgZeroScoreRule.findMany({
        where: { otherDiagnosis: { in: others } },
        select: { otherDiagnosis: true, mainDiagnoses: true },
      }),
    ]);
    const scoreBy = new Map(scores.map((s) => [s.diagnosisCode, s.score]));
    const zeroBy = new Map(zeros.map((z) => [z.otherDiagnosis, new Set(z.mainDiagnoses)]));

    let total = 0;
    let unknown = 0;
    const items = others.map((code) => {
      const base = scoreBy.get(code);
      const known = base !== undefined;
      if (!known) unknown += 1;
      const zeroed = zeroBy.get(code)?.has(main) ?? false;
      const applied = known && !zeroed ? base! : 0;
      total += applied;
      return { code, baseScore: known ? base! : null, applied, zeroedByMain: zeroed, known };
    });

    const limits = [
      '🔴 이 값은 **중증도 점수 합계**입니다 — 질병군(ADRG) 배정도, 수가 산정도 아닙니다.',
      '🔴 질병군 배정은 주진단·시술코드·연령·성별을 함께 보는 별도 규칙이고, 이 시스템에는 그 규칙이 없습니다.',
    ];
    if (unknown > 0) {
      limits.push(
        `🔴 중증도 표에 없는 진단 ${unknown}건은 **세지 못했습니다** — 합계 ${total} 은 그만큼 낮게 나온 값입니다(0 이 아니라 미상).`,
      );
    }

    return { mainDiagnosis: main, items, totalScore: total, unknownCount: unknown, basis: latest.dataset, limits };
  }
}
