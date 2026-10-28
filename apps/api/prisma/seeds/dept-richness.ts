import { assertSeedAllowed } from '../seed-mode-guard';
/**
 * 과별 환자 데이터 리치니스 시드 (추가·멱등) — 검사모델 8개 과 × 100명 + 검사기록.
 * 메인 seed 비파괴. 결정적 UUID(uid)·createMany skipDuplicates 로 재실행 안전.
 * 실행: npx ts-node --transpile-only prisma/seeds/dept-richness.ts
 */
import { PrismaClient, Gender, InsuranceType } from '@prisma/client';
import { IM_SUBSPECIALTY_KEYS } from '@hospital-run/shared';
// BMI 는 키·몸무게에서 나온다 — 정본 하나(`vitals-evaluate.calcBmi`, NUMERIC_POLICIES 'bmi' 자릿수)
import { calcBmi } from '../../src/modules/vitals/vitals-evaluate';

const prisma = new PrismaClient();

// ── 결정적 UUID (메인 seed makeUuid 동일 규약) ──
function makeUuid(prefix: string, index: number): string {
  const hex = index.toString(16).padStart(4, '0');
  const suffix = (prefix + hex).padStart(12, '0').slice(0, 12);
  return `00000000-0000-4000-a000-${suffix}`;
}
/**
 * 소아 성장 참조 중앙값(WHO/질병관리청 성장도표 근사·남녀 평균). 개월수 사이는 선형 보간한다.
 * 🔴 시드는 참고용 근사다 — 임상 백분위 산출에 쓰지 말 것(LMS 모수가 아니다).
 *    다만 **같은 행 안에서 키·몸무게·BMI·백분위가 서로 맞기**는 해야 한다.
 */
const PEDI_REF_MONTHS = [0, 6, 12, 24, 36, 60, 84, 120, 144, 168, 180];
const PEDI_REF_WEIGHT = [3.3, 7.9, 9.6, 12.2, 14.3, 18.3, 22.9, 32.0, 41.0, 52.0, 58.0];
const PEDI_REF_HEIGHT = [50.0, 67.0, 75.5, 87.0, 95.0, 110.0, 122.0, 140.0, 152.0, 165.0, 170.0];
const PEDI_REF_HEAD = [34.5, 43.5, 46.0, 48.0, 49.5, 51.0, 51.5, 52.5, 53.0, 54.0, 54.5];

function interpRef(table: number[], months: number): number {
  const m = Math.max(0, Math.min(months, PEDI_REF_MONTHS[PEDI_REF_MONTHS.length - 1]));
  for (let i = 1; i < PEDI_REF_MONTHS.length; i++) {
    if (m <= PEDI_REF_MONTHS[i]) {
      const lo = PEDI_REF_MONTHS[i - 1], hi = PEDI_REF_MONTHS[i];
      const t = hi === lo ? 0 : (m - lo) / (hi - lo);
      return table[i - 1] + (table[i] - table[i - 1]) * t;
    }
  }
  return table[table.length - 1];
}
/** 백분위 → 중앙값 대비 배수(근사). 15~90p 를 ±약 12%(체중)·±4%(신장) 로 편다. */
const pctFactor = (pct: number, spread: number) => 1 + ((pct - 50) / 50) * spread;
const pediWeightKg = (months: number, pct: number) =>
  Math.round(interpRef(PEDI_REF_WEIGHT, months) * pctFactor(pct, 0.12) * 10) / 10;
const pediHeightCm = (months: number, pct: number) =>
  Math.round(interpRef(PEDI_REF_HEIGHT, months) * pctFactor(pct, 0.04) * 10) / 10;
const pediHeadCircCm = (months: number) => Math.round(interpRef(PEDI_REF_HEAD, months) * 10) / 10;

const PAT = '000000d0';      // 환자 네임스페이스(메인과 동일·인덱스 1001+ 비충돌)
const USR = '000000a0';
const uid = (p: string, i: number) => makeUuid(p, i);

