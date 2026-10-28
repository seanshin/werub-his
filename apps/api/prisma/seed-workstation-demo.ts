import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 워크스테이션-디바이스 포괄 시드 — 논리 스테이션(WorkstationConfig) 전수 + 운영 데스크.
 * 각 실제 스테이션 → 물리 워크스테이션 프로파일(매핑) + 카테고리별 기본 주변기기.
 * 실행: 서버에서  npx ts-node --transpile-only prisma/seed-workstation-demo.ts (추가·멱등)
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
const prisma = new PrismaClient();
const uid = (s: string) => {
  const h = createHash('md5').update(`ws-demo:${s}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

// 카테고리별 서브넷·기본 주변기기 템플릿
const SUBNET: Record<string, number> = { LAB: 2, IMAGING: 3, DIAGNOSTIC: 4, THERAPY: 5, RECEPTION: 1, PHARMACY: 6, EMERGENCY: 7 };
function peripheralsFor(cat: string, idx: number): { type: string; name: string; connection: string; host?: string; port?: number; isDefault: boolean; config?: object }[] {
  const sub = SUBNET[cat] ?? 9;
  const ip = (n: number) => `10.20.${sub}.${10 + idx * 2 + n}`;
  if (cat === 'LAB') return [
    { type: 'LABEL_PRINTER', name: '검체 라벨프린터', connection: 'NETWORK', host: ip(0), port: 9100, isDefault: true, config: { paper: '40x25mm', dpi: 203 } },
    { type: 'BARCODE_SCANNER', name: '검체 바코드스캐너', connection: 'WEBUSB', isDefault: true },
  ];
  if (cat === 'IMAGING') return [
    { type: 'DOC_PRINTER', name: '판독지 프린터', connection: 'NETWORK', host: ip(0), port: 9100, isDefault: true },
    { type: 'DICOM_MODALITY', name: '모달리티 Worklist', connection: 'NETWORK', host: ip(1), port: 104, isDefault: true, config: { aeTitle: 'HIS_WL' } },
  ];
  if (cat === 'DIAGNOSTIC') return [{ type: 'DOC_PRINTER', name: '검사 결과지 프린터', connection: 'NETWORK', host: ip(0), port: 9100, isDefault: true }];
  if (cat === 'THERAPY') return [{ type: 'DOC_PRINTER', name: '치료기록 프린터', connection: 'NETWORK', host: ip(0), port: 9100, isDefault: true }];
  if (cat === 'RECEPTION') return [
    { type: 'DOC_PRINTER', name: '영수증 프린터', connection: 'NETWORK', host: ip(0), port: 9100, isDefault: true },
    { type: 'SIGNATURE_PAD', name: '서명패드', connection: 'WEBUSB', isDefault: true },
    { type: 'CARD_READER', name: '신분증 리더', connection: 'WEBSERIAL', isDefault: true },
  ];
  if (cat === 'PHARMACY') return [
    { type: 'LABEL_PRINTER', name: '약품 라벨프린터', connection: 'NETWORK', host: ip(0), port: 9100, isDefault: true, config: { paper: '70x30mm' } },
    { type: 'DOC_PRINTER', name: '복약지도 프린터', connection: 'NETWORK', host: ip(1), port: 9100, isDefault: true },
  ];
  if (cat === 'EMERGENCY') return [
    { type: 'LABEL_PRINTER', name: '응급 라벨프린터', connection: 'NETWORK', host: ip(0), port: 9100, isDefault: true },
    { type: 'DOC_PRINTER', name: '응급 문서프린터', connection: 'NETWORK', host: ip(1), port: 9100, isDefault: true },
  ];
  return [];
}

async function upsertWs(code: string, label: string, department: string, stationIds: string[], cat: string, idx: number) {
  const id = uid(code);
  await prisma.workstationProfile.upsert({
    where: { code },
    update: { label, department, defaultStationIds: stationIds as unknown as Prisma.InputJsonValue },
    create: { id, code, label, department, defaultStationIds: stationIds as unknown as Prisma.InputJsonValue, isActive: true },
  });
  let p = 0;
  const list = peripheralsFor(cat, idx);
  for (let i = 0; i < list.length; i++) {
    const per = list[i];
    const pid = uid(`${code}-p${i}`);
    const pdata = { workstationProfileId: id, type: per.type, name: per.name, connection: per.connection, host: per.host ?? null, port: per.port ?? null, config: (per.config ?? Prisma.JsonNull) as Prisma.InputJsonValue, isDefault: per.isDefault, isActive: true };
    await prisma.peripheralDevice.upsert({ where: { id: pid }, update: pdata, create: { id: pid, ...pdata } });
    p++;
  }
  return { wsCreated: 1, pCreated: p };
}

async function main() {
  // 1) 논리 스테이션(WorkstationConfig) 전수 → 물리 워크스테이션
  const stations = await prisma.workstationConfig.findMany({ where: { isActive: true }, orderBy: [{ category: 'asc' }, { stationId: 'asc' }] });
  let ws = 0, per = 0;
  const catIdx: Record<string, number> = {};
  for (const s of stations) {
    const idx = (catIdx[s.category] = (catIdx[s.category] ?? -1) + 1);
    const code = `WS-${s.stationId.toUpperCase().replace(/[^A-Z0-9]/g, '-')}`;
    const r = await upsertWs(code, s.label, s.department, [s.stationId], s.category, idx);
    ws += r.wsCreated; per += r.pCreated;
  }

  // 2) 운영 데스크(논리 스테이션에 없는 물리 워크스테이션)
  const desks: { code: string; label: string; dept: string; cat: string }[] = [
    { code: 'WS-RECEPTION-01', label: '원무 접수 1번', dept: '원무과', cat: 'RECEPTION' },
    { code: 'WS-RECEPTION-02', label: '원무 접수 2번', dept: '원무과', cat: 'RECEPTION' },
    { code: 'WS-RECEPTION-ER', label: '응급 접수', dept: '원무과', cat: 'RECEPTION' },
    { code: 'WS-PHARMACY-01', label: '약국 조제대 1번', dept: '약제부', cat: 'PHARMACY' },
    { code: 'WS-EMERGENCY-01', label: '응급실 스테이션', dept: '응급의학과', cat: 'EMERGENCY' },
  ];
  for (let i = 0; i < desks.length; i++) {
    const d = desks[i];
    const r = await upsertWs(d.code, d.label, d.dept, [], d.cat, i);
    ws += r.wsCreated; per += r.pCreated;
  }

  // 3) 초기 데모 3종(포괄 시드로 대체됨) 정리
  const legacy = await prisma.workstationProfile.findMany({ where: { code: { in: ['WS-LAB-01', 'WS-IMG-01', 'WS-RCP-01'] } }, select: { id: true } });
  if (legacy.length) {
    const ids = legacy.map((l) => l.id);
    await prisma.peripheralDevice.deleteMany({ where: { workstationProfileId: { in: ids } } });
    await prisma.workstationProfile.deleteMany({ where: { id: { in: ids } } });
  }

  const total = await prisma.workstationProfile.count();
  console.log(`워크스테이션 포괄 시드 — 처리 ${ws}(스테이션 ${stations.length}+데스크 ${desks.length}) / 주변기기 ${per} / 레거시정리 ${legacy.length} / 전체 워크스테이션 ${total}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
