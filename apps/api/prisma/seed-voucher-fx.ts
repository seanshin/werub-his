// @ts-nocheck
import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 검진권 국내/해외 딜러 데모 시드 — ERP 국내계좌(1110)/해외계좌(1115)·매출 연계 검증용.
 *
 * 생성: 국내(DOMESTIC/KR/KRW) + 해외(OVERSEAS/US/USD) 딜러 각 1, 발행(Allocation)·
 *       재판매/수수료(Sale)·상환(Redemption)·정산(Settlement) 전체 라이프사이클.
 * 모두 TEST- 마커 + 결정적 UUID로 멱등(upsert). 재실행 안전.
 *
 * 실행(HIS 팀):
 *   cd apps/api && npx ts-node prisma/seed-voucher-fx.ts
 *   그 다음 ERP 반영:  POST /api/v1/voucher/backfill-erp  (feature: voucher.admin)
 *     → 기존 backfill이 본 거래들을 ERP 웹훅으로 emit.
 *
 * ERP 부킹 결과(현 시점, Stage 2 이전):
 *   - 국내(KRW): purchase/redeem/commission/settlement 전부 KRW → ERP 국내계좌·매출(4110) 정상.
 *   - 해외(USD): redeem(병원측 KRW)·settlement(fxRate 보유→netPayableKrw)→해외계좌(1115) 정상 /
 *               purchase·commission(딜러측 USD·fxRate 없음)→ERP에서 DEAD(라인레벨 fxRate=Stage 2).
 *
 * 정리(되돌리기):
 *   delete from "VoucherSettlement" where id like 'TEST-%' or "billingRef" like 'TEST-%';
 *   (또는 아래 결정적 id/idempotencyKey/serial 들의 'TEST-' 프리픽스로 일괄 삭제)
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

