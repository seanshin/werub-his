import { describe, it, expect, vi } from 'vitest';
import { PreOrderService } from '../../src/modules/pre-order/pre-order.service';

/**
 * 사전처방 목록 약품에 영문 표시 재료(nameEn·ingredient)가 실린다 — 의료용어 한/영 토글 계약(2026-09-11).
 *
 * 사전처방 탭 목록은 약품을 <DrugName> 으로 그린다(영문 모드: 상품명 nameEn → 라틴 성분명 → 한글+'EN×').
 * 운영 실측 상품명 nameEn 은 0.2%·성분명은 98.2% — select 에서 ingredient 가 빠지면 영문 모드에서 거의 모든
 * 약이 '영문명 미등록'으로 그려진다. ProcedureCode 는 영문명 필드가 없다(지어내지 않는다).
 *
 * 목(mock)은 Prisma 의 실제 반환 모양을 재현한다 — DB 행 전체에서 select 한 키만 투영해 돌려준다.
 */

type Spec = { select?: Record<string, unknown>; include?: Record<string, unknown> };
function project(row: unknown, spec: Spec | true | undefined): unknown {
  if (row == null || spec === true || spec === undefined) return row;
  if (Array.isArray(row)) return row.map((r) => project(r, spec));
  const src = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (spec.select) {
    for (const [k, v] of Object.entries(spec.select)) if (v) out[k] = v === true ? src[k] : project(src[k], v as Spec);
    return out;
  }
  for (const [k, v] of Object.entries(src)) {
    const isRelation = Array.isArray(v) || (v !== null && typeof v === 'object' && !(v instanceof Date));
    if (!isRelation) out[k] = v;
  }
  for (const [k, v] of Object.entries(spec.include ?? {})) if (v) out[k] = v === true ? src[k] : project(src[k], v as Spec);
  return out;
}

const MED_ROW = {
  id: 'm-1', code: '644900310', nameKo: '타이레놀정500밀리그램(아세트아미노펜)', nameEn: null, ingredient: 'Acetaminophen',
  category: '해열.진통.소염제', ingredientCode: '101301ATB', manufacturer: '한국얀센', dosageForm: '정제', unit: '정',
  insuranceCode: '644900310', unitPrice: 51, isActive: true, validFrom: new Date('2020-01-01'), validTo: null,
};
const PRE_ORDER_ROW = {
  id: 'po-1', patientId: 'p-1', doctorId: 'd-1', type: 'MEDICATION', status: 'PENDING', priority: 'ROUTINE',
  medicationCodeId: 'm-1', procedureCodeId: null, createdAt: new Date('2026-09-10T01:00:00Z'),
  patient: { id: 'p-1', mrn: 'MRN-1', familyName: '홍', givenName: '길동' },
  doctor: { id: 'd-1', familyName: '김', givenName: '의사' },
  medicationCode: MED_ROW, procedureCode: null, appointment: null,
};

describe('사전처방 목록 약품 영문 표시 재료 계약', () => {
  it('🔴 findAll(사전처방 탭 목록의 출처) — medicationCode 에 nameEn·ingredient 가 실린다', async () => {
    const prisma = { preOrder: { findMany: vi.fn(async (args: Spec) => [project(PRE_ORDER_ROW, { include: args.include })]) } };
    const service = new PreOrderService(prisma as never, {} as never, { emit: vi.fn() } as never);
    const res = await service.findAll({ patientId: 'p-1' });
    const med = (res.data[0] as unknown as { medicationCode: Record<string, unknown> }).medicationCode;
    expect(med.ingredient).toBe('Acetaminophen');
    expect(med).toHaveProperty('nameEn'); // 값이 null 인 것(미등록)과 키가 없는 것(안 실음)은 다른 사실
    expect(med.nameEn).toBeNull();
    // 대조군: 투영이 실제로 좁힌다(행 전체를 돌려주는 목이면 위 단언은 select 와 무관하게 통과한다)
    expect(med).not.toHaveProperty('manufacturer');
  });
});
