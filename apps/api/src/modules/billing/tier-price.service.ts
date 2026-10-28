/**
 * 청구 단가 = 고시 종별 단가(2026-10-20 · 사용자 지시 "병원 종별 … UI 화면으로 기능 구현").
 *
 * 종별(결정 `billing.institutionType` → 설정 `billing.institution.grade`)이 **명시 설정됐을 때만** 수가 마스터 행의 단가를
 * 그 시점 수가 고시(`procedure_fees`)의 종별 열로 바꿔 끼운다(메모리에서 — 수가 마스터 16만 행은 그대로 · 되돌리기 = 종별을 비우기).
 *  · 고시 GAZETTE → 그 금액 · 🔴 고시 0(그 종별 미산정) → 단가 null(단가 미등재와 같은 정책 `billing.unpricedLinePolicy` — 0원 라인+경고)
 *  · 고시에 없는 코드(원내 코드 등) → 마스터 단가 그대로
 *  · 종별 미설정 → 아무것도 바꾸지 않는다(종전 동작 = 마스터 = 의원 열)
 * 판정은 shared `gazetteFeeOf` 하나(종별 계산기·feeOn 과 같은 규칙). 청구 생성·재계산·계산 패널·입원료·ERP 발생 라인·
 * 원격진료·FFS 견적·종별 계산기가 이 서비스를 쓴다.
 */
import { Injectable } from '@nestjs/common';
import { INSTITUTION_GRADES, gazetteFeeOf, type GazetteFeeBasis, type InstitutionGrade } from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { INSTITUTION_GRADE_KEY } from './consultation-code';

export interface TierPriced { code: string; unitPrice: number | null }

@Injectable()
export class TierPriceService {
  constructor(private readonly prisma: PrismaService) {}

  /** 명시 설정된 종별(설정 행) — 없거나 표 밖이면 null */
  async explicitGrade(): Promise<InstitutionGrade | null> {
    const row = await this.prisma.systemConfig.findUnique({ where: { key: INSTITUTION_GRADE_KEY }, select: { value: true } });
    const v = typeof row?.value === 'string' ? row.value.toUpperCase() : null;
    return v && (INSTITUTION_GRADES as readonly string[]).includes(v) ? (v as InstitutionGrade) : null;
  }

  /** 코드 → 고시 종별 판정(고시에 있는 코드만). 종별이 없으면 빈 지도 */
  async gazetteFor(codes: string[], grade: InstitutionGrade | null, at: Date = new Date()): Promise<Map<string, { price: number | null; basis: GazetteFeeBasis }>> {
    const out = new Map<string, { price: number | null; basis: GazetteFeeBasis }>();
    const uniq = [...new Set(codes.filter(Boolean))];
    if (!grade || !uniq.length) return out;
    const covering = await this.prisma.procedureFee.findFirst({
      where: { validFrom: { lte: at }, OR: [{ validTo: null }, { validTo: { gte: at } }] },
      orderBy: { validFrom: 'desc' },
      select: { validFrom: true },
    });
    if (!covering) return out; // 그 시점 고시가 없으면 바꾸지 않는다(마스터 그대로)
    const fees = await this.prisma.procedureFee.findMany({
      where: { code: { in: uniq }, validFrom: covering.validFrom },
      select: { code: true, priceClinic: true, priceHospital: true },
    });
    for (const f of fees) {
      const g = gazetteFeeOf(f, grade);
      if (g.basis !== 'NOT_LISTED') out.set(f.code, g);
    }
    return out;
  }

  /**
   * 수가 마스터 행들의 단가를 설정 종별의 고시 단가로 바꿔 끼운다(제자리). 바꾼 줄 수를 돌려준다.
   * `grade` 를 넘기면 그 종별로(종별 계산기) — 안 넘기면 명시 설정 종별(청구 경로).
   */
  async apply(rows: (TierPriced | null | undefined)[], opts: { at?: Date; grade?: InstitutionGrade | null } = {}): Promise<number> {
    const list = rows.filter((r): r is TierPriced => !!r && typeof r.code === 'string');
    if (!list.length) return 0;
    const grade = opts.grade !== undefined ? opts.grade : await this.explicitGrade();
    if (!grade) return 0;
    const fees = await this.gazetteFor(list.map((r) => r.code), grade, opts.at);
    let n = 0;
    for (const r of list) {
      const g = fees.get(r.code);
      if (!g) continue;
      if (r.unitPrice !== g.price) { r.unitPrice = g.price; n++; }
    }
    return n;
  }
}
