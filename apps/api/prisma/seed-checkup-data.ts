import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * 검진센터 테스트 데이터 시드
 * 실행: npx ts-node prisma/seed-checkup-data.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🏥 검진센터 테스트 데이터 시드 시작...');

  // ── 기본 데이터 조회 ──
  const patients = await prisma.patient.findMany({ take: 30, orderBy: { createdAt: 'asc' } });
  const programs = await prisma.checkupProgram.findMany({ where: { isActive: true } });
  const stations = await prisma.checkupStation.findMany({ orderBy: { sortOrder: 'asc' } });
  const questionnaire = await prisma.checkupQuestionnaire.findFirst({ where: { isActive: true } });
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const doctors = await prisma.user.findMany({ where: { role: 'DOCTOR' }, take: 5 });

  if (patients.length < 10 || programs.length < 3) {
    console.log('환자/프로그램 데이터 부족. 기본 시드를 먼저 실행하세요.');
    return;
  }

  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const twoDaysAgo = new Date(today); twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const lastWeek = new Date(today); lastWeek.setDate(lastWeek.getDate() - 7);
  const lastMonth = new Date(today); lastMonth.setMonth(lastMonth.getMonth() - 1);
  const threeMonthsAgo = new Date(today); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const sixMonthsAgo = new Date(today); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(today); nextWeek.setDate(nextWeek.getDate() + 7);

  const findProg = (code: string) => programs.find(p => p.code === code) ?? programs[0];
  const rand = (arr: any[]) => arr[Math.floor(Math.random() * arr.length)];
  const doctor = () => doctors.length > 0 ? rand(doctors) : admin;

  // ── 기존 테스트 데이터 정리 (visit만, 프로그램/스테이션은 유지) ──
  const existingCount = await prisma.checkupVisit.count();
  console.log(`  기존 검진 방문: ${existingCount}건`);

  // ══════════════════════════════════════════════
  // 1. 과거 완료 검진 — 이력 + 결과 비교용 (6개월 전, 3개월 전)
  // ══════════════════════════════════════════════
  const completedVisits: string[] = [];

  for (let round = 0; round < 2; round++) {
    const date = round === 0 ? sixMonthsAgo : threeMonthsAgo;
    const roundLabel = round === 0 ? '6개월 전' : '3개월 전';

    for (let i = 0; i < 5; i++) {
      const patient = patients[i];
      const prog = i < 2 ? findProg('CK-PREMIUM') : i < 4 ? findProg('CK-BASIC') : findProg('CK-PLUS');
      const doc = doctor();

      const visit = await prisma.checkupVisit.create({
        data: {
          patientId: patient.id,
          programId: prog.id,
          scheduledDate: date,
          status: 'DELIVERED',
          totalPrice: prog.price,
          checkedInAt: date,
          completedAt: date,
          barcodeNumber: `CK${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}-${String(1000 + round * 100 + i).padStart(4,'0')}`,
        },
      });
      completedVisits.push(visit.id);

      // 검사 결과 항목 (10~15개)
      const labItems = [
        { category: 'LAB', testName: '혈당 (공복)', value: String(85 + Math.floor(Math.random() * 50)), unit: 'mg/dL', referenceRange: '70-110' },
        { category: 'LAB', testName: '총 콜레스테롤', value: String(170 + Math.floor(Math.random() * 80)), unit: 'mg/dL', referenceRange: '~200' },
        { category: 'LAB', testName: 'HDL 콜레스테롤', value: String(40 + Math.floor(Math.random() * 40)), unit: 'mg/dL', referenceRange: '40-60' },
        { category: 'LAB', testName: 'LDL 콜레스테롤', value: String(80 + Math.floor(Math.random() * 80)), unit: 'mg/dL', referenceRange: '~130' },
        { category: 'LAB', testName: '중성지방', value: String(60 + Math.floor(Math.random() * 150)), unit: 'mg/dL', referenceRange: '~150' },
        { category: 'LAB', testName: 'AST (GOT)', value: String(15 + Math.floor(Math.random() * 30)), unit: 'U/L', referenceRange: '~40' },
        { category: 'LAB', testName: 'ALT (GPT)', value: String(12 + Math.floor(Math.random() * 40)), unit: 'U/L', referenceRange: '~35' },
        { category: 'LAB', testName: 'γ-GTP', value: String(10 + Math.floor(Math.random() * 60)), unit: 'U/L', referenceRange: '~50' },
        { category: 'LAB', testName: '크레아티닌', value: (0.6 + Math.random() * 0.8).toFixed(1), unit: 'mg/dL', referenceRange: '0.6-1.2' },
        { category: 'LAB', testName: 'HbA1c', value: (4.8 + Math.random() * 2.5).toFixed(1), unit: '%', referenceRange: '~5.7' },
        { category: 'PHYSICAL', testName: '혈압 (수축기)', value: String(110 + Math.floor(Math.random() * 40)), unit: 'mmHg', referenceRange: '~140' },
        { category: 'IMAGING', testName: '흉부 X-ray', value: Math.random() > 0.8 ? '경미한 이상' : '정상', unit: '', referenceRange: '' },
        { category: 'DIAGNOSTIC', testName: '심전도', value: Math.random() > 0.9 ? 'ST 변화' : 'Normal sinus rhythm', unit: '', referenceRange: '' },
      ];

      for (const item of labItems) {
        const numVal = parseFloat(item.value);
        const ref = item.referenceRange;
        let finding: 'NORMAL' | 'ABNORMAL' | 'CRITICAL' = 'NORMAL';
        if (ref && !isNaN(numVal)) {
          const rangeMatch = ref.match(/(\d+\.?\d*)[-~](\d+\.?\d*)/);
          const upperMatch = ref.match(/~(\d+\.?\d*)/);
          if (rangeMatch) {
            const low = parseFloat(rangeMatch[1]), high = parseFloat(rangeMatch[2]);
            if (numVal < low || numVal > high) finding = (numVal - high) / high > 0.3 || (low - numVal) / low > 0.3 ? 'CRITICAL' : 'ABNORMAL';
          } else if (upperMatch) {
            const upper = parseFloat(upperMatch[1]);
            if (numVal > upper) finding = (numVal - upper) / upper > 0.3 ? 'CRITICAL' : 'ABNORMAL';
          }
        }
        if (item.value.includes('이상') || item.value.includes('ST')) finding = 'ABNORMAL';

        await prisma.checkupResultItem.create({
          data: { visitId: visit.id, ...item, finding, completedAt: date },
        });
      }

      // 종합소견
      const sections = [
        { area: '혈액검사', grade: 'A', findings: '정상' },
        { area: '간기능', grade: Math.random() > 0.7 ? 'B' : 'A', findings: Math.random() > 0.7 ? 'γ-GTP 경미 상승' : '정상' },
        { area: '지질대사', grade: Math.random() > 0.5 ? 'B' : 'A', findings: Math.random() > 0.5 ? 'LDL 경계' : '정상' },
        { area: '당뇨검사', grade: Math.random() > 0.8 ? 'C1' : 'A', findings: Math.random() > 0.8 ? 'HbA1c 상승' : '정상' },
        { area: '흉부영상', grade: 'A', findings: '정상' },
        { area: '심전도', grade: 'A', findings: '정상 동율동' },
      ];
      const overallGrade = sections.some(s => s.grade === 'C1') ? 'C1' : sections.some(s => s.grade === 'B') ? 'B' : 'A';

      await prisma.checkupSummary.create({
        data: {
          visitId: visit.id,
          overallGrade,
          sections,
          doctorOpinion: overallGrade === 'A'
            ? '전반적으로 양호한 건강 상태입니다. 규칙적인 운동과 균형 잡힌 식이를 유지하세요.'
            : overallGrade === 'B'
            ? '일부 항목에서 경미한 이상이 발견되었습니다. 생활습관 개선 후 6개월 후 재검을 권합니다.'
            : '일부 항목에서 관찰이 필요한 소견이 발견되었습니다. 3개월 후 해당 항목 재검을 권합니다.',
          recommendations: ['규칙적인 운동 (주 3회 이상)', '저염식·저지방식 식이', overallGrade !== 'A' ? '6개월 후 추적 검진' : '연 1회 정기 검진'].filter(Boolean),
          reviewedBy: doc!.id,
          // 🔴 검진 소견도 그 검진일의 기록이다 — createdAt 이 없으면 삽입 시각이 박힌다
          signedAt: date, createdAt: date,
        },
      });
    }
    console.log(`  [${roundLabel}] 완료 검진 5건 + 결과 + 소견`);
  }

  // ══════════════════════════════════════════════
  // 2. 오늘 검진 — 다양한 상태 (20건)
  // ══════════════════════════════════════════════
  const todayStatuses = [
    'RESERVED', 'RESERVED', 'RESERVED',
    'CHECKED_IN', 'CHECKED_IN', 'CHECKED_IN', 'CHECKED_IN',
    'IN_PROGRESS', 'IN_PROGRESS', 'IN_PROGRESS', 'IN_PROGRESS', 'IN_PROGRESS',
    'EXAM_COMPLETE', 'EXAM_COMPLETE', 'PARTIAL_COMPLETE',
    'REVIEW', 'REVIEW',
    'COMPLETED', 'COMPLETED',
    'DELIVERED',
  ];

  for (let i = 0; i < Math.min(20, patients.length); i++) {
    const patient = patients[i % patients.length];
    const status = todayStatuses[i];
    const prog = rand(programs.slice(0, 5));
    const checkInTime = status !== 'RESERVED' ? new Date(today.getFullYear(), today.getMonth(), today.getDate(), 7 + Math.floor(i / 3), (i * 7) % 60) : null;
    const barcode = status !== 'RESERVED' ? `CK${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}-${String(2000 + i).padStart(4,'0')}` : null;

    const visit = await prisma.checkupVisit.create({
      data: {
        patientId: patient.id,
        programId: prog.id,
        scheduledDate: today,
        status,
        totalPrice: prog.price,
        checkedInAt: checkInTime,
        completedAt: ['COMPLETED', 'DELIVERED'].includes(status) ? new Date() : null,
        barcodeNumber: barcode,
      },
    });

    // 접수 이상 → ResultItem + StationLog 생성
    if (status !== 'RESERVED') {
      const programItems = (prog.items as any[]) ?? [];
      for (const item of programItems) {
        if (item.category === 'CONSULT') continue;
        const isCompleted = ['EXAM_COMPLETE', 'PARTIAL_COMPLETE', 'REVIEW', 'COMPLETED', 'DELIVERED'].includes(status)
          || (status === 'IN_PROGRESS' && Math.random() > 0.4);
        const finding = !isCompleted ? 'PENDING'
          : status === 'PARTIAL_COMPLETE' && Math.random() > 0.8 ? 'NOT_APPLICABLE'
          : Math.random() > 0.75 ? 'ABNORMAL' : 'NORMAL';

        await prisma.checkupResultItem.create({
          data: {
            visitId: visit.id,
            category: item.category,
            testName: item.name,
            finding,
            value: finding === 'PENDING' ? null : finding === 'NOT_APPLICABLE' ? null : '정상',
            completedAt: finding !== 'PENDING' ? new Date() : null,
          },
        });
      }

      // 스테이션 로그 (접수~진행 상태)
      const relevantStations = stations.filter(s => s.stationId !== 'ck-reception' && s.stationId !== 'ck-consult');
      const stationCount = status === 'CHECKED_IN' ? 1
        : status === 'IN_PROGRESS' ? 2 + Math.floor(Math.random() * 3)
        : relevantStations.length;

      for (let si = 0; si < Math.min(stationCount, relevantStations.length); si++) {
        const st = relevantStations[si];
        const arrived = new Date(checkInTime!.getTime() + si * 8 * 60000);
        const started = si < stationCount - 1 || status !== 'CHECKED_IN'
          ? new Date(arrived.getTime() + 2 * 60000) : null;
        const completed = si < stationCount - (status === 'IN_PROGRESS' ? 1 : 0)
          ? new Date(arrived.getTime() + st.avgMinutes * 60000) : null;

        await prisma.checkupStationLog.upsert({
          where: { visitId_stationId: { visitId: visit.id, stationId: st.stationId } },
          update: {},
          create: {
            visitId: visit.id,
            stationId: st.stationId,
            arrivedAt: arrived,
            startedAt: started,
            completedAt: completed,
            finding: completed ? (Math.random() > 0.8 ? 'ABNORMAL' : 'NORMAL') : 'PENDING',
          },
        });
      }

      // 완료된 방문 → 소견 생성
      if (['COMPLETED', 'DELIVERED'].includes(status)) {
        const doc = doctor();
        await prisma.checkupSummary.upsert({
          where: { visitId: visit.id },
          update: {},
          create: {
            visitId: visit.id,
            overallGrade: Math.random() > 0.6 ? 'A' : 'B',
            sections: [
              { area: '혈액검사', grade: 'A', findings: '정상' },
              { area: '간기능', grade: Math.random() > 0.5 ? 'B' : 'A', findings: '정상 범위' },
            ],
            doctorOpinion: '전반적으로 양호합니다. 규칙적인 운동을 권합니다.',
            recommendations: ['규칙적 운동', '정기 검진'],
            reviewedBy: doc!.id,
            signedAt: new Date(),
          },
        });
      }
    }
  }
  console.log(`  [오늘] 검진 방문 20건 (RESERVED 3, CHECKED_IN 4, IN_PROGRESS 5, EXAM/PARTIAL 3, REVIEW 2, COMPLETED 2, DELIVERED 1)`);

  // ══════════════════════════════════════════════
  // 3. 내일/다음주 예약 (5건)
  // ══════════════════════════════════════════════
  for (let i = 0; i < 5; i++) {
    const patient = patients[20 + (i % (patients.length - 20))];
    const date = i < 3 ? tomorrow : nextWeek;
    await prisma.checkupVisit.create({
      data: {
        patientId: patient.id,
        programId: rand(programs).id,
        scheduledDate: date,
        status: 'RESERVED',
        totalPrice: rand(programs).price,
      },
    });
  }
  console.log('  [미래] 예약 5건 (내일 3, 다음주 2)');

  // ══════════════════════════════════════════════
  // 4. 취소/미방문 (4건)
  // ══════════════════════════════════════════════
  for (let i = 0; i < 2; i++) {
    await prisma.checkupVisit.create({
      data: {
        patientId: patients[25 + i].id,
        programId: rand(programs).id,
        scheduledDate: lastWeek,
        status: 'CANCELLED',
        totalPrice: rand(programs).price,
        completedAt: lastWeek,
      },
    });
  }
  for (let i = 0; i < 2; i++) {
    await prisma.checkupVisit.create({
      data: {
        patientId: patients[27 + i].id,
        programId: rand(programs).id,
        scheduledDate: twoDaysAgo,
        status: 'NO_SHOW',
        totalPrice: rand(programs).price,
      },
    });
  }
  console.log('  [과거] 취소 2건, 미방문 2건');

  // ══════════════════════════════════════════════
  // 5. 단체계약 + 수검자 (1건)
  // ══════════════════════════════════════════════
  const existingContract = await prisma.checkupContract.count();
  if (existingContract < 2) {
    const prog = findProg('CK-BASIC');
    const contract = await prisma.checkupContract.create({
      data: {
        companyName: '(주)테크스타',
        contactPerson: '박인사',
        contactPhone: '02-555-1234',
        programId: prog.id,
        headcount: 15,
        discountRate: 12,
        contractDate: lastMonth,
        expiryDate: new Date(today.getFullYear(), today.getMonth() + 3, today.getDate()),
      },
    });

    for (let i = 0; i < 8; i++) {
      const patient = patients[i + 5];
      const schedDate = i < 5 ? lastWeek : tomorrow;
      await prisma.checkupVisit.create({
        data: {
          patientId: patient.id,
          programId: prog.id,
          scheduledDate: schedDate,
          status: i < 3 ? 'DELIVERED' : i < 5 ? 'COMPLETED' : 'RESERVED',
          totalPrice: Math.round(prog.price * 0.88),
          contractId: contract.id,
          checkedInAt: i < 5 ? schedDate : null,
          completedAt: i < 5 ? schedDate : null,
        },
      });
    }
    console.log('  [단체] (주)테크스타 15명 계약, 수검자 8명');
  }

  // ══════════════════════════════════════════════
  // 6. 문진 응답 (3건)
  // ══════════════════════════════════════════════
  if (questionnaire) {
    const reservedVisits = await prisma.checkupVisit.findMany({
      where: { status: { in: ['RESERVED', 'CHECKED_IN'] }, questionnaireResponse: null },
      take: 3,
    });
    for (const v of reservedVisits) {
      await prisma.checkupQuestionnaireResponse.upsert({
        where: { visitId: v.id },
        update: {},
        create: {
          questionnaireId: questionnaire.id,
          visitId: v.id,
          patientId: v.patientId,
          answers: {
            q1: rand(['비흡연', '과거흡연 (금연중)', '현재흡연']),
            q2: rand(['전혀 안함', '월 1-2회', '주 1-2회']),
            q3: rand(['거의 안함', '1-2회', '3-4회']),
            q4: Math.random() > 0.5 ? ['고혈압', '고지혈증'] : [],
            q5: Math.random() > 0.5,
            q6: Math.random() > 0.6 ? ['당뇨병', '심장질환'] : [],
            q7: Math.random() > 0.4 ? ['피로감', '두통'] : ['없음'],
          },
          completedAt: new Date(),
        },
      });
    }
    console.log(`  [문진] 응답 ${reservedVisits.length}건`);
  }

  // ══════════════════════════════════════════════
  // 7. 추적 관리 (5건)
  // ══════════════════════════════════════════════
  const deliveredVisits = await prisma.checkupVisit.findMany({
    where: { status: 'DELIVERED' },
    take: 5,
  });
  for (let i = 0; i < Math.min(5, deliveredVisits.length); i++) {
    const v = deliveredVisits[i];
    const types = ['RECHECK', 'OUTPATIENT', 'SCREENING'];
    const descs = [
      '6개월 후 지질검사 재검',
      '소화기내과 외래 의뢰 (위용종)',
      '1년 후 정기 건강검진',
      '3개월 후 HbA1c 추적검사',
      '이비인후과 외래 의뢰 (청력 저하)',
    ];
    const dueDate = new Date(today);
    dueDate.setMonth(dueDate.getMonth() + (i < 2 ? 1 : 3 + i));

    await prisma.checkupFollowUp.create({
      data: {
        visitId: v.id,
        patientId: v.patientId,
        followUpType: types[i % 3],
        description: descs[i],
        dueDate,
        completedAt: i === 0 ? new Date() : null,
      },
    });
  }
  console.log('  [추적] 관리 5건 (완료 1, 대기 4)');

  // ══════════════════════════════════════════════
  // 8. 외래 의뢰 (3건)
  // ══════════════════════════════════════════════
  for (let i = 0; i < Math.min(3, deliveredVisits.length); i++) {
    await prisma.checkupReferral.create({
      data: {
        visitId: deliveredVisits[i].id,
        toDepartment: ['소화기내과', '내분비내과', '순환기내과'][i],
        reason: ['위내시경 소견 — 위용종 발견', 'HbA1c 6.8% — 당뇨 정밀검사', '혈압 150/95 — 고혈압 평가'][i],
        urgency: i === 0 ? 'URGENT' : 'ROUTINE',
        status: i === 0 ? 'APPOINTMENT_MADE' : 'CREATED',
      },
    });
  }
  console.log('  [의뢰] 외래 의뢰 3건');

  // ── 최종 집계 ──
  const finalCount = await prisma.checkupVisit.count();
  const resultCount = await prisma.checkupResultItem.count();
  const summaryCount = await prisma.checkupSummary.count();
  const logCount = await prisma.checkupStationLog.count();
  const followUpCount = await prisma.checkupFollowUp.count();
  const referralCount = await prisma.checkupReferral.count();
  const questRespCount = await prisma.checkupQuestionnaireResponse.count();

  console.log('\n✅ 검진센터 테스트 데이터 시드 완료:');
  console.log(`  방문: ${finalCount}건`);
  console.log(`  결과 항목: ${resultCount}건`);
  console.log(`  종합소견: ${summaryCount}건`);
  console.log(`  스테이션 로그: ${logCount}건`);
  console.log(`  추적 관리: ${followUpCount}건`);
  console.log(`  외래 의뢰: ${referralCount}건`);
  console.log(`  문진 응답: ${questRespCount}건`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
