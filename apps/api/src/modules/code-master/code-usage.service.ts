import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** 코드 마스터 테이블 → Prisma 모델명 */
const MODEL_BY_TABLE: Record<string, string> = {
  diagnosis: 'DiagnosisCode',
  procedure: 'ProcedureCode',
  medication: 'MedicationCode',
};

export interface UsageRef {
  /** 참조하는 Prisma 모델(사람이 읽을 이름) */
  model: string;
  label: string;
  field: string;
  /** 🔴 세지 못했으면 null — 0 으로 적지 않는다 */
  count: number | null;
  error?: string;
}

export interface CodeUsage {
  sourceTable: string;
  sourceId: string;
  refs: UsageRef[];
  /** 🔴 합계는 **전부 셌을 때만** 낸다. 하나라도 못 세면 null */
  total: number | null;
  countedRefs: number;
  totalRefs: number;
  /** 사용처가 하나도 없다고 **단정할 수 있는가** */
  safeToDeactivate: boolean;
}

/** 화면에 그대로 쓰는 이름 — 모델명은 사람이 모른다 */
const MODEL_LABEL: Record<string, string> = {
  Prescription: '처방',
  EncounterDiagnosis: '진료 진단',
  ProblemList: '문제목록',
  FamilyHistory: '가족력',
  DispensingItem: '조제 내역',
  MedicationBatch: '약품 배치(재고)',
  GenericSubstitution: '대체조제 규칙',
  PreOrder: '사전 오더',
};

/**
 * 코드 사용처(변경 영향) 조회.
 *
 * 🔴 **참조 목록을 손으로 적지 않는다.** Prisma 메타데이터(DMMF)에서 뽑는다 —
 *    실측(2026-08-26): 손으로 세면 `FamilyHistory`·`PreOrder.medicationCodeId` 를 놓쳤다.
 *    하나라도 빠지면 "사용처 없음"이라 말하고 코드를 중지하게 되고, 그 순간 조용히 깨진다.
 *    관계가 새로 생겨도 이 함수는 자동으로 따라온다.
 */
