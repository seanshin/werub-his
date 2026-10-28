require('./seed-mode-guard').assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// CSSD(중앙공급실) 시드 — 기구 세트 + 멸균 이력. 멱등(이름 unique upsert).
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

// status: DIRTY / WASHING / STERILIZING / STERILE / EXPIRED / IN_USE
const SETS = [
  { name: '일반 수술 세트', loc: '중앙공급실 A', status: 'STERILE', exp: 25, contents: [['메스 핸들', 2], ['지혈 겸자', 8], ['가위(메이요)', 2], ['포셉', 4], ['니들 홀더', 2], ['석션 팁', 1]] },
  { name: '정형외과 세트', loc: '수술실 2', status: 'STERILE', exp: 18, contents: [['골절기', 1], ['리트랙터', 4], ['본 커터', 1], ['드릴 비트 세트', 1], ['엘리베이터', 3]] },
  { name: '복강경 수술 세트', loc: '중앙공급실 A', status: 'STERILIZING', exp: null, contents: [['투관침(트로카)', 4], ['그래스퍼', 3], ['클립 어플라이어', 1], ['카메라 포트', 1], ['전기소작기', 1]] },
  { name: '제왕절개 세트', loc: '수술실 3', status: 'STERILE', exp: 22, contents: [['메스 핸들', 2], ['앨리스 겸자', 6], ['리트랙터', 2], ['니들 홀더', 2], ['제대 가위', 1]] },
  { name: '백내장 수술 세트', loc: '수술실 1', status: 'IN_USE', exp: 20, contents: [['미세 포셉', 4], ['낭절개침', 1], ['I/A 팁', 1], ['개검기', 1], ['미세 가위', 2]] },
  { name: '편도 적출 세트', loc: '중앙공급실 B', status: 'DIRTY', exp: null, contents: [['편도 겸자', 2], ['스네어', 1], ['설압자', 1], ['지혈 겸자', 4]] },
  { name: '기관절개 세트', loc: '중앙공급실 B', status: 'WASHING', exp: null, contents: [['기관 확장기', 1], ['후크', 2], ['메스 핸들', 1], ['지혈 겸자', 4]] },
  { name: '흉부 수술 세트', loc: '중앙공급실 A', status: 'STERILE', exp: 2, contents: [['흉골 톱', 1], ['늑골 견인기', 1], ['혈관 겸자', 8], ['니들 홀더', 3]] },
  { name: '신경외과 세트', loc: '수술실 2', status: 'STERILE', exp: 28, contents: [['두개골 천공기', 1], ['뇌압자', 2], ['미세 박리자', 3], ['바이폴라 겸자', 2]] },
  { name: '비뇨기 내시경 세트', loc: '중앙공급실 A', status: 'STERILE', exp: 12, contents: [['방광경', 1], ['요관경', 1], ['바스켓 카테터', 2], ['가이드와이어', 2]] },
  { name: '응급 기도확보 세트', loc: '응급실', status: 'STERILE', exp: 15, contents: [['후두경', 2], ['기관내관 세트', 1], ['앰부백', 1], ['스타일렛', 2]] },
  { name: '소화기 내시경 세트', loc: '중앙공급실 B', status: 'DIRTY', exp: null, contents: [['생검 겸자', 3], ['폴립 스네어', 2], ['세척 튜브', 1]] },
  { name: '드레싱 세트', loc: '외래 처치실', status: 'STERILE', exp: 26, contents: [['포셉', 2], ['가위', 1], ['거즈', 10], ['트레이', 1]] },
  { name: '봉합 세트', loc: '응급실', status: 'STERILE', exp: 1, contents: [['니들 홀더', 1], ['포셉', 1], ['봉합 가위', 1], ['지혈 겸자', 2]] },
  { name: '기관삽관 세트', loc: '중환자실', status: 'IN_USE', exp: 19, contents: [['후두경 블레이드', 3], ['기관내관', 4], ['스타일렛', 2], ['커프 주사기', 1]] },
  { name: '관절경 세트', loc: '중앙공급실 A', status: 'EXPIRED', exp: -3, contents: [['관절경', 1], ['프로브', 2], ['셰이버', 1], ['캐뉼라', 3]] },
];

async function main() {
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });
  const by = user?.id ?? '00000000-0000-4000-a000-000000000001';

  for (const s of SETS) {
    const contents = s.contents.map(([name, qty]) => ({ name, qty }));
    const sterilizable = s.status === 'STERILE' || s.status === 'EXPIRED' || s.status === 'IN_USE';
    const data = {
      contents,
      status: s.status,
      location: s.loc,
      lastSterilizedAt: sterilizable ? day((s.exp ?? 30) - 30) : null,
      expiresAt: s.exp != null ? day(s.exp) : null,
    };
    const set = await prisma.instrumentSet.upsert({
      where: { name: s.name },
      update: data,
      create: { name: s.name, ...data },
    });
    // 이력 멱등: 기존 삭제 후 재생성
    await prisma.sterilizationLog.deleteMany({ where: { instrumentSetId: set.id } });
    const logs = [{ action: '반납', d: -32 }, { action: '세척', d: -31 }, { action: '멸균 완료', d: -30 }];
    if (s.status === 'IN_USE') logs.push({ action: '출고', d: -1 });
    for (const l of logs) {
      await prisma.sterilizationLog.create({ data: { instrumentSetId: set.id, action: l.action, performedBy: by, createdAt: day(l.d), notes: null } });
    }
  }
  const total = await prisma.instrumentSet.count();
  console.log('✅ CSSD 시드 완료: 기구 세트 ' + SETS.length + '종 (전체 ' + total + ')');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