/** 결정적 UUID — 같은 key면 항상 같은 uuid(멱등 FK 연결용). Postgres uuid 포맷만 충족. */
function uid(key: string): string {
  const h = createHash('sha256').update(`TEST-VOUCHER-FX:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
/** 64-hex 더미 해시(blockchain 필드 충족용). */
const h64 = (s: string) => createHash('sha256').update(s).digest('hex');

const ADMIN = uid('admin'); // issuedBy/createdBy 용 임의 uuid(FK 없음)
const NOW = new Date();
const D = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

async function dealer(key: string, data: any) {
  const id = uid(key);
  await prisma.distributor.upsert({
    where: { managementNo: data.managementNo },
    create: { id, ...data },
    update: { ...data },
  });
  return id;
}

async function batch(key: string, data: any) {
  const id = uid(key);
  await prisma.voucherBatch.upsert({
    where: { idempotencyKey: data.idempotencyKey },
    create: { id, issuedBy: ADMIN, serialRule: {}, policyVersion: 1, ...data },
    update: {},
  });
  return id;
}

async function voucher(key: string, data: any) {
  const id = uid(key);
  await prisma.checkupVoucher.upsert({
    where: { serial: data.serial },
    create: {
      id,
      activationHash: h64(`act:${data.serial}`),
      genesisHash: h64(`gen:${data.serial}`),
      headHash: h64(`head:${data.serial}`),
      ...data,
    },
    update: {},
  });
  return id;
}

async function allocation(data: any) {
  await prisma.voucherAllocation.upsert({
    where: { idempotencyKey: data.idempotencyKey },
    create: data,
    update: {},
  });
}

async function sale(key: string, data: any) {
  const id = uid(key);
  await prisma.voucherSale.upsert({
    where: { idempotencyKey: data.idempotencyKey },
    create: { id, ...data },
    update: {},
  });
  return id;
}

async function redemption(data: any) {
  await prisma.voucherRedemption.upsert({
    where: { idempotencyKey: data.idempotencyKey },
    create: data,
    update: {},
  });
}

async function settlement(key: string, data: any) {
  const id = uid(key);
  await prisma.voucherSettlement.upsert({
    where: { id },
    create: { id, ...data },
    update: { ...data },
  });
}

async function main() {
  // ─────────────────────────────── 1) 딜러 마스터
  const dDom = await dealer('dealer:domestic', {
    managementNo: 'TEST-WGD-KR-0001',
    name: 'TEST-국내유치업체(서울)',
    tier: 'MASTER',
    dealerType: 'DOMESTIC',
    country: 'KR',
    currency: 'KRW',
    licenseNumber: 'TEST-가-2026-0001', // DOMESTIC 유치업 등록번호
    taxId: '220-81-00000',
    bankInfo: { bank: '신한', account: '110-TEST-KRW-01', holder: 'TEST국내유치업체' },
    commissionRate: 12,
    status: 'ACTIVE',
  });
  const dOvs = await dealer('dealer:overseas', {
    managementNo: 'TEST-WGD-US-0001',
    name: 'TEST-해외딜러(USD)',
    tier: 'MASTER',
    dealerType: 'OVERSEAS',
    country: 'US',
    currency: 'USD',
    contractRef: 'TEST-USD-2026-001', // OVERSEAS 제휴계약 참조
    taxId: 'US-TIN-123456789',
    bankInfo: { swift: 'SHBKKRSE', iban: 'US00TEST0001', holder: 'TEST Overseas Dealer' },
    commissionRate: 18,
    status: 'ACTIVE',
  });

  // ─────────────────────────────── 2) 배치 + 검진권 (faceValue=원)
  const bDom = await batch('batch:domestic', {
    idempotencyKey: 'TEST-BATCH-KR-01', form: 'AMOUNT',
    faceValue: 500000, quantity: 10, supplyPrice: 450000, status: 'ISSUED',
  });
  const bOvs = await batch('batch:overseas', {
    idempotencyKey: 'TEST-BATCH-US-01', form: 'AMOUNT',
    faceValue: 675000, quantity: 10, supplyPrice: 600000, status: 'ISSUED',
  });
  const vDom = await voucher('voucher:dom:1', {
    serial: 'TEST-WGC-KR-000000001', batchId: bDom, form: 'AMOUNT',
    faceValue: 500000, balance: 0, status: 'REDEEMED',
    currentOwnerType: 'PATIENT',
  });
  const vOvs = await voucher('voucher:ovs:1', {
    serial: 'TEST-WGC-US-000000001', batchId: bOvs, form: 'AMOUNT',
    faceValue: 675000, balance: 0, status: 'REDEEMED',
    currentOwnerType: 'PATIENT',
  });

  // ─────────────────────────────── 3) 국내(KRW) 라이프사이클
  // 발행(purchase): 병원→국내딜러 10매 @450,000 = 4,500,000원
  await allocation({
    idempotencyKey: 'TEST-ALLOC-KR-01', fromType: 'HOSPITAL', fromId: null,
    toDistributorId: dDom, quantity: 10, supplyPrice: 450000,
    status: 'FULFILLED', paidAt: NOW, deliveryChannel: 'SIMULATION',
  });
  // 재판매(resale)+수수료(commission): 딜러→환자 500,000원, 수수료 12%=60,000원
  await sale('sale:domestic', {
    idempotencyKey: 'TEST-SALE-KR-01', voucherId: vDom, distributorId: dDom,
    buyerType: 'PATIENT', buyerName: 'TEST 국내환자', salePrice: 500000,
    commissionRate: 12, commissionAmount: 60000, currency: 'KRW', soldAt: NOW,
  });
  // 상환(redeem): 병원 검진 사용 500,000원(병원측 KRW)
  await redemption({
    idempotencyKey: 'TEST-REDEEM-KR-01', voucherId: vDom,
    amountUsed: 500000, actualPrice: 500000,
  });
  // 정산(settlement, CONFIRMED): KRW → netPayableKrw=netPayable
  await settlement('settle:domestic', {
    distributorId: dDom, periodStart: D(2026, 5, 1), periodEnd: D(2026, 5, 31),
    grossSales: 500000, commissionTotal: 60000, refundClawback: 0, netPayable: 440000,
    currency: 'KRW', fxRate: 1.0, fxRateSource: 'BASE', status: 'CONFIRMED',
    billingRef: 'TEST-SETTLE-KR-01', createdBy: ADMIN, confirmedBy: uid('admin2'),
    confirmedAt: NOW,
  });

  // ─────────────────────────────── 4) 해외(USD) 라이프사이클 (fxRate 1,350)
  // 발행(purchase): 병원→해외딜러 10매 @USD500 = USD5,000 (딜러통화·fxRate 없음→ERP DEAD until Stage2)
  await allocation({
    idempotencyKey: 'TEST-ALLOC-US-01', fromType: 'HOSPITAL', fromId: null,
    toDistributorId: dOvs, quantity: 10, supplyPrice: 500,
    status: 'FULFILLED', paidAt: NOW, deliveryChannel: 'SIMULATION',
  });
  // 재판매+수수료: 딜러→환자 USD600, 수수료 18%=USD108 (딜러통화→ERP DEAD until Stage2)
  await sale('sale:overseas', {
    idempotencyKey: 'TEST-SALE-US-01', voucherId: vOvs, distributorId: dOvs,
    buyerType: 'PATIENT', buyerName: 'TEST Overseas Patient', salePrice: 600,
    commissionRate: 18, commissionAmount: 108, currency: 'USD', soldAt: NOW,
  });
  // 상환(redeem): 병원 검진 사용 675,000원 (병원측 KRW → ERP 매출 정상 부킹)
  await redemption({
    idempotencyKey: 'TEST-REDEEM-US-01', voucherId: vOvs,
    amountUsed: 675000, actualPrice: 675000,
  });
  // 정산(settlement, CONFIRMED): USD + fxRate 1,350 → backfill netPayableKrw=round(netPayable*fxRate)
  //   grossSales USD6,000 - commission USD1,080 = netPayable USD4,920 → 6,642,000원(해외계좌 1115)
  await settlement('settle:overseas', {
    distributorId: dOvs, periodStart: D(2026, 5, 1), periodEnd: D(2026, 5, 31),
    grossSales: 6000, commissionTotal: 1080, refundClawback: 0, netPayable: 4920,
    currency: 'USD', fxRate: 1350, fxRateSource: 'SIMULATION', status: 'CONFIRMED',
    billingRef: 'TEST-SETTLE-US-01', createdBy: ADMIN, confirmedBy: uid('admin2'),
    confirmedAt: NOW,
  });

  // ─────────────────────────────── 요약
  const counts = {
    distributors: await prisma.distributor.count({ where: { managementNo: { startsWith: 'TEST-' } } }),
    batches: await prisma.voucherBatch.count({ where: { idempotencyKey: { startsWith: 'TEST-' } } }),
    vouchers: await prisma.checkupVoucher.count({ where: { serial: { startsWith: 'TEST-' } } }),
    allocations: await prisma.voucherAllocation.count({ where: { idempotencyKey: { startsWith: 'TEST-' } } }),
    sales: await prisma.voucherSale.count({ where: { idempotencyKey: { startsWith: 'TEST-' } } }),
    redemptions: await prisma.voucherRedemption.count({ where: { idempotencyKey: { startsWith: 'TEST-' } } }),
    settlements: await prisma.voucherSettlement.count({ where: { billingRef: { startsWith: 'TEST-' } } }),
  };
  console.log('[seed-voucher-fx] 완료:', JSON.stringify(counts));
  console.log('[seed-voucher-fx] 다음: POST /api/v1/voucher/backfill-erp (feature: voucher.admin) 로 ERP emit');
}

main()
  .catch((e) => {
    console.error('[seed-voucher-fx] 실패:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