// ── 결정적 의사 ID(메인 seed 배정과 동일) ──
const ADMIN = uid(USR, 1);
const DOC = {
  im: uid(USR, 2), ortho: uid(USR, 8), neuro: uid(USR, 26), obgyn: uid(USR, 7),
  pedi: uid(USR, 6), psych: uid(USR, 28), plastic: uid(USR, 27), uro: uid(USR, 32),
};

// ── 결정적 의사난수(재실행 동일 데이터) ──
const rnd = (idx: number, k: number) => (Math.sin(idx * 97.13 + k * 41.7) + 1) / 2;
const pick = <T>(arr: T[], r: number) => arr[Math.floor(r * arr.length) % arr.length];
const between = (r: number, lo: number, hi: number) => Math.round(lo + r * (hi - lo));

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '전', '홍', '고', '문', '손', '배'];
const GIVEN_M = ['민준', '서준', '도윤', '예준', '시우', '하준', '지호', '준우', '현우', '지훈', '건우', '우진', '선우', '서진', '연우', '정우', '승우', '준서', '도현', '지환', '영수', '성민', '재현', '동현', '태양'];
const GIVEN_F = ['서연', '서윤', '지우', '하은', '민서', '지민', '수아', '지아', '지윤', '채원', '은서', '수빈', '소율', '예린', '유나', '서아', '하린', '다은', '예나', '시아', '순자', '영희', '미경', '정숙', '현주'];

// ── 백신 일정(소아) ──
const VAX = [
  { n: 'BCG', c: 'BCG', m: 0, d: 1, site: 'LEFT_ARM' },
  { n: 'B형간염', c: 'HepB', m: 0, d: 1 }, { n: 'B형간염', c: 'HepB', m: 1, d: 2 }, { n: 'B형간염', c: 'HepB', m: 6, d: 3 },
  { n: 'DTaP', c: 'DTaP', m: 2, d: 1, site: 'LEFT_THIGH' }, { n: 'DTaP', c: 'DTaP', m: 4, d: 2 }, { n: 'DTaP', c: 'DTaP', m: 6, d: 3 },
  { n: 'IPV', c: 'IPV', m: 2, d: 1 }, { n: 'MMR', c: 'MMR', m: 12, d: 1, site: 'RIGHT_ARM' }, { n: '수두', c: 'VAR', m: 12, d: 1 },
];

// ── 과 정의(인구통계 + 검사 생성기) ──
type DeptKey = keyof typeof DOC;
interface Dept { key: DeptKey; label: string; female?: boolean; childMonths?: boolean; ageLo: number; ageHi: number; }
const DEPTS: Dept[] = [
  { key: 'im', label: '내과', ageLo: 35, ageHi: 82 },
  { key: 'ortho', label: '정형외과', ageLo: 20, ageHi: 80 },
  { key: 'neuro', label: '신경외과', ageLo: 30, ageHi: 78 },
  { key: 'obgyn', label: '산부인과', female: true, ageLo: 20, ageHi: 46 },
  { key: 'pedi', label: '소아청소년과', childMonths: true, ageLo: 0, ageHi: 14 },
  { key: 'psych', label: '정신건강의학과', ageLo: 18, ageHi: 70 },
  { key: 'plastic', label: '성형외과', ageLo: 19, ageHi: 65 },
  { key: 'uro', label: '비뇨의학과', ageLo: 35, ageHi: 82 },
];

