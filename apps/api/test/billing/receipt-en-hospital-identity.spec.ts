import { describe, it, expect, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/billing.service';
import { BillingController } from '../../src/modules/billing/billing.controller';
import { ConfigRuntimeService } from '../../src/modules/config/config-runtime.service';

/**
 * 🔴 영문 영수증(`GET /billings/:id/receipt-en`)의 기관명 (2026-09-11).
 *
 * 원 결함: `hospitalNameEn: 'Hospital RUN Medical Center'` 하드코딩 + `hospitalName: receipt.hospitalName ?? 'Hospital RUN'`
 *   (billing 행에는 hospitalName 이 없어 **항상** 폴백) — 설정 키 `hospital.nameEn` 이 있는데도 날조 기관명이 나갔다.
 *
 * 🔴 설정 서비스는 **진짜**를 쓴다(목이 아니다) — `getWithSource` 가 DB 행이 없을 때 DEFAULTS 플레이스홀더
 *    ('Hospital RUN 병원')를 `source:'default'` 로 돌려주는 실제 동작까지 재현해야 "플레이스홀더를 기관명으로
 *    내보내지 않는다"를 증명할 수 있다. prisma 는 실제 반환 모양(행 또는 null)으로만 흉내 낸다.
 */

const mkConfig = (rows: Record<string, unknown>) =>
  new ConfigRuntimeService({
    systemConfig: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (rows[where.key] !== undefined ? { key: where.key, value: rows[where.key] } : null)),
    },
  } as never, { emit: () => true } as never);

const mkSvc = (rows: Record<string, unknown>) =>
  new BillingService({} as never, {} as never, {} as never, mkConfig(rows) as never, {} as never, {} as never, {} as never);

const RECEIPT = { id: 'b-1', receiptNumber: 'R-1', status: 'PAID', totalAmount: 10000, patientCopay: 3000, items: [], patient: { familyName: 'Kim', givenName: 'A', mrn: 'M1' } };

describe('영문 영수증 기관명 — 정본 hospital.name/nameEn · 출처 3상태', () => {
  it('🔴 ① DB 에 설정된 국문·영문 기관명이 그대로 나간다(상수가 아니다)', async () => {
    const r: any = await mkSvc({ 'hospital.name': '센티넬병원', 'hospital.nameEn': 'Sentinel Hospital' }).translateReceiptToEnglish(RECEIPT);
    expect(r.hospitalName).toBe('센티넬병원');
    expect(r.hospitalNameEn).toBe('Sentinel Hospital');
    expect(r.hospitalIdentityUnset).toEqual([]);
  });

  it('🔴 ② 설정 행이 없으면 DEFAULTS 플레이스홀더도 날조 영문명도 내보내지 않는다 — null 과 미설정 키를 밝힌다', async () => {
    const r: any = await mkSvc({}).translateReceiptToEnglish(RECEIPT);
    expect(r.hospitalName, "DEFAULTS 플레이스홀더('Hospital RUN 병원')가 기관명으로 나갔습니다").toBeNull();
    expect(r.hospitalNameEn).toBeNull();
    expect(r.hospitalIdentityUnset).toEqual(['hospital.name', 'hospital.nameEn']);
    expect(JSON.stringify(r)).not.toContain('Hospital RUN');
  });

  it('🔴 ③ 영문명만 없으면 영문명 자리를 국문명·지어낸 영문으로 채우지 않는다', async () => {
    const r: any = await mkSvc({ 'hospital.name': '위루비병원' }).translateReceiptToEnglish(RECEIPT);
    expect(r.hospitalName).toBe('위루비병원');
    expect(r.hospitalNameEn).toBeNull();
    expect(r.hospitalIdentityUnset).toEqual(['hospital.nameEn']);
    expect(JSON.stringify(r)).not.toContain('Medical Center');
  });

  it('④ 대조군 — 빈 문자열로 저장된 영문명은 "설정됨"이 아니다', async () => {
    const r: any = await mkSvc({ 'hospital.name': 'A병원', 'hospital.nameEn': '   ' }).translateReceiptToEnglish(RECEIPT);
    expect(r.hospitalNameEn).toBeNull();
  });

  it('🔴 ⑤ 컨트롤러가 비동기 결과를 기다린다 — Promise 가 data 로 직렬화되면 빈 객체({})가 나간다', async () => {
    const svc = mkSvc({ 'hospital.nameEn': 'Sentinel Hospital' });
    vi.spyOn(svc, 'getReceipt').mockResolvedValue(RECEIPT as never);
    const res: any = await new BillingController(svc).getReceiptEn('b-1');
    expect(res.data).not.toBeInstanceOf(Promise);
    expect(res.data.hospitalNameEn).toBe('Sentinel Hospital');
  });
});
