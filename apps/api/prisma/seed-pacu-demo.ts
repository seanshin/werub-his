import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
/**
 * PACU(회복실) 데모 시드 — P1~P3 신규 기능 시연용 (추가·멱등·비파괴)
 * 실행: 서버에서  npx ts-node --transpile-only prisma/seed-pacu-demo.ts
 * 수술(COMPLETED) + PACU 레코드를 함께 생성. 결정적 uuid upsert로 재실행 안전.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
const prisma = new PrismaClient();

const uid = (s: string) => {
  const h = createHash('md5').update(`pacu-demo:${s}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const minAgo = (m: number) => new Date(Date.now() - m * 60 * 1000);
const iso = (m: number) => minAgo(m).toISOString();

// 서비스 vitalFlags와 동일 규칙(표시 일관성)
function flagsOf(v: { spo2?: number; hr?: number; rr?: number; bp?: string; temp?: number }): string[] {
  const f: string[] = [];
  if (typeof v.spo2 === 'number' && v.spo2 > 0 && v.spo2 < 92) f.push('저산소(SpO2<92)');
  if (typeof v.hr === 'number' && v.hr > 0) { if (v.hr < 50) f.push('서맥(HR<50)'); else if (v.hr > 120) f.push('빈맥(HR>120)'); }
  if (typeof v.rr === 'number' && v.rr > 0) { if (v.rr < 8) f.push('호흡저하(RR<8)'); else if (v.rr > 24) f.push('빈호흡(RR>24)'); }
  const sbp = v.bp ? parseInt(v.bp.split('/')[0], 10) : NaN;
  if (Number.isFinite(sbp)) { if (sbp < 90) f.push('저혈압(SBP<90)'); else if (sbp > 180) f.push('고혈압(SBP>180)'); }
  if (typeof v.temp === 'number') { if (v.temp >= 38.5) f.push('발열(≥38.5)'); else if (v.temp < 35) f.push('저체온(<35)'); }
  return f;
}
const vital = (mAgo: number, v: { bp: string; hr: number; rr: number; spo2: number; temp: number; consciousness: string }) => {
  const flags = flagsOf(v);
  return { time: iso(mAgo), ...v, abnormal: flags.length > 0, flags };
};

async function main() {
  const surgeon = await prisma.user.findFirst({ where: { role: 'DOCTOR' }, orderBy: { createdAt: 'asc' } });
  const anesth = (await prisma.user.findFirst({ where: { role: 'DOCTOR' }, orderBy: { createdAt: 'desc' } })) ?? surgeon;
  const nurse = await prisma.user.findFirst({ where: { role: 'NURSE' }, orderBy: { createdAt: 'asc' } });
  const patients = await prisma.patient.findMany({ take: 6, orderBy: { createdAt: 'desc' } });
  if (!surgeon || !nurse || patients.length < 6) throw new Error('참조 데이터 부족(DOCTOR/NURSE/환자6)');

  const cases = [
    { key: 'A', proc: '복강경 담낭절제술', anes: '전신마취', scenario: 'active-recovering' },
    { key: 'B', proc: '무릎 관절경 수술', anes: '척추마취', scenario: 'active-home-ready' },
    { key: 'C', proc: '위 아전절제술', anes: '전신마취', scenario: 'active-complication' },
    { key: 'D', proc: '충수돌기절제술', anes: '전신마취', scenario: 'discharged-ward' },
    { key: 'E', proc: '백내장 수술', anes: '국소마취', scenario: 'discharged-home' },
    { key: 'F', proc: '탈장 교정술', anes: '전신마취', scenario: 'pending' },
  ] as const;

  let surg = 0, pacu = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const p = patients[i];
    const surgeryId = uid(`surg-${c.key}`);
    const pacuId = uid(`pacu-${c.key}`);

    // 수술(COMPLETED · 최근 종료)
    const endedMin = c.scenario === 'pending' ? 20 : 90 + i * 10;
    await prisma.surgery.upsert({
      where: { id: surgeryId },
      update: { status: 'COMPLETED', endedAt: minAgo(endedMin) },
      create: {
        id: surgeryId, patientId: p.id, surgeonId: surgeon.id, anesthetistId: anesth?.id ?? null,
        scheduledAt: minAgo(endedMin + 180), startedAt: minAgo(endedMin + 120), endedAt: minAgo(endedMin),
        procedureName: c.proc, status: 'COMPLETED', anesthesiaType: c.anes,
      },
    });
    surg++;
    if (c.scenario === 'pending') continue; // 입실 대기(pending-admissions에 노출)

    // 🔴 종전 결함: 회복실 입실 시각을 수술과 **무관한 리터럴**로 적어, discharged-home(i=4) 은
    //    수술 종료 130분 전 ↔ 입실 150분 전 — **수술이 끝나기 20분 전에 회복실에 입실**한 기록이었다.
    //    discharged-ward(i=3) 는 이송시간 0분. 입실은 수술 종료 **이후**다 — 종료 시각에서 파생시킨다.
    const arrivalMin = endedMin - 10; // 수술 종료 10분 후 회복실 입실

    // 시나리오별 PACU 레코드
    const base = {
      surgeryId, patientId: p.id, nurseId: nurse.id, oxygenTherapy: 'O2 3L N/C',
      arrivalHandoff: { situation: `${c.proc} 후 회복실 입실`, background: `${c.anes}·수술 무리 없이 종료`, assessment: '활력 안정, 의식 회복 중', recommendation: 'Aldrete 모니터·통증 조절', notes: 'IV 20G 우측 전완·EKG 부착·NKDA' } as Prisma.InputJsonValue,
    };

    let data: Prisma.PacuRecordUncheckedCreateInput;
    if (c.scenario === 'active-recovering') {
      data = {
        id: pacuId, ...base, arrivalTime: minAgo(arrivalMin),
        // 🔴 (2026-09-30) Aldrete 통증 항목은 0=극심·2=경미 — 종전 `pain: 0`(극심)이 NRS 3 과 한 기록에서 모순이었다(NRS 3 → 1 중등도)
        aldretScore: 8, aldreteDetail: { activity: 1, respiration: 1, circulation: 2, consciousness: 1, spo2: 2, pain: 1 } as Prisma.InputJsonValue,
        painScore: 3, ponvScore: 1, ponvManagement: '온단세트론 4mg IV',
        vitalSigns: [vital(40, { bp: '128/78', hr: 88, rr: 16, spo2: 96, temp: 36.4, consciousness: '기면' }), vital(25, { bp: '124/76', hr: 82, rr: 15, spo2: 97, temp: 36.6, consciousness: '명료' }), vital(10, { bp: '122/74', hr: 78, rr: 14, spo2: 98, temp: 36.7, consciousness: '명료' })] as Prisma.InputJsonValue,
        painAssessments: [{ score: 6, scale: 'NRS', intervention: '페치딘 25mg IV', time: iso(40) }, { score: 4, scale: 'NRS', time: iso(25) }, { score: 3, scale: 'NRS', time: iso(10) }] as Prisma.InputJsonValue,
        interventions: [] as Prisma.InputJsonValue,
      };
    } else if (c.scenario === 'active-home-ready') {
      data = {
        id: pacuId, ...base, arrivalTime: minAgo(arrivalMin), oxygenTherapy: 'Room air',
        // NRS 2(경미) → Aldrete 통증 2 · 6항목 만점 12
        aldretScore: 12, aldreteDetail: { activity: 2, respiration: 2, circulation: 2, consciousness: 2, spo2: 2, pain: 2 } as Prisma.InputJsonValue,
        painScore: 2, ponvScore: 0,
        padssScore: 10, padssDetail: { vitalSigns: 2, ambulation: 2, nausea: 2, pain: 2, bleeding: 2 } as Prisma.InputJsonValue,
        vitalSigns: [vital(50, { bp: '118/72', hr: 74, rr: 14, spo2: 99, temp: 36.5, consciousness: '명료' }), vital(20, { bp: '120/74', hr: 72, rr: 13, spo2: 99, temp: 36.6, consciousness: '명료' })] as Prisma.InputJsonValue,
        painAssessments: [{ score: 3, scale: 'NRS', time: iso(50) }, { score: 2, scale: 'NRS', time: iso(20) }] as Prisma.InputJsonValue,
        interventions: [] as Prisma.InputJsonValue,
      };
    } else if (c.scenario === 'active-complication') {
      data = {
        id: pacuId, ...base, arrivalTime: minAgo(arrivalMin), oxygenTherapy: 'O2 5L Mask',
        aldretScore: 6, aldreteDetail: { activity: 1, respiration: 1, circulation: 1, consciousness: 1, spo2: 1, pain: 1 } as Prisma.InputJsonValue,
        painScore: 7, ponvScore: 2, ponvManagement: '메토클로프라미드 10mg IV',
        vitalSigns: [vital(25, { bp: '88/54', hr: 118, rr: 22, spo2: 90, temp: 35.6, consciousness: '기면' }), vital(12, { bp: '96/60', hr: 104, rr: 20, spo2: 93, temp: 36.0, consciousness: '기면' })] as Prisma.InputJsonValue,
        complications: [{ type: 'BLEEDING', severity: 'SEVERE', intervention: '수술부위 압박·외과 노티·수액 부하', note: '드레인 혈성 배액 증가', time: iso(24) }, { type: 'SHIVERING', severity: 'MODERATE', intervention: '가온 담요·페치딘', time: iso(18) }] as Prisma.InputJsonValue,
        painAssessments: [{ score: 8, scale: 'NRS', intervention: '모르핀 2mg IV', time: iso(22) }, { score: 7, scale: 'NRS', time: iso(8) }] as Prisma.InputJsonValue,
        interventions: [] as Prisma.InputJsonValue,
      };
    } else if (c.scenario === 'discharged-ward') {
      data = {
        id: pacuId, ...base, arrivalTime: minAgo(arrivalMin),
        // NRS 2(경미) → Aldrete 통증 2(종전 0=극심과 모순)
        aldretScore: 11, aldreteDetail: { activity: 2, respiration: 2, circulation: 1, consciousness: 2, spo2: 2, pain: 2 } as Prisma.InputJsonValue,
        painScore: 2, ponvScore: 0,
        dischargeTime: minAgo(35), disposition: 'WARD', dischargedById: anesth?.id ?? surgeon.id,
        dischargeHandoff: { situation: '회복 완료 병동 이송', background: `${c.proc} 후`, assessment: 'Aldrete 9·통증 조절됨', recommendation: 'q4h V/S·통증 시 PRN', notes: '수액 지속·IV 유지' } as Prisma.InputJsonValue,
        vitalSigns: [vital(100, { bp: '126/78', hr: 80, rr: 15, spo2: 97, temp: 36.5, consciousness: '명료' })] as Prisma.InputJsonValue,
        interventions: [] as Prisma.InputJsonValue,
      };
    } else { // discharged-home
      data = {
        id: pacuId, ...base, arrivalTime: minAgo(arrivalMin), oxygenTherapy: 'Room air',
        aldretScore: 10, painScore: 1, ponvScore: 0,
        padssScore: 9, padssDetail: { vitalSigns: 2, ambulation: 2, nausea: 2, pain: 1, bleeding: 2 } as Prisma.InputJsonValue,
        dischargeTime: minAgo(40), disposition: 'HOME', dischargedById: anesth?.id ?? surgeon.id,
        dischargeHandoff: { situation: '귀가', background: `${c.proc}(국소마취)`, assessment: 'PADSS 9·보행 안정', recommendation: '경구 진통제·익일 외래', notes: '보호자 동반 귀가' } as Prisma.InputJsonValue,
        vitalSigns: [vital(120, { bp: '122/76', hr: 72, rr: 14, spo2: 99, temp: 36.6, consciousness: '명료' })] as Prisma.InputJsonValue,
        interventions: [] as Prisma.InputJsonValue,
      };
    }

    await prisma.pacuRecord.upsert({ where: { id: pacuId }, update: data, create: data });
    pacu++;
  }

  const active = await prisma.pacuRecord.count({ where: { dischargeTime: null } });
  console.log(`PACU 데모 시드 — 수술 ${surg} / PACU 레코드 ${pacu}(현재 재실 ${active}) · pending 1건`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