// 🔴 어휘 정본은 shared `IM_SUBSPECIALTIES` 다. 종전 이 시드만 GASTROENTEROLOGY·ENDOCRINOLOGY 를 써서
//    소화기·내분비 기록이 조회 화면 필터(GASTRO/ENDOCRINE)에서 사라졌다(2026-08-18 실측 15건).
const IM_SUB = IM_SUBSPECIALTY_KEYS;
const IM_DX = ['본태성 고혈압', '제2형 당뇨병', '위염', '만성콩팥병 3기', '갑상선기능저하증', '천식', '관상동맥질환', '이상지질혈증'];
const ORTHO_PART = ['SHOULDER', 'ELBOW', 'WRIST', 'HIP', 'KNEE', 'ANKLE', 'SPINE_C', 'SPINE_L'];
const ORTHO_DX = ['회전근개 파열', '무릎 골관절염', '요추 추간판탈출증', '발목 염좌', '족저근막염', '경추 협착증', '주관절 외상과염', '고관절 충돌증후군'];
const SIDE = ['LEFT', 'RIGHT', 'BILATERAL'];
const NEURO_DX = ['우측 경막하 혈종', '뇌동맥류', '추간판탈출증(요추)', '뇌수막종', '삼차신경통', '정상압수두증', '경막외 혈종', '교모세포종'];
const OBGYN_DX_P = ['정상 임신', '임신성 당뇨', '전치태반 관찰', '쌍태임신'];
const OBGYN_DX_G = ['정상 검진', '자궁근종', '난소낭종', '자궁경부 이형성증'];
const PSY_DX = ['주요우울장애', '범불안장애', '공황장애', '적응장애', '불면장애', '양극성장애 II형'];
const PLASTIC_PART = ['EYELID', 'NOSE', 'BREAST', 'ABDOMEN', 'FACE', 'HAND'];
const PLASTIC_PROC = ['상안검 성형술', '코 재건술', '유방 재건술', '복부 피판술', '반흔 교정술', '수부 건이전술'];
const URO_DX = ['전립선비대증', '요로결석', '방광염', '신우신염', '과민성방광', '전립선암 의심'];

