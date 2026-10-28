import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MedicalAiService } from '../medical-ai/medical-ai.service';

/**
 * F-7 T-0 resolver — HIS 약품코드 → e약은요 원문 (설계 §5.1 · 운영 실측 §5.6)
 *
 * 체인(2-hop): MedicationCode.insuranceCode → 선행 0 제거(★'054801360' 미해석·'54801360'만 해석)
 *   → WeRU.B drug-master/{code} → matches[0].item_code(품목기준코드)
 *   → e-drug-info/{item_code} → found:true 정확 1건
 * 해석 실패 = null(폴백 — 명칭 검색은 오매칭 위험으로 자동 사용 금지).
 * item_code는 캐시(drug_explain_cache.item_code)에 저장 → 2회째부터 1-hop.
 */

/** e약은요 원문(정규화) — §5.6-③ 실측 필드 */
export interface EDrugInfo {
  itemCode: string;
  itemName?: string;
  efficacy?: string;
  usage?: string;
  precaution?: string;
  sideEffect?: string;
  interaction?: string;
  warn?: string;
  storage?: string;
  /** e약은요 개정일 — 캐시 source_version 정본 */
  updateDe?: string;
  /** WeRU.B 동봉 disclaimer 정본 — FE 우선 렌더(§6.5-④) */
  disclaimer?: string;
}

/** 선행 0 제거 — 전부 0이면 원본 유지(빈 코드 방지) */
export function stripLeadingZeros(code: string): string {
  const s = (code ?? '').trim();
  const stripped = s.replace(/^0+/, '');
  return stripped.length ? stripped : s;
}

@Injectable()
export class DrugInfoResolver {
  private readonly logger = new Logger(DrugInfoResolver.name);

  constructor(
    private readonly prisma: PrismaService,
    // PortalModule은 MedicalAiModule을 기 import(전이 순환 없음 — MedicalAi→ConfigRuntime 리프) — 신규 모듈 배선 0
    @Optional() private readonly medicalAi?: MedicalAiService,
  ) {}

  /**
   * medicationCodeId → e약은요 원문 | null.
   * knownItemCode(캐시 item_code)가 있으면 drug-master 생략(1-hop).
   */
  async resolve(medicationCodeId: string, knownItemCode?: string | null): Promise<EDrugInfo | null> {
    if (!this.medicalAi) return null;
    try {
      let itemCode = knownItemCode?.trim() || null;
      if (!itemCode) {
        const med = await this.prisma.medicationCode.findUnique({
          where: { id: medicationCodeId },
          select: { insuranceCode: true, code: true },
        });
        const raw = med?.insuranceCode ?? med?.code;
        if (!raw) return null;
        const master = (await this.medicalAi.drugMaster(stripLeadingZeros(raw))) as Record<string, unknown> | null;
        itemCode = this.pickItemCode(master);
        if (!itemCode) return null;
      }
      const info = (await this.medicalAi.eDrugInfo(itemCode)) as Record<string, unknown> | null;
      return this.normalize(itemCode, info);
    } catch (e) {
      this.logger.warn(`e약은요 해석 실패(${medicationCodeId}): ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  /** drug-master 응답 → 품목기준코드(matches[0].item_code — §5.6-② 실측) */
  private pickItemCode(master: Record<string, unknown> | null): string | null {
    if (!master || master.found === false) return null;
    const matches = Array.isArray(master.matches) ? (master.matches as Record<string, unknown>[]) : [];
    const first = matches[0];
    const code = first?.item_code ?? first?.itemCode ?? first?.item_seq;
    return code ? String(code) : null;
  }

  /** e-drug-info 응답 정규화 — found:false는 null. 레코드는 matches[0]에 위치(2026-07-07 운영 실측 — results/item/최상위는 방어 유지) */
  private normalize(itemCode: string, res: Record<string, unknown> | null): EDrugInfo | null {
    if (!res || res.found === false) return null;
    const rec = (Array.isArray(res.matches) && res.matches.length
      ? (res.matches[0] as Record<string, unknown>)
      : Array.isArray(res.results) && res.results.length
        ? (res.results[0] as Record<string, unknown>)
        : (res.item as Record<string, unknown> | undefined) ?? res);
    const s = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
    const info: EDrugInfo = {
      itemCode,
      itemName: s(rec.item_name) ?? s(rec.itemName),
      efficacy: s(rec.efficacy),
      usage: s(rec.usage),
      precaution: s(rec.precaution),
      sideEffect: s(rec.side_effect) ?? s(rec.sideEffect),
      interaction: s(rec.interaction),
      warn: s(rec.warn),
      storage: s(rec.storage),
      updateDe: s(rec.update_de) ?? s(rec.updateDe) ?? s(res.update_de),
      disclaimer: s(rec.disclaimer) ?? s(res.disclaimer),
    };
    // 원문 본문이 하나도 없으면 생성 근거 부재 → 폴백
    if (!info.efficacy && !info.usage && !info.precaution && !info.sideEffect) return null;
    return info;
  }
}
