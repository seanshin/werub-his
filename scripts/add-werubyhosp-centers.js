const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const centers = [
  {
    slug: 'cell-therapy', title: '세포치료 센터',
    content: '세포치료(Cell therapy)를 통해 난치성 질환을 치료하고 희망을 드리는 돌봄을 제공합니다. 손상된 조직과 세포를 재생하며, 개인별 맞춤치료로 부작용을 최소화합니다.\n\n■ 주요 진료 분야\n- 면역세포 치료\n- 줄기세포 치료\n- NK세포 치료\n- 자가 면역질환 치료\n- 재생의학',
    tags: ['세포치료', '재생의학', '면역세포'],
  },
  {
    slug: 'genomic-analysis', title: '유전자분석 센터',
    content: '유전물질과 유전자 정보를 검사하여 질병의 조기 예방과 치료를 선제적으로 실시합니다.\n\n■ 주요 검사\n- 유전성 암 스크리닝\n- 약물유전체 검사\n- 희귀질환 유전자 진단\n- DTC 유전자 검사\n- 차세대 염기서열 분석(NGS)',
    tags: ['유전자', 'NGS', '정밀의학'],
  },
  {
    slug: 'clinical-lab-center', title: '진단검사의학 센터',
    content: '입원 및 외래환자를 위해 정확하고 신속한 검사 서비스를 제공합니다.\n\n■ 주요 검사\n- 일반화학검사\n- 혈액검사\n- 미생물검사\n- 면역혈청검사\n- 분자유전검사\n- 요화학검사',
    tags: ['진단검사', '혈액검사', '미생물'],
  },
  {
    slug: 'radiology-center', title: '영상의학 센터',
    content: 'X선, 초음파, CT, MRI 등 첨단 장비를 이용하여 환자의 질환을 정확하게 진단합니다.\n\n■ 보유 장비\n- 64채널 CT\n- 1.5T/3.0T MRI\n- 디지털 X-ray\n- 초음파 진단기\n- 유방촬영장치(Mammography)',
    tags: ['영상의학', 'CT', 'MRI'],
  },
  {
    slug: 'endoscopy', title: '내시경 센터',
    content: '소화기관 질병 진단 및 치료, 암 조기 발견, 내시경적 치료를 전문으로 합니다.\n\n■ 주요 시술\n- 위내시경/대장내시경\n- 내시경적 용종절제술\n- 내시경적 점막하 박리술(ESD)\n- ERCP\n- 캡슐내시경',
    tags: ['내시경', '위장관', '용종'],
  },
  {
    slug: 'diabetes-endocrine', title: '당뇨/내분비 센터',
    content: '호르몬 분비와 대사장애 관련 질환을 전문적으로 치료합니다.\n\n■ 주요 진료\n- 당뇨병 (1형/2형/임신성)\n- 갑상선 질환\n- 골다공증\n- 부신/뇌하수체 질환\n- 비만 대사증후군\n- 연속혈당측정(CGM) 관리',
    tags: ['당뇨', '내분비', '갑상선'],
  },
  {
    slug: 'neuroscience', title: '뇌과학 센터',
    content: '뇌혈관 질환 진단 및 치료, 중증 신경재활을 제공하는 토탈센터입니다.\n\n■ 주요 진료\n- 뇌졸중 (급성기+재활)\n- 뇌종양\n- 파킨슨병/치매\n- 뇌전증(간질)\n- 두통/어지럼증\n- 신경재활',
    tags: ['뇌과학', '뇌졸중', '신경재활'],
  },
  {
    slug: 'anti-aging', title: '항노화 센터',
    content: '노화에 따른 현상을 교정하여 건강한 노년을 맞이하도록 지원하는 항노화 의료 서비스를 제공합니다.\n\n■ 주요 프로그램\n- 줄기세포 항노화 치료\n- 호르몬 대체요법\n- 비타민/영양 수액 치료\n- 피부 재생 치료\n- 체력/근력 증진 프로그램',
    tags: ['항노화', '안티에이징', '재생'],
  },
  {
    slug: 'health-promotion', title: '건강검진(증진) 센터',
    content: '빠르고 정확한 검진시스템으로 진단에서 치료까지의 원스톱 개인 맞춤 의료서비스를 제공합니다.\n\n■ 검진 프로그램\n- 기본 건강검진\n- 정밀 종합검진\n- 암 특화 검진\n- VIP 프리미엄 검진\n- 기업 단체 검진\n- 국가 건강검진',
    tags: ['건강검진', '종합검진', '암검진'],
  },
  {
    slug: 'international-care', title: '국제진료 센터',
    content: '외국인 환자와 가족들이 최상의 치료를 받을 수 있도록 다국어 지원과 원스톱 서비스를 제공합니다.\n\n■ 지원 서비스\n- 다국어 통역 (영어/중국어/러시아어/몽골어/베트남어/일본어)\n- 비자 발급 지원\n- 공항 픽업 및 숙소 안내\n- 원격 진료 상담\n- 의료 관광 패키지',
    tags: ['국제진료', '외국인환자', '의료관광'],
  },
];

async function main() {
  const admin = await p.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) { console.error('ADMIN 사용자 없음'); return; }
  let created = 0;
  for (const c of centers) {
    const exists = await p.hospitalInfoContent.findFirst({ where: { slug: c.slug } });
    if (exists) {
      console.log(`  ⏭ ${c.title} (이미 존재)`);
      continue;
    }
    await p.hospitalInfoContent.create({
      data: {
        category: 'CENTER',
        slug: c.slug,
        title: c.title,
        content: c.content,
        tags: c.tags,
        isPinned: false,
        creator: { connect: { id: admin.id } },
        updater: { connect: { id: admin.id } },
      },
    });
    created++;
    console.log(`  ✅ ${c.title}`);
  }
  console.log(`\n총 ${created}개 추가`);
  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