async function main() {
  const t0 = Date.now();
  console.log('🏥 과별 리치니스 시드 시작 (8과 × 100명)...');

  let patN = 0;
  const summary: Record<string, number> = {};

  for (let d = 0; d < DEPTS.length; d++) {
    const dept = DEPTS[d];
    const doc = DOC[dept.key];
    const patients: any[] = [];
    const exams: any[] = [];
    const growth: any[] = [];
    const immun: any[] = [];

    for (let n = 1; n <= 100; n++) {
      const idx = 1000 + d * 100 + n; // 1001..1800
      const pid = uid(PAT, idx);
      const r = (k: number) => rnd(idx, k);
      const gender = dept.female ? Gender.FEMALE : (r(1) > 0.5 ? Gender.MALE : Gender.FEMALE);
      const given = gender === Gender.MALE ? pick(GIVEN_M, r(2)) : pick(GIVEN_F, r(3));
      const age = between(r(4), dept.ageLo, dept.ageHi);
      const by = 2026 - age;
      const dob = `${by}-${String(between(r(5), 1, 12)).padStart(2, '0')}-${String(between(r(6), 1, 28)).padStart(2, '0')}`;
      const dobDate = new Date(dob);
      patients.push({
        id: pid, mrn: `P2026-${idx}`, familyName: pick(SURNAMES, r(7)), givenName: given,
        dateOfBirth: new Date(dob), gender, insuranceType: InsuranceType.NHI,
        tags: [dept.label], createdBy: ADMIN, updatedBy: ADMIN,
      });
      patN++;

      // 검사일: 과거 ~24개월 분산
      const examDate = (s: number) => new Date(2026, 5, 28 - between(r(20 + s), 1, 700));
      const nExam = 1 + Math.floor(r(8) * 3); // 1~3

      if (dept.key === 'pedi') {
        const ageMo = age * 12 + between(r(9), 0, 11);
        // 중복 제거 — ageMo 가 0/6/12/24 중 하나면 같은 개월수 행이 두 번 들어갔다
        const steps = Array.from(new Set([0, 6, 12, 24].filter(m => m <= ageMo).concat(ageMo)));
        // 🔴 종전 결함 셋(같은 행 안에서 서로 모순):
        //   ① BMI 가 키·몸무게와 무관한 난수(`14 + r*3`) — 24개월 10.0kg/80cm 의 실제 BMI 는 15.7.
        //   ② 선형식이라 **불가능한 값**이 나왔다: 14세(168개월) → 신장 260cm · 두위 104.6cm.
        //   ③ 측정일이 `new Date(by, 0, 15 + m*12 % 300)` — 연산 우선순위상 **항상 출생연도**라
        //      "생후 24개월 기록"의 측정일이 돌 이전이었고, 하반기 출생아는 **출생 전 측정**이 됐다.
        //   → 참조 중앙값에서 백분위로 값을 파생시키고, BMI 는 정본이 키·몸무게에서 계산한다.
        //     백분위는 환자마다 고정(성장 곡선은 대체로 자기 궤도를 따른다).
        const wPct = between(r(11), 15, 90);
        const hPct = between(r(12), 15, 90);
        steps.forEach((m, s) => {
          const weight = pediWeightKg(m, wPct);
          const height = pediHeightCm(m, hPct);
          const measuredAt = new Date(dobDate.getTime());
          measuredAt.setMonth(measuredAt.getMonth() + m);
          growth.push({
            id: uid('0000b101', idx * 8 + s), patientId: pid, ageMonths: m,
            weight, height,
            // 두위는 영유아(≤36개월) 계측 항목이다 — 그 밖에는 재지 않는다(지어내지 않는다)
            headCirc: m <= 36 ? pediHeadCircCm(m) : null,
            bmi: calcBmi(weight, height) ?? null,
            // 🔴 (2026-10-10) 백분위는 저장하지 않는다 — wPct·hPct 는 값을 만들어 낸 생성 매개변수일 뿐 기준표로 계산한 백분위가 아니다
            //    (저장하면 화면이 '입력값'으로나마 백분위처럼 보인다 · 서버는 기준표 등록 전 백분위를 받지 않는다)
            measuredAt, measuredBy: doc,
          });
        });
        // 🔴 성장기록과 같은 결함: 접종일이 `new Date(by, v.m, 15)` 라 **출생연도 1월 15일** 기준이었다.
        //    생일이 11월인 아이의 'BCG(생후 0개월)' 접종일이 그 해 1월 15일 — **출생 전 접종**이다.
        //    접종일도 생년월일에서 파생시킨다.
        VAX.filter(v => v.m <= ageMo).forEach((v, s) => {
          const givenAt = new Date(dobDate.getTime());
          givenAt.setMonth(givenAt.getMonth() + Math.floor(v.m));
          immun.push({
            id: uid('0000b102', idx * 16 + s), patientId: pid, vaccineName: v.n, vaccineCode: v.c,
            doseNumber: (v as any).d ?? 1, givenAt, site: (v as any).site ?? null, givenBy: doc,
          });
        });
        continue;
      }

      for (let s = 0; s < nExam; s++) {
        const eid = uid(`0000a10${d}`, idx * 4 + s);
        const rr = (k: number) => rnd(idx, k + s * 7);
        const at = examDate(s);
        if (dept.key === 'im') exams.push({ id: eid, patientId: pid, subspecialty: pick(IM_SUB, rr(1)), diagnosis: pick(IM_DX, rr(2)), examinedAt: at, examinedBy: doc });
        else if (dept.key === 'ortho') exams.push({ id: eid, patientId: pid, bodyPart: pick(ORTHO_PART, rr(1)), side: pick(SIDE, rr(2)), painVas: between(rr(3), 1, 9), diagnosis: pick(ORTHO_DX, rr(4)), examinedAt: at, examinedBy: doc });
        else if (dept.key === 'neuro') { const e = between(rr(1), 3, 4), v = between(rr(2), 4, 5), m = between(rr(3), 5, 6); exams.push({ id: eid, patientId: pid, gcsEye: e, gcsVerbal: v, gcsMotor: m, gcsTotal: e + v + m, pupilLeft: { size: between(rr(4), 2, 5), reactive: rr(5) > 0.2 }, pupilRight: { size: between(rr(6), 2, 5), reactive: rr(7) > 0.2 }, asiaScale: pick(['A', 'B', 'C', 'D', 'E'], rr(8)), nihss: between(rr(9), 0, 18), diagnosis: pick(NEURO_DX, rr(10)), examinedAt: at, examinedBy: doc }); }
        else if (dept.key === 'obgyn') { const prenatal = rr(1) > 0.5; exams.push({ id: eid, patientId: pid, examType: prenatal ? 'PRENATAL' : 'GYNECOLOGY', ...(prenatal ? { gestationalAge: `${between(rr(2), 8, 39)}W`, fetalHeartRate: between(rr(3), 130, 160), currentWeight: 55 + rr(4) * 20 } : { papSmear: pick(['NILM', 'ASC-US', 'LSIL'], rr(5)) }), diagnosis: prenatal ? pick(OBGYN_DX_P, rr(6)) : pick(OBGYN_DX_G, rr(7)), examinedAt: at, examinedBy: doc }); }
        else if (dept.key === 'psych') exams.push({ id: eid, patientId: pid, mood: pick(['우울', '불안', '안정', '초조'], rr(1)), phq9: between(rr(2), 2, 24), gad7: between(rr(3), 1, 19), mmse: between(rr(4), 24, 30), suicideRisk: pick(['LOW', 'LOW', 'MODERATE'], rr(5)), diagnosis: pick(PSY_DX, rr(6)), examinedAt: at, examinedBy: doc });
        else if (dept.key === 'plastic') { const bp = Math.floor(rr(1) * PLASTIC_PART.length) % PLASTIC_PART.length; exams.push({ id: eid, patientId: pid, bodyPart: PLASTIC_PART[bp], procedure: PLASTIC_PROC[bp], anesthesiaType: pick(['국소', '수면', '전신'], rr(2)), duration: between(rr(3), 30, 180), diagnosis: PLASTIC_PROC[bp], examinedAt: at, examinedBy: doc }); }
        else if (dept.key === 'uro') exams.push({ id: eid, patientId: pid, diagnosis: pick(URO_DX, rr(1)), psaValue: gender === Gender.MALE ? Number((rr(2) * 8).toFixed(1)) : null, ipssScore: between(rr(3), 2, 30), examinedAt: at, examinedBy: doc });
      }
    }

    // ── upsert/createMany ──
    for (const p of patients) {
      await prisma.patient.upsert({ where: { id: p.id }, update: {}, create: p });
    }
    // 🔴 `pedi` 는 전용 모델이 없고 아래 분기(pediatricGrowth)가 따로 처리한다 —
    //    맵에 **명시적으로 빈 값**을 둔다(빠뜨린 것과 없는 것을 구분한다).
    const EXAM_MODEL: Record<string, string> = {
      im: 'internalMedicineExam', ortho: 'orthoExam', neuro: 'neuroExam', obgyn: 'obGynExam',
      psych: 'psychExam', plastic: 'plasticExam', uro: 'urologyExam', pedi: '',
    };
    const model: any = (prisma as any)[EXAM_MODEL[dept.key] ?? ''];
    if (dept.key === 'pedi') {
      const g = await prisma.pediatricGrowth.createMany({ data: growth, skipDuplicates: true });
      const i = await prisma.pediatricImmunization.createMany({ data: immun, skipDuplicates: true });
      summary[dept.label] = patients.length;
      console.log(`  ✓ ${dept.label}: 환자 ${patients.length} · 성장 ${g.count} · 접종 ${i.count}`);
    } else if (model) {
      const e = await model.createMany({ data: exams, skipDuplicates: true });
      summary[dept.label] = patients.length;
      console.log(`  ✓ ${dept.label}: 환자 ${patients.length} · 검사 ${e.count}`);
    }
  }

  console.log(`✅ 완료: 환자 ${patN}명 / ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(JSON.stringify(summary));
}

assertSeedAllowed(__filename, 'DEMO'); // 🔴 실행 진입에서만 판정 — 테스트가 이 모듈을 import 하므로 최상단에 두지 않는다(상용 릴리즈 T2-3)
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
