import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Gender, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateReferenceRangeDto, UpdateReferenceRangeDto } from './dto/reference-range.dto';

export interface ResolvedRange {
  id: string;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  unit: string | null;
  textNormal: string | null;
}

@Injectable()
export class ReferenceRangeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 환자 인구학(성별·연령)에 맞는 기준치 해소.
   * 매칭 = (testCode 또는 loincCode) + 성별(ANY 허용) + 연령대 포함. 가장 구체적인 것 우선.
   * 🔴코드 기반만(testCode/loincCode) — 이름 매칭 금지(오매칭 안전위험).
   */
  async resolve(params: { testCode?: string | null; loincCode?: string | null; sex?: Gender | null; ageYears?: number | null; ageMonths?: number | null; specimen?: string | null }): Promise<ResolvedRange | null> {
    const { testCode, loincCode, sex, ageYears, ageMonths, specimen } = params;
    if (!testCode && !loincCode) return null;

    const or: Prisma.ReferenceRangeWhereInput[] = [];
    if (testCode) or.push({ testCode });
    if (loincCode) or.push({ loincCode });

    // 결정적 순서(동점 타이브레이크) — 비결정적 DB 행순서로 엉뚱한 범위가 뽑히지 않도록.
    const candidates = await this.prisma.referenceRange.findMany({
      where: { isActive: true, OR: or },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!candidates.length) return null;

    const sexKey = sex === 'MALE' ? 'MALE' : sex === 'FEMALE' ? 'FEMALE' : 'ANY';
    const matched = candidates
      .filter((c) => c.sex === 'ANY' || c.sex === sexKey)
      .filter((c) => {
        const hasMonth = c.ageMinMonths != null || c.ageMaxMonths != null;
        const hasYear = c.ageMinYears != null || c.ageMaxYears != null;
        if (!hasMonth && !hasYear) return true; // 전연령
        // 🔴나이 미상 → 연령대 지정 범위(소아/신생아) 오매칭 방지 → 제외.
        if (hasMonth) {
          if (ageMonths == null) return false;
          if (c.ageMinMonths != null && ageMonths < c.ageMinMonths) return false;
          if (c.ageMaxMonths != null && ageMonths >= c.ageMaxMonths) return false; // [min, max)
          return true;
        }
        if (ageYears == null) return false;
        if (c.ageMinYears != null && ageYears < c.ageMinYears) return false;
        if (c.ageMaxYears != null && ageYears >= c.ageMaxYears) return false; // [min, max)
        return true;
      })
      .map((c, idx) => ({
        c, idx,
        // 🔴연령대 매칭이 성별보다 우선(성인 성별범위가 소아 연령범위를 이겨 소아를 성인기준 판정하던 것 방지).
        score:
          (c.ageMinMonths != null || c.ageMaxMonths != null ? 6 : (c.ageMinYears != null || c.ageMaxYears != null ? 4 : 0)) +
          (c.sex !== 'ANY' ? 3 : 0) +
          (specimen && c.specimen && c.specimen.toLowerCase() === specimen.toLowerCase() ? 2 : 0) +
          (testCode && c.testCode === testCode ? 1 : 0),
      }))
      // 점수 내림차순, 동점은 정렬된 원순서(idx) 유지 → 결정적.
      .sort((a, b) => b.score - a.score || a.idx - b.idx);

    const best = matched[0]?.c;
    if (!best) return null;
    return {
      id: best.id,
      low: this.dec3(best.low),
      high: this.dec3(best.high),
      criticalLow: this.dec3(best.criticalLow),
      criticalHigh: this.dec3(best.criticalHigh),
      unit: best.unit,
      textNormal: best.textNormal,
    };
  }

  /** 수치 판정: LL(위급저)/L/N/H/HH(위급고). 범위 없으면 null. */
  computeFlag(value: number, r: { low: number | null; high: number | null; criticalLow: number | null; criticalHigh: number | null }): string | null {
    if (Number.isNaN(value)) return null;
    if (r.criticalLow != null && value <= r.criticalLow) return 'LL';
    if (r.criticalHigh != null && value >= r.criticalHigh) return 'HH';
    if (r.low != null && value < r.low) return 'L';
    if (r.high != null && value > r.high) return 'H';
    if (r.low != null || r.high != null) return 'N';
    return null;
  }

  /**
   * 원시 결과값(문자열) 판정 — 수치는 computeFlag, 정성(Negative/Positive 등)은 textNormal 대조.
   * 🔴판정 불가(정성인데 textNormal 미설정)는 'N'으로 강제하지 않고 null(미판정) → 이상치 오정상 방지.
   */
  flagValue(raw: string, r: { low: number | null; high: number | null; criticalLow: number | null; criticalHigh: number | null; textNormal?: string | null }): string | null {
    const num = Number(raw);
    if (!Number.isNaN(num) && raw.trim() !== '') return this.computeFlag(num, r);
    // 정성: textNormal과 일치=N, 불일치=A(이상), 기준없음=null(미판정)
    if (r.textNormal != null && r.textNormal.trim() !== '') {
      return raw.trim().toLowerCase() === r.textNormal.trim().toLowerCase() ? 'N' : 'A';
    }
    return null;
  }

  /** 기준치 불변식 검증 — 오설정(위급>정상 등)이 전 환자 오판정 유발하지 않도록. */
  private validateInvariants(d: { low?: number | null; high?: number | null; criticalLow?: number | null; criticalHigh?: number | null; ageMinYears?: number | null; ageMaxYears?: number | null; ageMinMonths?: number | null; ageMaxMonths?: number | null; textNormal?: string | null }) {
    const { low, high, criticalLow, criticalHigh, ageMinYears, ageMaxYears, ageMinMonths, ageMaxMonths, textNormal } = d;
    if (ageMinMonths != null && ageMaxMonths != null && ageMinMonths >= ageMaxMonths) throw new BadRequestException('개월 연령 하한 < 상한이어야 합니다');
    if (low != null && high != null && low >= high) throw new BadRequestException('정상 하한 < 상한이어야 합니다');
    if (criticalLow != null && low != null && criticalLow > low) throw new BadRequestException('위급 저치 ≤ 정상 하한이어야 합니다');
    if (criticalHigh != null && high != null && criticalHigh < high) throw new BadRequestException('위급 고치 ≥ 정상 상한이어야 합니다');
    if (criticalLow != null && criticalHigh != null && criticalLow >= criticalHigh) throw new BadRequestException('위급 저치 < 위급 고치여야 합니다');
    if (ageMinYears != null && ageMaxYears != null && ageMinYears >= ageMaxYears) throw new BadRequestException('연령 하한 < 상한이어야 합니다');
    const hasNumeric = low != null || high != null || criticalLow != null || criticalHigh != null;
    if (!hasNumeric && !(textNormal && textNormal.trim())) throw new BadRequestException('정상범위(수치) 또는 정성 정상값 중 하나는 필요합니다');
  }

  // ── 마스터 관리 ──

  /** Decimal(12,3) → 3자리 정규화 숫자(직렬화 float 아티팩트 0.799999… 제거) */
  private dec3(v: unknown): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : Math.round(n * 1000) / 1000;
  }

  async list(query: { testCode?: string; loincCode?: string; q?: string }) {
    const where: Prisma.ReferenceRangeWhereInput = { isActive: true };
    if (query.testCode) where.testCode = query.testCode;
    if (query.loincCode) where.loincCode = query.loincCode;
    if (query.q) where.OR = [{ testName: { contains: query.q, mode: 'insensitive' } }, { testCode: { contains: query.q, mode: 'insensitive' } }];
    const rows = await this.prisma.referenceRange.findMany({ where, orderBy: [{ testCode: 'asc' }, { sex: 'asc' }, { ageMinYears: 'asc' }], take: 200 });
    return rows.map((r) => ({ ...r, low: this.dec3(r.low), high: this.dec3(r.high), criticalLow: this.dec3(r.criticalLow), criticalHigh: this.dec3(r.criticalHigh) }));
  }

  async create(dto: CreateReferenceRangeDto) {
    this.validateInvariants(dto);
    return this.prisma.referenceRange.create({ data: { ...dto, source: dto.source ?? 'MANUAL' } });
  }

  async update(id: string, dto: UpdateReferenceRangeDto) {
    const existing = await this.prisma.referenceRange.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('기준치 없음');
    // 기존값과 병합 후 불변식 검증(부분 수정이 모순 상태를 만들지 않도록)
    const merged = {
      low: dto.low !== undefined ? dto.low : (existing.low != null ? Number(existing.low) : null),
      high: dto.high !== undefined ? dto.high : (existing.high != null ? Number(existing.high) : null),
      criticalLow: dto.criticalLow !== undefined ? dto.criticalLow : (existing.criticalLow != null ? Number(existing.criticalLow) : null),
      criticalHigh: dto.criticalHigh !== undefined ? dto.criticalHigh : (existing.criticalHigh != null ? Number(existing.criticalHigh) : null),
      ageMinYears: dto.ageMinYears !== undefined ? dto.ageMinYears : existing.ageMinYears,
      ageMaxYears: dto.ageMaxYears !== undefined ? dto.ageMaxYears : existing.ageMaxYears,
      ageMinMonths: dto.ageMinMonths !== undefined ? dto.ageMinMonths : existing.ageMinMonths,
      ageMaxMonths: dto.ageMaxMonths !== undefined ? dto.ageMaxMonths : existing.ageMaxMonths,
      textNormal: dto.textNormal !== undefined ? dto.textNormal : existing.textNormal,
    };
    this.validateInvariants(merged);
    return this.prisma.referenceRange.update({ where: { id }, data: dto });
  }

  async deactivate(id: string) {
    const existing = await this.prisma.referenceRange.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('기준치 없음');
    return this.prisma.referenceRange.update({ where: { id }, data: { isActive: false } });
  }
}
