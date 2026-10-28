import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// 비급여 항목 데모 시드 (의료법 §45 고지용). 멱등(code 기준 skip).
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const ITEMS = [
  { code: 'ABZ010001', name: '1인실 병실료(1일)', category: 'ROOM', price: 350000, description: '상급병실(1인실)', requiresConsent: true },
  { code: 'ABZ010002', name: '2인실 병실료(1일)', category: 'ROOM', price: 180000, description: '상급병실(2인실)', requiresConsent: true },
  { code: 'EX-MRI-001', name: 'MRI 뇌 촬영', category: 'EXAM', price: 450000, description: '조영제 별도', requiresConsent: true },
  { code: 'EX-US-001', name: '갑상선 초음파', category: 'EXAM', price: 80000, description: '', requiresConsent: false },
  { code: 'EX-EDC-001', name: '종합건강검진(기본)', category: 'EXAM', price: 550000, description: '프로그램별 상이', requiresConsent: true },
  { code: 'TH-PT-001', name: '도수치료(30분)', category: 'THERAPY', price: 100000, description: '치료시간·부위별 상이', requiresConsent: true },
  { code: 'TH-PT-002', name: '체외충격파치료(ESWT)', category: 'THERAPY', price: 70000, description: '부위별', requiresConsent: true },
  { code: 'TH-IV-001', name: '영양수액(비타민)', category: 'THERAPY', price: 80000, description: '', requiresConsent: false },
  { code: 'PR-LSK-001', name: '라식 수술(양안)', category: 'PROCEDURE', price: 1800000, description: '검사 후 결정', requiresConsent: true },
  { code: 'PR-SKN-001', name: '피부 레이저(점 제거, 개당)', category: 'PROCEDURE', price: 30000, description: '크기·개수별', requiresConsent: true },
  { code: 'MT-IOL-001', name: '인공수정체(프리미엄)', category: 'MATERIAL', price: 1200000, description: '제품별 상이', requiresConsent: true },
  { code: 'CT-DIAG-001', name: '일반진단서', category: 'CERTIFICATE', price: 20000, description: '', requiresConsent: false },
  { code: 'CT-DIAG-002', name: '상해진단서(3주 미만)', category: 'CERTIFICATE', price: 100000, description: '진단 주수별', requiresConsent: false },
  { code: 'CT-REC-001', name: '진료기록 사본(1매)', category: 'CERTIFICATE', price: 1000, description: '6매 초과 시 매당 100원', requiresConsent: false },
  { code: 'CT-CONF-001', name: '진료확인서', category: 'CERTIFICATE', price: 3000, description: '', requiresConsent: false },
  { code: 'OT-VAC-001', name: '독감 예방접종', category: 'OTHER', price: 35000, description: '백신 종류별', requiresConsent: false },
];

async function main() {
  let created = 0, skipped = 0;
  for (const it of ITEMS) {
    const exists = await prisma.nonCoveredItem.findFirst({ where: { code: it.code } });
    if (exists) { skipped++; continue; }
    await prisma.nonCoveredItem.create({ data: it });
    created++;
  }
  console.log(`✅ 비급여 시드: 생성 ${created} / 스킵 ${skipped}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
