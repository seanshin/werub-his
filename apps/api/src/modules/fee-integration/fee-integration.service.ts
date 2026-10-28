import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

// ERP(수가/재료비 마스터) → HIS 소비. 멱등 upsert.
@Injectable()
export class FeeIntegrationService {
  private readonly logger = new Logger(FeeIntegrationService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** 수가(EDI ProcedureCode) upsert — code 기준 최신값 */
  async upsertProcedureCodes(rows: {
    code: string; nameKo: string; category?: string; unitPrice?: number;
    copayRate?: number; insuranceCovered?: boolean; validFrom: string; validTo?: string;
  }[]) {
    let created = 0, updated = 0, failed = 0;
    for (const r of rows) {
      try {
        const data = {
          nameKo: r.nameKo, category: r.category ?? null, unitPrice: r.unitPrice ?? null,
          copayRate: r.copayRate != null ? r.copayRate.toString() : null,
          insuranceCovered: r.insuranceCovered ?? true,
          validFrom: new Date(r.validFrom), validTo: r.validTo ? new Date(r.validTo) : null, isActive: true,
        };
        const res = await this.prisma.procedureCode.upsert({
          where: { code_validFrom: { code: r.code, validFrom: new Date(r.validFrom) } },
          create: { code: r.code, ...data }, update: data,
        });
        // upsert는 생성/갱신 구분이 어려워 createdAt==updatedAt로 추정
        if (res.createdAt.getTime() === res.updatedAt.getTime()) created++; else updated++;
      } catch (e) { failed++; this.logger.warn(`procedureCode ${r.code} 실패: ${(e as Error).message}`); }
    }
    return { total: rows.length, created, updated, failed };
  }

  /** 비급여/재료대(NonCoveredItem) upsert — code 기준(유니크 제약 없어 수동 upsert) */
  async upsertNonCovered(rows: { code: string; name: string; category: string; price: number; requiresConsent?: boolean; description?: string }[]) {
    let created = 0, updated = 0, failed = 0;
    for (const r of rows) {
      try {
        const existing = await this.prisma.nonCoveredItem.findFirst({ where: { code: r.code } });
        const data = { name: r.name, category: r.category, price: r.price, requiresConsent: r.requiresConsent ?? true, description: r.description ?? null, isActive: true };
        if (existing) { await this.prisma.nonCoveredItem.update({ where: { id: existing.id }, data }); updated++; }
        else { await this.prisma.nonCoveredItem.create({ data: { code: r.code, ...data } }); created++; }
      } catch (e) { failed++; this.logger.warn(`nonCovered ${r.code} 실패: ${(e as Error).message}`); }
    }
    return { total: rows.length, created, updated, failed };
  }

  /** 재고 원가(매입단가) — erpItemCode 매핑된 품목 unitPrice 갱신(범용 inventory + CSSD) */
  async updateMaterialCosts(rows: { erpItemCode: string; unitPrice: number }[]) {
    // 🔴 (2026-10-01 .catch 비리터럴 판정) 종전 `.catch(() => ({ count: 0 }))` — 갱신 **실패**가 count 0 이 되어 "ERP 품목 매핑 없음(unmatched)"으로
    //    세어졌다. 매핑을 고치러 간 사람은 매핑이 멀쩡한 것을 보게 된다. 실패는 failed 로 따로 센다(같은 파일 비급여 갱신과 같은 규약).
    let inv = 0, cssd = 0, unmatched = 0, failed = 0;
    for (const r of rows) {
      try {
        const a = await this.prisma.inventoryItem.updateMany({ where: { erpItemCode: r.erpItemCode }, data: { unitPrice: r.unitPrice, lastPurchasePrice: r.unitPrice } });
        const b = await this.prisma.instrumentItem.updateMany({ where: { erpItemCode: r.erpItemCode }, data: { unitPrice: r.unitPrice } });
        inv += a.count; cssd += b.count;
        if (a.count + b.count === 0) unmatched++;
      } catch (e) { failed++; this.logger.warn(`재고 원가 ${r.erpItemCode} 실패: ${(e as Error).message}`); }
    }
    return { total: rows.length, inventoryUpdated: inv, cssdUpdated: cssd, unmatched, failed };
  }
}
