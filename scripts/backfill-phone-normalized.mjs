/**
 * 🔴 phoneNormalized 백필 (환자관리 A1 · 2026-08-31).
 *
 * 기존 환자의 phone 에서 정규화 값을 **파생**해 phoneNormalized 를 채운다 — 정확 매칭 중복탐지가
 * 기존 환자에게도 작동하게. 🔴 **원문 phone 은 건드리지 않는다**(파생만·추정 없음·소급 변경 아님).
 * 정규화 불가(해석 안 되는 전화)는 null 유지 — 지어내지 않는다.
 *
 * 실행: node scripts/backfill-phone-normalized.mjs   (정본 유틸 재사용: apps/api/dist/common/phone.js)
 */
import { PrismaClient } from '@prisma/client';
import { normalizePhone } from '../apps/api/dist/common/phone.js';

const prisma = new PrismaClient();
let updated = 0, skipped = 0, scanned = 0;

const rows = await prisma.patient.findMany({
  where: { phone: { not: null }, phoneNormalized: null },
  select: { id: true, phone: true },
});
for (const r of rows) {
  scanned++;
  const norm = normalizePhone(r.phone);
  if (!norm) { skipped++; continue; }           // 해석 불가 — null 유지
  await prisma.patient.update({ where: { id: r.id }, data: { phoneNormalized: norm } });
  updated++;
}
console.log(`phoneNormalized 백필: 대상 ${scanned} · 채움 ${updated} · 해석불가 유지 ${skipped}`);
await prisma.$disconnect();