@Injectable()
export class CodeUsageService {
  private readonly logger = new Logger(CodeUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 이 코드 모델을 참조하는 (모델, FK필드) 목록 — 메타데이터에서 유도 */
  private referrers(targetModel: string): { model: string; field: string }[] {
    const out: { model: string; field: string }[] = [];
    for (const m of Prisma.dmmf.datamodel.models) {
      for (const f of m.fields) {
        if (f.kind === 'object' && f.type === targetModel && f.relationFromFields?.length) {
          out.push({ model: m.name, field: f.relationFromFields[0] });
        }
      }
    }
    return out;
  }

  /**
   * 폐지 — 🔴 **삭제가 아니다.** `validTo` 로 종료하고 후속 코드를 잇는다.
   *    과거 기록이 그 코드를 가리키고 있으므로 행을 지우면 해석이 끊긴다.
   *
   * 🔴 사용 중이어도 폐지는 **막지 않는다** — 고시에서 없어진 코드는 없어져야 한다.
   *    다만 **사용 건수를 알려주고**, 후속 코드가 없으면 그 사실을 결과에 남긴다.
   */
  async retire(
    sourceTable: string,
    sourceId: string,
    opts: { validTo: string; successorCode?: string; reason: string },
  ) {
    const model = MODEL_BY_TABLE[sourceTable];
    if (!model) throw new BadRequestException(`알 수 없는 코드 종류: ${sourceTable}`);
    if (!opts.reason?.trim()) throw new BadRequestException('폐지 사유가 필요합니다');
    const end = new Date(opts.validTo);
    if (Number.isNaN(end.getTime())) throw new BadRequestException('종료일(validTo)이 올바르지 않습니다');

    const usage = await this.getUsage(sourceTable, sourceId);
    const data = {
      validTo: end,
      successorCode: opts.successorCode?.trim() || null,
      retiredReason: opts.reason.trim(),
    };
    const delegate = { diagnosis: 'diagnosisCode', procedure: 'procedureCode', medication: 'medicationCode' }[sourceTable]!;
    await (this.prisma as unknown as Record<string, { update: (a: unknown) => Promise<unknown> }>)[delegate]
      .update({ where: { id: sourceId }, data });

    this.logger.log(
      `코드 폐지 — ${sourceTable}/${sourceId} · 종료 ${opts.validTo} · 후속 ${data.successorCode ?? '없음'} · ` +
      `사용 ${usage.total ?? '집계 실패'}건 · 사유: ${data.retiredReason}`,
    );
    return {
      retired: true,
      usage,
      successorCode: data.successorCode,
      // 🔴 후속 코드가 없으면 그 사실을 말한다 — 과거 기록이 갈 곳을 잃는다
      warning: data.successorCode ? null : '후속 코드가 지정되지 않았습니다 — 이 코드를 쓰던 과거 기록은 대체 코드를 알 수 없습니다',
    };
  }

  /**
   * 만료 경보 — 🔴 **유효기간이 지났는데 아직 쓰이고 있는 코드.**
   *    `validTo` 는 원래 있었는데 그것이 지난 코드를 계속 쓰고 있는지 아무도 보지 않았다.
   *    쓰이지 않는 만료 코드는 위험이 아니다 — **쓰이는 것만** 낸다.
   */
  async expiredButUsed(sourceTable: string, limit = 50) {
    const model = MODEL_BY_TABLE[sourceTable];
    if (!model) throw new BadRequestException(`알 수 없는 코드 종류: ${sourceTable}`);
    const delegate = { diagnosis: 'diagnosisCode', procedure: 'procedureCode', medication: 'medicationCode' }[sourceTable]!;
    const today = new Date();

    const expired = await (this.prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<{ id: string; code: string; nameKo: string; validTo: Date | null; successorCode: string | null }[]> }>)[delegate]
      .findMany({
        where: { isActive: true, validTo: { lt: today } },
        select: { id: true, code: true, nameKo: true, validTo: true, successorCode: true },
        take: limit,
        orderBy: { validTo: 'asc' },
      });

    const items = [];
    let uncounted = 0;
    for (const e of expired) {
      const u = await this.getUsage(sourceTable, e.id);
      if (u.total === null) { uncounted++; continue; }   // 🔴 못 센 것을 "안 쓰임"으로 넘기지 않는다
      if (u.total === 0) continue;                        // 쓰이지 않으면 위험이 아니다
      items.push({ ...e, usedCount: u.total, hasSuccessor: !!e.successorCode });
    }
    return {
      sourceTable,
      scanned: expired.length,
      /** 🔴 사용 건수를 세지 못한 만료 코드 — "없음"에 섞지 않는다 */
      uncounted,
      items: items.sort((a, b) => b.usedCount - a.usedCount),
      truncated: expired.length === limit,
    };
  }

  async getUsage(sourceTable: string, sourceId: string): Promise<CodeUsage> {
    const model = MODEL_BY_TABLE[sourceTable];
    if (!model) throw new BadRequestException(`알 수 없는 코드 종류: ${sourceTable}`);

    const referrers = this.referrers(model);
    const refs: UsageRef[] = [];

    for (const r of referrers) {
      const delegate = (this.prisma as unknown as Record<string, { count?: (a: unknown) => Promise<number> }>)[
        r.model.charAt(0).toLowerCase() + r.model.slice(1)
      ];
      if (!delegate?.count) {
        // 🔴 셀 수 없는 것을 0 으로 적지 않는다
        refs.push({ model: r.model, label: MODEL_LABEL[r.model] ?? r.model, field: r.field, count: null, error: '조회 경로 없음' });
        continue;
      }
      try {
        const count = await delegate.count({ where: { [r.field]: sourceId } });
        refs.push({ model: r.model, label: MODEL_LABEL[r.model] ?? r.model, field: r.field, count });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`사용처 조회 실패 ${r.model}.${r.field}: ${msg}`);
        refs.push({ model: r.model, label: MODEL_LABEL[r.model] ?? r.model, field: r.field, count: null, error: msg });
      }
    }

    const counted = refs.filter((r) => r.count !== null);
    const allCounted = counted.length === refs.length;
    const total = allCounted ? counted.reduce((a, b) => a + (b.count ?? 0), 0) : null;

    return {
      sourceTable,
      sourceId,
      refs,
      total,
      countedRefs: counted.length,
      totalRefs: refs.length,
      // 🔴 **전부 세었고 전부 0일 때만** 안전하다고 말한다.
      //    하나라도 못 셌으면 "사용처 없음"이라 단정하지 않는다 — 그것이 이 기능의 존재 이유다.
      safeToDeactivate: allCounted && total === 0,
    };
  }
}
