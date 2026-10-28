import { assertSeedAllowed } from './seed-mode-guard';
assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
import {
  PrismaClient,
  UserRole,
  Gender,
  InsuranceType,
  BedStatus,
  EmploymentStatus,
  StaffCategory,
  EquipmentStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
// 🔴 재평가 등급·주기는 값을 베끼지 않고 **정본을 부른다** — 화면 실사용 점검 W8(2026-08-14).
//    종전 시드는 등급·주기를 리터럴로 적어 두었고 그 값이 정본과 어긋나 있었다
//    (Morse 45 를 MODERATE 로 = 실제로는 HIGH · 고위험 낙상을 8h/4h 로 = 정본 2h).
//    운영 DB 는 0행이라 무해했지만 시드를 돌리는 순간 **잘못된 위험등급이 법정기록에 들어간다.**
//    이 파일은 Nest 데코레이터·DI 가 없는 순수 TS 라 시드에서 그대로 import 할 수 있다.
import {
  deriveRiskLevel,
  intervalHoursFor,
  type AssessmentType,
} from '../src/modules/risk-reassessment/risk-reassessment.policy';
// 🔴 QI 지표 카탈로그·측정값 생성기 — 값을 먼저 정하고 분자·분모를 역산하던 결함을 봉합했다.
//    산출은 서비스와 같은 정본(`computeMeasurementValue`)을 부른다. 상세는 그 파일 상단 주석.
// 🔴 NEWS2 조기경보점수는 **정본이 산출한다**. 종전 시드는 점수·등급을 리터럴로 찍어
//    같은 행의 활력징후와 어긋나 있었다(실제 11점을 7점·MEDIUM 으로).
import { computeNews2 } from '../src/modules/icu/icu-scores';
import { DECISION_DEV_SEEDS } from './seeds/decision-dev-seeds';
import { NURSING_RULE_DEV_SEEDS } from './seeds/nursing-rules-dev-seed';
import { DEV_SEED_CONFIG_LABEL } from '@hospital-run/shared';
// 🔴 진료 녹음 동의서 문안은 shared 정본 하나에서만 온다(법무 검토 전 초안 — 시드는 견본이지 원내 표준이 아니다 · 2026-09-22 D4)
import { RECORDING_CONSENT_DRAFT, recordingConsentDraftText, COMMITTEE_CODES, committeeAuthorityConfigKey, committeeAuthoritySeedRecord } from '@hospital-run/shared';
import {
  QI_INDICATOR_CATALOG,
  buildQiMeasurements,
  qiMeasurementSeedIndex,
} from './seeds/qi-measurement';

const prisma = new PrismaClient();

// ============================================================
// Helper: deterministic UUID v4 from index (for idempotent upsert)
// ============================================================
function makeUuid(prefix: string, index: number): string {
  const hex = index.toString(16).padStart(4, '0');
  const suffix = (prefix + hex).padStart(12, '0').slice(0, 12);
  return `00000000-0000-4000-a000-${suffix}`;
}

// Prefix registry (ensures unique UUID namespaces)
const P = {
  USER: '000000a0',
  WARD: '000000b0',
  BED: '000000c0',
  PATIENT: '000000d0',
  DIAG: '000000e0',
  PROC: '000000f0',
  MED: '00000010',
  STAFF: '00000020',
  INV: '00000030',
  EQUIP: '00000040',
  QI: '00000050',
  CKPROG: '00000060',
  PATHWAY: '00000070',
  MDT: '00000080',
  CANCER: '00000090',
  RESEARCH: '000000aa',
  COST: '000000bb',
  // Extended seed prefixes
  DEPOSIT: '000000cc',
  INSTALL: '000000dd',
  INVSTOR: '000000ee',
  INVSUPP: '000000ff',
  INVLOT: '00000011',
  INVTX: '00000012',
  INVCNT: '00000013',
  INVREQ: '00000014',
  PO: '00000015',
  REPACK: '00000016',
  QRLBL: '00000017',
  MEDBTCH: '00000018',
  DSPCNSL: '00000019',
  GENSUB: '0000001a',
  PHRMDVC: '0000001b',
  ATCDISP: '0000001c',
  MNTLOG: '0000001d',
  EQUSAGE: '0000001e',
  EQUINSP: '0000001f',
  EQUPART: '00000021',
  INSTSET: '00000022',
  STERLOG: '00000023',
  CARETEAM: '00000024',
  NRSASSGN: '00000025',
  NRSTASK: '00000026',
  HANDOFF: '00000027',
  CHARGE: '00000028',
  BEDASGN: '00000029',
  ROUND: '0000002a',
  PTACCT: '0000002b',
  PTCNSNT: '0000002c',
  PTDEV: '0000002d',
  PTFAM: '0000002e',
  PTADDR: '0000002f',
  PTSESS: '00000031',
  PTAUDIT: '00000032',
  DOCREQ: '00000033',
  FORMSUB: '00000034',
  PTMSG: '00000035',
  HLMEMO: '00000036',
  AUDITLG: '00000037',
  CTRLSUB: '00000038',
  HIRACL: '00000039',
  BTG: '0000003a',
  VIP: '0000003b',
  HOSPICE: '0000003c',
  HOSPASS: '0000003d',
  HOSPCON: '0000003e',
  ADVDIR: '0000003f',
  TRWAIT: '00000041',
  TRDONOR: '00000042',
  TRREC: '00000043',
  TRREJ: '00000044',
  TELEH: '00000045',
  RESSUBJ: '00000046',
  RESDOC: '00000047',
  IRBAMND: '00000048',
  MDTCASE: '00000049',
  MDTATT: '0000004a',
  PWASSGN: '0000004b',
  MLSTONE: '0000004c',
  CANCRTX: '0000004d',
  CANCRFU: '0000004e',
  COSTALL: '0000004f',
  PROCCST: '00000051',
  SYSCFG: '00000052',
  HOLIDAY: '00000053',
  NOTIF: '00000054',
  AIFDBK: '00000055',
  AGTSESS: '00000056',
  ONLBOOK: '00000057',
  PREORD: '00000058',
  WEBHOOK: '00000059',
  CLNSYNC: '0000005a',
  TXTMACR: '0000005b',
  FAVORD: '0000005c',
  UCHPREF: '0000005d',
  DRPROF: '0000005e',
  SATSUV: '0000005f',
  VACC: '00000061',
  DENTRCL: '00000062',
  EWS: '00000063',
  SMSVRF: '00000064',
  BOT: '00000065',
  BOTEXEC: '00000066',
  DICOM: '00000067',
  PTIDCHK: '00000068',
  SAFETY: '00000069',
  DEPTFRM: '0000006a',
  PTLOC: '0000006b',
  DSPAKEY: '0000006c',
  CKRSLT: '0000006d',
  CKSUM: '0000006e',
  CKINTERP: '0000006f',
  CKREF: '00000071',
  CKFOLUP: '00000072',
  CKCTRCT: '00000073',
  FORMSCH: '00000074',
  FLWSHT: '00000075',
} as const;

function uid(prefix: string, i: number) {
  return makeUuid(prefix, i);
}

/**
 * 검사 참고치 플래그 — **한 곳에서만** 판정한다.
 * 🔴 종전엔 검사 플래그 식이 두 벌(일반/응급)이었고 둘 다 `Number(t.value)` 를 그대로 비교했다.
 *    `Number('50-100')` = NaN 이고 `NaN < min`·`NaN > max` 가 **둘 다 false** 라, 농뇨 50–100/HPF
 *    (정상 0–5)·혈뇨 5–10/HPF(정상 0–3)가 **'N'(정상)** 으로 저장됐다 — 같은 행 안에서
 *    값·참고치·플래그가 서로 모순이었다. 숫자가 아니면 **모른다(null)** 로 둔다.
 */
function labFlagOf(value: unknown, min?: number | null, max?: number | null): 'L' | 'H' | 'N' | null {
  if (min == null || max == null) return null;
  const v = String(value ?? '').trim();
  const numeric = /^-?\d+(\.\d+)?$/.test(v)
    ? Number(v)
    : (() => {
        // 범위 표기('50-100')는 하한으로 판정한다 — 하한이 이미 참고치를 넘으면 전 구간이 이상이다
        const m = /^(-?\d+(?:\.\d+)?)\s*[-~]\s*(-?\d+(?:\.\d+)?)$/.exec(v);
        return m ? Number(m[1]) : null;
      })();
  if (numeric == null || !Number.isFinite(numeric)) return null; // 정성 결과('Positive')는 플래그를 지어내지 않는다
  return numeric < min ? 'L' : numeric > max ? 'H' : 'N';
}

async function main() {
  console.log('🏥 위루비병원 — Seeding database...');
  const startTime = Date.now();

  // ============================================================
  // 1. Users (사용자) — 15 users
  // ============================================================
  console.log('  [1/10] Users...');
  const passwordHash = await bcrypt.hash('staff1234!', 12);

  const users = [
    { i: 1, email: 'admin@hospital.example.org', familyName: '관리', givenName: '자', role: UserRole.ADMIN, dept: null, spec: null },
    // 내과
    { i: 2, email: 'kim.naegwa@hospital.example.org', familyName: '김', givenName: '내과', role: UserRole.DOCTOR, dept: '내과', spec: '순환기내과' },
    { i: 3, email: 'park.naegwa@hospital.example.org', familyName: '박', givenName: '내과', role: UserRole.DOCTOR, dept: '내과', spec: '호흡기내과' },
    // 외과
    { i: 4, email: 'lee.oegwa@hospital.example.org', familyName: '이', givenName: '외과', role: UserRole.DOCTOR, dept: '외과', spec: '일반외과' },
    { i: 5, email: 'choi.oegwa@hospital.example.org', familyName: '최', givenName: '외과', role: UserRole.DOCTOR, dept: '외과', spec: '흉부외과' },
    // 소아과
    { i: 6, email: 'jung.soaa@hospital.example.org', familyName: '정', givenName: '소아', role: UserRole.DOCTOR, dept: '소아청소년과', spec: null },
    // 산부인과
    { i: 7, email: 'han.sanbu@hospital.example.org', familyName: '한', givenName: '산부', role: UserRole.DOCTOR, dept: '산부인과', spec: null },
    // 정형외과
    { i: 8, email: 'oh.jeonghyung@hospital.example.org', familyName: '오', givenName: '정형', role: UserRole.DOCTOR, dept: '정형외과', spec: null },
    // 응급의학과
    { i: 9, email: 'kang.eunggup@hospital.example.org', familyName: '강', givenName: '응급', role: UserRole.DOCTOR, dept: '응급의학과', spec: null },
    // 간호사 — 병동별 (16명)
    { i: 10, email: 'cho.ganho@hospital.example.org', familyName: '조', givenName: '간호', role: UserRole.NURSE, dept: '내과', spec: null },
    { i: 11, email: 'yoon.ganho@hospital.example.org', familyName: '윤', givenName: '간호', role: UserRole.NURSE, dept: '외과', spec: null },
    { i: 12, email: 'hwang.ganho@hospital.example.org', familyName: '황', givenName: '간호', role: UserRole.NURSE, dept: '응급의학과', spec: null },
    { i: 13, email: 'seo.ganho@hospital.example.org', familyName: '서', givenName: '간호', role: UserRole.NURSE, dept: '소아청소년과', spec: null },
    // 신규 병동 간호사
    { i: 45, email: 'kim.icu@hospital.example.org', familyName: '김', givenName: 'ICU간호', role: UserRole.NURSE, dept: 'ICU', spec: null },
    { i: 46, email: 'lee.or@hospital.example.org', familyName: '이', givenName: '수술실간호', role: UserRole.NURSE, dept: '수술실', spec: null },
    { i: 47, email: 'park.obgyn@hospital.example.org', familyName: '박', givenName: '산부인과간호', role: UserRole.NURSE, dept: '산부인과', spec: null },
    { i: 48, email: 'choi.ortho@hospital.example.org', familyName: '최', givenName: '정형외과간호', role: UserRole.NURSE, dept: '정형외과', spec: null },
    { i: 49, email: 'jung.psych@hospital.example.org', familyName: '정', givenName: '정신과간호', role: UserRole.NURSE, dept: '정신건강의학과', spec: null },
    { i: 50, email: 'kang.dialysis@hospital.example.org', familyName: '강', givenName: '투석실간호', role: UserRole.NURSE, dept: '투석실', spec: null },
    { i: 51, email: 'han.blood@hospital.example.org', familyName: '한', givenName: '혈액은행간호', role: UserRole.NURSE, dept: '혈액은행', spec: null },
    { i: 52, email: 'shin.rehab@hospital.example.org', familyName: '신', givenName: '재활간호', role: UserRole.NURSE, dept: '재활의학과', spec: null },
    { i: 53, email: 'lim.onco@hospital.example.org', familyName: '임', givenName: '항암간호', role: UserRole.NURSE, dept: '혈액종양내과', spec: null },
    { i: 54, email: 'song.wound@hospital.example.org', familyName: '송', givenName: '상처간호', role: UserRole.NURSE, dept: '외과', spec: '상처·장루' },
    { i: 55, email: 'na.infection@hospital.example.org', familyName: '나', givenName: '감염간호', role: UserRole.NURSE, dept: '감염관리실', spec: '감염관리' },
    { i: 56, email: 'oh.neonatal@hospital.example.org', familyName: '오', givenName: '신생아간호', role: UserRole.NURSE, dept: '소아청소년과', spec: '신생아실' },
    // 약사
    { i: 14, email: 'lim.yaksa@hospital.example.org', familyName: '임', givenName: '약사', role: UserRole.PHARMACIST, dept: '약제과', spec: null },
    // 임상병리사
    { i: 15, email: 'moon.geomsa@hospital.example.org', familyName: '문', givenName: '검사', role: UserRole.LAB_TECH, dept: '진단검사의학과', spec: null },
    // CRM 부서
    { i: 57, email: 'crm.manager@hospital.example.org', familyName: '김', givenName: 'CRM팀장', role: UserRole.CRM_MANAGER, dept: 'CRM', spec: '검진CRM' },
    { i: 58, email: 'crm.checkup@hospital.example.org', familyName: '이', givenName: 'CRM검진', role: UserRole.CRM_STAFF, dept: 'CRM', spec: '검진CRM' },
    { i: 59, email: 'crm.intl@hospital.example.org', familyName: '박', givenName: 'CRM해외', role: UserRole.CRM_STAFF, dept: 'CRM', spec: '해외환자CRM' },
    { i: 60, email: 'crm.campaign@hospital.example.org', familyName: '최', givenName: 'CRM캠페인', role: UserRole.CRM_STAFF, dept: 'CRM', spec: '캠페인관리' },
    // 비임상 지원 부서 — 부서별 최소권한(임상/처방/오더 권한 없음). 실 의료기관 조직 기준 재구성.
    { i: 16, email: 'lee.wonmu@hospital.example.org', familyName: '이', givenName: '원무', role: UserRole.RECEPTIONIST, dept: '원무과', spec: null },
    { i: 17, email: 'park.haengjeong@hospital.example.org', familyName: '박', givenName: '행정', role: UserRole.ADMIN_STAFF, dept: '행정과', spec: null },
    { i: 18, email: 'kim.geupyang@hospital.example.org', familyName: '김', givenName: '급양', role: UserRole.NUTRITION, dept: '급양과', spec: null },
    { i: 19, email: 'choi.uimu@hospital.example.org', familyName: '최', givenName: '의무기록', role: UserRole.MEDICAL_RECORDS, dept: '의무기록과', spec: null },
    // ── 진료과별 의사 계정 (i=20~) ──
    // 내과 세부
    { i: 20, email: 'test.sowhagi@hospital.example.org', familyName: '윤', givenName: '소화', role: UserRole.DOCTOR, dept: '내과', spec: '소화기내과' },
    { i: 21, email: 'test.naebunbi@hospital.example.org', familyName: '서', givenName: '내분비', role: UserRole.DOCTOR, dept: '내과', spec: '내분비내과' },
    { i: 22, email: 'test.sinjang@hospital.example.org', familyName: '임', givenName: '신장', role: UserRole.DOCTOR, dept: '내과', spec: '신장내과' },
    { i: 23, email: 'test.hyeolack@hospital.example.org', familyName: '강', givenName: '혈액', role: UserRole.DOCTOR, dept: '내과', spec: '혈액종양내과' },
    { i: 24, email: 'test.gamyeom@hospital.example.org', familyName: '송', givenName: '감염', role: UserRole.DOCTOR, dept: '내과', spec: '감염내과' },
    { i: 25, email: 'test.ryumati@hospital.example.org', familyName: '조', givenName: '류마', role: UserRole.DOCTOR, dept: '내과', spec: '류마티스내과' },
    // 외과/신경
    { i: 26, email: 'test.singyeong@hospital.example.org', familyName: '백', givenName: '신경', role: UserRole.DOCTOR, dept: '신경외과', spec: null },
    { i: 27, email: 'test.seonghyeong@hospital.example.org', familyName: '고', givenName: '성형', role: UserRole.DOCTOR, dept: '성형외과', spec: null },
    // 전문과
    { i: 28, email: 'test.jeongshin@hospital.example.org', familyName: '문', givenName: '정신', role: UserRole.DOCTOR, dept: '정신건강의학과', spec: null },
    { i: 29, email: 'test.angwa@hospital.example.org', familyName: '양', givenName: '안과', role: UserRole.DOCTOR, dept: '안과', spec: null },
    { i: 30, email: 'test.ibiin@hospital.example.org', familyName: '배', givenName: '이비인후', role: UserRole.DOCTOR, dept: '이비인후과', spec: null },
    { i: 31, email: 'test.pibu@hospital.example.org', familyName: '노', givenName: '피부', role: UserRole.DOCTOR, dept: '피부과', spec: null },
    { i: 32, email: 'test.binyo@hospital.example.org', familyName: '하', givenName: '비뇨', role: UserRole.DOCTOR, dept: '비뇨의학과', spec: null },
    { i: 33, email: 'test.jaehwal@hospital.example.org', familyName: '전', givenName: '재활', role: UserRole.DOCTOR, dept: '재활의학과', spec: null },
    { i: 34, email: 'test.gajeong@hospital.example.org', familyName: '황', givenName: '가정', role: UserRole.DOCTOR, dept: '가정의학과', spec: null },
    { i: 35, email: 'test.machwi@hospital.example.org', familyName: '구', givenName: '마취', role: UserRole.DOCTOR, dept: '마취통증의학과', spec: null },
    { i: 36, email: 'test.yeongsang@hospital.example.org', familyName: '유', givenName: '영상', role: UserRole.DOCTOR, dept: '영상의학과', spec: null },
    { i: 37, email: 'test.byeongli@hospital.example.org', familyName: '권', givenName: '병리', role: UserRole.DOCTOR, dept: '병리과', spec: null },
    // 치과
    { i: 44, email: 'test.dental@hospital.example.org', familyName: '신', givenName: '치과', role: UserRole.DOCTOR, dept: '치과', spec: '보존과' },
    // 간호사/약사/검사
    { i: 38, email: 'test.nurse@hospital.example.org', familyName: '민', givenName: '간호', role: UserRole.NURSE, dept: '간호부', spec: null },
    { i: 39, email: 'test.pharmacist@hospital.example.org', familyName: '남', givenName: '약사', role: UserRole.PHARMACIST, dept: '약제과', spec: null },
    { i: 40, email: 'test.labtech@hospital.example.org', familyName: '진', givenName: '검사', role: UserRole.LAB_TECH, dept: '진단검사의학과', spec: null },
    // ── 경영진 계정 ──
    { i: 41, email: 'hong.director@hospital.example.org', familyName: '홍', givenName: '원장', role: UserRole.DOCTOR, dept: '경영진', spec: null },
    { i: 42, email: 'kim.ceo@hospital.example.org', familyName: '김', givenName: '이사장', role: UserRole.EXECUTIVE, dept: '경영진', spec: null }, // 이사장=비임상 governance → 읽기전용 관제(원장·의료원장은 임상의 겸직이라 DOCTOR 유지)
    { i: 43, email: 'park.cmo@hospital.example.org', familyName: '박', givenName: '의료원장', role: UserRole.DOCTOR, dept: '경영진', spec: null },
    // ── 건강검진센터 계정 ──
    { i: 60, email: 'ck.doctor@hospital.example.org', familyName: '정', givenName: '검진의사', role: UserRole.DOCTOR, dept: '건강검진센터(의사)', spec: '건강검진' },
    { i: 61, email: 'ck.nurse@hospital.example.org', familyName: '한', givenName: '검진간호사', role: UserRole.NURSE, dept: '건강검진센터(간호사)', spec: null },
    // 검진센터 원무·행정 = 전용 CHECKUP 역할(본원 임상·시스템관리 권한 없음). 검진 기능은 checkup 모듈이
    // JWT 기반이라 role 로 열리고, 검진 nav 는 CHECKUP role 로 스코프(부서 narrowing 제외 — 폴백 경로 불일치 우회).
    { i: 62, email: 'ck.admin@hospital.example.org', familyName: '서', givenName: '검진원무', role: UserRole.CHECKUP, dept: '건강검진센터(원무)', spec: null },
    { i: 63, email: 'ck.office@hospital.example.org', familyName: '강', givenName: '검진행정', role: UserRole.CHECKUP, dept: '건강검진센터(행정)', spec: null },
    // 검사실별 계정
    { i: 64, email: 'ck.blood@hospital.example.org', familyName: '이', givenName: '채혈실', role: UserRole.NURSE, dept: '건강검진센터(검사실)', spec: '채혈실' },
    { i: 65, email: 'ck.xray@hospital.example.org', familyName: '박', givenName: 'X-ray실', role: UserRole.LAB_TECH, dept: '건강검진센터(검사실)', spec: 'X-ray실' },
    { i: 66, email: 'ck.ultrasound@hospital.example.org', familyName: '최', givenName: '초음파실', role: UserRole.LAB_TECH, dept: '건강검진센터(검사실)', spec: '초음파실' },
    { i: 67, email: 'ck.ecg@hospital.example.org', familyName: '정', givenName: '심전도실', role: UserRole.NURSE, dept: '건강검진센터(검사실)', spec: '심전도실' },
    { i: 68, email: 'ck.physical@hospital.example.org', familyName: '김', givenName: '신체계측실', role: UserRole.NURSE, dept: '건강검진센터(검사실)', spec: '신체계측실' },
    { i: 69, email: 'ck.endoscopy@hospital.example.org', familyName: '윤', givenName: '내시경실', role: UserRole.NURSE, dept: '건강검진센터(검사실)', spec: '내시경실' },
    // ── 임상 워크스테이션 계정 ──
    { i: 70, email: 'ws.phlebotomy@hospital.example.org', familyName: '김', givenName: '채혈', role: UserRole.NURSE, dept: '검사실(채혈)', spec: null },
    { i: 71, email: 'ws.hematology@hospital.example.org', familyName: '이', givenName: '혈액검사', role: UserRole.LAB_TECH, dept: '검사실(혈액)', spec: null },
    { i: 72, email: 'ws.chemistry@hospital.example.org', familyName: '박', givenName: '생화학', role: UserRole.LAB_TECH, dept: '검사실(생화학)', spec: null },
    { i: 73, email: 'ws.urinalysis@hospital.example.org', familyName: '최', givenName: '소변검사', role: UserRole.LAB_TECH, dept: '검사실(소변)', spec: null },
    { i: 74, email: 'ws.microbiology@hospital.example.org', familyName: '정', givenName: '미생물', role: UserRole.LAB_TECH, dept: '검사실(미생물)', spec: null },
    { i: 75, email: 'ws.xray@hospital.example.org', familyName: '한', givenName: '일반촬영', role: UserRole.LAB_TECH, dept: '영상실(일반촬영)', spec: null },
    { i: 76, email: 'ws.ct@hospital.example.org', familyName: '서', givenName: 'CT', role: UserRole.LAB_TECH, dept: '영상실(CT)', spec: null },
    { i: 77, email: 'ws.mri@hospital.example.org', familyName: '강', givenName: 'MRI', role: UserRole.LAB_TECH, dept: '영상실(MRI)', spec: null },
    { i: 78, email: 'ws.ultrasound@hospital.example.org', familyName: '조', givenName: '초음파', role: UserRole.LAB_TECH, dept: '영상실(초음파)', spec: null },
    { i: 79, email: 'ws.ecg@hospital.example.org', familyName: '윤', givenName: '심전도', role: UserRole.NURSE, dept: '기초검사(심전도)', spec: null },
    { i: 80, email: 'ws.pft@hospital.example.org', familyName: '장', givenName: '폐기능', role: UserRole.NURSE, dept: '기초검사(폐기능)', spec: null },
    { i: 81, email: 'ws.endoscopy@hospital.example.org', familyName: '임', givenName: '내시경', role: UserRole.NURSE, dept: '기초검사(내시경)', spec: null },
    { i: 82, email: 'ws.reading@hospital.example.org', familyName: '송', givenName: '판독의', role: UserRole.DOCTOR, dept: '영상의학과(판독)', spec: '영상의학과' },
    // 치료실 워크스테이션
    { i: 83, email: 'tx.pt@hospital.example.org', familyName: '고', givenName: '물리치료', role: UserRole.NURSE, dept: '치료실(물리)', spec: null },
    { i: 84, email: 'tx.ot@hospital.example.org', familyName: '노', givenName: '작업치료', role: UserRole.NURSE, dept: '치료실(작업)', spec: null },
    { i: 85, email: 'tx.st@hospital.example.org', familyName: '도', givenName: '언어치료', role: UserRole.NURSE, dept: '치료실(언어)', spec: null },
    { i: 86, email: 'tx.dialysis@hospital.example.org', familyName: '로', givenName: '투석간호', role: UserRole.NURSE, dept: '치료실(투석)', spec: null },
    { i: 87, email: 'tx.chemo@hospital.example.org', familyName: '모', givenName: '항암간호', role: UserRole.NURSE, dept: '치료실(항암)', spec: null },
    { i: 88, email: 'tx.radiation@hospital.example.org', familyName: '보', givenName: '방사선치료', role: UserRole.LAB_TECH, dept: '치료실(방사선)', spec: null },
  ];

  for (const u of users) {
    try {
      await prisma.user.upsert({
        where: { email: u.email },
        update: { familyName: u.familyName, givenName: u.givenName, department: u.dept, specialty: u.spec, role: u.role },
        create: {
          id: uid(P.USER, u.i),
          email: u.email,
          passwordHash,
          familyName: u.familyName,
          givenName: u.givenName,
          role: u.role,
          department: u.dept,
          specialty: u.spec,
        },
      });
    } catch (e: any) {
      // id 충돌 시 email로 update만 수행
      if (e?.code === 'P2002') {
        await prisma.user.updateMany({
          where: { email: u.email },
          data: { familyName: u.familyName, givenName: u.givenName, department: u.dept, specialty: u.spec, role: u.role },
        });
      } else throw e;
    }
  }

  // Convenience references
  const adminId = uid(P.USER, 1);
  const kimNaegwaId = uid(P.USER, 2);
  const parkNaegwaId = uid(P.USER, 3);

  // ============================================================
  // 2. Wards & Beds (병동 & 병상)
  // ============================================================
  console.log('  [2/10] Wards & Beds...');

  const wards: { i: number; name: string; floor: number; rooms: string[]; hasBed: boolean; type?: string }[] = [
    { i: 1, name: '3층 내과병동', floor: 3, rooms: ['301', '302', '303', '304', '305'], hasBed: true },
    { i: 2, name: '4층 외과병동', floor: 4, rooms: ['401', '402', '403', '404', '405'], hasBed: true },
    { i: 3, name: '5층 소아/산부병동', floor: 5, rooms: ['501', '502', '503'], hasBed: true },
    { i: 4, name: '6층 정형외과병동', floor: 6, rooms: ['601', '602', '603'], hasBed: true },
    // ER 베드 보드(2026-08-05): roomNumber=구역 코드(RESUS/ACUTE/GEN/ISO/OBS)·bedNumber=구역 내 번호.
    // type=EMERGENCY 는 입원 가용 조회(beds/available)에서 제외되는 표식(D1). 구 ER-01~05 는 운영 DB 에서 구역 체계로 재명명됨.
    { i: 5, name: '응급병동', floor: 1, rooms: [], hasBed: false, type: 'EMERGENCY' },
  ];
  const ER_ZONES: [string, number][] = [['RESUS', 2], ['ACUTE', 6], ['GEN', 10], ['ISO', 2], ['OBS', 4]];

  let bedIndex = 1;
  for (const w of wards) {
    const wardId = uid(P.WARD, w.i);
    await prisma.ward.upsert({
      where: { name: w.name },
      update: { type: w.type ?? 'GENERAL' },
      create: { id: wardId, name: w.name, floor: w.floor, type: w.type ?? 'GENERAL' },
    });

    if (w.type === 'EMERGENCY') {
      for (const [zone, count] of ER_ZONES) {
        for (let n = 1; n <= count; n++) {
          await prisma.bed.upsert({
            where: { wardId_roomNumber_bedNumber: { wardId, roomNumber: zone, bedNumber: String(n) } },
            update: {},
            create: { id: uid(P.BED, 100 + bedIndex), wardId, roomNumber: zone, bedNumber: String(n), status: BedStatus.AVAILABLE },
          });
          bedIndex++;
        }
      }
      continue;
    }

    for (const room of w.rooms) {
      const bedLabels = w.hasBed ? ['A', 'B'] : ['1'];
      for (const bed of bedLabels) {
        await prisma.bed.upsert({
          where: { wardId_roomNumber_bedNumber: { wardId, roomNumber: room, bedNumber: bed } },
          update: {},
          create: {
            id: uid(P.BED, bedIndex),
            wardId,
            roomNumber: room,
            bedNumber: bed,
            status: BedStatus.AVAILABLE,
          },
        });
        bedIndex++;
      }
    }
  }

  // ============================================================
  // 3. Patients (환자) — 30 patients
  // ============================================================
  console.log('  [3/10] Patients...');

  const patients = [
    { i: 1, mrn: 'P2026-0001', fn: '김', gn: '영수', dob: '1958-03-15', gender: Gender.MALE, ins: InsuranceType.NHI, blood: 'A+', phone: '010-1234-5678' },
    { i: 2, mrn: 'P2026-0002', fn: '이', gn: '미숙', dob: '1965-07-22', gender: Gender.FEMALE, ins: InsuranceType.NHI, blood: 'B+', phone: '010-2345-6789' },
    { i: 3, mrn: 'P2026-0003', fn: '박', gn: '철수', dob: '1972-11-08', gender: Gender.MALE, ins: InsuranceType.NHI, blood: 'O+', phone: '010-3456-7890' },
    { i: 4, mrn: 'P2026-0004', fn: '최', gn: '순자', dob: '1948-01-30', gender: Gender.FEMALE, ins: InsuranceType.MEDICAID, blood: 'AB+', phone: '010-4567-8901' },
    { i: 5, mrn: 'P2026-0005', fn: '정', gn: '민호', dob: '1985-05-12', gender: Gender.MALE, ins: InsuranceType.NHI, blood: 'A-', phone: '010-5678-9012' },
    { i: 6, mrn: 'P2026-0006', fn: '한', gn: '지영', dob: '1990-09-03', gender: Gender.FEMALE, ins: InsuranceType.NHI, blood: 'B+', phone: '010-6789-0123' },
    { i: 7, mrn: 'P2026-0007', fn: '오', gn: '대한', dob: '1955-12-25', gender: Gender.MALE, ins: InsuranceType.NHI, blood: 'O-', phone: '010-7890-1234' },
    { i: 8, mrn: 'P2026-0008', fn: '강', gn: '미래', dob: '2021-04-18', gender: Gender.FEMALE, ins: InsuranceType.NHI, blood: 'A+', phone: '010-8901-2345' },
    { i: 9, mrn: 'P2026-0009', fn: '조', gn: '건우', dob: '1978-08-07', gender: Gender.MALE, ins: InsuranceType.SELF_PAY, blood: 'B-', phone: '010-9012-3456' },
    { i: 10, mrn: 'P2026-0010', fn: '윤', gn: '서연', dob: '1995-02-14', gender: Gender.FEMALE, ins: InsuranceType.NHI, blood: 'AB-', phone: '010-0123-4567' },
    { i: 11, mrn: 'P2026-0011', fn: '서', gn: '준혁', dob: '1960-06-20', gender: Gender.MALE, ins: InsuranceType.NHI, blood: 'O+', phone: '010-1111-2222' },
    { i: 12, mrn: 'P2026-0012', fn: '임', gn: '하늘', dob: '2018-10-05', gender: Gender.FEMALE, ins: InsuranceType.NHI, blood: 'A+', phone: '010-2222-3333' },
    { i: 13, mrn: 'P2026-0013', fn: '문', gn: '태식', dob: '1970-04-11', gender: Gender.MALE, ins: InsuranceType.MEDICAID, blood: 'B+', phone: '010-3333-4444' },
    { i: 14, mrn: 'P2026-0014', fn: '신', gn: '유리', dob: '1988-12-30', gender: Gender.FEMALE, ins: InsuranceType.NHI, blood: 'O+', phone: '010-4444-5555' },
    { i: 15, mrn: 'P2026-0015', fn: '류', gn: '상호', dob: '1952-09-17', gender: Gender.MALE, ins: InsuranceType.MEDICAID, blood: 'AB+', phone: '010-5555-6666' },
    { i: 16, mrn: 'P2026-0016', fn: '배', gn: '은지', dob: '1993-01-28', gender: Gender.FEMALE, ins: InsuranceType.NHI, blood: 'A-', phone: '010-6666-7777' },
    { i: 17, mrn: 'P2026-0017', fn: '홍', gn: '길동', dob: '1975-07-04', gender: Gender.MALE, ins: InsuranceType.NHI, blood: 'B-', phone: '010-7777-8888' },
    { i: 18, mrn: 'P2026-0018', fn: '안', gn: '소희', dob: '1983-11-19', gender: Gender.FEMALE, ins: InsuranceType.SELF_PAY, blood: 'O-', phone: '010-8888-9999' },
    { i: 19, mrn: 'P2026-0019', fn: '송', gn: '민석', dob: '1946-03-08', gender: Gender.MALE, ins: InsuranceType.MEDICAID, blood: 'A+', phone: '010-9999-0000' },
    { i: 20, mrn: 'P2026-0020', fn: '양', gn: '수진', dob: '1999-08-22', gender: Gender.FEMALE, ins: InsuranceType.NHI, blood: 'B+', phone: '010-1010-2020' },
    { i: 21, mrn: 'P2026-0021', fn: '권', gn: '도윤', dob: '2019-06-15', gender: Gender.MALE, ins: InsuranceType.NHI, blood: 'O+', phone: '010-2020-3030' },
    { i: 22, mrn: 'P2026-0022', fn: '황', gn: '정은', dob: '1968-02-03', gender: Gender.FEMALE, ins: InsuranceType.NHI, blood: 'AB+', phone: '010-3030-4040' },
    { i: 23, mrn: 'P2026-0023', fn: '전', gn: '성진', dob: '1980-10-10', gender: Gender.MALE, ins: InsuranceType.NHI, blood: 'A+', phone: '010-4040-5050' },
    { i: 24, mrn: 'P2026-0024', fn: '노', gn: '미영', dob: '1957-05-25', gender: Gender.FEMALE, ins: InsuranceType.NHI, blood: 'B-', phone: '010-5050-6060' },
    { i: 25, mrn: 'P2026-0025', fn: '구', gn: '현우', dob: '1991-12-12', gender: Gender.MALE, ins: InsuranceType.SELF_PAY, blood: 'O-', phone: '010-6060-7070' },
    { i: 26, mrn: 'P2026-0026', fn: '유', gn: '다은', dob: '2020-01-20', gender: Gender.FEMALE, ins: InsuranceType.NHI, blood: 'A+', phone: '010-7070-8080' },
    { i: 27, mrn: 'P2026-0027', fn: '남', gn: '기철', dob: '1963-08-14', gender: Gender.MALE, ins: InsuranceType.NHI, blood: 'AB-', phone: '010-8080-9090' },
    { i: 28, mrn: 'P2026-0028', fn: '하', gn: '윤아', dob: '1997-04-07', gender: Gender.FEMALE, ins: InsuranceType.NHI, blood: 'B+', phone: '010-9090-1010' },
    { i: 29, mrn: 'P2026-0029', fn: '장', gn: '우진', dob: '1974-06-30', gender: Gender.MALE, ins: InsuranceType.NHI, blood: 'O+', phone: '010-1212-3434' },
    { i: 30, mrn: 'P2026-0030', fn: '탁', gn: '예린', dob: '1986-09-09', gender: Gender.FEMALE, ins: InsuranceType.MEDICAID, blood: 'A-', phone: '010-3434-5656' },
  ];

  for (const p of patients) {
    await prisma.patient.upsert({
      where: { mrn: p.mrn },
      update: {},
      create: {
        id: uid(P.PATIENT, p.i),
        mrn: p.mrn,
        familyName: p.fn,
        givenName: p.gn,
        dateOfBirth: new Date(p.dob),
        gender: p.gender,
        insuranceType: p.ins,
        bloodType: p.blood,
        phone: p.phone,
        allergies: JSON.stringify([]),
        createdBy: adminId,
        updatedBy: adminId,
      },
    });
  }

  // ============================================================
  // 4. Diagnosis Codes (진단코드) — KCD-8, ICD-10, ICD-11
  // ============================================================
  console.log('  [4/10] Diagnosis Codes...');

  const diagnosisCodes = [
    // --- 호흡기계 (Respiratory) ---
    { code: 'J00', nameKo: '급성 비인두염[감기]', nameEn: 'Acute nasopharyngitis [common cold]', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J00', icd11Code: 'CA00' },
    { code: 'J06.9', nameKo: '급성 상기도감염, 상세불명', nameEn: 'Acute upper respiratory infection, unspecified', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J06.9', icd11Code: 'CA07.Y' },
    { code: 'J18.9', nameKo: '폐렴, 상세불명', nameEn: 'Pneumonia, unspecified', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J18.9', icd11Code: 'CA40.Z' },
    { code: 'J20', nameKo: '급성 기관지염', nameEn: 'Acute bronchitis', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J20', icd11Code: 'CA20' },
    { code: 'J45', nameKo: '천식', nameEn: 'Asthma', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J45', icd11Code: 'CA23' },
    { code: 'J44.1', nameKo: '급성 악화를 동반한 만성 폐쇄성 폐질환', nameEn: 'COPD with acute exacerbation', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J44.1', icd11Code: 'CA22.0' },

    // --- 소화기계 (Digestive) ---
    { code: 'K21', nameKo: '위-식도 역류병', nameEn: 'Gastro-oesophageal reflux disease', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K21', icd11Code: 'DA22' },
    { code: 'K29.5', nameKo: '만성 위염, 상세불명', nameEn: 'Chronic gastritis, unspecified', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K29.5', icd11Code: 'DA43.Z' },
    { code: 'K35', nameKo: '급성 충수염', nameEn: 'Acute appendicitis', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K35', icd11Code: 'DB10' },
    { code: 'K80', nameKo: '담석증', nameEn: 'Cholelithiasis', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K80', icd11Code: 'DC11' },
    { code: 'K25', nameKo: '위궤양', nameEn: 'Gastric ulcer', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K25', icd11Code: 'DA40' },
    { code: 'K59.0', nameKo: '변비', nameEn: 'Constipation', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K59.0', icd11Code: 'DD91' },

    // --- 순환기계 (Circulatory) ---
    { code: 'I10', nameKo: '본태성(원발성) 고혈압', nameEn: 'Essential (primary) hypertension', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I10', icd11Code: 'BA00' },
    { code: 'I20', nameKo: '협심증', nameEn: 'Angina pectoris', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I20', icd11Code: 'BA80' },
    { code: 'I21', nameKo: '급성 심근경색증', nameEn: 'Acute myocardial infarction', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I21', icd11Code: 'BA41' },
    { code: 'I50', nameKo: '심부전', nameEn: 'Heart failure', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I50', icd11Code: 'BD10' },
    { code: 'I63', nameKo: '뇌경색증', nameEn: 'Cerebral infarction', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I63', icd11Code: '8B11' },
    { code: 'I48', nameKo: '심방세동 및 심방조동', nameEn: 'Atrial fibrillation and flutter', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I48', icd11Code: 'BC81' },

    // --- 내분비계 (Endocrine) ---
    { code: 'E11', nameKo: '제2형 당뇨병', nameEn: 'Type 2 diabetes mellitus', category: '내분비계 질환', chapter: 'IV', icd10Code: 'E11', icd11Code: '5A11' },
    { code: 'E78', nameKo: '지질단백질대사장애 및 기타 지질혈증', nameEn: 'Disorders of lipoprotein metabolism', category: '내분비계 질환', chapter: 'IV', icd10Code: 'E78', icd11Code: '5C80' },
    { code: 'E03', nameKo: '기타 갑상선기능저하증', nameEn: 'Other hypothyroidism', category: '내분비계 질환', chapter: 'IV', icd10Code: 'E03', icd11Code: '5A00.1' },
    { code: 'E66', nameKo: '비만', nameEn: 'Obesity', category: '내분비계 질환', chapter: 'IV', icd10Code: 'E66', icd11Code: '5B81' },

    // --- 근골격계 (Musculoskeletal) ---
    { code: 'M54.5', nameKo: '요통', nameEn: 'Low back pain', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M54.5', icd11Code: 'ME84' },
    { code: 'M17', nameKo: '무릎관절증', nameEn: 'Gonarthrosis [arthrosis of knee]', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M17', icd11Code: 'FA01' },
    { code: 'M75.1', nameKo: '회전근개증후군', nameEn: 'Rotator cuff syndrome', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M75.1', icd11Code: 'FB40.0' },
    { code: 'M51', nameKo: '기타 추간판 장애', nameEn: 'Other intervertebral disc disorders', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M51', icd11Code: 'FA80' },

    // --- 손상/외인 (Injury) ---
    { code: 'S72', nameKo: '넙다리뼈의 골절', nameEn: 'Fracture of femur', category: '손상 및 외인', chapter: 'XIX', icd10Code: 'S72', icd11Code: 'NC72' },
    { code: 'S52', nameKo: '아래팔의 골절', nameEn: 'Fracture of forearm', category: '손상 및 외인', chapter: 'XIX', icd10Code: 'S52', icd11Code: 'NC52' },
    { code: 'S82', nameKo: '아래다리의 골절', nameEn: 'Fracture of lower leg', category: '손상 및 외인', chapter: 'XIX', icd10Code: 'S82', icd11Code: 'NC82' },
    { code: 'S06', nameKo: '두개내 손상', nameEn: 'Intracranial injury', category: '손상 및 외인', chapter: 'XIX', icd10Code: 'S06', icd11Code: 'NA07' },

    // --- 소아 (Pediatric common) ---
    { code: 'R50', nameKo: '달리 분류되지 않은 열', nameEn: 'Fever of other and unknown origin', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R50', icd11Code: 'MG26' },
    { code: 'A09', nameKo: '감염성 위장염 및 결장염, 상세불명', nameEn: 'Infectious gastroenteritis and colitis, unspecified', category: '감염성 질환', chapter: 'I', icd10Code: 'A09', icd11Code: '1A40' },
    { code: 'B34.9', nameKo: '바이러스 감염, 상세불명', nameEn: 'Viral infection, unspecified', category: '감염성 질환', chapter: 'I', icd10Code: 'B34.9', icd11Code: '1D6Y' },
    { code: 'J21', nameKo: '급성 세기관지염', nameEn: 'Acute bronchiolitis', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J21', icd11Code: 'CA21' },

    // --- 산부인과 (OB/GYN) ---
    { code: 'O80', nameKo: '자연 단태 만삭 분만', nameEn: 'Single spontaneous delivery', category: '임신/출산', chapter: 'XV', icd10Code: 'O80', icd11Code: 'JB20' },
    { code: 'N76', nameKo: '질 및 외음부의 기타 염증', nameEn: 'Other inflammation of vagina and vulva', category: '비뇨생식계 질환', chapter: 'XIV', icd10Code: 'N76', icd11Code: 'GA04' },
    { code: 'O82', nameKo: '제왕절개에 의한 단태 분만', nameEn: 'Single delivery by caesarean section', category: '임신/출산', chapter: 'XV', icd10Code: 'O82', icd11Code: 'JB22' },
    { code: 'N92', nameKo: '과다, 빈발 및 불규칙 월경', nameEn: 'Excessive, frequent and irregular menstruation', category: '비뇨생식계 질환', chapter: 'XIV', icd10Code: 'N92', icd11Code: 'GA20' },
    { code: 'D25', nameKo: '자궁의 평활근종', nameEn: 'Leiomyoma of uterus', category: '신생물', chapter: 'II', icd10Code: 'D25', icd11Code: '2F30' },

    // --- 정신과 (Mental) ---
    { code: 'F32', nameKo: '우울 에피소드', nameEn: 'Depressive episode', category: '정신 및 행동장애', chapter: 'V', icd10Code: 'F32', icd11Code: '6A70' },
    { code: 'F41', nameKo: '기타 불안장애', nameEn: 'Other anxiety disorders', category: '정신 및 행동장애', chapter: 'V', icd10Code: 'F41', icd11Code: '6B00' },
    { code: 'F51', nameKo: '비기질성 수면장애', nameEn: 'Nonorganic sleep disorders', category: '정신 및 행동장애', chapter: 'V', icd10Code: 'F51', icd11Code: '7A00' },

    // --- 비뇨기계 ---
    { code: 'N39.0', nameKo: '요로감염, 부위 불명', nameEn: 'Urinary tract infection, site not specified', category: '비뇨생식계 질환', chapter: 'XIV', icd10Code: 'N39.0', icd11Code: 'GC08' },
    { code: 'N20', nameKo: '신결석 및 요관결석', nameEn: 'Calculus of kidney and ureter', category: '비뇨생식계 질환', chapter: 'XIV', icd10Code: 'N20', icd11Code: 'GB40' },

    // --- 피부 ---
    { code: 'L30.9', nameKo: '피부염, 상세불명', nameEn: 'Dermatitis, unspecified', category: '피부 질환', chapter: 'XII', icd10Code: 'L30.9', icd11Code: 'EA80.Z' },
    { code: 'L50', nameKo: '두드러기', nameEn: 'Urticaria', category: '피부 질환', chapter: 'XII', icd10Code: 'L50', icd11Code: 'EB05' },

    // --- 눈 ---
    { code: 'H10', nameKo: '결막염', nameEn: 'Conjunctivitis', category: '눈 질환', chapter: 'VII', icd10Code: 'H10', icd11Code: '9A60' },

    // --- 귀 ---
    { code: 'H66', nameKo: '화농성 및 상세불명의 중이염', nameEn: 'Suppurative and unspecified otitis media', category: '귀 질환', chapter: 'VIII', icd10Code: 'H66', icd11Code: 'AB10' },

    // --- 신생물 ---
    { code: 'C34', nameKo: '기관지 및 폐의 악성 신생물', nameEn: 'Malignant neoplasm of bronchus and lung', category: '신생물', chapter: 'II', icd10Code: 'C34', icd11Code: '2C25' },
    { code: 'C50', nameKo: '유방의 악성 신생물', nameEn: 'Malignant neoplasm of breast', category: '신생물', chapter: 'II', icd10Code: 'C50', icd11Code: '2C6Z' },

    // --- 빈혈 ---
    { code: 'D50', nameKo: '철결핍성 빈혈', nameEn: 'Iron deficiency anaemia', category: '혈액 질환', chapter: 'III', icd10Code: 'D50', icd11Code: '3A00' },

    // ── 재활의학 ──
    { code: 'I63.9', nameKo: '뇌경색증, 상세불명', nameEn: 'Cerebral infarction, unspecified', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I63.9', icd11Code: '8B11.Z' },
    { code: 'G81', nameKo: '편마비', nameEn: 'Hemiplegia', category: '신경계 질환', chapter: 'VI', icd10Code: 'G81', icd11Code: '8B84' },
    { code: 'M51.1', nameKo: '요추 및 기타 추간판장애 — 신경근병증 동반', nameEn: 'Lumbar disc disorder with radiculopathy', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M51.1', icd11Code: 'FA81.1' },
    { code: 'Z96.6', nameKo: '정형외과적 관절 임플란트의 존재', nameEn: 'Presence of orthopaedic joint implants', category: '건강상태에 영향', chapter: 'XXI', icd10Code: 'Z96.6', icd11Code: 'QC4Y' },
    { code: 'S72.0', nameKo: '대퇴골경 골절', nameEn: 'Fracture of neck of femur', category: '손상/외인', chapter: 'XIX', icd10Code: 'S72.0', icd11Code: 'NC72.0' },
    { code: 'G82.2', nameKo: '하반신 마비, 상세불명', nameEn: 'Paraplegia, unspecified', category: '신경계 질환', chapter: 'VI', icd10Code: 'G82.2', icd11Code: '8B85' },
    { code: 'M62.8', nameKo: '기타 근육의 명시된 장애', nameEn: 'Other specified disorders of muscle', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M62.8', icd11Code: 'FB33.Y' },

    // ── 방사선종양학 ──
    { code: 'C50.9', nameKo: '유방의 악성 신생물, 상세불명', nameEn: 'Malignant neoplasm of breast, unspecified', category: '신생물', chapter: 'II', icd10Code: 'C50.9', icd11Code: '2C6Z' },
    { code: 'C34.1', nameKo: '상엽 기관지 및 폐의 악성 신생물', nameEn: 'Malignant neoplasm of upper lobe, bronchus or lung', category: '신생물', chapter: 'II', icd10Code: 'C34.1', icd11Code: '2C25.1' },
    { code: 'C53', nameKo: '자궁경부의 악성 신생물', nameEn: 'Malignant neoplasm of cervix uteri', category: '신생물', chapter: 'II', icd10Code: 'C53', icd11Code: '2C77' },
    { code: 'C61', nameKo: '전립선의 악성 신생물', nameEn: 'Malignant neoplasm of prostate', category: '신생물', chapter: 'II', icd10Code: 'C61', icd11Code: '2C82' },
    { code: 'C71', nameKo: '뇌의 악성 신생물', nameEn: 'Malignant neoplasm of brain', category: '신생물', chapter: 'II', icd10Code: 'C71', icd11Code: '2A00' },
    { code: 'C20', nameKo: '직장의 악성 신생물', nameEn: 'Malignant neoplasm of rectum', category: '신생물', chapter: 'II', icd10Code: 'C20', icd11Code: '2B91' },

    // ── 투석/신장 ──
    { code: 'N18.5', nameKo: '만성 신장병 5기 (말기신장병)', nameEn: 'Chronic kidney disease, stage 5 (ESRD)', category: '비뇨생식기 질환', chapter: 'XIV', icd10Code: 'N18.5', icd11Code: 'GB61.5' },
    { code: 'N18.4', nameKo: '만성 신장병 4기', nameEn: 'Chronic kidney disease, stage 4', category: '비뇨생식기 질환', chapter: 'XIV', icd10Code: 'N18.4', icd11Code: 'GB61.4' },
    { code: 'N18.3', nameKo: '만성 신장병 3기', nameEn: 'Chronic kidney disease, stage 3', category: '비뇨생식기 질환', chapter: 'XIV', icd10Code: 'N18.3', icd11Code: 'GB61.3' },
    { code: 'N17', nameKo: '급성 신부전', nameEn: 'Acute kidney failure', category: '비뇨생식기 질환', chapter: 'XIV', icd10Code: 'N17', icd11Code: 'GB60' },
    { code: 'E87.5', nameKo: '고칼륨혈증', nameEn: 'Hyperkalaemia', category: '내분비/대사 질환', chapter: 'IV', icd10Code: 'E87.5', icd11Code: '5C71.3' },
    { code: 'Z99.2', nameKo: '신장투석에 의존', nameEn: 'Dependence on renal dialysis', category: '건강상태에 영향', chapter: 'XXI', icd10Code: 'Z99.2', icd11Code: 'QC30.2' },

    // ── 혈액은행/수혈 ──
    { code: 'D64.9', nameKo: '빈혈, 상세불명', nameEn: 'Anaemia, unspecified', category: '혈액 질환', chapter: 'III', icd10Code: 'D64.9', icd11Code: '3A9Z' },
    { code: 'D69.6', nameKo: '혈소판감소증, 상세불명', nameEn: 'Thrombocytopenia, unspecified', category: '혈액 질환', chapter: 'III', icd10Code: 'D69.6', icd11Code: '3B60.Z' },
    { code: 'D65', nameKo: '파종성 혈관내응고 [DIC]', nameEn: 'Disseminated intravascular coagulation', category: '혈액 질환', chapter: 'III', icd10Code: 'D65', icd11Code: '3B10' },
    { code: 'D68.3', nameKo: '순환중인 항응고물질에 의한 출혈성 장애', nameEn: 'Haemorrhagic disorder due to circulating anticoagulants', category: '혈액 질환', chapter: 'III', icd10Code: 'D68.3', icd11Code: '3B12' },
    { code: 'T80.0', nameKo: '수혈에 따른 공기 색전증', nameEn: 'Air embolism following transfusion', category: '손상/외인', chapter: 'XIX', icd10Code: 'T80.0', icd11Code: 'NE80.0' },
    { code: 'T80.1', nameKo: '수혈과 관련된 혈관 합병증', nameEn: 'Vascular complications following transfusion', category: '손상/외인', chapter: 'XIX', icd10Code: 'T80.1', icd11Code: 'NE80.1' },

    // ── 다빈도 외래 상병 확충 (KCD-8) ──
    // 호흡기
    { code: 'J02.9', nameKo: '급성 인두염, 상세불명', nameEn: 'Acute pharyngitis, unspecified', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J02.9', icd11Code: 'CA02.Z' },
    { code: 'J03.9', nameKo: '급성 편도염, 상세불명', nameEn: 'Acute tonsillitis, unspecified', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J03.9', icd11Code: 'CA03.Z' },
    { code: 'J30.4', nameKo: '알레르기비염, 상세불명', nameEn: 'Allergic rhinitis, unspecified', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J30.4', icd11Code: 'CA08.0' },
    { code: 'J32.9', nameKo: '만성 부비동염, 상세불명', nameEn: 'Chronic sinusitis, unspecified', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J32.9', icd11Code: 'CA0A.Z' },
    { code: 'J35.1', nameKo: '편도의 비대', nameEn: 'Hypertrophy of tonsils', category: '호흡기계 질환', chapter: 'X', icd10Code: 'J35.1', icd11Code: 'CA0F.0' },
    // 소화기
    { code: 'K30', nameKo: '기능성 소화불량', nameEn: 'Functional dyspepsia', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K30', icd11Code: 'DD90.3' },
    { code: 'K52.9', nameKo: '비감염성 위장염 및 결장염, 상세불명', nameEn: 'Noninfective gastroenteritis and colitis, unspecified', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K52.9', icd11Code: 'DA9Z' },
    { code: 'K58.9', nameKo: '과민성 대장증후군', nameEn: 'Irritable bowel syndrome', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K58.9', icd11Code: 'DD91.0' },
    { code: 'K76.0', nameKo: '지방(변화)간, 달리 분류되지 않은', nameEn: 'Fatty liver, not elsewhere classified', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K76.0', icd11Code: 'DB92' },
    { code: 'K64', nameKo: '치핵 및 항문주위 정맥혈전증', nameEn: 'Haemorrhoids and perianal venous thrombosis', category: '소화기계 질환', chapter: 'XI', icd10Code: 'K64', icd11Code: 'DB60' },
    // 순환기
    { code: 'I11.9', nameKo: '고혈압성 심장병, 심부전 없는', nameEn: 'Hypertensive heart disease without heart failure', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I11.9', icd11Code: 'BA01.Z' },
    { code: 'I25.1', nameKo: '죽상경화성 심장병', nameEn: 'Atherosclerotic heart disease', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I25.1', icd11Code: 'BA5Z' },
    { code: 'I67.9', nameKo: '뇌혈관질환, 상세불명', nameEn: 'Cerebrovascular disease, unspecified', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I67.9', icd11Code: '8B2Z' },
    { code: 'I83.9', nameKo: '하지의 정맥류, 궤양이나 염증이 없는', nameEn: 'Varicose veins of lower extremities', category: '순환기계 질환', chapter: 'IX', icd10Code: 'I83.9', icd11Code: 'BD74.Z' },
    // 내분비/대사
    { code: 'E04.9', nameKo: '비독성 갑상선종, 상세불명', nameEn: 'Nontoxic goitre, unspecified', category: '내분비계 질환', chapter: 'IV', icd10Code: 'E04.9', icd11Code: '5A03.Z' },
    { code: 'E05.9', nameKo: '갑상선중독증, 상세불명', nameEn: 'Thyrotoxicosis, unspecified', category: '내분비계 질환', chapter: 'IV', icd10Code: 'E05.9', icd11Code: '5A02.Z' },
    { code: 'E86', nameKo: '용적 감소(탈수)', nameEn: 'Volume depletion', category: '내분비/대사 질환', chapter: 'IV', icd10Code: 'E86', icd11Code: '5C70' },
    // 근골격
    { code: 'M06.9', nameKo: '류마티스관절염, 상세불명', nameEn: 'Rheumatoid arthritis, unspecified', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M06.9', icd11Code: 'FA20.Z' },
    { code: 'M10.9', nameKo: '통풍, 상세불명', nameEn: 'Gout, unspecified', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M10.9', icd11Code: 'FA25.Z' },
    { code: 'M25.5', nameKo: '관절통', nameEn: 'Pain in joint', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M25.5', icd11Code: 'FA0Z' },
    { code: 'M79.1', nameKo: '근육통', nameEn: 'Myalgia', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M79.1', icd11Code: 'FB56.2' },
    { code: 'M48.0', nameKo: '척추협착', nameEn: 'Spinal stenosis', category: '근골격계 질환', chapter: 'XIII', icd10Code: 'M48.0', icd11Code: 'FA81.0' },
    // 신경
    { code: 'G40.9', nameKo: '간질, 상세불명', nameEn: 'Epilepsy, unspecified', category: '신경계 질환', chapter: 'VI', icd10Code: 'G40.9', icd11Code: '8A6Z' },
    { code: 'G43.9', nameKo: '편두통, 상세불명', nameEn: 'Migraine, unspecified', category: '신경계 질환', chapter: 'VI', icd10Code: 'G43.9', icd11Code: '8A80.Z' },
    { code: 'G47.0', nameKo: '수면개시 및 유지장애[불면증]', nameEn: 'Insomnia', category: '신경계 질환', chapter: 'VI', icd10Code: 'G47.0', icd11Code: '7A00' },
    { code: 'G56.0', nameKo: '손목굴증후군', nameEn: 'Carpal tunnel syndrome', category: '신경계 질환', chapter: 'VI', icd10Code: 'G56.0', icd11Code: '8C10.0' },
    // 감염
    { code: 'A41.9', nameKo: '패혈증, 상세불명', nameEn: 'Sepsis, unspecified', category: '감염성 질환', chapter: 'I', icd10Code: 'A41.9', icd11Code: '1G41' },
    { code: 'B02.9', nameKo: '합병증이 없는 대상포진', nameEn: 'Zoster without complication', category: '감염성 질환', chapter: 'I', icd10Code: 'B02.9', icd11Code: '1E91.Z' },
    { code: 'U07.1', nameKo: '코로나바이러스감염증-19, 바이러스 확인됨', nameEn: 'COVID-19, virus identified', category: '감염성 질환', chapter: 'XXII', icd10Code: 'U07.1', icd11Code: 'RA01.0' },
    // 비뇨/생식
    { code: 'N40', nameKo: '전립선의 증식증', nameEn: 'Hyperplasia of prostate', category: '비뇨생식계 질환', chapter: 'XIV', icd10Code: 'N40', icd11Code: 'GA90' },
    { code: 'N30.0', nameKo: '급성 방광염', nameEn: 'Acute cystitis', category: '비뇨생식계 질환', chapter: 'XIV', icd10Code: 'N30.0', icd11Code: 'GC00.0' },
    { code: 'N80.9', nameKo: '자궁내막증, 상세불명', nameEn: 'Endometriosis, unspecified', category: '비뇨생식계 질환', chapter: 'XIV', icd10Code: 'N80.9', icd11Code: 'GA10.Z' },
    { code: 'N95.1', nameKo: '폐경 및 여성 갱년기 상태', nameEn: 'Menopausal and female climacteric states', category: '비뇨생식계 질환', chapter: 'XIV', icd10Code: 'N95.1', icd11Code: 'GA30.0' },
    // 정신
    { code: 'F20.9', nameKo: '조현병, 상세불명', nameEn: 'Schizophrenia, unspecified', category: '정신 및 행동장애', chapter: 'V', icd10Code: 'F20.9', icd11Code: '6A20.Z' },
    { code: 'F31.9', nameKo: '양극성 정동장애, 상세불명', nameEn: 'Bipolar affective disorder, unspecified', category: '정신 및 행동장애', chapter: 'V', icd10Code: 'F31.9', icd11Code: '6A60.Z' },
    { code: 'F03', nameKo: '상세불명의 치매', nameEn: 'Unspecified dementia', category: '정신 및 행동장애', chapter: 'V', icd10Code: 'F03', icd11Code: '6D8Z' },
    // 안과/이비인후
    { code: 'H25.9', nameKo: '노년백내장, 상세불명', nameEn: 'Senile cataract, unspecified', category: '눈 질환', chapter: 'VII', icd10Code: 'H25.9', icd11Code: '9B10.2Z' },
    { code: 'H40.9', nameKo: '녹내장, 상세불명', nameEn: 'Glaucoma, unspecified', category: '눈 질환', chapter: 'VII', icd10Code: 'H40.9', icd11Code: '9C61.Z' },
    { code: 'H81.1', nameKo: '양성 돌발성 현기증(BPPV)', nameEn: 'Benign paroxysmal positional vertigo', category: '귀 질환', chapter: 'VIII', icd10Code: 'H81.1', icd11Code: 'AB31.0' },
    // 피부
    { code: 'L20.9', nameKo: '아토피성 피부염, 상세불명', nameEn: 'Atopic dermatitis, unspecified', category: '피부 질환', chapter: 'XII', icd10Code: 'L20.9', icd11Code: 'EA80.Z' },
    { code: 'L40.9', nameKo: '건선, 상세불명', nameEn: 'Psoriasis, unspecified', category: '피부 질환', chapter: 'XII', icd10Code: 'L40.9', icd11Code: 'EA90.Z' },
    { code: 'B35.9', nameKo: '백선증, 상세불명', nameEn: 'Dermatophytosis, unspecified', category: '감염성 질환', chapter: 'I', icd10Code: 'B35.9', icd11Code: '1F28.Z' },
    // 증상 및 징후 (R)
    { code: 'R05', nameKo: '기침', nameEn: 'Cough', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R05', icd11Code: 'MD12' },
    { code: 'R10.4', nameKo: '기타 및 상세불명의 복통', nameEn: 'Other and unspecified abdominal pain', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R10.4', icd11Code: 'MD81' },
    { code: 'R51', nameKo: '두통', nameEn: 'Headache', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R51', icd11Code: 'MB40' },
    { code: 'R42', nameKo: '어지럼 및 어지러움', nameEn: 'Dizziness and giddiness', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R42', icd11Code: 'MB48.0' },
    { code: 'R11', nameKo: '오심 및 구토', nameEn: 'Nausea and vomiting', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R11', icd11Code: 'MD90' },
    { code: 'R07.4', nameKo: '흉통, 상세불명', nameEn: 'Chest pain, unspecified', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R07.4', icd11Code: 'MD30.Z' },
    { code: 'R53', nameKo: '병감 및 피로', nameEn: 'Malaise and fatigue', category: '증상 및 징후', chapter: 'XVIII', icd10Code: 'R53', icd11Code: 'MG22' },
    // 건강상태 영향 (Z)
    { code: 'Z00.0', nameKo: '일반 성인 의학적 검사', nameEn: 'General adult medical examination', category: '건강상태에 영향', chapter: 'XXI', icd10Code: 'Z00.0', icd11Code: 'QA00' },
    { code: 'Z23', nameKo: '예방접종의 필요', nameEn: 'Need for immunization', category: '건강상태에 영향', chapter: 'XXI', icd10Code: 'Z23', icd11Code: 'QC00' },
  ];

  // KCD-8 codes
  for (const dc of diagnosisCodes) {
    await prisma.diagnosisCode.upsert({
      where: { codeSystem_code: { codeSystem: 'KCD-8', code: dc.code } },
      update: {},
      create: {
        codeSystem: 'KCD-8',
        code: dc.code,
        nameKo: dc.nameKo,
        nameEn: dc.nameEn,
        category: dc.category,
        chapter: dc.chapter,
        icd10Code: dc.icd10Code,
        icd11Code: dc.icd11Code,
        validFrom: new Date('2026-01-01'),
      },
    });
  }

  // ICD-10 cross-mapping (key codes)
  const icd10Subset = diagnosisCodes.filter(d =>
    ['J06.9', 'I10', 'E11', 'J00', 'K29.5', 'I21', 'I50', 'M54.5', 'F32', 'O80'].includes(d.code),
  );
  for (const dc of icd10Subset) {
    await prisma.diagnosisCode.upsert({
      where: { codeSystem_code: { codeSystem: 'ICD-10', code: dc.code } },
      update: {},
      create: {
        codeSystem: 'ICD-10',
        code: dc.code,
        nameKo: dc.nameKo,
        nameEn: dc.nameEn,
        category: dc.category,
        chapter: dc.chapter,
        icd11Code: dc.icd11Code,
        validFrom: new Date('2026-01-01'),
      },
    });
  }

  // ICD-11 cross-mapping (key codes)
  const icd11Codes = [
    { code: 'BA00', nameKo: '본태성 고혈압', nameEn: 'Essential hypertension', category: 'Diseases of the circulatory system', chapter: '11', icd10Code: 'I10' },
    { code: '5A11', nameKo: '제2형 당뇨병', nameEn: 'Type 2 diabetes mellitus', category: 'Endocrine diseases', chapter: '5', icd10Code: 'E11' },
    { code: 'CA00', nameKo: '급성 비인두염', nameEn: 'Acute nasopharyngitis', category: 'Diseases of the respiratory system', chapter: '12', icd10Code: 'J00' },
    { code: 'BA41', nameKo: '급성 심근경색증', nameEn: 'Acute myocardial infarction', category: 'Diseases of the circulatory system', chapter: '11', icd10Code: 'I21' },
    { code: '6A70', nameKo: '우울 에피소드', nameEn: 'Depressive episode', category: 'Mental disorders', chapter: '6', icd10Code: 'F32' },
  ];
  for (const dc of icd11Codes) {
    await prisma.diagnosisCode.upsert({
      where: { codeSystem_code: { codeSystem: 'ICD-11', code: dc.code } },
      update: {},
      create: {
        codeSystem: 'ICD-11',
        code: dc.code,
        nameKo: dc.nameKo,
        nameEn: dc.nameEn,
        category: dc.category,
        chapter: dc.chapter,
        icd10Code: dc.icd10Code,
        validFrom: new Date('2026-01-01'),
      },
    });
  }

  // ============================================================
  // 5. Procedure Codes (수가코드 / EDI) — 35 codes
  // ============================================================
  console.log('  [5/10] Procedure Codes...');

  const procedureCodes = [
    // 진찰료 — 🔴 (2026-10-20) 종전 이름표가 거꾸로였다(AA157 = "의원" · AA154 = "병원"). 고시 명칭은 AA154·AA254 = 의원,
    //    AA157·AA257 = 상급종합병원(운영 수가 마스터 2026-01-01 반영분과 대조). 의원 단가는 그 마스터 값 · 상급종합 기본 코드 단가는
    //    마스터에 없어(0) 지어내지 않는다(null = 모름). 진찰료 코드 선택은 종별 정본 — api `billing/consultation-code.ts`.
    { code: 'AA154', nameKo: '초진진찰료-의원', category: '진찰료', unitPrice: 18840, copayRate: 0.3 },
    { code: 'AA254', nameKo: '재진진찰료-의원', category: '진찰료', unitPrice: 13370, copayRate: 0.3 },
    { code: 'AA157', nameKo: '초진진찰료-상급종합병원', category: '진찰료', unitPrice: null, copayRate: 0.3 },
    { code: 'AA257', nameKo: '재진진찰료-상급종합병원', category: '진찰료', unitPrice: null, copayRate: 0.3 },

    // 검사료 — 혈액
    { code: 'E6541', nameKo: '일반혈액검사(CBC)', category: '검사료', unitPrice: 3890, copayRate: 0.3 },
    { code: 'E6561', nameKo: '간기능검사(AST/ALT)', category: '검사료', unitPrice: 5120, copayRate: 0.3 },
    { code: 'E6551', nameKo: '신장기능검사(BUN/Cr)', category: '검사료', unitPrice: 4560, copayRate: 0.3 },
    { code: 'E6571', nameKo: '혈당검사(Glucose)', category: '검사료', unitPrice: 1520, copayRate: 0.3 },
    { code: 'E6581', nameKo: '지질검사(TG/HDL/LDL)', category: '검사료', unitPrice: 7890, copayRate: 0.3 },
    // 오더 LOINC(loincCode)는 loinc.org 검증값 — 패널은 패널 LOINC(검체 축 반영). 사람 검증 후 세팅.
    { code: 'E6591', nameKo: 'HbA1c(당화혈색소)', category: '검사료', unitPrice: 6230, copayRate: 0.3, loincCode: '4548-4' },
    { code: 'E6502', nameKo: 'CRP(C-반응성 단백)', category: '검사료', unitPrice: 4780, copayRate: 0.3, loincCode: '1988-5' },
    { code: 'E6512', nameKo: '전해질검사(Na/K/Cl)', category: '검사료', unitPrice: 5340, copayRate: 0.3, loincCode: '24326-1' }, // Electrolytes panel - Ser/Plas
    { code: 'E6522', nameKo: '갑상선기능검사(TSH)', category: '검사료', unitPrice: 8950, copayRate: 0.3, loincCode: '3016-3' },
    { code: 'E6532', nameKo: 'PT/aPTT(혈액응고검사)', category: '검사료', unitPrice: 6120, copayRate: 0.3, loincCode: '34529-8' }, // PT and aPTT panel

    // 검사료 — 소변
    { code: 'E6601', nameKo: '일반뇨검사(UA)', category: '검사료', unitPrice: 1890, copayRate: 0.3, loincCode: '24356-8' }, // Urinalysis complete panel

    // 검사료 — 미생물
    { code: 'E6701', nameKo: '혈액배양검사', category: '검사료', unitPrice: 12560, copayRate: 0.3, loincCode: '600-7' },

    /**
     * 병리진단료 — 🔴 **단가를 지어내지 않는다**(2026-09-21 · 형제 프로젝트 인바운드 R55).
     *   종전 시드 코드 마스터에 병리 코드가 하나도 없어서, 새 설치본은 **병리 처방 자체를 낼 수 없었다**
     *   (HIS→LIS 병리 케이스·PACS 워크리스트를 시험하려면 코드를 손으로 넣어야 했다).
     *   접두(C55~C60·C85)는 이 저장소의 정본 `fhir/pathology-category.util.ts`
     *   `DEFAULT_PATHOLOGY_EDI_PREFIXES` 를 그대로 따른다 — 그 접두에 걸려야 FHIR 이 병리로 분류한다.
     *   🔴 다만 **뒤 두 자리와 수가는 고시에서 확인한 값이 아니다.** 그래서
     *     · `unitPrice`·`copayRate` 를 **넣지 않는다**(null = 단가 미상 — 0 원은 "무료"라는 다른 사실이다)
     *     · `origin` 을 비운다(HIRA 고시 반영도, 원내 등록도 아니다)
     *     · `categorySource: 'PREFIX_DERIVED'` — 이 분류는 **접두에서 유도**한 것이지 고시 분류가 아니다
     *   기관은 「고시 개정 일괄 반영」(코드 반입)으로 실제 코드·수가를 덮어쓴다.
     */
    { code: 'C5500', nameKo: '조직병리검사(일반)', category: '병리진단료', categorySource: 'PREFIX_DERIVED' },
    { code: 'C5600', nameKo: '세포병리검사(일반)', category: '병리진단료', categorySource: 'PREFIX_DERIVED' },
    { code: 'C8500', nameKo: '면역조직화학검사', category: '병리진단료', categorySource: 'PREFIX_DERIVED' },

    // 영상진단료
    { code: 'HA011', nameKo: '흉부 X-ray (PA)', category: '영상진단료', unitPrice: 8560, copayRate: 0.3 },
    { code: 'HA012', nameKo: '복부 X-ray (AP)', category: '영상진단료', unitPrice: 7890, copayRate: 0.3 },
    { code: 'HE101', nameKo: '뇌 CT (조영제 미사용)', category: '영상진단료', unitPrice: 142000, copayRate: 0.3 },
    { code: 'HE102', nameKo: '복부 CT (조영제 사용)', category: '영상진단료', unitPrice: 198000, copayRate: 0.3 },
    { code: 'HE103', nameKo: '흉부 CT', category: '영상진단료', unitPrice: 168000, copayRate: 0.3 },
    { code: 'HI101', nameKo: '뇌 MRI (조영제 미사용)', category: '영상진단료', unitPrice: 385000, copayRate: 0.3 },
    { code: 'HI102', nameKo: '무릎 MRI', category: '영상진단료', unitPrice: 352000, copayRate: 0.3 },
    { code: 'HI103', nameKo: '요추 MRI', category: '영상진단료', unitPrice: 365000, copayRate: 0.3 },
    { code: 'HG101', nameKo: '복부 초음파', category: '영상진단료', unitPrice: 48500, copayRate: 0.3 },
    { code: 'HG102', nameKo: '심장 초음파(심초음파)', category: '영상진단료', unitPrice: 89000, copayRate: 0.3 },
    { code: 'HG103', nameKo: '산전 초음파', category: '영상진단료', unitPrice: 52000, copayRate: 0.3 },

    // 처치료
    { code: 'M0111', nameKo: '창상봉합술(단순, 5cm 이하)', category: '처치료', unitPrice: 28900, copayRate: 0.3 },
    { code: 'M0121', nameKo: '드레싱(단순)', category: '처치료', unitPrice: 6780, copayRate: 0.3 },
    { code: 'M0131', nameKo: '석고붕대(단순)', category: '처치료', unitPrice: 32500, copayRate: 0.3 },
    { code: 'M0141', nameKo: '근육주사', category: '처치료', unitPrice: 4560, copayRate: 0.3 },
    { code: 'M0151', nameKo: '정맥주사(수액요법)', category: '처치료', unitPrice: 8920, copayRate: 0.3 },
    { code: 'M0161', nameKo: '도뇨(단순)', category: '처치료', unitPrice: 12300, copayRate: 0.3 },

    // 수술료
    { code: 'Q2861', nameKo: '충수절제술(복강경)', category: '수술료', unitPrice: 485000, copayRate: 0.2 },
    { code: 'R4507', nameKo: '제왕절개술', category: '수술료', unitPrice: 562000, copayRate: 0.2 },
    { code: 'N0601', nameKo: '대퇴골 골절 관혈적 정복술', category: '수술료', unitPrice: 785000, copayRate: 0.2 },

    // 이학요법료 (물리치료/재활)
    { code: 'MM101', nameKo: '온열치료(핫팩, 적외선)', category: '이학요법료', unitPrice: 4180, copayRate: 0.3 },
    { code: 'MM111', nameKo: '전기치료(경피전기신경자극)', category: '이학요법료', unitPrice: 5280, copayRate: 0.3 },
    { code: 'MM121', nameKo: '초음파치료', category: '이학요법료', unitPrice: 5630, copayRate: 0.3 },
    { code: 'MM201', nameKo: '도수치료(30분)', category: '이학요법료', unitPrice: 52800, copayRate: 0, insuranceCovered: false },
    { code: 'MM211', nameKo: '관절운동치료(ROM)', category: '이학요법료', unitPrice: 8950, copayRate: 0.3 },
    { code: 'MM221', nameKo: '보행훈련', category: '이학요법료', unitPrice: 12300, copayRate: 0.3 },
    { code: 'MM231', nameKo: '작업치료(일상생활동작)', category: '이학요법료', unitPrice: 15680, copayRate: 0.3 },
    { code: 'MM241', nameKo: '언어치료(30분)', category: '이학요법료', unitPrice: 28500, copayRate: 0.3 },
    { code: 'MM301', nameKo: '신장분사치료(체외충격파)', category: '이학요법료', unitPrice: 45000, copayRate: 0, insuranceCovered: false },

    // 정신요법료
    { code: 'NX011', nameKo: '개인 정신치료(30분)', category: '정신요법료', unitPrice: 48900, copayRate: 0.3 },
    { code: 'NX021', nameKo: '집단 정신치료', category: '정신요법료', unitPrice: 25600, copayRate: 0.3 },
    { code: 'NX031', nameKo: '인지행동치료(CBT, 50분)', category: '정신요법료', unitPrice: 68500, copayRate: 0.3 },
    { code: 'NX041', nameKo: '심리검사(종합)', category: '정신요법료', unitPrice: 125000, copayRate: 0.3 },
    { code: 'NX051', nameKo: '놀이치료(소아)', category: '정신요법료', unitPrice: 42000, copayRate: 0.3 },

    // 전혈·혈액대 (수혈/혈액제제)
    { code: 'X1001', nameKo: '농축적혈구(RBC) 1단위', category: '전혈·혈액대', unitPrice: 45000, copayRate: 0.3 },
    { code: 'X1002', nameKo: '신선동결혈장(FFP) 1단위', category: '전혈·혈액대', unitPrice: 38000, copayRate: 0.3 },
    { code: 'X1003', nameKo: '농축혈소판(PC) 1단위', category: '전혈·혈액대', unitPrice: 52000, copayRate: 0.3 },
    { code: 'X1004', nameKo: '전혈(Whole Blood) 1단위', category: '전혈·혈액대', unitPrice: 42000, copayRate: 0.3 },
    { code: 'X1005', nameKo: '동결침전제제(Cryo) 1단위', category: '전혈·혈액대', unitPrice: 35000, copayRate: 0.3 },
    { code: 'X2001', nameKo: '수혈행위료(1단위)', category: '전혈·혈액대', unitPrice: 12800, copayRate: 0.3 },
    { code: 'X2002', nameKo: '교차적합시험', category: '전혈·혈액대', unitPrice: 8900, copayRate: 0.3 },

    // 마취료
    { code: 'L1211', nameKo: '국소마취(침윤마취)', category: '마취료', unitPrice: 15600, copayRate: 0.3 },
    { code: 'L1221', nameKo: '전신마취(1시간 이내)', category: '마취료', unitPrice: 245000, copayRate: 0.2 },
    { code: 'L1231', nameKo: '척추마취', category: '마취료', unitPrice: 125000, copayRate: 0.2 },
    { code: 'L1241', nameKo: '경막외마취(무통분만)', category: '마취료', unitPrice: 185000, copayRate: 0.2 },

    // 주사료
    { code: 'KK011', nameKo: '피하·근육내 주사', category: '주사료', unitPrice: 4560, copayRate: 0.3 },
    { code: 'KK021', nameKo: '정맥내 주사', category: '주사료', unitPrice: 6780, copayRate: 0.3 },
    { code: 'KK031', nameKo: '정맥내 점적주사(수액요법)', category: '주사료', unitPrice: 8920, copayRate: 0.3 },
    { code: 'KK041', nameKo: '관절강내 주사', category: '주사료', unitPrice: 18500, copayRate: 0.3 },

    // 치료재료대
    { code: 'J0001', nameKo: '일회용 주사기', category: '치료재료대', unitPrice: 350, copayRate: 0 },
    { code: 'J0002', nameKo: '수액세트', category: '치료재료대', unitPrice: 1200, copayRate: 0 },
    { code: 'J0003', nameKo: '소독 거즈 (1팩)', category: '치료재료대', unitPrice: 890, copayRate: 0 },
    { code: 'J0004', nameKo: '석고붕대 재료', category: '치료재료대', unitPrice: 15600, copayRate: 0.3 },
    { code: 'J0005', nameKo: '봉합사(흡수성)', category: '치료재료대', unitPrice: 8500, copayRate: 0 },

    // 기초검사(생리기능검사) — 11종
    { code: 'E6011', nameKo: '심전도(12유도 EKG)', category: '기초검사', unitPrice: 11990, copayRate: 0.3 },
    { code: 'E6012', nameKo: '24시간 심전도(홀터)', category: '기초검사', unitPrice: 73260, copayRate: 0.3 },
    { code: 'F6100', nameKo: '뇌파검사(EEG)', category: '기초검사', unitPrice: 82340, copayRate: 0.3 },
    { code: 'F6110', nameKo: '수면다원검사(PSG)', category: '기초검사', unitPrice: 245800, copayRate: 0.3 },
    { code: 'E6593', nameKo: '폐기능검사(기본 PFT)', category: '기초검사', unitPrice: 18900, copayRate: 0.3 },
    { code: 'EB421', nameKo: '심초음파(Echo)', category: '기초검사', unitPrice: 77390, copayRate: 0.3 },
    { code: 'EB441', nameKo: '운동부하검사(TMT)', category: '기초검사', unitPrice: 54560, copayRate: 0.3 },
    { code: 'FA011', nameKo: '골밀도검사(DEXA)', category: '기초검사', unitPrice: 25130, copayRate: 0.3 },
    { code: 'E7631', nameKo: '상부위장관내시경', category: '기초검사', unitPrice: 47800, copayRate: 0.3 },
    { code: 'E7651', nameKo: '대장내시경', category: '기초검사', unitPrice: 62400, copayRate: 0.3 },
    { code: 'FA091', nameKo: '청력검사(순음)', category: '기초검사', unitPrice: 15230, copayRate: 0.3 },

    // ── 재활치료료 ──
    { code: 'MM101', nameKo: '중추신경계 발달재활치료(개별)', category: '재활치료료', unitPrice: 38500, copayRate: 0.3 },
    { code: 'MM111', nameKo: '복합운동치료(단순)', category: '재활치료료', unitPrice: 22400, copayRate: 0.3 },
    { code: 'MM112', nameKo: '복합운동치료(복잡)', category: '재활치료료', unitPrice: 33600, copayRate: 0.3 },
    { code: 'MM121', nameKo: '작업치료(단순)', category: '재활치료료', unitPrice: 18700, copayRate: 0.3 },
    { code: 'MM122', nameKo: '작업치료(복잡)', category: '재활치료료', unitPrice: 28500, copayRate: 0.3 },
    { code: 'MM131', nameKo: '언어치료', category: '재활치료료', unitPrice: 26800, copayRate: 0.3 },
    { code: 'MM141', nameKo: '연하재활치료(삼킴치료)', category: '재활치료료', unitPrice: 31200, copayRate: 0.3 },
    { code: 'MM201', nameKo: '도수치료(근막이완)', category: '재활치료료', unitPrice: 45000, copayRate: 1.0 },
    { code: 'MM211', nameKo: '열전기치료(단순)', category: '재활치료료', unitPrice: 8900, copayRate: 0.3 },
    { code: 'MM221', nameKo: '보행훈련', category: '재활치료료', unitPrice: 15600, copayRate: 0.3 },
    { code: 'MX221', nameKo: '재활기능평가(Barthel)', category: '재활치료료', unitPrice: 12800, copayRate: 0.3 },
    { code: 'MX222', nameKo: '재활기능평가(FIM)', category: '재활치료료', unitPrice: 15400, copayRate: 0.3 },

    // ── 방사선치료료 ──
    { code: 'HD011', nameKo: '외부방사선치료(단순조사)', category: '방사선치료료', unitPrice: 45600, copayRate: 0.05 },
    { code: 'HD012', nameKo: '외부방사선치료(3차원 입체조형)', category: '방사선치료료', unitPrice: 78900, copayRate: 0.05 },
    { code: 'HD013', nameKo: '세기변조방사선치료(IMRT)', category: '방사선치료료', unitPrice: 125000, copayRate: 0.05 },
    { code: 'HD014', nameKo: '정위방사선치료(SRS/SBRT)', category: '방사선치료료', unitPrice: 285000, copayRate: 0.05 },
    { code: 'HD021', nameKo: '방사선치료 계획수립(단순)', category: '방사선치료료', unitPrice: 95000, copayRate: 0.05 },
    { code: 'HD022', nameKo: '방사선치료 계획수립(복잡, CT시뮬)', category: '방사선치료료', unitPrice: 185000, copayRate: 0.05 },
    { code: 'HD031', nameKo: '근접치료(강내조사)', category: '방사선치료료', unitPrice: 198000, copayRate: 0.05 },
    { code: 'HD041', nameKo: '방사선치료 확인촬영(CBCT)', category: '방사선치료료', unitPrice: 32000, copayRate: 0.05 },

    // ── 투석치료료 ──
    { code: 'O7011', nameKo: '혈액투석(1회)', category: '투석치료료', unitPrice: 82620, copayRate: 0.1 },
    { code: 'O7012', nameKo: '혈액투석여과(HDF, 1회)', category: '투석치료료', unitPrice: 98400, copayRate: 0.1 },
    { code: 'O7013', nameKo: '지속적 신대체요법(CRRT, 1일)', category: '투석치료료', unitPrice: 185000, copayRate: 0.1 },
    { code: 'O7021', nameKo: '복막투석(CAPD, 1일)', category: '투석치료료', unitPrice: 42300, copayRate: 0.1 },
    { code: 'O7031', nameKo: '투석용 혈관접근로 조성(AVF)', category: '투석치료료', unitPrice: 385000, copayRate: 0.2 },
    { code: 'O7032', nameKo: '투석용 혈관접근로 조성(AVG)', category: '투석치료료', unitPrice: 520000, copayRate: 0.2 },
    { code: 'O7041', nameKo: '투석카테터 삽입(임시)', category: '투석치료료', unitPrice: 125000, copayRate: 0.2 },
    { code: 'E6551', nameKo: '신장기능검사(BUN/Cr)', category: '검사료', unitPrice: 4560, copayRate: 0.3 },
    { code: 'E6552', nameKo: 'Kt/V 측정(투석적정도)', category: '투석치료료', unitPrice: 8900, copayRate: 0.1 },

    // ── 혈액은행/수혈 ──
    { code: 'X1001', nameKo: '혈액형검사(ABO/Rh)', category: '수혈검사', unitPrice: 6780, copayRate: 0.3 },
    { code: 'X1002', nameKo: '교차적합시험(Crossmatch)', category: '수혈검사', unitPrice: 12400, copayRate: 0.3 },
    { code: 'X1003', nameKo: '비예기항체 선별검사', category: '수혈검사', unitPrice: 15600, copayRate: 0.3 },
    { code: 'X1004', nameKo: '직접항글로불린검사(DAT)', category: '수혈검사', unitPrice: 8900, copayRate: 0.3 },
    { code: 'X2001', nameKo: '농축적혈구 수혈(pRBC, 1단위)', category: '수혈료', unitPrice: 35000, copayRate: 0.2 },
    { code: 'X2002', nameKo: '신선동결혈장 수혈(FFP, 1단위)', category: '수혈료', unitPrice: 28000, copayRate: 0.2 },
    { code: 'X2003', nameKo: '혈소판 수혈(PC, 1단위)', category: '수혈료', unitPrice: 55000, copayRate: 0.2 },
    { code: 'X2004', nameKo: '동결침전제제 수혈(Cryo, 1단위)', category: '수혈료', unitPrice: 32000, copayRate: 0.2 },
    { code: 'X2005', nameKo: '수혈 부작용 관리료', category: '수혈료', unitPrice: 18500, copayRate: 0.3 },
  ];

  for (const pc of procedureCodes) {
    const loinc = (pc as any).loincCode as string | undefined;
    /**
     * 🔴 2026-08-28 — `where: { code }` 였다. `ProcedureCode.code` 의 단독 unique 는
     *    **2026-06-10 에 `(code, validFrom)` 복합키(수가 이력 temporal)로 바뀌었는데** 시드가 안 따라왔다.
     *    Prisma 는 unique 가 아닌 필드로 upsert 하면 검증 오류를 던진다 —
     *    즉 **`prisma db seed` 는 그날부터 이 줄에서 죽었다**(약 3개월).
     *    `@ts-nocheck` 때문에 컴파일러도 말해주지 못했다.
     */
    const VALID_FROM = new Date('2026-01-01');
    await prisma.procedureCode.upsert({
      where: { code_validFrom: { code: pc.code, validFrom: VALID_FROM } },
      // 기존 행은 보존하되, 검증된 오더 LOINC만 멱등 재적용(재시드·신규 DB 지속성 확보)
      update: loinc ? { loincCode: loinc } : {},
      create: {
        code: pc.code,
        nameKo: pc.nameKo,
        category: pc.category,
        // 🔴 단가·본인부담률은 **모르면 비운다**(null = 미상). 0 은 "무료"라는 다른 사실이다.
        unitPrice: (pc as any).unitPrice ?? null,
        copayRate: (pc as any).copayRate ?? null,
        insuranceCovered: (pc as any).insuranceCovered ?? true,
        // 분류의 출처 — 접두에서 유도한 분류를 고시 분류인 척하지 않는다(스키마 주석 참조)
        categorySource: (pc as any).categorySource ?? null,
        loincCode: loinc ?? null,
        validFrom: VALID_FROM,
      },
    });
  }

  // 오더 LOINC → 표준용어매핑 레지스트리 등록(loinc.org 검증·MANUAL). 결과코드(lab_test_codes)와 일관성.
  const orderLoincDisplay: Record<string, string> = {
    '1988-5': 'C reactive protein [Mass/volume] in Serum or Plasma',
    '24326-1': 'Electrolytes 1998 panel - Serum or Plasma',
    '3016-3': 'Thyrotropin [Units/volume] in Serum or Plasma',
    '34529-8': 'PT and aPTT panel - Platelet poor plasma',
    '4548-4': 'Hemoglobin A1c/Hemoglobin.total in Blood',
    '24356-8': 'Urinalysis complete panel - Urine',
    '600-7': 'Bacteria identified in Blood by Culture',
  };
  for (const pc of procedureCodes) {
    const loinc = (pc as any).loincCode as string | undefined;
    if (!loinc) continue;
    const proc = await prisma.procedureCode.findFirst({ where: { code: pc.code }, select: { id: true } });
    if (!proc) continue;
    await prisma.terminologyMapping.upsert({
      where: { sourceTable_sourceId_targetSystem_targetCode: { sourceTable: 'procedure_codes', sourceId: proc.id, targetSystem: 'LOINC', targetCode: loinc } },
      update: { targetDisplay: orderLoincDisplay[loinc] ?? pc.nameKo, isActive: true },
      create: { sourceTable: 'procedure_codes', sourceId: proc.id, sourceCode: pc.code, targetSystem: 'LOINC', targetCode: loinc, targetDisplay: orderLoincDisplay[loinc] ?? pc.nameKo, equivalence: 'equivalent', mapSource: 'MANUAL' },
    });
  }

  // ============================================================
  // 6. Medication Codes (약품코드) — 35 medications
  // ============================================================
  console.log('  [6/10] Medication Codes...');

  const medicationCodes = [
    // 진통/해열
    { code: 'M040702', nameKo: '타이레놀정 500mg', nameEn: 'Tylenol Tab 500mg', ingredient: 'Acetaminophen', manufacturer: '한국얀센', dosageForm: '정제', unit: 'mg', unitPrice: 68 },
    { code: 'M040703', nameKo: '부루펜정 400mg', nameEn: 'Brufen Tab 400mg', ingredient: 'Ibuprofen', manufacturer: '삼일제약', dosageForm: '정제', unit: 'mg', unitPrice: 85 },
    { code: 'M040704', nameKo: '트라몰정 50mg', nameEn: 'Tramol Tab 50mg', ingredient: 'Tramadol', manufacturer: '유한양행', dosageForm: '정제', unit: 'mg', unitPrice: 156 },
    { code: 'M040705', nameKo: '셀레브렉스캡슐 200mg', nameEn: 'Celebrex Cap 200mg', ingredient: 'Celecoxib', manufacturer: '한국화이자', dosageForm: '캡슐', unit: 'mg', unitPrice: 520 },

    // 항생제
    { code: 'M047801', nameKo: '아목시실린캡슐 500mg', nameEn: 'Amoxicillin Cap 500mg', ingredient: 'Amoxicillin', manufacturer: '종근당', dosageForm: '캡슐', unit: 'mg', unitPrice: 112 },
    { code: 'M047802', nameKo: '세파렉신캡슐 500mg', nameEn: 'Cephalexin Cap 500mg', ingredient: 'cefalexin', manufacturer: '대웅제약', dosageForm: '캡슐', unit: 'mg', unitPrice: 145 },
    { code: 'M047803', nameKo: '지스로맥스정 250mg', nameEn: 'Zithromax Tab 250mg', ingredient: 'Azithromycin', manufacturer: '한국화이자', dosageForm: '정제', unit: 'mg', unitPrice: 890 },
    { code: 'M047804', nameKo: '크라비트정 500mg', nameEn: 'Cravit Tab 500mg', ingredient: 'Levofloxacin', manufacturer: '제일약품', dosageForm: '정제', unit: 'mg', unitPrice: 1250 },
    { code: 'M047805', nameKo: '오구멘틴정 625mg', nameEn: 'Augmentin Tab 625mg', ingredient: 'Amoxicillin/Clavulanate', manufacturer: 'GSK', dosageForm: '정제', unit: 'mg', unitPrice: 385 },

    // 소화기
    { code: 'M065201', nameKo: '오메프라졸캡슐 20mg', nameEn: 'Omeprazole Cap 20mg', ingredient: 'Omeprazole', manufacturer: '한미약품', dosageForm: '캡슐', unit: 'mg', unitPrice: 178 },
    { code: 'M065202', nameKo: '파모티딘정 20mg', nameEn: 'Famotidine Tab 20mg', ingredient: 'Famotidine', manufacturer: '동아ST', dosageForm: '정제', unit: 'mg', unitPrice: 95 },
    { code: 'M065203', nameKo: '맥소롱정 5mg', nameEn: 'Macperan Tab 5mg', ingredient: 'Metoclopramide', manufacturer: '동화약품', dosageForm: '정제', unit: 'mg', unitPrice: 56 },
    { code: 'M065204', nameKo: '넥시움정 20mg', nameEn: 'Nexium Tab 20mg', ingredient: 'Esomeprazole', manufacturer: '한국아스트라제네카', dosageForm: '정제', unit: 'mg', unitPrice: 685 },
    { code: 'M065205', nameKo: '둘코락스정 5mg', nameEn: 'Dulcolax Tab 5mg', ingredient: 'bisacodyl', manufacturer: '사노피', dosageForm: '정제', unit: 'mg', unitPrice: 42 },

    // 심혈관
    { code: 'M091501', nameKo: '로사르탄정 50mg', nameEn: 'Losartan Tab 50mg', ingredient: 'Losartan', manufacturer: '대웅제약', dosageForm: '정제', unit: 'mg', unitPrice: 285 },
    { code: 'M091502', nameKo: '노바스크정 5mg', nameEn: 'Norvasc Tab 5mg', ingredient: 'Amlodipine', manufacturer: '한국화이자', dosageForm: '정제', unit: 'mg', unitPrice: 310 },
    { code: 'M091503', nameKo: '리피토정 20mg', nameEn: 'Lipitor Tab 20mg', ingredient: 'Atorvastatin', manufacturer: '한국화이자', dosageForm: '정제', unit: 'mg', unitPrice: 520 },
    { code: 'M091504', nameKo: '아스피린프로텍트정 100mg', nameEn: 'Aspirin Protect Tab 100mg', ingredient: 'acetylsalicylic acid', manufacturer: '바이엘', dosageForm: '장용정', unit: 'mg', unitPrice: 78 },
    { code: 'M091505', nameKo: '플라빅스정 75mg', nameEn: 'Plavix Tab 75mg', ingredient: 'Clopidogrel', manufacturer: '사노피', dosageForm: '정제', unit: 'mg', unitPrice: 1680 },
    { code: 'M091506', nameKo: '코자정 50/12.5mg', nameEn: 'Cozaar Plus Tab', ingredient: 'Losartan/Hydrochlorothiazide', manufacturer: 'MSD', dosageForm: '정제', unit: 'mg', unitPrice: 485 },
    { code: 'M091507', nameKo: '콩코르정 5mg', nameEn: 'Concor Tab 5mg', ingredient: 'Bisoprolol', manufacturer: '머크', dosageForm: '정제', unit: 'mg', unitPrice: 345 },

    // 당뇨
    { code: 'M082301', nameKo: '글루코파지정 500mg', nameEn: 'Glucophage Tab 500mg', ingredient: 'Metformin', manufacturer: '머크', dosageForm: '정제', unit: 'mg', unitPrice: 32 },
    { code: 'M082302', nameKo: '아마릴정 2mg', nameEn: 'Amaryl Tab 2mg', ingredient: 'Glimepiride', manufacturer: '사노피', dosageForm: '정제', unit: 'mg', unitPrice: 245 },
    { code: 'M082303', nameKo: '자누비아정 100mg', nameEn: 'Januvia Tab 100mg', ingredient: 'Sitagliptin', manufacturer: 'MSD', dosageForm: '정제', unit: 'mg', unitPrice: 1250 },

    // 알레르기/호흡기
    { code: 'M073101', nameKo: '지르텍정 10mg', nameEn: 'Zyrtec Tab 10mg', ingredient: 'Cetirizine', manufacturer: 'UCB', dosageForm: '정제', unit: 'mg', unitPrice: 125 },
    { code: 'M073102', nameKo: '싱귤레어정 10mg', nameEn: 'Singulair Tab 10mg', ingredient: 'Montelukast', manufacturer: 'MSD', dosageForm: '정제', unit: 'mg', unitPrice: 680 },

    // 스테로이드
    { code: 'M085601', nameKo: '소론도정 5mg', nameEn: 'Solondo Tab 5mg', ingredient: 'Prednisolone', manufacturer: '유한메디카', dosageForm: '정제', unit: 'mg', unitPrice: 18 },

    // 정신과
    { code: 'M094201', nameKo: '렉사프로정 10mg', nameEn: 'Lexapro Tab 10mg', ingredient: 'Escitalopram', manufacturer: '한국룬드벡', dosageForm: '정제', unit: 'mg', unitPrice: 890 },
    { code: 'M094202', nameKo: '스틸녹스정 10mg', nameEn: 'Stilnox Tab 10mg', ingredient: 'Zolpidem', manufacturer: '사노피', dosageForm: '정제', unit: 'mg', unitPrice: 420 },
    { code: 'M094203', nameKo: '알프람정 0.25mg', nameEn: 'Alpram Tab 0.25mg', ingredient: 'Alprazolam', manufacturer: '환인제약', dosageForm: '정제', unit: 'mg', unitPrice: 35 },

    // 주사제
    { code: 'M099901', nameKo: '생리식염수 주사액 1000mL', nameEn: 'Normal Saline Inj 1000mL', ingredient: 'sodium chloride', manufacturer: 'JW중외', dosageForm: '주사', unit: 'mL', unitPrice: 1850 },
    { code: 'M099902', nameKo: '하트만용액 1000mL', nameEn: 'Hartmann Solution 1000mL', ingredient: '복합전해질', manufacturer: 'JW중외', dosageForm: '주사', unit: 'mL', unitPrice: 2100 },
    { code: 'M099903', nameKo: '세프트리악손 주사 1g', nameEn: 'Ceftriaxone Inj 1g', ingredient: 'Ceftriaxone', manufacturer: '종근당', dosageForm: '주사', unit: 'g', unitPrice: 3200 },

    // ── 투석 관련 약물 ──
    { code: 'M200101', nameKo: '헤파린나트륨 주사 5000IU', nameEn: 'Heparin Sodium Inj 5000IU', ingredient: 'Heparin', manufacturer: '녹십자', dosageForm: '주사', unit: 'IU', unitPrice: 2800 },
    { code: 'M200102', nameKo: '달테파린나트륨(프라그민) 5000IU', nameEn: 'Fragmin Inj 5000IU', ingredient: 'dalteparin sodium', manufacturer: '화이자', dosageForm: '주사', unit: 'IU', unitPrice: 8500 },
    { code: 'M200201', nameKo: '에리스로포이에틴(에포젠) 4000IU', nameEn: 'Epogen Inj 4000IU', ingredient: 'Epoetin alfa', manufacturer: 'CJ', dosageForm: '주사', unit: 'IU', unitPrice: 15600 },
    { code: 'M200301', nameKo: '다르베포에틴(아라네스프) 60mcg', nameEn: 'Aranesp Inj 60mcg', ingredient: 'darbepoetin alfa', manufacturer: '암젠', dosageForm: '주사', unit: 'mcg', unitPrice: 42000 },
    { code: 'M200401', nameKo: '칼시트리올(로칼트롤) 0.25mcg', nameEn: 'Rocaltrol Cap 0.25mcg', ingredient: 'calcitriol', manufacturer: '로슈', dosageForm: '캡슐', unit: 'mcg', unitPrice: 850 },
    { code: 'M200501', nameKo: '세벨라머(레나젤) 800mg', nameEn: 'Renagel Tab 800mg', ingredient: 'sevelamer', manufacturer: '사노피', dosageForm: '정', unit: 'mg', unitPrice: 1200 },

    // ── 항암/방사선 관련 ──
    { code: 'M300101', nameKo: '시스플라틴 주사 50mg', nameEn: 'Cisplatin Inj 50mg', ingredient: 'Cisplatin', manufacturer: '종근당', dosageForm: '주사', unit: 'mg', unitPrice: 18500 },
    { code: 'M300102', nameKo: '카보플라틴 주사 450mg', nameEn: 'Carboplatin Inj 450mg', ingredient: 'carboplatin', manufacturer: '대웅', dosageForm: '주사', unit: 'mg', unitPrice: 45000 },
    { code: 'M300201', nameKo: '타목시펜(놀바덱스) 20mg', nameEn: 'Nolvadex Tab 20mg', ingredient: 'tamoxifen citrate', manufacturer: '아스트라제네카', dosageForm: '정', unit: 'mg', unitPrice: 1500 },
    { code: 'M300301', nameKo: '온단세트론(조프란) 4mg', nameEn: 'Zofran Inj 4mg', ingredient: 'Ondansetron', manufacturer: 'GSK', dosageForm: '주사', unit: 'mg', unitPrice: 5200 },
    { code: 'M300401', nameKo: '덱사메타손 주사 5mg', nameEn: 'Dexamethasone Inj 5mg', ingredient: 'Dexamethasone', manufacturer: '유한', dosageForm: '주사', unit: 'mg', unitPrice: 1800 },

    // ── 혈액제제 ──
    { code: 'M400101', nameKo: '농축적혈구(pRBC) 320mL', nameEn: 'Packed Red Blood Cells 320mL', ingredient: '적혈구', manufacturer: '대한적십자사', dosageForm: '혈액제제', unit: 'mL', unitPrice: 35000 },
    { code: 'M400102', nameKo: '신선동결혈장(FFP) 200mL', nameEn: 'Fresh Frozen Plasma 200mL', ingredient: '혈장', manufacturer: '대한적십자사', dosageForm: '혈액제제', unit: 'mL', unitPrice: 28000 },
    { code: 'M400103', nameKo: '혈소판농축액(PC) 50mL', nameEn: 'Platelet Concentrate 50mL', ingredient: '혈소판', manufacturer: '대한적십자사', dosageForm: '혈액제제', unit: 'mL', unitPrice: 55000 },
    { code: 'M400104', nameKo: '동결침전제제(Cryo) 30mL', nameEn: 'Cryoprecipitate 30mL', ingredient: '응고인자(VIII/피브리노겐)', manufacturer: '대한적십자사', dosageForm: '혈액제제', unit: 'mL', unitPrice: 32000 },

    // ── 재활 보조 약물 ──
    { code: 'M500101', nameKo: '바클로펜(리오레살) 10mg', nameEn: 'Lioresal Tab 10mg', ingredient: 'Baclofen', manufacturer: '노바티스', dosageForm: '정', unit: 'mg', unitPrice: 650 },
    { code: 'M500201', nameKo: '보톡스 주사 100단위', nameEn: 'Botox Inj 100U', ingredient: 'botulinum toxin type A', manufacturer: '앨러간', dosageForm: '주사', unit: 'U', unitPrice: 385000 },
    { code: 'M500301', nameKo: '가바펜틴(뉴론틴) 300mg', nameEn: 'Neurontin Cap 300mg', ingredient: 'Gabapentin', manufacturer: '화이자', dosageForm: '캡슐', unit: 'mg', unitPrice: 780 },
  ];

  /**
   * 데모 약품 효능 분류(2026-10-27) — 🔴 종전엔 이 47종 전부 분류가 비어 있었다. 그래서 진통제 판정(통증 재평가 v4.124)이
   * 데모 투약 365건을 전부 "분류 모름"으로 셌다(타이레놀·부루펜·트라몰도).
   * 근거: 운영 약품 마스터에서 **같은 성분 실제 품목**의 효능 분류(2026-10-27 실측) — 한 분류가 90% 이상이고 표본 3개 이상일 때만.
   * 그 밖(점안제 분류가 섞인 레보플록사신·프레드니솔론·덱사메타손, 섞인 암로디핀·비소프롤롤·칼시트리올, 표본 없는 성분·혈액제제)은
   * **비워 둔다** — 분류를 지어내지 않는다.
   */
  const SEED_MED_CATEGORY: Record<string, string> = {
    M040702: '해열·진통·소염제', M040703: '해열·진통·소염제', M040704: '해열·진통·소염제', M040705: '해열·진통·소염제',
    M047801: '항생물질(페니실린계 등)', M047803: '항생물질(마이코플라스마)', M047805: '항생물질(페니실린계 등)', M099903: '항생물질(페니실린계 등)',
    M065201: '소화성궤양용제', M065202: '소화성궤양용제', M065203: '기타 소화기관용약', M065204: '소화성궤양용제',
    M091501: '혈압강하제', M091503: '동맥경화용제', M091505: '동맥경화용제', M091506: '혈압강하제',
    M082301: '당뇨병용제', M082302: '당뇨병용제', M082303: '당뇨병용제',
    M073101: '항히스타민제', M073102: '기타 알레르기용약',
    M094201: '정신신경용제', M094202: '최면진정제', M094203: '정신신경용제',
    M099901: '혈액대용제', M200101: '혈액응고저지제', M200102: '혈액응고저지제', M200501: '기타 순환계용약',
    M300101: '항악성종양제', M300102: '항악성종양제', M300201: '항악성종양제', M300301: '하제·완장제',
    M500101: '골격근이완제', M500301: '항전간제',
  };
  for (const mc of medicationCodes) {
    const category = SEED_MED_CATEGORY[mc.code] ?? null;
    await prisma.medicationCode.upsert({
      where: { code: mc.code },
      update: {},
      create: { ...mc, category, validFrom: new Date('2026-01-01') },
    });
    // 이미 있는 행 — 분류가 비어 있을 때만 채운다(사람이 넣은 분류를 덮지 않는다)
    if (category) await prisma.medicationCode.updateMany({ where: { code: mc.code, category: null }, data: { category } });
  }

  // ============================================================
  // 7. Staff Records (인사기록) — linked to users
  // ============================================================
  console.log('  [7/10] Staff Records...');

  const staffRecords = [
    { i: 1, userId: uid(P.USER, 1), empNo: 'EMP-2020-001', fn: '관리', gn: '자', cat: StaffCategory.ADMIN, dept: '원무과', pos: '과장', license: null, specialty: null, hire: '2020-03-01' },
    { i: 2, userId: uid(P.USER, 2), empNo: 'EMP-2018-002', fn: '김', gn: '내과', cat: StaffCategory.MEDICAL, dept: '내과', pos: '전문의', license: 'MD-2018-12345', specialty: '소화기내과', hire: '2018-09-01' },
    { i: 3, userId: uid(P.USER, 3), empNo: 'EMP-2019-003', fn: '박', gn: '내과', cat: StaffCategory.MEDICAL, dept: '내과', pos: '전문의', license: 'MD-2019-23456', specialty: '호흡기내과', hire: '2019-03-01' },
    { i: 4, userId: uid(P.USER, 4), empNo: 'EMP-2017-004', fn: '이', gn: '외과', cat: StaffCategory.MEDICAL, dept: '외과', pos: '과장', license: 'MD-2017-34567', specialty: '일반외과', hire: '2017-06-01' },
    { i: 5, userId: uid(P.USER, 5), empNo: 'EMP-2020-005', fn: '최', gn: '외과', cat: StaffCategory.MEDICAL, dept: '외과', pos: '전문의', license: 'MD-2020-45678', specialty: '일반외과', hire: '2020-09-01' },
    { i: 6, userId: uid(P.USER, 6), empNo: 'EMP-2021-006', fn: '정', gn: '소아', cat: StaffCategory.MEDICAL, dept: '소아청소년과', pos: '전문의', license: 'MD-2021-56789', specialty: '소아감염', hire: '2021-03-01' },
    { i: 7, userId: uid(P.USER, 7), empNo: 'EMP-2019-007', fn: '한', gn: '산부', cat: StaffCategory.MEDICAL, dept: '산부인과', pos: '전문의', license: 'MD-2019-67890', specialty: '산과', hire: '2019-09-01' },
    { i: 8, userId: uid(P.USER, 8), empNo: 'EMP-2018-008', fn: '오', gn: '정형', cat: StaffCategory.MEDICAL, dept: '정형외과', pos: '과장', license: 'MD-2018-78901', specialty: '관절/척추', hire: '2018-03-01' },
    { i: 9, userId: uid(P.USER, 9), empNo: 'EMP-2020-009', fn: '강', gn: '응급', cat: StaffCategory.MEDICAL, dept: '응급의학과', pos: '전문의', license: 'MD-2020-89012', specialty: '응급의학', hire: '2020-06-01' },
    { i: 10, userId: uid(P.USER, 10), empNo: 'EMP-2019-010', fn: '조', gn: '간호', cat: StaffCategory.MEDICAL, dept: '간호부 (내과병동)', pos: '수간호사', license: 'RN-2015-10001', specialty: null, hire: '2019-01-01' },
    { i: 11, userId: uid(P.USER, 11), empNo: 'EMP-2021-011', fn: '윤', gn: '간호', cat: StaffCategory.MEDICAL, dept: '간호부 (외과병동)', pos: '간호사', license: 'RN-2020-20002', specialty: null, hire: '2021-03-01' },
    { i: 12, userId: uid(P.USER, 12), empNo: 'EMP-2022-012', fn: '황', gn: '간호', cat: StaffCategory.MEDICAL, dept: '간호부 (응급실)', pos: '간호사', license: 'RN-2021-30003', specialty: null, hire: '2022-01-01' },
    { i: 13, userId: uid(P.USER, 13), empNo: 'EMP-2020-013', fn: '서', gn: '간호', cat: StaffCategory.MEDICAL, dept: '간호부 (소아병동)', pos: '간호사', license: 'RN-2019-40004', specialty: null, hire: '2020-09-01' },
    { i: 14, userId: uid(P.USER, 14), empNo: 'EMP-2018-014', fn: '임', gn: '약사', cat: StaffCategory.MEDICAL, dept: '약제부', pos: '약사', license: 'PH-2017-50005', specialty: '임상약학', hire: '2018-06-01' },
    { i: 15, userId: uid(P.USER, 15), empNo: 'EMP-2019-015', fn: '문', gn: '검사', cat: StaffCategory.TECHNICAL, dept: '진단검사의학과', pos: '임상병리사', license: 'MT-2018-60006', specialty: '혈액학', hire: '2019-06-01' },
    { i: 16, userId: uid(P.USER, 16), empNo: 'EMP-2020-016', fn: '이', gn: '원무', cat: StaffCategory.ADMIN, dept: '원무과', pos: '원무과장', license: null, specialty: '수납/접수', hire: '2020-03-01' },
    { i: 17, userId: uid(P.USER, 17), empNo: 'EMP-2021-017', fn: '박', gn: '행정', cat: StaffCategory.ADMIN, dept: '행정부', pos: '행정과장', license: null, specialty: '병원행정', hire: '2021-01-15' },
    { i: 18, userId: uid(P.USER, 18), empNo: 'EMP-2022-018', fn: '김', gn: '급양', cat: StaffCategory.SUPPORT, dept: '급양실', pos: '급양실장', license: null, specialty: '영양관리', hire: '2022-05-01' },
    { i: 19, userId: uid(P.USER, 19), empNo: 'EMP-2023-019', fn: '최', gn: '의무기록', cat: StaffCategory.ADMIN, dept: '의무기록실', pos: '의무기록사', license: 'MR-2022-70001', specialty: '의무기록관리', hire: '2023-02-01' },
    // ── 진료과별 Staff 매핑 ──
    { i: 20, userId: uid(P.USER, 20), empNo: 'DR-020', fn: '윤', gn: '소화', cat: StaffCategory.MEDICAL, dept: '내과', pos: '전문의', license: 'MD-DR-020', specialty: '소화기내과', hire: '2025-03-01' },
    { i: 21, userId: uid(P.USER, 21), empNo: 'DR-021', fn: '서', gn: '내분비', cat: StaffCategory.MEDICAL, dept: '내과', pos: '전문의', license: 'MD-DR-021', specialty: '내분비내과', hire: '2025-03-01' },
    { i: 22, userId: uid(P.USER, 22), empNo: 'DR-022', fn: '임', gn: '신장', cat: StaffCategory.MEDICAL, dept: '내과', pos: '전문의', license: 'MD-DR-022', specialty: '신장내과', hire: '2025-06-01' },
    { i: 23, userId: uid(P.USER, 23), empNo: 'DR-023', fn: '강', gn: '혈액', cat: StaffCategory.MEDICAL, dept: '내과', pos: '전문의', license: 'MD-DR-023', specialty: '혈액종양내과', hire: '2025-06-01' },
    { i: 24, userId: uid(P.USER, 24), empNo: 'DR-024', fn: '송', gn: '감염', cat: StaffCategory.MEDICAL, dept: '내과', pos: '전문의', license: 'MD-DR-024', specialty: '감염내과', hire: '2025-09-01' },
    { i: 25, userId: uid(P.USER, 25), empNo: 'DR-025', fn: '조', gn: '류마', cat: StaffCategory.MEDICAL, dept: '내과', pos: '전문의', license: 'MD-DR-025', specialty: '류마티스내과', hire: '2025-09-01' },
    { i: 26, userId: uid(P.USER, 26), empNo: 'DR-026', fn: '백', gn: '신경', cat: StaffCategory.MEDICAL, dept: '신경외과', pos: '전문의', license: 'MD-DR-026', specialty: '신경외과', hire: '2025-03-01' },
    { i: 27, userId: uid(P.USER, 27), empNo: 'DR-027', fn: '고', gn: '성형', cat: StaffCategory.MEDICAL, dept: '성형외과', pos: '전문의', license: 'MD-DR-027', specialty: '성형외과', hire: '2025-06-01' },
    { i: 28, userId: uid(P.USER, 28), empNo: 'DR-028', fn: '문', gn: '정신', cat: StaffCategory.MEDICAL, dept: '정신건강의학과', pos: '전문의', license: 'MD-DR-028', specialty: '정신건강의학', hire: '2025-06-01' },
    { i: 29, userId: uid(P.USER, 29), empNo: 'DR-029', fn: '양', gn: '안과', cat: StaffCategory.MEDICAL, dept: '안과', pos: '전문의', license: 'MD-DR-029', specialty: '안과', hire: '2025-09-01' },
    { i: 30, userId: uid(P.USER, 30), empNo: 'DR-030', fn: '배', gn: '이비인후', cat: StaffCategory.MEDICAL, dept: '이비인후과', pos: '전문의', license: 'MD-DR-030', specialty: '이비인후과', hire: '2025-09-01' },
    { i: 31, userId: uid(P.USER, 31), empNo: 'DR-031', fn: '노', gn: '피부', cat: StaffCategory.MEDICAL, dept: '피부과', pos: '전문의', license: 'MD-DR-031', specialty: '피부과', hire: '2025-03-01' },
    { i: 32, userId: uid(P.USER, 32), empNo: 'DR-032', fn: '하', gn: '비뇨', cat: StaffCategory.MEDICAL, dept: '비뇨의학과', pos: '전문의', license: 'MD-DR-032', specialty: '비뇨의학', hire: '2025-06-01' },
    { i: 33, userId: uid(P.USER, 33), empNo: 'DR-033', fn: '전', gn: '재활', cat: StaffCategory.MEDICAL, dept: '재활의학과', pos: '전문의', license: 'MD-DR-033', specialty: '재활의학', hire: '2025-06-01' },
    { i: 44, userId: uid(P.USER, 44), empNo: 'DR-044', fn: '신', gn: '치과', cat: StaffCategory.MEDICAL, dept: '치과', pos: '전문의', license: 'MD-DR-044', specialty: '보존과', hire: '2025-09-01' },
    { i: 34, userId: uid(P.USER, 34), empNo: 'DR-034', fn: '황', gn: '가정', cat: StaffCategory.MEDICAL, dept: '가정의학과', pos: '전문의', license: 'MD-DR-034', specialty: '가정의학', hire: '2025-03-01' },
    { i: 35, userId: uid(P.USER, 35), empNo: 'DR-035', fn: '구', gn: '마취', cat: StaffCategory.MEDICAL, dept: '마취통증의학과', pos: '전문의', license: 'MD-DR-035', specialty: '마취통증의학', hire: '2025-06-01' },
    { i: 36, userId: uid(P.USER, 36), empNo: 'DR-036', fn: '유', gn: '영상', cat: StaffCategory.MEDICAL, dept: '영상의학과', pos: '전문의', license: 'MD-DR-036', specialty: '영상의학', hire: '2025-03-01' },
    { i: 37, userId: uid(P.USER, 37), empNo: 'DR-037', fn: '권', gn: '병리', cat: StaffCategory.MEDICAL, dept: '병리과', pos: '전문의', license: 'MD-DR-037', specialty: '병리', hire: '2025-06-01' },
    { i: 38, userId: uid(P.USER, 38), empNo: 'NR-038', fn: '민', gn: '간호', cat: StaffCategory.MEDICAL, dept: '간호부', pos: '간호사', license: 'RN-NR-038', specialty: null, hire: '2025-03-01' },
    { i: 39, userId: uid(P.USER, 39), empNo: 'PH-039', fn: '남', gn: '약사', cat: StaffCategory.MEDICAL, dept: '약제과', pos: '약사', license: 'PH-PH-039', specialty: null, hire: '2025-03-01' },
    { i: 40, userId: uid(P.USER, 40), empNo: 'MT-040', fn: '진', gn: '검사', cat: StaffCategory.TECHNICAL, dept: '진단검사의학과', pos: '임상병리사', license: 'MT-MT-040', specialty: null, hire: '2025-03-01' },
    // ── 병동 간호사 Staff 매핑 ──
    { i: 45, userId: uid(P.USER, 45), empNo: 'NRS-001', fn: '김', gn: 'ICU간호', cat: StaffCategory.MEDICAL, dept: '간호부 (ICU)', pos: '중환자실 간호사', license: 'RN-2018-50001', specialty: '중환자간호', hire: '2018-03-01' },
    { i: 46, userId: uid(P.USER, 46), empNo: 'NRS-002', fn: '이', gn: '수술실간호', cat: StaffCategory.MEDICAL, dept: '간호부 (수술실)', pos: '수술실 간호사', license: 'RN-2019-50002', specialty: '수술간호', hire: '2019-05-01' },
    { i: 47, userId: uid(P.USER, 47), empNo: 'NRS-003', fn: '박', gn: '산부인과간호', cat: StaffCategory.MEDICAL, dept: '간호부 (산부인과)', pos: '간호사', license: 'RN-2020-50003', specialty: '모성간호', hire: '2020-01-01' },
    { i: 48, userId: uid(P.USER, 48), empNo: 'NRS-004', fn: '최', gn: '정형외과간호', cat: StaffCategory.MEDICAL, dept: '간호부 (정형외과병동)', pos: '간호사', license: 'RN-2021-50004', specialty: null, hire: '2021-03-01' },
    { i: 49, userId: uid(P.USER, 49), empNo: 'NRS-005', fn: '정', gn: '정신과간호', cat: StaffCategory.MEDICAL, dept: '간호부 (정신건강)', pos: '정신건강간호사', license: 'RN-2019-50005', specialty: '정신건강간호', hire: '2019-09-01' },
    { i: 50, userId: uid(P.USER, 50), empNo: 'NRS-006', fn: '강', gn: '투석실간호', cat: StaffCategory.MEDICAL, dept: '간호부 (투석실)', pos: '투석실 간호사', license: 'RN-2020-50006', specialty: '투석간호', hire: '2020-06-01' },
    { i: 51, userId: uid(P.USER, 51), empNo: 'NRS-007', fn: '한', gn: '혈액은행간호', cat: StaffCategory.MEDICAL, dept: '간호부 (혈액은행)', pos: '간호사', license: 'RN-2021-50007', specialty: '수혈간호', hire: '2021-01-01' },
    { i: 52, userId: uid(P.USER, 52), empNo: 'NRS-008', fn: '신', gn: '재활간호', cat: StaffCategory.MEDICAL, dept: '간호부 (재활병동)', pos: '간호사', license: 'RN-2022-50008', specialty: '재활간호', hire: '2022-03-01' },
    { i: 53, userId: uid(P.USER, 53), empNo: 'NRS-009', fn: '임', gn: '항암간호', cat: StaffCategory.MEDICAL, dept: '간호부 (항암센터)', pos: '항암전담간호사', license: 'RN-2018-50009', specialty: '항암간호', hire: '2018-09-01' },
    { i: 54, userId: uid(P.USER, 54), empNo: 'NRS-010', fn: '송', gn: '상처간호', cat: StaffCategory.MEDICAL, dept: '간호부 (외과병동)', pos: 'WOC간호사', license: 'RN-2017-50010', specialty: '상처·장루·실금', hire: '2017-06-01' },
    { i: 55, userId: uid(P.USER, 55), empNo: 'NRS-011', fn: '나', gn: '감염간호', cat: StaffCategory.MEDICAL, dept: '감염관리실', pos: '감염관리간호사', license: 'RN-2016-50011', specialty: '감염관리', hire: '2016-03-01' },
    { i: 56, userId: uid(P.USER, 56), empNo: 'NRS-012', fn: '오', gn: '신생아간호', cat: StaffCategory.MEDICAL, dept: '간호부 (신생아실)', pos: '간호사', license: 'RN-2021-50012', specialty: '신생아간호', hire: '2021-09-01' },
    // ── 경영진 ──
    { i: 41, userId: uid(P.USER, 41), empNo: 'EXEC-001', fn: '홍', gn: '원장', cat: StaffCategory.ADMIN, dept: '경영진', pos: '병원장', license: 'MD-1995-00001', specialty: '병원경영', hire: '2010-03-01', execRole: 'CEO' },
    { i: 42, userId: uid(P.USER, 42), empNo: 'EXEC-002', fn: '김', gn: '이사장', cat: StaffCategory.ADMIN, dept: '경영진', pos: '이사장', license: null, specialty: '의료경영', hire: '2005-01-01', execRole: 'CEO' },
    { i: 43, userId: uid(P.USER, 43), empNo: 'EXEC-003', fn: '박', gn: '의료원장', cat: StaffCategory.MEDICAL, dept: '경영진', pos: '의료원장', license: 'MD-1998-00002', specialty: '내과/경영', hire: '2012-06-01', execRole: 'CMO' },
  ];

  for (const s of staffRecords) {
    try {
    await prisma.staff.upsert({
      where: { employeeNumber: s.empNo },
      update: { familyName: s.fn, givenName: s.gn, department: s.dept, position: s.pos, specialty: s.specialty, executiveRole: (s as any).execRole ?? null },
      create: {
        id: uid(P.STAFF, s.i),
        userId: s.userId,
        employeeNumber: s.empNo,
        familyName: s.fn,
        givenName: s.gn,
        category: s.cat,
        department: s.dept,
        position: s.pos,
        licenseNumber: s.license,
        specialty: s.specialty,
        hireDate: new Date(s.hire),
        status: EmploymentStatus.ACTIVE,
        email: (users.find(u => u.i === s.i)?.email) ?? `staff-${s.i}@hospital.example.org`,
        executiveRole: (s as any).execRole ?? null,
      },
    });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        await prisma.staff.updateMany({
          where: { employeeNumber: s.empNo },
          data: { familyName: s.fn, givenName: s.gn, department: s.dept, position: s.pos, specialty: s.specialty },
        });
      } else throw e;
    }
  }

  // ============================================================
  // 8. Inventory Items (재고/자재) — 18 items
  // ============================================================
  console.log('  [8/10] Inventory Items...');

  const inventoryItems = [
    { i: 1, code: 'INV-001', name: '일회용 주사기 3mL', category: '소모품', unit: '개', stock: 5000, safety: 500, supplier: '한국메디칼', price: 120 },
    { i: 2, code: 'INV-002', name: '일회용 주사기 5mL', category: '소모품', unit: '개', stock: 3000, safety: 300, supplier: '한국메디칼', price: 150 },
    { i: 3, code: 'INV-003', name: '일회용 주사기 10mL', category: '소모품', unit: '개', stock: 2000, safety: 200, supplier: '한국메디칼', price: 180 },
    { i: 4, code: 'INV-004', name: '니트릴 글러브 (M)', category: '소모품', unit: '박스(100매)', stock: 200, safety: 30, supplier: '크린가드', price: 8500 },
    { i: 5, code: 'INV-005', name: '니트릴 글러브 (L)', category: '소모품', unit: '박스(100매)', stock: 150, safety: 25, supplier: '크린가드', price: 8500 },
    { i: 6, code: 'INV-006', name: '멸균 거즈 (4x4)', category: '소모품', unit: '팩(10매)', stock: 1500, safety: 200, supplier: '대한위생재료', price: 650 },
    { i: 7, code: 'INV-007', name: 'IV 수액세트(성인)', category: '소모품', unit: '개', stock: 800, safety: 100, supplier: '제이더블유메디칼', price: 2800 },
    { i: 8, code: 'INV-008', name: 'IV 수액세트(소아)', category: '소모품', unit: '개', stock: 300, safety: 50, supplier: '제이더블유메디칼', price: 3200 },
    { i: 9, code: 'INV-009', name: 'KF94 마스크', category: '소모품', unit: '매', stock: 10000, safety: 1000, supplier: '크린가드', price: 350 },
    { i: 10, code: 'INV-010', name: 'N95 마스크', category: '소모품', unit: '매', stock: 2000, safety: 200, supplier: '3M코리아', price: 1800 },
    { i: 11, code: 'INV-011', name: '반창고 (소)', category: '소모품', unit: '롤', stock: 600, safety: 50, supplier: '대한위생재료', price: 1200 },
    { i: 12, code: 'INV-012', name: '탄력붕대 (10cm)', category: '소모품', unit: '롤', stock: 400, safety: 50, supplier: '대한위생재료', price: 2500 },
    { i: 13, code: 'INV-013', name: '소독용 알코올솜', category: '소모품', unit: '박스(100매)', stock: 500, safety: 50, supplier: '대한위생재료', price: 3200 },
    { i: 14, code: 'INV-014', name: '일회용 수술가운', category: '수술소모품', unit: '벌', stock: 300, safety: 30, supplier: '메디라인', price: 8900 },
    { i: 15, code: 'INV-015', name: '봉합사 (3-0 나일론)', category: '수술소모품', unit: '개', stock: 200, safety: 30, supplier: '에치콘', price: 12000 },
    { i: 16, code: 'INV-016', name: '유치도뇨관 (16Fr)', category: '소모품', unit: '개', stock: 150, safety: 20, supplier: '바드메디칼', price: 5600 },
    { i: 17, code: 'INV-017', name: '산소마스크(성인)', category: '소모품', unit: '개', stock: 200, safety: 30, supplier: '제이더블유메디칼', price: 4500 },
    { i: 18, code: 'INV-018', name: '혈액채취 바늘(진공채혈)', category: '검사소모품', unit: '개', stock: 3000, safety: 300, supplier: 'BD코리아', price: 350 },
  ];

  for (const item of inventoryItems) {
    await prisma.inventoryItem.upsert({
      where: { code: item.code },
      update: {},
      create: {
        id: uid(P.INV, item.i),
        code: item.code,
        name: item.name,
        category: item.category,
        unit: item.unit,
        currentStock: item.stock,
        safetyStock: item.safety,
        supplierName: item.supplier,
        unitPrice: item.price,
      },
    });
  }

  // ============================================================
  // 9. Equipment (의료장비) — 12 items
  // ============================================================
  console.log('  [9/10] Equipment...');

  const equipment = [
    { i: 1, assetNo: 'EQ-2020-001', name: 'CT 스캐너 (64채널)', category: '진단장비', mfr: 'GE Healthcare', mdl: 'Revolution CT', serial: 'CT-GE-2020-001', loc: '2층 영상실', purchase: '2020-06-15', warranty: '2025-06-15', inspect: '2026-06-01' },
    { i: 2, assetNo: 'EQ-2019-002', name: '디지털 X-ray 촬영장치', category: '진단장비', mfr: 'Siemens Healthineers', mdl: 'Ysio Max', serial: 'XR-SI-2019-001', loc: '2층 영상실', purchase: '2019-03-10', warranty: '2024-03-10', inspect: '2026-03-01' },
    { i: 3, assetNo: 'EQ-2021-003', name: '초음파 진단기', category: '진단장비', mfr: 'Samsung Medison', mdl: 'RS85 Prestige', serial: 'US-SM-2021-001', loc: '2층 외래', purchase: '2021-01-20', warranty: '2026-01-20', inspect: '2026-07-01' },
    { i: 4, assetNo: 'EQ-2021-004', name: '인공호흡기 (벤틸레이터)', category: '치료장비', mfr: 'Dräger', mdl: 'Evita V300', serial: 'VN-DR-2021-001', loc: '응급실', purchase: '2021-09-01', warranty: '2026-09-01', inspect: '2026-09-01' },
    { i: 5, assetNo: 'EQ-2020-005', name: '심전도 (ECG) 12채널', category: '진단장비', mfr: 'GE Healthcare', mdl: 'MAC 2000', serial: 'EC-GE-2020-001', loc: '2층 외래', purchase: '2020-04-15', warranty: '2025-04-15', inspect: '2026-04-01' },
    { i: 6, assetNo: 'EQ-2019-006', name: '제세동기 (AED)', category: '응급장비', mfr: 'Philips', mdl: 'HeartStart FRx', serial: 'DF-PH-2019-001', loc: '응급실', purchase: '2019-11-01', warranty: '2024-11-01', inspect: '2026-05-01' },
    { i: 7, assetNo: 'EQ-2022-007', name: 'MRI (1.5T)', category: '진단장비', mfr: 'Siemens Healthineers', mdl: 'MAGNETOM Sola', serial: 'MR-SI-2022-001', loc: '2층 영상실', purchase: '2022-02-01', warranty: '2027-02-01', inspect: '2026-08-01' },
    { i: 8, assetNo: 'EQ-2020-008', name: '수술용 무영등', category: '수술장비', mfr: 'Stryker', mdl: 'Visum LED', serial: 'SL-ST-2020-001', loc: '1층 수술실', purchase: '2020-08-01', warranty: '2025-08-01', inspect: '2026-08-01' },
    { i: 9, assetNo: 'EQ-2021-009', name: '환자 모니터 (다기능)', category: '모니터링', mfr: 'Philips', mdl: 'IntelliVue MX800', serial: 'PM-PH-2021-001', loc: '응급실', purchase: '2021-05-01', warranty: '2026-05-01', inspect: '2026-05-01' },
    { i: 10, assetNo: 'EQ-2020-010', name: '마취기', category: '수술장비', mfr: 'Dräger', mdl: 'Fabius Plus XL', serial: 'AN-DR-2020-001', loc: '1층 수술실', purchase: '2020-10-01', warranty: '2025-10-01', inspect: '2026-10-01' },
    { i: 11, assetNo: 'EQ-2019-011', name: '전동식 수술테이블', category: '수술장비', mfr: 'Maquet', mdl: 'Magnus', serial: 'ST-MQ-2019-001', loc: '1층 수술실', purchase: '2019-07-01', warranty: '2024-07-01', inspect: '2026-07-01' },
    { i: 12, assetNo: 'EQ-2023-012', name: '복강경 시스템', category: '수술장비', mfr: 'Olympus', mdl: 'VISERA ELITE III', serial: 'LP-OL-2023-001', loc: '1층 수술실', purchase: '2023-01-15', warranty: '2028-01-15', inspect: '2026-07-15' },
  ];

  for (const eq of equipment) {
    await prisma.equipment.upsert({
      where: { assetNumber: eq.assetNo },
      update: {},
      create: {
        id: uid(P.EQUIP, eq.i),
        assetNumber: eq.assetNo,
        name: eq.name,
        category: eq.category,
        manufacturer: eq.mfr,
        model: eq.mdl,
        serialNumber: eq.serial,
        location: eq.loc,
        purchaseDate: new Date(eq.purchase),
        warrantyExpiry: new Date(eq.warranty),
        status: EquipmentStatus.ACTIVE,
        nextInspection: new Date(eq.inspect),
      },
    });
  }

  // ============================================================
  // 10. Quality Indicators (질 지표) — 카탈로그 정본 `prisma/seeds/qi-measurement.ts`
  // ============================================================
  console.log('  [10/10] Quality Indicators...');

  for (const qi of QI_INDICATOR_CATALOG) {
    await prisma.qualityIndicator.upsert({
      where: { name: qi.name },
      // 🔴 2026-10-08 — `update` 에 targetValue 가 있어 **재시드가 위원회 의결 목표를 카탈로그 값으로 되돌렸다**.
      //    목표·정의 변경은 QPS 안건 → 집행(quality-indicator 바인딩) 경로 하나. 시드는 없을 때만 만든다.
      update: {},
      create: {
        id: uid(P.QI, qi.i),
        name: qi.name,
        category: qi.category,
        formula: qi.formula,
        targetValue: qi.targetValue,
      },
    });
  }

  // (elapsed calculated at end)
  // ============================================================
  // 11. EMR Enhancement — 시딩 데이터
  // ============================================================
  console.log('  [11/12] EMR: Consent Templates...');
  const consentTemplates = [
    { type: 'SURGERY', name: '수술 동의서', version: '1.0', description: '수술 전 환자 설명 및 동의', docNumber: 'CF-SUR-001',
      components: [
        { id: 'h1', type: 'heading', text: '수술 동의서', level: 'h2' },
        { id: 'p1', type: 'paragraph', text: '본 동의서는 의료법 제24조의2에 의거하여 환자(보호자)에게 수술에 대한 충분한 설명을 제공하고, 이에 대한 동의를 구하기 위한 것입니다.' },
        { id: 'd1', type: 'divider' },
        { id: 'h2', type: 'heading', text: '환자 정보', level: 'h3' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', placeholder: '{{patient.mrn}}', required: true },
        { id: 'dt1', type: 'date_input', label: '생년월일', required: true },
        { id: 'd2', type: 'divider' },
        { id: 'h3', type: 'heading', text: '수술 정보', level: 'h3' },
        { id: 't3', type: 'text_input', label: '수술명', placeholder: '{{surgery.name}}', required: true },
        { id: 'dt2', type: 'date_input', label: '수술 예정일', required: true },
        { id: 't4', type: 'text_input', label: '집도의', placeholder: '{{doctor.name}}', required: true },
        { id: 'ta1', type: 'textarea', label: '수술의 필요성 및 목적', rows: 3, required: true },
        { id: 'd3', type: 'divider' },
        { id: 'h4', type: 'heading', text: '설명 사항', level: 'h3' },
        { id: 'ta2', type: 'textarea', label: '예상되는 합병증 및 부작용', rows: 4, required: true },
        { id: 'ta3', type: 'textarea', label: '대안적 치료 방법', rows: 2, required: true },
        { id: 'ta4', type: 'textarea', label: '수술을 하지 않았을 경우 예후', rows: 2, required: false },
        { id: 'cg1', type: 'checkbox_group', label: '마취 관련', options: ['전신마취', '부위마취(척추/경막외)', '국소마취', '수면마취(의식하 진정)'], minRequired: 1 },
        { id: 'c1', type: 'checkbox', label: '수술 중 수혈이 필요할 수 있음을 설명 받았습니다', required: true },
        { id: 'd4', type: 'divider' },
        { id: 'pb1', type: 'page_break' },
        { id: 'h5', type: 'heading', text: '환자(보호자) 확인', level: 'h3' },
        { id: 'c2', type: 'checkbox', label: '위 수술에 대해 의료진으로부터 충분한 설명을 들었습니다', required: true },
        { id: 'c3', type: 'checkbox', label: '궁금한 사항에 대해 질문할 기회가 주어졌습니다', required: true },
        { id: 'c4', type: 'checkbox', label: '동의를 거부하더라도 향후 치료에 불이익이 없음을 알고 있습니다', required: true },
        { id: 'c5', type: 'checkbox', label: '위 내용을 이해하였으며, 자발적으로 수술에 동의합니다', required: true },
        { id: 'd5', type: 'divider' },
        { id: 'dt3', type: 'date_input', label: '동의 날짜', required: true },
        { id: 's1', type: 'signature', label: '환자 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '보호자 서명 (환자가 미성년자이거나 의사 결정 불가 시)', role: 'guardian' },
        { id: 's3', type: 'signature', label: '설명 의사 서명', role: 'doctor' },
      ],
      content: { title: '수술 동의서', sections: ['수술명 및 목적', '예상 합병증 및 부작용', '대안 치료법', '마취 관련 사항', '수혈 가능성'] },
      requiredFields: ['수술명', '예상되는 합병증 및 부작용', '대안적 치료 방법', '환자 서명', '설명 의사 서명'] },

    { type: 'ANESTHESIA', name: '마취 동의서', version: '1.0', description: '마취 시행 전 설명 및 동의', docNumber: 'CF-ANE-002',
      components: [
        { id: 'h1', type: 'heading', text: '마취 동의서', level: 'h2' },
        { id: 'p1', type: 'paragraph', text: '마취 시행 전 환자(보호자)에게 마취의 종류, 방법, 위험성에 대해 설명하고 동의를 구합니다.' },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', placeholder: '{{patient.mrn}}', required: true },
        { id: 'h2', type: 'heading', text: '마취 정보', level: 'h3' },
        { id: 'cg1', type: 'checkbox_group', label: '마취 방법', options: ['전신마취', '척추마취', '경막외마취', '신경차단술', '국소마취', '의식하 진정'], minRequired: 1 },
        { id: 'ta1', type: 'textarea', label: '마취 위험 요인 (기존 질환, 알레르기 등)', rows: 3, required: true },
        { id: 'h3', type: 'heading', text: '예상 부작용', level: 'h3' },
        { id: 'p2', type: 'paragraph', text: '마취 후 발생할 수 있는 부작용: 오심/구토, 두통, 인후통, 치아 손상, 신경 손상, 알레르기 반응, 악성 고열증 등. 극히 드물지만 심각한 합병증(심정지, 뇌손상, 사망)이 발생할 수 있습니다.' },
        { id: 'h4', type: 'heading', text: '금식 안내', level: 'h3' },
        { id: 'p3', type: 'paragraph', text: '• 수술 8시간 전부터 음식물 섭취 금지\n• 수술 2시간 전부터 맑은 물 섭취 금지\n• 껌, 사탕 포함 일체의 음식 금지' },
        { id: 'd2', type: 'divider' },
        { id: 'c1', type: 'checkbox', label: '마취에 대한 설명을 충분히 들었으며 이해하였습니다', required: true },
        { id: 'c2', type: 'checkbox', label: '금식 안내를 이해하였으며 준수하겠습니다', required: true },
        { id: 'c3', type: 'checkbox', label: '마취에 동의합니다', required: true },
        { id: 'dt1', type: 'date_input', label: '날짜', required: true },
        { id: 's1', type: 'signature', label: '환자 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '마취과 전문의 서명', role: 'doctor' },
      ],
      content: { title: '마취 동의서', sections: ['마취 방법', '마취 위험 요인', '예상 부작용', '금식 안내'] },
      requiredFields: ['마취 방법', '마취 위험 요인', '환자 서명', '마취과 전문의 서명'] },

    { type: 'TRANSFUSION', name: '수혈 동의서', version: '1.0', description: '수혈 시행 전 설명 및 동의', docNumber: 'CF-TRF-003',
      components: [
        { id: 'h1', type: 'heading', text: '수혈 동의서', level: 'h2' },
        { id: 'p1', type: 'paragraph', text: '혈액관리법 제3조에 의거하여 수혈에 대한 설명을 드리고 동의를 구합니다.' },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', required: true },
        { id: 't3', type: 'text_input', label: '혈액형', placeholder: '{{patient.bloodType}}', required: true },
        { id: 'h2', type: 'heading', text: '수혈 정보', level: 'h3' },
        { id: 'ta1', type: 'textarea', label: '수혈 목적 및 필요성', rows: 2, required: true },
        { id: 'cg1', type: 'checkbox_group', label: '혈액 제제 종류', options: ['농축적혈구(pRBC)', '신선동결혈장(FFP)', '혈소판농축액(PC)', '동결침전제제(Cryo)', '전혈(Whole Blood)'], minRequired: 1 },
        { id: 'h3', type: 'heading', text: '수혈 부작용', level: 'h3' },
        { id: 'p2', type: 'paragraph', text: '• 급성 부작용: 발열, 오한, 두드러기, 아나필락시스, 급성 용혈반응, 세균 오염, TRALI\n• 지연 부작용: 지연성 용혈반응, 감염(HIV, HBV, HCV 등 — 극히 드묾), 철분 과부하\n• 수혈을 거부할 경우 빈혈 악화, 조직 산소 공급 부족 등의 위험이 있습니다.' },
        { id: 'd2', type: 'divider' },
        { id: 'c1', type: 'checkbox', label: '수혈의 필요성과 부작용에 대해 설명을 들었습니다', required: true },
        { id: 'c2', type: 'checkbox', label: '수혈에 동의합니다', required: true },
        { id: 'dt1', type: 'date_input', label: '날짜', required: true },
        { id: 's1', type: 'signature', label: '환자(보호자) 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '설명 의사 서명', role: 'doctor' },
      ],
      content: { title: '수혈 동의서', sections: ['수혈 목적', '혈액 제제 종류', '수혈 부작용', '거부 시 위험'] },
      requiredFields: ['수혈 목적 및 필요성', '혈액 제제 종류', '환자(보호자) 서명', '설명 의사 서명'] },

    { type: 'PROCEDURE', name: '시술 동의서', version: '1.0', description: '시술/검사 전 설명 및 동의', docNumber: 'CF-PRC-004',
      components: [
        { id: 'h1', type: 'heading', text: '시술/검사 동의서', level: 'h2' },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', required: true },
        { id: 'h2', type: 'heading', text: '시술/검사 정보', level: 'h3' },
        { id: 't3', type: 'text_input', label: '시술/검사명', required: true },
        { id: 'dt1', type: 'date_input', label: '시행 예정일', required: true },
        { id: 'ta1', type: 'textarea', label: '시술 목적 및 방법', rows: 3, required: true },
        { id: 'ta2', type: 'textarea', label: '예상되는 합병증 및 부작용', rows: 3, required: true },
        { id: 'ta3', type: 'textarea', label: '대안적 검사/치료 방법', rows: 2, required: false },
        { id: 'ta4', type: 'textarea', label: '시술 전 주의사항', rows: 2, required: false },
        { id: 'd2', type: 'divider' },
        { id: 'c1', type: 'checkbox', label: '위 시술/검사에 대해 충분한 설명을 들었습니다', required: true },
        { id: 'c2', type: 'checkbox', label: '시술/검사에 동의합니다', required: true },
        { id: 'dt2', type: 'date_input', label: '날짜', required: true },
        { id: 's1', type: 'signature', label: '환자(보호자) 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '설명 의사 서명', role: 'doctor' },
      ],
      content: { title: '시술 동의서', sections: ['시술명', '시술 목적 및 방법', '합병증', '대안'] },
      requiredFields: ['시술/검사명', '시술 목적 및 방법', '예상되는 합병증 및 부작용', '환자(보호자) 서명'] },

    { type: 'RESEARCH', name: '연구 참여 동의서', version: '1.0', description: '임상연구/시험 참여 동의', docNumber: 'CF-RSH-005',
      components: [
        { id: 'h1', type: 'heading', text: '임상연구 참여 동의서', level: 'h2' },
        { id: 'p1', type: 'paragraph', text: '본 동의서는 「생명윤리 및 안전에 관한 법률」에 따라 연구 참여 전 충분한 설명을 제공하고 자발적 동의를 구하기 위한 것입니다.' },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '연구 제목', required: true },
        { id: 't2', type: 'text_input', label: '연구 책임자', required: true },
        { id: 't3', type: 'text_input', label: 'IRB 승인번호', required: true },
        { id: 'h2', type: 'heading', text: '연구 개요', level: 'h3' },
        { id: 'ta1', type: 'textarea', label: '연구 목적', rows: 3, required: true },
        { id: 'ta2', type: 'textarea', label: '참여 절차 및 기간', rows: 3, required: true },
        { id: 'h3', type: 'heading', text: '위험 및 이익', level: 'h3' },
        { id: 'ta3', type: 'textarea', label: '예상되는 위험 및 불편', rows: 3, required: true },
        { id: 'ta4', type: 'textarea', label: '예상되는 이익', rows: 2, required: false },
        { id: 'pb1', type: 'page_break' },
        { id: 'h4', type: 'heading', text: '참여자 권리', level: 'h3' },
        { id: 'p2', type: 'paragraph', text: '• 연구 참여는 완전히 자발적이며, 언제든지 이유 없이 철회할 수 있습니다.\n• 참여를 거부하거나 철회하더라도 귀하의 치료에 어떠한 불이익도 없습니다.\n• 연구 과정에서 얻은 개인정보는 관련 법률에 따라 보호됩니다.\n• 연구 관련 문의는 연구 책임자 또는 IRB에 연락하실 수 있습니다.' },
        { id: 'd2', type: 'divider' },
        { id: 'c1', type: 'checkbox', label: '연구에 대한 설명을 충분히 들었으며 이해하였습니다', required: true },
        { id: 'c2', type: 'checkbox', label: '자발적으로 연구에 참여하는 것에 동의합니다', required: true },
        { id: 'c3', type: 'checkbox', label: '개인정보 수집 및 이용에 동의합니다', required: true },
        { id: 'dt1', type: 'date_input', label: '날짜', required: true },
        { id: 's1', type: 'signature', label: '참여자(환자) 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '법정대리인 서명 (해당 시)', role: 'guardian' },
        { id: 's3', type: 'signature', label: '설명자(연구자) 서명', role: 'doctor' },
        { id: 's4', type: 'signature', label: '증인 서명', role: 'witness' },
      ],
      content: { title: '임상연구 참여 동의서', sections: ['연구 제목', '연구 목적', '참여 절차', '예상 위험/이익', '개인정보 보호', '참여 철회'] },
      requiredFields: ['연구 제목', '연구 목적', '참여자(환자) 서명', '설명자(연구자) 서명'] },

    { type: 'DNR', name: '심폐소생술 거부(DNR) 동의서', version: '1.0', description: '연명의료 결정 동의', docNumber: 'CF-DNR-006',
      components: [
        { id: 'h1', type: 'heading', text: '심폐소생술 거부(DNR) 동의서', level: 'h2' },
        { id: 'p1', type: 'paragraph', text: '본 동의서는 「호스피스·완화의료 및 임종과정에 있는 환자의 연명의료결정에 관한 법률」에 따라 작성됩니다.' },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', required: true },
        { id: 'h2', type: 'heading', text: '환자 상태', level: 'h3' },
        { id: 'ta1', type: 'textarea', label: '현재 진단명 및 예후', rows: 3, required: true },
        { id: 'ta2', type: 'textarea', label: '담당의 의견 (임종 과정 여부)', rows: 2, required: true },
        { id: 'h3', type: 'heading', text: '연명의료 거부 범위', level: 'h3' },
        { id: 'cg1', type: 'checkbox_group', label: '거부하는 연명의료', options: ['심폐소생술(CPR)', '인공호흡기 적용', '혈액투석', '항암제 투여', '수혈', '승압제 투여', '그 외 의학적으로 무의미한 연명의료'], minRequired: 1 },
        { id: 'h4', type: 'heading', text: '완화의료', level: 'h3' },
        { id: 'c1', type: 'checkbox', label: '통증 완화 등 완화의료는 계속 받기를 원합니다', required: false },
        { id: 'd2', type: 'divider' },
        { id: 'pb1', type: 'page_break' },
        { id: 'h5', type: 'heading', text: '의사 결정 능력 확인', level: 'h3' },
        { id: 'p2', type: 'paragraph', text: '아래 해당 사항에 체크해 주십시오:' },
        { id: 'cg2', type: 'checkbox_group', label: '동의 주체', options: ['환자 본인이 직접 결정', '환자 의사능력 없음 — 사전연명의료의향서 확인', '환자 의사능력 없음 — 가족 전원 합의'], minRequired: 1 },
        { id: 'd3', type: 'divider' },
        { id: 'c2', type: 'checkbox', label: '위 내용에 대해 충분한 설명을 들었으며 이해하였습니다', required: true },
        { id: 'dt1', type: 'date_input', label: '날짜', required: true },
        { id: 's1', type: 'signature', label: '환자(또는 대리인) 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '가족 대표 서명', role: 'guardian' },
        { id: 's3', type: 'signature', label: '담당 의사 서명', role: 'doctor' },
        { id: 's4', type: 'signature', label: '증인 서명', role: 'witness' },
      ],
      content: { title: 'DNR 동의서', sections: ['환자 상태 설명', 'CPR/인공호흡 거부 범위', '완화의료 안내', '의사 결정 능력 확인'] },
      requiredFields: ['환자 성명', '현재 진단명 및 예후', '거부하는 연명의료', '환자(또는 대리인) 서명', '담당 의사 서명'] },

    // ── 추가 동의서 템플릿 ──

    { type: 'TREATMENT', name: '항암화학요법 동의서', version: '1.0', description: '항암제 투여 전 설명 및 동의', docNumber: 'CF-CHM-007',
      components: [
        { id: 'h1', type: 'heading', text: '항암화학요법 동의서', level: 'h2' },
        { id: 'p1', type: 'paragraph', text: '본 동의서는 항암화학요법(Chemotherapy) 시행 전 치료의 목적, 방법, 예상되는 부작용에 대해 설명하고 환자의 동의를 구하기 위한 것입니다.' },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', placeholder: '{{patient.mrn}}', required: true },
        { id: 'h2', type: 'heading', text: '치료 정보', level: 'h3' },
        { id: 't3', type: 'text_input', label: '진단명', required: true },
        { id: 't4', type: 'text_input', label: '항암 프로토콜(레지멘)', placeholder: 'ex) FOLFOX, AC-T, R-CHOP', required: true },
        { id: 't5', type: 'text_input', label: '치료 주기 및 횟수', placeholder: 'ex) 3주 간격, 총 6회', required: true },
        { id: 'ta1', type: 'textarea', label: '치료 목적', rows: 2, required: true },
        { id: 'h3', type: 'heading', text: '예상 부작용', level: 'h3' },
        { id: 'p2', type: 'paragraph', text: '• 흔한 부작용: 오심/구토, 탈모, 피로감, 식욕감소, 구내염, 설사/변비\n• 혈액학적: 백혈구 감소(감염 위험 증가), 혈소판 감소(출혈 위험), 빈혈\n• 장기별: 간독성, 신독성, 심독성, 말초신경병증, 피부 변화\n• 생식: 불임 가능성 (사전 난자/정자 보존 상담 가능)\n• 드물지만 중대한: 아나필락시스, 종양용해증후군, 이차성 악성종양' },
        { id: 'ta2', type: 'textarea', label: '본 레지멘의 주요 부작용 (담당의 기재)', rows: 3, required: true },
        { id: 'pb1', type: 'page_break' },
        { id: 'h4', type: 'heading', text: '주의사항', level: 'h3' },
        { id: 'p3', type: 'paragraph', text: '• 치료 기간 중 감염 예방에 유의하십시오 (손씻기, 인파 밀집 장소 회피)\n• 발열(38℃ 이상), 출혈, 심한 구토/설사 시 즉시 내원하십시오\n• 임신 가능성이 있는 경우 반드시 담당의에게 알려주십시오\n• 다른 약물 복용 시 반드시 담당의와 상의하십시오' },
        { id: 'd2', type: 'divider' },
        { id: 'c1', type: 'checkbox', label: '항암화학요법의 목적, 방법, 부작용에 대해 충분한 설명을 들었습니다', required: true },
        { id: 'c2', type: 'checkbox', label: '치료를 거부할 경우의 예후에 대해 설명을 들었습니다', required: true },
        { id: 'c3', type: 'checkbox', label: '자발적으로 항암화학요법에 동의합니다', required: true },
        { id: 'dt1', type: 'date_input', label: '날짜', required: true },
        { id: 's1', type: 'signature', label: '환자 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '보호자 서명', role: 'guardian' },
        { id: 's3', type: 'signature', label: '설명 의사 서명', role: 'doctor' },
      ],
      content: { title: '항암화학요법 동의서', sections: ['치료 정보', '예상 부작용', '주의사항'] },
      requiredFields: ['진단명', '항암 프로토콜', '환자 서명', '설명 의사 서명'] },

    { type: 'PROCEDURE', name: '내시경 검사 동의서', version: '1.0', description: '위/대장 내시경 검사 전 동의', docNumber: 'CF-END-008',
      components: [
        { id: 'h1', type: 'heading', text: '내시경 검사 동의서', level: 'h2' },
        { id: 'p1', type: 'paragraph', text: '본 동의서는 상부위장관내시경(위내시경) 또는 대장내시경 검사 시행 전 검사의 목적, 방법, 합병증에 대해 설명하고 동의를 구하기 위한 것입니다.' },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', required: true },
        { id: 'h2', type: 'heading', text: '검사 정보', level: 'h3' },
        { id: 'cg1', type: 'checkbox_group', label: '검사 종류', options: ['상부위장관내시경(위내시경)', '대장내시경', '초음파내시경(EUS)', '내시경역행담췌관조영술(ERCP)'], minRequired: 1 },
        { id: 'ta1', type: 'textarea', label: '검사 목적', rows: 2, required: true },
        { id: 'cg2', type: 'checkbox_group', label: '진정(수면) 방법', options: ['진정 없이 시행', '의식하 진정(수면내시경)', '전신마취 하 시행'], minRequired: 1 },
        { id: 'h3', type: 'heading', text: '합병증', level: 'h3' },
        { id: 'p2', type: 'paragraph', text: '• 일반: 복부 팽만감, 인후통, 일시적 불쾌감\n• 진정 관련: 호흡억제, 혈압저하, 알레르기 반응\n• 출혈: 조직검사/용종절제 후 출혈 (대부분 자연 지혈)\n• 천공: 매우 드물지만 수술이 필요할 수 있음 (위내시경 0.01%, 대장내시경 0.1%)\n• ERCP: 급성 췌장염, 출혈, 천공 가능' },
        { id: 'h4', type: 'heading', text: '검사 전 주의사항', level: 'h3' },
        { id: 'p3', type: 'paragraph', text: '• 위내시경: 검사 8시간 전부터 금식\n• 대장내시경: 전일 저녁부터 장정결제 복용 (처방에 따름)\n• 항혈소판제/항응고제 복용 시 담당의 지시에 따라 중단\n• 수면내시경 시 검사 당일 운전 금지, 보호자 동반 필수' },
        { id: 'd2', type: 'divider' },
        { id: 'c1', type: 'checkbox', label: '내시경 검사의 목적, 방법, 합병증에 대해 설명을 들었습니다', required: true },
        { id: 'c2', type: 'checkbox', label: '검사 전 주의사항을 이해하였습니다', required: true },
        { id: 'c3', type: 'checkbox', label: '검사에 동의합니다', required: true },
        { id: 'dt1', type: 'date_input', label: '날짜', required: true },
        { id: 's1', type: 'signature', label: '환자(보호자) 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '설명 의사 서명', role: 'doctor' },
      ],
      content: { title: '내시경 검사 동의서', sections: ['검사 종류', '합병증', '검사 전 주의사항'] },
      requiredFields: ['검사 종류', '검사 목적', '환자(보호자) 서명', '설명 의사 서명'] },

    { type: 'GENERAL', name: '개인정보 수집·이용 동의서', version: '1.0', description: '의료법 및 개인정보보호법에 따른 동의', docNumber: 'CF-PRI-009',
      components: [
        { id: 'h1', type: 'heading', text: '개인정보 수집·이용 동의서', level: 'h2' },
        { id: 'p1', type: 'paragraph', text: '「개인정보 보호법」 제15조 및 제22조, 「의료법」 제21조에 따라 귀하의 개인정보를 다음과 같이 수집·이용하고자 합니다.' },
        { id: 'd1', type: 'divider' },
        { id: 'h2', type: 'heading', text: '1. 수집 항목', level: 'h3' },
        { id: 'p2', type: 'paragraph', text: '• 필수: 성명, 주민등록번호(생년월일), 주소, 연락처, 건강보험 정보\n• 의료정보: 진료기록, 검사결과, 처방내역, 수술기록, 영상자료\n• 선택: 이메일, 직업, 비상연락처, 가족력' },
        { id: 'h3', type: 'heading', text: '2. 수집 목적', level: 'h3' },
        { id: 'p3', type: 'paragraph', text: '• 진료 및 치료 서비스 제공\n• 건강보험 청구 및 정산\n• 법정 의무 기록 보관 (의료법)\n• 진료 예약, 검사 결과 통보, 건강검진 안내\n• 의료 질 향상을 위한 통계 분석 (비식별 처리)' },
        { id: 'h4', type: 'heading', text: '3. 보유 기간', level: 'h3' },
        { id: 'p4', type: 'paragraph', text: '• 진료기록: 의료법에 따라 10년 (환자명부 5년)\n• 처방전: 2년\n• 수술기록: 10년\n• 검사소견/방사선 소견: 5년\n• 목적 달성 후 지체 없이 파기 (법정 보존 기간 경과 시)' },
        { id: 'pb1', type: 'page_break' },
        { id: 'h5', type: 'heading', text: '4. 동의 거부 권리', level: 'h3' },
        { id: 'p5', type: 'paragraph', text: '귀하는 위 개인정보 수집·이용에 대해 동의를 거부할 권리가 있습니다. 다만, 필수 항목에 대한 동의를 거부하실 경우 진료 서비스 이용이 제한될 수 있습니다.' },
        { id: 'd2', type: 'divider' },
        { id: 'c1', type: 'checkbox', label: '[필수] 개인정보 수집·이용에 동의합니다', required: true },
        { id: 'c2', type: 'checkbox', label: '[선택] 마케팅 목적의 개인정보 활용에 동의합니다 (진료 안내, 건강정보 제공)', required: false },
        { id: 'c3', type: 'checkbox', label: '[선택] 제3자 제공에 동의합니다 (건강보험심사평가원, 국민건강보험공단)', required: false },
        { id: 'dt1', type: 'date_input', label: '날짜', required: true },
        { id: 's1', type: 'signature', label: '환자(법정대리인) 서명', role: 'patient' },
      ],
      content: { title: '개인정보 수집·이용 동의서', sections: ['수집 항목', '수집 목적', '보유 기간', '동의 거부 권리'] },
      requiredFields: ['[필수] 개인정보 수집·이용 동의', '환자(법정대리인) 서명'] },

    { type: 'GENERAL', name: '입원 동의서 및 안내', version: '1.0', description: '입원 시 환자/보호자 동의 및 안내사항', docNumber: 'CF-ADM-010',
      components: [
        { id: 'h1', type: 'heading', text: '입원 동의서 및 안내', level: 'h2' },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', required: true },
        { id: 't3', type: 'text_input', label: '입원 병동/호실', required: true },
        { id: 'dt1', type: 'date_input', label: '입원 예정일', required: true },
        { id: 'ta1', type: 'textarea', label: '입원 사유', rows: 2, required: true },
        { id: 'h2', type: 'heading', text: '입원 생활 안내', level: 'h3' },
        { id: 'p1', type: 'paragraph', text: '• 면회 시간: 매일 18:00~20:00 (ICU: 제한적 면회)\n• 외출/외박: 담당의 허가 필요, 간호사실에 사전 신청\n• 귀중품: 분실 시 병원은 책임지지 않으니 보호자에게 맡기십시오\n• 식사: 담당의 처방에 따른 식사가 제공됩니다 (금식 시 별도 안내)\n• 낙상 예방: 침대 난간을 올려두시고, 이동 시 간호사 호출\n• 금연: 병원 내 전 구역 금연입니다' },
        { id: 'h3', type: 'heading', text: '보호자 안내', level: 'h3' },
        { id: 'p2', type: 'paragraph', text: '• 보호자 1인 상주를 원칙으로 합니다\n• 간병인 이용 시 간호사실에 사전 등록\n• 환자 상태 변화 시 즉시 간호사에게 알려주십시오\n• 담당의 회진 시간에 보호자가 참여해 주시면 좋습니다' },
        { id: 'pb1', type: 'page_break' },
        { id: 'h4', type: 'heading', text: '비용 안내', level: 'h3' },
        { id: 'p3', type: 'paragraph', text: '• 입원비는 건강보험 적용 후 본인부담금이 청구됩니다\n• 비급여 항목(상급병실료, 선택진료료 등)은 별도 부담\n• 중간 정산: 입원 7일 초과 시 중간 정산 요청 가능\n• 퇴원 시 미수 비용이 있을 경우 퇴원이 제한될 수 있습니다' },
        { id: 'd2', type: 'divider' },
        { id: 'c1', type: 'checkbox', label: '입원 안내 사항을 읽고 이해하였습니다', required: true },
        { id: 'c2', type: 'checkbox', label: '병원 규정을 준수하겠습니다', required: true },
        { id: 'c3', type: 'checkbox', label: '입원에 동의합니다', required: true },
        { id: 'dt2', type: 'date_input', label: '동의 날짜', required: true },
        { id: 's1', type: 'signature', label: '환자 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '보호자 서명', role: 'guardian' },
      ],
      content: { title: '입원 동의서 및 안내', sections: ['입원 생활 안내', '보호자 안내', '비용 안내'] },
      requiredFields: ['입원 사유', '입원 안내 사항 확인', '환자 서명'] },

    { type: 'PROCEDURE', name: '조영제 사용 동의서', version: '1.0', description: 'CT/MRI 조영제 사용 전 동의', docNumber: 'CF-CTR-011',
      components: [
        { id: 'h1', type: 'heading', text: '조영제 사용 동의서', level: 'h2' },
        { id: 'p1', type: 'paragraph', text: '영상검사(CT, MRI 등)에서 조영제를 사용하여 진단 정확도를 높이고자 합니다. 조영제 투여 전 관련 위험성에 대해 설명드리고 동의를 구합니다.' },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', required: true },
        { id: 'h2', type: 'heading', text: '검사 및 조영제 정보', level: 'h3' },
        { id: 'cg1', type: 'checkbox_group', label: '검사 종류', options: ['CT (요오드계 조영제)', 'MRI (가돌리늄계 조영제)', '혈관조영술', '기타'], minRequired: 1 },
        { id: 'ta1', type: 'textarea', label: '검사 목적', rows: 2, required: true },
        { id: 'h3', type: 'heading', text: '사전 확인 사항', level: 'h3' },
        { id: 'cg2', type: 'checkbox_group', label: '해당 사항에 체크하세요', options: ['조영제 부작용 경험 있음', '알레르기 체질 (천식, 두드러기 등)', '신장 질환 있음', '갑상선 질환 있음', '당뇨병 (메트포르민 복용)', '임신 또는 임신 가능성', '수유 중', '해당 없음'], minRequired: 1 },
        { id: 'h4', type: 'heading', text: '조영제 부작용', level: 'h3' },
        { id: 'p2', type: 'paragraph', text: '• 경미: 열감, 오심, 두드러기, 주사 부위 통증 (대부분 자연 소실)\n• 중등도: 기관지 경련, 후두부종, 저혈압 (즉시 치료)\n• 중증: 아나필락시스, 심정지, 신부전 (매우 드묾, 0.01% 이하)\n• 지연성: 피부 발진, 가려움 (수일 후 발생 가능)\n• 신독성: 신기능 저하 환자에서 조영제 유발 신병증 가능' },
        { id: 'd2', type: 'divider' },
        { id: 'c1', type: 'checkbox', label: '조영제 사용의 필요성과 부작용에 대해 설명을 들었습니다', required: true },
        { id: 'c2', type: 'checkbox', label: '사전 확인 사항을 정확하게 기재하였습니다', required: true },
        { id: 'c3', type: 'checkbox', label: '조영제 사용에 동의합니다', required: true },
        { id: 'dt1', type: 'date_input', label: '날짜', required: true },
        { id: 's1', type: 'signature', label: '환자(보호자) 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '설명 의사/방사선사 서명', role: 'doctor' },
      ],
      content: { title: '조영제 사용 동의서', sections: ['검사 정보', '사전 확인', '조영제 부작용'] },
      requiredFields: ['검사 종류', '사전 확인 사항', '환자(보호자) 서명'] },

    { type: 'TREATMENT', name: '격리 치료 동의서', version: '1.0', description: '감염병 격리 치료 설명 및 동의', docNumber: 'CF-ISO-012',
      components: [
        { id: 'h1', type: 'heading', text: '격리 치료 동의서', level: 'h2' },
        { id: 'p1', type: 'paragraph', text: '「감염병의 예방 및 관리에 관한 법률」에 따라 감염 전파 방지를 위해 격리 치료가 필요합니다. 격리의 목적과 방법에 대해 설명드리고 동의를 구합니다.' },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', required: true },
        { id: 'h2', type: 'heading', text: '격리 정보', level: 'h3' },
        { id: 'ta1', type: 'textarea', label: '감염 원인/진단명', rows: 2, required: true },
        { id: 'cg1', type: 'checkbox_group', label: '격리 유형', options: ['접촉 격리 (Contact)', '비말 격리 (Droplet)', '공기 격리 (Airborne)', '보호 격리 (Protective)'], minRequired: 1 },
        { id: 'ta2', type: 'textarea', label: '예상 격리 기간', rows: 1, required: true },
        { id: 'h3', type: 'heading', text: '격리 중 준수 사항', level: 'h3' },
        { id: 'p2', type: 'paragraph', text: '• 격리 병실 밖으로 임의 이동 금지\n• 방문객 제한 (의료진 허가 시에만 면회 가능)\n• 개인 보호구(마스크, 가운 등) 착용 규정 준수\n• 격리 해제는 검사 결과에 따라 담당의가 결정합니다\n• 격리 기간 중 심리적 지원이 필요하시면 말씀해 주십시오' },
        { id: 'd2', type: 'divider' },
        { id: 'c1', type: 'checkbox', label: '격리 치료의 필요성과 방법에 대해 설명을 들었습니다', required: true },
        { id: 'c2', type: 'checkbox', label: '격리 중 준수 사항을 이해하고 따르겠습니다', required: true },
        { id: 'dt1', type: 'date_input', label: '날짜', required: true },
        { id: 's1', type: 'signature', label: '환자(보호자) 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '담당 의사 서명', role: 'doctor' },
      ],
      content: { title: '격리 치료 동의서', sections: ['격리 정보', '준수 사항'] },
      requiredFields: ['감염 원인/진단명', '격리 유형', '환자(보호자) 서명', '담당 의사 서명'] },

    { type: 'GENERAL', name: '퇴원 동의서 및 안내', version: '1.0', description: '퇴원 시 환자/보호자 확인 및 교육', docNumber: 'CF-DIS-013',
      components: [
        { id: 'h1', type: 'heading', text: '퇴원 동의서 및 안내', level: 'h2' },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', required: true },
        { id: 'dt1', type: 'date_input', label: '퇴원 날짜', required: true },
        { id: 'ta1', type: 'textarea', label: '퇴원 진단명', rows: 2, required: true },
        { id: 'h2', type: 'heading', text: '퇴원 후 주의사항', level: 'h3' },
        { id: 'ta2', type: 'textarea', label: '약물 복용 안내', rows: 3, required: true },
        { id: 'ta3', type: 'textarea', label: '식이/활동 제한', rows: 2, required: false },
        { id: 'ta4', type: 'textarea', label: '상처/드레싱 관리', rows: 2, required: false },
        { id: 'pb1', type: 'page_break' },
        { id: 'h3', type: 'heading', text: '응급 상황 안내', level: 'h3' },
        { id: 'p1', type: 'paragraph', text: '다음 증상 발생 시 즉시 응급실로 내원하십시오:\n• 발열(38℃ 이상) 지속\n• 수술 부위 출혈/고름\n• 심한 통증 악화\n• 호흡곤란, 흉통\n• 의식 변화' },
        { id: 'h4', type: 'heading', text: '외래 예약', level: 'h3' },
        { id: 't3', type: 'text_input', label: '외래 예약일', required: true },
        { id: 't4', type: 'text_input', label: '담당 진료과/의사', required: true },
        { id: 'd2', type: 'divider' },
        { id: 'c1', type: 'checkbox', label: '퇴원 후 주의사항에 대해 설명을 들었습니다', required: true },
        { id: 'c2', type: 'checkbox', label: '처방 약물의 복용법을 이해하였습니다', required: true },
        { id: 'c3', type: 'checkbox', label: '외래 예약일을 확인하였습니다', required: true },
        { id: 'dt2', type: 'date_input', label: '동의 날짜', required: true },
        { id: 's1', type: 'signature', label: '환자 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '보호자 서명', role: 'guardian' },
        { id: 's3', type: 'signature', label: '담당 간호사 서명', role: 'witness' },
      ],
      content: { title: '퇴원 동의서 및 안내', sections: ['퇴원 후 주의사항', '응급 상황 안내', '외래 예약'] },
      requiredFields: ['퇴원 진단명', '약물 복용 안내', '외래 예약일', '환자 서명'] },

    { type: 'GENERAL', name: '자의퇴원(DAMA) 동의서', version: '1.0', description: '의사의 권고에 반하는 퇴원 동의', docNumber: 'CF-DAM-014',
      components: [
        { id: 'h1', type: 'heading', text: '자의퇴원(DAMA) 동의서', level: 'h2' },
        { id: 'p1', type: 'paragraph', text: '본 동의서는 환자(보호자)가 담당의의 입원 치료 권고에 반하여 자의로 퇴원을 결정하는 경우에 작성됩니다.' },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', required: true },
        { id: 'ta1', type: 'textarea', label: '현재 진단명 및 치료 상태', rows: 3, required: true },
        { id: 'h2', type: 'heading', text: '담당의 소견', level: 'h3' },
        { id: 'ta2', type: 'textarea', label: '계속 입원이 필요한 의학적 사유', rows: 3, required: true },
        { id: 'ta3', type: 'textarea', label: '조기 퇴원 시 예상되는 위험', rows: 3, required: true },
        { id: 'd2', type: 'divider' },
        { id: 'pb1', type: 'page_break' },
        { id: 'h3', type: 'heading', text: '환자(보호자) 확인', level: 'h3' },
        { id: 'c1', type: 'checkbox', label: '담당의로부터 계속 입원 치료가 필요하다는 설명을 들었습니다', required: true },
        { id: 'c2', type: 'checkbox', label: '조기 퇴원에 따른 건강상 위험에 대해 충분히 설명을 들었습니다', required: true },
        { id: 'c3', type: 'checkbox', label: '위 사항을 이해하면서도 본인(보호자)의 자유의사에 의해 퇴원을 결정합니다', required: true },
        { id: 'c4', type: 'checkbox', label: '퇴원 후 발생하는 건강상 문제에 대해 병원에 책임을 묻지 않겠습니다', required: true },
        { id: 'ta4', type: 'textarea', label: '자의퇴원 사유', rows: 2, required: true },
        { id: 'dt1', type: 'date_input', label: '날짜', required: true },
        { id: 's1', type: 'signature', label: '환자 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '보호자 서명', role: 'guardian' },
        { id: 's3', type: 'signature', label: '담당 의사 서명', role: 'doctor' },
        { id: 's4', type: 'signature', label: '증인(간호사) 서명', role: 'witness' },
      ],
      content: { title: '자의퇴원(DAMA) 동의서', sections: ['현재 상태', '담당의 소견', '환자 확인'] },
      requiredFields: ['현재 진단명', '계속 입원 필요 사유', '조기 퇴원 위험', '환자 서명', '담당 의사 서명'] },

    { type: 'PROCEDURE', name: '중심정맥관 삽입 동의서', version: '1.0', description: '중심정맥관(PICC/CVC) 삽입 시술 동의', docNumber: 'CF-CVC-015',
      components: [
        { id: 'h1', type: 'heading', text: '중심정맥관 삽입 동의서', level: 'h2' },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', required: true },
        { id: 'h2', type: 'heading', text: '시술 정보', level: 'h3' },
        { id: 'cg1', type: 'checkbox_group', label: '카테터 종류', options: ['중심정맥관(CVC) — 내경정맥', '중심정맥관(CVC) — 쇄골하정맥', '중심정맥관(CVC) — 대퇴정맥', 'PICC (말초삽입중심정맥관)', '포트(Chemo-port)'], minRequired: 1 },
        { id: 'ta1', type: 'textarea', label: '삽입 목적', rows: 2, required: true },
        { id: 'h3', type: 'heading', text: '합병증', level: 'h3' },
        { id: 'p1', type: 'paragraph', text: '• 삽입 시: 기흉, 혈흉, 동맥 천자, 공기 색전증, 부정맥, 신경 손상\n• 유지 중: 카테터 관련 혈류 감염(CRBSI), 혈전, 카테터 폐색, 위치 이탈\n• 제거 시: 출혈, 카테터 단절(잔류)\n• 대부분 합병증은 즉시 처치 가능하나, 드물게 수술이 필요할 수 있습니다' },
        { id: 'd2', type: 'divider' },
        { id: 'c1', type: 'checkbox', label: '중심정맥관 삽입의 필요성과 합병증에 대해 설명을 들었습니다', required: true },
        { id: 'c2', type: 'checkbox', label: '시술에 동의합니다', required: true },
        { id: 'dt1', type: 'date_input', label: '날짜', required: true },
        { id: 's1', type: 'signature', label: '환자(보호자) 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '시술 의사 서명', role: 'doctor' },
      ],
      content: { title: '중심정맥관 삽입 동의서', sections: ['카테터 종류', '삽입 목적', '합병증'] },
      requiredFields: ['카테터 종류', '삽입 목적', '환자(보호자) 서명', '시술 의사 서명'] },

    { type: 'TREATMENT', name: '억제대 사용 동의서', version: '1.0', description: '신체 억제대 적용 설명 및 동의', docNumber: 'CF-RST-016',
      components: [
        { id: 'h1', type: 'heading', text: '신체 억제대 사용 동의서', level: 'h2' },
        { id: 'p1', type: 'paragraph', text: '환자의 안전을 위해 불가피하게 신체 억제대를 사용하고자 합니다. 억제대는 최소한의 범위와 시간 동안만 적용되며, 정기적으로 재평가합니다.' },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', required: true },
        { id: 'h2', type: 'heading', text: '억제대 사용 사유', level: 'h3' },
        { id: 'cg1', type: 'checkbox_group', label: '적용 사유', options: ['낙상 위험 (의식 혼미/섬망)', '의료기기 자가 제거 방지 (기관내관, 카테터 등)', '자해/타해 위험', '기타'], minRequired: 1 },
        { id: 'cg2', type: 'checkbox_group', label: '억제대 종류', options: ['손목 억제대', '팔꿈치 억제대', '조끼형 억제대', '사지 억제대', '미트형(장갑형)'], minRequired: 1 },
        { id: 'h3', type: 'heading', text: '관리 계획', level: 'h3' },
        { id: 'p2', type: 'paragraph', text: '• 2시간마다 억제대 해제 및 피부/순환 상태 확인\n• 매 근무조마다 억제대 필요성 재평가\n• 환자 상태 호전 시 즉시 해제\n• 억제대 적용 중에도 환자의 존엄성을 존중합니다' },
        { id: 'd2', type: 'divider' },
        { id: 'c1', type: 'checkbox', label: '억제대 사용의 필요성에 대해 설명을 들었습니다', required: true },
        { id: 'c2', type: 'checkbox', label: '억제대 사용에 동의합니다', required: true },
        { id: 'dt1', type: 'date_input', label: '날짜', required: true },
        { id: 's1', type: 'signature', label: '보호자(법정대리인) 서명', role: 'guardian' },
        { id: 's2', type: 'signature', label: '담당 의사 서명', role: 'doctor' },
        { id: 's3', type: 'signature', label: '담당 간호사 서명', role: 'witness' },
      ],
      content: { title: '억제대 사용 동의서', sections: ['사용 사유', '억제대 종류', '관리 계획'] },
      requiredFields: ['적용 사유', '억제대 종류', '보호자 서명', '담당 의사 서명'] },

    /**
     * 진료 녹음·AI 문서화 동의서(RECORDING) — 🔴 **법무 검토 전 초안 견본**이지 원내 표준이 아니다(2026-09-22 · voice-emr §13.4 D4).
     * 문안은 shared 정본 `RECORDING_CONSENT_DRAFT`(A-1 · 2026-07-07)에서만 온다 — 시드가 문안을 따로 들지 않는다.
     * 이름·설명·본문 첫 줄에 검토 전 표시가 박힌다(시드가 정책을 정해버린 전례 · CLAUDE.md 함정 4). docNumber 는 법무 확정 전이라 부여하지 않는다.
     * `[ ]` 항목(보존기간 등)은 비어 있는 채로 간다 — 지어내지 않는다. 가드: `test/consent-recording-seed-draft.spec.ts`.
     */
    { type: 'RECORDING', name: `진료 녹음·AI 문서화 동의서 [${RECORDING_CONSENT_DRAFT.statusLabel}]`, version: '0.1',
      description: `${RECORDING_CONSENT_DRAFT.statusLabel}(${RECORDING_CONSENT_DRAFT.draftedOn} · ${RECORDING_CONSENT_DRAFT.section}) — 확정 문안이 아니며 원내 표준이 아니다. 출처 ${RECORDING_CONSENT_DRAFT.source}`,
      components: [
        { id: 'h1', type: 'heading', text: `${RECORDING_CONSENT_DRAFT.title} [${RECORDING_CONSENT_DRAFT.statusLabel}]`, level: 'h2' },
        { id: 'p0', type: 'paragraph', text: recordingConsentDraftText().split('\n')[0] },
        { id: 'p1', type: 'paragraph', text: RECORDING_CONSENT_DRAFT.intro },
        { id: 'd1', type: 'divider' },
        { id: 't1', type: 'text_input', label: '환자 성명', placeholder: '{{patient.name}}', required: true },
        { id: 't2', type: 'text_input', label: '등록번호', placeholder: '{{patient.mrn}}', required: true },
        { id: 'd2', type: 'divider' },
        ...RECORDING_CONSENT_DRAFT.items.map((it) => ({ id: `i${it.no}`, type: 'paragraph', text: `${it.no}. ${it.heading}: ${it.text}` })),
        { id: 'd3', type: 'divider' },
        { id: 'c1', type: 'checkbox', label: RECORDING_CONSENT_DRAFT.consentLines[0], required: false },
        { id: 'c2', type: 'checkbox', label: RECORDING_CONSENT_DRAFT.consentLines[1], required: false },
        { id: 'dt1', type: 'date_input', label: '동의 날짜', required: true },
        { id: 's1', type: 'signature', label: '환자 서명', role: 'patient' },
        { id: 's2', type: 'signature', label: '보호자 서명 (대리 동의 시 · 성명·관계)', role: 'guardian' },
      ],
      content: {
        title: RECORDING_CONSENT_DRAFT.title,
        sections: RECORDING_CONSENT_DRAFT.items.map((it) => it.heading),
        reviewStatus: RECORDING_CONSENT_DRAFT.status,
        unresolved: RECORDING_CONSENT_DRAFT.unresolved,
        explanation: recordingConsentDraftText(),
      },
      requiredFields: ['환자 성명', '동의 날짜', '환자 서명'] },
  ];
  for (const ct of consentTemplates) {
    const { docNumber, ...ctData } = ct as any;
    const variables = docNumber ? { docNumber } : undefined;
    /**
     * 🔴 2026-08-28 — `where: { name }` 이었다. `ConsentTemplate.name` 의 단독 unique 는
     *    **2026-07-21 에 제거됐다**(언어별 동의서 — 같은 이름이 언어마다 존재한다).
     *    unique 가 아닌 필드로 upsert 하면 Prisma 가 던진다. 이름+언어로 찾아 분기한다.
     */
    const existingCt = await prisma.consentTemplate.findFirst({
      where: { name: ct.name, ...(('language' in (ct as any)) ? { language: (ct as any).language } : {}) },
      select: { id: true },
    });
    const ctPayload = {
      components: ct.components as any, description: ct.description,
      content: ct.content as any, requiredFields: ct.requiredFields as any, variables: variables as any,
    };
    if (existingCt) {
      await prisma.consentTemplate.update({ where: { id: existingCt.id }, data: ctPayload });
    } else {
      await prisma.consentTemplate.create({ data: { ...ctData, variables: variables as any } });
    }
  }

  console.log('  [12/12] EMR: Encounter Templates + Questionnaire Forms...');
  // adminId reused from line 103

  const encounterTemplates = [
    { department: '내과', name: '내과 초진 템플릿', version: '1.0', description: '내과 초진 환자용 SOAP 구조화 템플릿',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '주호소 (Chief Complaint)', key: 'chiefComplaint' },
          { type: 'textarea', label: '현병력 (HPI)', key: 'hpi' },
          { type: 'checklist', label: 'ROS (Review of Systems)', key: 'ros', options: ['발열', '두통', '흉통', '복통', '호흡곤란', '기침', '오심/구토', '설사', '체중변화'] },
        ],
        objective: [
          { type: 'vitals', label: '활력징후', key: 'vitals' },
          { type: 'textarea', label: '신체검사 소견', key: 'physicalExam' },
        ],
        assessment: [
          { type: 'diagnosis-search', label: '진단 (KCD-8)', key: 'diagnosis', codeSystem: 'KCD-8' },
        ],
        plan: [
          { type: 'prescription', label: '처방', key: 'prescription' },
          { type: 'textarea', label: '치료 계획', key: 'treatmentPlan' },
          { type: 'textarea', label: '환자 교육', key: 'patientEducation' },
        ],
      },
    },
    { department: '외과', name: '외과 수술 전 평가 템플릿', version: '1.0', description: '수술 전 전신 평가용 템플릿',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '수술 전 증상', key: 'preOpSymptoms' },
          { type: 'checklist', label: '과거 수술력', key: 'surgicalHistory', options: ['전신마취 경험', '수술 합병증 경험', '마취 부작용'] },
        ],
        objective: [
          { type: 'vitals', label: '활력징후', key: 'vitals' },
          { type: 'textarea', label: '수술 부위 소견', key: 'surgicalSiteExam' },
          { type: 'textarea', label: '검사 결과 요약', key: 'labSummary' },
        ],
        assessment: [
          { type: 'diagnosis-search', label: '수술 전 진단', key: 'preOpDiagnosis' },
          { type: 'select', label: 'ASA 분류', key: 'asaClass', options: ['I', 'II', 'III', 'IV', 'V'] },
        ],
        plan: [
          { type: 'textarea', label: '수술명/방법', key: 'plannedProcedure' },
          { type: 'textarea', label: '수술 전 준비 지시', key: 'preOpOrders' },
        ],
      },
    },
    { department: '응급의학과', name: '응급 초기 평가 템플릿', version: '1.0', description: '응급실 KTAS 트리아지 + 초기 평가',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '주호소', key: 'chiefComplaint' },
          { type: 'textarea', label: '발생 경위', key: 'mechanism' },
          { type: 'select', label: 'KTAS 등급', key: 'ktasLevel', options: ['Level 1 (소생)', 'Level 2 (긴급)', 'Level 3 (응급)', 'Level 4 (준응급)', 'Level 5 (비응급)'] },
        ],
        objective: [
          { type: 'vitals', label: '활력징후', key: 'vitals' },
          { type: 'select', label: '의식수준 (AVPU)', key: 'avpu', options: ['Alert', 'Verbal', 'Pain', 'Unresponsive'] },
          { type: 'textarea', label: '신체검사', key: 'physicalExam' },
        ],
        assessment: [
          { type: 'diagnosis-search', label: '잠정 진단', key: 'provisionalDiagnosis' },
        ],
        plan: [
          { type: 'prescription', label: '응급 처방', key: 'emergencyOrders' },
          { type: 'select', label: '처치 방향', key: 'disposition', options: ['경과 관찰', '입원', '전원', '귀가'] },
        ],
      },
    },
    // ── 순환기내과 ──
    { department: '내과', name: '순환기내과 진료 템플릿', version: '1.0', description: '심혈관 질환 전문 SOAP',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '주호소', key: 'cc' },
          { type: 'checklist', label: '심혈관 증상', key: 'cvSymptoms', options: ['흉통', '호흡곤란', '심계항진', '실신', '하지부종', '야간호흡곤란'] },
        ],
        objective: [
          { type: 'vitals', label: '활력징후', key: 'vitals' },
          { type: 'select', label: 'NYHA 분류', key: 'nyha', options: ['Class I', 'Class II', 'Class III', 'Class IV'] },
          { type: 'text', label: 'LVEF (%)', key: 'lvef' },
          { type: 'textarea', label: 'ECG 소견', key: 'ecg' },
        ],
        assessment: [{ type: 'diagnosis-search', label: '진단', key: 'dx', codeSystem: 'KCD-8' }],
        plan: [{ type: 'prescription', label: '처방', key: 'rx' }, { type: 'textarea', label: '계획', key: 'plan' }],
      },
    },
    // ── 소화기내과 ──
    { department: '내과', name: '소화기내과 진료 템플릿', version: '1.0', description: '소화기 질환 전문 SOAP',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '주호소', key: 'cc' },
          { type: 'checklist', label: 'GI 증상', key: 'giSymptoms', options: ['복통', '오심/구토', '설사', '변비', '혈변', '흑색변', '연하곤란', '속쓰림', '체중감소'] },
        ],
        objective: [
          { type: 'vitals', label: '활력징후', key: 'vitals' },
          { type: 'textarea', label: '복부 검사', key: 'abdominalExam' },
          { type: 'textarea', label: '내시경 소견', key: 'endoscopy' },
        ],
        assessment: [{ type: 'diagnosis-search', label: '진단', key: 'dx' }],
        plan: [{ type: 'prescription', label: '처방', key: 'rx' }, { type: 'textarea', label: '계획', key: 'plan' }],
      },
    },
    // ── 내분비내과 ──
    { department: '내과', name: '내분비내과 진료 템플릿', version: '1.0', description: '당뇨/갑상선 전문',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '주호소', key: 'cc' },
          { type: 'checklist', label: '내분비 증상', key: 'endoSymptoms', options: ['다음', '다뇨', '다식', '체중변화', '피로', '손발저림', '추위/더위 민감'] },
        ],
        objective: [
          { type: 'vitals', label: '활력징후 + 체중/BMI', key: 'vitals' },
          { type: 'text', label: 'HbA1c (%)', key: 'hba1c' },
          { type: 'text', label: '공복혈당 (mg/dL)', key: 'fbg' },
          { type: 'text', label: 'TSH / Free T4', key: 'thyroid' },
        ],
        assessment: [{ type: 'diagnosis-search', label: '진단', key: 'dx' }],
        plan: [{ type: 'prescription', label: '처방', key: 'rx' }, { type: 'textarea', label: '교육/계획', key: 'plan' }],
      },
    },
    // ── 정형외과 ──
    { department: '정형외과', name: '정형외과 진료 템플릿', version: '1.0', description: 'ROM + 근력검사 + 영상',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '주호소', key: 'cc' },
          { type: 'select', label: '손상 부위', key: 'site', options: ['경추', '흉추', '요추', '어깨', '팔꿈치', '손목/손', '고관절', '무릎', '발목/발'] },
          { type: 'select', label: '통증 NRS', key: 'nrs', options: ['0','1','2','3','4','5','6','7','8','9','10'] },
        ],
        objective: [
          { type: 'vitals', label: '활력징후', key: 'vitals' },
          { type: 'textarea', label: 'ROM 측정', key: 'rom', placeholder: '굴곡/신전/외전/내전 (각도)' },
          { type: 'textarea', label: '근력 검사 (MMT)', key: 'mmt', placeholder: '0-5등급' },
          { type: 'textarea', label: '특수검사', key: 'specialTest', placeholder: 'SLR, Lachman, McMurray 등' },
          { type: 'textarea', label: '영상 소견', key: 'imaging' },
        ],
        assessment: [{ type: 'diagnosis-search', label: '진단', key: 'dx' }],
        plan: [{ type: 'prescription', label: '처방', key: 'rx' }, { type: 'textarea', label: '치료계획', key: 'plan' }],
      },
    },
    // ── 신경외과 ──
    { department: '신경외과', name: '신경외과 진료 템플릿', version: '1.0', description: 'GCS + 신경학적 검사',
      soapSections: {
        subjective: [{ type: 'textarea', label: '주호소/발생 경위', key: 'cc' }],
        objective: [
          { type: 'vitals', label: '활력징후', key: 'vitals' },
          { type: 'select', label: 'GCS (E+V+M)', key: 'gcs', options: ['15 (정상)','14','13','12','11','10','9','8 이하 (혼수)'] },
          { type: 'textarea', label: '동공 반응', key: 'pupils', placeholder: '크기(mm), 대광반사' },
          { type: 'textarea', label: '운동/감각 검사', key: 'motorSensory' },
          { type: 'textarea', label: '뇌신경 검사', key: 'cranialNerve' },
          { type: 'textarea', label: '영상 소견', key: 'imaging' },
        ],
        assessment: [{ type: 'diagnosis-search', label: '진단', key: 'dx' }],
        plan: [{ type: 'prescription', label: '처방', key: 'rx' }, { type: 'textarea', label: '수술/치료계획', key: 'plan' }],
      },
    },
    // ── 소아청소년과 ──
    { department: '소아청소년과', name: '소아과 진료 템플릿', version: '1.0', description: '소아 전용 SOAP + 성장발달',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '주호소 (보호자 진술)', key: 'cc' },
          { type: 'textarea', label: '식이/수유', key: 'feeding' },
          { type: 'textarea', label: '수면/배변', key: 'sleepBowel' },
        ],
        objective: [
          { type: 'vitals', label: '활력징후', key: 'vitals' },
          { type: 'text', label: '체중 (kg)', key: 'weight' },
          { type: 'text', label: '신장 (cm)', key: 'height' },
          { type: 'text', label: '두위 (cm)', key: 'headCircumference' },
          { type: 'textarea', label: '신체검사', key: 'pe' },
          { type: 'textarea', label: '발달 평가', key: 'development', placeholder: '대운동/소운동/언어/사회성' },
        ],
        assessment: [{ type: 'diagnosis-search', label: '진단', key: 'dx' }],
        plan: [
          { type: 'prescription', label: '처방', key: 'rx' },
          { type: 'textarea', label: '예방접종', key: 'vaccination' },
          { type: 'textarea', label: '보호자 교육', key: 'education' },
        ],
      },
    },
    // ── 산부인과 ──
    { department: '산부인과', name: '산부인과 진료 템플릿', version: '1.0', description: '산전/부인과 통합',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '주호소', key: 'cc' },
          { type: 'text', label: 'G_P_ (임신/분만력)', key: 'gp' },
          { type: 'text', label: 'LMP (최종월경)', key: 'lmp' },
          { type: 'checklist', label: '증상', key: 'symptoms', options: ['질출혈', '복통', '분비물', '빈뇨', '유방통', '태동 감소'] },
        ],
        objective: [
          { type: 'vitals', label: '활력징후 + 체중', key: 'vitals' },
          { type: 'text', label: '자궁저 높이 (cm)', key: 'fundalHeight' },
          { type: 'text', label: '태아심박수 (FHR)', key: 'fhr' },
          { type: 'textarea', label: '초음파 소견', key: 'ultrasound' },
          { type: 'textarea', label: '골반검사/내진', key: 'pelvicExam' },
        ],
        assessment: [{ type: 'diagnosis-search', label: '진단', key: 'dx' }],
        plan: [{ type: 'prescription', label: '처방', key: 'rx' }, { type: 'textarea', label: '계획', key: 'plan' }],
      },
    },
    // ── 정신건강의학과 ──
    { department: '정신건강의학과', name: '정신과 진료 템플릿 (MSE)', version: '1.0', description: '정신상태검사 포함 SOAP',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '주호소/현병력', key: 'cc' },
          { type: 'textarea', label: '정신과 병력', key: 'psychHistory' },
          { type: 'select', label: '자살사고', key: 'suicidalIdeation', options: ['없음', '수동적 사고', '능동적 사고 (계획 없음)', '능동적 사고 (계획 있음)'] },
        ],
        objective: [
          { type: 'select', label: '외관', key: 'appearance', options: ['단정', '연령 상응', '나이보다 늙어 보임', '비위생적'] },
          { type: 'select', label: '행동', key: 'behavior', options: ['협조적', '초조', '위축', '적대적', '정신운동 지연'] },
          { type: 'select', label: '기분 (Mood)', key: 'mood', options: ['우울', '불안', '분노', '행복', '무감동', '정상'] },
          { type: 'select', label: '정동 (Affect)', key: 'affect', options: ['적절', '제한적', '둔마', '평탄', '불안정'] },
          { type: 'select', label: '사고과정', key: 'thoughtProcess', options: ['논리적', '우원적', '이완', '비약', '사고차단'] },
          { type: 'textarea', label: '사고내용', key: 'thoughtContent', placeholder: '망상, 강박, 공포 등' },
          { type: 'select', label: '지각장애', key: 'perception', options: ['없음', '환청', '환시', '환촉', '이인증'] },
          { type: 'select', label: '인지/지남력', key: 'cognition', options: ['정상', '시간 지남력 장애', '장소 지남력 장애', '사람 지남력 장애'] },
          { type: 'select', label: '통찰', key: 'insight', options: ['양호', '부분적', '불량'] },
          { type: 'select', label: '판단', key: 'judgment', options: ['양호', '보통', '불량'] },
        ],
        assessment: [{ type: 'diagnosis-search', label: '진단 (KCD)', key: 'dx' }],
        plan: [{ type: 'prescription', label: '처방', key: 'rx' }, { type: 'textarea', label: '치료계획/상담', key: 'plan' }],
      },
    },
    // ── 안과 ──
    { department: '안과', name: '안과 진료 템플릿', version: '1.0', description: '시력/안압/세극등/안저',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '주호소', key: 'cc' },
          { type: 'checklist', label: '안과 증상', key: 'eyeSymptoms', options: ['시력저하', '충혈', '통증', '이물감', '눈물', '분비물', '비문증', '섬광'] },
        ],
        objective: [
          { type: 'text', label: '시력 (우/좌)', key: 'visualAcuity', placeholder: '우: 0.8 / 좌: 1.0' },
          { type: 'text', label: '교정시력 (우/좌)', key: 'correctedVA' },
          { type: 'text', label: '안압 IOP (우/좌 mmHg)', key: 'iop' },
          { type: 'textarea', label: '세극등 검사', key: 'slitLamp' },
          { type: 'textarea', label: '안저 검사', key: 'fundus' },
        ],
        assessment: [{ type: 'diagnosis-search', label: '진단', key: 'dx' }],
        plan: [{ type: 'prescription', label: '처방(점안약 등)', key: 'rx' }, { type: 'textarea', label: '계획', key: 'plan' }],
      },
    },
    // ── 이비인후과 ──
    { department: '이비인후과', name: '이비인후과 진료 템플릿', version: '1.0', description: '청력/내시경/성대',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '주호소', key: 'cc' },
          { type: 'checklist', label: 'ENT 증상', key: 'entSymptoms', options: ['난청', '이명', '어지럼', '이통', '비폐색', '비루', '인후통', '연하곤란', '쉰목소리'] },
        ],
        objective: [
          { type: 'textarea', label: '고막 소견', key: 'tympanic' },
          { type: 'textarea', label: '비강 내시경', key: 'nasalEndoscopy' },
          { type: 'textarea', label: '인후/후두 소견', key: 'larynx' },
          { type: 'textarea', label: '청력검사 결과', key: 'audiometry', placeholder: 'PTA 우/좌 (dB), SRT, SDS' },
        ],
        assessment: [{ type: 'diagnosis-search', label: '진단', key: 'dx' }],
        plan: [{ type: 'prescription', label: '처방', key: 'rx' }, { type: 'textarea', label: '계획', key: 'plan' }],
      },
    },
    // ── 피부과 ──
    { department: '피부과', name: '피부과 진료 템플릿', version: '1.0', description: '병변 기술 ABCDE + 분포',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '주호소', key: 'cc' },
          { type: 'text', label: '발생 시기', key: 'onset' },
          { type: 'checklist', label: '동반 증상', key: 'symptoms', options: ['소양감', '통증', '작열감', '삼출', '출혈', '탈모'] },
        ],
        objective: [
          { type: 'textarea', label: '병변 기술 (ABCDE)', key: 'lesionDescription', placeholder: 'A(비대칭), B(경계), C(색상), D(직경), E(변화)' },
          { type: 'checklist', label: '병변 유형', key: 'lesionType', options: ['반점', '구진', '판', '결절', '수포', '농포', '궤양', '미란', '인설', '가피'] },
          { type: 'textarea', label: '분포 부위', key: 'distribution', placeholder: '체간, 사지, 안면 등' },
        ],
        assessment: [{ type: 'diagnosis-search', label: '진단', key: 'dx' }],
        plan: [{ type: 'prescription', label: '처방(외용제 등)', key: 'rx' }, { type: 'textarea', label: '계획', key: 'plan' }],
      },
    },
    // ── 비뇨의학과 ──
    { department: '비뇨의학과', name: '비뇨의학과 진료 템플릿', version: '1.0', description: 'IPSS + 요류검사',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '주호소', key: 'cc' },
          { type: 'checklist', label: '배뇨 증상', key: 'urinarySymptoms', options: ['빈뇨', '급뇨', '야간뇨', '잔뇨감', '약뇨', '간헐뇨', '배뇨통', '혈뇨'] },
          { type: 'select', label: 'IPSS 총점', key: 'ipss', options: ['0-7 (경증)','8-19 (중등)','20-35 (중증)'] },
        ],
        objective: [
          { type: 'vitals', label: '활력징후', key: 'vitals' },
          { type: 'text', label: 'PSA (ng/mL)', key: 'psa' },
          { type: 'text', label: 'Qmax (mL/s)', key: 'qmax' },
          { type: 'text', label: '잔뇨량 (mL)', key: 'pvr' },
          { type: 'textarea', label: '신체검사/DRE', key: 'dre' },
        ],
        assessment: [{ type: 'diagnosis-search', label: '진단', key: 'dx' }],
        plan: [{ type: 'prescription', label: '처방', key: 'rx' }, { type: 'textarea', label: '계획', key: 'plan' }],
      },
    },
    // ── 재활의학과 ──
    { department: '재활의학과', name: '재활의학과 진료 템플릿', version: '1.0', description: 'FIM + ROM + 근력 + ADL',
      soapSections: {
        subjective: [{ type: 'textarea', label: '주호소/기능 제한', key: 'cc' }],
        objective: [
          { type: 'vitals', label: '활력징후', key: 'vitals' },
          { type: 'textarea', label: 'ROM 측정', key: 'rom', placeholder: '관절별 능동/수동 각도' },
          { type: 'textarea', label: '근력 검사 (MMT 0-5)', key: 'mmt' },
          { type: 'select', label: 'Barthel Index', key: 'barthelIndex', options: ['0-20 (완전의존)','21-60 (중등도의존)','61-90 (경도의존)','91-99 (최소의존)','100 (독립)'] },
          { type: 'textarea', label: '보행/균형 평가', key: 'gaitBalance', placeholder: 'Berg Balance Scale, 보행보조기 유무' },
        ],
        assessment: [{ type: 'diagnosis-search', label: '진단', key: 'dx' }],
        plan: [{ type: 'textarea', label: '재활치료 계획', key: 'rehabPlan', placeholder: 'PT/OT/ST 주 _회, 목표' }],
      },
    },
    // ── 가정의학과 ──
    { department: '가정의학과', name: '가정의학과 진료 템플릿', version: '1.0', description: '건강검진 + 생활습관 상담',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '주호소/검진 목적', key: 'cc' },
          { type: 'select', label: '흡연', key: 'smoking', options: ['비흡연', '현재흡연 (___갑년)', '과거흡연'] },
          { type: 'select', label: '음주', key: 'drinking', options: ['안 함', '주 1-2회', '주 3-4회', '매일'] },
          { type: 'select', label: '운동', key: 'exercise', options: ['안 함', '주 1-2회', '주 3-4회', '매일'] },
        ],
        objective: [
          { type: 'vitals', label: '활력징후 + 체중/BMI/허리둘레', key: 'vitals' },
          { type: 'textarea', label: '검진 결과 요약', key: 'screeningResults' },
        ],
        assessment: [{ type: 'diagnosis-search', label: '진단', key: 'dx' }],
        plan: [
          { type: 'textarea', label: '생활습관 교정', key: 'lifestyle' },
          { type: 'textarea', label: '예방접종/검진 계획', key: 'screening' },
          { type: 'prescription', label: '처방', key: 'rx' },
        ],
      },
    },
    // ── 마취통증의학과 ──
    { department: '마취통증의학과', name: '마취 전 평가 템플릿', version: '1.0', description: 'ASA + Mallampati + 기도평가',
      soapSections: {
        subjective: [
          { type: 'textarea', label: '수술명/예정 마취', key: 'plannedSurgery' },
          { type: 'textarea', label: '마취 과거력/부작용', key: 'anesthesiaHistory' },
          { type: 'checklist', label: '검토 항목', key: 'review', options: ['금식 확인', '동의서 확인', '알레르기 확인', '복용약 확인', '의치/보철물'] },
        ],
        objective: [
          { type: 'vitals', label: '활력징후', key: 'vitals' },
          { type: 'select', label: 'ASA 분류', key: 'asa', options: ['I (건강)', 'II (경미한 전신질환)', 'III (중증 전신질환)', 'IV (생명 위협)', 'V (빈사)'] },
          { type: 'select', label: 'Mallampati 등급', key: 'mallampati', options: ['Class I', 'Class II', 'Class III', 'Class IV'] },
          { type: 'textarea', label: '기도 평가', key: 'airway', placeholder: '개구도, 갑상설골거리, 경추 ROM' },
          { type: 'textarea', label: '검사결과 요약', key: 'labs' },
        ],
        assessment: [{ type: 'textarea', label: '마취 계획', key: 'anesthesiaPlan' }],
        plan: [{ type: 'textarea', label: '전처치/주의사항', key: 'premedication' }],
      },
    },
  ];
  for (const et of encounterTemplates) {
    await prisma.encounterTemplate.upsert({
      where: { name: et.name },
      update: {},
      create: { ...et, createdBy: adminId },
    });
  }

  // 문진표 FormSchema 시딩 — 표준 건강검진 + 진료과별 특화
  const questionnaireSchemas = [
    // ── 1. 초진 문진표 (공통, 보강) ──
    { name: 'questionnaire-initial', version: '2.0', locale: 'ko', category: 'QUESTIONNAIRE', estimatedMinutes: 8, description: '초진 환자 공통 문진표',
      schema: {
        title: '초진 문진표', description: '처음 방문하시는 환자분께서 작성해주세요.',
        sections: [
          { title: '현재 증상', fields: [
            { type: 'textarea', label: '현재 불편한 증상', key: 'chiefComplaint', placeholder: '어디가, 언제부터, 어떻게 불편한지 자세히 적어주세요', required: true },
            { type: 'select', label: '증상 시작 시기', key: 'onsetDuration', options: ['오늘', '2~3일 전', '1주일 전', '2주~1개월', '1개월 이상', '6개월 이상'] },
            { type: 'select', label: '증상 정도', key: 'severity', options: ['경미 (일상생활 가능)', '보통 (불편하지만 참을만함)', '심함 (일상생활 어려움)', '매우 심함 (응급)'] },
            { type: 'select', label: '증상 양상', key: 'pattern', options: ['지속적', '간헐적 (왔다갔다)', '점점 악화', '점점 호전', '특정 상황에서만'] },
          ]},
          { title: '과거 병력', fields: [
            { type: 'checkbox', label: '현재 앓고 있는 질환 (해당 항목 선택)', key: 'currentDiseases', options: ['고혈압', '당뇨병', '고지혈증', '심장질환', '뇌혈관질환(뇌졸중)', '간질환', '신장질환', '폐/호흡기질환', '갑상선질환', '암(종류:)', '관절염', '골다공증', '우울증/불안증', '기타'] },
            { type: 'textarea', label: '수술/입원 이력', key: 'surgeryHistory', placeholder: '수술명, 시기, 병원명 (예: 2020년 맹장수술)' },
            { type: 'textarea', label: '외상/사고 이력', key: 'traumaHistory', placeholder: '교통사고, 낙상 등' },
          ]},
          { title: '약물/알레르기', fields: [
            { type: 'textarea', label: '현재 복용 약물', key: 'currentMedications', placeholder: '약물명, 용량, 복용 횟수\n(예: 아스피린 100mg 1일 1회)' },
            { type: 'textarea', label: '약물 알레르기', key: 'drugAllergy', placeholder: '알레르기 약물명과 반응 (예: 페니실린 - 발진)' },
            { type: 'textarea', label: '식품/기타 알레르기', key: 'otherAllergy', placeholder: '음식, 라텍스, 조영제 등' },
          ]},
          { title: '가족력', fields: [
            { type: 'checkbox', label: '가족 중 해당 질환이 있는 분 (해당 항목 선택)', key: 'familyDiseases', options: ['고혈압', '당뇨병', '심장질환', '뇌졸중', '암', '결핵', '간질환', '정신질환', '기타'] },
            { type: 'text', label: '상세 (관계, 질환)', key: 'familyDetail', placeholder: '부: 고혈압, 모: 당뇨' },
          ]},
          { title: '생활습관', fields: [
            { type: 'select', label: '흡연', key: 'smoking', options: ['비흡연', '현재 흡연', '과거 흡연 (금연)'] },
            { type: 'text', label: '흡연량 (흡연 시)', key: 'smokingAmount', placeholder: '하루 1갑, 20년 등', conditional: { showIf: { field: 'smoking', value: '현재 흡연' } } },
            { type: 'select', label: '음주', key: 'drinking', options: ['안 함', '월 1~2회', '주 1~2회', '주 3회 이상', '매일'] },
            { type: 'text', label: '음주량 (음주 시)', key: 'drinkingAmount', placeholder: '소주 반병, 맥주 2캔 등' },
            { type: 'select', label: '운동', key: 'exercise', options: ['안 함', '주 1~2회 (30분 이상)', '주 3~4회', '매일'] },
          ]},
        ],
      },
    },
    // ── 2. 재진 문진표 (보강) ──
    { name: 'questionnaire-followup', version: '2.0', locale: 'ko', category: 'QUESTIONNAIRE', estimatedMinutes: 3, description: '재진 환자 추적 문진표',
      schema: {
        title: '재진 문진표', description: '지난 진료 이후 변화를 알려주세요.',
        sections: [
          { title: '증상 변화', fields: [
            { type: 'select', label: '지난 진료 이후 증상 변화', key: 'symptomChange', options: ['많이 호전', '조금 호전', '변화 없음', '조금 악화', '많이 악화', '새로운 증상 발생'], required: true },
            { type: 'textarea', label: '변화 상세', key: 'symptomDetail', placeholder: '구체적으로 어떻게 변했는지 적어주세요' },
          ]},
          { title: '약물 복용', fields: [
            { type: 'select', label: '처방약 복용 상태', key: 'compliance', options: ['처방대로 복용 중', '가끔 빠뜨림 (주 1~2회)', '자주 빠뜨림', '복용 중단', '처방약 없음'] },
            { type: 'textarea', label: '약 부작용/불편', key: 'sideEffects', placeholder: '복용 후 불편한 점이 있으면 적어주세요' },
          ]},
          { title: '추가 사항', fields: [
            { type: 'textarea', label: '의료진에게 전달할 사항', key: 'additional', placeholder: '질문, 요청, 생활 변화 등' },
          ]},
        ],
      },
    },
    // ── 3. 수술 전 문진표 (보강) ──
    { name: 'questionnaire-preop', version: '2.0', locale: 'ko', category: 'QUESTIONNAIRE', estimatedMinutes: 10, description: '수술 전 필수 확인 문진표',
      schema: {
        title: '수술 전 문진표', description: '안전한 수술을 위해 반드시 정확하게 작성해주세요.',
        sections: [
          { title: '마취 관련', fields: [
            { type: 'select', label: '이전 마취 경험', key: 'priorAnesthesia', options: ['없음', '전신마취', '부분/척추마취', '국소마취'], required: true },
            { type: 'textarea', label: '마취 부작용 경험', key: 'anesthesiaReaction', placeholder: '구역, 구토, 호흡곤란, 알레르기 등' },
            { type: 'select', label: '마취 후 구역/구토 경험', key: 'ponv', options: ['없음', '경미', '심했음'] },
            { type: 'select', label: '악성고열증 가족력', key: 'malignantHyperthermia', options: ['없음', '있음', '모름'] },
          ]},
          { title: '수술 전 상태', fields: [
            { type: 'select', label: '금식 상태', key: 'npoStatus', options: ['8시간 이상 금식', '6~8시간 금식', '금식 안 함'], required: true },
            { type: 'select', label: '의치/보철/렌즈', key: 'prosthetics', options: ['없음', '의치 (제거 가능)', '고정 보철물', '콘택트렌즈', '보청기'] },
            { type: 'select', label: '임신 가능성 (여성)', key: 'pregnancy', options: ['해당 없음', '없음', '가능성 있음', '임신 중'] },
          ]},
          { title: '현재 약물', fields: [
            { type: 'textarea', label: '복용 중인 약물', key: 'currentMeds', placeholder: '혈압약, 당뇨약, 혈액희석제(아스피린/와파린), 한약, 건강보조식품 등', required: true },
            { type: 'select', label: '혈액희석제 복용', key: 'anticoagulant', options: ['복용 안 함', '아스피린', '와파린', '클로피도그렐', '기타 항응고제'] },
            { type: 'select', label: '혈액희석제 중단 여부', key: 'anticoagulantStopped', options: ['해당 없음', '의사 지시대로 중단', '아직 중단 안 함'] },
          ]},
          { title: '기저질환', fields: [
            { type: 'checkbox', label: '해당 질환 선택', key: 'comorbidities', options: ['고혈압', '당뇨병', '심장질환', '폐질환/천식', '간질환', '신장질환', '뇌혈관질환', '출혈성 질환', '수면무호흡', '없음'] },
          ]},
          { title: '비상 연락처', fields: [
            { type: 'text', label: '보호자 이름', key: 'guardianName', placeholder: '홍길동', required: true },
            { type: 'text', label: '관계', key: 'guardianRelation', placeholder: '배우자, 자녀, 부모 등' },
            { type: 'text', label: '연락처', key: 'guardianPhone', placeholder: '010-0000-0000', required: true },
          ]},
        ],
      },
    },
    // ── 4. 대한민국 표준 건강검진 문진표 ──
    { name: 'health-checkup-standard', version: '1.0', locale: 'ko', category: 'QUESTIONNAIRE', estimatedMinutes: 15, description: '국민건강보험공단 건강검진 표준 문진표',
      schema: {
        title: '건강검진 문진표', description: '국민건강보험 건강검진 표준 문진표입니다. 정확한 건강 평가를 위해 빠짐없이 작성해주세요.',
        sections: [
          { title: '기본 정보', fields: [
            { type: 'select', label: '직업', key: 'occupation', options: ['사무직', '영업/서비스직', '생산/기술직', '전문직', '자영업', '주부', '학생', '무직/퇴직', '기타'] },
            { type: 'select', label: '결혼 상태', key: 'maritalStatus', options: ['미혼', '기혼', '이혼/별거', '사별'] },
          ]},
          { title: '질병력', fields: [
            { type: 'checkbox', label: '의사로부터 진단받은 질환 (해당 항목 모두 선택)', key: 'diagnosedDiseases', options: [
              '고혈압', '당뇨병', '이상지질혈증(고지혈증)', '뇌졸중(중풍)', '심장병(협심증/심근경색)',
              'B형간염', 'C형간염', '간경변', '폐결핵', '암(종류:)',
              '우울증', '갑상선질환', '빈혈', '골다공증', '통풍',
              '만성콩팥병', '치매', '없음'
            ], required: true },
            { type: 'textarea', label: '기타 질환', key: 'otherDiseases', placeholder: '위 목록에 없는 질환이 있으면 적어주세요' },
            { type: 'select', label: '최근 6개월 내 10kg 이상 체중 변화', key: 'weightChange', options: ['변화 없음', '증가', '감소'] },
          ]},
          { title: '가족력 (부모, 형제, 자매)', fields: [
            { type: 'checkbox', label: '가족 중 해당 질환 (모두 선택)', key: 'familyHistory', options: [
              '고혈압', '당뇨병', '심장병', '뇌졸중', '간암', '위암', '대장암', '유방암', '폐암',
              '갑상선암', '기타 암', '결핵', '없음'
            ] },
          ]},
          { title: '흡연', fields: [
            { type: 'select', label: '흡연 상태', key: 'smokingStatus', options: ['피운 적 없음', '이전에 피웠으나 현재 금연', '현재 흡연 중'], required: true },
            { type: 'number', label: '흡연 기간 (년)', key: 'smokingYears', placeholder: '예: 10' },
            { type: 'select', label: '하루 흡연량', key: 'smokingDaily', options: ['해당 없음', '반 갑 미만', '반 갑~1갑', '1갑~2갑', '2갑 이상'] },
            { type: 'select', label: '금연 의향', key: 'quitIntent', options: ['해당 없음', '1개월 이내 금연 계획', '6개월 이내 계획', '금연할 의향 있으나 계획 없음', '금연할 의향 없음'] },
          ]},
          { title: '음주', fields: [
            { type: 'select', label: '음주 빈도', key: 'drinkingFreq', options: ['전혀 안 마심', '월 1회 이하', '월 2~4회', '주 2~3회', '주 4회 이상'], required: true },
            { type: 'select', label: '한 번에 마시는 양 (소주 기준)', key: 'drinkingAmount', options: ['해당 없음', '1~2잔', '3~4잔', '5~6잔', '7~9잔', '10잔 이상'] },
            { type: 'select', label: '음주 조절 실패 경험', key: 'drinkingControl', options: ['해당 없음', '없음', '월 1회 미만', '월 1회', '주 1회', '거의 매일'] },
          ]},
          { title: '신체활동', fields: [
            { type: 'select', label: '격렬한 신체활동 (달리기, 등산, 빠른 수영 등)', key: 'vigorousActivity', options: ['안 함', '주 1일', '주 2일', '주 3일', '주 4일', '주 5일 이상'], required: true },
            { type: 'select', label: '중간 정도 신체활동 (빠른 걷기, 자전거 등)', key: 'moderateActivity', options: ['안 함', '주 1일', '주 2일', '주 3일', '주 4일', '주 5일 이상'] },
            { type: 'select', label: '걷기 (출퇴근, 이동 포함)', key: 'walking', options: ['거의 안 걸음', '주 1~2일', '주 3~4일', '주 5~6일', '매일'] },
            { type: 'select', label: '하루 앉아 있는 시간', key: 'sittingHours', options: ['2시간 미만', '2~4시간', '4~8시간', '8~12시간', '12시간 이상'] },
          ]},
          { title: '정신건강', fields: [
            { type: 'select', label: '평소 스트레스 정도', key: 'stress', options: ['거의 느끼지 않음', '조금 느낌', '많이 느낌', '매우 많이 느낌'], required: true },
            { type: 'select', label: '최근 2주간 우울감', key: 'depression', options: ['없음', '며칠 정도', '1주일 이상', '거의 매일'] },
            { type: 'select', label: '최근 1년간 자살 생각', key: 'suicidalIdeation', options: ['없음', '있었음'] },
            { type: 'select', label: '수면의 질', key: 'sleepQuality', options: ['좋음', '보통', '나쁨 (잠들기 어려움)', '매우 나쁨 (수면제 필요)'] },
          ]},
          { title: '여성 건강 (해당 시)', fields: [
            { type: 'select', label: '해당 여부', key: 'femaleApplicable', options: ['해당 없음 (남성)', '해당'] },
            { type: 'select', label: '생리 상태', key: 'menstruation', options: ['해당 없음', '규칙적', '불규칙', '폐경'] },
            { type: 'select', label: '임신 가능성', key: 'pregnancyPossible', options: ['해당 없음', '없음', '가능성 있음', '임신 중'] },
            { type: 'select', label: '유방 자가검진', key: 'breastExam', options: ['해당 없음', '정기적으로 함', '가끔', '안 함'] },
          ]},
          { title: '예방접종/검진 이력', fields: [
            { type: 'checkbox', label: '최근 받은 예방접종', key: 'vaccinations', options: ['독감 (올해)', '코로나19', '폐렴구균', 'B형간염', '대상포진', '자궁경부암(HPV)', '없음'] },
            { type: 'select', label: '최근 건강검진 시기', key: 'lastCheckup', options: ['1년 이내', '1~2년 전', '2~3년 전', '3년 이상', '받은 적 없음'] },
          ]},
        ],
      },
    },
    // ── 5. 내과 특화 문진표 ──
    { name: 'dept-internal-medicine', version: '1.0', locale: 'ko', category: 'QUESTIONNAIRE', estimatedMinutes: 5, description: '내과 초진 특화 문진표',
      schema: {
        title: '내과 문진표', description: '내과 진료를 위한 추가 문진입니다.',
        sections: [
          { title: '소화기 증상', fields: [
            { type: 'checkbox', label: '해당 증상 선택', key: 'giSymptoms', options: ['속쓰림/역류', '복통', '소화불량', '구역/구토', '설사', '변비', '혈변/흑색변', '체중감소', '없음'] },
          ]},
          { title: '심혈관/호흡기', fields: [
            { type: 'checkbox', label: '해당 증상 선택', key: 'cvSymptoms', options: ['흉통', '두근거림', '호흡곤란', '기침', '가래', '하지부종', '어지러움', '실신', '없음'] },
          ]},
          { title: '내분비/대사', fields: [
            { type: 'checkbox', label: '해당 증상 선택', key: 'endoSymptoms', options: ['다음(갈증)', '다뇨', '피로', '체중변화', '발한', '손떨림', '없음'] },
            { type: 'text', label: '가장 최근 혈당/혈압 수치 (알고 있다면)', key: 'recentValues', placeholder: '혈당 120, 혈압 130/85 등' },
          ]},
        ],
      },
    },
    // ── 6. 외과/정형외과 특화 문진표 ──
    { name: 'dept-surgery-ortho', version: '1.0', locale: 'ko', category: 'QUESTIONNAIRE', estimatedMinutes: 5, description: '외과/정형외과 초진 특화 문진표',
      schema: {
        title: '외과/정형외과 문진표', description: '수술/시술 관련 추가 문진입니다.',
        sections: [
          { title: '통증 평가', fields: [
            { type: 'select', label: '통증 부위', key: 'painLocation', options: ['머리/목', '어깨/팔', '손/손목', '등/허리', '골반/엉덩이', '무릎', '발/발목', '복부', '기타'], required: true },
            { type: 'select', label: '통증 정도 (0~10)', key: 'painScale', options: ['0 (없음)', '1~3 (경미)', '4~6 (중간)', '7~9 (심함)', '10 (극심)'] },
            { type: 'select', label: '통증 유형', key: 'painType', options: ['찌르는 듯', '쑤시는 듯', '화끈거림', '저림/감각이상', '둔한 통증', '박동성'] },
            { type: 'select', label: '통증 악화 요인', key: 'painAggravation', options: ['움직일 때', '가만히 있을 때', '밤에', '특정 자세', '체중 부하 시'] },
          ]},
          { title: '기능 제한', fields: [
            { type: 'checkbox', label: '어려움을 겪는 활동', key: 'functionalLimit', options: ['걷기', '계단 오르기', '앉기/서기', '물건 들기', '뻗기/돌리기', '옷 입기', '수면', '없음'] },
            { type: 'select', label: '일상생활 장애 정도', key: 'adlImpact', options: ['지장 없음', '경미한 불편', '상당한 제한', '대부분 활동 불가'] },
          ]},
          { title: '외상/수술력', fields: [
            { type: 'textarea', label: '관련 부위 외상/수술 이력', key: 'priorTrauma', placeholder: '골절, 인대 손상, 수술 등' },
            { type: 'select', label: '보조기구 사용', key: 'assistiveDevice', options: ['없음', '목발', '지팡이', '보조기/깁스', '휠체어', '기타'] },
          ]},
        ],
      },
    },
    // ── 7. 소아청소년과 특화 문진표 ──
    { name: 'dept-pediatrics', version: '1.0', locale: 'ko', category: 'QUESTIONNAIRE', estimatedMinutes: 7, description: '소아청소년과 초진 특화 문진표 (보호자 작성)',
      schema: {
        title: '소아 문진표', description: '보호자님께서 아이의 상태를 작성해주세요.',
        sections: [
          { title: '기본 정보', fields: [
            { type: 'select', label: '출생 방법', key: 'birthMethod', options: ['자연분만', '제왕절개', '모름'] },
            { type: 'select', label: '출생 시 특이사항', key: 'birthIssue', options: ['없음', '미숙아', '저체중', '황달', 'NICU 입원', '기타'] },
            { type: 'select', label: '수유 방법', key: 'feeding', options: ['모유', '분유', '혼합', '이유식/일반식'] },
          ]},
          { title: '현재 증상', fields: [
            { type: 'textarea', label: '현재 불편한 증상', key: 'chiefComplaint', placeholder: '열, 기침, 구토, 설사, 발진 등', required: true },
            { type: 'text', label: '체온 (측정했다면)', key: 'temperature', placeholder: '예: 38.5도' },
            { type: 'select', label: '식사/수유 상태', key: 'appetiteStatus', options: ['평소와 같음', '조금 줄음', '많이 줄음', '거부'] },
          ]},
          { title: '예방접종/발달', fields: [
            { type: 'select', label: '예방접종 상태', key: 'vaccinationStatus', options: ['접종 일정에 따라 완료', '일부 미접종', '접종 안 함', '모름'] },
            { type: 'select', label: '성장/발달 우려', key: 'developmentConcern', options: ['우려 없음', '또래보다 작음', '또래보다 큼', '발달 지연 우려', '행동 문제'] },
          ]},
          { title: '알레르기/기타', fields: [
            { type: 'textarea', label: '알레르기', key: 'allergies', placeholder: '약물, 음식, 환경 등' },
            { type: 'textarea', label: '형제/자매 현재 아픈 경우', key: 'siblingIllness', placeholder: '최근 감기, 수족구 등' },
          ]},
        ],
      },
    },
    // ── 8. 산부인과 특화 문진표 ──
    { name: 'dept-obgyn', version: '1.0', locale: 'ko', category: 'QUESTIONNAIRE', estimatedMinutes: 5, description: '산부인과 초진 특화 문진표',
      schema: {
        title: '산부인과 문진표', description: '산부인과 진료를 위한 추가 문진입니다.',
        sections: [
          { title: '월경력', fields: [
            { type: 'select', label: '월경 상태', key: 'menstrualStatus', options: ['규칙적', '불규칙', '무월경', '폐경'], required: true },
            { type: 'text', label: '최종 월경일 (LMP)', key: 'lmp', placeholder: '예: 2026-05-01' },
            { type: 'select', label: '월경통', key: 'dysmenorrhea', options: ['없음', '경미 (일상가능)', '보통 (진통제 필요)', '심함 (활동 제한)'] },
            { type: 'select', label: '월경량', key: 'menstrualAmount', options: ['정상', '과다', '과소'] },
          ]},
          { title: '산과력', fields: [
            { type: 'text', label: '임신 횟수 (G)', key: 'gravida', placeholder: '예: 2' },
            { type: 'text', label: '출산 횟수 (P)', key: 'para', placeholder: '예: 1' },
            { type: 'text', label: '유산/사산', key: 'abortion', placeholder: '예: 1회 (자연유산)' },
            { type: 'select', label: '현재 임신 여부', key: 'currentPregnancy', options: ['아님', '가능성 있음', '임신 중', '확인 안 됨'] },
          ]},
          { title: '부인과 이력', fields: [
            { type: 'checkbox', label: '해당 검사/시술 이력', key: 'gynHistory', options: ['자궁경부암 검사(Pap)', '유방촬영(맘모)', 'HPV 예방접종', '자궁/난소 수술', '불임 치료', '없음'] },
            { type: 'select', label: '피임 방법', key: 'contraception', options: ['사용 안 함', '경구피임약', '자궁내장치(IUD)', '콘돔', '기타', '해당 없음'] },
          ]},
        ],
      },
    },
    // ── 9. 정신건강의학과 특화 문진표 ──
    { name: 'dept-psychiatry', version: '1.0', locale: 'ko', category: 'QUESTIONNAIRE', estimatedMinutes: 7, description: '정신건강의학과 초진 특화 문진표',
      schema: {
        title: '정신건강 문진표', description: '정확한 진료를 위해 솔직하게 답변해주세요. 모든 내용은 비밀이 보장됩니다.',
        sections: [
          { title: '주요 호소', fields: [
            { type: 'textarea', label: '현재 가장 힘든 점', key: 'chiefComplaint', placeholder: '기분, 수면, 대인관계, 일상생활 등에서 어려운 점', required: true },
            { type: 'select', label: '증상 시작 시기', key: 'onset', options: ['최근 2주 이내', '1~3개월 전', '3~6개월 전', '6개월~1년 전', '1년 이상'] },
            { type: 'select', label: '이전 정신과 치료 경험', key: 'priorPsychTx', options: ['없음', '상담만', '약물 치료', '입원 치료'] },
          ]},
          { title: '기분/감정', fields: [
            { type: 'select', label: '최근 2주간 우울한 기분', key: 'depressedMood', options: ['없음', '가끔', '자주', '거의 매일'], required: true },
            { type: 'select', label: '최근 2주간 흥미/즐거움 감소', key: 'anhedonia', options: ['없음', '가끔', '자주', '거의 매일'] },
            { type: 'select', label: '불안/긴장', key: 'anxiety', options: ['없음', '가끔', '자주', '거의 매일'] },
            { type: 'select', label: '짜증/화', key: 'irritability', options: ['없음', '가끔', '자주', '거의 매일'] },
          ]},
          { title: '수면/생활', fields: [
            { type: 'select', label: '수면 문제', key: 'sleepProblem', options: ['없음', '잠들기 어려움', '자주 깸', '너무 일찍 깸', '과다 수면'] },
            { type: 'select', label: '식욕 변화', key: 'appetiteChange', options: ['변화 없음', '감소', '증가'] },
            { type: 'select', label: '에너지/피로', key: 'energy', options: ['정상', '약간 피곤', '매우 피곤', '아무것도 할 수 없음'] },
            { type: 'select', label: '집중력', key: 'concentration', options: ['정상', '약간 어려움', '상당히 어려움', '거의 불가능'] },
          ]},
          { title: '안전', fields: [
            { type: 'select', label: '자해/자살에 대한 생각', key: 'suicidalIdeation', options: ['전혀 없음', '가끔 스침', '자주 생각', '구체적 계획 있음'], required: true },
            { type: 'select', label: '자해 경험', key: 'selfHarm', options: ['없음', '과거에 있었음', '최근 있음'] },
            { type: 'select', label: '음주/약물 의존', key: 'substanceUse', options: ['없음', '가끔 과음', '의존 경향', '치료 필요'] },
          ]},
        ],
      },
    },
  ];
  for (const qs of questionnaireSchemas) {
    await prisma.formSchema.upsert({
      where: { name: qs.name },
      update: { schema: qs.schema, version: qs.version, category: qs.category ?? 'QUESTIONNAIRE', estimatedMinutes: qs.estimatedMinutes ?? null, description: qs.description ?? null },
      create: { ...qs, createdBy: adminId },
    });
  }

  // 스코어링 폼 (진료과별 평가도구)
  console.log('  [+] Scoring Forms (PHQ-9, GAD-7, MMSE, IPSS, FIM, VAS)...');
  const scoringForms = [
    { name: 'scoring-phq9', version: '1.0', locale: 'ko',
      schema: { title: 'PHQ-9 (우울증 선별)', scoring: true, maxScore: 27,
        interpretation: [{ range: '0-4', label: '정상' }, { range: '5-9', label: '경도' }, { range: '10-14', label: '중등도' }, { range: '15-19', label: '중등도-중증' }, { range: '20-27', label: '중증' }],
        fields: [
          { type: 'select', label: '1. 일에 대한 흥미나 즐거움이 거의 없다', key: 'q1', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
          { type: 'select', label: '2. 기분이 가라앉거나 우울하거나 희망이 없다', key: 'q2', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
          { type: 'select', label: '3. 잠들기 어렵거나 자주 깬다', key: 'q3', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
          { type: 'select', label: '4. 피곤하거나 기력이 없다', key: 'q4', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
          { type: 'select', label: '5. 식욕이 줄었거나 과식을 한다', key: 'q5', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
          { type: 'select', label: '6. 자신이 실패자라고 느낀다', key: 'q6', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
          { type: 'select', label: '7. 집중하기 어렵다', key: 'q7', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
          { type: 'select', label: '8. 움직이거나 말하는 것이 느려졌거나 반대로 안절부절', key: 'q8', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
          { type: 'select', label: '9. 자해/자살에 대한 생각', key: 'q9', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
        ],
      },
    },
    { name: 'scoring-gad7', version: '1.0', locale: 'ko',
      schema: { title: 'GAD-7 (불안장애 선별)', scoring: true, maxScore: 21,
        interpretation: [{ range: '0-4', label: '정상' }, { range: '5-9', label: '경도' }, { range: '10-14', label: '중등도' }, { range: '15-21', label: '중증' }],
        fields: [
          { type: 'select', label: '1. 초조하거나 불안하거나 조마조마함', key: 'q1', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
          { type: 'select', label: '2. 걱정을 멈추거나 조절할 수 없음', key: 'q2', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
          { type: 'select', label: '3. 여러가지 것들에 대해 과도하게 걱정', key: 'q3', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
          { type: 'select', label: '4. 편하게 쉬기 어려움', key: 'q4', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
          { type: 'select', label: '5. 가만히 있기 힘들 정도로 안절부절', key: 'q5', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
          { type: 'select', label: '6. 쉽게 짜증이 나거나 화가 남', key: 'q6', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
          { type: 'select', label: '7. 무서운 일이 일어날 것 같은 느낌', key: 'q7', options: [{value:0,label:'전혀 아님'},{value:1,label:'며칠'},{value:2,label:'1주일 이상'},{value:3,label:'거의 매일'}] },
        ],
      },
    },
    { name: 'scoring-mmse', version: '1.0', locale: 'ko',
      schema: { title: 'K-MMSE (간이정신상태검사)', scoring: true, maxScore: 30,
        interpretation: [{ range: '24-30', label: '정상' }, { range: '20-23', label: '경도 인지장애' }, { range: '10-19', label: '중등도 치매' }, { range: '0-9', label: '중증 치매' }],
        fields: [
          { type: 'select', label: '시간 지남력 (5점)', key: 'timeOrientation', options: [{value:0,label:'0'},{value:1,label:'1'},{value:2,label:'2'},{value:3,label:'3'},{value:4,label:'4'},{value:5,label:'5'}] },
          { type: 'select', label: '장소 지남력 (5점)', key: 'placeOrientation', options: [{value:0,label:'0'},{value:1,label:'1'},{value:2,label:'2'},{value:3,label:'3'},{value:4,label:'4'},{value:5,label:'5'}] },
          { type: 'select', label: '기억등록 (3점)', key: 'registration', options: [{value:0,label:'0'},{value:1,label:'1'},{value:2,label:'2'},{value:3,label:'3'}] },
          { type: 'select', label: '주의집중/계산 (5점)', key: 'attention', options: [{value:0,label:'0'},{value:1,label:'1'},{value:2,label:'2'},{value:3,label:'3'},{value:4,label:'4'},{value:5,label:'5'}] },
          { type: 'select', label: '기억회상 (3점)', key: 'recall', options: [{value:0,label:'0'},{value:1,label:'1'},{value:2,label:'2'},{value:3,label:'3'}] },
          { type: 'select', label: '언어/시공간 (9점)', key: 'language', options: [{value:0,label:'0'},{value:1,label:'1'},{value:2,label:'2'},{value:3,label:'3'},{value:4,label:'4'},{value:5,label:'5'},{value:6,label:'6'},{value:7,label:'7'},{value:8,label:'8'},{value:9,label:'9'}] },
        ],
      },
    },
    { name: 'scoring-ipss', version: '1.0', locale: 'ko',
      schema: { title: 'IPSS (국제전립선증상점수)', scoring: true, maxScore: 35,
        interpretation: [{ range: '0-7', label: '경증' }, { range: '8-19', label: '중등증' }, { range: '20-35', label: '중증' }],
        fields: [
          { type: 'select', label: '1. 소변 후 잔뇨감', key: 'q1', options: [{value:0,label:'없음'},{value:1,label:'5회중 1회'},{value:2,label:'5회중 2회'},{value:3,label:'약 절반'},{value:4,label:'절반 이상'},{value:5,label:'거의 항상'}] },
          { type: 'select', label: '2. 2시간 이내 재배뇨', key: 'q2', options: [{value:0,label:'없음'},{value:1,label:'5회중 1회'},{value:2,label:'5회중 2회'},{value:3,label:'약 절반'},{value:4,label:'절반 이상'},{value:5,label:'거의 항상'}] },
          { type: 'select', label: '3. 소변 중간에 끊김', key: 'q3', options: [{value:0,label:'없음'},{value:1,label:'5회중 1회'},{value:2,label:'5회중 2회'},{value:3,label:'약 절반'},{value:4,label:'절반 이상'},{value:5,label:'거의 항상'}] },
          { type: 'select', label: '4. 소변 참기 어려움', key: 'q4', options: [{value:0,label:'없음'},{value:1,label:'5회중 1회'},{value:2,label:'5회중 2회'},{value:3,label:'약 절반'},{value:4,label:'절반 이상'},{value:5,label:'거의 항상'}] },
          { type: 'select', label: '5. 소변 줄기가 약함', key: 'q5', options: [{value:0,label:'없음'},{value:1,label:'5회중 1회'},{value:2,label:'5회중 2회'},{value:3,label:'약 절반'},{value:4,label:'절반 이상'},{value:5,label:'거의 항상'}] },
          { type: 'select', label: '6. 배뇨 시작 시 힘줌', key: 'q6', options: [{value:0,label:'없음'},{value:1,label:'5회중 1회'},{value:2,label:'5회중 2회'},{value:3,label:'약 절반'},{value:4,label:'절반 이상'},{value:5,label:'거의 항상'}] },
          { type: 'select', label: '7. 야간뇨 횟수', key: 'q7', options: [{value:0,label:'0회'},{value:1,label:'1회'},{value:2,label:'2회'},{value:3,label:'3회'},{value:4,label:'4회'},{value:5,label:'5회이상'}] },
        ],
      },
    },
  ];
  for (const sf of scoringForms) {
    await prisma.formSchema.upsert({
      where: { name: sf.name },
      update: {},
      create: { ...sf, createdBy: adminId },
    });
  }

  // ============================================================
  // 13. SOAP 진료기록 예제 (Encounter + Diagnosis)
  // ============================================================
  console.log('  [13/14] SOAP Encounters...');

  const doctorKim = uid(P.USER, 2);   // 김내과
  const doctorPark = uid(P.USER, 3);  // 박내과
  const doctorLee = uid(P.USER, 4);   // 이외과
  const doctorChoi = uid(P.USER, 5);  // 최외과

  // 진단코드 조회 (시딩된 코드 참조)
  const diagLookup = async (code: string) => {
    const d = await prisma.diagnosisCode.findFirst({ where: { code, codeSystem: 'KCD-8' } });
    return d?.id;
  };

  const soapRecords = [
    // 1. 김영수 (68세 남, 고혈압+당뇨)
    { patientIdx: 1, doctorId: doctorKim, diagCodes: ['I10', 'E11'],
      s: '혈압약 복용 중인데 최근 2주간 두통이 자주 발생합니다. 아침에 특히 심하고 어지러울 때도 있습니다. 당뇨 약도 같이 먹고 있는데 혈당이 좀 높게 나옵니다.',
      o: 'BP 162/98 mmHg, HR 78 bpm, BT 36.5°C. 체중 78kg (BMI 27.3). 경부 강직 없음, 신경학적 이상소견 없음. 공복혈당 158 mg/dL, HbA1c 7.8%.',
      a: '본태성 고혈압 조절 불량, 제2형 당뇨병 조절 부적절. 고혈압성 두통 의심.',
      p: '아모디핀 10mg → 로사르탄/아모디핀 복합제로 변경. 메트포르민 500mg 1일 2회 유지, 시타글립틴 100mg 추가. 2주 후 혈압/혈당 재평가. 가정혈압 모니터링 교육.',
    },
    // 2. 이미숙 (61세 여, 위-식도역류)
    { patientIdx: 2, doctorId: doctorKim, diagCodes: ['K21'],
      s: '식사 후 속쓰림이 3개월 전부터 지속됩니다. 눕거나 구부리면 악화되고, 새벽에 신물이 넘어올 때도 있습니다. 체중감소나 연하곤란은 없습니다.',
      o: 'BP 128/82, HR 72. 복부 압통 없음, 장음 정상. 심와부 경미한 불편감 호소. 체중 58kg 안정적.',
      a: '위-식도 역류병 (GERD). 경보 징후(체중감소, 연하곤란, 출혈) 없어 경험적 치료 우선.',
      p: '오메프라졸 20mg 1일 1회 식전 8주 처방. 취침 2시간 전 식사 금지, 침상 두부 거상 교육. 8주 후 증상 재평가, 호전 없으면 상부위장관 내시경 예정.',
    },
    // 3. 박철수 (54세 남, 요통+추간판)
    { patientIdx: 3, doctorId: doctorLee, diagCodes: ['M54.5', 'M51'],
      s: '2주 전 무거운 물건 들다가 허리를 삐끗했습니다. 좌측 다리로 저린 감이 내려가고, 오래 앉아 있으면 악화됩니다. 통증 NRS 6/10.',
      o: 'L-spine ROM 제한 (전굴 40°). SLR test 좌측 40° 양성. 좌측 L5 피부분절 감각 저하. 근력 EHL 4+/5. 심부건반사 정상.',
      a: 'L4-5 추간판 탈출증 의심 (좌측 S1 신경근 침범). 요통 동반.',
      p: 'MRI L-spine 촬영 의뢰. NSAIDs (이부프로펜 400mg 1일 3회) 7일, 근이완제 처방. 물리치료 3회/주 2주간. MRI 결과에 따라 경막외 주사 또는 수술 상담.',
    },
    // 4. 최순자 (78세 여, 심부전+빈혈)
    { patientIdx: 4, doctorId: doctorKim, diagCodes: ['I50', 'D50'],
      s: '평소보다 숨이 많이 차고, 계단 한 층만 올라가도 쉬어야 합니다. 발목이 부어있고, 밤에 기침이 나서 잠을 못 잡니다. 식욕도 떨어졌습니다.',
      o: 'BP 110/70, HR 98 bpm, SpO2 93%. 경정맥 울혈 관찰. 양측 하지 부종(2+). 폐 청진 양측 하부 수포음. Hb 9.2 g/dL, BNP 850 pg/mL.',
      a: '울혈성 심부전 (NYHA Class III) 급성 악화. 철결핍성 빈혈 동반.',
      p: '입원 권유 (내과 병동). 푸로세마이드 40mg IV, 산소 2L/min 비강캐뉼라. 심초음파 예약. 철분 정맥 주사 고려. 수분 섭취 1L/일 제한, 체중 매일 측정.',
    },
    // 5. 정민호 (41세 남, 감기)
    { patientIdx: 5, doctorId: doctorPark, diagCodes: ['J00'],
      s: '3일 전부터 콧물, 재채기, 인후통 시작. 미열 있고 전신 무력감. 기침은 경미. 주변에 감기 환자 많음.',
      o: 'BP 120/78, HR 76, BT 37.4°C. 인두 발적(+), 편도 비대 없음. 비강 점막 부종. 경부 림프절 촉지 안 됨. 흉부 청진 정상.',
      a: '급성 비인두염 (감기). 세균 감염 징후 없음.',
      p: '대증 치료. 아세트아미노펜 500mg 1일 3회 3일. 충분한 수분 섭취 및 안정 권고. 3일 후에도 발열 지속 시 재방문 안내.',
    },
    // 6. 한지영 (36세 여, 불안장애)
    { patientIdx: 6, doctorId: doctorPark, diagCodes: ['F41'],
      s: '한 달 전부터 이유 없이 불안하고 가슴이 두근거립니다. 잠을 잘 못 자고, 집중이 안 됩니다. 직장 스트레스가 심해진 이후 시작. 자해/자살 사고 없음.',
      o: 'BP 118/74, HR 88. 외관상 불안해 보임. 손 떨림 경미. 갑상선 촉진 정상. TSH 2.1 (정상), Free T4 1.2 (정상). PHQ-9: 8점, GAD-7: 14점.',
      a: '범불안장애 (GAD). 갑상선 질환 배제됨. 중등도 불안.',
      p: 'SSRI (에스시탈로프람 10mg) 시작. 수면위생 교육. 2주 후 재방문하여 약물 반응 평가. 인지행동치료(CBT) 의뢰 고려.',
    },
    // 7. 오대한 (71세 남, 무릎관절증)
    { patientIdx: 7, doctorId: doctorLee, diagCodes: ['M17'],
      s: '양쪽 무릎이 아파서 걷기가 힘듭니다. 특히 계단 내려갈 때 심하고, 아침에 뻣뻣합니다. 10년 전부터 있었는데 최근 1년간 급격히 악화. 통증 NRS 7/10.',
      o: '양측 슬관절 부종(+), 굴곡/신전 시 마찰음. ROM: 우측 0-100°, 좌측 0-110°. 내반 변형 경미. X-ray: 양측 Kellgren-Lawrence Grade III.',
      a: '양측 무릎관절증 (퇴행성 관절염, KL Grade III). 보존적 치료 반응 불충분.',
      p: '트라마돌 50mg 1일 2회 + 아세트아미노펜 500mg 1일 3회. 슬관절 히알루론산 주사 시행 (우측). 좌측은 2주 뒤 시행. 체중 감량 상담, 수영/자전거 권고. 6개월 후 수술(TKR) 상담.',
    },
    // 8. 강미래 (5세 여, 급성 기관지염)
    { patientIdx: 8, doctorId: doctorPark, diagCodes: ['J20'],
      s: '(보호자) 4일 전부터 기침이 심하고 가래가 나옵니다. 처음엔 콧물만 있었는데 기침이 점점 심해졌어요. 밤에 특히 기침이 심해서 잠을 못 잡니다. 열은 없습니다.',
      o: 'BT 36.8°C, HR 100, RR 22. 흉부 청진 양측 거친 수포음, 천명음 없음. 인두 경미한 발적. SpO2 98%.',
      a: '급성 기관지염. 폐렴이나 천식 감별 필요 없음 (발열 없고 SpO2 정상).',
      p: '기침 시럽 (덱스트로메토르판) 처방. 가습기 사용 권고, 수분 섭취 장려. 발열 발생하거나 호흡곤란 시 즉시 재방문. 5일 후 경과 관찰.',
    },
    // 9. 조건우 (48세 남, 요로감염)
    { patientIdx: 9, doctorId: doctorKim, diagCodes: ['N39.0'],
      s: '2일 전부터 소변 볼 때 따끔거리고 자주 마렵습니다. 소변량은 적고, 잔뇨감이 있습니다. 혈뇨는 없습니다. 발열이나 옆구리 통증은 없습니다.',
      o: 'BP 130/84, BT 36.7°C. 복부 압통 없음, CVAT 음성. 소변검사: WBC 50-100/HPF, nitrite (+), RBC 5-10/HPF. 소변 배양 의뢰함.',
      a: '급성 방광염 (하부 요로감염). 상부 요로감염 징후 없음.',
      p: '시프로플록사신 250mg 1일 2회 3일 처방. 수분 섭취 증량. 3일 후 증상 재평가. 배양 결과에 따라 항생제 변경 고려.',
    },
    // 10. 윤서연 (31세 여, 두드러기)
    { patientIdx: 10, doctorId: doctorPark, diagCodes: ['L50'],
      s: '어제 저녁 해산물 섭취 후 전신에 두드러기가 발생했습니다. 가렵고 부어올랐습니다. 호흡곤란이나 입술 부종은 없습니다. 이전에도 새우 먹고 비슷한 적 1회 있었습니다.',
      o: 'BP 118/72, HR 76, SpO2 99%. 체간, 사지 전반에 팽진 및 발적. 혈관부종 없음. 기도 정상.',
      a: '급성 두드러기 (식품 알레르기 — 해산물 의심). 아나필락시스 징후 없음.',
      p: '세티리진 10mg 1일 1회 7일. 프레드니솔론 20mg 3일 단기 처방. 해산물(특히 갑각류) 회피 교육. 알레르기 등록 (새우/갑각류). 재발 시 에피네프린 자가주사 처방 고려.',
    },
    // 11. 서준혁 (66세 남, 협심증)
    { patientIdx: 11, doctorId: doctorKim, diagCodes: ['I20'],
      s: '일주일 전부터 빠르게 걸을 때 흉부 압박감이 있습니다. 5분 정도 쉬면 호전됩니다. 왼쪽 팔로 방사통은 없습니다. 흡연 30갑년, 고혈압 10년.',
      o: 'BP 148/92, HR 80. 심음 정상, 잡음 없음. ECG: 정상 동율동, ST 변화 없음. Troponin-I: 음성. 총콜레스테롤 248 mg/dL, LDL 162.',
      a: '안정형 협심증 의심. 고위험 인자 다수 (흡연, 고혈압, 고지혈증).',
      p: '아스피린 100mg + 아토르바스타틴 20mg 시작. 니트로글리세린 설하정 응급용 처방. 운동부하 검사 예약. 금연 상담. 2주 후 결과 상담.',
    },
    // 12. 임하늘 (8세 여, 소아 발열)
    { patientIdx: 12, doctorId: doctorPark, diagCodes: ['R50', 'B34.9'],
      s: '(보호자) 어제부터 38.5도 열이 나고 식욕이 없습니다. 목이 아프다고 하고 기침은 거의 없습니다. 학교에서 감기 유행 중입니다.',
      o: 'BT 38.3°C, HR 110, RR 20. 인두 발적(++), 편도 경미한 비대, 삼출물 없음. 경부 림프절 약간 촉지. 고막 정상.',
      a: '바이러스성 인두염 의심. 편도 삼출물 없어 연쇄상구균 감염 가능성 낮음.',
      p: '이부프로펜 시럽 (체중 기반) 1일 3회 발열 시. 수분 섭취 장려. Rapid Strep Test 시행 — 음성이면 대증 치료 지속. 3일 이상 고열 지속 시 재방문.',
    },
    // 13. 문태식 (56세 남, 만성 위염)
    { patientIdx: 13, doctorId: doctorKim, diagCodes: ['K29.5'],
      s: '식후 더부룩함과 소화불량이 6개월 이상 지속됩니다. 공복 시 속쓰림도 있습니다. 음주 주 3~4회, 흡연 20갑년.',
      o: 'BP 134/86, BT 36.6°C. 심와부 압통(+). 체중 75kg 안정적. 대변잠혈검사 음성.',
      a: '만성 위염. 생활습관(음주, 흡연)과 연관. H.pylori 감염 감별 필요.',
      p: '상부위장관 내시경 + H.pylori 검사 예약. 란소프라졸 30mg 1일 1회 4주. 금주/금연 강력 권고. 자극적 식이 제한.',
    },
    // 14. 신유리 (38세 여, 불규칙 월경)
    { patientIdx: 14, doctorId: doctorPark, diagCodes: ['N92'],
      s: '3개월 전부터 월경 주기가 불규칙합니다 (20~45일). 월경량이 많아졌고 생리통도 심해졌습니다. 임신 가능성은 없습니다.',
      o: 'BP 116/72. 복부 촉진 특이소견 없음. 골반 초음파: 자궁 크기 정상, 자궁내막 12mm. 빈혈 소견 없음 (Hb 12.8).',
      a: '과다 및 불규칙 월경. 자궁내막 비후 소견으로 자궁내막증식증 감별 필요.',
      p: '자궁내막 조직검사 고려. 호르몬 검사(FSH, LH, E2, 프로게스테론) 시행. 트라넥삼산 500mg 생리 시 복용. 1개월 후 재평가.',
    },
    // 15. 류상호 (74세 남, COPD 악화)
    { patientIdx: 15, doctorId: doctorKim, diagCodes: ['J44.1'],
      s: '평소 COPD로 흡입제 사용 중인데, 3일 전부터 기침과 가래가 심해지고 호흡곤란이 악화되었습니다. 가래 색깔이 누렇게 변했습니다.',
      o: 'BP 140/88, HR 96, RR 24, SpO2 89% (room air). 흉부 청진 양측 천명음(+), 호기 연장. 보조근 사용 관찰. CRP 4.2.',
      a: 'COPD 급성 악화 (감염성). SpO2 저하로 중등도 이상.',
      p: '산소 2L/min 비강캐뉼라. 살부타몰+이프라트로피움 네뷸라이저 1일 4회. 프레드니솔론 40mg 5일. 아목시실린/클라불란산 625mg 1일 3회 7일. 흉부 X-ray 촬영. 입원 고려.',
    },
    // 16. 배은지 (33세 여, 요로결석)
    { patientIdx: 16, doctorId: doctorLee, diagCodes: ['N20'],
      s: '오늘 새벽 갑자기 우측 옆구리에 극심한 통증이 시작되었습니다. 구역감이 있고 혈뇨가 나옵니다. 통증이 아래쪽으로 방사됩니다. NRS 9/10.',
      o: 'BP 150/94 (통증 관련), HR 102, BT 36.8°C. 우측 CVAT 강양성. 소변검사 RBC 다수, WBC 정상. CT: 우측 요관 하부 5mm 결석 확인.',
      a: '우측 요관결석 (5mm). 자연 배출 가능 크기.',
      p: '케토롤락 30mg IM 투여 (응급 통증 조절). 탐스로신 0.4mg 1일 1회 (배출 촉진). 수분 섭취 2L/일 이상. 1주 후 CT 추적. 배출 안 되면 체외충격파쇄석술(ESWL) 고려.',
    },
    // 17. 홍길동 (51세 남, 고지혈증+비만)
    { patientIdx: 17, doctorId: doctorKim, diagCodes: ['E78', 'E66'],
      s: '건강검진에서 콜레스테롤이 높다고 해서 왔습니다. 특별한 증상은 없습니다. 운동을 안 하고 외식이 잦습니다. 가족력: 부친 심근경색.',
      o: 'BP 128/82, HR 72. BMI 31.2 (신장 172cm, 체중 92kg). 허리둘레 98cm. TC 268, LDL 178, HDL 38, TG 260. 공복혈당 108.',
      a: '혼합형 고지혈증 + 비만 (BMI 31.2). 심혈관 고위험 (가족력 양성, HDL 저하).',
      p: '아토르바스타틴 20mg 시작. 식이 상담 (저지방, 지중해식). 주 3회 30분 이상 유산소 운동. 3개월 후 지질 재검. 체중 감량 목표 5kg/6개월.',
    },
    // 18. 안소희 (43세 여, 갑상선기능저하증)
    { patientIdx: 18, doctorId: doctorPark, diagCodes: ['E03'],
      s: '최근 몇 달간 피로감이 심하고 체중이 5kg 늘었습니다. 추위를 많이 타고 변비가 생겼습니다. 피부도 건조해졌습니다.',
      o: 'BP 108/68, HR 58. 갑상선 촉진 정상 크기, 결절 없음. 피부 건조. DTR 이완기 지연. TSH 18.5 (↑↑), Free T4 0.6 (↓).',
      a: '갑상선기능저하증 (원발성). 하시모토 갑상선염 가능성.',
      p: '레보티록신 50mcg 1일 1회 공복 시작. 6주 후 TSH 재검. 항TPO 항체 검사 추가. 용량 조절은 TSH 정상화까지 6주 간격.',
    },
    // 19. 송민석 (80세 남, 뇌경색 후 관리)
    { patientIdx: 19, doctorId: doctorKim, diagCodes: ['I63', 'I10'],
      s: '6개월 전 뇌경색으로 입원 후 재활 중입니다. 좌측 상하지 위약감이 남아있고, 말이 약간 어눌합니다. 혈압약은 꾸준히 복용 중.',
      o: 'BP 136/80, HR 68. 좌측 상지 근력 3+/5, 하지 4/5. 구음장애 경미. Barthel Index 65점. MRI: 우측 MCA 영역 만성 경색.',
      a: '뇌경색 후유증 (우측 MCA 영역). 좌측 편마비. 고혈압 조절 양호.',
      p: '아스피린 100mg + 클로피도그렐 75mg 이중항혈소판 유지. 아모디핀 5mg + 로사르탄 50mg 유지. 재활의학과 외래 물리/작업치료 주 3회. 3개월 후 MRA 추적.',
    },
    // 20. 양수진 (27세 여, 피부염)
    { patientIdx: 20, doctorId: doctorPark, diagCodes: ['L30.9'],
      s: '2주 전부터 양쪽 팔 안쪽에 가려운 발진이 생겼습니다. 긁으면 진물이 나옵니다. 새 세탁세제로 바꾼 후 시작된 것 같습니다.',
      o: 'BP 112/70. 양측 전완부 내측에 홍반성 구진, 수포, 삼출. 건조한 피부 기저. 다른 부위 정상.',
      a: '접촉성 피부염 (세탁세제 의심). 아토피 피부염 감별.',
      p: '모메타손 크림 0.1% 1일 2회 환부 도포 2주. 세티리진 10mg 취침 전. 원인 세제 사용 중단. 보습제 수시 도포. 2주 후 호전 없으면 패치 테스트.',
    },
    // 21. 권도윤 (7세 남, 중이염)
    { patientIdx: 21, doctorId: doctorPark, diagCodes: ['H66'],
      s: '(보호자) 3일 전부터 오른쪽 귀가 아프다고 합니다. 열이 38도까지 올라갔고, 잠을 잘 못 잡니다. 콧물은 1주 전부터.',
      o: 'BT 37.8°C, HR 100. 우측 고막 발적(++), 팽윤, 빛반사 소실. 좌측 고막 정상. 경부 림프절 경미한 비대.',
      a: '급성 화농성 중이염 (우측). 상기도감염 후 속발.',
      p: '아목시실린 시럽 40mg/kg/일 분3 7일. 이부프로펜 시럽 통증/발열 시. 3일 후 재평가 — 호전 없으면 아목시실린/클라불란산으로 변경.',
    },
    // 22. 황정은 (58세 여, 제2형 당뇨+고혈압)
    { patientIdx: 22, doctorId: doctorKim, diagCodes: ['E11', 'I10'],
      s: '당뇨와 고혈압으로 약 복용 중입니다. 최근 손발 저림이 생겼고, 시야가 가끔 흐릿합니다. 발에 상처가 잘 안 낫습니다.',
      o: 'BP 142/88, HR 76. 공복혈당 186, HbA1c 8.9%. 양발 진동각 감소, 모노필라멘트 검사 비정상. 안저검사: 미세동맥류 몇 개 관찰.',
      a: '제2형 당뇨병 조절 불량 + 당뇨병성 말초신경병증 + 비증식성 당뇨망막병증 초기. 고혈압.',
      p: '메트포르민 1000mg 유지 + 글리메피리드 2mg 추가. 발 관리 교육 (매일 점검, 양말 착용). 안과 추적 3개월 후. 신경병 평가 EMG/NCV 의뢰. 혈압약 ARB로 변경 (신장보호).',
    },
    // 23. 전성진 (46세 남, 회전근개)
    { patientIdx: 23, doctorId: doctorLee, diagCodes: ['M75.1'],
      s: '한 달 전 야구를 하다가 우측 어깨를 다쳤습니다. 팔을 위로 올리기 힘들고, 밤에 누우면 통증이 심합니다. NRS 5/10.',
      o: '우측 견관절 외전 능동적 120° (통증 arc 60-120°). Neer test (+), Hawkins test (+), Empty can test (+). 근력 외회전 4/5.',
      a: '우측 회전근개 증후군 (극상근건 부분 파열 의심).',
      p: '어깨 MRI 촬영. NSAIDs (나프록센 500mg 1일 2회) 2주. 어깨 스트레칭/강화 운동 교육. MRI 결과에 따라 초음파 유도 스테로이드 주사 또는 관절경 수술 결정.',
    },
    // 24. 노미영 (69세 여, 골다공증+요통)
    { patientIdx: 24, doctorId: doctorLee, diagCodes: ['M54.5'],
      s: '허리가 만성적으로 아프고, 최근 키가 줄어든 것 같습니다. 넘어진 적은 없지만 허리를 구부리면 통증이 심합니다.',
      o: 'BP 130/78. 흉요추 후만 증가. L-spine X-ray: L1 압박골절 의심 소견. DEXA: L-spine T-score -3.1, 대퇴골 -2.5.',
      a: '골다공증성 척추 압박골절 의심 (L1). 골다공증.',
      p: '졸레드론산 5mg 연 1회 IV 투여 일정 잡기. 칼슘 1000mg + 비타민D 800IU 매일. 통증 관리 아세트아미노펜 + 경피 진통 패치. MRI L-spine 확인. 낙상 예방 교육.',
    },
    // 25. 구현우 (35세 남, 수면장애+스트레스)
    { patientIdx: 25, doctorId: doctorPark, diagCodes: ['F51'],
      s: '6개월째 잠들기 어렵고, 자도 개운하지 않습니다. 직장 야근이 잦고 스트레스가 많습니다. 수면제는 아직 안 먹어봤습니다.',
      o: 'BP 124/78, HR 68. 외관 피곤해 보임. 신체검사 특이소견 없음. ESS(Epworth Sleepiness Scale) 14점. PHQ-9 7점 (경도).',
      a: '비기질성 불면증. 수면위생 불량 + 직업적 스트레스. 수면무호흡 감별 필요.',
      p: '수면위생 교육 (규칙적 수면시간, 카페인 제한, 전자기기 사용 제한). 수면일지 작성 지시. 4주 후 재평가 — 호전 없으면 수면다원검사 고려. 당장 수면제 미처방.',
    },
    // 26. 유다은 (6세 여, 급성 세기관지염)
    { patientIdx: 26, doctorId: doctorPark, diagCodes: ['J21'],
      s: '(보호자) 5일 전 콧물 시작 후 기침이 점점 심해지고 쌕쌕 소리가 납니다. 밥을 잘 안 먹고 처져 있습니다. 열은 37.5도.',
      o: 'BT 37.6°C, HR 120, RR 28, SpO2 95%. 흉부 청진 양측 천명음(+), 호기 연장. 늑간 함몰 경미. RSV 신속검사 양성.',
      a: 'RSV 급성 세기관지염. 경도 호흡곤란.',
      p: '경과관찰 (외래). 비강 식염수 세척, 가습. SpO2 모니터링 교육. 수분/영양 섭취 유지. 호흡곤란 악화(SpO2 < 92%, 수유 불량) 시 응급실 방문 지시. 2일 후 재진.',
    },
    // 27. 남기철 (63세 남, 심방세동)
    { patientIdx: 27, doctorId: doctorKim, diagCodes: ['I48'],
      s: '가슴이 불규칙하게 뛰는 느낌이 2주 전부터 간헐적으로 있습니다. 가끔 어지러움도 동반됩니다. 고혈압 약 복용 중.',
      o: 'BP 138/84, HR 92 (불규칙). ECG: 심방세동 (HR 88-110, f wave). 심초음파: LA 42mm (경미한 확장), EF 58%. CHA₂DS₂-VASc 3점.',
      a: '발작성 심방세동. CHA₂DS₂-VASc 3점으로 항응고 적응.',
      p: '아픽사반 5mg 1일 2회 시작 (NOAC). 비소프롤롤 2.5mg 심박수 조절. 갑상선 기능 검사. 24시간 Holter 모니터링 예약. 심방세동 관련 뇌졸중 위험 교육.',
    },
    // 28. 하윤아 (29세 여, 철결핍성 빈혈)
    { patientIdx: 28, doctorId: doctorPark, diagCodes: ['D50'],
      s: '최근 어지러움이 자주 있고, 숨이 차고 피로합니다. 월경량이 많은 편이고 7일 이상 지속됩니다. 식이는 채식 위주.',
      o: 'BP 104/64, HR 90. 결막 창백. 설염(+). Hb 8.4 g/dL, MCV 72, Ferritin 8 ng/mL, TIBC 420. 대변잠혈 음성.',
      a: '철결핍성 빈혈 (Hb 8.4). 원인: 월경과다 + 식이 부족.',
      p: '철분제 (황산 제일철 325mg) 1일 2회 식간, 비타민C 500mg 동시복용. 산부인과 의뢰 (월경과다 평가). 4주 후 Hb/Ferritin 재검. 철분 풍부 식이 교육 (적색육, 시금치).',
    },
    // 29. 장우진 (52세 남, 위궤양)
    { patientIdx: 29, doctorId: doctorKim, diagCodes: ['K25'],
      s: '2주 전부터 공복 시 심한 상복부 통증이 있습니다. 식사하면 좀 나아집니다. 검은 변은 없지만 구역감이 있습니다. NSAIDs 자주 복용 (허리 통증으로).',
      o: 'BP 126/80, BT 36.5°C. 심와부 압통(++). 대변잠혈검사 음성. 상부위장관 내시경: 위각부 1.5cm 궤양, H.pylori CLO test 양성.',
      a: '위궤양 (H.pylori 양성). NSAIDs 사용 관련.',
      p: 'H.pylori 제균 3제요법 (아목시실린 1g + 클래리스로마이신 500mg + 란소프라졸 30mg) 1일 2회 14일. NSAIDs 중단 → 아세트아미노펜 대체. 8주 후 내시경 추적 (궤양 치유 확인).',
    },
    // 30. 탁예린 (40세 여, 자궁근종)
    { patientIdx: 30, doctorId: doctorChoi, diagCodes: ['D25', 'D50'],
      s: '생리량이 매우 많아지고 빈혈 증상(어지럼, 피로)이 있습니다. 아랫배가 묵직하고 빈뇨가 있습니다. 2년 전 자궁근종 진단 받았습니다.',
      o: 'BP 110/68, HR 84. 하복부 촉진 상 자궁 비대 (12주 크기). 골반 초음파: 자궁 전벽 8cm + 후벽 5cm 근종. Hb 9.8 g/dL.',
      a: '다발성 자궁 평활근종 (8cm, 5cm). 근종 관련 월경과다 및 철결핍성 빈혈.',
      p: '철분제 보충 (Hb 회복 우선). GnRH agonist 3개월 선행 투여 (근종 축소 + 빈혈 교정). 이후 복강경 자궁근종절제술 계획. 수술 전 심장/폐 평가. 다음 외래 1개월 후.',
    },
  ];

  // ── 진료과별 테스트 의사 SOAP 기록 (테스트 계정 → 기존 환자) ──
  const testDoctorSoaps = [
    // 소화기내과 (test i=20) → 환자2 이미숙
    { patientIdx: 2, doctorId: uid(P.USER, 20), encIdx: 101, diagCodes: ['K25'],
      s: '2주 전 건강검진 위내시경에서 위궤양 발견되어 의뢰됨. 공복 시 심와부 통증. NSAIDs 복용력(+). H.pylori 양성.',
      o: 'BP 128/82. 심와부 압통(+). 내시경: 위각부 1.2cm 활동성 궤양 (Forrest IIc), H.pylori CLO (+). Hb 13.2.',
      a: '위궤양 (H.pylori 양성, NSAIDs 관련). Forrest IIc — 재출혈 위험 낮음.',
      p: 'H.pylori 제균 3제요법 14일 (PPI + 아목시실린 + 클래리스로마이신). NSAIDs 중단. 8주 후 추적 내시경 + CLO 재검.',
    },
    // 내분비내과 (test i=21) → 환자22 황정은
    { patientIdx: 22, doctorId: uid(P.USER, 21), encIdx: 102, diagCodes: ['E11', 'E03'],
      s: '당뇨 재진. HbA1c 목표 미달성. 최근 추위를 많이 타고 체중 3kg 증가. 변비 동반.',
      o: 'BP 138/84, HR 62. BMI 28.5. 피부 건조, DTR 이완 지연. HbA1c 8.2%, TSH 12.8 (↑), Free T4 0.8 (↓).',
      a: '제2형 당뇨병 조절 부적절 + 갑상선기능저하증 신규 진단.',
      p: '당뇨: 시타글립틴 100mg 추가. 갑상선: 레보티록신 50mcg 시작. 6주 후 TSH/HbA1c 재검. 갑상선 초음파 예약.',
    },
    // 신장내과 (test i=22) → 환자19 송민석
    { patientIdx: 19, doctorId: uid(P.USER, 22), encIdx: 103, diagCodes: ['N39.0'],
      s: '만성신장병 추적관찰. 최근 소변량 감소, 하지 부종 악화. 식욕 저하.',
      o: 'BP 158/96, HR 80. 양측 하지 부종 2+. BUN 48, Cr 3.8 (eGFR 15), K 5.4. 소변검사 단백 2+.',
      a: 'CKD Stage 4 (eGFR 15). 고칼륨혈증. 투석 준비 시기.',
      p: '칼슘폴리스티렌 15g 1일 3회 (고칼륨). 푸로세마이드 40mg 증량. 저단백/저칼륨 식이. 투석 접근로(AVF) 외과 의뢰. 1주 후 재진.',
    },
    // 신경외과 (test i=26) → 환자11 서준혁
    { patientIdx: 11, doctorId: uid(P.USER, 26), encIdx: 104, diagCodes: ['S06'],
      s: '교통사고 후 두통, 구토 1회. 의식 소실 약 30초. 현재 의식 명료하나 두통 지속. 경추 통증(+).',
      o: 'GCS 15 (E4V5M6). 동공 양측 3mm 대광반사 정상. 사지 운동/감각 정상. C-spine CT: 이상 없음. Brain CT: 좌측 측두부 경막외 출혈 의심.',
      a: '경도 두부외상. 좌측 경막외혈종 의심 — Brain MRI 필요.',
      p: 'Brain MRI 긴급 촬영. 신경학적 관찰 (1시간 간격 GCS 체크). 금식 유지 (수술 가능성). 신경외과 입원.',
    },
    // 정신건강의학과 (test i=28) → 환자6 한지영
    { patientIdx: 6, doctorId: uid(P.USER, 28), encIdx: 105, diagCodes: ['F32', 'F41'],
      s: '불안장애로 SSRI 복용 중. 최근 2주간 기분이 급격히 가라앉고, 아무것도 하기 싫다고 함. 수면 4시간 미만. 식욕 저하로 3kg 감소. 자해사고 부인.',
      o: '[MSE] 외관: 나이보다 늙어 보임, 위생 저하. 행동: 위축, 눈맞춤 회피. 기분: "살고 싶지 않다" (수동적 사고). 정동: 둔마. 사고과정: 사고지연. 사고내용: 무가치감, 죄책감. 지각: 환청/환시 없음. 인지: 지남력 정상. 통찰: 부분적. PHQ-9: 19점(중등도-중증). GAD-7: 16점(중증). C-SSRS: 수동적 사고만.',
      a: '주요우울 에피소드 (중등도-중증) + 범불안장애. 자살위험 중등도 — 면밀한 추적 필요.',
      p: 'SSRI 증량 (에스시탈로프람 10→20mg). 미르타자핀 15mg 취침 전 추가 (수면+식욕). 주 1회 외래 추적. 자살예방 안전계획 수립. CBT 의뢰. 악화 시 입원 고려.',
    },
    // 안과 (test i=29) → 환자24 노미영
    { patientIdx: 24, doctorId: uid(P.USER, 29), encIdx: 106, diagCodes: ['H10'],
      s: '3일 전부터 양안 충혈, 이물감, 눈곱이 끈적끈적. 가족 중 동일 증상 있음. 시력 저하 느낌은 없음.',
      o: '시력 우 0.9/좌 1.0 (교정). IOP 우 14/좌 15 mmHg. 세극등: 양안 결막 충혈(++), 여포 형성(+), 유두비대 없음. 각막 투명. 전방 정상.',
      a: '바이러스성 결막염 (유행성). 아데노바이러스 의심.',
      p: '인공눈물 1일 6회. 냉찜질. 감염 예방 교육 (수건 분리, 손씻기). 항생제 점안액은 세균감염 징후 없어 보류. 1주 후 재진.',
    },
    // 이비인후과 (test i=30) → 환자21 권도윤
    { patientIdx: 21, doctorId: uid(P.USER, 30), encIdx: 107, diagCodes: ['H66'],
      s: '(보호자) 반복성 중이염으로 의뢰됨. 최근 6개월간 3회 중이염. 현재 좌측 귀 통증, 청력 저하 호소.',
      o: 'BT 37.2°C. 좌측 고막: 삼출액 관찰, 빛반사 소실. 우측 정상. 순음청력: 좌측 전도성 난청 30dB. 임피던스: 좌 Type B (삼출).',
      a: '좌측 삼출성 중이염 (반복성). 전도성 난청 동반.',
      p: '항생제 경구 10일. 3개월 경과관찰 후에도 삼출 지속 시 환기관 삽입술(T-tube) 고려. 아데노이드 비대 감별 위해 측면 경부 X-ray.',
    },
    // 피부과 (test i=31) → 환자20 양수진
    { patientIdx: 20, doctorId: uid(P.USER, 31), encIdx: 108, diagCodes: ['L30.9'],
      s: '2주 전 접촉피부염으로 타과 치료 후 호전되었으나, 양측 팔오금, 슬와부에 새 병변 발생. 소양감 심함. 소아 시절 아토피 병력.',
      o: '양측 전주와, 슬와부에 홍반성 판, 태선화(+), 삼출 약간. 피부건조(xerosis). 손가락 끝 균열. SCORAD: 42점 (중등도).',
      a: '아토피 피부염 재발 (중등도). 접촉피부염 후 악화.',
      p: '타크로리무스 연고 0.1% 1일 2회 병변부. 세라마이드 보습제 수시 도포. 세티리진 10mg 취침. 급성기 후 유지요법으로 전환. 2주 후 SCORAD 재평가.',
    },
    // 비뇨의학과 (test i=32) → 환자27 남기철
    { patientIdx: 27, doctorId: uid(P.USER, 32), encIdx: 109, diagCodes: ['N39.0'],
      s: '빈뇨, 야간뇨(3회), 약뇨 6개월 지속. 잔뇨감 심해 일상생활 불편. 전립선 가족력 양성(부친).',
      o: 'DRE: 전립선 비대(Grade II), 경도, 결절 없음. PSA 2.8. IPSS 22점(중증). Qmax 8.2 mL/s (저하). 잔뇨량 85mL. 초음파: 전립선 48cc.',
      a: '전립선 비대증 (IPSS 중증, Qmax 저하). PSA 정상 범위.',
      p: '탐스로신 0.4mg + 피나스테리드 5mg 시작 (병합요법). 3개월 후 IPSS/Qmax 재평가. PSA 추적. 약물 반응 불충분 시 TURP 또는 홀렙 수술 상담.',
    },
    // 재활의학과 (test i=33) → 환자19 송민석 (뇌경색후 재활)
    { patientIdx: 19, doctorId: uid(P.USER, 33), encIdx: 110, diagCodes: ['I63'],
      s: '뇌경색 후 좌측 편마비로 재활의학과 추적. 보행 시 좌측 다리 끌림. 좌측 손 미세 동작 어려움 지속.',
      o: 'ROM: 좌 견관절 굴곡 120°, 외전 100°. MMT: 좌상지 3+/5, 좌하지 4/5. Berg Balance 38/56. FIM 78/126. 독립보행 가능하나 좌측 불안정.',
      a: '뇌경색 후 좌측 편마비 — 기능 호전 중 (FIM 78, 이전 65). 보행 및 상지 기능 지속 개선 필요.',
      p: 'PT 주 3회 (보행훈련, 균형훈련), OT 주 3회 (상지 미세운동, ADL 훈련). FES (기능적 전기자극) 좌 손목 신전근. 3개월 후 FIM 재평가. 목표: FIM 90+, 독립보행.',
    },
    // 가정의학과 (test i=34) → 환자17 홍길동
    { patientIdx: 17, doctorId: uid(P.USER, 34), encIdx: 111, diagCodes: ['E78', 'E66'],
      s: '건강검진 이상 소견으로 내원. 고지혈증, 비만 지적받음. 특별한 증상 없음. 흡연 15갑년, 음주 주 3회(소주 1병), 운동 안 함.',
      o: 'BP 132/86, HR 74. BMI 31.2, 허리둘레 98cm. TC 268, LDL 178, HDL 38, TG 260. FBS 108. 간기능 AST/ALT 48/62 (경도 상승). 지방간 초음파 소견.',
      a: '대사증후군 (비만+고지혈증+고혈당+복부비만). 비알코올지방간 의심. 심혈관 고위험.',
      p: '금연 상담 + 니코틴 패치 처방. 주 5회 30분 유산소 운동 처방. 지중해식 식이 교육. 아토르바스타틴 20mg 시작. 3개월 후 지질/간기능 재검. 금주 강력 권고.',
    },
    // 마취통증의학과 (test i=35) → 환자3 박철수 (수술 전 평가)
    { patientIdx: 3, doctorId: uid(P.USER, 35), encIdx: 112, diagCodes: ['M51'],
      s: '요추 추간판 탈출증으로 미세현미경 디스크 절제술 예정. 고혈압 약 복용 중. 이전 마취 경험 1회 (충수절제, 전신마취, 합병증 없음).',
      o: 'ASA II. Mallampati Class II. 개구도 4cm, 갑상설골거리 6cm, 경추 ROM 정상. 기도 평가 양호. Labs: Hb 14.2, PLT 215k, PT/aPTT 정상. ECG 정상 동율동. 흉부 X-ray 정상.',
      a: 'ASA II (조절된 고혈압). 기도 관리 어려움 예상 없음. 전신마취 적합.',
      p: '수술 당일 고혈압약(ARB) 복용 후 내원. 금식 8시간. 전신마취 계획 (프로포폴 유도 + 세보플루란 유지). 수술 후 PCA (펜타닐) 준비. 항응고제 없음 확인.',
    },
    // 영상의학과 (test i=36) → 환자4 최순자 (흉부 CT 판독)
    { patientIdx: 4, doctorId: uid(P.USER, 36), encIdx: 113, diagCodes: ['J18.9'],
      s: '(판독 의뢰) 심부전 악화 의심 환자. 발열 동반. 폐렴 감별 위해 흉부 CT 촬영.',
      o: '[CT 판독] 양측 하엽 consolidation with air bronchogram — 폐렴에 합당. 양측 흉수 소량. 심비대(CTR >0.6). 종격동 림프절 비대 없음. 폐동맥 색전 소견 없음.',
      a: '양측 하엽 폐렴. 양측 소량 흉수 (심부전 관련 가능). 심비대.',
      p: '임상과 상관 권고. 항생제 치료 후 2주 뒤 추적 흉부 X-ray 권고. 흉수 증가 시 흉부 초음파 유도 천자 고려.',
    },
    // 병리과 (test i=37) → 환자29 장우진 (위궤양 조직검사)
    { patientIdx: 29, doctorId: uid(P.USER, 37), encIdx: 114, diagCodes: ['K25'],
      s: '(병리 의뢰) 위각부 궤양 조직생검 2점. H.pylori 감별 및 악성 여부 확인.',
      o: '[병리 판독] Specimen: 위각부 biopsy x2. Gross: 연조직 2조각 (0.3x0.2cm). Micro: 만성 활동성 위염, 장상피화생(+), H.pylori 양성(Giemsa 염색). 이형성 없음. 악성 소견 없음.',
      a: 'H.pylori 양성 만성 활동성 위염 + 장상피화생. 악성(-). 이형성(-).',
      p: 'H.pylori 제균 치료 후 추적 내시경 권고. 장상피화생 있어 1-2년 간격 내시경 감시 권고.',
    },
  ];

  // 테스트 의사 SOAP 생성
  for (const rec of testDoctorSoaps) {
    const patientId = uid(P.PATIENT, rec.patientIdx);
    const encounterId = makeUuid('e0c10000', rec.encIdx);
    await prisma.encounter.upsert({
      where: { id: encounterId },
      update: {},
      create: {
        id: encounterId, patientId, doctorId: rec.doctorId,
        subjective: rec.s, objective: rec.o, assessment: rec.a, plan: rec.p,
        status: 'SIGNED', signedAt: new Date(),
      },
    });
    for (const code of rec.diagCodes) {
      const diagId = await diagLookup(code);
      if (diagId) {
        const edId = makeUuid('ed100000', rec.encIdx * 100 + rec.diagCodes.indexOf(code));
        await prisma.encounterDiagnosis.upsert({
          where: { id: edId }, update: {},
          create: { id: edId, encounterId, diagnosisCodeId: diagId, type: rec.diagCodes.indexOf(code) === 0 ? 'PRIMARY' : 'SECONDARY' },
        });
      }
    }
  }
  console.log(`     → ${testDoctorSoaps.length} specialty SOAP encounters seeded`);

  for (const rec of soapRecords) {
    const patientId = uid(P.PATIENT, rec.patientIdx);
    const encounterId = makeUuid('e0c00000', rec.patientIdx);

    // Encounter 생성
    await prisma.encounter.upsert({
      where: { id: encounterId },
      update: {},
      create: {
        id: encounterId,
        patientId,
        doctorId: rec.doctorId,
        subjective: rec.s,
        objective: rec.o,
        assessment: rec.a,
        plan: rec.p,
        status: 'SIGNED',
        signedAt: new Date(),
      },
    });

    // 진단 연결
    for (const code of rec.diagCodes) {
      const diagId = await diagLookup(code);
      if (diagId) {
        const edId = makeUuid('ed000000', rec.patientIdx * 100 + rec.diagCodes.indexOf(code));
        await prisma.encounterDiagnosis.upsert({
          where: { id: edId },
          update: {},
          create: {
            id: edId,
            encounterId,
            diagnosisCodeId: diagId,
            type: rec.diagCodes.indexOf(code) === 0 ? 'PRIMARY' : 'SECONDARY',
          },
        });
      }
    }
  }
  console.log(`     → ${soapRecords.length} SOAP encounters seeded`);

  // ── 검사결과 시딩 (Lab Results) ──
  console.log('  [+] Seeding lab results...');
  const labTechId = uid(P.USER, 15); // 문검사

  const labTests = [
    // 환자1 김영수 (고혈압+당뇨)
    { patientIdx: 1, encIdx: 1, code: 'E6541', tests: [
      { testName: 'WBC', value: '7200', unit: '/μL', min: 4000, max: 10000 },
      { testName: 'Hb', value: '14.2', unit: 'g/dL', min: 13, max: 17 },
      { testName: 'PLT', value: '225000', unit: '/μL', min: 150000, max: 400000 },
      { testName: '공복혈당 (FBS)', value: '158', unit: 'mg/dL', min: 70, max: 100 },
      { testName: 'HbA1c', value: '7.8', unit: '%', min: 4, max: 6.5 },
      { testName: 'BUN', value: '18', unit: 'mg/dL', min: 7, max: 20 },
      { testName: 'Creatinine', value: '1.0', unit: 'mg/dL', min: 0.7, max: 1.3 },
      { testName: 'AST', value: '28', unit: 'IU/L', min: 0, max: 40 },
      { testName: 'ALT', value: '32', unit: 'IU/L', min: 0, max: 41 },
      { testName: 'Total Cholesterol', value: '248', unit: 'mg/dL', min: 0, max: 200 },
      { testName: 'LDL', value: '162', unit: 'mg/dL', min: 0, max: 130 },
      { testName: 'HDL', value: '42', unit: 'mg/dL', min: 40, max: 60 },
      { testName: 'TG', value: '210', unit: 'mg/dL', min: 0, max: 150 },
      { testName: 'Na', value: '140', unit: 'mEq/L', min: 136, max: 146 },
      { testName: 'K', value: '4.2', unit: 'mEq/L', min: 3.5, max: 5.1 },
    ]},
    // 환자4 최순자 (심부전+빈혈)
    { patientIdx: 4, encIdx: 4, code: 'E6541', tests: [
      { testName: 'WBC', value: '11200', unit: '/μL', min: 4000, max: 10000 },
      { testName: 'Hb', value: '9.2', unit: 'g/dL', min: 12, max: 16 },
      { testName: 'Hct', value: '28', unit: '%', min: 36, max: 48 },
      { testName: 'PLT', value: '198000', unit: '/μL', min: 150000, max: 400000 },
      { testName: 'BNP', value: '850', unit: 'pg/mL', min: 0, max: 100 },
      { testName: 'Ferritin', value: '12', unit: 'ng/mL', min: 20, max: 200 },
      { testName: 'TIBC', value: '420', unit: 'μg/dL', min: 250, max: 370 },
      { testName: 'BUN', value: '32', unit: 'mg/dL', min: 7, max: 20 },
      { testName: 'Creatinine', value: '1.8', unit: 'mg/dL', min: 0.6, max: 1.1 },
      { testName: 'Na', value: '134', unit: 'mEq/L', min: 136, max: 146 },
      { testName: 'K', value: '5.0', unit: 'mEq/L', min: 3.5, max: 5.1 },
      { testName: 'CRP', value: '2.8', unit: 'mg/dL', min: 0, max: 0.5 },
    ]},
    // 환자9 조건우 (요로감염)
    { patientIdx: 9, encIdx: 9, code: 'E6601', tests: [
      { testName: 'WBC', value: '12800', unit: '/μL', min: 4000, max: 10000 },
      { testName: 'Hb', value: '15.0', unit: 'g/dL', min: 13, max: 17 },
      { testName: 'CRP', value: '4.5', unit: 'mg/dL', min: 0, max: 0.5 },
      { testName: 'BUN', value: '22', unit: 'mg/dL', min: 7, max: 20 },
      { testName: 'Creatinine', value: '1.1', unit: 'mg/dL', min: 0.7, max: 1.3 },
      { testName: 'UA WBC', value: '50-100', unit: '/HPF', min: 0, max: 5 },
      { testName: 'UA Nitrite', value: 'Positive', unit: '', min: undefined, max: undefined },
      { testName: 'UA RBC', value: '5-10', unit: '/HPF', min: 0, max: 3 },
    ]},
    // 환자11 서준혁 (협심증)
    { patientIdx: 11, encIdx: 11, code: 'E6581', tests: [
      { testName: 'Troponin-I', value: '0.02', unit: 'ng/mL', min: 0, max: 0.04 },
      { testName: 'CK-MB', value: '3.2', unit: 'ng/mL', min: 0, max: 5 },
      { testName: 'Total Cholesterol', value: '248', unit: 'mg/dL', min: 0, max: 200 },
      { testName: 'LDL', value: '162', unit: 'mg/dL', min: 0, max: 130 },
      { testName: 'HDL', value: '38', unit: 'mg/dL', min: 40, max: 60 },
      { testName: 'TG', value: '180', unit: 'mg/dL', min: 0, max: 150 },
      { testName: 'Hb', value: '14.8', unit: 'g/dL', min: 13, max: 17 },
      { testName: 'PT/INR', value: '1.0', unit: '', min: 0.8, max: 1.2 },
    ]},
    // 환자17 홍길동 (고지혈증+비만)
    { patientIdx: 17, encIdx: 17, code: 'E6581', tests: [
      { testName: 'Total Cholesterol', value: '268', unit: 'mg/dL', min: 0, max: 200 },
      { testName: 'LDL', value: '178', unit: 'mg/dL', min: 0, max: 130 },
      { testName: 'HDL', value: '38', unit: 'mg/dL', min: 40, max: 60 },
      { testName: 'TG', value: '260', unit: 'mg/dL', min: 0, max: 150 },
      { testName: '공복혈당 (FBS)', value: '108', unit: 'mg/dL', min: 70, max: 100 },
      { testName: 'HbA1c', value: '6.1', unit: '%', min: 4, max: 6.5 },
      { testName: 'AST', value: '48', unit: 'IU/L', min: 0, max: 40 },
      { testName: 'ALT', value: '62', unit: 'IU/L', min: 0, max: 41 },
      { testName: 'GGT', value: '85', unit: 'IU/L', min: 0, max: 60 },
      { testName: 'Uric Acid', value: '8.2', unit: 'mg/dL', min: 3.5, max: 7.2 },
    ]},
    // 환자19 송민석 (뇌경색후, CKD)
    { patientIdx: 19, encIdx: 19, code: 'E6551', tests: [
      { testName: 'BUN', value: '48', unit: 'mg/dL', min: 7, max: 20 },
      { testName: 'Creatinine', value: '3.8', unit: 'mg/dL', min: 0.7, max: 1.3 },
      { testName: 'eGFR', value: '15', unit: 'mL/min', min: 60, max: 120 },
      { testName: 'K', value: '5.4', unit: 'mEq/L', min: 3.5, max: 5.1 },
      { testName: 'Ca', value: '8.2', unit: 'mg/dL', min: 8.6, max: 10.2 },
      { testName: 'Phosphorus', value: '5.8', unit: 'mg/dL', min: 2.5, max: 4.5 },
      { testName: 'Albumin', value: '3.0', unit: 'g/dL', min: 3.5, max: 5.2 },
      { testName: 'Hb', value: '10.2', unit: 'g/dL', min: 13, max: 17 },
      { testName: 'PT/INR', value: '1.1', unit: '', min: 0.8, max: 1.2 },
    ]},
    // 환자22 황정은 (당뇨+갑상선)
    { patientIdx: 22, encIdx: 22, code: 'E6591', tests: [
      { testName: '공복혈당 (FBS)', value: '186', unit: 'mg/dL', min: 70, max: 100 },
      { testName: 'HbA1c', value: '8.9', unit: '%', min: 4, max: 6.5 },
      { testName: 'TSH', value: '12.8', unit: 'mIU/L', min: 0.4, max: 4.0 },
      { testName: 'Free T4', value: '0.8', unit: 'ng/dL', min: 0.9, max: 1.7 },
      { testName: 'Anti-TPO Ab', value: '350', unit: 'IU/mL', min: 0, max: 34 },
      { testName: 'Creatinine', value: '1.2', unit: 'mg/dL', min: 0.6, max: 1.1 },
      { testName: 'Microalbumin (urine)', value: '85', unit: 'mg/L', min: 0, max: 30 },
    ]},
    // 환자28 하윤아 (철결핍성 빈혈)
    { patientIdx: 28, encIdx: 28, code: 'E6541', tests: [
      { testName: 'WBC', value: '6800', unit: '/μL', min: 4000, max: 10000 },
      { testName: 'Hb', value: '8.4', unit: 'g/dL', min: 12, max: 16 },
      { testName: 'Hct', value: '26', unit: '%', min: 36, max: 48 },
      { testName: 'MCV', value: '72', unit: 'fL', min: 80, max: 100 },
      { testName: 'MCH', value: '24', unit: 'pg', min: 27, max: 33 },
      { testName: 'Ferritin', value: '8', unit: 'ng/mL', min: 20, max: 200 },
      { testName: 'Iron', value: '25', unit: 'μg/dL', min: 60, max: 170 },
      { testName: 'TIBC', value: '420', unit: 'μg/dL', min: 250, max: 370 },
      { testName: 'Reticulocyte', value: '0.8', unit: '%', min: 0.5, max: 2.5 },
    ]},
  ];

  /**
   * 🔴 검사 오더에 **수가 코드를 붙인다**(2026-09-21 · 형제 프로젝트 인바운드 R20 실호출).
   *    FHIR `ServiceRequest` 검색은 `prescription.procedureCodeId != null` 인 오더만 내보낸다
   *    (`fhir.controller.ts` ~1085). 종전 시드의 검사 오더 12건은 코드가 없어 **한 건도 노출되지 않았고**,
   *    새 설치본에서 LIS 연동을 시험하려면 오더를 손으로 새로 내야 했다.
   *    코드는 **이 시드가 이미 넣은 수가 마스터에서 고른다** — 패널의 선도 검사에 맞춘 것이고, 새 코드를 지어내지 않는다.
   */
  const labFeeCodes = [...new Set([...labTests.map((l) => l.code)])];
  const labFeeRows = await prisma.procedureCode.findMany({
    where: { code: { in: labFeeCodes } }, orderBy: { validFrom: 'desc' }, select: { id: true, code: true },
  });
  const labFeeId = new Map<string, string>();
  for (const r of labFeeRows) if (!labFeeId.has(r.code)) labFeeId.set(r.code, r.id);
  const labFeeMissing = labFeeCodes.filter((c) => !labFeeId.has(c));
  if (labFeeMissing.length) console.warn(`     ⚠️ 검사 오더 시드: 수가 마스터에 없는 코드 ${labFeeMissing.join(', ')} — 그 오더는 FHIR ServiceRequest 에 안 보인다`);

  for (const lab of labTests) {
    const patientId = uid(P.PATIENT, lab.patientIdx);
    const encounterId = makeUuid('e0c00000', lab.encIdx);
    const orderId = makeUuid('0de00000', lab.patientIdx);
    const labResultId = makeUuid('1ab00000', lab.patientIdx);

    // Prescription (LAB type)
    const rxId = makeUuid('4ab00000', lab.patientIdx);
    const procedureCodeId = labFeeId.get(lab.code) ?? null;
    await prisma.prescription.upsert({
      where: { id: rxId },
      update: {},
      create: { id: rxId, encounterId, type: 'LAB', status: 'ACTIVE', createdBy: doctorKim, procedureCodeId },
    });
    // 🔴 옛 데모 DB 회수 — **비어 있을 때만** 채운다(사람이 지정한 코드를 덮지 않는다)
    if (procedureCodeId) {
      await prisma.prescription.updateMany({ where: { id: rxId, procedureCodeId: null }, data: { procedureCodeId } });
    }

    // Order (LAB department, COMPLETED)
    await prisma.order.upsert({
      where: { id: orderId },
      update: {},
      create: { id: orderId, prescriptionId: rxId, department: 'LAB', status: 'COMPLETED', completedAt: new Date() },
    });

    // LabResult
    await prisma.labResult.upsert({
      where: { orderId },
      update: {},
      create: { id: labResultId, orderId, patientId, technicianId: labTechId, status: 'COMPLETED', collectedAt: new Date(), completedAt: new Date() },
    });

    // LabResultItems
    for (let i = 0; i < lab.tests.length; i++) {
      const t = lab.tests[i];
      const itemId = makeUuid('1ab10000', lab.patientIdx * 100 + i);
      const flag = labFlagOf(t.value, t.min, t.max);
      await prisma.labResultItem.upsert({
        where: { id: itemId },
        update: {},
        create: { id: itemId, labResultId, testName: t.testName, value: t.value, unit: t.unit, normalMin: t.min, normalMax: t.max, flag },
      });
    }
  }
  console.log(`     → ${labTests.length} lab results seeded (${labTests.reduce((s, l) => s + l.tests.length, 0)} items)`);

  // ── 알레르기 시딩 ──
  console.log('  [+] Seeding allergies...');
  const allergyData = [
    { pIdx: 1, type: 'DRUG', allergen: '페니실린', code: 'penicillin', reaction: '두드러기, 발진', severity: 'SEVERE', reportedBy: '환자 본인' },
    { pIdx: 1, type: 'FOOD', allergen: '땅콩', code: null, reaction: '인후부종', severity: 'LIFE_THREATENING', reportedBy: '환자 본인' },
    { pIdx: 4, type: 'DRUG', allergen: '아스피린', code: 'aspirin', reaction: '천식 악화', severity: 'SEVERE', reportedBy: '의사 기록' },
    { pIdx: 6, type: 'DRUG', allergen: '설파제', code: 'sulfa', reaction: '피부 발진', severity: 'MODERATE', reportedBy: '본인' },
    { pIdx: 10, type: 'FOOD', allergen: '새우/갑각류', code: null, reaction: '두드러기, 호흡곤란', severity: 'SEVERE', reportedBy: '환자 본인' },
    { pIdx: 17, type: 'DRUG', allergen: '이부프로펜', code: 'ibuprofen', reaction: '위장 출혈', severity: 'MODERATE', reportedBy: '의사 기록' },
    { pIdx: 22, type: 'DRUG', allergen: '메트포르민', code: 'metformin', reaction: '설사, 구역', severity: 'MILD', reportedBy: '환자 본인' },
    { pIdx: 28, type: 'FOOD', allergen: '우유/유제품', code: null, reaction: '복통, 설사', severity: 'MILD', reportedBy: '환자 본인' },
    // 응급실 환자 알레르기 보강
    { pIdx: 9, type: 'DRUG', allergen: '모르핀', code: 'morphine', reaction: '오심, 구토, 호흡억제', severity: 'SEVERE', reportedBy: '환자 본인' },
    { pIdx: 12, type: 'DRUG', allergen: '세프트리악손', code: 'ceftriaxone', reaction: '발진', severity: 'MODERATE', reportedBy: '보호자' },
    { pIdx: 23, type: 'DRUG', allergen: '조영제(요오드)', code: 'iodine-contrast', reaction: '두드러기, 혈압저하', severity: 'SEVERE', reportedBy: '이전 입원 기록' },
    { pIdx: 16, type: 'FOOD', allergen: '밀가루(글루텐)', code: null, reaction: '복부팽만, 설사', severity: 'MILD', reportedBy: '환자 본인' },
    { pIdx: 29, type: 'DRUG', allergen: 'NSAIDs', code: 'nsaids', reaction: '위장장애', severity: 'MILD', reportedBy: '환자 본인' },
  ];
  for (const a of allergyData) {
    const aId = makeUuid('a11e0000', a.pIdx * 10 + allergyData.indexOf(a));
    await prisma.allergy.upsert({ where: { id: aId }, update: {},
      create: { id: aId, patientId: uid(P.PATIENT, a.pIdx), type: a.type as any, allergen: a.allergen, allergenCode: a.code, reaction: a.reaction, severity: a.severity as any, verificationStatus: 'CONFIRMED', reportedBy: a.reportedBy, recordedBy: adminId, isActive: true },
    });
  }
  console.log(`     → ${allergyData.length} allergies seeded`);

  // ── 문제목록 시딩 ──
  console.log('  [+] Seeding problem lists...');
  const problemData = [
    { pIdx: 1, diagCode: 'I10', desc: '본태성 고혈압', status: 'CHRONIC', severity: 'MODERATE', onset: '2015-03-01' },
    { pIdx: 1, diagCode: 'E11', desc: '제2형 당뇨병', status: 'CHRONIC', severity: 'MODERATE', onset: '2018-06-15' },
    { pIdx: 4, diagCode: 'I50', desc: '울혈성 심부전', status: 'ACTIVE', severity: 'SEVERE', onset: '2024-01-10' },
    { pIdx: 4, diagCode: 'D50', desc: '철결핍성 빈혈', status: 'ACTIVE', severity: 'MODERATE', onset: '2025-08-01' },
    { pIdx: 7, diagCode: 'M17', desc: '양측 무릎 퇴행성 관절염', status: 'CHRONIC', severity: 'SEVERE', onset: '2016-01-01' },
    { pIdx: 11, diagCode: 'I20', desc: '안정형 협심증', status: 'ACTIVE', severity: 'MODERATE', onset: '2026-04-28' },
    { pIdx: 11, diagCode: 'I10', desc: '고혈압', status: 'CHRONIC', severity: 'MODERATE', onset: '2016-01-01' },
    { pIdx: 17, diagCode: 'E78', desc: '혼합형 고지혈증', status: 'ACTIVE', severity: 'MODERATE', onset: '2026-05-01' },
    { pIdx: 17, diagCode: 'E66', desc: '비만 (BMI 31.2)', status: 'CHRONIC', severity: 'MODERATE', onset: '2020-01-01' },
    { pIdx: 19, diagCode: 'I63', desc: '뇌경색 후유증', status: 'CHRONIC', severity: 'SEVERE', onset: '2025-11-01' },
    { pIdx: 22, diagCode: 'E11', desc: '제2형 당뇨병 (조절 불량)', status: 'CHRONIC', severity: 'SEVERE', onset: '2018-01-01' },
    { pIdx: 22, diagCode: 'I10', desc: '고혈압', status: 'CHRONIC', severity: 'MODERATE', onset: '2017-06-01' },
    { pIdx: 28, diagCode: 'D50', desc: '철결핍성 빈혈 (월경과다)', status: 'ACTIVE', severity: 'MODERATE', onset: '2026-03-01' },
    { pIdx: 30, diagCode: 'D25', desc: '다발성 자궁근종', status: 'ACTIVE', severity: 'MODERATE', onset: '2024-05-01' },
    // 응급실 환자 문제목록 보강
    { pIdx: 9, diagCode: 'I20', desc: '협심증 (2년전 PCI 시행)', status: 'CHRONIC', severity: 'SEVERE', onset: '2024-03-01' },
    { pIdx: 9, diagCode: 'I10', desc: '고혈압', status: 'CHRONIC', severity: 'MODERATE', onset: '2020-01-01' },
    { pIdx: 9, diagCode: 'E78', desc: '고지혈증', status: 'CHRONIC', severity: 'MILD', onset: '2020-01-01' },
    { pIdx: 23, diagCode: 'S72', desc: '교통사고 — 다발성 늑골 골절 의심', status: 'ACTIVE', severity: 'SEVERE', onset: '2026-05-14' },
    { pIdx: 6, diagCode: 'J45', desc: '천식 (간헐적)', status: 'CHRONIC', severity: 'MILD', onset: '2024-06-01' },
    { pIdx: 20, diagCode: 'E11', desc: '제2형 당뇨병 (인슐린 치료 중)', status: 'CHRONIC', severity: 'SEVERE', onset: '2019-01-01' },
    { pIdx: 20, diagCode: 'I10', desc: '고혈압', status: 'CHRONIC', severity: 'MODERATE', onset: '2020-06-01' },
    { pIdx: 16, diagCode: 'I10', desc: '고혈압 (약물 복용 중)', status: 'CHRONIC', severity: 'MODERATE', onset: '2022-01-01' },
    { pIdx: 15, diagCode: 'E11', desc: '제2형 당뇨병', status: 'CHRONIC', severity: 'MODERATE', onset: '2021-01-01' },
    { pIdx: 15, diagCode: 'K80', desc: '담석증 (수술력 없음)', status: 'ACTIVE', severity: 'MODERATE', onset: '2025-12-01' },
    { pIdx: 12, diagCode: 'R50', desc: '반복성 열성 경련 기왕력', status: 'RESOLVED', severity: 'MODERATE', onset: '2024-01-01' },
    { pIdx: 25, diagCode: 'M54.5', desc: '만성 요통', status: 'CHRONIC', severity: 'MILD', onset: '2023-06-01' },
  ];
  for (let i = 0; i < problemData.length; i++) {
    const pl = problemData[i];
    const plId = makeUuid('d1a90000', i + 1);
    const diagId = await diagLookup(pl.diagCode);
    if (!diagId) continue;
    await prisma.problemList.upsert({ where: { id: plId }, update: {},
      create: { id: plId, patientId: uid(P.PATIENT, pl.pIdx), diagnosisCodeId: diagId, description: pl.desc, status: pl.status as any, severity: pl.severity as any, onsetDate: new Date(pl.onset), addedBy: doctorKim },
    });
  }
  console.log(`     → ${problemData.length} problem list entries seeded`);

  // ── 동의서 시딩 (상세 내용 포함) ──
  console.log('  [+] Seeding consent forms...');
  const consentContents: Record<string, object> = {
    SURGERY: {
      title: '수술 동의서',
      환자성명: '{{patient.name}}', 등록번호: '{{patient.mrn}}',
      수술명: '복강경 담낭절제술 (Laparoscopic Cholecystectomy)',
      수술예정일: '2026-05-28', 집도의: '이외과',
      수술의_필요성_및_목적: '담석증으로 인한 반복적 복통 및 담낭염 예방을 위해 담낭 절제가 필요합니다.',
      예상_합병증_및_부작용: '출혈, 감염, 담도 손상, 장기 손상 등이 드물게 발생할 수 있습니다. 복강경에서 개복 전환이 필요할 수 있습니다.',
      대안적_치료_방법: '약물 치료(담석 용해제)가 있으나 재발률이 높아 수술적 치료가 권장됩니다.',
      마취방법: '전신마취',
      수혈_가능성: true,
      환자확인: { 충분한_설명: true, 질문_기회: true, 거부_불이익_없음: true, 자발적_동의: true },
      동의일: '2026-05-28',
    },
    ANESTHESIA: {
      title: '마취 동의서',
      환자성명: '{{patient.name}}', 등록번호: '{{patient.mrn}}',
      마취방법: '전신마취 (General Anesthesia)',
      마취_위험_요인: '고혈압 약물 복용 중 (Amlodipine 5mg), 과거 마취 부작용 없음, 알레르기: NKDA',
      예상_부작용: '오심/구토, 인후통, 두통 등이 발생할 수 있습니다. 극히 드물지만 치아 손상, 신경 손상, 알레르기 반응, 악성 고열증, 심정지 등 심각한 합병증이 발생할 수 있습니다.',
      금식안내: { 음식물_금지: '수술 8시간 전부터', 맑은물_금지: '수술 2시간 전부터', 기타: '껌, 사탕 포함 일체 금지' },
      환자확인: { 설명_이해: true, 금식_준수: true, 마취_동의: true },
      동의일: '2026-05-28',
    },
    TRANSFUSION: {
      title: '수혈 동의서',
      환자성명: '{{patient.name}}', 등록번호: '{{patient.mrn}}',
      혈액형: 'A+',
      수혈_목적: '수술 중 예상 출혈량 500mL 이상으로 빈혈 교정 및 조직 산소 공급 유지 목적',
      혈액제제: ['농축적혈구(pRBC) 2단위'],
      수혈_부작용: '급성: 발열, 오한, 두드러기, 아나필락시스, 급성 용혈반응. 지연: 지연성 용혈반응, 감염(극히 드묾). 거부 시 빈혈 악화, 조직 산소 공급 부족 위험.',
      환자확인: { 설명_확인: true, 수혈_동의: true },
      동의일: '2026-05-28',
    },
  };
  const consentData = [
    { pIdx: 3, type: 'SURGERY', templateName: '수술 동의서', consentType: 'SURGERY' },
    { pIdx: 3, type: 'ANESTHESIA', templateName: '마취 동의서', consentType: 'ANESTHESIA' },
    { pIdx: 4, type: 'TRANSFUSION', templateName: '수혈 동의서', consentType: 'TRANSFUSION' },
    { pIdx: 7, type: 'SURGERY', templateName: '수술 동의서', consentType: 'SURGERY' },
    { pIdx: 30, type: 'SURGERY', templateName: '수술 동의서', consentType: 'SURGERY' },
    { pIdx: 30, type: 'ANESTHESIA', templateName: '마취 동의서', consentType: 'ANESTHESIA' },
  ];
  for (let i = 0; i < consentData.length; i++) {
    const c = consentData[i];
    const cId = makeUuid('c0e50000', i + 1);
    await prisma.consentForm.upsert({ where: { id: cId }, update: { content: consentContents[c.type] ?? { type: c.type } },
      create: { id: cId, patientId: uid(P.PATIENT, c.pIdx), type: c.type, templateName: c.templateName, content: consentContents[c.type] ?? { type: c.type }, signedBy: '환자 본인', signedAt: new Date(), isValid: true, consentType: c.consentType as any, status: 'SIGNED' },
    });
  }
  console.log(`     → ${consentData.length} consent forms seeded (상세 내용 포함)`);

  // ── 간호기록 시딩 (입원환자 기준) ──
  console.log('  [+] Seeding nursing records...');
  const nurseId = uid(P.USER, 10); // 조간호

  // 입원 ID 조회
  const admissions = await prisma.admission.findMany({ where: { status: 'ADMITTED' }, select: { id: true, patientId: true }, take: 3 });

  for (const adm of admissions) {
    const naId = makeUuid('1a050000', admissions.indexOf(adm) + 1);
    // 간호초기평가
    await prisma.nursingAssessment.upsert({ where: { id: naId }, update: {},
      create: { id: naId, admissionId: adm.id, nurseId, consciousness: 'Alert', mobility: '독립보행', painScore: 3, painLocation: '허리', nutritionStatus: '양호', skinIntegrity: '정상', bradenScore: 20, allergyConfirmed: true, assessedAt: new Date() },
    });

    // 간호일지 2건
    for (let j = 0; j < 2; j++) {
      const nnId = makeUuid('11050000', admissions.indexOf(adm) * 10 + j);
      await prisma.nursingNote.upsert({ where: { id: nnId }, update: {},
        create: { id: nnId, admissionId: adm.id, nurseId, noteType: 'DAR', focus: j === 0 ? '통증 관리' : '활력징후 변화',
          data: j === 0 ? 'NRS 5/10, 허리 통증 호소. 진통제 투여 1시간 전.' : 'BP 148/92 → 132/84. 체온 37.8°C → 37.2°C.',
          action: j === 0 ? '아세트아미노펜 500mg PO 투여. 체위 변경 + 냉찜질 적용.' : '해열제 투여 후 30분 모니터링. 수분 섭취 권장.',
          response: j === 0 ? '투여 30분 후 NRS 3/10으로 감소. 수면 가능.' : '체온 37.2°C로 하강. 전신 상태 호전.',
          shiftType: j === 0 ? 'DAY' : 'EVENING', recordedAt: new Date() },
      });
    }

    // I/O 기록 4건
    const ioEntries = [
      { type: 'intake', iType: 'IV', amt: 500, detail: 'NS 500mL', oType: null, oAmt: null, oDetail: null },
      { type: 'intake', iType: 'ORAL', amt: 200, detail: '물 200mL', oType: null, oAmt: null, oDetail: null },
      { type: 'output', iType: null, amt: null, detail: null, oType: 'URINE', oAmt: 350, oDetail: '맑은 소변' },
      { type: 'output', iType: null, amt: null, detail: null, oType: 'DRAIN', oAmt: 50, oDetail: 'JP drain' },
    ];
    for (let k = 0; k < ioEntries.length; k++) {
      const ioId = makeUuid('10050000', admissions.indexOf(adm) * 100 + k);
      const e = ioEntries[k];
      await prisma.intakeOutput.upsert({ where: { id: ioId }, update: {},
        create: { id: ioId, admissionId: adm.id, nurseId, recordedAt: new Date(),
          intakeType: e.iType as any, intakeAmount: e.amt, intakeDetail: e.detail,
          outputType: e.oType as any, outputAmount: e.oAmt, outputDetail: e.oDetail },
      });
    }
  }
  const admCount = admissions.length;
  console.log(`     → ${admCount} nursing assessments, ${admCount * 2} notes, ${admCount * 4} I/O records seeded`);

  // ── 퇴원요약 시딩 (퇴원 환자) ──
  console.log('  [+] Seeding discharge summaries...');
  /**
   * 🔴 **`take: 2` 라 나머지 퇴원 환자는 요약이 없는 채로 남았다** (2026-08-30 운영 실측).
   *    `inpatient.dischargeGate` 는 7/24 부터 켜져 있고 **API 퇴원은 전부 요약이 있다** —
   *    게이트 이후 요약 없는 퇴원 9건이 **전부 시드**였다.
   *    즉 게이트가 샌 게 아니라 **시드가 게이트를 우회**한다(31회차와 같은 패턴).
   *    퇴원요약은 법정 기록이라, 시연 데이터라도 **퇴원했으면 요약이 있어야** 화면·지표가 사실을 말한다.
   *    → 요약이 아직 없는 퇴원 건은 **전부** 만든다(이미 있으면 upsert 가 건너뛴다).
   */
  const discharged = await prisma.admission.findMany({
    // 🔴 `dischargeSummary` 는 **텍스트 컬럼**이고 관계는 `dischargeSummaryDoc` 이다(스키마 실측)
    where: { status: 'DISCHARGED', dischargeSummaryDoc: { is: null } },
    select: { id: true, patientId: true, admitDate: true, dischargeDate: true, admitReason: true },
  });
  for (const [dsIdx, d] of discharged.entries()) {
    // 🔴 `indexOf` 는 목록이 커지면 O(n²)이고, 같은 행이 두 번 있으면 **같은 id 를 두 번 만든다**
    const dsId = makeUuid('d5c00000', dsIdx + 1);
    await prisma.dischargeSummary.upsert({ where: { admissionId: d.id }, update: {},
      create: { id: dsId, admissionId: d.id, doctorId: doctorKim, admitDate: d.admitDate, dischargeDate: d.dischargeDate ?? new Date(),
        admitDiagnosis: d.admitReason ?? '상세불명', dischargeDiagnosis: '호전 퇴원',
        diagnosisCodes: [{ code: 'I10', name: '고혈압' }],
        hospitalCourse: '입원 기간 중 약물 조절 및 생활습관 교육 시행. 혈압 조절 양호하여 퇴원.',
        conditionAtDischarge: '양호', dischargeMedications: [{ name: '아모디핀 5mg', dosage: '1일 1회' }],
        followUpPlan: '2주 후 외래 재진. 가정혈압 모니터링.', status: 'SIGNED', signedAt: new Date(), signedBy: doctorKim },
    });
  }
  console.log(`     → ${discharged.length} discharge summaries seeded`);

  // ── 영상결과 추가 시딩 ──
  console.log('  [+] Seeding imaging results...');
  const imgOrders = await prisma.order.findMany({ where: { department: 'IMAGING', status: 'COMPLETED' }, select: { id: true, prescription: { select: { encounter: { select: { patientId: true } } } } }, take: 3 });
  for (const img of imgOrders) {
    const existing = await prisma.imagingResult.findUnique({ where: { orderId: img.id } });
    if (existing) continue;
    const irId = makeUuid('11a90000', imgOrders.indexOf(img) + 10);
    await prisma.imagingResult.upsert({ where: { orderId: img.id }, update: {},
      create: { id: irId, orderId: img.id, patientId: img.prescription.encounter?.patientId ?? '', modality: 'CR',
        bodyPart: '흉부', finding: '심비대 소견. 폐야 깨끗. 횡격막 정상.', impression: '심비대. 활동성 폐질환 없음.',
        status: 'REPORTED', acquiredAt: new Date(), reportedAt: new Date() },
    });
  }
  console.log(`     → ${imgOrders.length} imaging results seeded`);

  // ── 약속처방(CP) 시딩 ──
  console.log('  [+] Seeding order sets (CP)...');
  const orderSets = [
    // ── 내과 ──
    { code: 'CP-IM-001', name: '고혈압 초진 기본 처방', dept: '내과', cat: 'DISEASE', dx: 'I10', desc: '고혈압 초진 환자 표준 처방 (약물+검사+심전도+흉부X-ray)',
      items: [
        { type: 'MEDICATION', name: '아모디핀 5mg', dosage: '5mg', frequency: '1일 1회', duration: 30, route: 'PO', instructions: '아침 식후' },
        { type: 'LAB', name: 'CBC (전혈구검사)' },
        { type: 'LAB', name: 'BMP (기본대사패널)', instructions: '공복' },
        { type: 'LAB', name: '지질검사 (TC/LDL/HDL/TG)', instructions: '공복 12시간' },
        { type: 'LAB', name: 'HbA1c', instructions: '당뇨 선별' },
        { type: 'LAB', name: 'ECG (심전도)' },
        { type: 'IMAGING', name: '흉부 X-ray (PA)' },
      ]},
    { code: 'CP-IM-002', name: '고혈압 재진 처방', dept: '내과', cat: 'DISEASE', dx: 'I10', desc: '고혈압 재진 약물 리필 + 추적 검사',
      items: [
        { type: 'MEDICATION', name: '아모디핀 5mg', dosage: '5mg', frequency: '1일 1회', duration: 30, route: 'PO' },
        { type: 'LAB', name: 'BMP (기본대사패널)' },
      ]},
    { code: 'CP-IM-003', name: '당뇨 초진 기본 처방', dept: '내과', cat: 'DISEASE', dx: 'E11', desc: '제2형 당뇨 초진 표준 (약물+혈당+신기능+지질+미세알부민)',
      items: [
        { type: 'MEDICATION', name: '메트포르민 500mg', dosage: '500mg', frequency: '1일 2회', duration: 30, route: 'PO', instructions: '식후' },
        { type: 'LAB', name: 'HbA1c' },
        { type: 'LAB', name: '공복혈당 (FBS)', instructions: '공복' },
        { type: 'LAB', name: '지질검사', instructions: '공복' },
        { type: 'LAB', name: 'BUN/Creatinine' },
        { type: 'LAB', name: 'Microalbumin (소변)' },
        { type: 'LAB', name: '소변검사' },
        { type: 'LAB', name: '안저검사 의뢰', instructions: '안과 협진' },
      ]},
    { code: 'CP-IM-004', name: '당뇨 재진 처방', dept: '내과', cat: 'DISEASE', dx: 'E11', desc: '당뇨 재진 약물 리필 + HbA1c 추적',
      items: [
        { type: 'MEDICATION', name: '메트포르민 500mg', dosage: '500mg', frequency: '1일 2회', duration: 30, route: 'PO' },
        { type: 'LAB', name: 'HbA1c' },
        { type: 'LAB', name: '공복혈당 (FBS)', instructions: '공복' },
      ]},
    { code: 'CP-IM-005', name: '감기/급성 상기도감염 처방', dept: '내과', cat: 'DISEASE', dx: 'J00', desc: '급성 상기도감염 대증 치료 (해열/항히스타민/진해)',
      items: [
        { type: 'MEDICATION', name: '아세트아미노펜 500mg', dosage: '500mg', frequency: '1일 3회', duration: 3, route: 'PO', instructions: '발열/통증 시' },
        { type: 'MEDICATION', name: '클로르페니라민 4mg', dosage: '4mg', frequency: '1일 3회', duration: 3, route: 'PO', instructions: '콧물/재채기' },
        { type: 'MEDICATION', name: '덱스트로메토르판 15mg', dosage: '15mg', frequency: '1일 3회', duration: 3, route: 'PO', instructions: '기침 시' },
      ]},
    { code: 'CP-IM-006', name: '요로감염 처방', dept: '내과', cat: 'DISEASE', dx: 'N39.0', desc: '단순 요로감염 항생제 + 검사',
      items: [
        { type: 'MEDICATION', name: '시프로플록사신 250mg', dosage: '250mg', frequency: '1일 2회', duration: 3, route: 'PO' },
        { type: 'LAB', name: '소변검사' },
        { type: 'LAB', name: '소변배양' },
      ]},
    { code: 'CP-IM-007', name: '폐렴 입원 처방', dept: '내과', cat: 'DISEASE', dx: 'J18.9', desc: '지역사회획득 폐렴 입원 표준 (항생제+검사+산소)',
      items: [
        { type: 'MEDICATION', name: '세프트리악손 2g', dosage: '2g', frequency: '1일 1회', duration: 7, route: 'IV', instructions: '30분 이상 점적' },
        { type: 'MEDICATION', name: '아지트로마이신 500mg', dosage: '500mg', frequency: '1일 1회', duration: 3, route: 'PO' },
        { type: 'LAB', name: 'CBC, CRP, PCT (프로칼시토닌)' },
        { type: 'LAB', name: '혈액배양 2세트', instructions: '항생제 투여 전' },
        { type: 'LAB', name: '객담 그람염색/배양' },
        { type: 'LAB', name: 'ABG (동맥혈가스)', instructions: 'SpO2 < 94% 시' },
        { type: 'IMAGING', name: '흉부 X-ray (PA/Lat)' },
        { type: 'ORDER', name: '산소 2-4L 비강캐뉼라', instructions: 'SpO2 ≥ 94% 유지' },
      ]},
    { code: 'CP-IM-008', name: '심부전 악화 입원 처방', dept: '내과', cat: 'DISEASE', dx: 'I50', desc: '급성 비대상성 심부전 입원 표준',
      items: [
        { type: 'MEDICATION', name: '푸로세미드 20mg', dosage: '20mg', frequency: '1일 2회', duration: 5, route: 'IV', instructions: '이뇨제' },
        { type: 'MEDICATION', name: 'ACE억제제/ARB', dosage: '기존 용량', frequency: '1일 1회', duration: 30, route: 'PO' },
        { type: 'LAB', name: 'BNP/NT-proBNP' },
        { type: 'LAB', name: 'BMP (전해질 포함)', instructions: '이뇨제 모니터링' },
        { type: 'LAB', name: 'CBC, LFT' },
        { type: 'IMAGING', name: '흉부 X-ray' },
        { type: 'LAB', name: '심초음파(TTE) 의뢰', instructions: '순환기내과' },
        { type: 'ORDER', name: '체중 매일 측정', instructions: '기상 후 배뇨 직후' },
        { type: 'ORDER', name: 'I/O 기록', instructions: '매 근무조' },
        { type: 'ORDER', name: '수분 제한 1.5L/day' },
        { type: 'ORDER', name: '저염식 (Na < 2g/day)' },
      ]},
    { code: 'CP-IM-009', name: '급성 위장염 처방', dept: '내과', cat: 'DISEASE', dx: 'A09', desc: '급성 감염성 위장염 대증 치료',
      items: [
        { type: 'MEDICATION', name: '로페라미드 2mg', dosage: '2mg', frequency: '필요 시', duration: 3, route: 'PO', instructions: '설사 시 PRN (1일 최대 8mg)' },
        { type: 'MEDICATION', name: '온단세트론 4mg', dosage: '4mg', frequency: '필요 시', duration: 2, route: 'PO', instructions: '구토 시 PRN' },
        { type: 'ORDER', name: 'NS 1L IV', instructions: '탈수 교정' },
        { type: 'LAB', name: 'BMP (전해질)' },
        { type: 'LAB', name: '대변 배양', instructions: '혈변/고열 시' },
      ]},
    { code: 'CP-IM-010', name: '고지혈증 초진 처방', dept: '내과', cat: 'DISEASE', dx: 'E78', desc: '고지혈증 초진 약물 + 기본 검사',
      items: [
        { type: 'MEDICATION', name: '아토르바스타틴 20mg', dosage: '20mg', frequency: '1일 1회', duration: 30, route: 'PO', instructions: '저녁 식후' },
        { type: 'LAB', name: '지질검사 (TC/LDL/HDL/TG)', instructions: '공복 12시간' },
        { type: 'LAB', name: 'AST/ALT (간기능)', instructions: '스타틴 모니터링' },
        { type: 'LAB', name: 'CK (크레아틴키나제)', instructions: '근육통 시' },
      ]},

    // ── 외과 ──
    { code: 'CP-SG-001', name: '수술 전 기본검사', dept: null, cat: 'SURGERY_PRE', dx: null, desc: '모든 수술 전 필수 검사 (전신마취/부위마취)',
      items: [
        { type: 'LAB', name: 'CBC (전혈구검사)' },
        { type: 'LAB', name: 'BMP (전해질, BUN/Cr)' },
        { type: 'LAB', name: 'PT/aPTT (응고검사)' },
        { type: 'LAB', name: '혈액형/교차시험 (ABO/Rh)' },
        { type: 'LAB', name: 'AST/ALT (간기능)' },
        { type: 'LAB', name: 'HbsAg, Anti-HCV, HIV' },
        { type: 'IMAGING', name: '흉부 X-ray (PA)' },
        { type: 'LAB', name: 'ECG (심전도)' },
        { type: 'LAB', name: '소변검사' },
        { type: 'ORDER', name: '마취과 사전 평가', instructions: 'ASA 분류' },
      ]},
    { code: 'CP-SG-002', name: '충수절제 수술 후 처방', dept: '외과', cat: 'PROCEDURE', dx: 'K35', desc: '복강경 충수절제술 후 표준 처방',
      items: [
        { type: 'MEDICATION', name: '세파졸린 1g', dosage: '1g', frequency: '1일 3회', duration: 3, route: 'IV', instructions: '예방적 항생제' },
        { type: 'MEDICATION', name: '케토롤락 30mg', dosage: '30mg', frequency: '필요 시', duration: 2, route: 'IV', instructions: '통증 시 PRN (1일 최대 90mg)' },
        { type: 'MEDICATION', name: 'PCA (펜타닐)', dosage: '지속주입', frequency: '지속', duration: 2, route: 'IV', instructions: '자가통증조절' },
        { type: 'ORDER', name: 'NPO → 장음 확인 후 SOW', instructions: '수술 당일 금식' },
        { type: 'ORDER', name: '활력징후 q4h', instructions: '24시간' },
        { type: 'ORDER', name: '조기 보행 격려', instructions: '수술 다음날' },
      ]},
    { code: 'CP-SG-003', name: '담낭절제 수술 후 처방', dept: '외과', cat: 'PROCEDURE', dx: 'K80', desc: '복강경 담낭절제술 후 표준 처방',
      items: [
        { type: 'MEDICATION', name: '세파졸린 1g', dosage: '1g', frequency: '1일 3회', duration: 2, route: 'IV' },
        { type: 'MEDICATION', name: '케토롤락 30mg', dosage: '30mg', frequency: '필요 시', duration: 2, route: 'IV', instructions: 'PRN' },
        { type: 'MEDICATION', name: '우르소데옥시콜산 300mg', dosage: '300mg', frequency: '1일 2회', duration: 30, route: 'PO', instructions: '퇴원 시 처방' },
        { type: 'ORDER', name: '저지방식', instructions: '수술 후 2주' },
        { type: 'LAB', name: 'LFT (간기능)', instructions: '수술 후 1일' },
      ]},
    { code: 'CP-SG-004', name: '탈장 수술 후 처방', dept: '외과', cat: 'PROCEDURE', dx: 'K40', desc: '서혜부 탈장 복원술 후 처방',
      items: [
        { type: 'MEDICATION', name: '세파졸린 1g', dosage: '1g', frequency: '1회', duration: 1, route: 'IV', instructions: '수술 중 예방적' },
        { type: 'MEDICATION', name: '트라마돌 50mg', dosage: '50mg', frequency: '필요 시', duration: 3, route: 'PO', instructions: 'PRN' },
        { type: 'MEDICATION', name: '아세트아미노펜 500mg', dosage: '500mg', frequency: '1일 3회', duration: 5, route: 'PO' },
        { type: 'ORDER', name: '무거운 물건 들기 금지', instructions: '4주간' },
      ]},

    // ── 정형외과 ──
    { code: 'CP-OS-001', name: '골절 초기 처방', dept: '정형외과', cat: 'DISEASE', dx: 'S82', desc: '골절 초기 평가 (X-ray + 진통제)',
      items: [
        { type: 'IMAGING', name: '골절 부위 X-ray (2방향)', instructions: 'AP + Lateral' },
        { type: 'MEDICATION', name: '이부프로펜 400mg', dosage: '400mg', frequency: '1일 3회', duration: 7, route: 'PO', instructions: '식후' },
        { type: 'MEDICATION', name: '아세트아미노펜 500mg', dosage: '500mg', frequency: '1일 3회', duration: 7, route: 'PO', instructions: 'NSAID 교대' },
        { type: 'ORDER', name: '부목/석고 고정', instructions: '골절 유형에 따라' },
      ]},
    { code: 'CP-OS-002', name: '관절염 재진 처방', dept: '정형외과', cat: 'DISEASE', dx: 'M17', desc: '퇴행성 관절염 재진 약물',
      items: [
        { type: 'MEDICATION', name: '트라마돌 50mg', dosage: '50mg', frequency: '1일 2회', duration: 14, route: 'PO' },
        { type: 'MEDICATION', name: '아세트아미노펜 500mg', dosage: '500mg', frequency: '1일 3회', duration: 14, route: 'PO' },
        { type: 'ORDER', name: '물리치료 의뢰', instructions: '재활의학과' },
      ]},
    { code: 'CP-OS-003', name: 'ORIF 수술 후 처방', dept: '정형외과', cat: 'PROCEDURE', dx: 'S72', desc: '골절 관혈적 정복 및 내고정술 후',
      items: [
        { type: 'MEDICATION', name: '세파졸린 1g', dosage: '1g', frequency: '1일 3회', duration: 3, route: 'IV' },
        { type: 'MEDICATION', name: 'PCA (펜타닐)', dosage: '지속주입', frequency: '지속', duration: 2, route: 'IV' },
        { type: 'MEDICATION', name: '에녹사파린 40mg', dosage: '40mg', frequency: '1일 1회', duration: 14, route: 'SC', instructions: 'DVT 예방' },
        { type: 'ORDER', name: '하지 거상', instructions: '부종 방지' },
        { type: 'ORDER', name: '재활의학과 협진', instructions: '수술 후 2일' },
        { type: 'LAB', name: 'CBC', instructions: '수술 후 1일' },
        { type: 'IMAGING', name: '수술 부위 X-ray', instructions: '수술 후 1일' },
      ]},

    // ── 소아청소년과 ──
    { code: 'CP-PD-001', name: '소아 발열 기본 처방', dept: '소아청소년과', cat: 'DISEASE', dx: 'R50', desc: '소아 발열 평가 (해열제+기본검사)',
      items: [
        { type: 'MEDICATION', name: '이부프로펜 시럽', dosage: '체중기반 10mg/kg', frequency: '6-8시간 간격', duration: 3, route: 'PO', instructions: '38.5℃ 이상 시' },
        { type: 'MEDICATION', name: '아세트아미노펜 시럽', dosage: '체중기반 15mg/kg', frequency: '4-6시간 간격', duration: 3, route: 'PO', instructions: '이부프로펜 교대' },
        { type: 'LAB', name: 'CBC' },
        { type: 'LAB', name: 'CRP' },
        { type: 'LAB', name: '소변검사' },
      ]},
    { code: 'CP-PD-002', name: '소아 급성 세기관지염 처방', dept: '소아청소년과', cat: 'DISEASE', dx: 'J21', desc: '영유아 세기관지염 대증 치료',
      items: [
        { type: 'MEDICATION', name: '생리식염수 네블라이저', dosage: '3mL', frequency: '1일 3-4회', duration: 5, route: 'NEB' },
        { type: 'ORDER', name: '산소 공급', instructions: 'SpO2 < 94% 시' },
        { type: 'ORDER', name: '흡인(suction)', instructions: '필요 시' },
        { type: 'LAB', name: 'RSV 신속항원검사' },
        { type: 'IMAGING', name: '흉부 X-ray', instructions: '호흡곤란 시' },
      ]},
    { code: 'CP-PD-003', name: '소아 장염 처방', dept: '소아청소년과', cat: 'DISEASE', dx: 'A09', desc: '소아 급성 장염 탈수 관리',
      items: [
        { type: 'MEDICATION', name: '경구 수액 (ORS)', dosage: '소량 자주', frequency: '지속', duration: 3, route: 'PO', instructions: '탈수 예방' },
        { type: 'MEDICATION', name: '온단세트론 (경구)', dosage: '체중기반', frequency: '필요 시', duration: 1, route: 'PO', instructions: '구토 시' },
        { type: 'ORDER', name: 'IV 수액 (D/S)', instructions: '경구 섭취 불가 시' },
        { type: 'LAB', name: 'BMP (전해질)', instructions: '탈수 평가' },
      ]},

    // ── 응급의학과 ──
    { code: 'CP-EM-001', name: '흉통 응급 프로토콜', dept: '응급의학과', cat: 'DISEASE', dx: 'I20', desc: '급성 흉통 응급 평가 (ACS r/o)',
      items: [
        { type: 'LAB', name: '12-lead ECG', instructions: '도착 10분 이내' },
        { type: 'LAB', name: 'Troponin-I (serial)', instructions: '0시간, 3시간' },
        { type: 'LAB', name: 'CK-MB, BNP' },
        { type: 'LAB', name: 'CBC, BMP, PT/aPTT' },
        { type: 'IMAGING', name: '흉부 X-ray (Portable)' },
        { type: 'MEDICATION', name: '아스피린 300mg', dosage: '300mg', frequency: '1회', duration: 1, route: 'PO', instructions: '저작 투여 (금기 확인)' },
        { type: 'MEDICATION', name: '니트로글리세린 SL', dosage: '0.6mg', frequency: '필요 시', duration: 1, route: 'SL', instructions: '흉통 시 5분 간격 최대 3회' },
        { type: 'ORDER', name: '산소 2-4L', instructions: 'SpO2 < 94% 시' },
        { type: 'ORDER', name: '심전도 모니터링', instructions: '지속' },
        { type: 'ORDER', name: 'IV line 확보 (18G x 2)' },
      ]},
    { code: 'CP-EM-002', name: '다발성 외상 초기 처방', dept: '응급의학과', cat: 'DISEASE', dx: 'S06', desc: '다발성 외상 ATLS 기반 초기 평가',
      items: [
        { type: 'ORDER', name: 'ABCDE 평가', instructions: 'Primary Survey' },
        { type: 'ORDER', name: 'C-spine 고정', instructions: '의식 변화 또는 경추 통증 시' },
        { type: 'ORDER', name: 'IV line 확보 (18G x 2)' },
        { type: 'ORDER', name: 'NS/LR 1-2L bolus', instructions: '쇼크 시' },
        { type: 'LAB', name: 'CBC, BMP, 응고검사, 혈액형/교차' },
        { type: 'LAB', name: 'Lactate, ABG' },
        { type: 'IMAGING', name: '흉부/골반 X-ray' },
        { type: 'IMAGING', name: 'FAST (초음파)', instructions: '복강 내 출혈 확인' },
        { type: 'IMAGING', name: '전신 CT (Pan-scan)', instructions: '필요 시' },
        { type: 'ORDER', name: '파상풍 예방접종 확인', instructions: '개방성 상처 시' },
      ]},

    // ── 산부인과 ──
    { code: 'CP-OB-001', name: '분만 전 기본 처방', dept: '산부인과', cat: 'SURGERY_PRE', dx: 'O80', desc: '자연분만/제왕절개 전 기본 검사',
      items: [
        { type: 'LAB', name: 'CBC, 혈액형/교차' },
        { type: 'LAB', name: 'BMP, LFT' },
        { type: 'LAB', name: 'HBsAg, Anti-HCV, RPR, HIV' },
        { type: 'LAB', name: 'GBS 배양', instructions: '35-37주 미시행 시' },
        { type: 'ORDER', name: '태아심박수 모니터링 (NST)' },
        { type: 'ORDER', name: 'IV line 확보' },
      ]},

    // ── 입원 공통 ──
    { code: 'CP-AD-001', name: '입원 시 기본오더', dept: null, cat: 'ADMISSION', dx: null, desc: '모든 입원 환자 기본 오더 (검사+간호+식이+활동)',
      items: [
        { type: 'LAB', name: 'CBC' },
        { type: 'LAB', name: 'BMP (전해질 포함)' },
        { type: 'LAB', name: '소변검사' },
        { type: 'IMAGING', name: '흉부 X-ray (PA)' },
        { type: 'ORDER', name: '활력징후 1일 4회', instructions: '06/12/18/22시' },
        { type: 'ORDER', name: '식이: 일반식', instructions: '특별식 필요 시 영양과 협진' },
        { type: 'ORDER', name: '활동: 자유 보행', instructions: '수술/시술 후 별도 지시' },
        { type: 'ORDER', name: '낙상 예방', instructions: '낙상위험 평가(Morse) 시행' },
        { type: 'ORDER', name: '심부정맥혈전증 예방', instructions: '위험도 평가' },
        { type: 'ORDER', name: '알레르기/약물 부작용 확인' },
      ]},
    { code: 'CP-AD-002', name: 'ICU 입실 기본오더', dept: null, cat: 'ADMISSION', dx: null, desc: '중환자실 입실 표준 오더',
      items: [
        { type: 'LAB', name: 'CBC, BMP, LFT, ABG, Lactate' },
        { type: 'LAB', name: '응고검사 (PT/aPTT)' },
        { type: 'LAB', name: '혈액배양 2세트', instructions: '감염 의심 시' },
        { type: 'IMAGING', name: '흉부 X-ray (Portable)' },
        { type: 'ORDER', name: '활력징후 q1h', instructions: '안정 시 q2h' },
        { type: 'ORDER', name: '심전도 지속 모니터링' },
        { type: 'ORDER', name: 'I/O 기록 (시간별)' },
        { type: 'ORDER', name: '혈당 q6h', instructions: '인슐린 사용 시 q4h' },
        { type: 'ORDER', name: '욕창 예방 (체위변경 q2h)' },
        { type: 'ORDER', name: 'DVT 예방', instructions: '압박스타킹 또는 약물적 예방' },
        { type: 'ORDER', name: 'HOB 30도 거상', instructions: '인공호흡기 사용 시' },
        { type: 'ORDER', name: '구강간호 q4h', instructions: 'VAP 예방' },
      ]},

    // ── 퇴원 ──
    { code: 'CP-DC-001', name: '퇴원 시 기본오더', dept: null, cat: 'PROCEDURE', dx: null, desc: '퇴원 표준 프로세스',
      items: [
        { type: 'ORDER', name: '퇴원 약 처방 확인' },
        { type: 'ORDER', name: '퇴원 교육 (약물/식이/활동)', instructions: '간호사' },
        { type: 'ORDER', name: '외래 예약 확인', instructions: '담당과' },
        { type: 'ORDER', name: '퇴원 요약지 작성', instructions: '담당의' },
        { type: 'ORDER', name: '수납 확인', instructions: '원무과' },
      ]},
  ];
  for (const os of orderSets) {
    const { code, ...osData } = os as any;
    const fullName = `[${code}] ${os.name}`;
    await prisma.orderSet.upsert({
      where: { name: fullName },
      update: { description: os.desc ?? null, items: os.items as any },
      create: { name: fullName, department: osData.dept, category: osData.cat, diagnosisCode: osData.dx, description: osData.desc ?? null, items: osData.items, createdBy: adminId },
    });
  }
  console.log(`     → ${orderSets.length} order sets (CP) seeded`);

  // ── 진료과별 대기 환자 (WaitingQueue) ──
  console.log('  [+] Setting up waiting queue per department...');

  // 기존 대기열 초기화
  await prisma.waitingQueue.deleteMany({ where: { status: 'WAITING' } });

  const waitingPatients = [
    // 의사 userId → 환자 patientIdx → 진료과
    { doctorIdx: 2, patientIdx: 1, dept: '내과', room: '내과 1진료실', reason: '고혈압+당뇨 재진' },
    { doctorIdx: 3, patientIdx: 15, dept: '내과', room: '내과 2진료실', reason: 'COPD 악화 재진' },
    { doctorIdx: 20, patientIdx: 2, dept: '내과', room: '소화기내과 진료실', reason: '위궤양 추적 내시경' },
    { doctorIdx: 21, patientIdx: 22, dept: '내과', room: '내분비내과 진료실', reason: '당뇨+갑상선 재진' },
    { doctorIdx: 22, patientIdx: 19, dept: '내과', room: '신장내과 진료실', reason: 'CKD 추적관찰' },
    { doctorIdx: 23, patientIdx: 13, dept: '내과', room: '혈액종양내과 진료실', reason: '빈혈 추적' },
    { doctorIdx: 24, patientIdx: 9, dept: '내과', room: '감염내과 진료실', reason: '요로감염 추적' },
    { doctorIdx: 25, patientIdx: 7, dept: '내과', room: '류마티스내과 진료실', reason: '관절통 평가' },
    { doctorIdx: 4, patientIdx: 3, dept: '외과', room: '외과 1진료실', reason: '요추 수술 상담' },
    { doctorIdx: 5, patientIdx: 4, dept: '외과', room: '흉부외과 진료실', reason: '심부전 수술 평가' },
    { doctorIdx: 8, patientIdx: 7, dept: '정형외과', room: '정형외과 진료실', reason: '무릎관절증 재진' },
    { doctorIdx: 26, patientIdx: 11, dept: '신경외과', room: '신경외과 진료실', reason: '두부외상 추적' },
    { doctorIdx: 27, patientIdx: 10, dept: '성형외과', room: '성형외과 진료실', reason: '외상 반흔 상담' },
    { doctorIdx: 6, patientIdx: 8, dept: '소아청소년과', room: '소아과 진료실', reason: '기관지염 추적' },
    { doctorIdx: 7, patientIdx: 14, dept: '산부인과', room: '산부인과 진료실', reason: '불규칙 월경 재진' },
    { doctorIdx: 28, patientIdx: 6, dept: '정신건강의학과', room: '정신과 진료실', reason: '우울+불안 재진' },
    { doctorIdx: 29, patientIdx: 24, dept: '안과', room: '안과 진료실', reason: '결막염 추적' },
    { doctorIdx: 30, patientIdx: 21, dept: '이비인후과', room: '이비인후과 진료실', reason: '반복성 중이염 추적' },
    { doctorIdx: 31, patientIdx: 20, dept: '피부과', room: '피부과 진료실', reason: '아토피 재발 재진' },
    { doctorIdx: 32, patientIdx: 27, dept: '비뇨의학과', room: '비뇨기과 진료실', reason: '전립선 비대 재진' },
    { doctorIdx: 33, patientIdx: 19, dept: '재활의학과', room: '재활의학과 진료실', reason: '뇌경색 재활 추적' },
    { doctorIdx: 34, patientIdx: 17, dept: '가정의학과', room: '가정의학과 진료실', reason: '대사증후군 재진' },
    { doctorIdx: 9, patientIdx: 5, dept: '응급의학과', room: '응급 1구역', reason: '발열+두통' },
    { doctorIdx: 35, patientIdx: 3, dept: '마취통증의학과', room: '마취과 진료실', reason: '수술 전 마취 평가' },
    { doctorIdx: 36, patientIdx: 4, dept: '영상의학과', room: '판독실', reason: '흉부 CT 판독 의뢰' },
    { doctorIdx: 37, patientIdx: 29, dept: '병리과', room: '병리 판독실', reason: '위생검 병리 판독' },
  ];

  for (let i = 0; i < waitingPatients.length; i++) {
    const wp = waitingPatients[i];
    const wqId = makeUuid('a0e00000', i + 1);
    await prisma.waitingQueue.upsert({
      where: { id: wqId },
      update: {},
      create: {
        id: wqId,
        patientId: uid(P.PATIENT, wp.patientIdx),
        doctorId: uid(P.USER, wp.doctorIdx),
        departmentName: wp.dept,
        roomName: wp.room,
        queueNumber: 1,
        type: 'WALK_IN',
        visitType: wp.patientIdx <= 12 ? 'FOLLOW_UP' : 'INITIAL',
        reason: wp.reason,
        status: 'WAITING',
      },
    });
  }
  console.log(`     → ${waitingPatients.length} waiting queue entries seeded`);

  // Patient.allergies JSON → Allergy 모델 마이그레이션 (시딩 시)
  console.log('  [+] Migrating Patient.allergies JSON → Allergy model...');
  const patientsWithAllergies = await prisma.patient.findMany({
    where: { NOT: { allergies: { equals: [] } } },
    select: { id: true, allergies: true, createdBy: true },
  });
  let migratedCount = 0;
  for (const p of patientsWithAllergies) {
    const allergies = p.allergies as any[];
    if (!Array.isArray(allergies)) continue;
    for (const a of allergies) {
      const name = typeof a === 'string' ? a : a?.name ?? a?.allergen;
      if (!name) continue;
      const existing = await prisma.allergy.findFirst({ where: { patientId: p.id, allergen: name } });
      if (existing) continue;
      const severity = a?.severity === 'high' ? 'SEVERE' : a?.severity === 'low' ? 'MILD' : 'MODERATE';
      await prisma.allergy.create({
        data: {
          patientId: p.id, type: 'DRUG', allergen: name, reaction: 'Unknown (migrated)',
          severity, verificationStatus: 'UNCONFIRMED', reportedBy: 'Patient (migrated)',
          recordedBy: p.createdBy, isActive: true,
        },
      });
      migratedCount++;
    }
  }

  // ============================================================
  // ICU Beds (중환자실 병상)
  // ============================================================
  console.log('  [Extra] ICU Beds...');

  const icuBeds = [
    { i: 1, unit: 'MICU', bed: 'MICU-01' }, { i: 2, unit: 'MICU', bed: 'MICU-02' },
    { i: 3, unit: 'MICU', bed: 'MICU-03' }, { i: 4, unit: 'MICU', bed: 'MICU-04' },
    { i: 5, unit: 'SICU', bed: 'SICU-01' }, { i: 6, unit: 'SICU', bed: 'SICU-02' },
    { i: 7, unit: 'SICU', bed: 'SICU-03' }, { i: 8, unit: 'SICU', bed: 'SICU-04' },
  ];

  for (const b of icuBeds) {
    await prisma.icuBed.upsert({
      where: { unitName_bedNumber: { unitName: b.unit, bedNumber: b.bed } },
      update: {},
      create: { unitName: b.unit, bedNumber: b.bed, status: 'AVAILABLE' },
    });
  }

  // ============================================================
  // Clinic Schedule (진료표 시드)
  // ============================================================
  console.log('  [Extra] Clinic Schedules...');

  const clinicScheduleData = [
    // 김내과: 월~금 오전, 월수금 오후, 토 오전
    { doctor: 2, dept: '내과', room: '내과 1진료실', schedules: [
      { day: 1, p: 'AM' }, { day: 1, p: 'PM' }, { day: 2, p: 'AM' },
      { day: 3, p: 'AM' }, { day: 3, p: 'PM' }, { day: 4, p: 'AM' },
      { day: 5, p: 'AM' }, { day: 5, p: 'PM' }, { day: 6, p: 'AM' },
    ]},
    // 박내과: 월화목금 오전, 화수목 오후
    { doctor: 3, dept: '내과', room: '내과 2진료실', schedules: [
      { day: 1, p: 'AM' }, { day: 2, p: 'AM' }, { day: 2, p: 'PM' },
      { day: 3, p: 'PM' }, { day: 4, p: 'AM' }, { day: 4, p: 'PM' },
      { day: 5, p: 'AM' },
    ]},
    // 이외과: 월수금 오전오후, 화목 오후
    { doctor: 4, dept: '외과', room: '외과 1진료실', schedules: [
      { day: 1, p: 'AM' }, { day: 1, p: 'PM' }, { day: 2, p: 'PM' },
      { day: 3, p: 'AM' }, { day: 3, p: 'PM' }, { day: 4, p: 'PM' },
      { day: 5, p: 'AM' }, { day: 5, p: 'PM' },
    ]},
    // 최외과: 화수목 오전오후, 월금 오후, 토 오전
    { doctor: 5, dept: '외과', room: '외과 2진료실', schedules: [
      { day: 1, p: 'PM' }, { day: 2, p: 'AM' }, { day: 2, p: 'PM' },
      { day: 3, p: 'AM' }, { day: 4, p: 'AM' }, { day: 4, p: 'PM' },
      { day: 5, p: 'PM' }, { day: 6, p: 'AM' },
    ]},
    // 정소아: 월~금 오전, 월화목금 오후, 토 오전
    { doctor: 6, dept: '소아청소년과', room: '소아과 진료실', schedules: [
      { day: 1, p: 'AM' }, { day: 1, p: 'PM' }, { day: 2, p: 'AM' }, { day: 2, p: 'PM' },
      { day: 3, p: 'AM' }, { day: 4, p: 'AM' }, { day: 4, p: 'PM' },
      { day: 5, p: 'AM' }, { day: 5, p: 'PM' }, { day: 6, p: 'AM' },
    ]},
    // 한산부: 월수목금 오전, 화수목 오후
    { doctor: 7, dept: '산부인과', room: '산부인과 진료실', schedules: [
      { day: 1, p: 'AM' }, { day: 2, p: 'AM' }, { day: 2, p: 'PM' },
      { day: 3, p: 'AM' }, { day: 4, p: 'AM' }, { day: 4, p: 'PM' },
      { day: 5, p: 'AM' },
    ]},
    // 오정형: 월~금 오전, 월수금 오후
    { doctor: 8, dept: '정형외과', room: '정형외과 진료실', schedules: [
      { day: 1, p: 'AM' }, { day: 1, p: 'PM' }, { day: 2, p: 'AM' },
      { day: 3, p: 'AM' }, { day: 3, p: 'PM' }, { day: 4, p: 'AM' },
      { day: 5, p: 'AM' }, { day: 5, p: 'PM' },
    ]},
    // 강응급: 응급실 (매일 오전+오후)
    { doctor: 9, dept: '응급의학과', room: '응급실', schedules: [
      { day: 1, p: 'ALL' }, { day: 2, p: 'ALL' }, { day: 3, p: 'ALL' },
      { day: 4, p: 'ALL' }, { day: 5, p: 'ALL' }, { day: 6, p: 'ALL' }, { day: 0, p: 'ALL' },
    ]},
  ];

  let csCount = 0;
  for (const cs of clinicScheduleData) {
    for (const slot of cs.schedules) {
      const startTime = slot.p === 'AM' ? '09:00' : slot.p === 'PM' ? '14:00' : '00:00';
      const endTime = slot.p === 'AM' ? '12:30' : slot.p === 'PM' ? '17:30' : '23:59';
      await prisma.clinicSchedule.upsert({
        where: { doctorId_dayOfWeek_period: { doctorId: uid(P.USER, cs.doctor), dayOfWeek: slot.day, period: slot.p } },
        update: {},
        create: {
          doctorId: uid(P.USER, cs.doctor),
          departmentName: cs.dept,
          roomName: cs.room,
          dayOfWeek: slot.day,
          period: slot.p,
          startTime,
          endTime,
          maxPatients: slot.p === 'ALL' ? 50 : 20,
        },
      });
      csCount++;
    }
  }
  console.log(`     → ${csCount} clinic schedule slots seeded`);

  // ============================================================
  // ICU Admissions (중환자실 입실 시드)
  // ============================================================
  console.log('  [Extra] ICU Admissions...');

  const allPatients = await prisma.patient.findMany({ take: 10, select: { id: true } });
  if (allPatients.length >= 3) {
    const icuAdmissions = [
      {
        patientIdx: 0, bedUnit: 'MICU', bedNum: 'MICU-01', doctorIdx: 2,
        reason: '심정지 후 소생 관찰', severity: 'CRITICAL', ventilator: true, isolation: false,
      },
      {
        patientIdx: 1, bedUnit: 'MICU', bedNum: 'MICU-02', doctorIdx: 3,
        reason: '패혈증 (Sepsis)', severity: 'SEVERE', ventilator: false, isolation: true,
      },
      {
        patientIdx: 2, bedUnit: 'SICU', bedNum: 'SICU-01', doctorIdx: 4,
        reason: '수술 후 집중 관찰', severity: 'MODERATE', ventilator: false, isolation: false,
      },
    ];

    for (const ia of icuAdmissions) {
      const bed = await prisma.icuBed.findFirst({
        where: { unitName: ia.bedUnit, bedNumber: ia.bedNum },
      });
      if (!bed) continue;

      const existingAdm = await prisma.icuAdmission.findFirst({
        where: { icuBedId: bed.id, status: 'ADMITTED' },
      });
      if (existingAdm) continue;

      await prisma.icuBed.update({ where: { id: bed.id }, data: { status: 'OCCUPIED' } });
      const admission = await prisma.icuAdmission.create({
        data: {
          patientId: allPatients[ia.patientIdx].id,
          icuBedId: bed.id,
          doctorId: uid(P.USER, ia.doctorIdx),
          admitDate: new Date(Date.now() - (ia.patientIdx + 1) * 86400000),
          admitReason: ia.reason,
          severity: ia.severity,
          ventilator: ia.ventilator,
          isolation: ia.isolation,
        },
      });

      // Add sample vital records
      for (let h = 0; h < 3; h++) {
        await prisma.icuRecord.create({
          data: {
            admissionId: admission.id,
            recordTime: new Date(Date.now() - h * 4 * 3600000),
            heartRate: 70 + Math.floor(Math.random() * 40),
            systolicBp: 100 + Math.floor(Math.random() * 40),
            diastolicBp: 60 + Math.floor(Math.random() * 20),
            spo2: 93 + Math.floor(Math.random() * 6),
            respiratoryRate: 14 + Math.floor(Math.random() * 10),
            temperature: 36.0 + Math.random() * 2.5,
            gcScore: ia.severity === 'CRITICAL' ? 8 : ia.severity === 'SEVERE' ? 12 : 15,
            consciousness: ia.severity === 'CRITICAL' ? 'PAIN' : ia.severity === 'SEVERE' ? 'VERBAL' : 'ALERT',
            intakeOral: ia.severity === 'CRITICAL' ? 0 : 100 + Math.floor(Math.random() * 200),
            intakeIv: 200 + Math.floor(Math.random() * 300),
            outputUrine: 100 + Math.floor(Math.random() * 300),
            outputDrain: ia.severity === 'CRITICAL' ? 50 + Math.floor(Math.random() * 100) : 0,
            ventMode: ia.ventilator ? 'AC' : undefined,
            fio2: ia.ventilator ? 40 : undefined,
            peep: ia.ventilator ? 5 : undefined,
            tidalVolume: ia.ventilator ? 450 : undefined,
            apacheScore: ia.severity === 'CRITICAL' ? 28 : ia.severity === 'SEVERE' ? 18 : 10,
            sofaScore: ia.severity === 'CRITICAL' ? 12 : ia.severity === 'SEVERE' ? 8 : 3,
            recordedBy: uid(P.USER, 10),
          },
        });
      }
    }
    console.log('     → 3 ICU admissions + vital records seeded');
  }

  // ============================================================
  // Diagnostic Test Sample Data (기초검사 샘플)
  // ============================================================
  console.log('  [Extra] Diagnostic Test Samples...');

  if (allPatients.length > 0) {
    const diagTests = [
      { type: 'EKG', name: '12-lead EKG', pt: 0 },
      { type: 'EKG', name: '12-lead EKG', pt: 1 },
      { type: 'EEG', name: '뇌파검사', pt: 2 },
      { type: 'PFT', name: '폐기능검사', pt: 3 },
      { type: 'ECHO', name: '심장초음파', pt: 4 },
      { type: 'ENDOSCOPY_UPPER', name: '상부위장관내시경', pt: 5 },
      { type: 'DEXA', name: '골밀도검사', pt: 6 },
      { type: 'EKG', name: '12-lead EKG', pt: 7 },
      { type: 'PFT', name: '폐기능검사', pt: 8 },
      { type: 'ECHO', name: '심장초음파', pt: 9 },
    ];

    /** 검사 종류별 정상 소견 문구 — 등재된 종류에만 쓴다(모르면 소견을 만들지 않는다). */
    const DIAG_NORMAL_FINDINGS: Record<string, string> = {
      EKG: 'Normal sinus rhythm, HR 72bpm, axis normal',
      EEG: '배경파 알파 9-10Hz 대칭·정상 반응성. 간질양 방전 없음.',
      PFT: 'FVC 3.82L(예측치 98%)·FEV1 3.10L(96%)·FEV1/FVC 81% — 정상 폐활량',
      ECHO: 'LVEF 62%·좌심실 벽운동 정상·판막 유의 이상 없음·심낭삼출 없음',
      ENDOSCOPY_UPPER: '식도·위·십이지장 점막 정상. 궤양·종괴 없음. H. pylori 검사 음성.',
      DEXA: '요추 L1-L4 T-score −0.4 · 대퇴경부 T-score −0.6 — 정상 골밀도',
    };
    for (const dt of diagTests) {
      const ptIdx = dt.pt < allPatients.length ? dt.pt : 0;
      const stat = dt.pt < 3 ? 'COMPLETED' : dt.pt < 5 ? 'IN_PROGRESS' : dt.pt < 7 ? 'SCHEDULED' : 'ORDERED';
      await prisma.diagnosticTest.create({
        data: {
          patientId: allPatients[ptIdx].id,
          requestedBy: kimNaegwaId,
          testType: dt.type,
          testName: dt.name,
          status: stat,
          scheduledAt: new Date(Date.now() + (dt.pt - 3) * 3600000),
          performedAt: stat === 'COMPLETED' ? new Date(Date.now() - 3600000) : null,
          performedBy: stat === 'COMPLETED' ? uid(P.USER, 15) : null,
          // 🔴 종전 결함: 상태만 보고 **심전도 판독문 한 줄을 모든 검사에 상수로** 넣었다 —
          //    뇌파검사(EEG) 결과지에 "Normal sinus rhythm, HR 72bpm" 이 적혔다.
          //    검사 종류마다 다른 소견을 쓰고, 등재되지 않은 종류면 소견을 **지어내지 않는다**(null).
          findings: stat === 'COMPLETED' ? (DIAG_NORMAL_FINDINGS[dt.type] ?? null) : null,
          conclusion: stat === 'COMPLETED' ? 'NORMAL' : null,
        },
      });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Seed completed in ${elapsed}s`);
  console.log('   - Users: 43 (incl. 3 executives)');
  // ── 차트 템플릿 (진료과별 샘플) ──
  const chartAdminId = uid(P.USER, 1);
  const chartTemplates = [
    {
      name: '내과 외래 초진', department: '내과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
      description: '내과 외래 초진 환자용 SOAP 확장 차트',
      sections: [
        { id: 's1', title: '주소 및 현병력', fields: [
          { id: 'cc', label: '주소(Chief Complaint)', type: 'text', required: true, mappedTo: 'subjective' },
          { id: 'hpi', label: '현병력(HPI)', type: 'textarea', required: true, mappedTo: 'subjective' },
          { id: 'onset', label: '발병일', type: 'date' },
          { id: 'duration', label: '기간', type: 'text' },
          { id: 'severity', label: '중증도(1-10)', type: 'number', min: 1, max: 10 },
        ]},
        { id: 's2', title: '과거력/가족력', fields: [
          { id: 'pmh', label: '과거 병력', type: 'textarea' },
          { id: 'meds', label: '현재 복용 약물', type: 'textarea' },
          { id: 'allergy', label: '알레르기', type: 'text' },
          { id: 'fhx', label: '가족력', type: 'textarea' },
          { id: 'social', label: '사회력(음주/흡연)', type: 'textarea' },
        ]},
        { id: 's3', title: '신체검진', fields: [
          { id: 'vs_bp', label: '혈압(mmHg)', type: 'text', placeholder: '120/80', mappedTo: 'objective' },
          { id: 'vs_hr', label: '맥박(회/분)', type: 'number', mappedTo: 'objective' },
          { id: 'vs_bt', label: '체온(℃)', type: 'number', mappedTo: 'objective' },
          { id: 'vs_rr', label: '호흡수(회/분)', type: 'number', mappedTo: 'objective' },
          { id: 'vs_spo2', label: 'SpO2(%)', type: 'number', mappedTo: 'objective' },
          { id: 'pe', label: '이학적 소견', type: 'textarea', mappedTo: 'objective' },
        ]},
        { id: 's4', title: '평가 및 계획', fields: [
          { id: 'assessment', label: '평가(Assessment)', type: 'textarea', required: true, mappedTo: 'assessment' },
          { id: 'plan', label: '치료 계획(Plan)', type: 'textarea', required: true, mappedTo: 'plan' },
          { id: 'fu', label: '추적 관찰', type: 'text' },
        ]},
      ],
    },
    {
      name: '내과 재진 간이', department: '내과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'single-page',
      description: '내과 재진 환자용 간이 차트',
      sections: [
        { id: 's1', title: 'SOAP', fields: [
          { id: 'interval', label: '경과', type: 'textarea', mappedTo: 'subjective' },
          { id: 'vs', label: '활력징후', type: 'text', placeholder: 'BP/HR/BT', mappedTo: 'objective' },
          { id: 'labs', label: '검사 결과 확인', type: 'textarea', mappedTo: 'objective' },
          { id: 'assessment', label: '평가', type: 'textarea', mappedTo: 'assessment' },
          { id: 'plan', label: '계획', type: 'textarea', mappedTo: 'plan' },
        ]},
      ],
    },
    {
      name: '외과 외래', department: '외과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
      description: '외과 외래 차트 (수술 전후 평가 포함)',
      sections: [
        { id: 's1', title: '주소/현병력', fields: [
          { id: 'cc', label: '주소', type: 'text', required: true, mappedTo: 'subjective' },
          { id: 'hpi', label: '현병력', type: 'textarea', mappedTo: 'subjective' },
          { id: 'pain_site', label: '통증 부위', type: 'text' },
          { id: 'pain_nrs', label: '통증 NRS(0-10)', type: 'number', min: 0, max: 10 },
        ]},
        { id: 's2', title: '신체검진', fields: [
          { id: 'wound', label: '상처/수술부위 상태', type: 'textarea', mappedTo: 'objective' },
          { id: 'drain', label: '배액관 상태', type: 'text' },
          { id: 'pe', label: '이학적 소견', type: 'textarea', mappedTo: 'objective' },
        ]},
        { id: 's3', title: '수술 평가', fields: [
          { id: 'op_indication', label: '수술 적응증', type: 'textarea' },
          { id: 'op_plan', label: '수술 계획', type: 'textarea', mappedTo: 'plan' },
          { id: 'asa', label: 'ASA 등급', type: 'select', options: ['I','II','III','IV','V'] },
          { id: 'consent', label: '수술 동의서', type: 'select', options: ['미취득','취득완료'] },
        ]},
        { id: 's4', title: '평가/계획', fields: [
          { id: 'assessment', label: '평가', type: 'textarea', mappedTo: 'assessment' },
          { id: 'plan', label: '계획', type: 'textarea', mappedTo: 'plan' },
        ]},
      ],
    },
    {
      name: '소아청소년과 외래', department: '소아청소년과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
      description: '소아 환자 전용 차트 (성장발달 포함)',
      sections: [
        { id: 's1', title: '주소/현병력', fields: [
          { id: 'cc', label: '주소(보호자 진술)', type: 'text', required: true, mappedTo: 'subjective' },
          { id: 'hpi', label: '현병력', type: 'textarea', mappedTo: 'subjective' },
          { id: 'feeding', label: '수유/식이', type: 'text' },
          { id: 'vaccine', label: '예방접종 현황', type: 'text' },
        ]},
        { id: 's2', title: '성장 발달', fields: [
          { id: 'height', label: '신장(cm)', type: 'number', mappedTo: 'objective' },
          { id: 'weight', label: '체중(kg)', type: 'number', mappedTo: 'objective' },
          { id: 'head_circ', label: '두위(cm)', type: 'number' },
          { id: 'percentile', label: '성장 백분위', type: 'text' },
          { id: 'dev_milestone', label: '발달 이정표', type: 'textarea' },
        ]},
        { id: 's3', title: '신체검진', fields: [
          { id: 'vs', label: '활력징후', type: 'text', mappedTo: 'objective' },
          { id: 'pe', label: '이학적 소견', type: 'textarea', mappedTo: 'objective' },
        ]},
        { id: 's4', title: '평가/계획', fields: [
          { id: 'assessment', label: '평가', type: 'textarea', mappedTo: 'assessment' },
          { id: 'plan', label: '계획', type: 'textarea', mappedTo: 'plan' },
          { id: 'parent_edu', label: '보호자 교육', type: 'textarea' },
        ]},
      ],
    },
    {
      name: '정형외과 외래', department: '정형외과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
      description: '정형외과 근골격계 평가 차트',
      sections: [
        { id: 's1', title: '주소/현병력', fields: [
          { id: 'cc', label: '주소', type: 'text', required: true, mappedTo: 'subjective' },
          { id: 'mechanism', label: '손상 기전', type: 'text' },
          { id: 'pain_site', label: '통증 부위', type: 'text' },
          { id: 'pain_nrs', label: 'NRS(0-10)', type: 'number', min: 0, max: 10 },
          { id: 'rom_limit', label: 'ROM 제한', type: 'text' },
        ]},
        { id: 's2', title: '신체검진', fields: [
          { id: 'inspection', label: '시진(부종/변형/반상출혈)', type: 'textarea', mappedTo: 'objective' },
          { id: 'palpation', label: '촉진(압통/종물)', type: 'textarea', mappedTo: 'objective' },
          { id: 'rom', label: 'ROM 측정', type: 'textarea', mappedTo: 'objective' },
          { id: 'special_test', label: '특수 검사', type: 'textarea', mappedTo: 'objective' },
          { id: 'neuro', label: '신경학적 검사', type: 'textarea' },
        ]},
        { id: 's3', title: '영상/평가', fields: [
          { id: 'xray', label: 'X-ray 소견', type: 'textarea' },
          { id: 'mri_ct', label: 'MRI/CT 소견', type: 'textarea' },
          { id: 'assessment', label: '평가', type: 'textarea', mappedTo: 'assessment' },
          { id: 'plan', label: '계획', type: 'textarea', mappedTo: 'plan' },
        ]},
      ],
    },
    {
      name: '응급실 초기 평가', department: '응급의학과', role: 'DOCTOR', category: 'EMERGENCY', layout: 'single-page',
      description: '응급실 초기 평가 차트 (KTAS 포함)',
      sections: [
        { id: 's1', title: '응급 평가', fields: [
          { id: 'cc', label: '주소', type: 'text', required: true, mappedTo: 'subjective' },
          { id: 'arrival', label: '내원 수단', type: 'select', options: ['도보','119구급차','사설구급차','기타'] },
          { id: 'ktas', label: 'KTAS 등급', type: 'select', options: ['1(소생)','2(긴급)','3(응급)','4(준응급)','5(비응급)'] },
          { id: 'onset', label: '발병 시간', type: 'text' },
          { id: 'hpi', label: '현병력', type: 'textarea', mappedTo: 'subjective' },
          { id: 'vs_bp', label: '혈압', type: 'text', mappedTo: 'objective' },
          { id: 'vs_hr', label: '맥박', type: 'number', mappedTo: 'objective' },
          { id: 'vs_bt', label: '체온', type: 'number', mappedTo: 'objective' },
          { id: 'vs_rr', label: '호흡수', type: 'number', mappedTo: 'objective' },
          { id: 'vs_spo2', label: 'SpO2', type: 'number', mappedTo: 'objective' },
          { id: 'gcs', label: 'GCS', type: 'text', placeholder: 'E_V_M_' },
          { id: 'pe', label: '신체검진', type: 'textarea', mappedTo: 'objective' },
          { id: 'assessment', label: '초기 평가', type: 'textarea', mappedTo: 'assessment' },
          { id: 'plan', label: '처치 계획', type: 'textarea', mappedTo: 'plan' },
          { id: 'disposition', label: '처분', type: 'select', options: ['귀가','입원','전원','수술','사망','기타'] },
        ]},
      ],
    },
    {
      name: '산부인과 외래', department: '산부인과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
      description: '산부인과 산전/부인과 차트',
      sections: [
        { id: 's1', title: '산과력/주소', fields: [
          { id: 'cc', label: '주소', type: 'text', required: true, mappedTo: 'subjective' },
          { id: 'lmp', label: 'LMP(최종월경일)', type: 'date' },
          { id: 'edd', label: 'EDC(분만예정일)', type: 'date' },
          { id: 'ga', label: '임신주수', type: 'text' },
          { id: 'gpal', label: 'G-P-A-L', type: 'text', placeholder: 'G_P_A_L_' },
        ]},
        { id: 's2', title: '산전 검진', fields: [
          { id: 'fhr', label: '태아심음(FHR)', type: 'number', mappedTo: 'objective' },
          { id: 'fundal', label: '자궁저높이(cm)', type: 'number', mappedTo: 'objective' },
          { id: 'us', label: '초음파 소견', type: 'textarea', mappedTo: 'objective' },
          { id: 'presentation', label: '태위', type: 'select', options: ['두위','골반위','횡위','미확인'] },
          { id: 'edema', label: '부종', type: 'select', options: ['없음','+','++','+++'] },
        ]},
        { id: 's3', title: '평가/계획', fields: [
          { id: 'assessment', label: '평가', type: 'textarea', mappedTo: 'assessment' },
          { id: 'plan', label: '계획', type: 'textarea', mappedTo: 'plan' },
        ]},
      ],
    },
    {
      name: '정신건강의학과 외래', department: '정신건강의학과', role: 'DOCTOR', category: 'OUTPATIENT', layout: 'tabs',
      description: '정신과 면담 차트',
      sections: [
        { id: 's1', title: '면담', fields: [
          { id: 'cc', label: '주호소', type: 'text', required: true, mappedTo: 'subjective' },
          { id: 'mood', label: '기분(Mood)', type: 'text' },
          { id: 'affect', label: '정동(Affect)', type: 'text' },
          { id: 'sleep', label: '수면', type: 'text' },
          { id: 'appetite', label: '식욕', type: 'text' },
          { id: 'suicidal', label: '자살사고', type: 'select', options: ['없음','수동적 사고','능동적 사고','계획 있음'] },
          { id: 'content', label: '면담 내용', type: 'textarea', mappedTo: 'subjective' },
        ]},
        { id: 's2', title: '정신상태검사(MSE)', fields: [
          { id: 'appearance', label: '외양/행동', type: 'textarea', mappedTo: 'objective' },
          { id: 'thought', label: '사고(내용/과정)', type: 'textarea', mappedTo: 'objective' },
          { id: 'perception', label: '지각(환청/환시)', type: 'text' },
          { id: 'cognition', label: '인지(지남력/기억력)', type: 'text' },
          { id: 'insight', label: '병식', type: 'select', options: ['양호','부분적','결여'] },
        ]},
        { id: 's3', title: '평가/계획', fields: [
          { id: 'assessment', label: '진단적 평가', type: 'textarea', mappedTo: 'assessment' },
          { id: 'plan', label: '치료 계획', type: 'textarea', mappedTo: 'plan' },
          { id: 'risk', label: '위험도 평가', type: 'select', options: ['낮음','중등도','높음','매우 높음'] },
        ]},
      ],
    },
    {
      name: '입원 경과 기록', department: '공통', role: 'DOCTOR', category: 'INPATIENT', layout: 'single-page',
      description: '입원 환자 일일 경과 기록',
      sections: [
        { id: 's1', title: '일일 경과', fields: [
          { id: 'interval', label: '경과', type: 'textarea', mappedTo: 'subjective' },
          { id: 'vs', label: '활력징후', type: 'text', placeholder: 'BP/HR/BT/RR/SpO2', mappedTo: 'objective' },
          { id: 'io', label: 'I/O', type: 'text', placeholder: 'In___mL / Out___mL' },
          { id: 'pain', label: '통증 NRS', type: 'number', min: 0, max: 10 },
          { id: 'diet', label: '식이', type: 'text' },
          { id: 'activity', label: '활동', type: 'select', options: ['절대안정','침상안정','보행가능','자유활동'] },
          { id: 'pe', label: '신체검진', type: 'textarea', mappedTo: 'objective' },
          { id: 'labs', label: '검사 결과', type: 'textarea' },
          { id: 'assessment', label: '평가', type: 'textarea', mappedTo: 'assessment' },
          { id: 'plan', label: '계획(오더 변경 포함)', type: 'textarea', mappedTo: 'plan' },
        ]},
      ],
    },
    {
      name: '간호 초기 평가', department: '공통', role: 'NURSE', category: 'INPATIENT', layout: 'tabs',
      description: '입원 간호 초기 평가 차트',
      sections: [
        { id: 's1', title: '기본 정보', fields: [
          { id: 'admission_route', label: '입원 경로', type: 'select', options: ['외래','응급실','전원','기타'] },
          { id: 'info_source', label: '정보 제공자', type: 'select', options: ['본인','보호자','기타'] },
          { id: 'orientation', label: '병동 오리엔테이션', type: 'select', options: ['완료','미완료'] },
          { id: 'valuables', label: '귀중품', type: 'text' },
        ]},
        { id: 's2', title: '신체 사정', fields: [
          { id: 'vs', label: '활력징후', type: 'text', placeholder: 'BP/HR/BT/RR/SpO2' },
          { id: 'height', label: '신장(cm)', type: 'number' },
          { id: 'weight', label: '체중(kg)', type: 'number' },
          { id: 'bmi', label: 'BMI', type: 'number' },
          { id: 'consciousness', label: '의식 상태', type: 'select', options: ['명료','기면','혼미','반혼수','혼수'] },
          { id: 'skin', label: '피부 상태', type: 'textarea' },
          { id: 'pain', label: '통증(NRS 0-10)', type: 'number', min: 0, max: 10 },
          { id: 'pain_site', label: '통증 부위', type: 'text' },
        ]},
        { id: 's3', title: '위험 평가', fields: [
          { id: 'fall_risk', label: '낙상 위험(Morse)', type: 'number' },
          { id: 'fall_level', label: '낙상 위험도', type: 'select', options: ['저위험(0-24)','중위험(25-50)','고위험(51+)'] },
          { id: 'pressure_risk', label: '욕창 위험(Braden)', type: 'number' },
          { id: 'nutrition_risk', label: '영양 위험', type: 'select', options: ['저위험','고위험'] },
          { id: 'restraint', label: '억제대', type: 'select', options: ['미적용','적용'] },
        ]},
        { id: 's4', title: '간호 계획', fields: [
          { id: 'nursing_dx', label: '간호 진단', type: 'textarea' },
          { id: 'nursing_plan', label: '간호 계획', type: 'textarea' },
          { id: 'education', label: '환자/보호자 교육', type: 'textarea' },
        ]},
      ],
    },
  ];

  for (const t of chartTemplates) {
    await prisma.chartTemplate.upsert({
      where: { department_name_ownerId: { department: t.department, name: t.name, ownerId: chartAdminId } },
      update: { sections: t.sections, description: t.description, layout: t.layout },
      create: {
        name: t.name,
        department: t.department,
        role: t.role,
        category: t.category,
        layout: t.layout,
        description: t.description,
        sections: t.sections,
        isDefault: true,
        createdBy: chartAdminId,
      },
    });
  }

  console.log(`   - Chart templates: ${chartTemplates.length}`);

  // ============================================================
  // 트리아지 관리 (TriageSymptom, TriageRule, TriageAlias)
  // ============================================================
  console.log('  [Extra] Triage data...');

  const triageSymptoms: Array<{
    name: string; category: string; description: string;
    isEmergency: boolean; emergencyMsg?: string; sortOrder: number;
    rules: Array<{ dept: string; priority: number; confidence: number; reason: string }>;
    aliases: string[];
  }> = [
    // ── 흉부/심혈관 ──
    { name: '흉통', category: '흉부', description: '가슴 통증, 압박감, 조이는 느낌', isEmergency: true, emergencyMsg: '급성 관상동맥증후군/대동맥박리 감별 필요', sortOrder: 1,
      rules: [
        { dept: '순환기내과', priority: 1, confidence: 90, reason: '급성 심근경색, 불안정 협심증 감별' },
        { dept: '응급의학과', priority: 1, confidence: 85, reason: '응급 평가 필요' },
        { dept: '호흡기내과', priority: 2, confidence: 60, reason: '폐색전증, 기흉 감별' },
        { dept: '소화기내과', priority: 3, confidence: 40, reason: '식도 질환 감별 (GERD, 식도경련)' },
      ],
      aliases: ['가슴통증', '가슴 아파요', '가슴이 조여요', '흉부통증', '가슴 답답', '가슴 쥐어짜는 느낌', '심장 아파요', '가슴 누르는 느낌'] },
    { name: '호흡곤란', category: '흉부', description: '숨이 차거나 힘든 증상', isEmergency: true, emergencyMsg: '급성 호흡부전 감별 필요', sortOrder: 2,
      rules: [
        { dept: '호흡기내과', priority: 1, confidence: 85, reason: '천식, COPD 악화, 폐렴' },
        { dept: '순환기내과', priority: 1, confidence: 80, reason: '심부전, 폐부종' },
        { dept: '응급의학과', priority: 1, confidence: 85, reason: '응급 평가 필요' },
      ],
      aliases: ['숨이 차요', '숨쉬기 힘들어요', '호흡 곤란', '숨이 안 쉬어져요', '숨이 가빠요', '헉헉거려요', '숨막힘'] },
    { name: '두근거림', category: '흉부', description: '심장이 빨리 뛰거나 불규칙하게 뛰는 느낌', isEmergency: false, sortOrder: 3,
      rules: [
        { dept: '순환기내과', priority: 1, confidence: 85, reason: '부정맥, 심방세동 감별' },
        { dept: '내분비내과', priority: 2, confidence: 50, reason: '갑상선 기능항진증 감별' },
      ],
      aliases: ['심장이 빨리 뛰어요', '가슴이 두근두근', '심장 두근거림', '맥박이 빨라요', '심장이 쿵쾅쿵쾅'] },

    // ── 복부 ──
    { name: '복통', category: '복부', description: '배 아픔, 복부 통증', isEmergency: false, sortOrder: 10,
      rules: [
        { dept: '소화기내과', priority: 1, confidence: 80, reason: '위염, 궤양, 담석, 췌장염' },
        { dept: '일반외과', priority: 2, confidence: 70, reason: '충수염, 장폐색, 탈장' },
        { dept: '비뇨의학과', priority: 3, confidence: 40, reason: '요로결석 감별' },
        { dept: '산부인과', priority: 3, confidence: 35, reason: '여성 골반 질환 감별' },
      ],
      aliases: ['배아파요', '배가 아파요', '복부 통증', '뱃속이 아파', '배탈', '위가 아파요', '배꼽 주변 아파요', '옆구리 아파요'] },
    { name: '구토', category: '복부', description: '메스꺼움, 구역질, 토하는 증상', isEmergency: false, sortOrder: 11,
      rules: [
        { dept: '소화기내과', priority: 1, confidence: 75, reason: '위장관 질환' },
        { dept: '응급의학과', priority: 2, confidence: 50, reason: '장폐색, 두개내압 상승 감별' },
        { dept: '신경과', priority: 3, confidence: 30, reason: '중추성 구토 감별' },
      ],
      aliases: ['토해요', '구역질', '메스꺼워요', '오심', '속이 울렁거려요', '토할 것 같아요', '먹으면 토해요'] },
    { name: '설사', category: '복부', description: '묽은 변, 잦은 배변', isEmergency: false, sortOrder: 12,
      rules: [
        { dept: '소화기내과', priority: 1, confidence: 80, reason: '감염성/염증성 장질환' },
        { dept: '감염내과', priority: 2, confidence: 50, reason: '감염성 설사 (여행력, 항생제 관련)' },
      ],
      aliases: ['설사해요', '물설사', '묽은 변', '배변 횟수 많아요', '화장실을 자주 가요'] },
    { name: '혈변', category: '복부', description: '대변에 피가 섞이거나 검은 변', isEmergency: true, emergencyMsg: '위장관 출혈 감별 필요', sortOrder: 13,
      rules: [
        { dept: '소화기내과', priority: 1, confidence: 90, reason: '상부/하부 위장관 출혈' },
        { dept: '일반외과', priority: 2, confidence: 60, reason: '대장 종양, 치핵 출혈' },
        { dept: '응급의학과', priority: 1, confidence: 80, reason: '대량 출혈 시 응급 처치' },
      ],
      aliases: ['피가 섞인 변', '검은 변', '혈변이에요', '대변에 피', '흑색변', '피가 나와요(항문)'] },

    // ── 두부/신경 ──
    { name: '두통', category: '두부/신경', description: '머리 아픔, 편두통', isEmergency: false, sortOrder: 20,
      rules: [
        { dept: '신경과', priority: 1, confidence: 80, reason: '편두통, 긴장성 두통, 군발두통' },
        { dept: '신경외과', priority: 2, confidence: 40, reason: '지주막하출혈, 뇌종양 감별' },
        { dept: '안과', priority: 3, confidence: 20, reason: '녹내장 감별 (안압 상승)' },
      ],
      aliases: ['머리 아파요', '두통이에요', '편두통', '머리가 깨질 것 같아요', '머리가 지끈지끈', '뒷머리 아파요', '관자놀이 아파요'] },
    { name: '어지러움', category: '두부/신경', description: '현기증, 빙글빙글 도는 느낌', isEmergency: false, sortOrder: 21,
      rules: [
        { dept: '이비인후과', priority: 1, confidence: 70, reason: '이석증, 메니에르, 전정신경염' },
        { dept: '신경과', priority: 1, confidence: 65, reason: '중추성 어지럼증, 뇌혈관 질환' },
        { dept: '순환기내과', priority: 3, confidence: 30, reason: '기립성 저혈압, 부정맥' },
      ],
      aliases: ['어지러워요', '현기증', '빙글빙글', '핑 돌아요', '어질어질', '세상이 도는 느낌'] },
    { name: '의식 변화', category: '두부/신경', description: '의식 저하, 혼미, 혼수', isEmergency: true, emergencyMsg: '뇌졸중/두개내 출혈 즉시 감별 필요', sortOrder: 22,
      rules: [
        { dept: '응급의학과', priority: 1, confidence: 95, reason: '즉각적 응급 평가' },
        { dept: '신경과', priority: 1, confidence: 90, reason: '뇌졸중, 경련, 뇌수막염' },
        { dept: '신경외과', priority: 1, confidence: 80, reason: '두개내 출혈, 뇌부종' },
      ],
      aliases: ['의식이 없어요', '깨워도 안 일어나요', '정신을 잃었어요', '멍해요', '반응이 없어요', '의식 소실'] },
    { name: '경련', category: '두부/신경', description: '발작, 떨림, 경기', isEmergency: true, emergencyMsg: '간질 중첩증 감별 필요', sortOrder: 23,
      rules: [
        { dept: '응급의학과', priority: 1, confidence: 95, reason: '즉각적 응급 처치' },
        { dept: '신경과', priority: 1, confidence: 90, reason: '간질, 뇌전증 감별' },
        { dept: '소아청소년과', priority: 1, confidence: 85, reason: '소아 열성 경련' },
      ],
      aliases: ['경련해요', '경기했어요', '발작', '몸이 떨려요', '쓰러졌어요', '눈이 뒤집혔어요'] },

    // ── 근골격 ──
    { name: '요통', category: '근골격', description: '허리 통증, 요추 통증', isEmergency: false, sortOrder: 30,
      rules: [
        { dept: '정형외과', priority: 1, confidence: 75, reason: '디스크, 척추관 협착증' },
        { dept: '재활의학과', priority: 1, confidence: 70, reason: '근골격 재활 치료' },
        { dept: '신경외과', priority: 2, confidence: 55, reason: '수술적 치료 필요 시' },
        { dept: '비뇨의학과', priority: 3, confidence: 30, reason: '요로결석 감별' },
      ],
      aliases: ['허리 아파요', '허리통증', '요통', '허리가 끊어질 것 같아요', '허리 디스크', '허리를 못 펴요'] },
    { name: '관절통', category: '근골격', description: '관절 통증, 부종, 움직임 제한', isEmergency: false, sortOrder: 31,
      rules: [
        { dept: '정형외과', priority: 1, confidence: 75, reason: '퇴행성 관절염, 반월판 손상' },
        { dept: '류마티스내과', priority: 2, confidence: 60, reason: '류마티스 관절염, 통풍' },
        { dept: '재활의학과', priority: 2, confidence: 55, reason: '관절 재활' },
      ],
      aliases: ['관절이 아파요', '무릎 아파요', '어깨 아파요', '손목 아파요', '관절이 부었어요', '관절이 뻣뻣해요'] },
    { name: '골절 의심', category: '근골격', description: '외상 후 심한 통증, 변형, 부종', isEmergency: true, emergencyMsg: '개방성 골절/혈관 손상 즉시 확인', sortOrder: 32,
      rules: [
        { dept: '정형외과', priority: 1, confidence: 90, reason: '골절 진단 및 치료' },
        { dept: '응급의학과', priority: 1, confidence: 85, reason: '응급 고정 및 평가' },
      ],
      aliases: ['뼈가 부러진 것 같아요', '골절', '넘어져서 뼈가', '팔이 부러졌어요', '다리가 부러졌어요', '삐었어요'] },

    // ── 피부 ──
    { name: '발진', category: '피부', description: '피부 두드러기, 발진, 가려움', isEmergency: false, sortOrder: 40,
      rules: [
        { dept: '피부과', priority: 1, confidence: 80, reason: '피부 질환 진단' },
        { dept: '알레르기내과', priority: 2, confidence: 60, reason: '알레르기 반응 감별' },
      ],
      aliases: ['피부에 뭐가 났어요', '두드러기', '발진', '가려워요', '피부가 빨개요', '몸에 뭐가 올라왔어요'] },

    // ── 비뇨/생식 ──
    { name: '혈뇨', category: '비뇨생식', description: '소변에 피가 섞이는 증상', isEmergency: false, sortOrder: 50,
      rules: [
        { dept: '비뇨의학과', priority: 1, confidence: 85, reason: '요로결석, 방광암, 신장 질환' },
        { dept: '신장내과', priority: 2, confidence: 50, reason: '사구체신염 감별' },
      ],
      aliases: ['소변에 피', '혈뇨', '피오줌', '소변이 빨개요', '오줌에 피가 섞여요'] },
    { name: '배뇨장애', category: '비뇨생식', description: '소변 보기 힘듦, 빈뇨, 잔뇨감', isEmergency: false, sortOrder: 51,
      rules: [
        { dept: '비뇨의학과', priority: 1, confidence: 80, reason: '전립선비대증, 요로감염' },
        { dept: '산부인과', priority: 2, confidence: 40, reason: '여성 골반저질환 감별' },
      ],
      aliases: ['소변이 안 나와요', '소변을 자주 봐요', '빈뇨', '잔뇨감', '소변 볼 때 아파요', '소변 줄기가 가늘어요'] },

    // ── 소아 ──
    { name: '소아 발열', category: '소아', description: '소아 38℃ 이상 발열', isEmergency: false, sortOrder: 60,
      rules: [
        { dept: '소아청소년과', priority: 1, confidence: 90, reason: '소아 감염 질환 평가' },
        { dept: '응급의학과', priority: 2, confidence: 60, reason: '고열, 경련 동반 시' },
      ],
      aliases: ['아이가 열이 나요', '아기 열', '소아 열', '아이 고열', '아이가 뜨거워요', '열이 안 내려가요'] },
    { name: '소아 구토/설사', category: '소아', description: '소아 구토, 설사, 탈수 위험', isEmergency: false, sortOrder: 61,
      rules: [
        { dept: '소아청소년과', priority: 1, confidence: 90, reason: '탈수 평가, 장염 치료' },
      ],
      aliases: ['아이가 토해요', '아기 설사', '아이가 밥을 안 먹어요', '아이 구토', '아기가 계속 토해요'] },

    // ── 이비인후 ──
    { name: '인후통', category: '이비인후', description: '목 아픔, 삼키기 어려움', isEmergency: false, sortOrder: 70,
      rules: [
        { dept: '이비인후과', priority: 1, confidence: 75, reason: '편도염, 인두염, 후두염' },
        { dept: '내과', priority: 2, confidence: 60, reason: '상기도 감염' },
      ],
      aliases: ['목이 아파요', '목 아파요', '삼키기 힘들어요', '목이 부었어요', '편도가 부었어요'] },
    { name: '이통', category: '이비인후', description: '귀 통증, 이명, 청력 저하', isEmergency: false, sortOrder: 71,
      rules: [
        { dept: '이비인후과', priority: 1, confidence: 85, reason: '중이염, 외이도염, 돌발성 난청' },
      ],
      aliases: ['귀가 아파요', '귀에서 소리나요', '이명', '귀가 안 들려요', '귀에서 진물이 나와요'] },

    // ── 안과 ──
    { name: '시력 저하', category: '안과', description: '갑자기 안 보임, 시야 흐림', isEmergency: true, emergencyMsg: '망막 혈관 폐색/망막 박리 즉시 감별', sortOrder: 80,
      rules: [
        { dept: '안과', priority: 1, confidence: 95, reason: '망막 박리, 급성 녹내장, 혈관 폐색' },
        { dept: '응급의학과', priority: 1, confidence: 70, reason: '뇌졸중 동반 시야 장애' },
      ],
      aliases: ['눈이 안 보여요', '시력이 떨어졌어요', '갑자기 안 보여요', '눈앞이 흐려요', '눈에 커튼 친 것 같아요'] },
    { name: '안구 통증', category: '안과', description: '눈 아픔, 충혈, 눈물', isEmergency: false, sortOrder: 81,
      rules: [
        { dept: '안과', priority: 1, confidence: 85, reason: '결막염, 각막염, 녹내장' },
      ],
      aliases: ['눈이 아파요', '눈이 빨개요', '눈이 충혈됐어요', '눈에 뭐가 들어간 것 같아요', '눈물이 멈추지 않아요'] },

    // ── 정신건강 ──
    { name: '우울/불안', category: '정신건강', description: '우울감, 불안, 공황 증상', isEmergency: false, sortOrder: 90,
      rules: [
        { dept: '정신건강의학과', priority: 1, confidence: 85, reason: '우울증, 불안장애, 공황장애' },
      ],
      aliases: ['우울해요', '불안해요', '잠이 안 와요', '의욕이 없어요', '공황장애', '마음이 힘들어요', '죽고 싶어요'] },
    { name: '자해/자살 위험', category: '정신건강', description: '자해 행위, 자살 사고/시도', isEmergency: true, emergencyMsg: '정신건강 응급 — 즉각적 안전 평가 필요', sortOrder: 91,
      rules: [
        { dept: '정신건강의학과', priority: 1, confidence: 95, reason: '자살 위기 평가 및 개입' },
        { dept: '응급의학과', priority: 1, confidence: 90, reason: '응급 안전 조치' },
      ],
      aliases: ['자해했어요', '자살 시도', '죽고 싶다고 해요', '손목을 그었어요', '약을 많이 먹었어요'] },

    // ── 산부인과 ──
    { name: '임신 관련 증상', category: '산부인과', description: '임신 중 출혈, 복통, 진통', isEmergency: true, emergencyMsg: '태반 조기박리/자궁외임신 감별', sortOrder: 100,
      rules: [
        { dept: '산부인과', priority: 1, confidence: 95, reason: '임신 합병증 평가' },
        { dept: '응급의학과', priority: 1, confidence: 80, reason: '응급 분만/출혈 대비' },
      ],
      aliases: ['임신 중 출혈', '진통이 와요', '양수가 터졌어요', '임신 중 배 아파요', '태동이 안 느껴져요'] },

    // ── 발열/감염 ──
    { name: '발열', category: '감염/전신', description: '38℃ 이상 발열, 오한', isEmergency: false, sortOrder: 110,
      rules: [
        { dept: '감염내과', priority: 1, confidence: 70, reason: '원인 불명 발열, 패혈증' },
        { dept: '내과', priority: 1, confidence: 65, reason: '일반적 감염 평가' },
        { dept: '응급의학과', priority: 2, confidence: 50, reason: '고열 지속 시' },
      ],
      aliases: ['열이 나요', '고열', '오한', '몸이 떨려요', '춥고 열나요', '열이 안 떨어져요'] },

    // ── 외상 ──
    { name: '교통사고', category: '외상', description: '교통사고 후 다발성 외상', isEmergency: true, emergencyMsg: '다발성 외상 — 즉각적 평가 필요', sortOrder: 120,
      rules: [
        { dept: '응급의학과', priority: 1, confidence: 95, reason: '외상 초기 평가 (ATLS)' },
        { dept: '정형외과', priority: 2, confidence: 70, reason: '골절 평가' },
        { dept: '신경외과', priority: 2, confidence: 65, reason: '두부 외상 감별' },
        { dept: '일반외과', priority: 2, confidence: 60, reason: '복부/흉부 장기 손상 감별' },
      ],
      aliases: ['교통사고', '차 사고', '사고 났어요', '차에 부딪혔어요', '오토바이 사고'] },
    { name: '낙상', category: '외상', description: '넘어짐, 추락 외상', isEmergency: false, sortOrder: 121,
      rules: [
        { dept: '응급의학과', priority: 1, confidence: 75, reason: '외상 평가' },
        { dept: '정형외과', priority: 1, confidence: 75, reason: '골절 감별' },
        { dept: '신경외과', priority: 2, confidence: 50, reason: '두부 외상 시' },
      ],
      aliases: ['넘어졌어요', '떨어졌어요', '추락', '계단에서 넘어짐', '미끄러져서 넘어짐'] },
  ];

  let symptomCount = 0;
  let ruleCount = 0;
  let aliasCount = 0;
  for (const sym of triageSymptoms) {
    const symptom = await prisma.triageSymptom.upsert({
      where: { name: sym.name },
      update: { category: sym.category, description: sym.description, isEmergency: sym.isEmergency, emergencyMsg: sym.emergencyMsg ?? null, sortOrder: sym.sortOrder },
      create: { name: sym.name, category: sym.category, description: sym.description, isEmergency: sym.isEmergency, emergencyMsg: sym.emergencyMsg ?? null, sortOrder: sym.sortOrder },
    });
    symptomCount++;

    for (const rule of sym.rules) {
      await prisma.triageRule.upsert({
        where: { symptomId_departmentName: { symptomId: symptom.id, departmentName: rule.dept } },
        update: { priority: rule.priority, confidence: rule.confidence, reason: rule.reason },
        create: { symptomId: symptom.id, departmentName: rule.dept, priority: rule.priority, confidence: rule.confidence, reason: rule.reason, createdBy: adminId },
      });
      ruleCount++;
    }

    for (const alias of sym.aliases) {
      await prisma.triageAlias.upsert({
        where: { alias },
        update: { symptomId: symptom.id },
        create: { symptomId: symptom.id, alias },
      });
      aliasCount++;
    }
  }
  console.log(`     → 트리아지: ${symptomCount}개 증상, ${ruleCount}개 규칙, ${aliasCount}개 별칭`);

  // ============================================================
  // 추가 시딩: 운영 모듈 데이터 (Appointment, Admission, Billing, Surgery, Emergency, Pharmacy, Nutrition, etc.)
  // ============================================================
  console.log('  [Extra] Operational module data...');

  const leeOegwaId = uid(P.USER, 4);
  const choiOegwaId = uid(P.USER, 5);
  const kangEunggupId = uid(P.USER, 9);
  const nurseChoId = uid(P.USER, 10);
  const nurseYoonId = uid(P.USER, 11);
  const nurseHwangId = uid(P.USER, 12);
  const pharmacistId = uid(P.USER, 14);
  const wonmuId = uid(P.USER, 16);
  const nutritionId = uid(P.USER, 18);

  // ── 예약 (Appointment) ──
  const appointments = [
    { i: 1, patientIdx: 1, doctorIdx: 2, days: 1, type: 'FOLLOW_UP', dept: '내과' },
    { i: 2, patientIdx: 3, doctorIdx: 4, days: 2, type: 'INITIAL', dept: '외과' },
    { i: 3, patientIdx: 5, doctorIdx: 2, days: 3, type: 'FOLLOW_UP', dept: '내과' },
    { i: 4, patientIdx: 8, doctorIdx: 6, days: 1, type: 'INITIAL', dept: '소아청소년과' },
    { i: 5, patientIdx: 10, doctorIdx: 7, days: 4, type: 'INITIAL', dept: '산부인과' },
    { i: 6, patientIdx: 14, doctorIdx: 8, days: 2, type: 'FOLLOW_UP', dept: '정형외과' },
    { i: 7, patientIdx: 22, doctorIdx: 3, days: 5, type: 'FOLLOW_UP', dept: '내과' },
    { i: 8, patientIdx: 7, doctorIdx: 4, days: 3, type: 'URGENT', dept: '외과' },
  ];
  for (const a of appointments) {
    const apptId = makeUuid('a0010000', a.i);
    const schedDate = new Date();
    schedDate.setDate(schedDate.getDate() + a.days);
    schedDate.setHours(9 + a.i, 0, 0, 0);
    await prisma.appointment.upsert({
      where: { id: apptId }, update: {},
      create: {
        id: apptId, patientId: uid(P.PATIENT, a.patientIdx),
        doctorId: uid(P.USER, a.doctorIdx), scheduledAt: schedDate,
        duration: 30, status: 'SCHEDULED', type: a.type as any,
        createdBy: adminId,
      },
    });
  }
  console.log(`     → ${appointments.length} appointments seeded`);

  // ── 입원 (Admission) ──
  const admissionData: Array<{i: number; patientIdx: number; bedIdx: number; doctorIdx: number; reason: string; daysAgo: number}> = [
    { i: 1, patientIdx: 1, bedIdx: 1, doctorIdx: 2, reason: '고혈압 급성 악화 + 심부전 관리', daysAgo: 5 },
    { i: 2, patientIdx: 7, bedIdx: 11, doctorIdx: 4, reason: '담낭절제술 예정 (담석증)', daysAgo: 3 },
    { i: 3, patientIdx: 4, bedIdx: 3, doctorIdx: 2, reason: '폐렴 치료 (고령, 의료급여)', daysAgo: 7 },
    { i: 4, patientIdx: 11, bedIdx: 13, doctorIdx: 8, reason: '대퇴골 골절 수술 후 재활', daysAgo: 10 },
    { i: 5, patientIdx: 19, bedIdx: 5, doctorIdx: 2, reason: '만성신부전 악화 + 전해질 이상', daysAgo: 4 },
  ];
  for (const adm of admissionData) {
    const admId = makeUuid('ad010000', adm.i);
    const admitDate = new Date();
    admitDate.setDate(admitDate.getDate() - adm.daysAgo);
    const patId = uid(P.PATIENT, adm.patientIdx);
    const bedUid = uid(P.BED, adm.bedIdx);
    const docId = uid(P.USER, adm.doctorIdx);
    await prisma.admission.upsert({
      where: { id: admId }, update: {},
      create: {
        id: admId, patientId: patId,
        bedId: bedUid, admittingDoctorId: docId, attendingDoctorId: docId,
        admitDate, status: 'ADMITTED', admitReason: adm.reason,
      },
    });
    // 병상 상태 업데이트
    await prisma.bed.update({ where: { id: bedUid }, data: { status: 'OCCUPIED' } });
  }
  console.log(`     → ${admissionData.length} admissions seeded`);

  // ── 경과기록 (ProgressNote) ──
  const progressNotes = [
    { i: 1, admIdx: 1, doctorIdx: 2, daysAgo: 4, content: 'BP 150/90 → 130/80으로 호전. Lasix 20mg IV → PO 전환 예정. 폐수종 감소 확인.' },
    { i: 2, admIdx: 1, doctorIdx: 2, daysAgo: 2, content: 'BP 125/78 안정. BNP 800→450 감소. 이뇨제 PO 유지. 내일 퇴원 가능 평가.' },
    { i: 3, admIdx: 3, doctorIdx: 2, daysAgo: 5, content: 'CRP 12→8 감소. 항생제 3일째 (Ceftriaxone 2g). 산소 3L 유지. 전신 상태 호전.' },
    { i: 4, admIdx: 3, doctorIdx: 2, daysAgo: 2, content: 'CRP 3.5. 발열 소실 48시간. 항생제 PO 전환 (Augmentin). 산소 OFF.' },
    { i: 5, admIdx: 4, doctorIdx: 8, daysAgo: 7, content: '수술 후 3일. 수술부위 깨끗. NRS 4/10. 조기 보행 시작. PT 의뢰.' },
    { i: 6, admIdx: 5, doctorIdx: 2, daysAgo: 2, content: 'Cr 3.8→3.2 호전. K 5.4→4.8 교정. 수액 조절. 영양과 협진.' },
  ];
  for (const pn of progressNotes) {
    const pnId = makeUuid('90010000', pn.i);
    const noteDate = new Date();
    noteDate.setDate(noteDate.getDate() - pn.daysAgo);
    await prisma.progressNote.upsert({
      where: { id: pnId }, update: {},
      create: {
        id: pnId, admissionId: makeUuid('ad010000', pn.admIdx),
        doctorId: uid(P.USER, pn.doctorIdx), noteDate, content: pn.content,
      },
    });
  }
  console.log(`     → ${progressNotes.length} progress notes seeded`);

  // ── 간호 사정 (NursingAssessment) ──
  try {
    const nursingAssessments = [
      { i: 1, admIdx: 1, nurseIdx: 5, consciousness: 'ALERT', mobility: 'AMBULATORY', painScore: 2, nutritionStatus: 'ADEQUATE', skinIntegrity: 'INTACT', bradenScore: 20 },
      { i: 2, admIdx: 2, nurseIdx: 6, consciousness: 'ALERT', mobility: 'BED_REST', painScore: 5, nutritionStatus: 'ADEQUATE', skinIntegrity: 'INTACT', bradenScore: 16 },
      { i: 3, admIdx: 3, nurseIdx: 5, consciousness: 'ALERT', mobility: 'AMBULATORY', painScore: 3, nutritionStatus: 'POOR', skinIntegrity: 'INTACT', bradenScore: 18 },
      { i: 4, admIdx: 4, nurseIdx: 6, consciousness: 'ALERT', mobility: 'BED_REST', painScore: 6, nutritionStatus: 'ADEQUATE', skinIntegrity: 'AT_RISK', bradenScore: 14 },
      { i: 5, admIdx: 5, nurseIdx: 5, consciousness: 'ALERT', mobility: 'AMBULATORY', painScore: 1, nutritionStatus: 'POOR', skinIntegrity: 'INTACT', bradenScore: 19 },
    ];
    for (const na of nursingAssessments) {
      const naId = makeUuid('na010000', na.i);
      await prisma.nursingAssessment.upsert({
        where: { id: naId }, update: {},
        create: {
          id: naId, admissionId: makeUuid('ad010000', na.admIdx),
          nurseId: uid(P.USER, na.nurseIdx),
          consciousness: na.consciousness, mobility: na.mobility,
          painScore: na.painScore, nutritionStatus: na.nutritionStatus,
          skinIntegrity: na.skinIntegrity, bradenScore: na.bradenScore,
          allergyConfirmed: true, assessedAt: new Date(),
        },
      });
    }
    console.log(`     → ${nursingAssessments.length} nursing assessments seeded`);
  } catch (e: any) { console.warn(`     ⚠️ nursing assessments skipped: ${e.message?.slice(0, 100)}`); }

  // ── 간호 기록 (NursingNote) ──
  try {
    const nursingNotes = [
      // 김영수 (심부전)
      { i:1, admIdx:1, nurseIdx:5, daysAgo:4, shift:'DAY', focus:'호흡곤란', data:'앉은 자세에서 호흡 곤란 호소, SpO2 93%', action:'반좌위 유지, O2 3L 적용, 의사 보고', response:'SpO2 97%로 호전, 호흡 안정' },
      { i:2, admIdx:1, nurseIdx:6, daysAgo:3, shift:'EVENING', focus:'혈압 관리', data:'BP 145/92, 두통 호소', action:'처방 약물 투여 (Amlodipine 10mg)', response:'1시간 후 BP 128/82, 두통 소실' },
      { i:3, admIdx:1, nurseIdx:5, daysAgo:1, shift:'DAY', focus:'퇴원 교육', data:'퇴원 예정, 자가 관리 교육 필요', action:'혈압 측정법, 복약 순응도 교육', response:'환자 이해함, 보호자 동행 확인' },
      // 오대한 (수술 후)
      { i:4, admIdx:2, nurseIdx:6, daysAgo:2, shift:'DAY', focus:'수술 부위 통증', data:'NRS 5/10, 찡그린 표정, 체위 변경 시 악화', action:'케토롤락 30mg IV 투여, 체위 변경 보조', response:'30분 후 NRS 3/10, 표정 편안' },
      { i:5, admIdx:2, nurseIdx:5, daysAgo:2, shift:'EVENING', focus:'드레인 관리', data:'JP drain 150mL/8h, 담즙색 배액', action:'배액량/색 기록, 드레인 고정 확인', response:'정상 범위, 지속 관찰' },
      { i:6, admIdx:2, nurseIdx:6, daysAgo:1, shift:'DAY', focus:'조기 이동', data:'수술 후 1일, 침대 옆 앉기 시도', action:'보행기 이용 보조, 어지러움 관찰', response:'5분 앉기 성공, 어지러움 없음' },
      // 최순자 (폐렴)
      { i:7, admIdx:3, nurseIdx:5, daysAgo:6, shift:'DAY', focus:'발열 관리', data:'BT 38.8℃, 오한, 기침 증가', action:'혈액배양 채혈, 해열제 투여, 수액 증량', response:'2시간 후 BT 37.8℃, 오한 감소' },
      { i:8, admIdx:3, nurseIdx:6, daysAgo:4, shift:'DAY', focus:'산소 요법', data:'SpO2 92% (room air), 활동 시 악화', action:'O2 3L/min nasal cannula 적용', response:'SpO2 96% 유지' },
      { i:9, admIdx:3, nurseIdx:5, daysAgo:1, shift:'DAY', focus:'호전 평가', data:'발열 48시간 소실, CRP 3.5 감소', action:'산소 중단 trial, 활동량 증가 격려', response:'SpO2 95% (room air), 활동 양호' },
      // 서준혁 (골절)
      { i:10, admIdx:4, nurseIdx:6, daysAgo:8, shift:'DAY', focus:'수술 후 통증', data:'NRS 7/10, 수술 부위 부종', action:'PCA 조절, 냉찜질 적용, 하지 거상', response:'NRS 4/10으로 감소' },
      { i:11, admIdx:4, nurseIdx:5, daysAgo:5, shift:'DAY', focus:'재활 운동', data:'PT 의뢰, 관절 운동 시작', action:'ROM 운동 보조, 통증 관찰', response:'관절 운동 50% 달성' },
      { i:12, admIdx:4, nurseIdx:6, daysAgo:2, shift:'DAY', focus:'보행 훈련', data:'워커 이용 보행 시도', action:'보행 보조, 낙상 예방 교육', response:'10m 보행 성공, 안정적' },
      // 송민석 (신부전)
      { i:13, admIdx:5, nurseIdx:5, daysAgo:3, shift:'DAY', focus:'전해질 관리', data:'K+ 5.8, 심전도 이상 없음', action:'칼륨 제한식, Kayexalate 투여', response:'다음 날 K+ 5.0으로 감소' },
      { i:14, admIdx:5, nurseIdx:6, daysAgo:2, shift:'EVENING', focus:'체중 관리', data:'체중 72kg (+1.5kg/2일), 하지 부종', action:'수액 제한 1L/day, 이뇨제 투여, 체중 매일 측정', response:'다음 날 71.2kg, 부종 감소' },
      { i:15, admIdx:5, nurseIdx:5, daysAgo:1, shift:'DAY', focus:'식이 교육', data:'저염식/저칼륨식 이해도 확인', action:'영양사 협진, 식단표 제공', response:'환자 이해, 가족 교육 완료' },
    ];
    for (const nn of nursingNotes) {
      const nnId = makeUuid('nn010000', nn.i);
      const recordedAt = new Date();
      recordedAt.setDate(recordedAt.getDate() - nn.daysAgo);
      if (nn.shift === 'EVENING') recordedAt.setHours(14, 0, 0, 0);
      else if (nn.shift === 'NIGHT') recordedAt.setHours(22, 0, 0, 0);
      else recordedAt.setHours(9, 0, 0, 0);
      await prisma.nursingNote.upsert({
        where: { id: nnId }, update: {},
        create: {
          id: nnId, admissionId: makeUuid('ad010000', nn.admIdx),
          nurseId: uid(P.USER, nn.nurseIdx), noteType: 'FOCUS',
          shiftType: nn.shift as any, focus: nn.focus,
          data: nn.data, action: nn.action, response: nn.response,
          recordedAt,
        },
      });
    }
    console.log(`     → ${nursingNotes.length} nursing notes seeded`);
  } catch (e: any) { console.warn(`     ⚠️ nursing notes skipped: ${e.message?.slice(0, 100)}`); }

  // ── 섭취/배설량 (IntakeOutput) ──
  try {
    const intakeOutputs: Array<{i:number; admIdx:number; nurseIdx:number; daysAgo:number; hour:number; intakeType:string; intakeAmount:number; intakeDetail:string; outputType:string; outputAmount:number; outputDetail:string}> = [
      // 김영수 (심부전 — 수액 제한)
      { i:1, admIdx:1, nurseIdx:5, daysAgo:2, hour:6, intakeType:'IV', intakeAmount:500, intakeDetail:'N/S 500mL', outputType:'URINE', outputAmount:400, outputDetail:'자연 배뇨' },
      { i:2, admIdx:1, nurseIdx:6, daysAgo:2, hour:12, intakeType:'ORAL', intakeAmount:300, intakeDetail:'식사+물', outputType:'URINE', outputAmount:350, outputDetail:'자연 배뇨' },
      { i:3, admIdx:1, nurseIdx:5, daysAgo:1, hour:6, intakeType:'IV', intakeAmount:500, intakeDetail:'N/S 500mL', outputType:'URINE', outputAmount:600, outputDetail:'이뇨제 효과' },
      { i:4, admIdx:1, nurseIdx:6, daysAgo:1, hour:12, intakeType:'ORAL', intakeAmount:250, intakeDetail:'식사', outputType:'URINE', outputAmount:450, outputDetail:'자연 배뇨' },
      // 오대한 (수술 후)
      { i:5, admIdx:2, nurseIdx:6, daysAgo:2, hour:6, intakeType:'IV', intakeAmount:1000, intakeDetail:'H/S 1000mL', outputType:'URINE', outputAmount:300, outputDetail:'Foley' },
      { i:6, admIdx:2, nurseIdx:5, daysAgo:2, hour:14, intakeType:'IV', intakeAmount:200, intakeDetail:'항생제 혼합', outputType:'DRAIN', outputAmount:150, outputDetail:'JP drain' },
      { i:7, admIdx:2, nurseIdx:6, daysAgo:1, hour:6, intakeType:'IV', intakeAmount:500, intakeDetail:'D5W 500mL', outputType:'URINE', outputAmount:500, outputDetail:'Foley' },
      { i:8, admIdx:2, nurseIdx:5, daysAgo:1, hour:12, intakeType:'ORAL', intakeAmount:400, intakeDetail:'미음+물', outputType:'DRAIN', outputAmount:80, outputDetail:'JP drain 감소' },
      // 최순자 (폐렴)
      { i:9, admIdx:3, nurseIdx:5, daysAgo:3, hour:6, intakeType:'IV', intakeAmount:1000, intakeDetail:'N/S 1000mL', outputType:'URINE', outputAmount:500, outputDetail:'자연 배뇨' },
      { i:10, admIdx:3, nurseIdx:6, daysAgo:3, hour:14, intakeType:'ORAL', intakeAmount:200, intakeDetail:'물', outputType:'URINE', outputAmount:400, outputDetail:'자연 배뇨' },
      { i:11, admIdx:3, nurseIdx:5, daysAgo:1, hour:6, intakeType:'IV', intakeAmount:500, intakeDetail:'N/S 500mL', outputType:'URINE', outputAmount:600, outputDetail:'자연 배뇨' },
      { i:12, admIdx:3, nurseIdx:6, daysAgo:1, hour:12, intakeType:'ORAL', intakeAmount:500, intakeDetail:'식사+물', outputType:'URINE', outputAmount:500, outputDetail:'자연 배뇨' },
      // 서준혁 (골절)
      { i:13, admIdx:4, nurseIdx:6, daysAgo:3, hour:6, intakeType:'IV', intakeAmount:1000, intakeDetail:'H/S 1000mL', outputType:'URINE', outputAmount:400, outputDetail:'소변기' },
      { i:14, admIdx:4, nurseIdx:5, daysAgo:3, hour:14, intakeType:'ORAL', intakeAmount:300, intakeDetail:'식사', outputType:'URINE', outputAmount:350, outputDetail:'소변기' },
      { i:15, admIdx:4, nurseIdx:6, daysAgo:1, hour:6, intakeType:'ORAL', intakeAmount:500, intakeDetail:'식사+물', outputType:'URINE', outputAmount:500, outputDetail:'화장실 보행' },
      { i:16, admIdx:4, nurseIdx:5, daysAgo:1, hour:14, intakeType:'ORAL', intakeAmount:400, intakeDetail:'식사+물', outputType:'URINE', outputAmount:450, outputDetail:'화장실 보행' },
      // 송민석 (신부전 — 수액 제한)
      { i:17, admIdx:5, nurseIdx:5, daysAgo:2, hour:6, intakeType:'IV', intakeAmount:300, intakeDetail:'N/S 300mL (제한)', outputType:'URINE', outputAmount:200, outputDetail:'감소' },
      { i:18, admIdx:5, nurseIdx:6, daysAgo:2, hour:12, intakeType:'ORAL', intakeAmount:200, intakeDetail:'물 제한', outputType:'URINE', outputAmount:150, outputDetail:'핍뇨' },
      { i:19, admIdx:5, nurseIdx:5, daysAgo:1, hour:6, intakeType:'IV', intakeAmount:300, intakeDetail:'N/S 300mL (제한)', outputType:'URINE', outputAmount:300, outputDetail:'이뇨제 효과' },
      { i:20, admIdx:5, nurseIdx:6, daysAgo:1, hour:12, intakeType:'ORAL', intakeAmount:200, intakeDetail:'물 제한', outputType:'URINE', outputAmount:250, outputDetail:'호전' },
    ];
    for (const io of intakeOutputs) {
      const ioId = makeUuid('io010000', io.i);
      const recordedAt = new Date();
      recordedAt.setDate(recordedAt.getDate() - io.daysAgo);
      recordedAt.setHours(io.hour, 0, 0, 0);
      await prisma.intakeOutput.upsert({
        where: { id: ioId }, update: {},
        create: {
          id: ioId, admissionId: makeUuid('ad010000', io.admIdx),
          nurseId: uid(P.USER, io.nurseIdx), recordedAt,
          intakeType: io.intakeType as any, intakeAmount: io.intakeAmount, intakeDetail: io.intakeDetail,
          outputType: io.outputType as any, outputAmount: io.outputAmount, outputDetail: io.outputDetail,
        },
      });
    }
    console.log(`     → ${intakeOutputs.length} intake/output records seeded`);
  } catch (e: any) { console.warn(`     ⚠️ intake/output skipped: ${e.message?.slice(0, 100)}`); }

  // ── 추가 경과기록 (ProgressNote) ──
  try {
    const extraProgressNotes = [
      { i:7, admIdx:1, doctorIdx:2, daysAgo:3, content: 'S: 호흡 곤란 호전, 야간 기좌호흡 소실\nO: BP 130/80, HR 72, SpO2 97%, 폐수종 감소, BNP 600\nA: 심부전 호전, 이뇨제 반응 양호\nP: Furosemide PO 전환, 체중 매일 측정' },
      { i:8, admIdx:2, doctorIdx:4, daysAgo:2, content: 'S: 수술 부위 통증 NRS 3/10, 식사 시작\nO: V/S stable, 수술 부위 깨끗, WBC 8.2, drain 80mL/day\nA: 수술 후 경과 양호, 감염 소견 없음\nP: 드레인 내일 제거 예정, 경구 항생제 전환' },
      { i:9, admIdx:2, doctorIdx:4, daysAgo:1, content: 'S: 통증 호전 NRS 2/10, 보행 가능\nO: 드레인 제거, 수술 부위 clean, afebrile\nA: 퇴원 가능\nP: 내일 퇴원, 외래 1주 후 F/U' },
      { i:10, admIdx:3, doctorIdx:2, daysAgo:6, content: 'S: 기침, 객담 증가, 발열 38.5℃\nO: CRP 12, WBC 15,000, Chest PA: RLL infiltration\nA: Community-acquired pneumonia\nP: Ceftriaxone 2g IV q24h, O2 3L, 객담 배양' },
      { i:11, admIdx:3, doctorIdx:2, daysAgo:3, content: 'S: 기침 감소, 발열 소실\nO: CRP 5.2, WBC 9,800, 객담 감소\nA: 항생제 반응 양호\nP: 항생제 5일 유지 후 경구 전환 평가' },
      { i:12, admIdx:4, doctorIdx:8, daysAgo:9, content: 'S: 수술 후 1일, 통증 NRS 6/10\nO: V/S stable, 수술부위 drain 200mL, Hb 10.2\nA: 수술 후 정상 경과\nP: PCA 유지, DVT 예방, PT 내일 시작' },
      { i:13, admIdx:4, doctorIdx:8, daysAgo:5, content: 'S: 통증 감소 NRS 3/10, 침대 이동 가능\nO: drain 제거, Hb 11.0, X-ray 정렬 양호\nA: 골유합 진행 중\nP: 체중 부하 30% 시작, PT 강화' },
      { i:14, admIdx:4, doctorIdx:8, daysAgo:1, content: 'S: 워커 보행 10m 성공, 통증 NRS 2/10\nO: ROM 90도, 상처 치유 양호\nA: 재활 진행 양호\nP: 워커 보행 계속, 퇴원 1주 내 목표' },
      { i:15, admIdx:5, doctorIdx:2, daysAgo:3, content: 'S: 구역감, 식욕 부진\nO: Cr 3.8, K 5.8, BUN 68, pH 7.32\nA: CKD 악화 + 대사산증 + 고칼륨혈증\nP: Kayexalate, NaHCO3 보충, 수액 제한 1L' },
      { i:16, admIdx:5, doctorIdx:2, daysAgo:1, content: 'S: 구역감 호전, 식사 소량 가능\nO: Cr 3.2, K 4.8, BUN 52, pH 7.36\nA: 전해질 교정 중, 호전\nP: 저염식/저칼륨식 유지, 신장내과 외래 예약' },
    ];
    for (const pn of extraProgressNotes) {
      const pnId = makeUuid('90010000', pn.i);
      const noteDate = new Date();
      noteDate.setDate(noteDate.getDate() - pn.daysAgo);
      await prisma.progressNote.upsert({
        where: { id: pnId }, update: {},
        create: {
          id: pnId, admissionId: makeUuid('ad010000', pn.admIdx),
          doctorId: uid(P.USER, pn.doctorIdx), noteDate, content: pn.content,
        },
      });
    }
    console.log(`     → ${extraProgressNotes.length} extra progress notes seeded`);
  } catch (e: any) { console.warn(`     ⚠️ extra progress notes skipped: ${e.message?.slice(0, 100)}`); }

  // ── 수납 (Billing) ──
  /**
   * 🔴 수납 라인은 **수가 마스터의 행을 가리킨다**(2026-09-21 · 형제 프로젝트 인바운드 §24 실호출).
   *    종전 시드는 `codeType: 'DIAGNOSIS'` · `codeId` 에 **진료 UUID** 를 넣었다. ERP 정산 경로
   *    (`billing.service.ts buildLines`)는 `codeId` 를 수가·약가 마스터에서 풀어 EDI 코드를 실어보내는데,
   *    풀리지 않으면 UUID 를 그대로 보낸다 — 새 설치본에서 시드 수납 6건이 **ERP 에서 전량 거부**됐다
   *    ("code 가 EDI 문자열이 아님"). 시드로 시험하는 기관은 ERP 연동이 안 되는 것처럼 본다.
   *
   * 🔴 금액을 지어내지 않는다 — 라인 금액은 **마스터 단가 × 수량**에서 나오고, 청구 총액 · 보험부담 ·
   *    본인부담은 **라인에서 파생**한다. 종전의 85,000 · 120,000 같은 어림수는 어디서도 나오지 않는 값이었고,
   *    불변식 31("청구 총액 ≠ 라인 합계")을 시드가 스스로 지키게 하려면 파생이어야 한다.
   *    본인부담 = 급여 라인은 `copayRate`, **비급여 라인은 전액**(insuranceCovered=false).
   */
  const billingPlans: { i: number; patientIdx: number; encIdx: number; copayCategory?: string; lines: { code: string; qty: number }[] }[] = [
    // 외래 초진 + 기본 검사 + 흉부 X-ray
    { i: 1, patientIdx: 1, encIdx: 1, lines: [{ code: 'AA154', qty: 1 }, { code: 'E6541', qty: 1 }, { code: 'HA011', qty: 1 }] },
    // 재진 + 만성질환 추적 검사
    { i: 2, patientIdx: 2, encIdx: 2, lines: [{ code: 'AA254', qty: 1 }, { code: 'E6561', qty: 1 }, { code: 'E6551', qty: 1 }, { code: 'E6591', qty: 1 }] },
    // 재진 + 처치
    { i: 3, patientIdx: 3, encIdx: 3, lines: [{ code: 'AA254', qty: 1 }, { code: 'M0121', qty: 1 }, { code: 'M0141', qty: 1 }] },
    // 초진 + 복부 초음파
    { i: 4, patientIdx: 5, encIdx: 5, lines: [{ code: 'AA154', qty: 1 }, { code: 'HG101', qty: 1 }] },
    // 🔴 비급여만으로 구성된 수납 — 보험부담 0 · 전액 본인부담(종전 시드가 어림수로 표현하던 사례를 코드로)
    { i: 5, patientIdx: 9, encIdx: 9, lines: [{ code: 'MM201', qty: 2 }, { code: 'MM301', qty: 1 }] },
    // 🔴 의료급여 1종 — 본인부담 없음. 라인 자체는 급여 수가이고 **자격**이 본인부담을 0 으로 만든다
    //    (CLAUDE.md §본인부담: 수치 비교가 아니라 자격의 성격으로 가른다)
    { i: 6, patientIdx: 4, encIdx: 4, copayCategory: 'MA_TYPE1', lines: [{ code: 'AA254', qty: 1 }, { code: 'M0151', qty: 1 }, { code: 'E6512', qty: 1 }] },
  ];
  /** 수가 마스터 조회 — 시드가 넣은 버전(validFrom 최신)을 쓴다. 없으면 그 라인은 건너뛰고 **말한다**(조용히 0 원으로 만들지 않는다) */
  const feeCodes = [...new Set(billingPlans.flatMap((p) => p.lines.map((l) => l.code)))];
  const feeRows = await prisma.procedureCode.findMany({
    where: { code: { in: feeCodes } },
    orderBy: { validFrom: 'desc' },
    select: { id: true, code: true, nameKo: true, unitPrice: true, copayRate: true, insuranceCovered: true },
  });
  const feeByCode = new Map<string, (typeof feeRows)[number]>();
  for (const r of feeRows) if (!feeByCode.has(r.code)) feeByCode.set(r.code, r); // validFrom 최신 1건
  const missingFee = feeCodes.filter((c) => !feeByCode.has(c));
  if (missingFee.length) console.warn(`     ⚠️ 수납 시드: 수가 마스터에 없는 코드 ${missingFee.join(', ')} — 해당 라인 제외`);

  /** 파생 결과 — 보험청구(Claim) 가 같은 값을 쓴다(정본 하나) */
  const billingTotals = new Map<number, { total: number; insurance: number; copay: number }>();
  let billingCount = 0;
  for (const b of billingPlans) {
    const lines = b.lines
      .map((l) => ({ ...l, fee: feeByCode.get(l.code) }))
      .filter((l): l is typeof l & { fee: NonNullable<typeof l.fee> } => !!l.fee)
      .map((l) => {
        const unitPrice = Number(l.fee.unitPrice);
        const amount = unitPrice * l.qty;
        const covered = l.fee.insuranceCovered !== false;
        const rate = covered ? Number(l.fee.copayRate ?? 0) : 1;
        return { ...l, unitPrice, amount, covered, rate, copay: Math.round(amount * rate) };
      });
    if (!lines.length) continue;
    const total = lines.reduce((s, l) => s + l.amount, 0);
    // 의료급여 1종은 본인부담 없음 — 자격이 라인 요율을 이긴다
    const copay = b.copayCategory === 'MA_TYPE1' ? 0 : lines.reduce((s, l) => s + l.copay, 0);
    const insurance = total - copay;
    billingTotals.set(b.i, { total, insurance, copay });

    const billId = makeUuid('b1110000', b.i);
    const encounterId = makeUuid('e0c00000', b.encIdx);
    const paid = b.i <= 3;
    await prisma.billing.upsert({
      where: { encounterId }, update: {},
      create: {
        id: billId, encounterId, patientId: uid(P.PATIENT, b.patientIdx),
        totalAmount: total, insuranceCovered: insurance, patientCopay: copay,
        copayCategory: b.copayCategory ?? null,
        status: paid ? 'PAID' : 'PENDING',
        paidAt: paid ? new Date() : null, paidAmount: paid ? copay : null,
      },
    });
    // 🔴 종전 시드가 남긴 잘못된 단일 라인(codeType='DIAGNOSIS' · codeId=진료 UUID)을 먼저 치운다 —
    //    옛 데모 DB 에 새 라인만 얹으면 같은 수납에 두 체계가 섞여 불변식 31(총액≠라인 합계)이 깨진다.
    await prisma.billingItem.deleteMany({ where: { id: makeUuid('b1120000', b.i), codeType: 'DIAGNOSIS' } });
    // BillingItem — 라인마다 수가 코드 1행(`codeId` = 수가 마스터 행 id → ERP 가 EDI 코드로 푼다)
    for (let li = 0; li < lines.length; li++) {
      const l = lines[li];
      const biId = makeUuid('b1120000', b.i * 10 + li); // 라인별 결정적 UUID(같은 행을 두 번 만들지 않는다)
      await prisma.billingItem.upsert({
        where: { id: biId }, update: {},
        create: {
          id: biId, billingId: billId, codeType: 'PROCEDURE',
          codeId: l.fee.id, codeName: l.fee.nameKo,
          quantity: l.qty, unitPrice: l.unitPrice, amount: l.amount,
          copayRate: l.rate,
          insuranceCategory: l.covered ? 'COVERED' : 'NON_COVERED',
        },
      });
    }
    // 🔴 라인을 다시 썼으면 총액도 라인에서 온다(파생값은 원자료에서 — 옛 어림수가 남으면 불변식 31 이 깨진다).
    //    대상은 이 시드가 만든 결정적 UUID 6건뿐이다.
    await prisma.billing.updateMany({
      where: { id: billId, OR: [{ totalAmount: { not: total } }, { insuranceCovered: { not: insurance } }, { patientCopay: { not: copay } }] },
      data: { totalAmount: total, insuranceCovered: insurance, patientCopay: copay, ...(paid ? { paidAmount: copay } : {}) },
    });
    billingCount++;
  }
  console.log(`     → ${billingCount} billings seeded (수가 코드 연결 · 총액=라인 합계 파생)`);

  // ── 보험청구 (Claim) ──
  // 🔴 청구액은 그 수납의 **보험부담액에서 나온다**(어림수를 다시 적지 않는다 — 한쪽만 고치면 갈라진다)
  const claims = [1, 2, 3]
    .filter((i) => billingTotals.has(i))
    .map((i) => ({ i, billingIdx: i, patientIdx: billingPlans.find((b) => b.i === i)!.patientIdx, amount: billingTotals.get(i)!.insurance }));
  for (const c of claims) {
    const claimId = makeUuid('c1a10000', c.i);
    await prisma.claim.upsert({
      where: { id: claimId }, update: {},
      create: {
        id: claimId, billingId: makeUuid('b1110000', c.billingIdx),
        patientId: uid(P.PATIENT, c.patientIdx),
        claimedAmount: c.amount, claimDate: new Date(), status: 'SUBMITTED',
        submittedAt: new Date(),
      },
    });
  }
  console.log(`     → ${claims.length} insurance claims seeded`);

  // ── 수술 (Surgery) ──
  const surgeries = [
    { i: 1, patientIdx: 7, surgeonIdx: 4, name: '복강경 담낭절제술', daysAgo: 2, status: 'COMPLETED', room: 'OR-1', duration: 90 },
    { i: 2, patientIdx: 11, surgeonIdx: 8, name: '대퇴골 골절 내고정술(ORIF)', daysAgo: 9, status: 'COMPLETED', room: 'OR-2', duration: 150 },
    { i: 3, patientIdx: 3, surgeonIdx: 4, name: '탈장 복원술(복강경)', days: 5, status: 'SCHEDULED', room: 'OR-1', duration: 60 },
    { i: 4, patientIdx: 14, surgeonIdx: 8, name: '무릎 관절경 수술', days: 7, status: 'SCHEDULED', room: 'OR-2', duration: 120 },
  ];
  for (const s of surgeries) {
    const surgId = makeUuid('50010000', s.i);
    const schedDate = new Date();
    if ('daysAgo' in s) schedDate.setDate(schedDate.getDate() - (s as any).daysAgo);
    else schedDate.setDate(schedDate.getDate() + (s as any).days);
    schedDate.setHours(8, 30, 0, 0);
    await prisma.surgery.upsert({
      where: { id: surgId }, update: {},
      create: {
        id: surgId, patientId: uid(P.PATIENT, s.patientIdx),
        surgeonId: uid(P.USER, s.surgeonIdx), scheduledAt: schedDate,
        procedureName: s.name, status: s.status as any,
        // operatingRoom과 estimatedDuration은 opNote에 포함
        startedAt: s.status === 'COMPLETED' ? schedDate : null,
        endedAt: s.status === 'COMPLETED' ? new Date(schedDate.getTime() + s.duration * 60000) : null,
      },
    });
  }
  console.log(`     → ${surgeries.length} surgeries seeded`);

  // ── 응급실 방문 (EmergencyVisit) ──
  const emergencyVisits: Array<{
    i: number; patientIdx: number; triage: string; cc: string;
    hoursAgo: number; disposition: string | null; triageNote?: string;
    treatmentNote?: string; vitals?: Record<string, unknown>;
    doctorIdx?: number;
  }> = [
    // 현재 대기/치료 중 환자 (disposition = null) — 최근 1시간 이내 도착
    { i: 1, patientIdx: 9, triage: 'LEVEL_1', cc: '급성 심근경색 의심 — 흉통(NRS 9/10), 발한, 좌측 팔 방사통, 호흡곤란',
      hoursAgo: 0.1, disposition: null, doctorIdx: 9,
      triageNote: 'STEMI 의심. 심전도 즉시. 심장내과 호출. 산소 5L 적용. IV line 확보.',
      vitals: { bp: '85/55', hr: 120, rr: 28, bt: 36.8, spo2: 91, gcs: 15 } },
    { i: 2, patientIdx: 23, triage: 'LEVEL_2', cc: '교통사고(차대차) — 흉부 통증, 좌측 늑골 압통, 호흡 시 악화',
      hoursAgo: 0.15, disposition: null, doctorIdx: 9,
      triageNote: '안전벨트 착용 상태 충돌. 흉부 CT 필요. 기흉 감별. ABC stable.',
      vitals: { bp: '135/80', hr: 98, rr: 22, bt: 36.5, spo2: 95, gcs: 15 } },
    { i: 3, patientIdx: 6, triage: 'LEVEL_3', cc: '급성 복통 (RLQ) — 발열 38.2℃, 오심, 식욕부진 2일',
      hoursAgo: 0.25, disposition: null,
      triageNote: 'McBurney 점 압통(+), 반발통(+). 급성 충수염 의심. CBC, 복부 CT 오더.',
      vitals: { bp: '125/75', hr: 88, rr: 18, bt: 38.2, spo2: 98, gcs: 15 } },
    { i: 4, patientIdx: 20, triage: 'LEVEL_3', cc: '고혈당 응급 — 의식 저하, 구갈, 다뇨, 구역감, 혈당 450mg/dL',
      hoursAgo: 0.35, disposition: null,
      triageNote: 'DKA 의심. ABG, 전해질, 케톤 검사. NS 1L bolus 시작. 내분비내과 협진.',
      vitals: { bp: '100/60', hr: 110, rr: 30, bt: 37.0, spo2: 97, gcs: 13 } },
    { i: 5, patientIdx: 28, triage: 'LEVEL_4', cc: '좌측 발목 염좌 — 등산 중 넘어짐, 부종 및 보행 장애',
      hoursAgo: 0.4, disposition: null,
      triageNote: '좌측 외과 인대 압통. X-ray 촬영. 골절 감별 필요.',
      vitals: { bp: '120/78', hr: 76, rr: 16, bt: 36.6, spo2: 99, gcs: 15 } },
    { i: 6, patientIdx: 12, triage: 'LEVEL_2', cc: '소아 고열(40.1℃) + 경련 1회 — 5세, 열성 경련 기왕력',
      hoursAgo: 0.5, disposition: null, doctorIdx: 6,
      triageNote: '경련 1분 지속 후 자연 소실. 현재 의식 명료. 해열제 투여. 소아청소년과 호출.',
      vitals: { bp: '95/60', hr: 140, rr: 32, bt: 40.1, spo2: 96, gcs: 15 } },
    { i: 7, patientIdx: 16, triage: 'LEVEL_4', cc: '두통 — 3일 전부터 지속, 후두부 욱신거림, OTC 진통제 무효',
      hoursAgo: 0.6, disposition: null,
      triageNote: '신경학적 이상 소견 없음. 고혈압 기왕력. BP 확인 후 평가.',
      vitals: { bp: '155/95', hr: 82, rr: 16, bt: 36.7, spo2: 99, gcs: 15 } },
    { i: 8, patientIdx: 29, triage: 'LEVEL_5', cc: '경미한 찰과상 — 자전거 넘어짐, 좌측 무릎 긁힘',
      hoursAgo: 0.75, disposition: null,
      triageNote: '활력징후 정상. 상처 세척 및 드레싱 필요. 파상풍 접종력 확인.',
      vitals: { bp: '118/72', hr: 70, rr: 14, bt: 36.5, spo2: 100, gcs: 15 } },

    // 처리 완료된 환자 (과거 기록)
    { i: 9, patientIdx: 15, triage: 'LEVEL_3', cc: '급성 복통 (RLQ), 발열 38.5℃, 구토 2회',
      hoursAgo: 72, disposition: 'ADMISSION',
      treatmentNote: '복부 CT: 급성 충수염 확인. 외과 협진 → 응급 수술 결정. 3층 내과병동 입원.',
      vitals: { bp: '130/80', hr: 92, rr: 20, bt: 38.5, spo2: 97, gcs: 15 } },
    { i: 10, patientIdx: 25, triage: 'LEVEL_4', cc: '좌측 발목 염좌, 보행 시 통증, 부종',
      hoursAgo: 48, disposition: 'DISCHARGE',
      treatmentNote: 'X-ray: 골절 없음. RICE 교육. 소염진통제 처방. 정형외과 외래 F/U 안내.',
      vitals: { bp: '122/75', hr: 78, rr: 16, bt: 36.6, spo2: 99, gcs: 15 } },
    { i: 11, patientIdx: 17, triage: 'LEVEL_3', cc: '교통사고 — 두통, 오심, 경추 통증',
      hoursAgo: 50, disposition: 'TRANSFER',
      treatmentNote: '경추 CT: C5-6 골절 의심. 신경외과 없어 상급병원 전원. 경추 보호대 적용.',
      vitals: { bp: '140/85', hr: 90, rr: 18, bt: 36.8, spo2: 98, gcs: 15 } },
    { i: 12, patientIdx: 8, triage: 'LEVEL_2', cc: '소아 고열(39.8℃), 보챔, 발진',
      hoursAgo: 24, disposition: 'ADMISSION',
      treatmentNote: '가와사키병 의심 — 5일 이상 고열, 양측 결막충혈, 딸기혀, 체간 발진. IVIG 투여 위해 입원.',
      vitals: { bp: '90/55', hr: 135, rr: 30, bt: 39.8, spo2: 97, gcs: 15 } },
  ];
  for (const ev of emergencyVisits) {
    const evId = makeUuid('e0e10000', ev.i);
    const arrivalAt = new Date();
    arrivalAt.setTime(arrivalAt.getTime() - ev.hoursAgo * 3600000);
    if (ev.hoursAgo === 0) arrivalAt.setMinutes(arrivalAt.getMinutes() - 15 * ev.i);
    await prisma.emergencyVisit.upsert({
      where: { id: evId },
      update: {
        chiefComplaint: ev.cc, triageLevel: ev.triage as any,
        disposition: ev.disposition as any,
        triageNote: ev.triageNote ?? null,
        treatmentNote: ev.treatmentNote ?? null,
        vitalSigns: ev.vitals ? (ev.vitals as any) : undefined,
        doctorId: ev.doctorIdx ? uid(P.USER, ev.doctorIdx) : undefined,
      },
      create: {
        id: evId, patientId: uid(P.PATIENT, ev.patientIdx),
        arrivalAt, triageLevel: ev.triage as any,
        chiefComplaint: ev.cc,
        disposition: ev.disposition as any ?? undefined,
        dispositionAt: ev.disposition ? new Date(arrivalAt.getTime() + 3600000 * 2) : undefined,
        triageNurseId: nurseHwangId,
        triageNote: ev.triageNote,
        triagedAt: arrivalAt,
        treatmentNote: ev.treatmentNote,
        treatmentStartedAt: ev.treatmentNote ? new Date(arrivalAt.getTime() + 600000) : undefined,
        vitalSigns: ev.vitals ? (ev.vitals as any) : undefined,
        doctorId: ev.doctorIdx ? uid(P.USER, ev.doctorIdx) : undefined,
      },
    });
  }
  console.log(`     → ${emergencyVisits.length} emergency visits seeded (${emergencyVisits.filter(e => !e.disposition).length} 현재 대기/치료 중)`);

  // ── 응급실 환자 Encounter (응급 진료 기록) ──
  const erEncounters = [
    { i: 201, patientIdx: 9, doctorIdx: 9,
      s: '(응급) 30분 전 갑자기 발생한 흉통. 좌측 팔로 방사. 발한, 호흡곤란 동반. NRS 9/10. 고혈압/고지혈증/협심증 기왕력. PCI 2년 전 시행. 아스피린/클로피도그렐/스타틴 복용 중.',
      o: 'VS: BP 85/55, HR 120, RR 28, SpO2 91%, BT 36.8. 12-lead ECG: ST elevation V1-V4 (anterior STEMI). Troponin-I: 15.8ng/mL (>0.04). CK-MB: 48. ABG: pH 7.32, pCO2 35, pO2 68.',
      a: 'Acute anterior STEMI. Cardiogenic shock 초기.',
      p: '1) Primary PCI 준비 (심장내과 호출 완료)\n2) Dual antiplatelet loading (ASA 300mg + Ticagrelor 180mg)\n3) Heparin 5000U IV bolus\n4) NS 500cc IV\n5) O2 5L nasal cannula → NRB mask\n6) Morphine 2mg IV PRN for pain\n7) 심카테실 이동 예정',
    },
    { i: 202, patientIdx: 23, doctorIdx: 9,
      s: '(응급) 1시간 전 교통사고(차대차). 안전벨트 착용 상태. 좌측 흉부 통증(NRS 7/10), 호흡 시 악화. 과거력: 특이사항 없음. 조영제 알레르기력.',
      o: 'VS: BP 135/80, HR 98, RR 22, SpO2 95%, GCS 15. 좌측 5-7번 늑골 압통(+). 흉부 움직임 비대칭. CXR: 좌측 5,6번 늑골 골절, 소량 혈흉. CT 필요하나 조영제 알레르기 → 비조영 CT 또는 전처치 후 시행.',
      a: '좌측 다발성 늑골 골절 (5,6번) + 소량 혈흉. 기흉 감별 필요.',
      p: '1) 통증 관리: Fentanyl 50mcg IV + Acetaminophen 1g IV\n2) 비조영 흉부 CT → 기흉 감별\n3) 호흡기내과 협진 (흉관 삽입 필요 여부 판단)\n4) Serial CXR q6h\n5) Incentive spirometry 교육\n6) 조영제 알레르기 → 조영 CT 시행 시 전처치 필수',
    },
    { i: 203, patientIdx: 6, doctorIdx: 9,
      s: '(응급) 2시간 전 급성 복통. RLQ 중심. 어제부터 식욕부진, 오심. 오늘 발열 38.2℃. 설파제 알레르기력. 천식 기왕력 (간헐적).',
      o: 'VS: BP 125/75, HR 88, RR 18, SpO2 98%, BT 38.2. 복부: RLQ tenderness(++), rebound(+), McBurney point(+). Rovsing sign(+). Lab: WBC 14,200 (Neutro 82%), CRP 8.5. 복부 CT: 충수 직경 12mm, 주변 지방 침윤, 충수석 관찰.',
      a: '급성 충수염 (CT 확인). 천공 징후(-), 농양 형성(-).',
      p: '1) NPO\n2) NS 1L IV\n3) 항생제: Metronidazole 500mg IV + Cefotaxime 1g IV (설파제 알레르기 → Ceftriaxone 대신 Cefotaxime)\n4) 외과 협진 → 수술 결정 (복강경 충수절제술 예정)\n5) 수술 동의서 받기\n6) 천식 기왕력 → 마취과 사전 평가',
    },
    { i: 204, patientIdx: 20, doctorIdx: 9,
      s: '(응급) DKA 의심. 3일 전부터 구갈, 다뇨. 어제부터 구역감, 복통. 오늘 의식 저하. DM 7년차, 인슐린 사용 중이나 최근 자가 중단.',
      o: 'VS: BP 100/60, HR 110, RR 30 (Kussmaul), SpO2 97%, BT 37.0, GCS 13 (E3V4M6). POCT glucose: 450mg/dL. Lab: pH 7.18, HCO3 8, K 5.8, Na 131, Cl 98, BUN 32, Cr 1.8. Urine ketone 3+. Anion gap: 25.',
      a: 'Diabetic Ketoacidosis (DKA). 중등도-중증. 인슐린 자가 중단이 유발 인자.',
      p: '1) NS 1L bolus → 500cc/hr 유지\n2) Regular insulin 0.1U/kg IV bolus → 0.1U/kg/hr drip\n3) K 보충: 40mEq KCl in NS (K>5.3이므로 인슐린 시작 후 모니터링)\n4) ABG, 전해질 q2h 모니터링\n5) I/O 기록\n6) 내분비내과 협진\n7) 혈당 250 이하 시 D5W 전환, 인슐린 감량 프로토콜\n8) 의식 개선 후 인슐린 교육 + 자가관리 평가',
    },
    { i: 205, patientIdx: 12, doctorIdx: 6,
      s: '(응급) 5세 여아. 1시간 전 경련 1회 (약 1분 지속, 전신 강직-간대). 열성 경련 기왕력 1회 (2세). 오늘 발열 40.1℃. 3일 전부터 콧물, 기침.',
      o: 'VS: BP 95/60, HR 140, RR 32, SpO2 96%, BT 40.1, GCS 15 (경련 후 명료). 인후 발적(+). 양측 고막 정상. 경부 강직(-). Kernig(-). Brudzinski(-). Lab: WBC 18,500, CRP 4.2. 혈당 88.',
      a: '단순 열성 경련 (Simple febrile seizure). 상기도감염 동반. 뇌수막염 감별 — 신경학적 이상 없음.',
      p: '1) 해열제: Acetaminophen 15mg/kg PO + 미온수 마사지\n2) 경련 재발 시: Midazolam 0.2mg/kg buccal\n3) 6시간 관찰\n4) 뇌수막염 징후 관찰 (의식변화, 경부강직, 반복 경련)\n5) 경련 5분 이상 지속 시 Lorazepam 0.1mg/kg IV\n6) 보호자 교육: 열성 경련 응급 대처법',
    },
  ];
  for (const er of erEncounters) {
    const encId = makeUuid('e0c10000', er.i);
    await prisma.encounter.upsert({
      where: { id: encId }, update: {},
      create: {
        id: encId, patientId: uid(P.PATIENT, er.patientIdx),
        doctorId: uid(P.USER, er.doctorIdx),
        subjective: er.s, objective: er.o, assessment: er.a, plan: er.p,
        status: 'DRAFT',
      },
    });
  }
  console.log(`     → ${erEncounters.length} ER encounter SOAP records seeded`);

  // ── 응급실 환자 검사 결과 (Lab) ──
  const erLabTests = [
    { patientIdx: 9, encIdx: 201, code: 'E6541', tests: [
      { testName: 'Troponin-I', value: '15.8', unit: 'ng/mL', min: 0, max: 0.04 },
      { testName: 'CK-MB', value: '48', unit: 'U/L', min: 0, max: 25 },
      { testName: 'BNP', value: '1250', unit: 'pg/mL', min: 0, max: 100 },
      { testName: 'WBC', value: '12400', unit: '/μL', min: 4000, max: 10000 },
      { testName: 'Hb', value: '14.2', unit: 'g/dL', min: 13, max: 17 },
      { testName: 'Creatinine', value: '1.1', unit: 'mg/dL', min: 0.7, max: 1.3 },
      { testName: 'K', value: '4.2', unit: 'mEq/L', min: 3.5, max: 5.1 },
    ]},
    { patientIdx: 6, encIdx: 203, code: 'E6502', tests: [
      { testName: 'WBC', value: '14200', unit: '/μL', min: 4000, max: 10000 },
      { testName: 'CRP', value: '8.5', unit: 'mg/dL', min: 0, max: 0.5 },
      { testName: 'Hb', value: '13.5', unit: 'g/dL', min: 12, max: 16 },
      { testName: 'Creatinine', value: '0.8', unit: 'mg/dL', min: 0.6, max: 1.1 },
    ]},
    { patientIdx: 20, encIdx: 204, code: 'E6571', tests: [
      { testName: '혈당 (Glucose)', value: '450', unit: 'mg/dL', min: 70, max: 100 },
      { testName: 'HbA1c', value: '12.5', unit: '%', min: 4, max: 6.5 },
      { testName: 'pH (ABG)', value: '7.18', unit: '', min: 7.35, max: 7.45 },
      { testName: 'HCO3', value: '8', unit: 'mEq/L', min: 22, max: 26 },
      { testName: 'K', value: '5.8', unit: 'mEq/L', min: 3.5, max: 5.1 },
      { testName: 'Na', value: '131', unit: 'mEq/L', min: 136, max: 145 },
      { testName: 'BUN', value: '32', unit: 'mg/dL', min: 7, max: 20 },
      { testName: 'Creatinine', value: '1.8', unit: 'mg/dL', min: 0.7, max: 1.3 },
    ]},
    { patientIdx: 12, encIdx: 205, code: 'E6541', tests: [
      { testName: 'WBC', value: '18500', unit: '/μL', min: 4000, max: 10000 },
      { testName: 'CRP', value: '4.2', unit: 'mg/dL', min: 0, max: 0.5 },
      { testName: '혈당 (Glucose)', value: '88', unit: 'mg/dL', min: 70, max: 100 },
      { testName: 'Na', value: '139', unit: 'mEq/L', min: 136, max: 145 },
    ]},
  ];
  // 응급 검사 오더도 같은 이유로 수가 코드를 붙인다
  const erFeeCodes = [...new Set(erLabTests.map((l) => l.code))];
  const erFeeRows = await prisma.procedureCode.findMany({
    where: { code: { in: erFeeCodes } }, orderBy: { validFrom: 'desc' }, select: { id: true, code: true },
  });
  const erFeeId = new Map<string, string>();
  for (const r of erFeeRows) if (!erFeeId.has(r.code)) erFeeId.set(r.code, r.id);

  for (const lab of erLabTests) {
    const patientId = uid(P.PATIENT, lab.patientIdx);
    const encounterId = makeUuid('e0c10000', lab.encIdx);
    const orderId = makeUuid('0de20000', lab.encIdx);
    const labResultId = makeUuid('1ab20000', lab.encIdx);
    const rxId = makeUuid('4ab20000', lab.encIdx);
    const erProcedureCodeId = erFeeId.get(lab.code) ?? null;
    await prisma.prescription.upsert({ where: { id: rxId }, update: {},
      create: { id: rxId, encounterId, type: 'LAB', status: 'ACTIVE', createdBy: kangEunggupId, procedureCodeId: erProcedureCodeId },
    });
    if (erProcedureCodeId) {
      await prisma.prescription.updateMany({ where: { id: rxId, procedureCodeId: null }, data: { procedureCodeId: erProcedureCodeId } });
    }
    await prisma.order.upsert({ where: { id: orderId }, update: {},
      create: { id: orderId, prescriptionId: rxId, department: 'LAB', status: 'COMPLETED', completedAt: new Date() },
    });
    await prisma.labResult.upsert({ where: { orderId }, update: {},
      create: { id: labResultId, orderId, patientId, technicianId: labTechId, status: 'COMPLETED', collectedAt: new Date(), completedAt: new Date() },
    });
    for (let i = 0; i < lab.tests.length; i++) {
      const t = lab.tests[i];
      const itemId = makeUuid('1ab30000', lab.encIdx * 100 + i);
      const flag = labFlagOf(t.value, t.min, t.max); // 🔴 정본 하나 — 사본을 두면 한쪽만 고쳐진다
      await prisma.labResultItem.upsert({ where: { id: itemId }, update: {},
        create: { id: itemId, labResultId, testName: t.testName, value: t.value, unit: t.unit, normalMin: t.min, normalMax: t.max, flag },
      });
    }
  }
  console.log(`     → ${erLabTests.length} ER lab results seeded`);

  // ── 약국 조제 (Dispensing) ──
  // 기존 order 중 MEDICATION 타입을 활용
  const dispensings = [
    { i: 1, patientIdx: 1, orderIdx: 1 },
    { i: 2, patientIdx: 2, orderIdx: 2 },
    { i: 3, patientIdx: 5, orderIdx: 5 },
  ];
  for (const d of dispensings) {
    const dispId = makeUuid('d1510000', d.i);
    // Medication Prescription + Order 생성
    const rxId = makeUuid('4ab10000', d.i);
    const ordId = makeUuid('0de10000', d.i);
    const encounterId = makeUuid('e0c00000', d.patientIdx);
    // 무명 처방 방지(2026-08-04) — 조제 항목과 같은 약 코드를 처방에도 연결(화면 폴백이 type 을 찍지 않게)
    const rxMedCode = (await prisma.medicationCode.findFirst({ select: { id: true } }))?.id;
    await prisma.prescription.upsert({
      where: { id: rxId }, update: {},
      create: { id: rxId, encounterId, type: 'MEDICATION', status: 'ACTIVE', createdBy: kimNaegwaId, medicationCodeId: rxMedCode },
    });
    await prisma.order.upsert({
      where: { id: ordId }, update: {},
      create: { id: ordId, prescriptionId: rxId, department: 'PHARMACY', status: 'COMPLETED', completedAt: new Date() },
    });
    await prisma.dispensing.upsert({
      where: { orderId: ordId }, update: {},
      create: {
        id: dispId, orderId: ordId, patientId: uid(P.PATIENT, d.patientIdx),
        pharmacistId, status: 'DISPENSED', dispensedAt: new Date(),
      },
    });
    // DispensingItem (약 1~2개)
    const medCodes = await prisma.medicationCode.findMany({ take: 2 });
    for (let mi = 0; mi < medCodes.length; mi++) {
      const diId = makeUuid('d1520000', d.i * 10 + mi);
      await prisma.dispensingItem.upsert({
        where: { id: diId }, update: {},
        create: {
          id: diId, dispensingId: dispId, medicationCodeId: medCodes[mi].id,
          prescribedQty: 30, dispensedQty: 30,
        },
      });
    }
  }
  console.log(`     → ${dispensings.length} dispensings seeded`);

  // ── 투약 관리 (MedicationAdministration) ──
  const medAdmins = [
    { i: 1, patientIdx: 1, route: 'PO', dose: 'Amlodipine 5mg', daysAgo: 1 },
    { i: 2, patientIdx: 1, route: 'IV', dose: 'Furosemide 20mg', daysAgo: 1 },
    { i: 3, patientIdx: 4, route: 'IV', dose: 'Ceftriaxone 2g', daysAgo: 2 },
    { i: 4, patientIdx: 19, route: 'PO', dose: 'Calcium Carbonate 500mg', daysAgo: 1 },
  ];
  // MedicationAdministration은 prescriptionId가 필수이므로, 기존 처방 활용
  for (const ma of medAdmins) {
    const maId = makeUuid('6a010000', ma.i);
    const rxId = makeUuid('4ab10000', ma.i <= 2 ? 1 : ma.i <= 3 ? 3 : 2); // 입원 환자 처방 참조
    const schedAt = new Date();
    schedAt.setDate(schedAt.getDate() - ma.daysAgo);
    schedAt.setHours(8 + ma.i * 2, 0, 0, 0);
    await prisma.medicationAdministration.upsert({
      where: { id: maId }, update: {},
      create: {
        id: maId, prescriptionId: rxId, patientId: uid(P.PATIENT, ma.patientIdx),
        scheduledAt: schedAt, status: 'ADMINISTERED',
        administeredAt: schedAt, nurseId: nurseChoId,
        route: ma.route, dose: ma.dose,
      },
    });
  }
  console.log(`     → ${medAdmins.length} medication administrations seeded`);

  // ── 급식 주문 (MealOrder) ──
  const mealOrders = [
    { i: 1, admIdx: 1, patientIdx: 1, diet: '저염식', meal: 'BREAKFAST' },
    { i: 2, admIdx: 1, patientIdx: 1, diet: '저염식', meal: 'LUNCH' },
    { i: 3, admIdx: 1, patientIdx: 1, diet: '저염식', meal: 'DINNER' },
    { i: 4, admIdx: 3, patientIdx: 4, diet: '일반식', meal: 'BREAKFAST' },
    { i: 5, admIdx: 3, patientIdx: 4, diet: '일반식', meal: 'LUNCH' },
    { i: 6, admIdx: 3, patientIdx: 4, diet: '일반식', meal: 'DINNER' },
    { i: 7, admIdx: 5, patientIdx: 19, diet: '저단백식(CKD)', meal: 'BREAKFAST' },
    { i: 8, admIdx: 5, patientIdx: 19, diet: '저단백식(CKD)', meal: 'LUNCH' },
    { i: 9, admIdx: 5, patientIdx: 19, diet: '저단백식(CKD)', meal: 'DINNER' },
  ];
  for (const mo of mealOrders) {
    const moId = makeUuid('60010000', mo.i);
    await prisma.mealOrder.upsert({
      where: { id: moId }, update: {},
      create: {
        id: moId, admissionId: makeUuid('ad010000', mo.admIdx),
        patientId: uid(P.PATIENT, mo.patientIdx),
        date: new Date(), mealType: mo.meal, dietType: mo.diet,
        status: 'ORDERED',
      },
    });
  }
  console.log(`     → ${mealOrders.length} meal orders seeded`);

  // ── 감염 감시 (InfectionSurveillance) ──
  const infections = [
    { i: 1, patientIdx: 4, type: 'HAP', pathogen: 'Streptococcus pneumoniae', dept: '내과', isolated: false },
    { i: 2, patientIdx: 19, type: 'CAUTI', pathogen: 'E. coli', dept: '내과', isolated: true },
    { i: 3, patientIdx: 7, type: 'SSI', pathogen: 'Staphylococcus aureus', dept: '외과', isolated: false },
  ];
  for (const inf of infections) {
    const infId = makeUuid('11f10000', inf.i);
    const detected = new Date();
    detected.setDate(detected.getDate() - 2);
    await prisma.infectionSurveillance.upsert({
      where: { id: infId }, update: {},
      create: {
        id: infId, patientId: uid(P.PATIENT, inf.patientIdx),
        infectionType: inf.type, organism: inf.pathogen,
        detectedAt: detected,
        isolationType: inf.isolated ? 'CONTACT' : null,
      },
    });
  }
  console.log(`     → ${infections.length} infection surveillances seeded`);

  // ── 안전 사건 (SafetyIncident) ──
  const safetyIncidents = [
    { i: 1, type: 'FALL', severity: 'MODERATE', desc: '화장실 이동 중 낙상. 우측 고관절 타박. X-ray 골절 없음.', daysAgo: 5 },
    { i: 2, type: 'MEDICATION_ERROR', severity: 'LOW', desc: '인슐린 용량 기록 오류. 투약 전 발견, 환자 영향 없음.', daysAgo: 3 },
    { i: 3, type: 'NEEDLE_STICK', severity: 'LOW', desc: '채혈 후 바늘 정리 중 자침. 즉시 소독 및 보고 완료.', daysAgo: 1 },
  ];
  for (const si of safetyIncidents) {
    const siId = makeUuid('5a010000', si.i);
    const occurred = new Date();
    occurred.setDate(occurred.getDate() - si.daysAgo);
    await prisma.safetyIncident.upsert({
      where: { id: siId }, update: {},
      create: {
        id: siId, reporterId: nurseChoId,
        type: si.type, severity: si.severity,
        description: si.desc, occurredAt: occurred, status: 'REPORTED',
      },
    });
  }
  console.log(`     → ${safetyIncidents.length} safety incidents seeded`);

  // ── 낙상 위험 평가 (FallRiskAssessment) ──
  // 🔴 종전 결함: 등급을 리터럴로 적어 **정본 Morse 임계와 반대로** 저장됐다
  //    (45 → 정본 HIGH 인데 'MODERATE' · 30 → 정본 MODERATE 인데 'LOW').
  //    정본(`patient-safety.deriveFallRiskLevel` = `risk-reassessment.policy.deriveRiskLevel`)이
  //    "자가입력 riskLevel 무시"라고 못박은 바로 그 오염을 시드가 DB 에 직접 심고 있었다.
  //    factors 키도 정본 Morse 인자 어휘(historyOfFalling·secondaryDiagnosis·ambulatoryAid·ivTherapy)로 맞춘다.
  const fallRisks = [
    { i: 1, patientIdx: 4, score: 65, factors: { historyOfFalling: true, secondaryDiagnosis: true, ambulatoryAid: true, ivTherapy: true, gait: 'IMPAIRED', mentalStatus: 'ORIENTED' } },
    { i: 2, patientIdx: 19, score: 45, factors: { historyOfFalling: false, secondaryDiagnosis: true, ambulatoryAid: true, ivTherapy: true, gait: 'WEAK', mentalStatus: 'ORIENTED' } },
    { i: 3, patientIdx: 1, score: 30, factors: { historyOfFalling: false, secondaryDiagnosis: true, ambulatoryAid: false, ivTherapy: true, gait: 'NORMAL', mentalStatus: 'ORIENTED' } },
  ];
  for (const fr of fallRisks) {
    const frId = makeUuid('fa110000', fr.i);
    await prisma.fallRiskAssessment.upsert({
      where: { id: frId }, update: {},
      create: {
        id: frId, patientId: uid(P.PATIENT, fr.patientIdx),
        assessorId: nurseChoId, score: fr.score, riskLevel: deriveRiskLevel('FALL_RISK', fr.score),
        factors: fr.factors, assessedAt: new Date(),
      },
    });
  }
  console.log(`     → ${fallRisks.length} fall risk assessments seeded`);

  // ── 교육 프로그램 (EducationProgram) — 20개 ──
  const eduPrograms = [
    // 필수 교육 (의료기관 인증 기준)
    { i: 1, name: '감염관리 교육', category: '필수', mandatory: true, months: 12 },
    { i: 2, name: '환자안전 교육', category: '필수', mandatory: true, months: 12 },
    { i: 3, name: '심폐소생술(BLS)', category: '필수', mandatory: true, months: 24 },
    { i: 4, name: '손위생 실습 교육', category: '필수', mandatory: true, months: 6 },
    { i: 5, name: '낙상예방 교육', category: '필수', mandatory: true, months: 12 },
    { i: 6, name: '욕창예방 교육', category: '필수', mandatory: true, months: 12 },
    { i: 7, name: '투약안전 교육', category: '필수', mandatory: true, months: 12 },
    // 법정 의무교육
    { i: 8, name: '개인정보보호 교육', category: '법정', mandatory: true, months: 12 },
    { i: 9, name: '직장 내 성희롱 예방 교육', category: '법정', mandatory: true, months: 12 },
    { i: 10, name: '직장 내 괴롭힘 예방 교육', category: '법정', mandatory: true, months: 12 },
    { i: 11, name: '소방안전 교육', category: '법정', mandatory: true, months: 6 },
    { i: 12, name: '장애인 인식개선 교육', category: '법정', mandatory: true, months: 12 },
    { i: 13, name: '퇴직연금 교육', category: '법정', mandatory: true, months: 12 },
    // 직무 교육
    { i: 14, name: '의료기기 사용법 (인퓨전 펌프)', category: '직무', mandatory: false, months: 12 },
    { i: 15, name: '의료기기 사용법 (심전도 모니터)', category: '직무', mandatory: false, months: 12 },
    { i: 16, name: '제세동기(AED) 사용법', category: '직무', mandatory: false, months: 12 },
    { i: 17, name: '전자의무기록(EMR) 사용법', category: '직무', mandatory: false, months: 12 },
    { i: 18, name: '중환자실 전문 교육', category: '직무', mandatory: false, months: 12 },
    { i: 19, name: '항암화학요법 간호 교육', category: '직무', mandatory: false, months: 12 },
    { i: 20, name: '신규직원 오리엔테이션', category: '직무', mandatory: true, months: 0 },
  ];
  for (const ep of eduPrograms) {
    const epId = makeUuid('ed010000', ep.i);
    await prisma.educationProgram.upsert({
      where: { id: epId }, update: { name: ep.name, category: ep.category, isMandatory: ep.mandatory, validMonths: ep.months },
      create: {
        id: epId, name: ep.name, category: ep.category,
        isMandatory: ep.mandatory, validMonths: ep.months,
      },
    });
  }
  // EducationCompletion — 전 직원 교육 이수 기록 (현실적 분포)
  const staffIds = await prisma.staff.findMany({ select: { id: true } });
  let ecCount = 0;
  // 이수 시뮬레이션: 필수/법정은 대부분 이수, 직무는 해당자만
  const completionRates: Record<string, number> = { '필수': 0.92, '법정': 0.88, '직무': 0.40 };
  for (let si = 0; si < staffIds.length; si++) {
    for (const ep of eduPrograms) {
      const rate = completionRates[ep.category] ?? 0.5;
      // 결정론적: (si + ep.i) % 100 < rate * 100 이면 이수
      if ((si * 7 + ep.i * 13) % 100 >= rate * 100) continue;
      const ecId = makeUuid('ec010000', si * 100 + ep.i);
      // 이수 시점 분산: 1~11개월 전
      const monthsAgo = ((si + ep.i) % 11) + 1;
      const completed = new Date();
      completed.setMonth(completed.getMonth() - monthsAgo);
      // 🔴 `validMonths === 0` 은 **무기한 과정**이다 — 종전 폴백은 조용히 12개월을 부여해
      //    무기한 이수에 만료일을 만들어냈다(2026-08-18: 무기한 = `expiresAt === null` 로 정본 전환).
      let expires: Date | null = null;
      if (ep.months > 0) {
        expires = new Date(completed);
        expires.setMonth(expires.getMonth() + ep.months);
      }
      // 점수: 70~100 분포
      const score = 70 + ((si * 3 + ep.i * 7) % 31);
      await prisma.educationCompletion.upsert({
        where: { id: ecId }, update: {},
        create: {
          id: ecId, programId: makeUuid('ed010000', ep.i),
          staffId: staffIds[si].id, completedAt: completed,
          expiresAt: expires, score,
        },
      });
      ecCount++;
    }
  }
  console.log(`     → ${eduPrograms.length} education programs + ${ecCount} completions seeded`);

  // ── 직원 근무표 (정본=DutyEntry — 모델 이원화 통합 2026-07-22, 구 StaffSchedule 시드 대체) ──
  let schedCount = 0;
  const shifts = ['DAY', 'EVENING', 'NIGHT'];
  const dutyStaff = await prisma.staff.findMany({
    where: { userId: { not: null } },
    select: { id: true, userId: true, familyName: true, givenName: true, department: true },
    take: 5,
    orderBy: { employeeNumber: 'asc' },
  });
  const dutyUsers = await prisma.user.findMany({
    where: { id: { in: dutyStaff.map((s) => s.userId as string) } },
    select: { id: true, role: true, department: true },
  });
  const dutyUserMap = new Map(dutyUsers.map((u) => [u.id, u]));
  for (let si = 0; si < dutyStaff.length; si++) {
    const st = dutyStaff[si];
    const u = dutyUserMap.get(st.userId as string);
    for (let d = 0; d < 7; d++) {
      const scId = makeUuid('55020000', si * 10 + d);
      const now = new Date();
      const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + d));
      await prisma.dutyEntry.upsert({
        where: { id: scId }, update: {},
        create: {
          id: scId, staffId: st.userId as string,
          staffName: `${st.familyName}${st.givenName}`,
          role: u?.role === 'DOCTOR' ? 'doctor' : 'nurse',
          department: u?.department ?? st.department ?? '미지정',
          date, shift: shifts[(si + d) % 3],
        },
      });
      schedCount++;
    }
  }
  console.log(`     → ${schedCount} duty entries seeded`);

  // ── 증명서 (Certificate) ──
  const certificates = [
    { i: 1, patientIdx: 9, type: '진단서', content: { diagnosis: '급성 흉통', period: '2026-05-10 ~ 2026-05-12', opinion: '안정 필요. 2주간 요양 권고.' } },
    { i: 2, patientIdx: 14, type: '통원확인서', content: { visits: 3, period: '2026-04-01 ~ 2026-05-01', department: '정형외과' } },
    { i: 3, patientIdx: 25, type: '소견서', content: { diagnosis: '좌측 발목 염좌', opinion: '1주간 보조기 착용 및 안정 권고.' } },
  ];
  for (const cert of certificates) {
    const certId = makeUuid('ce010000', cert.i);
    await prisma.certificate.upsert({
      where: { id: certId }, update: {},
      create: {
        id: certId, patientId: uid(P.PATIENT, cert.patientIdx),
        issuedBy: kimNaegwaId, type: cert.type, content: cert.content,
      },
    });
  }
  console.log(`     → ${certificates.length} certificates seeded`);

  // ── QI 측정 (QiMeasurement) — 전체 지표 12개월치 ──
  //
  // 🔴 종전 시드는 **값을 먼저 정하고 분자를 `×100` 가정으로 역산**해서, 배율이 100 이 아닌
  //    지표(×1000 · ×1)의 저장값이 분자/분모와 어긋났다(운영 실측 300건 중 273건 · 91%).
  //    이제 **분모 → 분자(정수) → 값** 순으로, 서비스와 같은 정본식으로 산출한다.
  //    생성 로직·모수는 `prisma/seeds/qi-measurement.ts`(순수 TS · 테스트가 같이 본다).
  const qiRows = await prisma.qualityIndicator.findMany({
    // 🔴 formula·direction·unit·valueScale 이 있어야 배율·방향을 정본이 해석할 수 있다.
    //    종전엔 formula 를 안 읽어와 배율을 알 길이 없었고, 그래서 100 을 가정했다.
    select: {
      id: true,
      name: true,
      category: true,
      formula: true,
      targetValue: true,
      direction: true,
      unit: true,
      valueScale: true,
    },
  });
  const qiByName = new Map(qiRows.map((r) => [r.name, r]));
  let qmCount = 0;
  let qiSeededIndicators = 0;
  // 🔴 **카탈로그에 있는 지표에만** 측정을 만든다. 종전엔 DB 의 모든 지표에 기본 모수(base 50/분모 100)로
  //    12개월치를 찍었다 — 관리자가 방금 만든 지표에 **있지도 않은 실적**이 생긴다(P16).
  for (const cat of QI_INDICATOR_CATALOG) {
    const qi = qiByName.get(cat.name);
    if (!qi) continue;
    qiSeededIndicators++;
    const rows = buildQiMeasurements({
      id: qi.id,
      name: qi.name,
      category: qi.category,
      formula: qi.formula,
      targetValue: qi.targetValue === null ? null : Number(qi.targetValue),
      direction: qi.direction,
      unit: qi.unit,
      valueScale: qi.valueScale,
    });
    for (const row of rows) {
      const data = {
        indicatorId: row.indicatorId,
        period: row.period,
        numerator: row.numerator,
        denominator: row.denominator,
        value: row.value,
        meetTarget: row.meetTarget,
        measuredAt: row.measuredAt,
        source: 'SEED',
      };
      await prisma.qiMeasurement.upsert({
        // 🔴 자연키(지표×기간)로 맞춘다. 순번 id 로 맞추면 12개월 창이 한 달 굴러갈 때
        //    슬롯이 옆 슬롯의 기간을 넘겨받아 @@unique([indicatorId, period]) 를 루프 도중 위반한다.
        // 2026-10-08 QI 흐름 — 유일성이 지표×기간×층×출처칸으로 넓어졌다. 시드 행은 병원 전체(층 '')·수기 칸이고 출처는 SEED(가상)다.
        where: { indicatorId_period_stratumKey_sourceKey: { indicatorId: row.indicatorId, period: row.period, stratumKey: '', sourceKey: 'MANUAL' } },
        // 🔴 빈 update 는 **이미 들어간 모순 행을 영원히 남긴다**(재시드해도 91% 가 그대로였다).
        //    이 행들은 시드가 소유하므로 파생값을 다시 맞춘다. 무효화(voidedAt)·메모는 건드리지 않는다.
        update: data,
        create: { id: makeUuid('01020000', qiMeasurementSeedIndex(cat.i, row.period)), ...data },
      });
      qmCount++;
    }
  }
  const qiUnseeded = qiRows.length - qiSeededIndicators;
  console.log(
    `     → ${qmCount} QI measurements seeded (${qiSeededIndicators} indicators × 12 months)` +
      (qiUnseeded > 0 ? ` · 카탈로그 밖 지표 ${qiUnseeded}개는 측정을 만들지 않음(허구 실적 금지)` : ''),
  );

  // ── 검사 장비 (LabInstrument) ──
  console.log('  [Extra] Lab instruments & interface results...');
  const labInstruments = [
    { i: 1, name: 'Sysmex XN-1000', manufacturer: 'Sysmex', model: 'XN-1000', serial: 'SYS-2022-10045', category: 'HEMATOLOGY', type: 'FILE_WATCH', location: '검사실 1', config: { watchDir: '/lab-data/sysmex/', pattern: '*.csv', encoding: 'UTF-8' } },
    { i: 2, name: 'Cobas c702', manufacturer: 'Roche', model: 'c702', serial: 'ROC-2023-30012', category: 'CHEMISTRY', type: 'HL7', location: '검사실 1', config: { host: '192.168.1.10', port: 5000, version: '2.5.1' } },
    { i: 3, name: 'Architect i2000 SR', manufacturer: 'Abbott', model: 'i2000 SR', serial: 'ABT-2021-50078', category: 'IMMUNOLOGY', type: 'FILE_WATCH', location: '검사실 2', config: { watchDir: '/lab-data/architect/', pattern: '*.txt' } },
    { i: 4, name: 'Sysmex CS-5100', manufacturer: 'Sysmex', model: 'CS-5100', serial: 'SYS-2023-20033', category: 'COAGULATION', type: 'FILE_WATCH', location: '검사실 1', config: { watchDir: '/lab-data/cs5100/', pattern: '*.csv' } },
    { i: 5, name: 'ABL90 FLEX Plus', manufacturer: 'Radiometer', model: 'ABL90 FLEX Plus', serial: 'RAD-2024-10005', category: 'BLOOD_GAS', type: 'API', location: '응급검사실', config: { endpoint: 'http://192.168.1.20/api/results' } },
    { i: 6, name: 'Urysys 2400', manufacturer: 'Roche', model: 'Urysys 2400', serial: 'ROC-2020-40099', category: 'URINALYSIS', type: 'FILE_WATCH', location: '검사실 2', config: { watchDir: '/lab-data/urysys/', pattern: '*.csv' } },
    { i: 7, name: 'Beckman AU5800', manufacturer: 'Beckman Coulter', model: 'AU5800', serial: 'BCK-2023-60021', category: 'CHEMISTRY', type: 'HL7', location: '검사실 1', config: { host: '192.168.1.11', port: 5001 } },
    { i: 8, name: 'Siemens IMMULITE 2000', manufacturer: 'Siemens', model: 'IMMULITE 2000', serial: 'SIE-2022-70044', category: 'IMMUNOLOGY', type: 'PDF_UPLOAD', location: '검사실 2', config: { uploadDir: '/lab-uploads/immulite/' } },
  ];
  for (const inst of labInstruments) {
    const instId = makeUuid('1a010000', inst.i);
    await prisma.labInstrument.upsert({
      where: { id: instId },
      update: { name: inst.name, manufacturer: inst.manufacturer, model: inst.model, category: inst.category, interfaceType: inst.type, location: inst.location },
      create: {
        id: instId, name: inst.name, manufacturer: inst.manufacturer, model: inst.model,
        serialNumber: inst.serial, category: inst.category, interfaceType: inst.type,
        interfaceConfig: inst.config, location: inst.location,
        lastSyncAt: new Date(Date.now() - inst.i * 3600000), // 각각 1~8시간 전
      },
    });
  }

  // ── 장비 수신 결과 (LabInterfaceResult) ──
  const interfaceResults = [
    { i: 1, instIdx: 1, file: 'sysmex_20260519_batch01.csv', barcode: 'S20260519-001', status: 'APPLIED', items: [
      { testName: 'WBC', value: '7.2', unit: '10^3/uL', normalMin: 4.0, normalMax: 10.0 },
      { testName: 'RBC', value: '4.85', unit: '10^6/uL', normalMin: 4.0, normalMax: 5.5 },
      { testName: 'Hemoglobin', value: '14.2', unit: 'g/dL', normalMin: 12.0, normalMax: 16.0 },
      { testName: 'Hematocrit', value: '42.5', unit: '%', normalMin: 36.0, normalMax: 48.0 },
      { testName: 'Platelet', value: '245', unit: '10^3/uL', normalMin: 150, normalMax: 400 },
    ]},
    { i: 2, instIdx: 2, file: 'cobas_20260519_batch02.txt', barcode: 'S20260519-005', status: 'APPLIED', items: [
      { testName: 'Glucose', value: '105', unit: 'mg/dL', normalMin: 70, normalMax: 100 },
      { testName: 'BUN', value: '18', unit: 'mg/dL', normalMin: 8, normalMax: 20 },
      { testName: 'Creatinine', value: '1.0', unit: 'mg/dL', normalMin: 0.6, normalMax: 1.2 },
      { testName: 'AST', value: '28', unit: 'U/L', normalMin: 10, normalMax: 40 },
      { testName: 'ALT', value: '35', unit: 'U/L', normalMin: 10, normalMax: 40 },
      { testName: 'Total Bilirubin', value: '0.8', unit: 'mg/dL', normalMin: 0.2, normalMax: 1.2 },
    ]},
    { i: 3, instIdx: 1, file: 'sysmex_20260519_batch03.csv', barcode: 'S20260519-008', status: 'MATCHED', items: [
      { testName: 'WBC', value: '12.5', unit: '10^3/uL', normalMin: 4.0, normalMax: 10.0 },
      { testName: 'RBC', value: '3.2', unit: '10^6/uL', normalMin: 4.0, normalMax: 5.5 },
      { testName: 'Hemoglobin', value: '9.8', unit: 'g/dL', normalMin: 12.0, normalMax: 16.0 },
    ]},
    { i: 4, instIdx: 3, file: 'architect_20260519_01.txt', barcode: null, status: 'RECEIVED', items: [
      { testName: 'TSH', value: '4.8', unit: 'mIU/L', normalMin: 0.4, normalMax: 4.0 },
      { testName: 'Free T4', value: '1.1', unit: 'ng/dL', normalMin: 0.8, normalMax: 1.8 },
    ]},
    { i: 5, instIdx: 2, file: 'cobas_20260518_batch15.txt', barcode: 'S20260518-022', status: 'APPLIED', items: [
      { testName: 'Total Cholesterol', value: '220', unit: 'mg/dL', normalMin: 0, normalMax: 200 },
      { testName: 'HDL', value: '45', unit: 'mg/dL', normalMin: 40, normalMax: 60 },
      { testName: 'LDL', value: '148', unit: 'mg/dL', normalMin: 0, normalMax: 130 },
      { testName: 'Triglyceride', value: '185', unit: 'mg/dL', normalMin: 0, normalMax: 150 },
    ]},
    { i: 6, instIdx: 4, file: 'cs5100_20260519_coag01.csv', barcode: 'S20260519-012', status: 'MATCHED', items: [
      { testName: 'PT (INR)', value: '1.2', unit: 'INR', normalMin: 0.8, normalMax: 1.2 },
      { testName: 'aPTT', value: '32', unit: 'sec', normalMin: 25, normalMax: 35 },
      { testName: 'Fibrinogen', value: '280', unit: 'mg/dL', normalMin: 200, normalMax: 400 },
    ]},
    { i: 7, instIdx: 5, file: null, barcode: 'S20260519-015', status: 'APPLIED', items: [
      { testName: 'pH', value: '7.38', unit: '', normalMin: 7.35, normalMax: 7.45 },
      { testName: 'pCO2', value: '42', unit: 'mmHg', normalMin: 35, normalMax: 45 },
      { testName: 'pO2', value: '88', unit: 'mmHg', normalMin: 80, normalMax: 100 },
      { testName: 'HCO3', value: '24', unit: 'mEq/L', normalMin: 22, normalMax: 26 },
    ]},
    { i: 8, instIdx: 6, file: 'urysys_20260519_ua01.csv', barcode: 'S20260519-018', status: 'RECEIVED', items: [
      { testName: 'pH (Urine)', value: '6.0', unit: '', normalMin: 4.5, normalMax: 8.0 },
      { testName: 'Protein', value: 'Negative', unit: '', normalMin: null, normalMax: null },
      { testName: 'Glucose (Urine)', value: 'Negative', unit: '', normalMin: null, normalMax: null },
      { testName: 'WBC (Urine)', value: '2-5', unit: '/HPF', normalMin: null, normalMax: null },
    ]},
  ];
  let irCount = 0;
  for (const ir of interfaceResults) {
    const irId = makeUuid('1b010000', ir.i);
    const hoursAgo = ir.i * 2;
    await prisma.labInterfaceResult.upsert({
      where: { id: irId },
      update: {},
      create: {
        id: irId,
        instrumentId: makeUuid('1a010000', ir.instIdx),
        rawData: { fileName: ir.file, itemCount: ir.items.length },
        parsedItems: ir.items,
        sampleBarcode: ir.barcode,
        fileName: ir.file,
        status: ir.status,
        receivedAt: new Date(Date.now() - hoursAgo * 3600000),
        appliedAt: ir.status === 'APPLIED' ? new Date(Date.now() - (hoursAgo - 1) * 3600000) : undefined,
      },
    });
    irCount++;
  }
  console.log(`     → ${labInstruments.length} lab instruments + ${irCount} interface results seeded`);

  // ── 검사기록지 (LabWorksheet) ──
  const labTechUserId = uid(P.USER, 15); // 문검사
  const labOrders = await prisma.order.findMany({
    where: { department: 'LAB' },
    select: { id: true, status: true },
    take: 20,
  });

  const worksheets = [
    { i: 1, name: '2026-05-19 혈액검사 오전 1번', category: 'HEMATOLOGY', instIdx: 1, date: '2026-05-19', status: 'SIGNED', notes: '오전 정규 CBC 배치' },
    { i: 2, name: '2026-05-19 생화학검사 오전', category: 'CHEMISTRY', instIdx: 2, date: '2026-05-19', status: 'COMPLETED', notes: 'Cobas c702 오전 배치' },
    { i: 3, name: '2026-05-19 면역검사', category: 'IMMUNOLOGY', instIdx: 3, date: '2026-05-19', status: 'IN_PROGRESS', notes: '갑상선 + 종양마커' },
    { i: 4, name: '2026-05-19 응고검사', category: 'COAGULATION', instIdx: 4, date: '2026-05-19', status: 'OPEN', notes: 'PT/aPTT 오후 배치' },
    { i: 5, name: '2026-05-19 혈액검사 오전 2번', category: 'HEMATOLOGY', instIdx: 1, date: '2026-05-19', status: 'SIGNED', notes: '응급 CBC + Diff 추가분' },
    { i: 6, name: '2026-05-18 생화학검사 오후', category: 'CHEMISTRY', instIdx: 7, date: '2026-05-18', status: 'SIGNED', notes: 'AU5800 오후 배치 — 간기능+신기능' },
    { i: 7, name: '2026-05-18 요검사', category: 'URINALYSIS', instIdx: 6, date: '2026-05-18', status: 'SIGNED', notes: '정규 요검사' },
    { i: 8, name: '2026-05-18 혈액가스', category: 'BLOOD_GAS', instIdx: 5, date: '2026-05-18', status: 'SIGNED', notes: '응급실 ABGA' },
    { i: 9, name: '2026-05-17 생화학검사 오전', category: 'CHEMISTRY', instIdx: 2, date: '2026-05-17', status: 'SIGNED', notes: '지질검사 포함' },
    { i: 10, name: '2026-05-19 혈액검사 오후', category: 'HEMATOLOGY', instIdx: 1, date: '2026-05-19', status: 'OPEN', notes: '오후 정규 배치 대기' },
  ];

  let wsCount = 0;
  for (const ws of worksheets) {
    const wsId = makeUuid('1c010000', ws.i);
    const signedAt = ws.status === 'SIGNED' ? new Date(`${ws.date}T16:00:00`) : undefined;
    await prisma.labWorksheet.upsert({
      where: { id: wsId },
      update: { status: ws.status },
      create: {
        id: wsId,
        name: ws.name,
        instrumentId: makeUuid('1a010000', ws.instIdx),
        category: ws.category,
        date: new Date(ws.date),
        technicianId: labTechUserId,
        status: ws.status,
        signedBy: ws.status === 'SIGNED' ? labTechUserId : undefined,
        signedAt,
        notes: ws.notes,
      },
    });

    // 각 워크시트에 검체 항목 추가 (3~6개씩)
    const itemCount = 3 + (ws.i % 4); // 3~6개
    for (let seq = 1; seq <= itemCount; seq++) {
      const itemId = makeUuid('1d010000', ws.i * 100 + seq);
      const orderIdx = (ws.i * 3 + seq) % labOrders.length;
      const order = labOrders[orderIdx];
      if (!order) continue;

      const barcode = `S2026051${ws.date.slice(-1)}-${String(ws.i * 10 + seq).padStart(3, '0')}`;
      const sampleStatuses = ['NORMAL', 'NORMAL', 'NORMAL', 'NORMAL', 'HEMOLYSIS', 'LIPEMIA', 'INSUFFICIENT'];
      const sampleStatus = sampleStatuses[(ws.i + seq) % sampleStatuses.length];
      const itemStatuses = ws.status === 'SIGNED' ? 'VERIFIED' : ws.status === 'COMPLETED' ? 'TESTED' : 'PENDING';

      await prisma.labWorksheetItem.upsert({
        where: { id: itemId },
        update: {},
        create: {
          id: itemId,
          worksheetId: wsId,
          orderId: order.id,
          sequence: seq,
          sampleBarcode: barcode,
          sampleStatus,
          status: itemStatuses,
        },
      });
    }
    wsCount++;
  }
  console.log(`     → ${wsCount} lab worksheets seeded`);

  // ── 수탁기관 + 위탁검사 (ReferenceLab, LabSendOut) ──
  const refLabs = [
    { i: 1, name: '가상검사재단A', code: 'LAB-A', contact: { phone: '02-000-0000', email: 'service@scl.example' } },
    { i: 2, name: '가상검사재단B', code: 'LAB-B', contact: { phone: '02-000-0000', email: 'lab@gclabs.example' } },
    { i: 3, name: '가상검사재단C', code: 'LAB-C', contact: { phone: '02-000-0000', email: 'info@samkwang.example' } },
    { i: 4, name: '가상검사재단D', code: 'LAB-D', contact: { phone: '02-000-0000', email: 'lab@eone.example' } },
  ];
  for (const lab of refLabs) {
    const labId = makeUuid('1e010000', lab.i);
    await prisma.referenceLab.upsert({
      where: { code: lab.code },
      update: { name: lab.name, contactInfo: lab.contact },
      create: { id: labId, name: lab.name, code: lab.code, contactInfo: lab.contact },
    });
  }

  // 카탈로그 (SCL 기준)
  const sclId = (await prisma.referenceLab.findUnique({ where: { code: 'LAB-A' } }))!.id;
  const gcId = (await prisma.referenceLab.findUnique({ where: { code: 'LAB-B' } }))!.id;
  const catalogItems = [
    { i: 1, labId: sclId, code: 'GN-BRCA', name: 'BRCA 1/2 (NGS)', tat: 14, price: 350000, sample: 'EDTA', vol: 'EDTA Blood 5mL', cat: 'GENETICS' },
    { i: 2, labId: sclId, code: 'GN-HLA', name: 'HLA Typing (NGS)', tat: 5, price: 180000, sample: 'EDTA', vol: 'EDTA Blood 10mL', cat: 'GENETICS' },
    { i: 3, labId: sclId, code: 'GN-PANEL', name: 'Oncomine Comprehensive Plus (564 유전자)', tat: 14, price: 800000, sample: 'FFPE', vol: 'FFPE Tissue 10 slides', cat: 'GENETICS' },
    { i: 4, labId: sclId, code: 'GN-WES', name: 'Whole Exome Sequencing', tat: 21, price: 1200000, sample: 'EDTA', vol: 'EDTA Blood 5mL', cat: 'GENETICS' },
    { i: 5, labId: sclId, code: 'PGX-01', name: '약물유전체 패널 (CYP2D6/CYP2C19)', tat: 7, price: 250000, sample: 'EDTA', vol: 'EDTA Blood 3mL', cat: 'GENETICS' },
    { i: 6, labId: gcId, code: 'SP-TB', name: 'TB-PCR (결핵균 PCR)', tat: 3, price: 45000, sample: 'SPUTUM', vol: 'Sputum 3mL', cat: 'SPECIAL' },
    { i: 7, labId: gcId, code: 'SP-HIV', name: 'HIV RNA (정량)', tat: 5, price: 120000, sample: 'EDTA', vol: 'EDTA Blood 5mL', cat: 'SPECIAL' },
    { i: 8, labId: gcId, code: 'SP-HCV', name: 'HCV RNA (정량)', tat: 5, price: 95000, sample: 'SERUM', vol: 'Serum 3mL', cat: 'SPECIAL' },
    { i: 9, labId: sclId, code: 'CT-NK', name: 'NK 세포 활성도 검사', tat: 7, price: 200000, sample: 'EDTA', vol: 'EDTA Blood 10mL', cat: 'CELL_THERAPY' },
    { i: 10, labId: gcId, code: 'GN-LIQUID', name: 'Liquid Biopsy (Guardant360)', tat: 10, price: 950000, sample: 'EDTA', vol: 'cfDNA Streck Tube 10mL×2', cat: 'GENETICS' },
  ];
  for (const cat of catalogItems) {
    const catId = makeUuid('1f010000', cat.i);
    await prisma.labSendOutCatalog.upsert({
      where: { id: catId },
      update: { testName: cat.name, turnaroundDays: cat.tat, price: cat.price },
      create: { id: catId, referenceLabId: cat.labId, testCode: cat.code, testName: cat.name, turnaroundDays: cat.tat, price: cat.price, sampleType: cat.sample, sampleVolume: cat.vol, category: cat.cat },
    });
  }

  // 위탁검사 건 (다양한 상태)
  const sendOutItems = [
    { i: 1, patIdx: 9, labCode: 'SCL', test: 'BRCA 1/2 (NGS)', sample: 'EDTA', status: 'TESTING', daysAgo: 5, track: 'TRK-20260514-001', info: '유방암 가족력, BRCA 검사' },
    { i: 2, patIdx: 3, labCode: 'LAB-B', test: '약물유전체 패널', sample: 'EDTA', status: 'IN_TRANSIT', daysAgo: 3, track: 'TRK-20260516-002', info: '항경련제 약물 대사 확인' },
    { i: 3, patIdx: 11, labCode: 'SCL', test: 'HLA Typing (NGS)', sample: 'EDTA', status: 'RESULT_RECEIVED', daysAgo: 8, track: 'TRK-20260511-003', info: '골수이식 전 HLA 검사' },
    { i: 4, patIdx: 19, labCode: 'LAB-B', test: 'HIV RNA (정량)', sample: 'EDTA', status: 'REPORTED', daysAgo: 12, track: 'TRK-20260507-004', info: '수술 전 검사' },
    { i: 5, patIdx: 4, labCode: 'SCL', test: 'Oncomine Panel (564 유전자)', sample: 'FFPE', status: 'TESTING', daysAgo: 4, track: 'TRK-20260515-005', info: '폐암 표적치료 유전자 패널' },
    { i: 6, patIdx: 6, labCode: 'SCL', test: 'Whole Exome Sequencing', sample: 'EDTA', status: 'ORDERED', daysAgo: 1, track: null, info: '진단 미확정 희귀질환' },
    { i: 7, patIdx: 7, labCode: 'LAB-B', test: 'Liquid Biopsy (Guardant360)', sample: 'EDTA', status: 'SENT', daysAgo: 2, track: 'TRK-20260517-007', info: '대장암 치료 반응 모니터링' },
    { i: 8, patIdx: 1, labCode: 'LAB-B', test: 'TB-PCR (결핵균)', sample: 'SPUTUM', status: 'REPORTED', daysAgo: 15, track: 'TRK-20260504-008', info: '폐결핵 의심' },
  ];
  let soCount = 0;
  for (const so of sendOutItems) {
    const soId = makeUuid('1e020000', so.i);
    const refLab = await prisma.referenceLab.findUnique({ where: { code: so.labCode } });
    if (!refLab) continue;
    const createdAt = new Date(); createdAt.setDate(createdAt.getDate() - so.daysAgo);
    const expectedDate = new Date(createdAt); expectedDate.setDate(expectedDate.getDate() + 14);

    await prisma.labSendOut.upsert({
      where: { id: soId },
      update: { status: so.status },
      create: {
        id: soId, patientId: uid(P.PATIENT, so.patIdx), referenceLabId: refLab.id,
        testName: so.test, sampleType: so.sample, clinicalInfo: so.info,
        trackingNumber: so.track, status: so.status, requestedBy: labTechUserId,
        sentAt: so.status !== 'ORDERED' ? createdAt : undefined,
        expectedDate,
        resultReceivedAt: so.status === 'RESULT_RECEIVED' || so.status === 'REPORTED' ? new Date() : undefined,
        resultSummary: so.status === 'REPORTED' ? '검사 완료 — 결과 정상' : undefined,
      },
    });
    soCount++;
  }
  console.log(`     → ${refLabs.length} reference labs + ${catalogItems.length} catalog + ${soCount} send-outs seeded`);

  // ── 세포치료 배치 (CellTherapyBatch) ──
  const cellBatches = [
    { i: 1, patIdx: 4, cell: 'CAR_T', source: 'AUTOLOGOUS', daysAgo: 4, dose: '1×10^6 cells/kg', status: 'CULTURE', notes: 'CD19 CAR-T 제조' },
    { i: 2, patIdx: 9, cell: 'NK', source: 'ALLOGENEIC', daysAgo: 7, dose: '5×10^7 cells', status: 'QC_TESTING', notes: 'NK 세포 확장 배양' },
    { i: 3, patIdx: 11, cell: 'MSC', source: 'AUTOLOGOUS', daysAgo: 14, dose: '2×10^6 cells/kg', status: 'RELEASED', notes: '골수 유래 MSC' },
    { i: 4, patIdx: 19, cell: 'DC', source: 'AUTOLOGOUS', daysAgo: 21, dose: '1×10^7 cells', status: 'ADMINISTERED', notes: '수지상세포 면역치료' },
    { i: 5, patIdx: 6, cell: 'CAR_T', source: 'AUTOLOGOUS', daysAgo: 1, dose: '1×10^6 cells/kg', status: 'COLLECTED', notes: 'BCMA CAR-T 다발골수종' },
  ];
  for (const cb of cellBatches) {
    const batchId = makeUuid('20010000', cb.i);
    const collDate = new Date(); collDate.setDate(collDate.getDate() - cb.daysAgo);
    const batchNum = `CT-2026-05${String(19 - cb.daysAgo + 1).padStart(2, '0')}-${String(cb.i).padStart(3, '0')}`;

    await prisma.cellTherapyBatch.upsert({
      where: { batchNumber: batchNum },
      update: { status: cb.status },
      create: {
        id: batchId, patientId: uid(P.PATIENT, cb.patIdx), batchNumber: batchNum,
        cellType: cb.cell, sourceType: cb.source, collectionDate: collDate,
        processingStart: cb.daysAgo > 1 ? new Date(collDate.getTime() + 86400000) : undefined,
        targetDose: cb.dose, status: cb.status, notes: cb.notes,
      },
    });

    // 환경 로그 (배양 중인 배치에 매일 기록)
    if (['CULTURE', 'QC_TESTING', 'RELEASED', 'ADMINISTERED'].includes(cb.status)) {
      for (let d = 0; d < Math.min(cb.daysAgo, 14); d++) {
        const envId = makeUuid('21010000', cb.i * 100 + d);
        const recAt = new Date(collDate.getTime() + (d + 1) * 86400000);
        const tempNoise = Math.sin(d * 1.5 + cb.i) * 0.3;
        const temp = parseFloat((37.0 + tempNoise).toFixed(1));
        const co2 = parseFloat((5.0 + Math.sin(d * 2 + cb.i) * 0.3).toFixed(1));
        const hum = parseFloat((95.0 + Math.sin(d * 0.8) * 2).toFixed(1));
        const isAlert = temp < 36.0 || temp > 38.0 || co2 < 4.0 || co2 > 6.0;
        await prisma.cellEnvironmentLog.upsert({
          where: { id: envId }, update: {},
          create: { id: envId, batchId, temperature: temp, co2Percent: co2, humidity: hum, recordedAt: recAt, recordedBy: labTechUserId, isAlert },
        });
      }
    }

    // QC 검사 (QC_TESTING 이상 상태)
    if (['QC_TESTING', 'RELEASED', 'ADMINISTERED'].includes(cb.status)) {
      const qcTypes = [
        { type: 'CELL_COUNT', result: '3.2×10^8', unit: 'cells', pass: 'PASS' },
        { type: 'VIABILITY', result: '96.5', unit: '%', pass: 'PASS' },
        { type: 'STERILITY', result: 'Negative', unit: '', pass: 'PASS' },
        { type: 'ENDOTOXIN', result: '< 0.5', unit: 'EU/mL', pass: 'PASS' },
        { type: 'MYCOPLASMA', result: 'Negative', unit: '', pass: cb.status === 'QC_TESTING' ? 'PENDING' : 'PASS' },
      ];
      for (let q = 0; q < qcTypes.length; q++) {
        const qcId = makeUuid('22010000', cb.i * 100 + q);
        await prisma.cellQcTest.upsert({
          where: { id: qcId }, update: {},
          create: {
            id: qcId, batchId, testType: qcTypes[q].type, result: qcTypes[q].result,
            unit: qcTypes[q].unit, passFail: qcTypes[q].pass, testedAt: new Date(), testedBy: labTechUserId,
          },
        });
      }
    }
  }
  console.log(`     → ${cellBatches.length} cell therapy batches seeded`);

  // ── 유전체 검사 (GenomicTest) ──
  const genomicTests = [
    { i: 1, patIdx: 4, type: 'TARGETED_PANEL', panel: 'Oncomine Comprehensive Plus (564)', sample: 'FFPE', status: 'ANALYSIS', daysAgo: 8, variants: [
      { gene: 'EGFR', chr: 'chr7', vtype: 'SNV', class: 'PATHOGENIC', tier: 'TIER_1', vaf: 0.45, hgvsC: 'c.2573T>G', hgvsP: 'p.Leu858Arg', sig: 'Osimertinib 감수성' },
      { gene: 'TP53', chr: 'chr17', vtype: 'SNV', class: 'PATHOGENIC', tier: 'TIER_2', vaf: 0.32, hgvsC: 'c.524G>A', hgvsP: 'p.Arg175His', sig: '예후 불량 인자' },
      { gene: 'KRAS', chr: 'chr12', vtype: 'SNV', class: 'LIKELY_PATHOGENIC', tier: 'TIER_1', vaf: 0.185, hgvsC: 'c.34G>T', hgvsP: 'p.Gly12Cys', sig: 'Sotorasib 감수성' },
    ]},
    { i: 2, patIdx: 9, type: 'BRCA', panel: 'BRCA 1/2', sample: 'BLOOD', status: 'REPORTED', daysAgo: 15, variants: [
      { gene: 'BRCA1', chr: 'chr17', vtype: 'INDEL', class: 'PATHOGENIC', tier: 'TIER_1', vaf: 0.50, hgvsC: 'c.5266dupC', hgvsP: 'p.Gln1756ProfsTer74', sig: 'BRCA1 병원성 변이, PARP 억제제 대상' },
    ]},
    { i: 3, patIdx: 7, type: 'LIQUID_BIOPSY', panel: 'Guardant360', sample: 'cfDNA', status: 'SEQUENCING', daysAgo: 5, variants: [] },
    { i: 4, patIdx: 11, type: 'PHARMACOGENOMICS', panel: 'CYP 패널', sample: 'BLOOD', status: 'COUNSELED', daysAgo: 20, variants: [
      { gene: 'CYP2D6', chr: 'chr22', vtype: 'SNV', class: 'VUS', tier: 'TIER_3', vaf: 0.50, hgvsC: 'c.100C>T', hgvsP: 'p.Pro34Ser', sig: '코데인 대사 저하 가능' },
      { gene: 'CYP2C19', chr: 'chr10', vtype: 'SNV', class: 'PATHOGENIC', tier: 'TIER_1', vaf: 0.50, hgvsC: 'c.681G>A', hgvsP: '*2', sig: 'Clopidogrel 저반응자 — 대체 항혈소판제 권고' },
    ]},
    { i: 5, patIdx: 3, type: 'WES', panel: null, sample: 'BLOOD', status: 'EXTRACTION', daysAgo: 3, variants: [] },
  ];
  for (const gt of genomicTests) {
    const gtId = makeUuid('23010000', gt.i);
    const orderedAt = new Date(); orderedAt.setDate(orderedAt.getDate() - gt.daysAgo);
    await prisma.genomicTest.upsert({
      where: { id: gtId },
      update: { status: gt.status },
      create: {
        id: gtId, patientId: uid(P.PATIENT, gt.patIdx), testType: gt.type,
        panelName: gt.panel, sampleType: gt.sample, status: gt.status,
        orderedBy: labTechUserId, orderedAt,
        reportedAt: gt.status === 'REPORTED' || gt.status === 'COUNSELED' ? new Date() : undefined,
        counseledAt: gt.status === 'COUNSELED' ? new Date() : undefined,
        counselNotes: gt.status === 'COUNSELED' ? '유전상담 완료. CYP2C19*2 보유 → Clopidogrel 대신 Ticagrelor 권고.' : undefined,
      },
    });
    for (let v = 0; v < gt.variants.length; v++) {
      const vr = gt.variants[v];
      const vrId = makeUuid('24010000', gt.i * 100 + v);
      await prisma.genomicVariant.upsert({
        where: { id: vrId }, update: {},
        create: {
          id: vrId, genomicTestId: gtId, gene: vr.gene, chromosome: vr.chr,
          variantType: vr.vtype, classification: vr.class, actionability: vr.tier,
          alleleFreq: vr.vaf, hgvsC: vr.hgvsC, hgvsP: vr.hgvsP, clinicalSig: vr.sig,
        },
      });
    }
  }
  console.log(`     → ${genomicTests.length} genomic tests seeded`);

  // ── 정도관리 QC 기록 (LabQcRecord) ──
  const qcTestCodes = [
    { code: 'GLU', name: 'Glucose', mean: 100.0, sd: 3.5 },
    { code: 'BUN', name: 'BUN', mean: 15.0, sd: 1.2 },
    { code: 'CRE', name: 'Creatinine', mean: 1.10, sd: 0.08 },
    { code: 'AST', name: 'AST', mean: 35.0, sd: 2.5 },
    { code: 'WBC', name: 'WBC', mean: 7.5, sd: 0.4 },
    { code: 'HGB', name: 'Hemoglobin', mean: 14.0, sd: 0.3 },
  ];
  let qcRecCount = 0;
  // Cobas c702 (instIdx=2)와 Sysmex XN-1000 (instIdx=1) 10일치
  for (const instIdx of [1, 2]) {
    const instId = makeUuid('1a010000', instIdx);
    const codes = instIdx === 1 ? qcTestCodes.slice(4) : qcTestCodes.slice(0, 4); // 혈액:WBC,HGB / 생화학:GLU,BUN,CRE,AST
    for (const tc of codes) {
      for (let d = 0; d < 10; d++) {
        for (const level of ['LEVEL_1', 'LEVEL_2']) {
          const recId = makeUuid('25010000', qcRecCount);
          const perfAt = new Date(); perfAt.setDate(perfAt.getDate() - d);
          const noise = Math.sin(d * 2.1 + qcRecCount * 0.7) * tc.sd * 1.5;
          const measured = parseFloat((tc.mean + noise).toFixed(3));
          const zScore = parseFloat(((measured - tc.mean) / tc.sd).toFixed(2));
          let westgard: string | null = null;
          let accepted = true;
          if (Math.abs(zScore) > 3) { westgard = '1-3s'; accepted = false; }
          else if (Math.abs(zScore) > 2) { westgard = '1-2s'; }

          await prisma.labQcRecord.upsert({
            where: { id: recId }, update: {},
            create: {
              id: recId, instrumentId: instId, qcLevel: level, testCode: tc.code,
              measuredValue: measured, targetMean: tc.mean, targetSD: tc.sd,
              zScore, westgardRule: westgard, isAccepted: accepted,
              performedAt: perfAt, performedBy: labTechUserId,
            },
          });
          qcRecCount++;
        }
      }
    }
  }
  console.log(`     → ${qcRecCount} QC records seeded`);

  // ── 혈액은행 (BloodProduct + CrossMatch + TransfusionOrder) ──
  const bloodProducts = [
    { i: 1, unit: 'K-2026-0501-001', type: 'PRBC', bt: 'A+', rh: 'POS', vol: 320, days: 30, supplier: '대한적십자사 서울혈액원', loc: '혈액냉장고 1번' },
    { i: 2, unit: 'K-2026-0501-002', type: 'PRBC', bt: 'A+', rh: 'POS', vol: 320, days: 28, supplier: '대한적십자사 서울혈액원', loc: '혈액냉장고 1번' },
    { i: 3, unit: 'K-2026-0502-003', type: 'PRBC', bt: 'O+', rh: 'POS', vol: 320, days: 25, supplier: '대한적십자사 서울혈액원', loc: '혈액냉장고 1번' },
    { i: 4, unit: 'K-2026-0502-004', type: 'PRBC', bt: 'O+', rh: 'POS', vol: 320, days: 22, supplier: '대한적십자사 서울혈액원', loc: '혈액냉장고 1번' },
    { i: 5, unit: 'K-2026-0503-005', type: 'PRBC', bt: 'O-', rh: 'NEG', vol: 320, days: 20, supplier: '대한적십자사 경기혈액원', loc: '혈액냉장고 2번' },
    { i: 6, unit: 'K-2026-0503-006', type: 'PRBC', bt: 'B+', rh: 'POS', vol: 320, days: 18, supplier: '대한적십자사 서울혈액원', loc: '혈액냉장고 1번' },
    { i: 7, unit: 'K-2026-0504-007', type: 'PRBC', bt: 'AB+', rh: 'POS', vol: 320, days: 15, supplier: '대한적십자사 서울혈액원', loc: '혈액냉장고 1번' },
    { i: 8, unit: 'K-2026-0510-008', type: 'PRBC', bt: 'A-', rh: 'NEG', vol: 320, days: 5, supplier: '대한적십자사 경기혈액원', loc: '혈액냉장고 2번' },
    { i: 9, unit: 'K-2026-0515-009', type: 'PRBC', bt: 'O+', rh: 'POS', vol: 320, days: 3, supplier: '대한적십자사 서울혈액원', loc: '혈액냉장고 1번' },
    { i: 10, unit: 'F-2026-0505-001', type: 'FFP', bt: 'A+', rh: 'POS', vol: 200, days: 360, supplier: '대한적십자사 서울혈액원', loc: '혈액냉동고' },
    { i: 11, unit: 'F-2026-0505-002', type: 'FFP', bt: 'O+', rh: 'POS', vol: 200, days: 350, supplier: '대한적십자사 서울혈액원', loc: '혈액냉동고' },
    { i: 12, unit: 'F-2026-0505-003', type: 'FFP', bt: 'AB+', rh: 'POS', vol: 200, days: 340, supplier: '대한적십자사 서울혈액원', loc: '혈액냉동고' },
    { i: 13, unit: 'F-2026-0506-004', type: 'FFP', bt: 'B+', rh: 'POS', vol: 200, days: 330, supplier: '대한적십자사 경기혈액원', loc: '혈액냉동고' },
    { i: 14, unit: 'P-2026-0517-001', type: 'PC', bt: 'A+', rh: 'POS', vol: 50, days: 3, supplier: '대한적십자사 서울혈액원', loc: '혈소판 교반기' },
    { i: 15, unit: 'P-2026-0517-002', type: 'PC', bt: 'O+', rh: 'POS', vol: 50, days: 3, supplier: '대한적십자사 서울혈액원', loc: '혈소판 교반기' },
    { i: 16, unit: 'P-2026-0518-003', type: 'PC', bt: 'B+', rh: 'POS', vol: 50, days: 2, supplier: '대한적십자사 서울혈액원', loc: '혈소판 교반기' },
    { i: 17, unit: 'C-2026-0501-001', type: 'CRYO', bt: 'A+', rh: 'POS', vol: 30, days: 360, supplier: '대한적십자사 서울혈액원', loc: '혈액냉동고' },
    { i: 18, unit: 'C-2026-0501-002', type: 'CRYO', bt: 'O+', rh: 'POS', vol: 30, days: 350, supplier: '대한적십자사 서울혈액원', loc: '혈액냉동고' },
    // 출고/수혈된 제제
    { i: 19, unit: 'K-2026-0510-010', type: 'PRBC', bt: 'A+', rh: 'POS', vol: 320, days: 10, supplier: '대한적십자사 서울혈액원', loc: '혈액냉장고 1번', status: 'TRANSFUSED' },
    { i: 20, unit: 'K-2026-0512-011', type: 'PRBC', bt: 'O+', rh: 'POS', vol: 320, days: 8, supplier: '대한적십자사 서울혈액원', loc: '혈액냉장고 1번', status: 'ISSUED' },
  ];
  for (const bp of bloodProducts) {
    const bpId = makeUuid('26010000', bp.i);
    // 🔴 종전 결함: 채혈일을 제제 종류와 무관하게 `입고 - 5일` 로 두었다. 혈소판(PC)은 유효기간이
    //    채혈 후 **5일**이라, 이 식에서는 `만료일 = 오늘 - days` 가 되어 **어떤 days 값에서도 이미 만료**다.
    //    그런데 status 는 기본값 'AVAILABLE' 이라 만료 3일 지난 혈소판 3유닛이 출고 가능 재고로 떠 있었고,
    //    그 중 한 유닛에는 'COMPATIBLE' 교차시험까지 붙어 있었다(수혈 출고 게이트를 우회하는 상태).
    const COLLECT_TO_RECEIVE_DAYS: Record<string, number> = { PC: 1 }; // 혈소판은 채혈 다음날 입고(유효기간 5일)
    const lagDays = COLLECT_TO_RECEIVE_DAYS[bp.type] ?? 5;
    const collected = new Date(); collected.setDate(collected.getDate() - bp.days - lagDays);
    const received = new Date(); received.setDate(received.getDate() - bp.days);
    const expires = new Date(collected);
    if (bp.type === 'PRBC') expires.setDate(expires.getDate() + 35);
    else if (bp.type === 'FFP' || bp.type === 'CRYO') expires.setFullYear(expires.getFullYear() + 1);
    else if (bp.type === 'PC') expires.setDate(expires.getDate() + 5);
    // 🔴 상태는 만료일에서 **파생**한다 — 날짜와 상태가 각자 다른 근거를 쓰면 반드시 갈라진다.
    const declaredStatus = (bp as any).status as string | undefined;
    const derivedStatus = declaredStatus ?? (expires.getTime() > Date.now() ? 'AVAILABLE' : 'EXPIRED');

    await prisma.bloodProduct.upsert({
      where: { unitNumber: bp.unit },
      update: {},
      create: {
        id: bpId, unitNumber: bp.unit, productType: bp.type,
        bloodType: bp.bt.replace(/[+-]/g, ''), rhFactor: bp.rh, volume: bp.vol, // 부호 제거 — 게이트 ABO 판정은 A/B/O/AB(R2-1)
        collectedAt: collected, expiresAt: expires, receivedAt: received,
        supplierName: bp.supplier, storageLocation: bp.loc,
        status: derivedStatus,
      },
    });
  }

  // 수혈 오더
  const transfusionOrders = [
    { i: 1, patIdx: 9, type: 'PRBC', units: 2, urgency: 'URGENT', indication: 'Hb 6.8, 수술 후 활동성 출혈', status: 'COMPLETED' },
    { i: 2, patIdx: 4, type: 'PRBC', units: 1, urgency: 'ROUTINE', indication: 'Hb 7.5, 만성 빈혈', status: 'ORDERED' },
    { i: 3, patIdx: 11, type: 'FFP', units: 2, urgency: 'URGENT', indication: 'PT INR 3.5, 수술 전 교정', status: 'CROSSMATCHING' },
    { i: 4, patIdx: 19, type: 'PC', units: 6, urgency: 'EMERGENT', indication: 'PLT 15,000, 활동성 출혈', status: 'IN_PROGRESS' },
    { i: 5, patIdx: 3, type: 'PRBC', units: 2, urgency: 'ROUTINE', indication: 'Hb 8.0, 항암 후 빈혈', status: 'READY' },
  ];
  for (const to of transfusionOrders) {
    const toId = makeUuid('27010000', to.i);
    await prisma.transfusionOrder.upsert({
      where: { id: toId },
      update: { status: to.status },
      create: {
        id: toId, patientId: uid(P.PATIENT, to.patIdx),
        orderedBy: kimNaegwaId, productType: to.type, units: to.units,
        urgency: to.urgency, indication: to.indication, status: to.status,
      },
    });
  }

  // 혈액형 확정(2회 검사) — 출고 게이트 전제(patientBloodTyping 없으면 'ABO 미확정' 차단, R2-1)
  const typings = [
    { patIdx: 9, abo: 'A', rh: 'POS' }, { patIdx: 4, abo: 'AB', rh: 'POS' },
    { patIdx: 11, abo: 'O', rh: 'POS' }, { patIdx: 19, abo: 'A', rh: 'POS' }, { patIdx: 3, abo: 'B', rh: 'POS' },
  ];
  for (const t of typings) {
    await prisma.patientBloodTyping.upsert({
      where: { patientId: uid(P.PATIENT, t.patIdx) },
      update: {},
      create: {
        patientId: uid(P.PATIENT, t.patIdx), typedBy: labTechUserId, typedAt: new Date(),
        method: 'TUBE', abo: t.abo, rh: t.rh, aboConfirm: t.abo,
      },
    });
  }

  // 교차시험
  const crossmatches = [
    { i: 1, patIdx: 9, bpIdx: 19, result: 'COMPATIBLE', method: 'GEL_CARD' },
    { i: 2, patIdx: 4, bpIdx: 1, result: 'COMPATIBLE', method: 'GEL_CARD' },
    { i: 3, patIdx: 11, bpIdx: 10, result: 'COMPATIBLE', method: 'TUBE' },
    { i: 4, patIdx: 19, bpIdx: 14, result: 'COMPATIBLE', method: 'GEL_CARD' },
  ];
  for (const cm of crossmatches) {
    const cmId = makeUuid('28010000', cm.i);
    const validUntil = new Date(); validUntil.setHours(validUntil.getHours() + 72);
    await prisma.bloodCrossmatch.upsert({
      where: { id: cmId },
      update: {},
      create: {
        id: cmId, patientId: uid(P.PATIENT, cm.patIdx),
        bloodProductId: makeUuid('26010000', cm.bpIdx),
        requestedBy: kimNaegwaId, testedBy: labTechUserId,
        testedAt: new Date(), method: cm.method, result: cm.result,
        antibodyScreen: 'NEGATIVE', validUntil,
      },
    });
  }

  // 수혈 기록 (완료 1건)
  const txId = makeUuid('29010000', 1);
  await prisma.bloodTransfusion.upsert({
    where: { id: txId },
    update: {},
    create: {
      id: txId,
      orderId: makeUuid('27010000', 1), // 수혈 오더 1
      bloodProductId: makeUuid('26010000', 19), // 수혈 완료 제제
      patientId: uid(P.PATIENT, 9),
      verifiedByNurse1: uid(P.USER, 10), // 조간호
      verifiedByNurse2: uid(P.USER, 12), // 윤간호
      verificationTime: new Date(Date.now() - 4 * 3600000),
      startTime: new Date(Date.now() - 4 * 3600000),
      endTime: new Date(),
      rate: 80,
      volumeTransfused: 320,
      vitalSigns: [
        { timing: 'PRE', temp: 36.5, bp: '120/75', hr: 78, spo2: 98, time: new Date(Date.now() - 4 * 3600000).toISOString() },
        { timing: '15MIN', temp: 36.6, bp: '118/72', hr: 80, spo2: 99, time: new Date(Date.now() - 3.75 * 3600000).toISOString() },
        { timing: '1HR', temp: 36.7, bp: '122/78', hr: 76, spo2: 99, time: new Date(Date.now() - 3 * 3600000).toISOString() },
        { timing: 'POST', temp: 36.5, bp: '118/74', hr: 74, spo2: 99, time: new Date().toISOString() },
      ],
      status: 'COMPLETED',
    },
  });

  console.log(`     → ${bloodProducts.length} blood products + ${transfusionOrders.length} orders + ${crossmatches.length} crossmatches + 1 transfusion seeded`);

  // ── 수술실 (OperatingRoom) ──
  const orRooms = [
    { i: 1, name: 'OR-1', floor: '3F', type: 'GENERAL', equip: ['전기소작기', 'C-Arm'] },
    { i: 2, name: 'OR-2', floor: '3F', type: 'GENERAL', equip: ['전기소작기', '복강경 세트'] },
    { i: 3, name: 'OR-3', floor: '3F', type: 'ORTHO', equip: ['전기소작기', 'C-Arm', '정형 세트'] },
    { i: 4, name: 'OR-4', floor: '3F', type: 'CARDIAC', equip: ['인공심폐기', '초음파'] },
    { i: 5, name: '외래 시술실', floor: '2F', type: 'MINOR_PROCEDURE', equip: ['전기소작기'] },
  ];
  for (const or of orRooms) {
    const orId = makeUuid('2a010000', or.i);
    await prisma.operatingRoom.upsert({
      where: { id: orId },
      update: { name: or.name },
      create: { id: orId, name: or.name, floor: or.floor, roomType: or.type, equipment: or.equip },
    });
  }
  // OR 스케줄
  const surgeryIds = await prisma.surgery.findMany({ select: { id: true, patientId: true, surgeonId: true }, take: 4 });
  for (let s = 0; s < Math.min(surgeryIds.length, 4); s++) {
    const osId = makeUuid('2a020000', s + 1);
    const statuses = ['COMPLETED', 'IN_PROGRESS', 'SCHEDULED', 'SCHEDULED'];
    await prisma.orSchedule.upsert({
      where: { id: osId }, update: {},
      create: {
        id: osId, roomId: makeUuid('2a010000', s + 1), surgeryId: surgeryIds[s].id,
        // 🔴 HH:MM 0 채움 — `9:00` 은 문자열 정렬에서 `10:00` 뒤로 가 수술 순서가 뒤집힌다
        //    (감시자 49b 가 시드 산출 행을 적발 — DTO 정규식은 API 만 막고 시드는 여기서 막는다)
        date: new Date(), startTime: `${String(9 + s * 2).padStart(2, '0')}:00`, endTime: `${String(11 + s * 2).padStart(2, '0')}:00`,
        estimatedDuration: 120, status: statuses[s],
        actualStartTime: s < 2 ? new Date(Date.now() - (4 - s) * 3600000) : undefined,
        actualEndTime: s === 0 ? new Date(Date.now() - 2 * 3600000) : undefined,
      },
    });
  }

  // 마취기록
  if (surgeryIds.length >= 2) {
    for (let a = 0; a < 2; a++) {
      const arId = makeUuid('2a030000', a + 1);
      const anesthetistId = uid(P.USER, 8); // 강응급 (의사)
      await prisma.anesthesiaRecord.upsert({
        where: { surgeryId: surgeryIds[a].id },
        update: {},
        create: {
          id: arId, surgeryId: surgeryIds[a].id, anesthetistId,
          asaClass: a === 0 ? 'II' : 'III', anesthesiaType: 'GENERAL', airwayType: 'ETT', ettSize: '7.5',
          inductionTime: new Date(Date.now() - (5 - a) * 3600000),
          intubationTime: new Date(Date.now() - (5 - a) * 3600000 + 5 * 60000),
          extubationTime: a === 0 ? new Date(Date.now() - 2.5 * 3600000) : undefined,
          inductionDrugs: [{ name: '프로포폴', dose: '200mg', time: '09:00' }, { name: '로쿠로늄', dose: '50mg', time: '09:02' }],
          maintenanceDrugs: [{ name: '세보플루란', dose: '2vol%', method: '흡입' }],
          reversal: a === 0 ? [{ name: '슈가마덱스', dose: '200mg' }] : undefined,
          fluidInput: [{ type: 'NS 1L', volume: 1000 }, { type: 'LR 500mL', volume: 500 }],
          ebl: a === 0 ? 350 : 150, urineOutput: a === 0 ? 300 : 200,
          vitalSigns: Array.from({ length: 6 }, (_, i) => ({
            time: new Date(Date.now() - (5 - a) * 3600000 + i * 30 * 60000).toISOString(),
            systolicBp: 110 + Math.round(Math.sin(i) * 10), diastolicBp: 70 + Math.round(Math.sin(i) * 5),
            heartRate: 72 + Math.round(Math.sin(i * 1.5) * 8), spo2: 99, etco2: 35 + Math.round(Math.sin(i) * 3),
          })),
        },
      });
    }
  }

  // PACU 기록
  if (surgeryIds.length >= 1) {
    const pacuId = makeUuid('2a040000', 1);
    await prisma.pacuRecord.upsert({
      where: { id: pacuId }, update: {},
      create: {
        id: pacuId, surgeryId: surgeryIds[0].id, patientId: surgeryIds[0].patientId,
        arrivalTime: new Date(Date.now() - 2 * 3600000),
        dischargeTime: new Date(Date.now() - 1 * 3600000),
        aldretScore: 9, painScore: 3, oxygenTherapy: 'Nasal 3L/min',
        disposition: 'WARD', nurseId: nurseChoId,
        vitalSigns: [
          { time: new Date(Date.now() - 2 * 3600000).toISOString(), temp: 36.2, bp: '115/70', hr: 74, spo2: 98, timing: 'ARRIVAL' },
          { time: new Date(Date.now() - 1.75 * 3600000).toISOString(), temp: 36.3, bp: '118/72', hr: 72, spo2: 99, timing: '15MIN' },
          { time: new Date(Date.now() - 1 * 3600000).toISOString(), temp: 36.5, bp: '120/75', hr: 70, spo2: 99, timing: 'DISCHARGE' },
        ],
        interventions: [{ time: '도착 시', action: '산소 투여', drug: 'O2 3L/min via nasal' }],
      },
    });
  }

  // WHO 수술 안전 체크리스트
  if (surgeryIds.length >= 2) {
    for (let c = 0; c < 2; c++) {
      const clId = makeUuid('2a050000', c + 1);
      const allDone = c === 0;
      await prisma.surgicalChecklist.upsert({
        where: { surgeryId: surgeryIds[c].id },
        update: {},
        create: {
          id: clId, surgeryId: surgeryIds[c].id,
          signInPatientId: true, signInSiteMarked: true, signInConsentSigned: true,
          signInAnesthesiaCheck: true, signInAllergyCheck: true,
          signInCompletedBy: nurseChoId, signInCompletedAt: new Date(Date.now() - 5 * 3600000),
          timeOutTeamIntro: true, timeOutPatientName: true, timeOutProcedure: true,
          timeOutSite: true, timeOutAntibiotics: allDone,
          timeOutCompletedBy: allDone ? nurseChoId : undefined,
          timeOutCompletedAt: allDone ? new Date(Date.now() - 4.5 * 3600000) : undefined,
          signOutProcedureRecorded: allDone, signOutInstrumentCount: allDone,
          signOutSpecimenLabeled: allDone, signOutRecoveryPlan: allDone,
          signOutCompletedBy: allDone ? nurseChoId : undefined,
          signOutCompletedAt: allDone ? new Date(Date.now() - 2 * 3600000) : undefined,
        },
      });
    }
  }
  console.log(`     → ${orRooms.length} operating rooms + schedules + anesthesia + PACU + checklists seeded`);

  // ── 영양 평가 + 식이 처방 ──
  const nutritionAssessments = [
    { i: 1, patIdx: 9, type: 'INITIAL', h: 170, w: 68, alb: 3.8, nrs: 2, risk: 'LOW', intake: 'ADEQUATE' },
    { i: 2, patIdx: 4, type: 'INITIAL', h: 165, w: 55, alb: 2.9, nrs: 4, risk: 'HIGH', intake: 'REDUCED' },
    { i: 3, patIdx: 11, type: 'INITIAL', h: 175, w: 82, alb: 3.5, nrs: 3, risk: 'MODERATE', intake: 'ADEQUATE' },
    { i: 4, patIdx: 19, type: 'FOLLOW_UP', h: 160, w: 48, alb: 2.5, nrs: 5, risk: 'HIGH', intake: 'MINIMAL' },
    { i: 5, patIdx: 3, type: 'INITIAL', h: 168, w: 72, alb: 4.0, nrs: 1, risk: 'LOW', intake: 'ADEQUATE' },
  ];
  for (const na of nutritionAssessments) {
    const naId = makeUuid('2b010000', na.i);
    const bmi = parseFloat((na.w / ((na.h / 100) ** 2)).toFixed(1));
    await prisma.nutritionAssessment.upsert({
      where: { id: naId },
      update: {},
      create: {
        id: naId, patientId: uid(P.PATIENT, na.patIdx),
        assessmentType: na.type, height: na.h, weight: na.w, bmi,
        albumin: na.alb, nrsScore: na.nrs, riskLevel: na.risk,
        intakeStatus: na.intake, assessedBy: nurseChoId,
      },
    });
  }

  const dietOrders = [
    { i: 1, patIdx: 9, admIdx: 1, diet: 'REGULAR', cal: 2000, prot: 70, texture: 'REGULAR' },
    { i: 2, patIdx: 4, admIdx: 2, diet: 'HIGH_PROTEIN', cal: 2200, prot: 100, texture: 'REGULAR' },
    { i: 3, patIdx: 11, admIdx: 3, diet: 'DIABETIC', cal: 1800, prot: 65, texture: 'REGULAR' },
    { i: 4, patIdx: 19, admIdx: 4, diet: 'RENAL', cal: 1600, prot: 40, texture: 'SOFT', fluid: 1500 },
    { i: 5, patIdx: 3, admIdx: 5, diet: 'LOW_SALT', cal: 1800, prot: 60, texture: 'REGULAR' },
  ];
  for (const d of dietOrders) {
    const doId = makeUuid('2c010000', d.i);
    // admissionId 조회
    const admission = await prisma.admission.findFirst({ where: { patientId: uid(P.PATIENT, d.patIdx) }, select: { id: true } });
    if (!admission) continue;
    await prisma.dietOrder.upsert({
      where: { id: doId },
      update: {},
      create: {
        id: doId, patientId: uid(P.PATIENT, d.patIdx), admissionId: admission.id,
        dietType: d.diet, calorieTarget: d.cal, proteinTarget: d.prot,
        fluidLimit: (d as any).fluid, texture: d.texture,
        orderedBy: kimNaegwaId, startDate: new Date(),
      },
    });
  }
  // 영양 상담
  const nutritionCounsels = [
    { i: 1, patIdx: 4, type: 'INITIAL', topic: '고단백 식이 교육', content: '항암 치료 중 단백질 섭취 증가 필요. 하루 100g 목표. 계란, 두부, 생선 위주 섭취 권고. 보조 영양제(뉴케어) 2캔/일 추가.', dur: 30, followUp: 7 },
    { i: 2, patIdx: 11, type: 'INITIAL', topic: '당뇨 식이 교육', content: '탄수화물 제한 (1일 200g 이하). 혈당 지수 낮은 식품 선택. 식후 30분 걷기 권장. 간식 시간 지도.', dur: 45, followUp: 14 },
    { i: 3, patIdx: 19, type: 'FOLLOW_UP', topic: '신장 식이 추적 상담', content: '단백질 40g/day 유지 중. 칼륨 제한 식이 지도 (바나나, 토마토 주의). 수분 1500mL 제한 교육.', dur: 20, followUp: 7 },
    { i: 4, patIdx: 9, type: 'DISCHARGE', topic: '퇴원 후 식이 안내', content: '일반식 가능. 수술 후 2주간 부드러운 음식 권장. 자극성 음식(매운 음식, 커피) 제한. 충분한 수분 섭취.', dur: 15, followUp: 30 },
  ];
  for (const nc of nutritionCounsels) {
    const ncId = makeUuid('2d010000', nc.i);
    const followUp = new Date(); followUp.setDate(followUp.getDate() + nc.followUp);
    await prisma.nutritionCounsel.upsert({
      where: { id: ncId }, update: {},
      create: {
        id: ncId, patientId: uid(P.PATIENT, nc.patIdx),
        counselType: nc.type, topic: nc.topic, content: nc.content,
        duration: nc.dur, counseledBy: nurseChoId, followUpDate: followUp,
      },
    });
  }
  console.log(`     → ${nutritionAssessments.length} assessments + ${dietOrders.length} diet orders + ${nutritionCounsels.length} counsels seeded`);

  // ── 재활의학 (RehabAssessment + RehabPlan + RehabSession) ──
  const rehabAssessments = [
    { i: 1, patIdx: 9, type: 'INITIAL', diag: '뇌졸중 후 우측 편마비', barthel: 45, fim: 72, berg: 20, mmse: 26, vas: 4, gait: '워커 보행', goals: [{ goal: '독립 보행', target: 'Barthel 80+', timeline: '6주' }] },
    { i: 2, patIdx: 11, type: 'INITIAL', diag: '좌측 TKR 후 재활', barthel: 60, fim: 85, berg: 35, mmse: 30, vas: 6, gait: '목발 보행', goals: [{ goal: '계단 오르기', target: 'ROM 120°', timeline: '4주' }] },
    { i: 3, patIdx: 4, type: 'FOLLOW_UP', diag: '경추 디스크 후 재활', barthel: 75, fim: 100, berg: 45, mmse: 30, vas: 3, gait: '독립 보행', goals: [{ goal: '직장 복귀', target: '통증 VAS 2 이하', timeline: '2주' }] },
  ];
  for (const ra of rehabAssessments) {
    const raId = makeUuid('30010000', ra.i);
    await prisma.rehabAssessment.upsert({
      where: { id: raId }, update: {},
      create: {
        id: raId, patientId: uid(P.PATIENT, ra.patIdx), assessmentType: ra.type,
        diagnosis: ra.diag, barthel: ra.barthel, fim: ra.fim, berg: ra.berg,
        mmse: ra.mmse, vas: ra.vas, gait: ra.gait, goals: ra.goals,
        mmt: [{ muscle: '삼각근', left: 4, right: 3 }, { muscle: '대퇴사두근', left: 5, right: 4 }],
        rom: [{ joint: '어깨 굴곡', value: 150, normal: 180 }, { joint: '무릎 굴곡', value: 100, normal: 135 }],
        assessedBy: kimNaegwaId,
      },
    });
  }

  // 재활 치료 계획
  const rehabPlans = [
    { i: 1, patIdx: 9, diag: '뇌졸중 후 우측 편마비', freq: '주 5회', therapies: [
      { type: 'PT', duration: 30, goals: '보행 훈련, 균형 훈련' },
      { type: 'OT', duration: 30, goals: '일상생활 동작 훈련' },
      { type: 'ST', duration: 20, goals: '연하 기능 개선' },
    ]},
    { i: 2, patIdx: 11, diag: '좌측 TKR 후 재활', freq: '주 5회', therapies: [
      { type: 'PT', duration: 40, goals: 'ROM 확보, 근력 강화' },
    ]},
  ];
  for (const rp of rehabPlans) {
    const rpId = makeUuid('31010000', rp.i);
    await prisma.rehabPlan.upsert({
      where: { id: rpId }, update: {},
      create: {
        id: rpId, patientId: uid(P.PATIENT, rp.patIdx), diagnosis: rp.diag,
        startDate: new Date(), frequency: rp.freq, therapies: rp.therapies,
        prescribedBy: kimNaegwaId,
      },
    });
    // 세션 5건씩
    for (let s = 0; s < 5; s++) {
      const rsId = makeUuid('32010000', rp.i * 100 + s);
      const schedAt = new Date(); schedAt.setDate(schedAt.getDate() - (4 - s));
      const statuses = ['COMPLETED', 'COMPLETED', 'COMPLETED', 'IN_PROGRESS', 'SCHEDULED'];
      await prisma.rehabSession.upsert({
        where: { id: rsId }, update: {},
        create: {
          id: rsId, planId: rpId, patientId: uid(P.PATIENT, rp.patIdx),
          therapyType: rp.therapies[s % rp.therapies.length].type,
          therapistId: kimNaegwaId, scheduledAt: schedAt,
          startTime: s < 4 ? schedAt : undefined,
          endTime: s < 3 ? new Date(schedAt.getTime() + 30 * 60000) : undefined,
          duration: s < 3 ? 30 : undefined, status: statuses[s],
          activities: s < 3 ? [{ name: '보행 훈련', sets: 3, reps: 10, notes: '워커 사용' }] : undefined,
          progress: s < 3 ? '이전 대비 보행 거리 10m 증가. 균형 개선.' : undefined,
        },
      });
    }
  }
  console.log(`     → ${rehabAssessments.length} rehab assessments + ${rehabPlans.length} plans + sessions seeded`);

  // ── 방사선 치료 (RadiationPlan + Fractions + Toxicity) ──
  const radiationPlans = [
    { i: 1, patIdx: 4, diag: 'Rt. breast cancer Stage IIA', intent: 'ADJUVANT', tech: 'VMAT', site: 'Rt. breast + SCL', totalDose: 50.4, fracDose: 1.8, fractions: 28, energy: '6MV', machine: 'TrueBeam #1', status: 'IN_TREATMENT', daysAgo: 15, delivered: 12 },
    { i: 2, patIdx: 7, diag: 'Lung cancer Stage IIIA', intent: 'CURATIVE', tech: 'IMRT', site: 'Lt. lung + mediastinum', totalDose: 60.0, fracDose: 2.0, fractions: 30, energy: '6MV FFF', machine: 'TrueBeam #1', status: 'IN_TREATMENT', daysAgo: 20, delivered: 18 },
    { i: 3, patIdx: 19, diag: 'Brain metastasis', intent: 'PALLIATIVE', tech: 'SRS', site: 'Brain (3 lesions)', totalDose: 27.0, fracDose: 9.0, fractions: 3, energy: '6MV FFF', machine: 'TrueBeam #2', status: 'COMPLETED', daysAgo: 30, delivered: 3 },
  ];
  for (const rp of radiationPlans) {
    const rpId = makeUuid('33010000', rp.i);
    const startDate = new Date(); startDate.setDate(startDate.getDate() - rp.daysAgo);
    await prisma.radiationPlan.upsert({
      where: { id: rpId }, update: { status: rp.status },
      create: {
        id: rpId, patientId: uid(P.PATIENT, rp.patIdx), diagnosis: rp.diag,
        intent: rp.intent, technique: rp.tech, site: rp.site,
        totalDose: rp.totalDose, fractionDose: rp.fracDose, totalFractions: rp.fractions,
        energy: rp.energy, machine: rp.machine, status: rp.status,
        startDate, prescribedBy: kimNaegwaId,
        planApprovedAt: startDate, planApprovedBy: kimNaegwaId,
      },
    });
    // 분할 치료 기록
    for (let f = 1; f <= rp.fractions; f++) {
      const frId = makeUuid('34010000', rp.i * 100 + f);
      const schedDate = new Date(startDate);
      let dayOffset = 0; let weekdays = 0;
      while (weekdays < f) { dayOffset++; const d = new Date(startDate); d.setDate(d.getDate() + dayOffset); if (d.getDay() !== 0 && d.getDay() !== 6) weekdays++; }
      schedDate.setDate(startDate.getDate() + dayOffset);
      const delivered = f <= rp.delivered;
      const cumDose = delivered ? parseFloat((rp.fracDose * f).toFixed(2)) : undefined;
      await prisma.radiationFraction.upsert({
        where: { id: frId }, update: {},
        create: {
          id: frId, planId: rpId, fractionNumber: f, scheduledDate: schedDate,
          deliveredAt: delivered ? schedDate : undefined,
          deliveredDose: delivered ? rp.fracDose : undefined,
          cumulativeDose: cumDose,
          setupVerified: delivered, coneBeamCT: delivered,
          status: delivered ? 'DELIVERED' : 'SCHEDULED',
        },
      });
    }
    // 부작용 (주차별)
    if (rp.delivered >= 5) {
      for (let w = 1; w <= Math.ceil(rp.delivered / 5); w++) {
        const txId = makeUuid('35010000', rp.i * 100 + w);
        await prisma.radiationToxicity.upsert({
          where: { id: txId }, update: {},
          create: {
            id: txId, planId: rpId, week: w,
            skinGrade: w >= 3 ? 2 : w >= 2 ? 1 : 0,
            fatigueGrade: w >= 2 ? 1 : 0,
            nauseaGrade: rp.site.includes('lung') && w >= 2 ? 1 : 0,
            weight: parseFloat((65 - w * 0.3).toFixed(1)),
            ecog: w >= 3 ? 1 : 0,
            assessedBy: kimNaegwaId,
          },
        });
      }
    }
  }
  console.log(`     → ${radiationPlans.length} radiation plans + fractions + toxicities seeded`);

  // ── 투석실 (DialysisMachine + DialysisOrder + DialysisSession) ──
  const dialysisMachines = [
    { i: 1, name: 'HD-01', model: 'Fresenius 5008S', type: 'HD', loc: '투석실 A-1' },
    { i: 2, name: 'HD-02', model: 'Fresenius 5008S', type: 'HD', loc: '투석실 A-2' },
    { i: 3, name: 'HD-03', model: 'Nipro NCU-18', type: 'HD', loc: '투석실 A-3' },
    { i: 4, name: 'HD-04', model: 'Nipro NCU-18', type: 'HD', loc: '투석실 B-1' },
    { i: 5, name: 'HD-05', model: 'Fresenius 5008S', type: 'HD', loc: '투석실 B-2' },
    { i: 6, name: 'CRRT-01', model: 'Prismaflex', type: 'CRRT', loc: 'ICU' },
    { i: 7, name: 'CRRT-02', model: 'Prismaflex', type: 'CRRT', loc: 'ICU' },
    { i: 8, name: 'PD-CYCLER-01', model: 'Baxter HomeChoice', type: 'PD_CYCLER', loc: '복막투석실' },
  ];
  for (const dm of dialysisMachines) {
    const dmId = makeUuid('36010000', dm.i);
    await prisma.dialysisMachine.upsert({
      where: { id: dmId }, update: { name: dm.name },
      create: { id: dmId, name: dm.name, model: dm.model, machineType: dm.type, location: dm.loc, lastDisinfection: new Date() },
    });
  }

  const dialysisOrders = [
    { i: 1, patIdx: 19, mod: 'HD', freq: '주 3회', dur: 240, dialyzer: 'FX-80', bfr: 300, df: 500, dw: 65.0, uf: 2500, anti: '헤파린 1000U', access: 'AVF' },
    { i: 2, patIdx: 6, mod: 'HD', freq: '주 3회', dur: 240, dialyzer: 'Polyflux 210H', bfr: 250, df: 500, dw: 55.0, uf: 2000, anti: '무헤파린', access: 'PERM_CATH' },
    { i: 3, patIdx: 3, mod: 'HD', freq: '주 2회', dur: 180, dialyzer: 'FX-80', bfr: 280, df: 500, dw: 72.0, uf: 1800, anti: '헤파린 500U', access: 'AVG' },
  ];
  for (const d of dialysisOrders) {
    const doId = makeUuid('37010000', d.i);
    await prisma.dialysisOrder.upsert({
      where: { id: doId }, update: {},
      create: {
        id: doId, patientId: uid(P.PATIENT, d.patIdx), modality: d.mod,
        frequency: d.freq, duration: d.dur, dialyzerType: d.dialyzer,
        bloodFlowRate: d.bfr, dialysateFlow: d.df, dryWeight: d.dw,
        ufGoal: d.uf, anticoagulant: d.anti, accessType: d.access,
        prescribedBy: kimNaegwaId, startDate: new Date(),
      },
    });
    // 세션 6건 (이번 주 + 지난 주)
    const shifts = ['AM', 'PM'];
    for (let s = 0; s < 6; s++) {
      const dsId = makeUuid('38010000', d.i * 100 + s);
      const schedDate = new Date(); schedDate.setDate(schedDate.getDate() - (5 - s));
      const statuses = ['COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'IN_PROGRESS', 'SCHEDULED'];
      const completed = s < 4;
      const preW = d.dw + 1.5 + Math.sin(s) * 0.5;
      const postW = completed ? d.dw + 0.1 + Math.sin(s) * 0.2 : undefined;
      const ktv = completed ? parseFloat((1.2 + Math.sin(s) * 0.15).toFixed(2)) : undefined;
      await prisma.dialysisSession.upsert({
        where: { id: dsId }, update: {},
        create: {
          id: dsId, orderId: doId, patientId: uid(P.PATIENT, d.patIdx),
          machineId: makeUuid('36010000', (d.i - 1) * 2 + (s % 2) + 1),
          scheduledDate: schedDate, shift: shifts[s % 2],
          preWeight: parseFloat(preW.toFixed(1)), preBp: `${130 + s * 3}/${80 + s * 2}`, preHr: 72 + s * 2, preTemp: 36.5,
          postWeight: postW ? parseFloat(postW.toFixed(1)) : undefined,
          postBp: completed ? `${120 + s}/${75 + s}` : undefined, postHr: completed ? 70 + s : undefined,
          actualUf: completed ? d.uf - s * 100 : undefined, actualDuration: completed ? d.dur : undefined,
          ktV: ktv,
          startTime: s < 5 ? new Date(schedDate.getTime() + 9 * 3600000) : undefined,
          endTime: completed ? new Date(schedDate.getTime() + 13 * 3600000) : undefined,
          nurseId: nurseChoId, status: statuses[s],
          intradialyticVitals: completed ? [
            { time: '09:00', bp: '135/82', hr: 76, ufRate: 800 },
            { time: '10:00', bp: '128/78', hr: 74, ufRate: 800 },
            { time: '11:00', bp: '115/70', hr: 80, ufRate: 700 },
            { time: '12:00', bp: '120/72', hr: 76, ufRate: 700 },
          ] : undefined,
          complications: s === 2 ? [{ type: 'HYPOTENSION', description: 'BP 90/60 일시적 저하', time: '11:30', action: '생리식염수 200mL 주입, UF 감량' }] : undefined,
        },
      });
    }
  }
  console.log(`     → ${dialysisMachines.length} dialysis machines + ${dialysisOrders.length} orders + sessions seeded`);

  // ── 전문과: 치과 ──
  const dentalDrId = uid(P.USER, 44);
  const angwaDrId = uid(P.USER, 29);
  const pibuDrId = uid(P.USER, 31);
  const ibiinDrId = uid(P.USER, 30);

  const dentalCharts = [
    { i: 1, patIdx: 1, teeth: [
      { tooth: '16', status: 'CROWN', surfaces: ['O'], notes: 'PFM 크라운 (2024)' },
      { tooth: '26', status: 'FILLING', surfaces: ['O','D'], notes: '복합레진 충전' },
      { tooth: '36', status: 'RCT', surfaces: ['O','M','D'], notes: '근관치료 완료, 크라운 예정' },
      { tooth: '46', status: 'CARIES', surfaces: ['O','B'], notes: '근심 우식 C2' },
      { tooth: '17', status: 'MISSING', surfaces: [], notes: '발치 (2023)' },
      { tooth: '38', status: 'EXTRACTION_NEEDED', surfaces: [], notes: '매복 사랑니' },
      { tooth: '48', status: 'EXTRACTION_NEEDED', surfaces: [], notes: '매복 사랑니' },
    ], hygiene: 'FAIR' },
    { i: 2, patIdx: 3, teeth: [
      { tooth: '11', status: 'FILLING', surfaces: ['M'], notes: '레진 충전' },
      { tooth: '21', status: 'NORMAL', surfaces: [], notes: '' },
      { tooth: '14', status: 'IMPLANT', surfaces: [], notes: '임플란트 (2025)' },
      { tooth: '24', status: 'BRIDGE', surfaces: [], notes: '브릿지 지대치' },
      { tooth: '25', status: 'BRIDGE', surfaces: [], notes: '브릿지 가공치' },
      { tooth: '37', status: 'CARIES', surfaces: ['O'], notes: '초기 우식' },
    ], hygiene: 'GOOD' },
    { i: 3, patIdx: 7, teeth: [
      { tooth: '11', status: 'CARIES', surfaces: ['M','L'], notes: '인접면 우식 C3' },
      { tooth: '22', status: 'CARIES', surfaces: ['D'], notes: '원심면 우식 C2' },
      { tooth: '31', status: 'NORMAL', surfaces: [], notes: '동요도 1도' },
      { tooth: '41', status: 'NORMAL', surfaces: [], notes: '동요도 1도' },
      { tooth: '46', status: 'RCT', surfaces: ['O','M','D','B','L'], notes: '근관치료 후 크라운' },
    ], hygiene: 'POOR' },
  ];
  for (const dc of dentalCharts) {
    const dcId = makeUuid('40010000', dc.i);
    await prisma.dentalChart.upsert({
      where: { id: dcId }, update: {},
      create: { id: dcId, patientId: uid(P.PATIENT, dc.patIdx), teethStatus: dc.teeth, oralHygiene: dc.hygiene, chartedBy: dentalDrId },
    });
  }

  // 치료 계획
  const dentalPlans = [
    { i: 1, patIdx: 1, tooth: '46', proc: '복합레진 충전', cat: 'RESTORATION', cost: 150000, ins: true },
    { i: 2, patIdx: 1, tooth: '36', proc: '지르코니아 크라운', cat: 'PROSTHESIS', cost: 600000, ins: false },
    { i: 3, patIdx: 1, tooth: '38', proc: '매복 사랑니 발치', cat: 'EXTRACTION', cost: 200000, ins: true },
    { i: 4, patIdx: 3, tooth: '37', proc: '레진 충전', cat: 'RESTORATION', cost: 100000, ins: true },
    { i: 5, patIdx: 7, tooth: '11', proc: '근관치료 + 크라운', cat: 'RCT', cost: 800000, ins: false, sessions: 3 },
    { i: 6, patIdx: 7, tooth: '22', proc: '레진 인레이', cat: 'RESTORATION', cost: 250000, ins: false },
  ];
  for (const dp of dentalPlans) {
    const dpId = makeUuid('41010000', dp.i);
    await prisma.dentalTreatmentPlan.upsert({
      where: { id: dpId }, update: {},
      create: {
        id: dpId, patientId: uid(P.PATIENT, dp.patIdx), tooth: dp.tooth,
        procedure: dp.proc, category: dp.cat, estimatedCost: dp.cost,
        insuranceCovered: dp.ins, sessions: (dp as any).sessions ?? 1,
        plannedBy: dentalDrId,
      },
    });
  }

  // 치료 기록
  const dentalRecords = [
    { i: 1, planIdx: 1, patIdx: 1, tooth: '46', proc: '복합레진 충전', surf: ['O','B'], mat: '복합레진 A2', anest: '리도카인 2% 1.8mL', find: '우식 제거 후 충전. 교합 조정.' },
    { i: 2, planIdx: 4, patIdx: 3, tooth: '37', proc: '레진 충전', surf: ['O'], mat: '복합레진 A3', anest: '없음', find: '초기 우식 제거. 예방적 레진 충전.' },
  ];
  for (const dr of dentalRecords) {
    const drId = makeUuid('42010000', dr.i);
    await prisma.dentalTreatmentRecord.upsert({
      where: { id: drId }, update: {},
      create: {
        id: drId, planId: makeUuid('41010000', dr.planIdx),
        patientId: uid(P.PATIENT, dr.patIdx), tooth: dr.tooth,
        procedure: dr.proc, surfaces: dr.surf, material: dr.mat,
        anesthesia: dr.anest, findings: dr.find, treatedBy: dentalDrId,
      },
    });
  }
  console.log(`     → ${dentalCharts.length} dental charts + ${dentalPlans.length} plans + ${dentalRecords.length} records seeded`);

  // ── 전문과: 안과 ──
  const eyeExams = [
    { i: 1, patIdx: 9, vaOdU: '20/40', vaOsU: '20/30', vaOdC: '20/20', vaOsC: '20/20',
      refOd: { sphere: -2.50, cylinder: -0.75, axis: 180 }, refOs: { sphere: -2.00, cylinder: -0.50, axis: 170 },
      iopOd: 16, iopOs: 15, diag: '근시, 양안. 정상 안압.', plan: '안경 처방. 1년 후 재검.' },
    { i: 2, patIdx: 11, vaOdU: '20/100', vaOsU: '20/60', vaOdC: '20/40', vaOsC: '20/25',
      refOd: { sphere: -4.00, cylinder: -1.25, axis: 90 }, refOs: { sphere: -3.00, cylinder: -0.75, axis: 85 },
      iopOd: 22, iopOs: 24, diag: '개방각 녹내장 의심 (OD>OS). 고안압.', plan: 'OCT + 시야검사 예약. 안압 추적.' },
    { i: 3, patIdx: 4, vaOdU: '20/200', vaOsU: '20/30', vaOdC: '20/100', vaOsC: '20/20',
      refOd: null, refOs: { sphere: -1.00, cylinder: 0, axis: 0 },
      iopOd: 14, iopOs: 15, diag: '우안 백내장 (핵경화 3+). 좌안 정상.', plan: '우안 백내장 수술 예정.' },
  ];
  for (const ee of eyeExams) {
    const eeId = makeUuid('43010000', ee.i);
    await prisma.eyeExam.upsert({
      where: { id: eeId }, update: {},
      create: {
        id: eeId, patientId: uid(P.PATIENT, ee.patIdx),
        vaOdUncorrected: ee.vaOdU, vaOsUncorrected: ee.vaOsU,
        vaOdCorrected: ee.vaOdC, vaOsCorrected: ee.vaOsC,
        refractionOd: ee.refOd ?? undefined, refractionOs: ee.refOs ?? undefined,
        iopOd: ee.iopOd, iopOs: ee.iopOs, iopMethod: 'NCT',
        diagnosis: ee.diag, plan: ee.plan, examinedBy: angwaDrId,
      },
    });
  }

  // 안과 수술
  const eyeSurgId = makeUuid('44010000', 1);
  await prisma.eyeSurgery.upsert({
    where: { id: eyeSurgId }, update: {},
    create: {
      id: eyeSurgId, patientId: uid(P.PATIENT, 4),
      eye: 'OD', procedure: 'CATARACT',
      iolModel: 'AcrySof IQ SN60WF', iolPower: '+21.0D',
      preOpVa: '20/200', postOpVa: '20/25',
      operatedBy: angwaDrId,
    },
  });
  console.log(`     → ${eyeExams.length} eye exams + 1 eye surgery seeded`);

  // ── 전문과: 피부과 ──
  const skinLesions = [
    { i: 1, patIdx: 6, loc: '좌측 전완부', region: 'FOREARM', morph: 'PAPULE', color: '갈색', size: '0.5cm', border: 'REGULAR', diag: '지루성 각화증', abcde: 1 },
    { i: 2, patIdx: 7, loc: '우측 안면 볼', region: 'FACE', morph: 'PATCH', color: '적갈색', size: '2.0 x 1.5cm', border: 'ILL_DEFINED', diag: '접촉성 피부염', abcde: 0 },
    { i: 3, patIdx: 19, loc: '등 상부', region: 'BACK', morph: 'NODULE', color: '흑색', size: '0.8cm', border: 'IRREGULAR', diag: '흑색종 의심 — 조직검사 필요', abcde: 5, biopsy: true },
    { i: 4, patIdx: 3, loc: '좌측 하퇴부', region: 'LOWER_LEG', morph: 'PLAQUE', color: '은백색', size: '5.0 x 3.0cm', border: 'WELL_DEFINED', diag: '건선', abcde: 0 },
  ];
  for (const sl of skinLesions) {
    const slId = makeUuid('45010000', sl.i);
    await prisma.skinLesion.upsert({
      where: { id: slId }, update: {},
      create: {
        id: slId, patientId: uid(P.PATIENT, sl.patIdx),
        location: sl.loc, bodyRegion: sl.region, morphology: sl.morph,
        color: sl.color, size: sl.size, border: sl.border,
        diagnosis: sl.diag, abcdeScore: sl.abcde,
        biopsyTaken: (sl as any).biopsy ?? false,
        recordedBy: pibuDrId,
      },
    });
  }

  // 피부과 시술
  const skinTreatments = [
    { i: 1, lesionIdx: 1, patIdx: 6, type: 'CRYOTHERAPY', proc: '액체질소 냉동치료 2회 적용', area: '좌측 전완부' },
    { i: 2, lesionIdx: 4, patIdx: 3, type: 'PHOTOTHERAPY', proc: 'NB-UVB 광선치료 300mJ/cm²', area: '좌측 하퇴부' },
    { i: 3, lesionIdx: 3, patIdx: 19, type: 'BIOPSY', proc: '펀치 생검 4mm', area: '등 상부 병변' },
  ];
  for (const st of skinTreatments) {
    const stId = makeUuid('46010000', st.i);
    await prisma.skinTreatment.upsert({
      where: { id: stId }, update: {},
      create: {
        id: stId, lesionId: makeUuid('45010000', st.lesionIdx),
        patientId: uid(P.PATIENT, st.patIdx),
        treatmentType: st.type, procedure: st.proc, area: st.area,
        treatedBy: pibuDrId,
      },
    });
  }
  console.log(`     → ${skinLesions.length} skin lesions + ${skinTreatments.length} treatments seeded`);

  // ── 전문과: 이비인후과 ──
  const entExams = [
    { i: 1, patIdx: 1, otR: { tympanic_membrane: '정상', canal: '정상', discharge: '없음' }, otL: { tympanic_membrane: '정상', canal: '정상', discharge: '없음' },
      ptaR: 20, ptaL: 15, spR: 96, spL: 100, tympR: 'A', tympL: 'A',
      nasal: { septum: '정상', turbinate: '정상', polyp: '없음' }, diag: '정상 청력. 비중격 정상.' },
    { i: 2, patIdx: 11, otR: { tympanic_membrane: '삼출', canal: '정상', discharge: '장액성' }, otL: { tympanic_membrane: '정상', canal: '정상', discharge: '없음' },
      ptaR: 35, ptaL: 20, spR: 84, spL: 96, tympR: 'B', tympL: 'A',
      nasal: { septum: '좌측 만곡', turbinate: '하비갑개 비후', polyp: '없음' },
      diag: '우측 삼출성 중이염. 좌측 비중격 만곡. 하비갑개 비후.' },
    { i: 3, patIdx: 19, otR: { tympanic_membrane: '정상', canal: '정상', discharge: '없음' }, otL: { tympanic_membrane: '정상', canal: '정상', discharge: '없음' },
      ptaR: 45, ptaL: 50, spR: 72, spL: 68, tympR: 'A', tympL: 'A',
      nasal: { septum: '정상', turbinate: '정상', polyp: '없음' },
      pharynx: { tonsil: 'Grade I', pharynx: '정상', vocal_cord: '정상' },
      diag: '양측 감각신경성 난청 (중등도). 보청기 상담 권고.' },
  ];
  for (const ee of entExams) {
    const eeId = makeUuid('47010000', ee.i);
    await prisma.entExam.upsert({
      where: { id: eeId }, update: {},
      create: {
        id: eeId, patientId: uid(P.PATIENT, ee.patIdx),
        otoscopyRight: ee.otR, otoscopyLeft: ee.otL,
        ptaRight: ee.ptaR, ptaLeft: ee.ptaL,
        speechRight: ee.spR, speechLeft: ee.spL,
        tympanometryRight: ee.tympR, tympanometryLeft: ee.tympL,
        nasalEndoscopy: ee.nasal,
        pharynxExam: (ee as any).pharynx ?? null,
        audiogramRight: [
          { freq: 250, ac: ee.ptaR - 10 }, { freq: 500, ac: ee.ptaR - 5 },
          { freq: 1000, ac: ee.ptaR }, { freq: 2000, ac: ee.ptaR + 5 },
          { freq: 4000, ac: ee.ptaR + 10 }, { freq: 8000, ac: ee.ptaR + 15 },
        ],
        audiogramLeft: [
          { freq: 250, ac: ee.ptaL - 10 }, { freq: 500, ac: ee.ptaL - 5 },
          { freq: 1000, ac: ee.ptaL }, { freq: 2000, ac: ee.ptaL + 5 },
          { freq: 4000, ac: ee.ptaL + 10 }, { freq: 8000, ac: ee.ptaL + 15 },
        ],
        diagnosis: ee.diag, examinedBy: ibiinDrId,
      },
    });
  }
  console.log(`     → ${entExams.length} ENT exams seeded`);

  // ── 전문과 보강 데이터 ──

  // 안과 안압 추이 (환자 11 — 녹내장 의심, 6개월 추적)
  for (let m = 0; m < 6; m++) {
    const iopId = makeUuid('43020000', m);
    const examDate = new Date(); examDate.setMonth(examDate.getMonth() - (5 - m));
    const iopOd = m < 3 ? 22 + Math.round(Math.sin(m) * 2) : 16 + Math.round(Math.sin(m)); // 치료 후 감소
    const iopOs = 15 + Math.round(Math.sin(m * 1.5));
    await prisma.eyeExam.upsert({
      where: { id: iopId }, update: {},
      create: {
        id: iopId, patientId: uid(P.PATIENT, 11),
        vaOdCorrected: '20/25', vaOsCorrected: '20/20',
        iopOd, iopOs, iopMethod: 'GAT',
        slitLampOd: { lids: '정상', conjunctiva: '정상', cornea: '투명', ac: '깊음', iris: '정상', lens: '투명' },
        slitLampOs: { lids: '정상', conjunctiva: '정상', cornea: '투명', ac: '깊음', iris: '정상', lens: '투명' },
        fundusOd: { disc: 'CDR 0.6, 상측 시신경 함몰', macula: '정상', vessels: '정상', periphery: '정상' },
        fundusOs: { disc: 'CDR 0.4, 정상', macula: '정상', vessels: '정상', periphery: '정상' },
        octOd: m >= 3 ? { rnfl: '상측 박화 (68μm)', ganglion: '정상', maculaThickness: 262 } : undefined,
        octOs: m >= 3 ? { rnfl: '정상 (98μm)', ganglion: '정상', maculaThickness: 258 } : undefined,
        vfOd: m >= 4 ? { md: -5.2, psd: 4.8, vfi: 85, reliability: { fixLoss: 2, falsePos: 3, falseNeg: 5 } } : undefined,
        vfOs: m >= 4 ? { md: -1.1, psd: 1.5, vfi: 98, reliability: { fixLoss: 1, falsePos: 2, falseNeg: 1 } } : undefined,
        diagnosis: m < 3 ? '개방각 녹내장 의심. 고안압.' : '개방각 녹내장 (OD). 안압약 치료 중.',
        plan: m < 3 ? '안압약 (라타노프로스트) 시작.' : '안압약 유지. OCT/VF 추적.',
        examinedBy: angwaDrId, examinedAt: examDate,
      },
    });
  }

  // 치과 치주 데이터 보강 (환자 7 — 치주질환)
  const perioChartId = makeUuid('40020000', 1);
  await prisma.dentalChart.upsert({
    where: { id: perioChartId }, update: {},
    create: {
      id: perioChartId, patientId: uid(P.PATIENT, 7),
      teethStatus: [
        { tooth: '16', status: 'NORMAL', surfaces: [], notes: '동요도 1도' },
        { tooth: '26', status: 'NORMAL', surfaces: [], notes: '' },
        { tooth: '36', status: 'NORMAL', surfaces: [], notes: '동요도 2도' },
        { tooth: '46', status: 'RCT', surfaces: ['O','M','D','B','L'], notes: '크라운' },
      ],
      perioStatus: [
        { tooth: '16', pocket: [4, 3, 5, 4, 3, 4], mobility: 1, bleeding: [true, false, true, true, false, true], furcation: 1 },
        { tooth: '15', pocket: [3, 2, 3, 3, 2, 3], mobility: 0, bleeding: [false, false, false, false, false, false], furcation: 0 },
        { tooth: '14', pocket: [3, 3, 3, 3, 3, 3], mobility: 0, bleeding: [false, false, true, false, false, false], furcation: 0 },
        { tooth: '26', pocket: [3, 2, 4, 3, 2, 3], mobility: 0, bleeding: [false, false, true, false, false, false], furcation: 0 },
        { tooth: '36', pocket: [6, 5, 7, 5, 4, 6], mobility: 2, bleeding: [true, true, true, true, true, true], furcation: 2 },
        { tooth: '35', pocket: [4, 3, 4, 4, 3, 4], mobility: 0, bleeding: [true, false, true, true, false, false], furcation: 0 },
        { tooth: '46', pocket: [3, 3, 3, 3, 3, 3], mobility: 0, bleeding: [false, false, false, false, false, false], furcation: 0 },
        { tooth: '31', pocket: [4, 3, 4, 4, 3, 4], mobility: 1, bleeding: [true, false, true, false, false, true], furcation: 0 },
        { tooth: '41', pocket: [4, 3, 4, 4, 3, 4], mobility: 1, bleeding: [true, false, true, true, false, true], furcation: 0 },
      ],
      oralHygiene: 'POOR',
      notes: '전반적 치주염. 하악 전치부 동요도. #36 중증 치주염.',
      chartedBy: dentalDrId,
    },
  });

  // 피부과 시술 전후 사진 URL 보강 + ABCDE 상세
  const skinLesionUpdate5 = makeUuid('45020000', 1);
  await prisma.skinLesion.upsert({
    where: { id: skinLesionUpdate5 }, update: {},
    create: {
      id: skinLesionUpdate5, patientId: uid(P.PATIENT, 6),
      location: '우측 종아리', bodyRegion: 'LOWER_LEG',
      morphology: 'MACULE', color: '갈색', size: '1.2cm',
      border: 'IRREGULAR', distribution: 'LOCALIZED',
      surface: 'SMOOTH',
      dermoscopy: { pattern: 'reticular', colors: ['갈색', '흑색'], structures: ['색소 네트워크', '점'], score: 3 },
      abcdeScore: 3, diagnosis: '이형성 모반 — 추적 관찰',
      recordedBy: pibuDrId,
    },
  });
  // 시술 전후 사진 있는 케이스
  const skinTxPhoto = makeUuid('46020000', 1);
  await prisma.skinTreatment.upsert({
    where: { id: skinTxPhoto }, update: {},
    create: {
      id: skinTxPhoto, patientId: uid(P.PATIENT, 3),
      treatmentType: 'LASER', procedure: 'CO2 프랙셔널 레이저 — 여드름 흉터',
      area: '양측 안면 볼',
      parameters: { power: '15W', pulse: '0.5ms', spotSize: '120μm', passes: 2 },
      beforePhotoUrl: '/uploads/dermatology/before_acne_scar_001.jpg',
      afterPhotoUrl: '/uploads/dermatology/after_acne_scar_001.jpg',
      nextSession: new Date(Date.now() + 30 * 86400000),
      treatedBy: pibuDrId,
    },
  });

  // ENT 고막/비강 상세 + 수면검사 데이터 보강
  const entDetail1 = makeUuid('47020000', 1);
  await prisma.entExam.upsert({
    where: { id: entDetail1 }, update: {},
    create: {
      id: entDetail1, patientId: uid(P.PATIENT, 6),
      otoscopyRight: { tympanic_membrane: '정상', canal: '정상', discharge: '없음', lightReflex: true, color: 'pearl' },
      otoscopyLeft: { tympanic_membrane: '삼출', canal: '정상', discharge: '장액성', lightReflex: false, color: 'amber', bulging: true },
      ptaRight: 15, ptaLeft: 30,
      speechRight: 100, speechLeft: 88,
      tympanometryRight: 'A', tympanometryLeft: 'B',
      nasalEndoscopy: {
        septum: '우측 만곡 (경도)', turbinate: { left: '정상', right: '하비갑개 비후' },
        polyp: { left: '없음', right: 'Grade I' }, discharge: '우측 점액성',
      },
      pharynxExam: { tonsil: 'Grade II', pharynx: '경도 발적', uvula: '정상', vocalCord: '정상' },
      audiogramRight: [
        { freq: 250, ac: 10, bc: 5 }, { freq: 500, ac: 10, bc: 5 },
        { freq: 1000, ac: 15, bc: 10 }, { freq: 2000, ac: 15, bc: 10 },
        { freq: 4000, ac: 20, bc: 15 }, { freq: 8000, ac: 25, bc: 20 },
      ],
      audiogramLeft: [
        { freq: 250, ac: 25, bc: 10 }, { freq: 500, ac: 30, bc: 10 },
        { freq: 1000, ac: 30, bc: 15 }, { freq: 2000, ac: 35, bc: 15 },
        { freq: 4000, ac: 40, bc: 20 }, { freq: 8000, ac: 45, bc: 25 },
      ],
      diagnosis: '좌측 삼출성 중이염 + 전음성 난청. 우측 비중격 만곡 + 하비갑개 비후.',
      examinedBy: ibiinDrId,
    },
  });

  console.log('     → Specialty enrichment data seeded (IOP trend 6mo, perio chart, dermoscopy, ENT detail)');

  // ── 환자 여정 이벤트 (PatientJourneyEvent) ──
  console.log('  [Extra] Patient journey events...');
  const journeyPatients = [1, 3, 4, 6, 7, 9, 11, 19];
  let journeyCount = 0;
  for (const pIdx of journeyPatients) {
    const patientId = uid(P.PATIENT, pIdx);
    const baseTime = new Date();
    baseTime.setDate(baseTime.getDate() - Math.floor(Math.random() * 7));

    const events = [
      { type: 'RECEPTION_CHECKIN', title: '접수 완료', desc: '외래 접수', dept: '원무과', hoursOffset: 0 },
      { type: 'RECEPTION_CALLED', title: '진료 호출', desc: '대기실에서 호출', dept: '내과', hoursOffset: 0.3 },
      { type: 'ENCOUNTER_START', title: '진료 시작', desc: '담당의 진료 시작', dept: '내과', hoursOffset: 0.5 },
      { type: 'PRESCRIPTION_ADDED', title: '처방 발행', desc: '약물/검사 처방', dept: '내과', hoursOffset: 0.8 },
      { type: 'ORDER_CREATED', title: '검사 오더', desc: '혈액검사 + 영상 오더', dept: '진단검사의학과', hoursOffset: 0.9 },
      { type: 'LAB_RESULT', title: '검사결과 도착', desc: 'CBC, CRP 결과 확인', dept: '진단검사의학과', hoursOffset: 2 },
      { type: 'ENCOUNTER_SIGNED', title: '진료 완료 (서명)', desc: '차트 서명 완료', dept: '내과', hoursOffset: 2.5 },
    ];

    // 입원 환자 추가 이벤트
    if ([1, 4, 7, 11, 19].includes(pIdx)) {
      events.push(
        { type: 'ADMISSION', title: '입원', desc: '내과 병동 입원', dept: '내과', hoursOffset: 3 },
        { type: 'ROUND', title: '회진', desc: '담당의 회진', dept: '내과', hoursOffset: 20 },
        { type: 'ORDER_COMPLETED', title: '검사 완료', desc: '추적 혈액검사 완료', dept: '진단검사의학과', hoursOffset: 24 },
      );
    }

    // 응급 환자 추가 이벤트
    if ([9, 6].includes(pIdx)) {
      events.splice(0, events.length,
        { type: 'ER_ARRIVAL', title: '응급실 도착', desc: '119 이송', dept: '응급의학과', hoursOffset: 0 },
        { type: 'ER_TRIAGE', title: '트리아지 완료', desc: 'KTAS 분류 완료', dept: '응급의학과', hoursOffset: 0.1 },
        { type: 'ER_TREATMENT_START', title: '응급 치료 시작', desc: 'IV line 확보, 초기 처치', dept: '응급의학과', hoursOffset: 0.2 },
        { type: 'ORDER_CREATED', title: '응급 검사 오더', desc: 'CBC, ABG, ECG, Troponin', dept: '응급의학과', hoursOffset: 0.3 },
        { type: 'LAB_RESULT', title: '응급 검사 결과', desc: '혈액검사 결과 도착', dept: '진단검사의학과', hoursOffset: 1 },
        { type: 'IMAGING_RESULT', title: '영상 결과', desc: '흉부 X-ray 판독 완료', dept: '영상의학과', hoursOffset: 1.5 },
      );
    }

    // 수술 환자
    if (pIdx === 7) {
      events.push(
        { type: 'SURGERY_START', title: '수술 시작', desc: '복강경 담낭절제술', dept: '외과', hoursOffset: 48 },
        { type: 'SURGERY_COMPLETE', title: '수술 완료', desc: '수술 무사 종료', dept: '외과', hoursOffset: 50 },
      );
    }

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const eventAt = new Date(baseTime.getTime() + ev.hoursOffset * 3600000);
      const evId = makeUuid('e0a00000', pIdx * 100 + i);
      await prisma.patientJourneyEvent.upsert({
        where: { id: evId },
        update: {},
        create: {
          id: evId,
          patientId,
          eventType: ev.type,
          eventAt,
          title: ev.title,
          description: ev.desc,
          department: ev.dept,
          severity: ev.type.startsWith('ER_') ? 'WARNING' : 'INFO',
          dataOrigin: 'SEED', // 여정 P1 — 시드 사건임을 원장에 남긴다(실서비스 전환 때 걸러낼 기준)
        },
      });
      journeyCount++;
    }
  }
  console.log(`     → ${journeyCount} journey events seeded (${journeyPatients.length} patients)`);

  // ── SpaceNode 병원 공간 구조 ──
  console.log('  [Extra] Hospital space nodes...');
  const spaceData = [
    // Hospital → Building
    { code: 'HOSP', nodeType: 'HOSPITAL', name: '위루비병원', depth: 0, path: '위루비병원', spaceType: 'HOSPITAL', floor: null },
    { code: 'MAIN', nodeType: 'BUILDING', name: '본관', depth: 1, path: '위루비병원/본관', spaceType: 'BUILDING', floor: null, parentCode: 'HOSP' },
    // Floors
    { code: '1f', nodeType: 'FLOOR', name: '1층 로비/응급', depth: 2, path: '위루비병원/본관/1F', spaceType: 'FLOOR', floor: 1, parentCode: 'MAIN', meta: { description: '로비, 접수, 응급실, 수술실' } },
    { code: '2f', nodeType: 'FLOOR', name: '2층 외래', depth: 2, path: '위루비병원/본관/2F', spaceType: 'FLOOR', floor: 2, parentCode: 'MAIN', meta: { description: '외래 진료, 검사, 영상, 약국' } },
    { code: '3f', nodeType: 'FLOOR', name: '3층 내과병동', depth: 2, path: '위루비병원/본관/3F', spaceType: 'FLOOR', floor: 3, parentCode: 'MAIN', meta: { description: '내과 입원병동' } },
    { code: '4f', nodeType: 'FLOOR', name: '4층 외과병동', depth: 2, path: '위루비병원/본관/4F', spaceType: 'FLOOR', floor: 4, parentCode: 'MAIN', meta: { description: '외과 입원병동' } },
    { code: '5f', nodeType: 'FLOOR', name: '5층 소아/산부병동', depth: 2, path: '위루비병원/본관/5F', spaceType: 'FLOOR', floor: 5, parentCode: 'MAIN', meta: { description: '소아청소년과, 산부인과 병동' } },
    { code: '6f', nodeType: 'FLOOR', name: '6층 정형외과병동', depth: 2, path: '위루비병원/본관/6F', spaceType: 'FLOOR', floor: 6, parentCode: 'MAIN', meta: { description: '정형외과 입원병동' } },
    // 1F zones
    { code: 'F1-LB', nodeType: 'ZONE', name: '로비', depth: 3, path: '본관/1F/로비', spaceType: 'LOBBY', floor: 1, parentCode: '1f', capacity: 50, color: '#E5E7EB' },
    { code: 'F1-RC', nodeType: 'ZONE', name: '접수/원무', depth: 3, path: '본관/1F/접수', spaceType: 'RECEPTION', floor: 1, parentCode: '1f', capacity: 8, color: '#3B82F6' },
    { code: 'F1-ER', nodeType: 'ZONE', name: '응급실', depth: 3, path: '본관/1F/응급실', spaceType: 'ER', floor: 1, parentCode: '1f', capacity: 20, color: '#DC2626', dept: '응급의학과' },
    { code: 'F1-OR1', nodeType: 'ZONE', name: '수술실 1', depth: 3, path: '본관/1F/수술실1', spaceType: 'SURGERY', floor: 1, parentCode: '1f', capacity: 1, color: '#DC2626', room: 'OR-1' },
    { code: 'F1-OR2', nodeType: 'ZONE', name: '수술실 2', depth: 3, path: '본관/1F/수술실2', spaceType: 'SURGERY', floor: 1, parentCode: '1f', capacity: 1, color: '#DC2626', room: 'OR-2' },
    { code: 'F1-RCV', nodeType: 'ZONE', name: '회복실', depth: 3, path: '본관/1F/회복실', spaceType: 'RECOVERY', floor: 1, parentCode: '1f', capacity: 6, color: '#F59E0B' },
    { code: 'F1-ICU', nodeType: 'ZONE', name: 'ICU', depth: 3, path: '본관/1F/ICU', spaceType: 'ICU', floor: 1, parentCode: '1f', capacity: 6, color: '#DC2626' },
    { code: 'F1-PH', nodeType: 'ZONE', name: '약국', depth: 3, path: '본관/1F/약국', spaceType: 'PHARMACY', floor: 1, parentCode: '1f', capacity: 10, color: '#EF4444' },
    { code: 'F1-CS', nodeType: 'ZONE', name: '수납', depth: 3, path: '본관/1F/수납', spaceType: 'CASHIER', floor: 1, parentCode: '1f', capacity: 4, color: '#3B82F6' },
    // 2F zones
    { code: 'F2-IM-W', nodeType: 'ZONE', name: '내과 대기실', depth: 3, path: '본관/2F/내과대기', spaceType: 'WAITING', floor: 2, parentCode: '2f', capacity: 30, color: '#F59E0B', dept: '내과' },
    { code: 'F2-IM-201', nodeType: 'ZONE', name: '내과 1진료실', depth: 3, path: '본관/2F/내과1', spaceType: 'CLINIC', floor: 2, parentCode: '2f', capacity: 3, color: '#10B981', dept: '내과', room: '201' },
    { code: 'F2-IM-202', nodeType: 'ZONE', name: '내과 2진료실', depth: 3, path: '본관/2F/내과2', spaceType: 'CLINIC', floor: 2, parentCode: '2f', capacity: 3, color: '#10B981', dept: '내과', room: '202' },
    { code: 'F2-SG-W', nodeType: 'ZONE', name: '외과 대기실', depth: 3, path: '본관/2F/외과대기', spaceType: 'WAITING', floor: 2, parentCode: '2f', capacity: 20, color: '#F59E0B', dept: '외과' },
    { code: 'F2-SG-203', nodeType: 'ZONE', name: '외과 1진료실', depth: 3, path: '본관/2F/외과1', spaceType: 'CLINIC', floor: 2, parentCode: '2f', capacity: 3, color: '#10B981', dept: '외과', room: '203' },
    { code: 'F2-PD-204', nodeType: 'ZONE', name: '소아과 진료실', depth: 3, path: '본관/2F/소아과', spaceType: 'CLINIC', floor: 2, parentCode: '2f', capacity: 3, color: '#10B981', dept: '소아청소년과', room: '204' },
    { code: 'F2-OB-205', nodeType: 'ZONE', name: '산부인과 진료실', depth: 3, path: '본관/2F/산부인과', spaceType: 'CLINIC', floor: 2, parentCode: '2f', capacity: 3, color: '#10B981', dept: '산부인과', room: '205' },
    { code: 'F2-OS-206', nodeType: 'ZONE', name: '정형외과 진료실', depth: 3, path: '본관/2F/정형외과', spaceType: 'CLINIC', floor: 2, parentCode: '2f', capacity: 3, color: '#10B981', dept: '정형외과', room: '206' },
    { code: 'F2-LAB', nodeType: 'ZONE', name: '채혈실/검사실', depth: 3, path: '본관/2F/검사실', spaceType: 'LAB', floor: 2, parentCode: '2f', capacity: 10, color: '#8B5CF6' },
    { code: 'F2-EKG', nodeType: 'ZONE', name: '심전도실', depth: 3, path: '본관/2F/EKG', spaceType: 'EKG', floor: 2, parentCode: '2f', capacity: 2, color: '#8B5CF6' },
    { code: 'F2-IMG', nodeType: 'ZONE', name: '영상실 (X-ray/CT)', depth: 3, path: '본관/2F/영상실', spaceType: 'IMAGING', floor: 2, parentCode: '2f', capacity: 5, color: '#8B5CF6' },
    { code: 'F2-ENDO', nodeType: 'ZONE', name: '내시경실', depth: 3, path: '본관/2F/내시경실', spaceType: 'ENDOSCOPY', floor: 2, parentCode: '2f', capacity: 3, color: '#8B5CF6' },
    // 3F zones (내과병동)
    { code: 'F3-NS', nodeType: 'ZONE', name: '3층 간호스테이션', depth: 3, path: '본관/3F/간호스테이션', spaceType: 'NURSE_STATION', floor: 3, parentCode: '3f', capacity: 5, color: '#10B981', dept: '내과' },
    { code: 'F3-301', nodeType: 'ZONE', name: '301호', depth: 3, path: '본관/3F/301', spaceType: 'WARD_ROOM', floor: 3, parentCode: '3f', capacity: 2, color: '#3B82F6', room: '301' },
    { code: 'F3-302', nodeType: 'ZONE', name: '302호', depth: 3, path: '본관/3F/302', spaceType: 'WARD_ROOM', floor: 3, parentCode: '3f', capacity: 2, color: '#3B82F6', room: '302' },
    { code: 'F3-303', nodeType: 'ZONE', name: '303호', depth: 3, path: '본관/3F/303', spaceType: 'WARD_ROOM', floor: 3, parentCode: '3f', capacity: 2, color: '#3B82F6', room: '303' },
    { code: 'F3-304', nodeType: 'ZONE', name: '304호', depth: 3, path: '본관/3F/304', spaceType: 'WARD_ROOM', floor: 3, parentCode: '3f', capacity: 2, color: '#3B82F6', room: '304' },
    { code: 'F3-305', nodeType: 'ZONE', name: '305호', depth: 3, path: '본관/3F/305', spaceType: 'WARD_ROOM', floor: 3, parentCode: '3f', capacity: 2, color: '#3B82F6', room: '305' },
    // 4F zones (외과병동)
    { code: 'F4-NS', nodeType: 'ZONE', name: '4층 간호스테이션', depth: 3, path: '본관/4F/간호스테이션', spaceType: 'NURSE_STATION', floor: 4, parentCode: '4f', capacity: 5, color: '#10B981', dept: '외과' },
    { code: 'F4-401', nodeType: 'ZONE', name: '401호', depth: 3, path: '본관/4F/401', spaceType: 'WARD_ROOM', floor: 4, parentCode: '4f', capacity: 2, color: '#3B82F6', room: '401' },
    { code: 'F4-402', nodeType: 'ZONE', name: '402호', depth: 3, path: '본관/4F/402', spaceType: 'WARD_ROOM', floor: 4, parentCode: '4f', capacity: 2, color: '#3B82F6', room: '402' },
    { code: 'F4-403', nodeType: 'ZONE', name: '403호', depth: 3, path: '본관/4F/403', spaceType: 'WARD_ROOM', floor: 4, parentCode: '4f', capacity: 2, color: '#3B82F6', room: '403' },
    { code: 'F4-404', nodeType: 'ZONE', name: '404호', depth: 3, path: '본관/4F/404', spaceType: 'WARD_ROOM', floor: 4, parentCode: '4f', capacity: 4, color: '#3B82F6', room: '404' },
    { code: 'F4-405', nodeType: 'ZONE', name: '405호 (1인실)', depth: 3, path: '본관/4F/405', spaceType: 'WARD_ROOM', floor: 4, parentCode: '4f', capacity: 1, color: '#6366F1', room: '405' },
    // 5F zones (소아/산부)
    { code: 'F5-NS', nodeType: 'ZONE', name: '5층 간호스테이션', depth: 3, path: '본관/5F/간호스테이션', spaceType: 'NURSE_STATION', floor: 5, parentCode: '5f', capacity: 5, color: '#EC4899', dept: '소아청소년과' },
    { code: 'F5-501', nodeType: 'ZONE', name: '501호 (소아)', depth: 3, path: '본관/5F/501', spaceType: 'WARD_ROOM', floor: 5, parentCode: '5f', capacity: 2, color: '#EC4899', room: '501', dept: '소아청소년과' },
    { code: 'F5-502', nodeType: 'ZONE', name: '502호 (소아)', depth: 3, path: '본관/5F/502', spaceType: 'WARD_ROOM', floor: 5, parentCode: '5f', capacity: 2, color: '#EC4899', room: '502', dept: '소아청소년과' },
    { code: 'F5-503', nodeType: 'ZONE', name: '503호 (산부)', depth: 3, path: '본관/5F/503', spaceType: 'WARD_ROOM', floor: 5, parentCode: '5f', capacity: 2, color: '#F472B6', room: '503', dept: '산부인과' },
    { code: 'F5-504', nodeType: 'ZONE', name: '504호 (산부)', depth: 3, path: '본관/5F/504', spaceType: 'WARD_ROOM', floor: 5, parentCode: '5f', capacity: 2, color: '#F472B6', room: '504', dept: '산부인과' },
    { code: 'F5-LDR', nodeType: 'ZONE', name: '분만실', depth: 3, path: '본관/5F/분만실', spaceType: 'DELIVERY', floor: 5, parentCode: '5f', capacity: 2, color: '#DC2626', dept: '산부인과' },
    { code: 'F5-NICU', nodeType: 'ZONE', name: '신생아중환자실', depth: 3, path: '본관/5F/NICU', spaceType: 'ICU', floor: 5, parentCode: '5f', capacity: 4, color: '#DC2626', dept: '소아청소년과' },
    { code: 'F5-NURSE', nodeType: 'ZONE', name: '수유실', depth: 3, path: '본관/5F/수유실', spaceType: 'NURSE_ROOM', floor: 5, parentCode: '5f', capacity: 6, color: '#F9A8D4' },
    // 6F zones (정형외과병동)
    { code: 'F6-NS', nodeType: 'ZONE', name: '6층 간호스테이션', depth: 3, path: '본관/6F/간호스테이션', spaceType: 'NURSE_STATION', floor: 6, parentCode: '6f', capacity: 5, color: '#10B981', dept: '정형외과' },
    { code: 'F6-601', nodeType: 'ZONE', name: '601호', depth: 3, path: '본관/6F/601', spaceType: 'WARD_ROOM', floor: 6, parentCode: '6f', capacity: 4, color: '#3B82F6', room: '601', dept: '정형외과' },
    { code: 'F6-602', nodeType: 'ZONE', name: '602호', depth: 3, path: '본관/6F/602', spaceType: 'WARD_ROOM', floor: 6, parentCode: '6f', capacity: 4, color: '#3B82F6', room: '602', dept: '정형외과' },
    { code: 'F6-603', nodeType: 'ZONE', name: '603호', depth: 3, path: '본관/6F/603', spaceType: 'WARD_ROOM', floor: 6, parentCode: '6f', capacity: 2, color: '#3B82F6', room: '603', dept: '정형외과' },
    { code: 'F6-REHAB', nodeType: 'ZONE', name: '재활치료실', depth: 3, path: '본관/6F/재활치료실', spaceType: 'THERAPY', floor: 6, parentCode: '6f', capacity: 8, color: '#10B981', dept: '재활의학과' },
    { code: 'F6-GYM', nodeType: 'ZONE', name: '물리치료실', depth: 3, path: '본관/6F/물리치료', spaceType: 'THERAPY', floor: 6, parentCode: '6f', capacity: 10, color: '#10B981', dept: '재활의학과' },
    // 2F 추가 (전문과)
    { code: 'F2-ENT-207', nodeType: 'ZONE', name: '이비인후과', depth: 3, path: '본관/2F/이비인후과', spaceType: 'CLINIC', floor: 2, parentCode: '2f', capacity: 3, color: '#10B981', dept: '이비인후과', room: '207' },
    { code: 'F2-EYE-208', nodeType: 'ZONE', name: '안과', depth: 3, path: '본관/2F/안과', spaceType: 'CLINIC', floor: 2, parentCode: '2f', capacity: 3, color: '#10B981', dept: '안과', room: '208' },
    { code: 'F2-DRM-209', nodeType: 'ZONE', name: '피부과', depth: 3, path: '본관/2F/피부과', spaceType: 'CLINIC', floor: 2, parentCode: '2f', capacity: 3, color: '#10B981', dept: '피부과', room: '209' },
    { code: 'F2-PSY-210', nodeType: 'ZONE', name: '정신건강의학과', depth: 3, path: '본관/2F/정신과', spaceType: 'CLINIC', floor: 2, parentCode: '2f', capacity: 3, color: '#10B981', dept: '정신건강의학과', room: '210' },
    { code: 'F2-FM-211', nodeType: 'ZONE', name: '가정의학과', depth: 3, path: '본관/2F/가정의학과', spaceType: 'CLINIC', floor: 2, parentCode: '2f', capacity: 3, color: '#10B981', dept: '가정의학과', room: '211' },
    { code: 'F2-URO-212', nodeType: 'ZONE', name: '비뇨의학과', depth: 3, path: '본관/2F/비뇨기과', spaceType: 'CLINIC', floor: 2, parentCode: '2f', capacity: 3, color: '#10B981', dept: '비뇨의학과', room: '212' },
    { code: 'F2-NS-213', nodeType: 'ZONE', name: '신경외과', depth: 3, path: '본관/2F/신경외과', spaceType: 'CLINIC', floor: 2, parentCode: '2f', capacity: 3, color: '#10B981', dept: '신경외과', room: '213' },
    // 1F 추가
    { code: 'F1-CAFE', nodeType: 'ZONE', name: '카페', depth: 3, path: '본관/1F/카페', spaceType: 'AMENITY', floor: 1, parentCode: '1f', capacity: 20, color: '#F59E0B' },
    { code: 'F1-CONV', nodeType: 'ZONE', name: '편의점', depth: 3, path: '본관/1F/편의점', spaceType: 'AMENITY', floor: 1, parentCode: '1f', capacity: 10, color: '#F59E0B' },
    { code: 'F1-WAIT', nodeType: 'ZONE', name: '응급 대기실', depth: 3, path: '본관/1F/응급대기', spaceType: 'WAITING', floor: 1, parentCode: '1f', capacity: 15, color: '#FCA5A5', dept: '응급의학과' },
    // 건강검진센터 (B1)
    { code: 'B1', nodeType: 'FLOOR', name: 'B1 검진센터', depth: 2, path: '위루비병원/본관/B1', spaceType: 'FLOOR', floor: -1, parentCode: 'MAIN', meta: { description: '건강검진 전용 층' } },
    { code: 'B1-RC', nodeType: 'ZONE', name: '검진 접수', depth: 3, path: '본관/B1/접수', spaceType: 'RECEPTION', floor: -1, parentCode: 'B1', capacity: 4, color: '#3B82F6' },
    { code: 'B1-LAB', nodeType: 'ZONE', name: '검진 채혈실', depth: 3, path: '본관/B1/채혈', spaceType: 'LAB', floor: -1, parentCode: 'B1', capacity: 8, color: '#8B5CF6' },
    { code: 'B1-US', nodeType: 'ZONE', name: '초음파실', depth: 3, path: '본관/B1/초음파', spaceType: 'IMAGING', floor: -1, parentCode: 'B1', capacity: 3, color: '#8B5CF6' },
    { code: 'B1-XRAY', nodeType: 'ZONE', name: '검진 X-ray', depth: 3, path: '본관/B1/X-ray', spaceType: 'IMAGING', floor: -1, parentCode: 'B1', capacity: 2, color: '#8B5CF6' },
    { code: 'B1-GI', nodeType: 'ZONE', name: '위내시경실', depth: 3, path: '본관/B1/위내시경', spaceType: 'ENDOSCOPY', floor: -1, parentCode: 'B1', capacity: 3, color: '#8B5CF6' },
    { code: 'B1-REST', nodeType: 'ZONE', name: '검진 회복실', depth: 3, path: '본관/B1/회복실', spaceType: 'RECOVERY', floor: -1, parentCode: 'B1', capacity: 6, color: '#F59E0B' },
  ];

  // code → id 매핑
  const codeToId = new Map<string, string>();
  for (const s of spaceData) {
    const parentId = s.parentCode ? codeToId.get(s.parentCode) ?? null : null;
    const node = await prisma.spaceNode.upsert({
      where: { code: s.code },
      update: { name: s.name, floor: s.floor ?? undefined, spaceType: s.spaceType, capacity: s.capacity ?? undefined, color: s.color ?? undefined, department: (s as any).dept ?? undefined, roomNumber: (s as any).room ?? undefined, metadata: (s as any).meta ?? undefined },
      create: { code: s.code, nodeType: s.nodeType, name: s.name, depth: s.depth, path: s.path, spaceType: s.spaceType, floor: s.floor, parentId, capacity: s.capacity ?? undefined, color: s.color ?? undefined, department: (s as any).dept ?? undefined, roomNumber: (s as any).room ?? undefined, metadata: (s as any).meta ?? undefined },
    });
    codeToId.set(s.code, node.id);
  }
  console.log(`     → ${spaceData.length} space nodes seeded`);

  // ── PatientLocation 데모 (메타버스 뷰어용) ──
  console.log('  [Extra] Patient locations (demo)...');
  const locationPatients = await prisma.patient.findMany({ take: 20, select: { id: true } });
  const allZones = await prisma.spaceNode.findMany({ where: { spaceType: { notIn: ['HOSPITAL', 'BUILDING', 'FLOOR'] }, isActive: true }, select: { id: true, spaceType: true } });
  if (locationPatients.length > 0 && allZones.length > 0) {
    const statuses = ['WAITING', 'IN_CONSULTATION', 'IN_LAB', 'IN_IMAGING', 'MOVING', 'RESTING'];
    const demoLocations = locationPatients.slice(0, Math.min(20, locationPatients.length)).map((p, i) => ({
      patientId: p.id,
      zoneId: allZones[i % allZones.length].id,
      status: statuses[i % statuses.length],
      enteredAt: new Date(Date.now() - (Math.random() * 3600000)),
      source: 'SIMULATED', // 데모 난수 배치 — 관측도 추정도 아니다(P0-1)
    }));
    // Clear old demo locations
    await prisma.patientLocation.deleteMany({ where: { leftAt: null } });
    await prisma.patientLocation.createMany({ data: demoLocations });
    console.log(`     → ${demoLocations.length} patient locations seeded`);
  }

  // ── 외래 진료실 ↔ 공간(가상병원) — 진료실 구역 이름을 그대로 진료실 이름으로 연결(create 만 · 재시드가 관리자 연결을 덮지 않게) ──
  // 스케줄 시드(`${dept} ${n}진료실`)와 이름이 같은 것만 대기표에 층이 뜬다 — 나머지는 관리 화면 '외래 진료실 공간 연결'에서.
  const clinicZones = await prisma.spaceNode.findMany({ where: { spaceType: 'CLINIC', nodeType: 'ZONE', isActive: true }, select: { id: true, name: true } });
  for (const z of clinicZones) {
    await prisma.clinicRoom.upsert({ where: { name: z.name }, update: {}, create: { name: z.name, spaceNodeId: z.id } });
  }
  console.log(`     → ${clinicZones.length} clinic rooms linked to space`);

  // ── 연동 기관 (Organization) ──
  console.log('  [Extra] Organizations...');
  const orgData = [
    { code: 'WERUBYHOSP', name: '위루비병원', orgType: 'HOSPITAL', grade: 'GENERAL', country: 'KOR', phone: '02-000-0000', isSelf: true },
    { code: '11100001', name: '가상대학교병원', orgType: 'HOSPITAL', grade: 'TERTIARY', country: 'KOR', phone: '02-000-0000', fhirEndpoint: 'https://fhir.partner-a.example/R4' },
    { code: '11100002', name: '가상의료원', orgType: 'HOSPITAL', grade: 'TERTIARY', country: 'KOR', phone: '02-000-0000' },
    { code: '31100001', name: '가상대분당병원', orgType: 'HOSPITAL', grade: 'GENERAL', country: 'KOR', phone: '02-000-0000' },
    { code: 'TMU-001', name: 'Example Medical University (JP)', orgType: 'HOSPITAL', grade: 'TERTIARY', country: 'JPN' },
    { code: 'INS-A', name: 'Example Travel Insurance', orgType: 'INSURANCE', country: 'USA' },
  ];
  for (const org of orgData) {
    await prisma.organization.upsert({
      where: { code: org.code },
      update: { name: org.name },
      create: { ...org, isActive: true, isSelf: org.isSelf ?? false },
    });
  }
  console.log(`     → ${orgData.length} organizations seeded`);

  // ── 파트너 연동 신청 데모 ──
  console.log('  [Extra] Partner requests (demo)...');
  const partnerData = [
    { orgName: 'Example Medical College (CN)', orgType: 'HOSPITAL', country: 'CHN', contactName: 'Dr. Wang', contactEmail: 'wang@pumc.example', purpose: ['TRANSFER', 'HIE'], requestedScopes: ['patient/*.read', 'encounter/*.read'], status: 'PENDING' },
    { orgName: 'Example Clinic (US)', orgType: 'HOSPITAL', country: 'USA', contactName: 'Dr. Smith', contactEmail: 'smith@mayo.example', purpose: ['TRANSFER'], requestedScopes: ['patient/*.read', 'observation/*.read'], status: 'REVIEWING' },
    { orgName: 'Example Global Assistance', orgType: 'INSURANCE', country: 'DEU', contactName: 'Hans Mueller', contactEmail: 'h.mueller@allianz.example', purpose: ['INSURANCE_CLAIM'], requestedScopes: ['patient/*.read'], status: 'APPROVED' },
  ];
  for (const pr of partnerData) {
    const exists = await prisma.partnerRequest.findFirst({ where: { contactEmail: pr.contactEmail } });
    if (!exists) {
      await prisma.partnerRequest.create({ data: pr });
    }
  }
  console.log(`     → ${partnerData.length} partner requests seeded`);

  // ── CDSS 규칙 ──
  console.log('  [Extra] CDSS rules...');
  const cdssRulesData = [
    { category: 'INTERACTION', level: 'ERROR', name: '와파린+아스피린', description: '출혈 위험 증가', drugA: '와파린', drugB: '아스피린', recommendation: '병용 금기' },
    { category: 'INTERACTION', level: 'ERROR', name: 'PPI+클로피도그렐', description: 'PPI가 클로피도그렐 효과 감소', drugA: '오메프라졸', drugB: '클로피도그렐', recommendation: 'H2 blocker 사용' },
    { category: 'INTERACTION', level: 'ERROR', name: 'SSRI+MAO억제제', description: '세로토닌 증후군 위험', drugA: 'SSRI', drugB: 'MAO억제제', recommendation: '절대 병용 금지' },
    { category: 'INTERACTION', level: 'ERROR', name: '마크로라이드+스타틴', description: '횡문근융해증 위험', drugA: '클래리스로마이신', drugB: '아토르바스타틴', recommendation: '스타틴 일시 중단' },
    { category: 'INTERACTION', level: 'WARNING', name: '메트포르민+조영제', description: '유산산증 위험', drugA: '메트포르민', drugB: '조영제', recommendation: 'CT 48시간 전 중단' },
    { category: 'INTERACTION', level: 'WARNING', name: 'NSAIDs+ARB', description: '혈압강하 효과 감소', drugA: '이부프로펜', drugB: '로사르탄' },
    { category: 'INTERACTION', level: 'WARNING', name: '스테로이드+NSAIDs', description: '위장관 출혈 위험', drugA: '프레드니솔론', drugB: '이부프로펜', recommendation: 'PPI 병용' },
    { category: 'INTERACTION', level: 'WARNING', name: 'SSRI+트라마돌', description: '세로토닌 증후군 위험', drugA: 'SSRI', drugB: '트라마돌' },
    { category: 'AGE', level: 'ERROR', name: '소아 아스피린 금기', description: 'Reye 증후군', drugA: '아스피린', ageMax: 18 },
    { category: 'AGE', level: 'ERROR', name: '소아 트라마돌 금기', description: '12세 이하 금기', drugA: '트라마돌', ageMax: 12 },
    { category: 'AGE', level: 'WARNING', name: '고령자 졸피뎀 감량', description: '65세 이상 감량', drugA: '졸피뎀', ageMin: 65, recommendation: '5mg으로 감량' },
    { category: 'DOSE', level: 'WARNING', name: '아세트아미노펜 최대용량', description: '일일 4000mg', drugA: '아세트아미노펜', maxDose: '4000mg/day' },
    { category: 'DOSE', level: 'WARNING', name: '이부프로펜 최대용량', description: '일일 2400mg', drugA: '이부프로펜', maxDose: '2400mg/day' },
    { category: 'RENAL', level: 'WARNING', name: '메트포르민 신기능', description: 'eGFR<30 금기', drugA: '메트포르민', recommendation: 'eGFR 30-60: 감량' },
    { category: 'DIAGNOSIS', level: 'INFO', name: '고혈압 1차 약물', description: 'CCB/ACEi/ARB', diagnosisCode: 'I10', recommendation: 'JNC-8' },
    { category: 'DIAGNOSIS', level: 'INFO', name: '당뇨 1차 약물', description: '메트포르민', diagnosisCode: 'E11', recommendation: 'ADA 가이드라인' },
    { category: 'DIAGNOSIS', level: 'INFO', name: '고지혈증 1차 약물', description: '스타틴', diagnosisCode: 'E78', recommendation: 'ACC/AHA' },
  ];
  for (const rule of cdssRulesData) {
    const existing = await prisma.cdssRule.findFirst({ where: { name: rule.name } });
    if (!existing) await prisma.cdssRule.create({ data: rule as any });
  }
  console.log(`     → ${cdssRulesData.length} CDSS rules seeded`);

  // ============================================================
  // 전문과 Phase 2 시드 (7개 과)
  // ============================================================
  console.log('  [Specialty Phase 2] 7개 전문과 시드...');

  // 전문과별 전용 의사 ID
  const orthoDrId = uid(P.USER, 8);   // 오정형 (정형외과)
  const obgynDrId = uid(P.USER, 7);   // 한산부 (산부인과)
  const pediDrId = uid(P.USER, 6);    // 정소아 (소아청소년과)
  const psychDrId = uid(P.USER, 28);  // 테스트 정신과
  const neuroDrId = uid(P.USER, 26);  // 테스트 신경외과
  const plasticDrId = uid(P.USER, 27); // 테스트 성형외과
  const uroDrId = uid(P.USER, 32);    // 테스트 비뇨기
  const spPats = await prisma.patient.findMany({ take: 6, select: { id: true } });

  if (spPats.length >= 3) {
    const p0 = spPats[0].id, p1 = spPats[1].id, p2 = spPats[2].id;
    const p3 = spPats[3]?.id ?? p0, p4 = spPats[4]?.id ?? p1, p5 = spPats[5]?.id ?? p2;

    // ── 정형외과 ──
    const orthoData = [
      { patientId: p0, bodyPart: 'KNEE', side: 'RIGHT', rom: [{ movement: '굴곡', measured: 120, normal: 135 }, { movement: '신전', measured: -5, normal: 0 }], mmt: [{ muscle: '대퇴사두근', grade: 4 }, { muscle: '햄스트링', grade: 4 }], specialTests: [{ test: 'McMurray', result: '+', notes: '내측' }, { test: 'Lachman', result: '-' }], painVas: 6, painLocation: '내측 관절선', painPattern: '활동 시 악화', diagnosis: '내측 반월판 파열', examinedBy: orthoDrId },
      { patientId: p1, bodyPart: 'SHOULDER', side: 'LEFT', rom: [{ movement: '굴곡', measured: 120, normal: 180 }, { movement: '외전', measured: 100, normal: 180 }], mmt: [{ muscle: '삼각근', grade: 3 }], specialTests: [{ test: 'Neer', result: '+' }, { test: 'Hawkins', result: '+' }], painVas: 7, diagnosis: '회전근개 파열', examinedBy: orthoDrId },
      { patientId: p2, bodyPart: 'SPINE_L', side: 'BILATERAL', rom: [{ movement: '굴곡', measured: 40, normal: 60 }], specialTests: [{ test: 'SLR', result: '+', notes: 'L5' }], painVas: 8, fractureClass: '31-A2.1', diagnosis: '요추 추간판 탈출증 L4-5', examinedBy: orthoDrId },
    ];
    for (const d of orthoData) {
      await prisma.orthoExam.create({ data: { ...d, rom: d.rom as any, mmt: (d.mmt ?? []) as any, specialTests: (d.specialTests ?? []) as any } });
    }

    // ── 산부인과 ──
    const obgynData = [
      { patientId: p3, examType: 'PRENATAL' as const, gestationalAge: '28W3D', edd: new Date('2026-08-15'), gravida: 2, para: 1, currentWeight: 72.5, prePregnancyWeight: 58, bloodPressure: '120/75', urineProtein: '-', urineGlucose: '-', edema: 'MILD', fundalHeight: 28, fetalHeartRate: 140, fetalMovement: 'ACTIVE', ultrasound: { bpd: 72, fl: 54, ac: 245, efw: 1250, afi: 14, presentation: '두위', placentaLocation: '전벽 상부' }, diagnosis: '정상 임신 28주', examinedBy: obgynDrId },
      { patientId: p4, examType: 'GYNECOLOGY' as const, papSmear: 'NILM', hpvTest: 'Negative', pelvicUltrasound: { uterus: '정상', ovary: '정상' }, diagnosis: '정상 검진', examinedBy: obgynDrId },
      { patientId: p3, examType: 'PRENATAL' as const, gestationalAge: '32W1D', gravida: 2, para: 1, currentWeight: 74.2, bloodPressure: '118/72', fetalHeartRate: 145, fundalHeight: 31, nst: { baseline: 140, variability: 'moderate', accelerations: true, decelerations: false, reactive: true }, diagnosis: '정상 임신 32주', examinedBy: obgynDrId },
    ];
    for (const d of obgynData) {
      await prisma.obGynExam.create({ data: { ...d, ultrasound: d.ultrasound as any, nst: (d as any).nst as any, pelvicUltrasound: (d as any).pelvicUltrasound as any } });
    }

    // ── 소아청소년과 ──
    // ⚠️ 소아 성장/예방접종/발달은 반드시 실제 소아 환자에 배정. spPats(앞 6명)의 p5는 성인(한지영)이라
    //    과거 오배정 버그가 있었음 → 임하늘(i:12, 2018-10-05생 소아)에 고정.
    const pediPat = uid(P.PATIENT, 12); // 임하늘 (소아)
    // 백분위는 넣지 않는다(2026-10-10) — 기준표로 계산한 값이 아니다(서버도 입력받지 않는다)
    await prisma.pediatricGrowth.createMany({ data: [
      { patientId: pediPat, ageMonths: 0, weight: 3.4, height: 50.5, headCirc: 34.5, bmi: 13.3, measuredBy: pediDrId },
      { patientId: pediPat, ageMonths: 6, weight: 7.8, height: 67.0, headCirc: 43.0, bmi: 17.4, measuredBy: pediDrId },
      { patientId: pediPat, ageMonths: 12, weight: 10.2, height: 76.5, headCirc: 46.0, bmi: 17.4, measuredBy: pediDrId },
      { patientId: pediPat, ageMonths: 24, weight: 12.8, height: 88.0, headCirc: 48.5, bmi: 16.5, measuredBy: pediDrId },
      { patientId: pediPat, ageMonths: 36, weight: 14.5, height: 96.5, headCirc: 49.5, bmi: 15.6, measuredBy: pediDrId },
    ] });
    // 예방접종 날짜 = 임하늘 출생(2018-10) 기준 표준 일정
    await prisma.pediatricImmunization.createMany({ data: [
      { patientId: pediPat, vaccineName: 'BCG', vaccineCode: 'BCG', doseNumber: 1, givenAt: new Date('2018-10-15'), site: 'LEFT_ARM', givenBy: pediDrId },
      { patientId: pediPat, vaccineName: 'B형간염', vaccineCode: 'HepB', doseNumber: 1, givenAt: new Date('2018-10-15'), givenBy: pediDrId },
      { patientId: pediPat, vaccineName: 'B형간염', vaccineCode: 'HepB', doseNumber: 2, givenAt: new Date('2018-11-15'), givenBy: pediDrId },
      { patientId: pediPat, vaccineName: 'B형간염', vaccineCode: 'HepB', doseNumber: 3, givenAt: new Date('2019-04-15'), givenBy: pediDrId },
      { patientId: pediPat, vaccineName: 'DTaP', vaccineCode: 'DTaP', doseNumber: 1, givenAt: new Date('2018-12-15'), site: 'LEFT_THIGH', givenBy: pediDrId },
      { patientId: pediPat, vaccineName: 'DTaP', vaccineCode: 'DTaP', doseNumber: 2, givenAt: new Date('2019-02-15'), givenBy: pediDrId },
      { patientId: pediPat, vaccineName: 'DTaP', vaccineCode: 'DTaP', doseNumber: 3, givenAt: new Date('2019-04-15'), givenBy: pediDrId },
      { patientId: pediPat, vaccineName: 'IPV', vaccineCode: 'IPV', doseNumber: 1, givenAt: new Date('2018-12-15'), givenBy: pediDrId },
      { patientId: pediPat, vaccineName: 'MMR', vaccineCode: 'MMR', doseNumber: 1, givenAt: new Date('2019-10-15'), site: 'RIGHT_ARM', givenBy: pediDrId },
      { patientId: pediPat, vaccineName: '수두', vaccineCode: 'VAR', doseNumber: 1, givenAt: new Date('2019-10-15'), givenBy: pediDrId },
    ] });
    await prisma.developmentalAssessment.create({ data: { patientId: pediPat, ageMonths: 36, tool: 'DENVER_II', grossMotor: 'NORMAL', fineMotor: 'NORMAL', language: 'NORMAL', socialPersonal: 'NORMAL', overallResult: 'NORMAL', assessedBy: pediDrId } });

    // ── 정신건강의학과 ──
    const psychData = [
      { patientId: p0, appearance: '단정', behavior: '협조적', speech: '정상속도', mood: '우울', affect: '제한', thoughtContent: { suicidalIdeation: false, delusions: false }, thoughtProcess: '논리적', perception: { hallucinations: { auditory: false, visual: false } }, cognition: { orientation: true, memory: true }, insight: 'GOOD', phq9: 18, gad7: 8, mmse: 28, suicideRisk: 'LOW', safetyPlan: true, diagnosis: '주요우울장애 중등도', examinedBy: psychDrId },
      { patientId: p0, appearance: '단정', behavior: '협조적', mood: '우울', affect: '제한', insight: 'GOOD', phq9: 16, gad7: 10, mmse: 28, suicideRisk: 'LOW', diagnosis: '주요우울장애 — 2차 방문', examinedBy: psychDrId },
      { patientId: p0, appearance: '단정', behavior: '협조적', mood: '경한 우울', affect: '적절', insight: 'GOOD', phq9: 14, gad7: 10, mmse: 29, suicideRisk: 'LOW', diagnosis: '주요우울장애 — 호전 중', examinedBy: psychDrId },
      { patientId: p1, appearance: '단정', behavior: '초조', mood: '불안', affect: '불안', insight: 'PARTIAL', phq9: 8, gad7: 15, mmse: 30, audit: 12, suicideRisk: 'MODERATE', diagnosis: '범불안장애 + 위험음주', examinedBy: psychDrId },
    ];
    for (const d of psychData) {
      const { thoughtContent, ...rest } = d;
      const psy = rest as any;
      const createData: any = { ...psy };
      if (thoughtContent) createData.thoughtContent = thoughtContent;
      if (psy.perception) createData.perception = psy.perception; else delete createData.perception;
      if (psy.cognition) createData.cognition = psy.cognition; else delete createData.cognition;
      const existing = await prisma.psychExam.findFirst({ where: { patientId: d.patientId, diagnosis: d.diagnosis } });
      if (!existing) await prisma.psychExam.create({ data: createData });
    }

    // ── 신경외과 ──
    const neuroData = [
      { patientId: p2, gcsEye: 4, gcsVerbal: 5, gcsMotor: 6, gcsTotal: 15, pupilRight: { size: 3, reactive: true }, pupilLeft: { size: 3, reactive: true }, motorExam: [{ level: 'C5', left: 5, right: 5 }, { level: 'C6', left: 5, right: 4 }, { level: 'C7', left: 5, right: 4 }, { level: 'L5', left: 5, right: 3 }, { level: 'S1', left: 5, right: 4 }], reflexes: [{ name: '이두근', left: '++', right: '++' }, { name: '슬개건', left: '++', right: '+++' }], babinski: { left: false, right: true }, nihss: 4, diagnosis: '경추 척수증 C5-6', examinedBy: neuroDrId },
      { patientId: p3, gcsEye: 3, gcsVerbal: 4, gcsMotor: 5, gcsTotal: 12, pupilRight: { size: 4, reactive: true }, pupilLeft: { size: 3, reactive: true }, anisocoria: true, motorExam: [{ level: 'C5', left: 5, right: 3 }, { level: 'C6', left: 5, right: 3 }], nihss: 8, diagnosis: '우측 경막하 혈종', examinedBy: neuroDrId },
    ];
    for (const d of neuroData) {
      await prisma.neuroExam.create({ data: { ...d, pupilRight: d.pupilRight as any, pupilLeft: d.pupilLeft as any, motorExam: d.motorExam as any, reflexes: (d.reflexes ?? []) as any, babinski: (d.babinski ?? {}) as any } });
    }

    // ── 비뇨의학과 ──
    const uroData = [
      { patientId: p1, ipssScore: 18, ipssQol: 4, psaValue: 3.2, urodynamics: { maxFlowRate: 12, avgFlowRate: 6.5, voidedVolume: 250, residualVolume: 80 }, prostateVolume: 42, diagnosis: '전립선 비대증 중등도', examinedBy: uroDrId },
      { patientId: p2, ipssScore: 25, ipssQol: 5, psaValue: 6.8, urodynamics: { maxFlowRate: 8, avgFlowRate: 4.2, voidedVolume: 180, residualVolume: 150 }, prostateVolume: 65, diagnosis: '전립선 비대증 중증 — PSA 상승', examinedBy: uroDrId },
    ];
    for (const d of uroData) {
      await prisma.urologyExam.create({ data: { ...d, urodynamics: d.urodynamics as any } });
    }

    // ── 성형외과 ──
    await prisma.plasticExam.createMany({ data: [
      { patientId: p4, bodyPart: 'NOSE', procedure: '비중격 교정술', anesthesiaType: '전신', material: '실리콘 보형물', fitzpatrickType: 3, skinElasticity: '양호', scarTendency: '정상', duration: 90, examinedBy: plasticDrId },
      { patientId: p5, bodyPart: 'EYELID', procedure: '상안검 성형술', anesthesiaType: '국소', fitzpatrickType: 3, skinElasticity: '양호', duration: 45, examinedBy: plasticDrId },
    ] });

    console.log('     → 정형외과 3건, 산부인과 3건, 소아 성장5+접종10+발달1, 정신과 4건, 신경외과 2건, 비뇨기과 2건, 성형외과 2건');

    // ── 내과 8전문과 ──
    console.log('  [Internal Medicine] 내과 8전문과 시드...');
    const imDocId = uid(P.USER, 2); // 김내과
    const imData = [
      { patientId: p0, subspecialty: 'CARDIOLOGY', nyhaClass: 2, lvef: 45, heartRhythm: 'AF', cha2ds2vasc: 4, hasbled: 2, inrTarget: 2.5, inrActual: 2.3, echoSummary: { lvef: 45, la: 42, lv: 55 }, diagnosis: '심방세동 + 심부전 NYHA II', examinedBy: imDocId },
      { patientId: p0, subspecialty: 'CARDIOLOGY', nyhaClass: 2, lvef: 48, heartRhythm: 'AF', cha2ds2vasc: 4, inrActual: 2.6, diagnosis: '심방세동 — F/U, LVEF 호전', examinedBy: imDocId },
      { patientId: p1, subspecialty: 'PULMONOLOGY', fev1: 1.8, fvc: 3.2, fev1Fvc: 56, goldStage: 2, curb65: 1, catScore: 18, mmrcGrade: 2, oxygenTherapy: { flowRate: 2, method: 'nasal', spo2Target: 94 }, diagnosis: 'COPD GOLD II 안정기', examinedBy: imDocId },
      { patientId: p2, subspecialty: 'GASTRO', endoscopyType: 'EGD', childPughScore: 7, childPughClass: 'B', meldScore: 14, ascites: 'MILD', varicesGrade: 'F2', endoscopyFindings: { esophagus: '정맥류 F2', stomach: '문맥성 위병증', duodenum: '정상' }, diagnosis: '간경변 Child B + 식도정맥류 F2', examinedBy: imDocId },
      { patientId: p3, subspecialty: 'ENDOCRINE', hba1c: 8.2, fastingGlucose: 165, insulinRegimen: { type: 'basal-bolus', dose: '란투스 20U hs + 휴마로그 8-8-8U' }, thyroidFunction: { tsh: 2.1, ft4: 1.2 }, diagnosis: '제2형 당뇨 — HbA1c 미조절', examinedBy: imDocId },
      { patientId: p3, subspecialty: 'ENDOCRINE', hba1c: 7.5, fastingGlucose: 140, bmdTScore: -2.8, bmdSite: 'SPINE', fraxScore: 15, diagnosis: '당뇨 호전 + 골다공증', examinedBy: imDocId },
      { patientId: p4, subspecialty: 'NEPHROLOGY', ckdStage: 'G3b', egfr: 38, electrolytes: { Na: 138, K: 5.1, Ca: 8.8, P: 4.9, Mg: 1.9 }, diagnosis: 'CKD G3b — 고칼륨 주의', examinedBy: imDocId },
      { patientId: p5, subspecialty: 'HEMATO_ONCOLOGY', cancerType: '비소세포폐암', tnmStage: 'T2N1M0', ecogPs: 1, regimenName: 'Cisplatin+Pemetrexed', cycleDay: 'C2D1', bsa: 1.72, recistResponse: 'PR', diagnosis: 'NSCLC Stage IIIA — C2 PR', examinedBy: imDocId },
      { patientId: p0, subspecialty: 'INFECTIOUS', infectionSite: '폐', organism: 'Streptococcus pneumoniae', susceptibility: { penicillin: 'S', ceftriaxone: 'S', levofloxacin: 'S' }, antibiotics: [{ name: 'Ceftriaxone', start: '2026-05-15', route: 'IV' }], qsofa: 1, sofaScore: 3, procalcitonin: 0.8, diagnosis: '지역사회 획득 폐렴 — CURB-65 1점', examinedBy: imDocId },
      { patientId: p1, subspecialty: 'RHEUMATOLOGY', tenderJointCount: 8, swollenJointCount: 5, das28: 4.8, haqDi: 1.2, autoantibodies: { RF: true, CCP: true, ANA: false }, biologics: [{ name: '메토트렉세이트', dose: '15mg/주' }], diagnosis: '류마티스 관절염 — DAS28 중등도 활성', examinedBy: imDocId },
    ];
    for (const d of imData) {
      await prisma.internalMedicineExam.create({ data: { ...d, echoSummary: (d as any).echoSummary as any, oxygenTherapy: (d as any).oxygenTherapy as any, endoscopyFindings: (d as any).endoscopyFindings as any, insulinRegimen: (d as any).insulinRegimen as any, thyroidFunction: (d as any).thyroidFunction as any, electrolytes: (d as any).electrolytes as any, susceptibility: (d as any).susceptibility as any, antibiotics: (d as any).antibiotics as any, autoantibodies: (d as any).autoantibodies as any, biologics: (d as any).biologics as any } });
    }
    console.log(`     → 내과 ${imData.length}건 (순환기2/호흡기1/소화기1/내분비2/신장1/혈종1/감염1/류마티스1)`);

    // ── 외과 Op Note ──
    console.log('  [Surgery Op Note] 수술 기록 확장 시드...');
    const existingSurgeries = await prisma.surgery.findMany({ take: 2, select: { id: true }, orderBy: { createdAt: 'desc' } });
    for (const s of existingSurgeries) {
      const existing = await prisma.surgeryOpNote.findUnique({ where: { surgeryId: s.id } });
      if (!existing) {
        await prisma.surgeryOpNote.create({
          data: {
            surgeryId: s.id,
            preOpDiagnosis: '우측 서혜부 탈장',
            postOpDiagnosis: '우측 간접 서혜부 탈장',
            anesthesiaType: 'GENERAL',
            asaClass: 2,
            mallampatiClass: 2,
            vteProphylaxis: true,
            prophylacticAbx: 'Cefazolin 2g IV 절개 30분 전',
            whoChecklist: { signIn: true, timeOut: true, signOut: true } as any,
            findings: '간접 서혜부 탈장 확인, 탈장낭 고위결찰 후 메쉬 삽입',
            specimens: [{ type: '탈장낭', site: '우측 서혜부', count: 1 }] as any,
            estimatedBloodLoss: 50,
            fluidBalance: { crystalloid: 1000, colloid: 0, blood: 0, urine: 300 } as any,
            implants: [{ name: 'Ultrapro mesh', manufacturer: 'Ethicon', lot: 'UPM-2026' }] as any,
            narrative: '절개 → 외복사근건막 절개 → 정삭 확인 → 탈장낭 박리 → 고위결찰 → mesh 삽입 → 층별 봉합',
            complicationGrade: 'I',
            createdBy: imDocId,
          },
        });
      }
    }
    console.log(`     → Op Note ${existingSurgeries.length}건`);

    // ── 화상 평가 ──
    console.log('  [Burn Assessment] 화상 평가 시드...');
    await prisma.burnAssessment.create({
      data: {
        patientId: p2,
        tbsa: 18,
        regions: [
          { region: 'LEFT_UPPER_ARM', percentage: 4.5, depth: 'PARTIAL' },
          { region: 'CHEST', percentage: 9, depth: 'SUPERFICIAL' },
          { region: 'LEFT_FOREARM', percentage: 4.5, depth: 'PARTIAL' },
        ] as any,
        mechanism: '열탕',
        isChild: false,
        notes: '끓는 물에 의한 2도 화상',
        assessedBy: imDocId,
      },
    });
    console.log('     → 화상 평가 1건 (TBSA 18%)');
  }

  // ============================================================
  // Blockchain Certificates (블록체인 인증서) — 5 certs + 3 audit logs + 2 signed docs
  // ============================================================
  console.log('  [+] Blockchain Certificates...');

  const bcCertSeedData = [
    // 전체 users 배열에서 자동 생성
    ...users.map((u, idx) => {
      const roleMap: Record<string, string> = { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR', NURSE: 'NURSE', PHARMACIST: 'PHARMACIST', LAB_TECH: 'LAB_TECH' };
      return {
        i: idx + 1,
        ownerType: 'STAFF' as const,
        userId: uid(P.USER, u.i),
        subjectDn: `CN=${u.familyName}${u.givenName},OU=${u.dept ?? '행정'},O=위루비병원`,
        algorithm: idx % 5 === 4 ? 'RSA-2048' : 'ECDSA-P256', // 대부분 ECDSA, 일부 RSA
        licenseNumber: u.spec ? `LIC-${u.i.toString().padStart(4, '0')}` : null,
        department: u.dept ?? '행정',
        licenseType: roleMap[u.role] ?? null,
      };
    }),
  ];

  const bcCertIds: string[] = [];
  for (const cd of bcCertSeedData) {
    const bcCertId = makeUuid('bc010000', cd.i);
    const dummyPublicKey = `-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE_dummy_seed_cert_${cd.i}_${cd.algorithm}==\n-----END PUBLIC KEY-----`;
    const serialNumber = `CERT-20260520-${randomBytes(4).toString('hex').toUpperCase()}${cd.i.toString().padStart(2, '0')}`;
    const certHash = createHash('sha256').update(dummyPublicKey).digest('hex');
    const fingerprint = createHash('sha256').update(`${serialNumber}:${dummyPublicKey}`).digest('hex');

    const existing = await prisma.blockchainCertificate.findUnique({ where: { id: bcCertId } });
    if (!existing) {
      await prisma.blockchainCertificate.create({
        data: {
          id: bcCertId,
          ownerType: cd.ownerType,
          userId: cd.userId,
          serialNumber,
          subjectDn: cd.subjectDn,
          publicKey: dummyPublicKey,
          algorithm: cd.algorithm,
          issuedAt: new Date(),
          expiresAt: new Date('2099-12-31'),
          status: 'ACTIVE',
          licenseNumber: cd.licenseNumber,
          licenseType: cd.licenseType,
          department: cd.department,
          certHash,
          fingerprint,
        },
      });
    }
    bcCertIds.push(bcCertId);
  }
  console.log(`     → ${bcCertSeedData.length} blockchain certificates seeded`);

  // Audit logs for blockchain certificates
  const bcAuditLogs = [
    { i: 1, certIdx: 0, userId: uid(P.USER, 1), eventType: 'ISSUED', detail: { method: 'ADMIN_SELF' }, ip: '192.168.1.10' },
    { i: 2, certIdx: 1, userId: uid(P.USER, 2), eventType: 'ISSUED', detail: { method: 'WEB_KEYGEN' }, ip: '192.168.1.20' },
    { i: 3, certIdx: 1, userId: uid(P.USER, 2), eventType: 'SIGN_SUCCESS', detail: { documentType: 'ENCOUNTER', documentId: 'test-doc-001' }, ip: '192.168.1.20' },
  ];

  for (const al of bcAuditLogs) {
    const auditId = makeUuid('ba010000', al.i);
    const existingAudit = await prisma.certificateAuditLog.findUnique({ where: { id: auditId } });
    if (!existingAudit) {
      await prisma.certificateAuditLog.create({
        data: {
          id: auditId,
          certificateId: bcCertIds[al.certIdx],
          userId: al.userId,
          actorType: 'STAFF',
          eventType: al.eventType,
          eventDetail: al.detail as never,
          ipAddress: al.ip,
        },
      });
    }
  }
  console.log(`     → ${bcAuditLogs.length} certificate audit logs seeded`);

  // Signed documents + document signatures (test data)
  const signedDocIds: string[] = [];
  const bcSignedDocs = [
    { i: 1, docType: 'ENCOUNTER', patientIdx: 1, hash: createHash('sha256').update('test-encounter-doc-1').digest('hex') },
    { i: 2, docType: 'PRESCRIPTION', patientIdx: 2, hash: createHash('sha256').update('test-prescription-doc-1').digest('hex') },
  ];

  for (const sd of bcSignedDocs) {
    const sdId = makeUuid('00cc0100', sd.i);
    const existingDoc = await prisma.signedDocument.findUnique({ where: { id: sdId } });
    if (!existingDoc) {
      await prisma.signedDocument.create({
        data: {
          id: sdId,
          documentType: sd.docType,
          documentId: makeUuid('00dd0100', sd.i), // dummy reference
          patientId: uid(P.PATIENT, sd.patientIdx),
          documentHash: sd.hash,
          status: 'COMPLETED',
          completedSigners: 1,
        },
      });
    }
    signedDocIds.push(sdId);
  }

  const bcDocSigs = [
    { i: 1, sdIdx: 0, certIdx: 1, userId: uid(P.USER, 2), algo: 'ECDSA-P256', role: 'PRIMARY' },
    { i: 2, sdIdx: 1, certIdx: 1, userId: uid(P.USER, 2), algo: 'ECDSA-P256', role: 'PRIMARY' },
  ];

  for (const ds of bcDocSigs) {
    const dsId = makeUuid('00ee0100', ds.i);
    const existingSig = await prisma.documentSignature.findUnique({ where: { id: dsId } });
    if (!existingSig) {
      await prisma.documentSignature.create({
        data: {
          id: dsId,
          signedDocumentId: signedDocIds[ds.sdIdx],
          certificateId: bcCertIds[ds.certIdx],
          signatureValue: `dummy_signature_value_${ds.i}_${randomBytes(16).toString('hex')}`,
          signatureAlgorithm: ds.algo,
          signedAt: new Date(Date.now() - ds.i * 3600000),
          signerRole: ds.role,
          signerType: 'STAFF',
          signerUserId: ds.userId,
          ipAddress: '192.168.1.20',
        },
      });
    }
  }
  console.log(`     → ${bcDocSigs.length} document signatures seeded`);

  // ============================================================
  // 나의 약속처방 시드 (DoctorCodeList + DepartmentCodeCatalog + DoctorPrescriptionSet)
  // ============================================================
  console.log('  [+] Doctor Codes & Prescription Sets...');

  const allMeds = await prisma.medicationCode.findMany({ take: 10, select: { id: true, code: true, nameKo: true } });
  const allProcs = await prisma.procedureCode.findMany({ take: 10, select: { id: true, code: true, nameKo: true, category: true } });

  if (allMeds.length >= 5 && allProcs.length >= 5) {
    const kimDrId = uid(P.USER, 2); // 김내과
    const parkDrId = uid(P.USER, 3); // 박내과

    // 의사 개인 코드 (김내과)
    const myCodes = [
      { cat: 'MEDICATION', codeId: allMeds[0].id, codeType: 'MEDICATION_CODE', name: allMeds[0].nameKo, dosage: '1T', freq: '1일 1회', route: 'PO', dur: 30, pinned: true, count: 42 },
      { cat: 'MEDICATION', codeId: allMeds[1].id, codeType: 'MEDICATION_CODE', name: allMeds[1].nameKo, dosage: '1T', freq: '1일 2회', route: 'PO', dur: 14, pinned: false, count: 15 },
      { cat: 'MEDICATION', codeId: allMeds[2].id, codeType: 'MEDICATION_CODE', name: allMeds[2].nameKo, dosage: '1T', freq: '필요시', route: 'PO', dur: 7, pinned: false, count: 28 },
      { cat: 'MEDICATION', codeId: allMeds[3].id, codeType: 'MEDICATION_CODE', name: allMeds[3].nameKo, dosage: '1C', freq: '1일 1회', route: 'PO', dur: 28, pinned: true, count: 38 },
      { cat: 'LAB', codeId: allProcs[0].id, codeType: 'PROCEDURE_CODE', name: allProcs[0].nameKo, pinned: true, count: 55 },
      { cat: 'LAB', codeId: allProcs[1].id, codeType: 'PROCEDURE_CODE', name: allProcs[1].nameKo, pinned: false, count: 22 },
      { cat: 'IMAGING', codeId: allProcs[3].id, codeType: 'PROCEDURE_CODE', name: allProcs[3].nameKo, pinned: false, count: 35 },
    ];

    for (const mc of myCodes) {
      const existing = await prisma.doctorCodeList.findFirst({ where: { doctorId: kimDrId, codeId: mc.codeId } });
      if (!existing) {
        await prisma.doctorCodeList.create({
          data: {
            doctorId: kimDrId, category: mc.cat, codeId: mc.codeId, codeType: mc.codeType,
            displayName: mc.name, defaultDosage: mc.dosage ?? null, defaultFrequency: mc.freq ?? null,
            defaultDuration: mc.dur ?? null, defaultRoute: mc.route ?? null,
            isPinned: mc.pinned, useCount: mc.count,
          },
        });
      }
    }

    // 진료과 카탈로그 (내과)
    const catalogItems = [
      { dept: '내과', codeId: allMeds[0].id, codeType: 'MEDICATION_CODE', sub: '고혈압', dosage: '1T', freq: '1일 1회', route: 'PO', dur: 30, guide: '고혈압 1차 약물' },
      { dept: '내과', codeId: allMeds[3].id, codeType: 'MEDICATION_CODE', sub: '소화기', dosage: '1C', freq: '1일 1회', route: 'PO', dur: 28, guide: '위산분비억제제' },
      { dept: '내과', codeId: allMeds[4].id, codeType: 'MEDICATION_CODE', sub: '순환기', dosage: '1T', freq: '1일 1회', route: 'PO', dur: 30, guide: '항혈소판제' },
      { dept: '내과', codeId: allProcs[0].id, codeType: 'PROCEDURE_CODE', sub: '기본검사', guide: '전해질 기본' },
      { dept: '내과', codeId: allProcs[3].id, codeType: 'PROCEDURE_CODE', sub: '기본검사', guide: '흉부 X-ray 기본' },
      { dept: '내과', codeId: allProcs[4].id, codeType: 'PROCEDURE_CODE', sub: '기본검사', guide: '복부 X-ray' },
      { dept: '외과', codeId: allMeds[2].id, codeType: 'MEDICATION_CODE', sub: '진통', dosage: '1T', freq: '필요시', route: 'PO', dur: 5, guide: '수술 후 진통제' },
      { dept: '외과', codeId: allProcs[3].id, codeType: 'PROCEDURE_CODE', sub: '기본검사', guide: '수술 전 CXR' },
    ];

    for (const ci of catalogItems) {
      const existing = await prisma.departmentCodeCatalog.findFirst({ where: { departmentName: ci.dept, codeId: ci.codeId } });
      if (!existing) {
        await prisma.departmentCodeCatalog.create({
          data: {
            departmentName: ci.dept, codeId: ci.codeId, codeType: ci.codeType,
            subcategory: ci.sub ?? null, defaultDosage: ci.dosage ?? null,
            defaultFrequency: ci.freq ?? null, defaultDuration: ci.dur ?? null,
            defaultRoute: ci.route ?? null, guideNote: ci.guide ?? null,
            createdBy: kimDrId,
          },
        });
      }
    }

    // 처방 세트 (김내과)
    const sets = [
      {
        name: '고혈압 기본 세트', desc: '고혈압 환자 초진 처방', cat: '순환기',
        items: [
          { codeId: allMeds[0].id, codeType: 'MEDICATION_CODE', name: allMeds[0].nameKo, dosage: '1T', frequency: '1일 1회', duration: 30, route: 'PO' },
          { codeId: allMeds[4].id, codeType: 'MEDICATION_CODE', name: allMeds[4].nameKo, dosage: '1T', frequency: '1일 1회', duration: 30, route: 'PO' },
          { codeId: allProcs[0].id, codeType: 'PROCEDURE_CODE', name: allProcs[0].nameKo },
          { codeId: allProcs[3].id, codeType: 'PROCEDURE_CODE', name: allProcs[3].nameKo },
        ],
        useCount: 12,
      },
      {
        name: '감기 기본 세트', desc: '상기도감염 경험적 치료', cat: '감염',
        items: [
          { codeId: allMeds[2].id, codeType: 'MEDICATION_CODE', name: allMeds[2].nameKo, dosage: '1T', frequency: '필요시', duration: 5, route: 'PO' },
        ],
        useCount: 25,
      },
    ];

    for (const s of sets) {
      const existing = await prisma.doctorPrescriptionSet.findFirst({ where: { doctorId: kimDrId, name: s.name } });
      if (!existing) {
        await prisma.doctorPrescriptionSet.create({
          data: { doctorId: kimDrId, name: s.name, description: s.desc, category: s.cat, items: s.items as any, useCount: s.useCount },
        });
      }
    }

    // 박내과(parkDrId)에도 코드 + 세트 추가
    const parkCodes = [
      { cat: 'MEDICATION', codeId: allMeds[0].id, codeType: 'MEDICATION_CODE', name: allMeds[0].nameKo, dosage: '1T', freq: '1일 1회', route: 'PO', dur: 30, pinned: true, count: 35 },
      { cat: 'MEDICATION', codeId: allMeds[2].id, codeType: 'MEDICATION_CODE', name: allMeds[2].nameKo, dosage: '1T', freq: '필요시', route: 'PO', dur: 5, pinned: false, count: 20 },
      { cat: 'MEDICATION', codeId: allMeds[4].id, codeType: 'MEDICATION_CODE', name: allMeds[4].nameKo, dosage: '1T', freq: '1일 1회', route: 'PO', dur: 30, pinned: true, count: 30 },
      { cat: 'LAB', codeId: allProcs[0].id, codeType: 'PROCEDURE_CODE', name: allProcs[0].nameKo, pinned: true, count: 40 },
      { cat: 'LAB', codeId: allProcs[1].id, codeType: 'PROCEDURE_CODE', name: allProcs[1].nameKo, pinned: false, count: 18 },
      { cat: 'IMAGING', codeId: allProcs[3].id, codeType: 'PROCEDURE_CODE', name: allProcs[3].nameKo, pinned: true, count: 32 },
      { cat: 'IMAGING', codeId: allProcs[4].id, codeType: 'PROCEDURE_CODE', name: allProcs[4].nameKo, pinned: false, count: 15 },
    ];
    for (const mc of parkCodes) {
      const existing = await prisma.doctorCodeList.findFirst({ where: { doctorId: parkDrId, codeId: mc.codeId } });
      if (!existing) {
        await prisma.doctorCodeList.create({
          data: {
            doctorId: parkDrId, category: mc.cat, codeId: mc.codeId, codeType: mc.codeType,
            displayName: mc.name, defaultDosage: mc.dosage ?? null, defaultFrequency: mc.freq ?? null,
            defaultDuration: mc.dur ?? null, defaultRoute: mc.route ?? null,
            isPinned: mc.pinned, useCount: mc.count,
          },
        });
      }
    }
    // 박내과 처방 세트
    const parkSets = [
      {
        name: '호흡기 감염 세트', desc: '상기도감염 + 폐렴 경험적', cat: '호흡기',
        items: [
          { codeId: allMeds[2].id, codeType: 'MEDICATION_CODE', name: allMeds[2].nameKo, dosage: '1T', frequency: '1일 3회', duration: 5, route: 'PO' },
          { codeId: allProcs[3].id, codeType: 'PROCEDURE_CODE', name: allProcs[3].nameKo },
          { codeId: allProcs[0].id, codeType: 'PROCEDURE_CODE', name: allProcs[0].nameKo },
        ],
        useCount: 18,
      },
    ];
    for (const s of parkSets) {
      const existing = await prisma.doctorPrescriptionSet.findFirst({ where: { doctorId: parkDrId, name: s.name } });
      if (!existing) {
        await prisma.doctorPrescriptionSet.create({
          data: { doctorId: parkDrId, name: s.name, description: s.desc, category: s.cat, items: s.items as any, useCount: s.useCount },
        });
      }
    }

    console.log(`     → 김내과: 코드 ${myCodes.length}건 + 세트 ${sets.length}건, 박내과: 코드 ${parkCodes.length}건 + 세트 ${parkSets.length}건, 과 카탈로그 ${catalogItems.length}건`);
  }

  // ============================================================
  // 건강검진 프로그램 (Checkup Programs)
  // ============================================================
  console.log('  [CHECKUP] Test Catalog (Master)...');

  const testCatalog = [
    // ── PHYSICAL ──
    { code: 'HEIGHT', name: '신장', category: 'PHYSICAL', subCategory: '신체계측', unit: 'cm', sortOrder: 1 },
    { code: 'WEIGHT', name: '체중', category: 'PHYSICAL', subCategory: '신체계측', unit: 'kg', sortOrder: 2 },
    { code: 'WAIST', name: '허리둘레', category: 'PHYSICAL', subCategory: '신체계측', unit: 'cm', referenceRange: '남 <90, 여 <85', sortOrder: 3 },
    { code: 'BMI', name: '체질량지수', category: 'PHYSICAL', subCategory: '신체계측', unit: 'kg/m²', referenceRange: '18.5~24.9', sortOrder: 4 },
    { code: 'BP', name: '혈압', category: 'PHYSICAL', subCategory: '신체계측', unit: 'mmHg', referenceRange: '120/80 미만', sortOrder: 5 },
    { code: 'VISION', name: '시력', category: 'PHYSICAL', subCategory: '신체계측', sortOrder: 6 },
    { code: 'HEARING', name: '청력', category: 'PHYSICAL', subCategory: '신체계측', unit: 'dB', sortOrder: 7 },
    { code: 'BODY_COMP', name: '체성분분석', category: 'PHYSICAL', subCategory: '체성분', sortOrder: 10 },
    { code: 'STRESS', name: '스트레스검사', category: 'PHYSICAL', subCategory: '자율신경', sortOrder: 11 },
    { code: 'META_AGE', name: '대사나이', category: 'PHYSICAL', subCategory: '체성분', sortOrder: 12 },
    // ── LAB (혈액) ──
    { code: 'CBC_18', name: '일반혈액검사 (18항목)', category: 'LAB', subCategory: '혈액', referenceRange: 'WBC 4~10, Hb 12~17', sortOrder: 20 },
    { code: 'LFT', name: '간기능검사', category: 'LAB', subCategory: '혈액', unit: 'U/L', referenceRange: 'AST <40, ALT <40', sortOrder: 21 },
    { code: 'FBS', name: '공복혈당', category: 'LAB', subCategory: '혈액', unit: 'mg/dL', referenceRange: '70~100', sortOrder: 22 },
    { code: 'HbA1c', name: '당화혈색소', category: 'LAB', subCategory: '혈액', unit: '%', referenceRange: '<5.7', sortOrder: 23 },
    { code: 'LIPID', name: '지질검사 (TC/TG/HDL/LDL)', category: 'LAB', subCategory: '혈액', sortOrder: 24 },
    { code: 'BUN_CR', name: '신장기능 (BUN/Cr)', category: 'LAB', subCategory: '혈액', sortOrder: 25 },
    { code: 'FIB4', name: '간섬유화지수 (FIB-4)', category: 'LAB', subCategory: '혈액', referenceRange: '<1.3', sortOrder: 26 },
    { code: 'URIC', name: '요산', category: 'LAB', subCategory: '혈액', unit: 'mg/dL', referenceRange: '남 3.5~7.2, 여 2.6~6.0', sortOrder: 27 },
    { code: 'hsCRP', name: '고감도 CRP', category: 'LAB', subCategory: '혈액', unit: 'mg/L', referenceRange: '<1.0', sortOrder: 28 },
    { code: 'HCV', name: 'C형간염항체', category: 'LAB', subCategory: '혈액', sortOrder: 29 },
    { code: 'AFP', name: '간암표지자 (AFP)', category: 'LAB', subCategory: '종양표지자', unit: 'ng/mL', referenceRange: '<10', sortOrder: 30 },
    { code: 'CA199', name: '췌장암표지자 (CA19-9)', category: 'LAB', subCategory: '종양표지자', unit: 'U/mL', referenceRange: '<37', sortOrder: 31 },
    { code: 'PSA_M', name: '전립선표지자 (PSA) 남', category: 'LAB', subCategory: '종양표지자', unit: 'ng/mL', referenceRange: '<4.0', sortOrder: 32 },
    { code: 'PSA', name: '전립선표지자 (PSA)', category: 'LAB', subCategory: '종양표지자', unit: 'ng/mL', referenceRange: '<4.0', sortOrder: 33 },
    { code: 'THYROID', name: '갑상선기능 (TSH/fT4)', category: 'LAB', subCategory: '혈액', sortOrder: 34 },
    { code: 'BNP', name: 'BNP (심부전표지자)', category: 'LAB', subCategory: '혈액', unit: 'pg/mL', referenceRange: '<100', sortOrder: 35 },
    { code: 'HOMOCYS', name: '호모시스테인', category: 'LAB', subCategory: '혈액', unit: 'μmol/L', referenceRange: '5~15', sortOrder: 36 },
    { code: 'HAV_AB', name: 'A형간염항체', category: 'LAB', subCategory: '혈액', sortOrder: 37 },
    { code: 'HBsAg', name: 'B형간염항원', category: 'LAB', subCategory: '혈액', sortOrder: 38 },
    { code: 'HBsAb', name: 'B형간염항체', category: 'LAB', subCategory: '혈액', sortOrder: 39 },
    { code: 'CEA', name: '대장암표지자 (CEA)', category: 'LAB', subCategory: '종양표지자', unit: 'ng/mL', referenceRange: '<5.0', sortOrder: 40 },
    { code: 'CA125_F', name: '난소암표지자 (CA-125) 여', category: 'LAB', subCategory: '종양표지자', unit: 'U/mL', referenceRange: '<35', sortOrder: 41 },
    { code: 'NGS_CANCER', name: 'NGS 암유전자패널', category: 'LAB', subCategory: '유전자', defaultPrice: 500000, sortOrder: 42 },
    { code: 'VIT_D', name: '비타민D', category: 'LAB', subCategory: '혈액', unit: 'ng/mL', referenceRange: '30~100', defaultPrice: 30000, sortOrder: 43 },
    { code: 'HPV', name: 'HPV 검사', category: 'LAB', subCategory: '세포', defaultPrice: 50000, sortOrder: 44 },
    // ── LAB (소변/대변) ──
    { code: 'UA_17', name: '소변검사 (17항목)', category: 'LAB', subCategory: '소변', sortOrder: 50 },
    { code: 'UA_BASIC', name: '소변검사 (기본)', category: 'LAB', subCategory: '소변', sortOrder: 51 },
    { code: 'FOBT', name: '분변잠혈검사', category: 'LAB', subCategory: '대변', sortOrder: 52 },
    { code: 'PARASITE', name: '기생충검사', category: 'LAB', subCategory: '대변', sortOrder: 53 },
    // ── IMAGING ──
    { code: 'CHEST_PA', name: '흉부 X-ray', category: 'IMAGING', subCategory: 'X-ray', interpretDept: '영상의학과', sortOrder: 60 },
    { code: 'ABD_US', name: '상복부 초음파', category: 'IMAGING', subCategory: '초음파', interpretDept: '영상의학과', duration: 15, sortOrder: 61 },
    { code: 'THYROID_US', name: '갑상선 초음파', category: 'IMAGING', subCategory: '초음파', interpretDept: '영상의학과', duration: 10, sortOrder: 62 },
    { code: 'MAMMOGRAPHY', name: '유방촬영', category: 'IMAGING', subCategory: 'X-ray', interpretDept: '영상의학과', sortOrder: 63 },
    { code: 'BREAST_US', name: '유방초음파', category: 'IMAGING', subCategory: '초음파', interpretDept: '영상의학과', duration: 15, sortOrder: 64 },
    { code: 'CAROTID_US', name: '경동맥초음파', category: 'IMAGING', subCategory: '초음파', interpretDept: '영상의학과', duration: 15, sortOrder: 65 },
    { code: 'BRAIN_MRI', name: '뇌 MRI', category: 'IMAGING', subCategory: 'MRI', interpretDept: '신경과', defaultPrice: 250000, duration: 30, sortOrder: 66 },
    { code: 'BRAIN_MRA', name: '뇌 MRA', category: 'IMAGING', subCategory: 'MRI', interpretDept: '신경과', defaultPrice: 200000, duration: 20, sortOrder: 67 },
    { code: 'CARDIAC_CT', name: '심장 CT', category: 'IMAGING', subCategory: 'CT', interpretDept: '영상의학과', defaultPrice: 200000, duration: 15, sortOrder: 68 },
    { code: 'LDCT', name: '저선량 흉부 CT', category: 'IMAGING', subCategory: 'CT', interpretDept: '영상의학과', defaultPrice: 100000, duration: 10, sortOrder: 69 },
    { code: 'PET_CT', name: 'PET-CT (전신)', category: 'IMAGING', subCategory: 'PET', interpretDept: '핵의학과', defaultPrice: 800000, duration: 60, sortOrder: 70 },
    { code: 'SPINE_MRI', name: '척추 MRI', category: 'IMAGING', subCategory: 'MRI', interpretDept: '영상의학과', defaultPrice: 300000, duration: 30, sortOrder: 71 },
    // ── DIAGNOSTIC ──
    { code: 'EKG', name: '심전도', category: 'DIAGNOSTIC', subCategory: '심장', duration: 5, sortOrder: 80 },
    { code: 'ECHO', name: '심장초음파', category: 'DIAGNOSTIC', subCategory: '심장', interpretDept: '순환기내과', duration: 20, sortOrder: 81 },
    { code: 'UGI_OR_EGD', name: '위장검사 (위내시경/UGI)', category: 'DIAGNOSTIC', subCategory: '소화기', interpretDept: '소화기내과', duration: 15, sortOrder: 82 },
    { code: 'COLONOSCOPY', name: '대장내시경', category: 'DIAGNOSTIC', subCategory: '소화기', interpretDept: '소화기내과', defaultPrice: 80000, duration: 30, sortOrder: 83 },
    { code: 'SLEEP_EGD', name: '수면 위내시경', category: 'DIAGNOSTIC', subCategory: '소화기', interpretDept: '소화기내과', defaultPrice: 50000, duration: 20, sortOrder: 84 },
    { code: 'PAP_SMEAR', name: '자궁경부세포검사', category: 'DIAGNOSTIC', subCategory: '산부인과', interpretDept: '산부인과', sortOrder: 85 },
    { code: 'BMD', name: '골밀도검사 (DEXA)', category: 'DIAGNOSTIC', subCategory: '근골격', interpretDept: '정형외과', defaultPrice: 50000, duration: 10, sortOrder: 86 },
    { code: 'IOP', name: '안압검사', category: 'DIAGNOSTIC', subCategory: '안과', interpretDept: '안과', sortOrder: 87 },
    { code: 'FUNDUS', name: '안저검사', category: 'DIAGNOSTIC', subCategory: '안과', interpretDept: '안과', sortOrder: 88 },
    { code: 'ABI', name: '사지혈압비 (ABI)', category: 'DIAGNOSTIC', subCategory: '혈관', referenceRange: '0.9~1.3', sortOrder: 89 },
    { code: 'PWV', name: '맥파전파속도 (PWV)', category: 'DIAGNOSTIC', subCategory: '혈관', unit: 'cm/s', sortOrder: 90 },
    { code: 'PFT', name: '호흡기능검사 (폐활량)', category: 'DIAGNOSTIC', subCategory: '호흡기', interpretDept: '호흡기내과', duration: 10, sortOrder: 91 },
    { code: 'GASTROSCOPY', name: '위내시경', category: 'DIAGNOSTIC', subCategory: '소화기', interpretDept: '소화기내과', duration: 15, sortOrder: 92 },
    // ── CONSULT / AI ──
    { code: 'CONSULT', name: '결과상담', category: 'CONSULT', subCategory: '상담', duration: 15, sortOrder: 100 },
    { code: 'AI_HEALTH', name: 'AI 건강평가', category: 'AI', subCategory: 'AI', duration: 1, sortOrder: 110 },
  ];

  for (const item of testCatalog) {
    await prisma.checkupTestMaster.upsert({
      where: { code: item.code },
      update: { name: item.name, category: item.category, subCategory: item.subCategory, sortOrder: item.sortOrder },
      create: {
        code: item.code,
        name: item.name,
        category: item.category,
        subCategory: item.subCategory ?? null,
        interpretDept: (item as any).interpretDept ?? null,
        unit: (item as any).unit ?? null,
        referenceRange: (item as any).referenceRange ?? null,
        defaultPrice: (item as any).defaultPrice ?? 0,
        duration: (item as any).duration ?? 5,
        sortOrder: item.sortOrder ?? 0,
        isActive: true,
      },
    });
  }
  console.log(`    → ${testCatalog.length}개 검사항목 마스터 생성`);

  // ============================================================
  console.log('  [CHECKUP] Checkup Programs...');

  const checkupPrograms = [
    {
      i: 1, code: 'CK-BASIC', name: '기본 종합검진', category: 'BASIC',
      gender: 'ALL', price: 380000, duration: 120,
      description: '기본 종합건강검진 — 기초검사+혈액+소변+대변+영상+심전도+위장+초음파',
      items: [
        { seq: 1, category: 'PHYSICAL', name: '신체계측', codes: ['HEIGHT','WEIGHT','WAIST','BMI','BP','VISION','HEARING'] },
        { seq: 2, category: 'PHYSICAL', name: '체성분/스트레스', codes: ['BODY_COMP','STRESS','META_AGE'] },
        { seq: 3, category: 'DIAGNOSTIC', name: '심전도', codes: ['EKG'] },
        { seq: 4, category: 'LAB', name: '소변검사 (17항목)', codes: ['UA_17'] },
        { seq: 5, category: 'LAB', name: '대변검사', codes: ['FOBT','PARASITE'] },
        { seq: 6, category: 'LAB', name: '혈액검사 (종합)', codes: ['CBC_18','LFT','FBS','HbA1c','LIPID','BUN_CR','FIB4','URIC','hsCRP','HCV','AFP','CA199','PSA_M','THYROID'] },
        { seq: 7, category: 'IMAGING', name: '흉부 X-ray', codes: ['CHEST_PA'], interpretDept: '영상의학과' },
        { seq: 8, category: 'DIAGNOSTIC', name: '위장검사', codes: ['UGI_OR_EGD'], interpretDept: '소화기내과' },
        { seq: 9, category: 'IMAGING', name: '상복부 초음파', codes: ['ABD_US'], interpretDept: '영상의학과' },
        { seq: 10, category: 'IMAGING', name: '갑상선 초음파', codes: ['THYROID_US'], interpretDept: '영상의학과' },
        { seq: 11, category: 'DIAGNOSTIC', name: '자궁경부세포검사 (여)', codes: ['PAP_SMEAR'], interpretDept: '산부인과' },
        { seq: 12, category: 'IMAGING', name: '유방촬영 (여)', codes: ['MAMMOGRAPHY'], interpretDept: '영상의학과' },
        { seq: 13, category: 'CONSULT', name: '결과상담', codes: ['CONSULT'] },
      ],
      options: [
        { id: 'opt-colon', name: '대장내시경', price: 80000, category: 'DIAGNOSTIC', codes: ['COLONOSCOPY'] },
        { id: 'opt-sleep-egd', name: '수면 위내시경', price: 50000, category: 'DIAGNOSTIC', codes: ['SLEEP_EGD'] },
        { id: 'opt-brain-mri', name: '뇌 MRI+MRA', price: 350000, category: 'IMAGING', codes: ['BRAIN_MRI','BRAIN_MRA'] },
        { id: 'opt-cardiac-ct', name: '심장 CT', price: 200000, category: 'IMAGING', codes: ['CARDIAC_CT'] },
        { id: 'opt-ldct', name: '저선량 흉부 CT', price: 100000, category: 'IMAGING', codes: ['LDCT'] },
        { id: 'opt-bmd', name: '골밀도검사', price: 50000, category: 'DIAGNOSTIC', codes: ['BMD'] },
        { id: 'opt-vitd', name: '비타민D', price: 30000, category: 'LAB', codes: ['VIT_D'] },
        { id: 'opt-hpv', name: 'HPV 검사 (여)', price: 50000, category: 'LAB', codes: ['HPV'] },
      ],
    },
    {
      i: 2, code: 'CK-PLUS', name: '플러스 종합검진', category: 'PLUS',
      gender: 'ALL', price: 550000, duration: 150,
      description: '기본 + AI건강평가 + 안과 + 동맥경화 + 호흡기능',
      items: [
        { seq: 1, category: 'PHYSICAL', name: '신체계측', codes: ['HEIGHT','WEIGHT','WAIST','BMI','BP','VISION','HEARING'] },
        { seq: 2, category: 'PHYSICAL', name: '체성분/스트레스', codes: ['BODY_COMP','STRESS','META_AGE'] },
        { seq: 3, category: 'DIAGNOSTIC', name: '심전도', codes: ['EKG'] },
        { seq: 4, category: 'LAB', name: '소변검사 (17항목)', codes: ['UA_17'] },
        { seq: 5, category: 'LAB', name: '대변검사', codes: ['FOBT','PARASITE'] },
        { seq: 6, category: 'LAB', name: '혈액검사 (종합)', codes: ['CBC_18','LFT','FBS','HbA1c','LIPID','BUN_CR','FIB4','URIC','hsCRP','HCV','AFP','CA199','PSA_M','THYROID'] },
        { seq: 7, category: 'IMAGING', name: '흉부 X-ray', codes: ['CHEST_PA'], interpretDept: '영상의학과' },
        { seq: 8, category: 'DIAGNOSTIC', name: '위장검사', codes: ['UGI_OR_EGD'], interpretDept: '소화기내과' },
        { seq: 9, category: 'IMAGING', name: '상복부 초음파', codes: ['ABD_US'], interpretDept: '영상의학과' },
        { seq: 10, category: 'IMAGING', name: '갑상선 초음파', codes: ['THYROID_US'], interpretDept: '영상의학과' },
        { seq: 11, category: 'AI', name: 'AI 건강평가', codes: ['AI_HEALTH'] },
        { seq: 12, category: 'DIAGNOSTIC', name: '안과검사', codes: ['IOP','FUNDUS'], interpretDept: '안과' },
        { seq: 13, category: 'DIAGNOSTIC', name: '동맥경화검사', codes: ['ABI','PWV'] },
        { seq: 14, category: 'DIAGNOSTIC', name: '호흡기능검사', codes: ['PFT'], interpretDept: '호흡기내과' },
        { seq: 15, category: 'CONSULT', name: '결과상담', codes: ['CONSULT'] },
      ],
      options: [
        { id: 'opt-colon', name: '대장내시경', price: 80000, category: 'DIAGNOSTIC', codes: ['COLONOSCOPY'] },
        { id: 'opt-sleep-egd', name: '수면 위내시경', price: 50000, category: 'DIAGNOSTIC', codes: ['SLEEP_EGD'] },
        { id: 'opt-brain-mri', name: '뇌 MRI+MRA', price: 350000, category: 'IMAGING', codes: ['BRAIN_MRI','BRAIN_MRA'] },
        { id: 'opt-bmd', name: '골밀도검사', price: 50000, category: 'DIAGNOSTIC', codes: ['BMD'] },
      ],
    },
    {
      i: 3, code: 'CK-PRECISION', name: '정밀 종합검진', category: 'PRECISION',
      gender: 'ALL', price: 780000, duration: 180,
      description: '플러스 + 심혈관 + A/B형간염 + 추가 종양표지자',
      items: [
        { seq: 1, category: 'PHYSICAL', name: '신체계측', codes: ['HEIGHT','WEIGHT','WAIST','BMI','BP','VISION','HEARING'] },
        { seq: 2, category: 'LAB', name: '혈액검사 (정밀)', codes: ['CBC_18','LFT','FBS','HbA1c','LIPID','BUN_CR','FIB4','URIC','hsCRP','HCV','AFP','CA199','PSA_M','THYROID','BNP','HOMOCYS','HAV_AB','HBsAg','HBsAb','CEA','CA125_F'] },
        { seq: 3, category: 'DIAGNOSTIC', name: '심전도', codes: ['EKG'] },
        { seq: 4, category: 'LAB', name: '소변검사', codes: ['UA_17'] },
        { seq: 5, category: 'LAB', name: '대변검사', codes: ['FOBT','PARASITE'] },
        { seq: 6, category: 'IMAGING', name: '흉부 X-ray', codes: ['CHEST_PA'], interpretDept: '영상의학과' },
        { seq: 7, category: 'DIAGNOSTIC', name: '위장검사', codes: ['UGI_OR_EGD'], interpretDept: '소화기내과' },
        { seq: 8, category: 'IMAGING', name: '상복부 초음파', codes: ['ABD_US'], interpretDept: '영상의학과' },
        { seq: 9, category: 'IMAGING', name: '갑상선 초음파', codes: ['THYROID_US'], interpretDept: '영상의학과' },
        { seq: 10, category: 'AI', name: 'AI 건강평가', codes: ['AI_HEALTH'] },
        { seq: 11, category: 'DIAGNOSTIC', name: '안과검사', codes: ['IOP','FUNDUS'], interpretDept: '안과' },
        { seq: 12, category: 'DIAGNOSTIC', name: '동맥경화검사', codes: ['ABI','PWV'] },
        { seq: 13, category: 'DIAGNOSTIC', name: '호흡기능검사', codes: ['PFT'], interpretDept: '호흡기내과' },
        { seq: 14, category: 'CONSULT', name: '결과상담', codes: ['CONSULT'] },
      ],
      options: [
        { id: 'opt-colon', name: '대장내시경', price: 80000, category: 'DIAGNOSTIC', codes: ['COLONOSCOPY'] },
        { id: 'opt-brain-mri', name: '뇌 MRI+MRA', price: 350000, category: 'IMAGING', codes: ['BRAIN_MRI','BRAIN_MRA'] },
      ],
    },
    {
      i: 4, code: 'CK-PREMIUM', name: '프리미엄 종합검진', category: 'PREMIUM',
      gender: 'ALL', price: 1200000, duration: 240,
      description: '정밀 + NGS암유전패널 + 심장초음파 + 경동맥초음파 + CT/MRI 선택',
      items: [
        { seq: 1, category: 'PHYSICAL', name: '신체계측', codes: ['HEIGHT','WEIGHT','WAIST','BMI','BP','VISION','HEARING'] },
        { seq: 2, category: 'LAB', name: '혈액검사 (프리미엄)', codes: ['CBC_18','LFT','FBS','HbA1c','LIPID','BUN_CR','FIB4','URIC','hsCRP','HCV','AFP','CA199','PSA_M','THYROID','BNP','HOMOCYS','HAV_AB','HBsAg','HBsAb','CEA','CA125_F','NGS_CANCER'] },
        { seq: 3, category: 'DIAGNOSTIC', name: '심전도', codes: ['EKG'] },
        { seq: 4, category: 'DIAGNOSTIC', name: '심장초음파', codes: ['ECHO'], interpretDept: '순환기내과' },
        { seq: 5, category: 'IMAGING', name: '경동맥초음파', codes: ['CAROTID_US'], interpretDept: '영상의학과' },
        { seq: 6, category: 'IMAGING', name: '흉부 X-ray', codes: ['CHEST_PA'], interpretDept: '영상의학과' },
        { seq: 7, category: 'DIAGNOSTIC', name: '위장검사', codes: ['UGI_OR_EGD'], interpretDept: '소화기내과' },
        { seq: 8, category: 'IMAGING', name: '상복부 초음파', codes: ['ABD_US'], interpretDept: '영상의학과' },
        { seq: 9, category: 'IMAGING', name: '뇌 MRI+MRA', codes: ['BRAIN_MRI','BRAIN_MRA'], interpretDept: '신경과' },
        { seq: 10, category: 'AI', name: 'AI 건강평가', codes: ['AI_HEALTH'] },
        { seq: 11, category: 'DIAGNOSTIC', name: '안과검사', codes: ['IOP','FUNDUS'], interpretDept: '안과' },
        { seq: 12, category: 'DIAGNOSTIC', name: '동맥경화검사', codes: ['ABI','PWV'] },
        { seq: 13, category: 'DIAGNOSTIC', name: '호흡기능검사', codes: ['PFT'], interpretDept: '호흡기내과' },
        { seq: 14, category: 'CONSULT', name: '결과상담', codes: ['CONSULT'] },
      ],
      options: [
        { id: 'opt-colon', name: '대장내시경', price: 80000, category: 'DIAGNOSTIC', codes: ['COLONOSCOPY'] },
        { id: 'opt-pet', name: 'PET-CT (전신)', price: 800000, category: 'IMAGING', codes: ['PET_CT'] },
        { id: 'opt-spine-mri', name: '척추 MRI', price: 300000, category: 'IMAGING', codes: ['SPINE_MRI'] },
      ],
    },
    {
      i: 5, code: 'CK-PET', name: 'PET-CT 정밀종합', category: 'PET_PRECISION',
      gender: 'ALL', price: 1800000, duration: 300,
      description: '프리미엄 + PET-CT 전신 — 최고급 건강검진',
      items: [
        { seq: 1, category: 'PHYSICAL', name: '신체계측', codes: ['HEIGHT','WEIGHT','WAIST','BMI','BP','VISION','HEARING'] },
        { seq: 2, category: 'LAB', name: '혈액검사 (프리미엄)', codes: ['CBC_18','LFT','FBS','HbA1c','LIPID','BUN_CR','FIB4','URIC','hsCRP','HCV','AFP','CA199','PSA_M','THYROID','BNP','HOMOCYS','HAV_AB','HBsAg','HBsAb','CEA','CA125_F','NGS_CANCER'] },
        { seq: 3, category: 'DIAGNOSTIC', name: '심전도 + 심장초음파', codes: ['EKG','ECHO'], interpretDept: '순환기내과' },
        { seq: 4, category: 'IMAGING', name: 'PET-CT (전신)', codes: ['PET_CT'], interpretDept: '핵의학과' },
        { seq: 5, category: 'IMAGING', name: '뇌 MRI+MRA', codes: ['BRAIN_MRI','BRAIN_MRA'], interpretDept: '신경과' },
        { seq: 6, category: 'IMAGING', name: '경동맥초음파', codes: ['CAROTID_US'], interpretDept: '영상의학과' },
        { seq: 7, category: 'DIAGNOSTIC', name: '위장검사', codes: ['UGI_OR_EGD'], interpretDept: '소화기내과' },
        { seq: 8, category: 'IMAGING', name: '상복부 초음파', codes: ['ABD_US'], interpretDept: '영상의학과' },
        { seq: 9, category: 'CONSULT', name: '결과상담', codes: ['CONSULT'] },
      ],
      options: [
        { id: 'opt-colon', name: '대장내시경', price: 80000, category: 'DIAGNOSTIC', codes: ['COLONOSCOPY'] },
        { id: 'opt-spine-mri', name: '척추 MRI', price: 300000, category: 'IMAGING', codes: ['SPINE_MRI'] },
      ],
    },
    {
      i: 6, code: 'CK-FEMALE', name: '여성 특화 종합검진', category: 'SPECIAL',
      gender: 'FEMALE', price: 520000, duration: 150,
      description: '기본 + 유방촬영 + 자궁경부세포 + 골밀도 + 유방초음파',
      items: [
        { seq: 1, category: 'PHYSICAL', name: '신체계측', codes: ['HEIGHT','WEIGHT','WAIST','BMI','BP','VISION','HEARING'] },
        { seq: 2, category: 'LAB', name: '혈액검사 (종합)', codes: ['CBC_18','LFT','FBS','HbA1c','LIPID','BUN_CR','THYROID','hsCRP','HCV','AFP','CA125_F'] },
        { seq: 3, category: 'DIAGNOSTIC', name: '심전도', codes: ['EKG'] },
        { seq: 4, category: 'LAB', name: '소변검사', codes: ['UA_17'] },
        { seq: 5, category: 'IMAGING', name: '흉부 X-ray', codes: ['CHEST_PA'], interpretDept: '영상의학과' },
        { seq: 6, category: 'DIAGNOSTIC', name: '위장검사', codes: ['UGI_OR_EGD'], interpretDept: '소화기내과' },
        { seq: 7, category: 'IMAGING', name: '상복부 초음파', codes: ['ABD_US'], interpretDept: '영상의학과' },
        { seq: 8, category: 'IMAGING', name: '유방촬영', codes: ['MAMMOGRAPHY'], interpretDept: '영상의학과' },
        { seq: 9, category: 'IMAGING', name: '유방초음파', codes: ['BREAST_US'], interpretDept: '영상의학과' },
        { seq: 10, category: 'DIAGNOSTIC', name: '자궁경부세포검사', codes: ['PAP_SMEAR'], interpretDept: '산부인과' },
        { seq: 11, category: 'DIAGNOSTIC', name: '골밀도검사', codes: ['BMD'], interpretDept: '정형외과' },
        { seq: 12, category: 'CONSULT', name: '결과상담', codes: ['CONSULT'] },
      ],
      options: [
        { id: 'opt-hpv', name: 'HPV 검사', price: 50000, category: 'LAB', codes: ['HPV'] },
        { id: 'opt-colon', name: '대장내시경', price: 80000, category: 'DIAGNOSTIC', codes: ['COLONOSCOPY'] },
      ],
    },
    {
      i: 7, code: 'CK-MALE40', name: '40대+ 남성 종합검진', category: 'SPECIAL',
      gender: 'MALE', price: 580000, duration: 150, ageMin: 40,
      description: '기본 + PSA + 전립선초음파 + 심장CT',
      items: [
        { seq: 1, category: 'PHYSICAL', name: '신체계측', codes: ['HEIGHT','WEIGHT','WAIST','BMI','BP','VISION','HEARING'] },
        { seq: 2, category: 'LAB', name: '혈액검사 (남성 특화)', codes: ['CBC_18','LFT','FBS','HbA1c','LIPID','BUN_CR','THYROID','hsCRP','HCV','AFP','CA199','PSA'] },
        { seq: 3, category: 'DIAGNOSTIC', name: '심전도', codes: ['EKG'] },
        { seq: 4, category: 'LAB', name: '소변검사', codes: ['UA_17'] },
        { seq: 5, category: 'IMAGING', name: '흉부 X-ray', codes: ['CHEST_PA'], interpretDept: '영상의학과' },
        { seq: 6, category: 'DIAGNOSTIC', name: '위장검사', codes: ['UGI_OR_EGD'], interpretDept: '소화기내과' },
        { seq: 7, category: 'IMAGING', name: '상복부 초음파', codes: ['ABD_US'], interpretDept: '영상의학과' },
        { seq: 8, category: 'IMAGING', name: '전립선초음파', codes: ['PROSTATE_US'], interpretDept: '비뇨의학과' },
        { seq: 9, category: 'IMAGING', name: '심장 CT', codes: ['CARDIAC_CT'], interpretDept: '순환기내과' },
        { seq: 10, category: 'CONSULT', name: '결과상담', codes: ['CONSULT'] },
      ],
      options: [
        { id: 'opt-colon', name: '대장내시경', price: 80000, category: 'DIAGNOSTIC', codes: ['COLONOSCOPY'] },
        { id: 'opt-ldct', name: '저선량 흉부 CT', price: 100000, category: 'IMAGING', codes: ['LDCT'] },
      ],
    },
  ];

  for (const prog of checkupPrograms) {
    const progId = uid(P.CKPROG, prog.i);
    const existing = await prisma.checkupProgram.findUnique({ where: { code: prog.code } });
    if (!existing) {
      await prisma.checkupProgram.create({
        data: {
          id: progId,
          code: prog.code,
          name: prog.name,
          category: prog.category,
          description: prog.description,
          gender: prog.gender,
          ageMin: (prog as any).ageMin ?? null,
          ageMax: (prog as any).ageMax ?? null,
          price: prog.price,
          discountRate: 0,
          duration: prog.duration,
          items: prog.items,
          options: prog.options,
          isActive: true,
        },
      });
    }
  }
  // 국가건강검진 프로그램
  const nhiPrograms = [
    {
      i: 10, code: 'CK-NHI-GENERAL', name: '국가 일반건강검진', category: 'SPECIAL',
      gender: 'ALL', price: 0, duration: 60,
      description: '국민건강보험공단 일반건강검진 — 2년 1회, 공단 부담',
      items: [
        { seq: 1, category: 'PHYSICAL', name: '신체계측', codes: ['HEIGHT','WEIGHT','WAIST','BMI','BP','VISION','HEARING'] },
        { seq: 2, category: 'LAB', name: '혈액검사', codes: ['CBC','FBS','HbA1c','LIPID','AST','ALT','GGT','CR'] },
        { seq: 3, category: 'LAB', name: '소변검사', codes: ['UA_BASIC'] },
        { seq: 4, category: 'IMAGING', name: '흉부 X-ray', codes: ['CHEST_PA'], interpretDept: '영상의학과' },
        { seq: 5, category: 'CONSULT', name: '결과상담', codes: ['CONSULT'] },
      ],
      options: [],
    },
    {
      i: 11, code: 'CK-NHI-STOMACH', name: '국가 위암검진', category: 'SPECIAL',
      gender: 'ALL', price: 0, duration: 30, ageMin: 40,
      description: '국가암검진 — 위암 (40세+, 2년 1회)',
      items: [
        { seq: 1, category: 'DIAGNOSTIC', name: '위내시경', codes: ['EGD'], interpretDept: '소화기내과' },
      ],
      options: [],
    },
    {
      i: 12, code: 'CK-NHI-COLON', name: '국가 대장암검진', category: 'SPECIAL',
      gender: 'ALL', price: 0, duration: 10, ageMin: 50,
      description: '국가암검진 — 대장암 (50세+, 1년 1회 분변잠혈)',
      items: [
        { seq: 1, category: 'LAB', name: '분변잠혈검사', codes: ['FOBT'] },
      ],
      options: [
        { id: 'opt-colon-confirm', name: '대장내시경 (확진)', price: 0, category: 'DIAGNOSTIC', codes: ['COLONOSCOPY'] },
      ],
    },
    {
      i: 13, code: 'CK-NHI-BREAST', name: '국가 유방암검진', category: 'SPECIAL',
      gender: 'FEMALE', price: 0, duration: 20, ageMin: 40,
      description: '국가암검진 — 유방암 (40세+ 여성, 2년 1회)',
      items: [
        { seq: 1, category: 'IMAGING', name: '유방촬영', codes: ['MAMMOGRAPHY'], interpretDept: '영상의학과' },
      ],
      options: [],
    },
    {
      i: 14, code: 'CK-NHI-CERVIX', name: '국가 자궁경부암검진', category: 'SPECIAL',
      gender: 'FEMALE', price: 0, duration: 15, ageMin: 20,
      description: '국가암검진 — 자궁경부암 (20세+ 여성, 2년 1회)',
      items: [
        { seq: 1, category: 'DIAGNOSTIC', name: '자궁경부세포검사', codes: ['PAP_SMEAR'], interpretDept: '산부인과' },
      ],
      options: [],
    },
    {
      i: 15, code: 'CK-NHI-LIVER', name: '국가 간암검진', category: 'SPECIAL',
      gender: 'ALL', price: 0, duration: 30,
      description: '국가암검진 — 간암 (고위험군, 6개월 1회)',
      items: [
        { seq: 1, category: 'IMAGING', name: '복부초음파', codes: ['ABD_US'], interpretDept: '영상의학과' },
        { seq: 2, category: 'LAB', name: 'AFP', codes: ['AFP'] },
      ],
      options: [],
    },
    {
      i: 16, code: 'CK-NHI-LUNG', name: '국가 폐암검진', category: 'SPECIAL',
      gender: 'ALL', price: 0, duration: 20, ageMin: 54,
      description: '국가암검진 — 폐암 (54~74세 흡연력 30갑년+, 2년 1회)',
      items: [
        { seq: 1, category: 'IMAGING', name: '저선량 흉부 CT', codes: ['LDCT'], interpretDept: '영상의학과' },
      ],
      options: [],
    },
  ];

  for (const prog of nhiPrograms) {
    const progId = uid(P.CKPROG, prog.i);
    const existing = await prisma.checkupProgram.findUnique({ where: { code: prog.code } });
    if (!existing) {
      await prisma.checkupProgram.create({
        data: {
          id: progId,
          code: prog.code,
          name: prog.name,
          category: prog.category,
          description: prog.description,
          gender: prog.gender,
          ageMin: (prog as any).ageMin ?? null,
          ageMax: (prog as any).ageMax ?? null,
          price: prog.price,
          discountRate: 0,
          duration: prog.duration,
          items: prog.items,
          options: prog.options,
          isActive: true,
        },
      });
    }
  }

  console.log(`   - Checkup programs: ${checkupPrograms.length + nhiPrograms.length} (종합 ${checkupPrograms.length} + 국가검진 ${nhiPrograms.length})`);

  // ── 검진 예약 테스트 데이터 ──
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const patientIds = await prisma.patient.findMany({ select: { id: true }, take: 8 });
  const ckBasic = await prisma.checkupProgram.findUnique({ where: { code: 'CK-BASIC' } });
  const ckPlus = await prisma.checkupProgram.findUnique({ where: { code: 'CK-PLUS' } });
  const ckFemale = await prisma.checkupProgram.findUnique({ where: { code: 'CK-FEMALE' } });
  const ckPremium = await prisma.checkupProgram.findUnique({ where: { code: 'CK-PREMIUM' } });

  if (ckBasic && patientIds.length >= 6) {
    const existingVisits = await prisma.checkupVisit.count();
    if (existingVisits === 0) {
      const programs = [ckBasic, ckPlus, ckFemale, ckPremium].filter(Boolean) as any[];
      const statuses = ['RESERVED', 'RESERVED', 'RESERVED', 'CHECKED_IN', 'CHECKED_IN', 'IN_PROGRESS'];
      const times = [null, null, null, new Date(), new Date(), new Date()];

      for (let i = 0; i < Math.min(6, patientIds.length); i++) {
        const prog = programs[i % programs.length];
        await prisma.checkupVisit.create({
          data: {
            patientId: patientIds[i].id,
            programId: prog.id,
            scheduledDate: today,
            status: statuses[i],
            totalPrice: prog.price,
            checkedInAt: times[i],
          },
        });
      }
      console.log(`   - Checkup visits: 6 (today, RESERVED/CHECKED_IN/IN_PROGRESS)`);
    } else {
      console.log(`   - Checkup visits: ${existingVisits} (already exist)`);
    }
  }

  // ── 워크스테이션 설정 시딩 ──
  const wsConfigs = [
    { stationId: 'lab-phlebotomy', label: '채혈실', category: 'LAB', department: '진단검사의학과', orderCodes: ['CBC','BMP','LFT','LIPID','HbA1c','COAG','THYROID','CRP','ESR'], sortOrder: 1 },
    { stationId: 'lab-hematology', label: '혈액검사실', category: 'LAB', department: '진단검사의학과', orderCodes: ['CBC','COAG','ESR','BLOOD_TYPE','DIFF'], sortOrder: 2 },
    { stationId: 'lab-chemistry', label: '생화학검사실', category: 'LAB', department: '진단검사의학과', orderCodes: ['BMP','LFT','LIPID','HbA1c','THYROID','CRP','ELECTROLYTE','IRON','CARDIAC_MARKER'], sortOrder: 3 },
    { stationId: 'lab-urinalysis', label: '소변검사실', category: 'LAB', department: '진단검사의학과', orderCodes: ['UA','URINE_CULTURE','PREGNANCY','URINE_DRUG'], sortOrder: 4 },
    { stationId: 'lab-microbiology', label: '미생물검사실', category: 'LAB', department: '진단검사의학과', orderCodes: ['BLOOD_CULTURE','SPUTUM_CULTURE','WOUND_CULTURE','STOOL_CULTURE','AFB'], sortOrder: 5 },
    { stationId: 'img-xray', label: '일반촬영실', category: 'IMAGING', department: '영상의학과', orderCodes: ['CHEST_PA','CHEST_LAT','ABDOMEN','SPINE','EXTREMITY','SKULL'], sortOrder: 1 },
    { stationId: 'img-ct', label: 'CT실', category: 'IMAGING', department: '영상의학과', orderCodes: ['CT_HEAD','CT_CHEST','CT_ABDOMEN','CT_SPINE','CTA','CT_CARDIAC'], sortOrder: 2 },
    { stationId: 'img-mri', label: 'MRI실', category: 'IMAGING', department: '영상의학과', orderCodes: ['MRI_BRAIN','MRI_SPINE','MRI_KNEE','MRI_SHOULDER','MRI_ABDOMEN','MRA'], sortOrder: 3 },
    { stationId: 'img-ultrasound', label: '초음파실', category: 'IMAGING', department: '영상의학과', orderCodes: ['US_ABDOMEN','US_THYROID','US_BREAST','US_CAROTID','US_PELVIC','US_MSK'], sortOrder: 4 },
    { stationId: 'img-mammography', label: '유방촬영실', category: 'IMAGING', department: '영상의학과', orderCodes: ['MAMMOGRAPHY','TOMO_MAMMO'], sortOrder: 5 },
    { stationId: 'img-nuclear', label: '핵의학검사실', category: 'IMAGING', department: '영상의학과', orderCodes: ['PET_CT','BONE_SCAN','THYROID_SCAN','RENAL_SCAN'], sortOrder: 6 },
    // 🔴 기초검사(DIAGNOSTIC) 자리의 orderCodes 는 **검사 종류 정본**(shared `DIAGNOSTIC_TEST_TYPES`)이다.
    //    2026-08-26 이전 시드는 `ECG`·`EGD`·`PTA` 같은 다른 어휘를 넣어 `diagnostic_tests.test_type`
    //    (`EKG`·`ENDOSCOPY_UPPER`·`AUDIOMETRY`)과 **교집합이 0** 이었고, 그 결과 다섯 자리가
    //    전부 부서 전체 폴백으로 **채혈 오더**를 자기 대기로 보여줬다. 어휘를 바꾸면 여기도 함께 바꾼다.
    { stationId: 'diag-ecg', label: '심전도실', category: 'DIAGNOSTIC', department: '내과', orderCodes: ['EKG','HOLTER','TMT'], sortOrder: 1 },
    { stationId: 'diag-pft', label: '폐기능검사실', category: 'DIAGNOSTIC', department: '내과', orderCodes: ['PFT'], sortOrder: 2 },
    { stationId: 'diag-endoscopy', label: '내시경실', category: 'DIAGNOSTIC', department: '소화기내과', orderCodes: ['ENDOSCOPY_UPPER','ENDOSCOPY_LOWER'], sortOrder: 3 },
    { stationId: 'diag-hearing', label: '청력검사실', category: 'DIAGNOSTIC', department: '이비인후과', orderCodes: ['AUDIOMETRY'], sortOrder: 4 },
    { stationId: 'diag-cardiac', label: '심장검사실', category: 'DIAGNOSTIC', department: '순환기내과', orderCodes: ['ECHO'], sortOrder: 5 },
    // 종전에 담당 자리가 없던 종류(뇌파·수면다원·골밀도) — 워크리스트가 없으면 아무 화면에도 뜨지 않는다.
    { stationId: 'diag-eeg', label: '뇌파검사실', category: 'DIAGNOSTIC', department: '신경과', orderCodes: ['EEG'], sortOrder: 6 },
    { stationId: 'diag-psg', label: '수면검사실', category: 'DIAGNOSTIC', department: '신경과', orderCodes: ['PSG'], sortOrder: 7 },
    { stationId: 'diag-dexa', label: '골밀도검사실', category: 'DIAGNOSTIC', department: '정형외과', orderCodes: ['DEXA'], sortOrder: 8 },
    // 치료실
    { stationId: 'tx-pt', label: '물리치료실', category: 'THERAPY', department: '재활의학과', orderCodes: ['PT_EXERCISE','PT_MODALITY','PT_MANUAL'], sortOrder: 1 },
    { stationId: 'tx-ot', label: '작업치료실', category: 'THERAPY', department: '재활의학과', orderCodes: ['OT_ADL','OT_COGNITIVE','OT_HAND'], sortOrder: 2 },
    { stationId: 'tx-st', label: '언어치료실', category: 'THERAPY', department: '재활의학과', orderCodes: ['ST_SPEECH','ST_SWALLOW','ST_LANGUAGE'], sortOrder: 3 },
    { stationId: 'tx-dialysis', label: '투석실', category: 'THERAPY', department: '투석실', orderCodes: ['HD_SESSION','PD_SESSION'], sortOrder: 4 },
    { stationId: 'tx-chemo', label: '항암치료실', category: 'THERAPY', department: '혈액종양내과', orderCodes: ['CHEMO_IV','CHEMO_PORT'], sortOrder: 5 },
    { stationId: 'tx-radiation', label: '방사선치료실', category: 'THERAPY', department: '방사선종양학과', orderCodes: ['RT_FRACTION','RT_BOOST'], sortOrder: 6 },
  ];
  for (const ws of wsConfigs) {
    await prisma.workstationConfig.upsert({
      where: { stationId: ws.stationId },
      update: { label: ws.label, category: ws.category, department: ws.department, sortOrder: ws.sortOrder },
      create: ws,
    });
  }
  console.log(`   - Workstation configs: ${wsConfigs.length}`);

  // ── 검진센터 전용 스테이션 시딩 ──
  const ckStations = [
    { stationId: 'ck-reception', name: '검진 접수', category: 'RECEPTION', icon: '🏥', sortOrder: 0, avgMinutes: 5, capacity: 3 },
    { stationId: 'ck-physical', name: '신체계측실', category: 'PHYSICAL', icon: '📏', sortOrder: 1, avgMinutes: 8, capacity: 2,
      template: { fields: [
        { name: 'height', label: '신장', type: 'number', unit: 'cm', required: true },
        { name: 'weight', label: '체중', type: 'number', unit: 'kg', required: true },
        { name: 'bmi', label: 'BMI', type: 'computed', formula: 'weight/(height/100)^2' },
        { name: 'waist', label: '허리둘레', type: 'number', unit: 'cm' },
        { name: 'bpSystolic', label: '수축기 혈압', type: 'number', unit: 'mmHg', required: true },
        { name: 'bpDiastolic', label: '이완기 혈압', type: 'number', unit: 'mmHg', required: true },
        { name: 'pulse', label: '맥박', type: 'number', unit: '/min' },
        { name: 'temperature', label: '체온', type: 'number', unit: '°C' },
        { name: 'visionLeft', label: '시력(좌)', type: 'text' },
        { name: 'visionRight', label: '시력(우)', type: 'text' },
        { name: 'hearingLeft', label: '청력(좌)', type: 'number', unit: 'dB' },
        { name: 'hearingRight', label: '청력(우)', type: 'number', unit: 'dB' },
        { name: 'bodyFat', label: '체지방율', type: 'number', unit: '%' },
      ]},
    },
    { stationId: 'ck-blood', name: '채혈실', category: 'LAB', icon: '🩸', sortOrder: 2, avgMinutes: 4, capacity: 3,
      template: { fields: [
        { name: 'specimenId', label: '검체번호', type: 'text', required: true },
        { name: 'tubeTypes', label: '채혈관', type: 'multiselect', options: ['EDTA(보라)', 'SST(노랑)', 'Heparin(초록)', 'Citrate(파랑)', 'NaF(회색)'] },
        { name: 'volume', label: '채혈량', type: 'number', unit: 'mL' },
        { name: 'note', label: '특이사항', type: 'textarea' },
      ]},
      hisMapping: { target: 'LabResult', encounterType: 'CHECKUP' },
    },
    { stationId: 'ck-urine', name: '검체실', category: 'LAB', icon: '🧪', sortOrder: 3, avgMinutes: 3, capacity: 1,
      hisMapping: { target: 'LabResult', encounterType: 'CHECKUP' },
    },
    { stationId: 'ck-xray', name: 'X-ray실', category: 'IMAGING', icon: '📷', sortOrder: 4, avgMinutes: 5, capacity: 1,
      hisMapping: { target: 'ImagingResult', encounterType: 'CHECKUP' },
    },
    { stationId: 'ck-ultrasound', name: '초음파실', category: 'IMAGING', icon: '🔊', sortOrder: 5, avgMinutes: 15, capacity: 2,
      template: { fields: [
        { name: 'liver', label: '간', type: 'textarea', placeholder: '크기, 에코, 종괴' },
        { name: 'gallbladder', label: '담낭', type: 'textarea', placeholder: '결석, 용종' },
        { name: 'pancreas', label: '췌장', type: 'textarea' },
        { name: 'spleen', label: '비장', type: 'textarea' },
        { name: 'kidneyLeft', label: '좌측 신장', type: 'textarea' },
        { name: 'kidneyRight', label: '우측 신장', type: 'textarea' },
        { name: 'thyroid', label: '갑상선', type: 'textarea', placeholder: '결절, 크기' },
      ]},
      hisMapping: { target: 'ImagingResult', encounterType: 'CHECKUP' },
    },
    { stationId: 'ck-ecg', name: '심전도실', category: 'DIAGNOSTIC', icon: '💓', sortOrder: 6, avgMinutes: 5, capacity: 1,
      template: { fields: [
        { name: 'rhythm', label: '리듬', type: 'text', placeholder: 'Normal sinus rhythm' },
        { name: 'rate', label: '심박수', type: 'number', unit: 'bpm' },
        { name: 'axis', label: '축', type: 'text', placeholder: 'Normal axis' },
        { name: 'prInterval', label: 'PR 간격', type: 'text', unit: 'ms' },
        { name: 'qrsDuration', label: 'QRS 간격', type: 'text', unit: 'ms' },
        { name: 'qtcInterval', label: 'QTc 간격', type: 'text', unit: 'ms' },
        { name: 'stChange', label: 'ST 변화', type: 'select', options: ['없음', 'ST elevation', 'ST depression', 'T wave inversion'] },
      ]},
      hisMapping: { target: 'DiagnosticTest', encounterType: 'CHECKUP' },
    },
    { stationId: 'ck-pft', name: '폐기능검사실', category: 'DIAGNOSTIC', icon: '🫁', sortOrder: 7, avgMinutes: 10, capacity: 1,
      template: { fields: [
        { name: 'fvc', label: 'FVC', type: 'number', unit: 'L' },
        { name: 'fev1', label: 'FEV1', type: 'number', unit: 'L' },
        { name: 'fev1Fvc', label: 'FEV1/FVC', type: 'number', unit: '%' },
        { name: 'pattern', label: '패턴', type: 'select', options: ['Normal', 'Obstructive', 'Restrictive', 'Mixed'] },
      ]},
      hisMapping: { target: 'DiagnosticTest', encounterType: 'CHECKUP' },
    },
    { stationId: 'ck-endoscopy', name: '내시경실', category: 'DIAGNOSTIC', icon: '🔬', sortOrder: 8, avgMinutes: 20, capacity: 2,
      template: { fields: [
        { name: 'type', label: '검사종류', type: 'select', options: ['위내시경', '대장내시경', '위+대장'], required: true },
        { name: 'sedation', label: '진정', type: 'select', options: ['비진정', '진정(수면)'] },
        { name: 'esophagus', label: '식도', type: 'textarea' },
        { name: 'stomach', label: '위', type: 'textarea' },
        { name: 'duodenum', label: '십이지장', type: 'textarea' },
        { name: 'hpylori', label: 'H.pylori', type: 'select', options: ['미시행', '양성', '음성'] },
        { name: 'biopsy', label: '조직검사', type: 'text', placeholder: '부위/수' },
        { name: 'polyp', label: '용종절제', type: 'text', placeholder: '부위/수/크기' },
      ]},
      hisMapping: { target: 'DiagnosticTest', encounterType: 'CHECKUP' },
    },
    { stationId: 'ck-eye', name: '안과검사실', category: 'DIAGNOSTIC', icon: '👁', sortOrder: 9, avgMinutes: 8, capacity: 1,
      template: { fields: [
        { name: 'visionNakedLeft', label: '나안시력(좌)', type: 'text' },
        { name: 'visionNakedRight', label: '나안시력(우)', type: 'text' },
        { name: 'visionCorrectedLeft', label: '교정시력(좌)', type: 'text' },
        { name: 'visionCorrectedRight', label: '교정시력(우)', type: 'text' },
        { name: 'iopLeft', label: '안압(좌)', type: 'number', unit: 'mmHg' },
        { name: 'iopRight', label: '안압(우)', type: 'number', unit: 'mmHg' },
        { name: 'fundus', label: '안저촬영', type: 'select', options: ['정상', '이상소견'] },
        { name: 'colorVision', label: '색각', type: 'select', options: ['정상', '이상'] },
      ]},
      hisMapping: { target: 'DiagnosticTest', encounterType: 'CHECKUP' },
    },
    { stationId: 'ck-consult', name: '결과상담실', category: 'CONSULT', icon: '🩺', sortOrder: 99, avgMinutes: 15, capacity: 3 },
  ];

  // 스테이션 ↔ 공간 정본(가상병원 SpaceNode) — 공간 모델에 해당 구역이 있는 것만. 없는 것(검체실·신체계측·폐기능·안과·상담)은 연결하지 않는다(지어내지 않음)
  // 🔴 create 에만 넣는다 — 재시드가 관리자가 바꾼 연결을 덮지 않게(update:{} 에 넣지 않음)
  const ckSpaceCode: Record<string, string> = {
    'ck-reception': 'B1-RC', 'ck-blood': 'B1-LAB', 'ck-xray': 'B1-XRAY', 'ck-ultrasound': 'B1-US', 'ck-endoscopy': 'B1-GI', 'ck-ecg': 'F2-EKG',
  };
  const ckSpaceNodes = await prisma.spaceNode.findMany({ where: { code: { in: Object.values(ckSpaceCode) } }, select: { id: true, code: true } });
  const ckSpaceId = new Map(ckSpaceNodes.map((n) => [n.code, n.id]));
  for (const st of ckStations) {
    const spaceNodeId = ckSpaceCode[st.stationId] ? ckSpaceId.get(ckSpaceCode[st.stationId]) ?? null : null;
    await prisma.checkupStation.upsert({
      where: { stationId: st.stationId },
      update: { name: st.name, sortOrder: st.sortOrder, avgMinutes: st.avgMinutes, capacity: st.capacity },
      create: { ...(st as any), spaceNodeId },
    });
  }
  console.log(`   - Checkup stations: ${ckStations.length}`);

  // ── 검진 문진표 템플릿 시딩 ──
  const existingQ = await prisma.checkupQuestionnaire.count();
  if (existingQ === 0) {
    await prisma.checkupQuestionnaire.create({
      data: {
        title: '일반 건강검진 문진표',
        programId: null,
        sections: [
          { title: '기본 건강 정보', questions: [
            { id: 'q1', type: 'select', label: '흡연 여부', required: true, options: ['비흡연', '과거흡연 (금연중)', '현재흡연'] },
            { id: 'q2', type: 'select', label: '음주 빈도', required: true, options: ['전혀 안함', '월 1-2회', '주 1-2회', '주 3회 이상', '매일'] },
            { id: 'q3', type: 'select', label: '주당 운동 횟수', required: true, options: ['거의 안함', '1-2회', '3-4회', '5회 이상'] },
          ]},
          { title: '과거 병력', questions: [
            { id: 'q4', type: 'multiselect', label: '진단받은 질환 (해당 모두 선택)', required: false, options: ['고혈압', '당뇨병', '고지혈증', '심장질환', '뇌혈관질환', '간질환', '갑상선질환', '암', '기타'] },
            { id: 'q5', type: 'boolean', label: '현재 복용 중인 약물이 있습니까?', required: true },
            { id: 'q5a', type: 'text', label: '복용 약물 상세', required: false },
          ]},
          { title: '가족력', questions: [
            { id: 'q6', type: 'multiselect', label: '직계 가족 중 해당 질환자', required: false, options: ['고혈압', '당뇨병', '심장질환', '뇌졸중', '암(위)', '암(대장)', '암(유방)', '암(폐)'] },
          ]},
          { title: '현재 증상', questions: [
            { id: 'q7', type: 'multiselect', label: '최근 6개월 내 경험한 증상', required: false, options: ['두통', '어지러움', '가슴통증', '호흡곤란', '소화불량', '복통', '피로감', '체중변화', '혈변/혈뇨', '없음'] },
          ]},
        ],
      },
    });
    console.log('   - Checkup questionnaire: 1 (공통 문진표)');
  }

  // ── 검사항목 템플릿 시딩 ──
  const labTemplates = [
    {
      procedureCode: 'CBC', testName: 'CBC (일반혈액검사)', stationId: 'lab-hematology',
      items: [
        { name: 'WBC', unit: '/μL', refRange: '4000-10000', decimalPlaces: 0 },
        { name: 'RBC', unit: 'M/μL', refRange: '4.2-5.4', decimalPlaces: 2 },
        { name: 'Hemoglobin', unit: 'g/dL', refRange: '13-17', decimalPlaces: 1 },
        { name: 'Hematocrit', unit: '%', refRange: '38-52', decimalPlaces: 1 },
        { name: 'Platelet', unit: 'K/μL', refRange: '150-400', decimalPlaces: 0 },
        { name: 'MCV', unit: 'fL', refRange: '80-100', decimalPlaces: 1 },
        { name: 'MCH', unit: 'pg', refRange: '27-33', decimalPlaces: 1 },
        { name: 'MCHC', unit: 'g/dL', refRange: '32-36', decimalPlaces: 1 },
        { name: 'ESR', unit: 'mm/hr', refRange: '0-20', decimalPlaces: 0 },
      ],
    },
    {
      procedureCode: 'BMP', testName: 'BMP (기본대사패널)', stationId: 'lab-chemistry',
      items: [
        { name: 'Glucose', unit: 'mg/dL', refRange: '70-110', decimalPlaces: 0 },
        { name: 'BUN', unit: 'mg/dL', refRange: '7-20', decimalPlaces: 1 },
        { name: 'Creatinine', unit: 'mg/dL', refRange: '0.6-1.2', decimalPlaces: 2 },
        { name: 'Na', unit: 'mEq/L', refRange: '136-145', decimalPlaces: 0 },
        { name: 'K', unit: 'mEq/L', refRange: '3.5-5.1', decimalPlaces: 1 },
        { name: 'Cl', unit: 'mEq/L', refRange: '98-106', decimalPlaces: 0 },
        { name: 'CO2', unit: 'mEq/L', refRange: '22-29', decimalPlaces: 0 },
        { name: 'Ca', unit: 'mg/dL', refRange: '8.6-10.2', decimalPlaces: 1 },
      ],
    },
    {
      procedureCode: 'LFT', testName: 'LFT (간기능검사)', stationId: 'lab-chemistry',
      items: [
        { name: 'AST', unit: 'U/L', refRange: '0-40', decimalPlaces: 0 },
        { name: 'ALT', unit: 'U/L', refRange: '0-41', decimalPlaces: 0 },
        { name: 'ALP', unit: 'U/L', refRange: '40-129', decimalPlaces: 0 },
        { name: 'GGT', unit: 'U/L', refRange: '8-61', decimalPlaces: 0 },
        { name: 'Total Bilirubin', unit: 'mg/dL', refRange: '0.1-1.2', decimalPlaces: 1 },
        { name: 'Direct Bilirubin', unit: 'mg/dL', refRange: '0-0.3', decimalPlaces: 1 },
        { name: 'Total Protein', unit: 'g/dL', refRange: '6.0-8.3', decimalPlaces: 1 },
        { name: 'Albumin', unit: 'g/dL', refRange: '3.5-5.2', decimalPlaces: 1 },
      ],
    },
    {
      procedureCode: 'LIPID', testName: '지질검사', stationId: 'lab-chemistry',
      items: [
        { name: 'Total Cholesterol', unit: 'mg/dL', refRange: '0-200', decimalPlaces: 0 },
        { name: 'Triglyceride', unit: 'mg/dL', refRange: '0-150', decimalPlaces: 0 },
        { name: 'HDL-C', unit: 'mg/dL', refRange: '40-60', decimalPlaces: 0 },
        { name: 'LDL-C', unit: 'mg/dL', refRange: '0-130', decimalPlaces: 0 },
      ],
    },
    {
      procedureCode: 'UA', testName: '소변검사', stationId: 'lab-urinalysis',
      items: [
        { name: 'pH', unit: '', refRange: '4.5-8.0', decimalPlaces: 1 },
        { name: 'Specific Gravity', unit: '', refRange: '1.005-1.030', decimalPlaces: 3 },
        { name: 'Protein', unit: '', refRange: 'Negative', decimalPlaces: 0 },
        { name: 'Glucose', unit: '', refRange: 'Negative', decimalPlaces: 0 },
        { name: 'Blood', unit: '', refRange: 'Negative', decimalPlaces: 0 },
        { name: 'WBC', unit: '/HPF', refRange: '0-5', decimalPlaces: 0 },
        { name: 'RBC', unit: '/HPF', refRange: '0-3', decimalPlaces: 0 },
      ],
    },
    {
      procedureCode: 'HbA1c', testName: '당화혈색소', stationId: 'lab-chemistry',
      items: [
        { name: 'HbA1c', unit: '%', refRange: '4.0-5.6', decimalPlaces: 1 },
      ],
    },
    {
      procedureCode: 'COAG', testName: '응고검사', stationId: 'lab-hematology',
      items: [
        { name: 'PT', unit: 'sec', refRange: '11-13.5', decimalPlaces: 1 },
        { name: 'PT INR', unit: '', refRange: '0.85-1.15', decimalPlaces: 2 },
        { name: 'aPTT', unit: 'sec', refRange: '25-35', decimalPlaces: 1 },
      ],
    },
    {
      procedureCode: 'THYROID', testName: '갑상선기능검사', stationId: 'lab-chemistry',
      items: [
        { name: 'TSH', unit: 'μIU/mL', refRange: '0.27-4.20', decimalPlaces: 2 },
        { name: 'Free T4', unit: 'ng/dL', refRange: '0.93-1.70', decimalPlaces: 2 },
        { name: 'T3', unit: 'ng/dL', refRange: '80-200', decimalPlaces: 1 },
      ],
    },
  ];
  for (const t of labTemplates) {
    await prisma.labTestTemplate.upsert({
      where: { procedureCode: t.procedureCode },
      update: { testName: t.testName, items: t.items, stationId: t.stationId },
      create: t,
    });
  }
  console.log(`   - Lab test templates: ${labTemplates.length}`);

  // ── 치료실 테스트 오더 시딩 ──
  const existingTherapyOrders = await prisma.order.count({
    where: { notes: 'THERAPY_SEED' },
  });
  if (existingTherapyOrders === 0 && patientIds.length >= 6) {
    const doctorKimId = uid(P.USER, 2); // 김내과
    // 오늘 날짜 Encounter 가져오기 또는 생성
    const enc = await prisma.encounter.findFirst({
      where: { doctorId: doctorKimId, status: 'DRAFT' },
      select: { id: true },
    }) ?? await prisma.encounter.create({
      data: { patientId: patientIds[0].id, doctorId: doctorKimId, status: 'DRAFT', visitType: 'OUTPATIENT' },
    });

    const therapyOrders = [
      { patientIdx: 0, priority: 'ROUTINE', note: '물리치료 - 운동치료', type: 'PT_EXERCISE', station: 'tx-pt', time: '09:00', dur: 30 },
      { patientIdx: 1, priority: 'ROUTINE', note: '물리치료 - 도수치료', type: 'PT_MANUAL', station: 'tx-pt', time: '09:30', dur: 20 },
      { patientIdx: 2, priority: 'ROUTINE', note: '작업치료 - ADL 훈련', type: 'OT_ADL', station: 'tx-ot', time: '10:00', dur: 30 },
      { patientIdx: 3, priority: 'ROUTINE', note: '혈액투석 세션', type: 'HD_SESSION', station: 'tx-dialysis', time: '08:00', dur: 240 },
      { patientIdx: 4, priority: 'STAT', note: '항암 - R-CHOP Cycle 3 Day 1', type: 'CHEMO_IV', station: 'tx-chemo', time: '09:00', dur: 180 },
      { patientIdx: 5, priority: 'ROUTINE', note: '방사선치료 - Fraction #15', type: 'RT_FRACTION', station: 'tx-radiation', time: '10:00', dur: 15 },
      { patientIdx: 0, priority: 'ROUTINE', note: '물리치료 - 열전기치료', type: 'PT_MODALITY', station: 'tx-pt', time: '14:00', dur: 20 },
      { patientIdx: 1, priority: 'ROUTINE', note: '언어치료 - 조음치료', type: 'ST_SPEECH', station: 'tx-st', time: '11:00', dur: 30 },
    ];

    for (let i = 0; i < therapyOrders.length; i++) {
      const t = therapyOrders[i];
      const pid = patientIds[t.patientIdx].id;
      const rxId = makeUuid('7e7a0000', 100 + i);
      const ordId = makeUuid('7e7a0001', 100 + i);

      // Encounter per patient (reuse or create)
      let encId = enc.id;
      if (t.patientIdx > 0) {
        const pEnc = await prisma.encounter.findFirst({
          where: { patientId: pid, doctorId: doctorKimId },
          select: { id: true },
        });
        if (pEnc) {
          encId = pEnc.id;
        } else {
          const newEnc = await prisma.encounter.create({
            data: { patientId: pid, doctorId: doctorKimId, status: 'DRAFT', visitType: 'OUTPATIENT' },
          });
          encId = newEnc.id;
        }
      }

      await prisma.prescription.upsert({
        where: { id: rxId },
        update: {},
        create: {
          id: rxId,
          encounterId: encId,
          type: 'THERAPY',
          status: 'ACTIVE',
          instructions: t.note,
          createdBy: doctorKimId,
        },
      });

      await prisma.order.upsert({
        where: { id: ordId },
        update: {},
        create: {
          id: ordId,
          prescriptionId: rxId,
          department: 'THERAPY',
          status: 'ORDERED',
          priority: t.priority,
          notes: 'THERAPY_SEED',
        },
      });

      // TherapyOrder
      const toId = makeUuid('7e7a0002', 100 + i);
      await prisma.therapyOrder.upsert({
        where: { id: toId },
        update: {},
        create: {
          id: toId,
          orderId: ordId,
          therapyType: (t as any).type ?? 'PT_EXERCISE',
          scheduledDate: today,
          scheduledTime: (t as any).time ?? null,
          duration: (t as any).dur ?? null,
          stationId: (t as any).station ?? 'tx-pt',
          sessionNo: 1,
        },
      });
    }
    console.log(`   - Therapy orders: ${therapyOrders.length}`);
  } else {
    console.log(`   - Therapy orders: ${existingTherapyOrders} (already exist)`);
  }

  // ── 치료 세션 시딩 (기존 모듈 API용) ──
  const ptTherapist = uid(P.USER, 83); // tx.pt
  const dialysisNurse = uid(P.USER, 86); // tx.dialysis
  const existingRehabSessions = await prisma.rehabSession.count();
  if (existingRehabSessions === 0 && patientIds.length >= 4) {
    // RehabPlan + RehabSession
    for (let i = 0; i < 3; i++) {
      const planId = makeUuid('7eab0000', i);
      const patId = patientIds[i].id;
      const types = ['운동치료', '도수치료', '작업치료'];
      await prisma.rehabPlan.upsert({
        where: { id: planId },
        update: {},
        create: {
          id: planId, patientId: patId, diagnosis: '요추 추간판 탈출증',
          startDate: new Date(), frequency: '주3회', status: 'ACTIVE',
          prescribedBy: uid(P.USER, 2), therapies: [types[i]],
        },
      });
      // 오늘 세션 2건씩
      for (let j = 0; j < 2; j++) {
        const sessId = makeUuid('7eab0001', i * 10 + j);
        const hour = 9 + i * 2 + j;
        await prisma.rehabSession.upsert({
          where: { id: sessId },
          update: {},
          create: {
            id: sessId, planId, patientId: patId,
            therapyType: types[i], therapistId: ptTherapist,
            scheduledAt: new Date(today.getTime() + hour * 3600000),
            status: 'SCHEDULED',
          },
        });
      }
    }
    console.log(`   - Rehab sessions: 6 (3 plans × 2 sessions)`);

    // DialysisOrder + DialysisSession
    for (let i = 0; i < 2; i++) {
      const ordId = makeUuid('7eda0000', i);
      const patId = patientIds[3 + i]?.id ?? patientIds[0].id;
      await prisma.dialysisOrder.upsert({
        where: { id: ordId },
        update: {},
        create: {
          id: ordId, patientId: patId, prescribedBy: uid(P.USER, 2),
          modality: 'HD', frequency: 'MWF', duration: 240,
          dialyzerType: 'Fx80', bloodFlowRate: 250, dialysateFlow: 500,
          dryWeight: 65.0, ufGoal: 2000, anticoagulant: 'Heparin',
          accessType: 'AVF', startDate: new Date(), isActive: true,
        },
      });
      const sessId = makeUuid('7eda0001', i);
      const shift = i === 0 ? 'AM' : 'PM';
      await prisma.dialysisSession.upsert({
        where: { id: sessId },
        update: {},
        create: {
          id: sessId, orderId: ordId, patientId: patId,
          scheduledDate: today, shift,
          status: 'SCHEDULED',
        },
      });
    }
    console.log(`   - Dialysis sessions: 2 (AM/PM)`);

    // RadiationPlan + RadiationFraction
    const radPatId = patientIds[5]?.id ?? patientIds[0].id;
    const radPlanId = makeUuid('7ead0000', 0);
    await prisma.radiationPlan.upsert({
      where: { id: radPlanId },
      update: {},
      create: {
        id: radPlanId, patientId: radPatId, prescribedBy: uid(P.USER, 2),
        diagnosis: '유방암', diagnosisCode: 'C50.9',
        intent: 'CURATIVE', technique: '3D-CRT', site: 'Rt. breast',
        totalDose: 50.0, fractionDose: 2.0, totalFractions: 25,
        energy: '6MV', machine: 'LINAC-1', status: 'IN_TREATMENT',
      },
    });
    for (let i = 0; i < 2; i++) {
      const frId = makeUuid('7ead0001', i);
      await prisma.radiationFraction.upsert({
        where: { id: frId },
        update: {},
        create: {
          id: frId, planId: radPlanId,
          fractionNumber: 15 + i, scheduledDate: today,
          status: 'SCHEDULED',
        },
      });
    }
    console.log(`   - Radiation fractions: 2 (Fraction #15, #16)`);
  }

  const elapsed2 = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Seed completed in ${elapsed2}s`);
  console.log(`   - Appointments: ${appointments.length}`);
  console.log(`   - Admissions: ${admissionData.length}`);
  console.log(`   - Billings: ${billingCount}, Claims: ${claims.length}`);
  console.log(`   - Surgeries: ${surgeries.length}`);
  console.log(`   - Emergency visits: ${emergencyVisits.length}`);
  console.log(`   - Dispensings: ${dispensings.length}`);
  console.log(`   - Meal orders: ${mealOrders.length}`);
  console.log(`   - Infection surveillances: ${infections.length}`);
  console.log(`   - Safety incidents: ${safetyIncidents.length}`);
  console.log(`   - Education programs: ${eduPrograms.length}`);
  console.log(`   - Staff schedules: ${schedCount}`);
  console.log(`   - Certificates: ${certificates.length}`);
  console.log(`   - Blockchain certs: ${bcCertSeedData.length}, Audit logs: ${bcAuditLogs.length}, Signatures: ${bcDocSigs.length}`);

  // ══════════════════════════════════════════════
  // 재활의학 / 방사선종양 / 투석실 시드 데이터
  // ══════════════════════════════════════════════

  const seedToday = new Date();
  const day = (d: number) => { const dt = new Date(seedToday); dt.setDate(dt.getDate() + d); return dt; };

  // ── 재활의학 ──
  const rehabDoctorId = uid(P.USER, 33);
  const rehabNurseId = uid(P.USER, 52);

  const rehabSeedPlans = [
    { patientIdx: 3, diagnosis: '뇌졸중 후 좌측 편마비 (I63.9)', freq: '주 5회', therapies: ['PT', 'OT', 'ST'], notes: '좌측 상하지 기능 회복 목표' },
    { patientIdx: 5, diagnosis: '요추 추간판 탈출증 (M51.1)', freq: '주 3회', therapies: ['PT', 'HEAT'], notes: '통증 완화 + 근력 강화' },
    { patientIdx: 1, diagnosis: '슬관절 전치환술 후 재활 (Z96.6)', freq: '주 5회', therapies: ['PT', 'GAIT'], notes: '보행 훈련 + ROM 확보' },
  ];

  for (let pi = 0; pi < rehabSeedPlans.length; pi++) {
    const rp = rehabSeedPlans[pi];
    const planId = makeUuid('00000070', pi + 1);
    await prisma.rehabPlan.upsert({
      where: { id: planId },
      update: {},
      create: {
        id: planId,
        patientId: uid(P.PATIENT, rp.patientIdx),
        diagnosis: rp.diagnosis,
        startDate: day(-14),
        endDate: day(42),
        frequency: rp.freq,
        therapies: rp.therapies,
        status: 'ACTIVE',
        prescribedBy: rehabDoctorId,
        notes: rp.notes,
      },
    });

    // 각 플랜당 세션 6개 (과거 3 + 오늘 1 + 미래 2)
    for (let si = 0; si < 6; si++) {
      const sessId = makeUuid('00000071', pi * 10 + si + 1);
      const daysOffset = si - 3; // -3, -2, -1, 0, 1, 2
      const scheduled = day(daysOffset);
      scheduled.setHours(9 + si, 0, 0, 0);
      const isPast = daysOffset < 0;
      await prisma.rehabSession.upsert({
        where: { id: sessId },
        update: {},
        create: {
          id: sessId,
          planId,
          patientId: uid(P.PATIENT, rp.patientIdx),
          therapyType: rp.therapies[si % rp.therapies.length],
          therapistId: rehabNurseId,
          scheduledAt: scheduled,
          startTime: isPast ? scheduled : null,
          endTime: isPast ? new Date(scheduled.getTime() + 30 * 60000) : null,
          duration: isPast ? 30 : null,
          activities: isPast ? [{ name: `${rp.therapies[si % rp.therapies.length]} 치료`, duration: 30 }] : undefined,
          vitals: isPast ? { bp: '120/80', hr: 72, spo2: 98 } : undefined,
          progress: isPast ? '양호한 진전. 환자 협조적.' : null,
          status: isPast ? 'COMPLETED' : daysOffset === 0 ? 'IN_PROGRESS' : 'SCHEDULED',
        },
      });
    }
  }
  console.log(`   - Rehab plans: ${rehabSeedPlans.length}, sessions: ${rehabSeedPlans.length * 6}`);

  // ── 방사선종양 ──
  const radDoctorId = uid(P.USER, 23);
  const radTherapistId = uid(P.USER, 88);

  const radSeedPlans = [
    { patientIdx: 6, diagnosis: '유방암 (C50.9)', intent: 'ADJUVANT', technique: 'IMRT', site: '좌측 유방', totalDose: 50.0, fracDose: 2.0, fractions: 25, energy: '6MV', machine: 'TrueBeam-1' },
    { patientIdx: 13, diagnosis: '폐암 (C34.1)', intent: 'DEFINITIVE', technique: '3D-CRT', site: '우상엽', totalDose: 60.0, fracDose: 2.0, fractions: 30, energy: '15MV', machine: 'Clinac-2' },
  ];

  for (let ri = 0; ri < radSeedPlans.length; ri++) {
    const rr = radSeedPlans[ri];
    const planId = makeUuid('00000072', ri + 1);
    await prisma.radiationPlan.upsert({
      where: { id: planId },
      update: {},
      create: {
        id: planId,
        patientId: uid(P.PATIENT, rr.patientIdx),
        diagnosis: rr.diagnosis,
        intent: rr.intent,
        technique: rr.technique,
        site: rr.site,
        totalDose: rr.totalDose,
        fractionDose: rr.fracDose,
        totalFractions: rr.fractions,
        energy: rr.energy,
        machine: rr.machine,
        simulationDate: day(-21),
        planApprovedAt: day(-14),
        planApprovedBy: radDoctorId,
        startDate: day(-10),
        // 🔴 같은 파일의 다른 방사선 시드는 IN_TREATMENT 를 쓴다 — 어휘를 정본으로 통일
        status: 'IN_TREATMENT',
        prescribedBy: radDoctorId,
      },
    });

    // 분할 조사 10회 (과거 8 + 오늘 1 + 내일 1)
    for (let fi = 0; fi < 10; fi++) {
      const fracId = makeUuid('00000073', ri * 100 + fi + 1);
      const fracDate = day(-9 + fi);
      const isPast = fi < 8;
      const cumDose = (fi + 1) * rr.fracDose;
      await prisma.radiationFraction.upsert({
        where: { id: fracId },
        update: {},
        create: {
          id: fracId,
          planId,
          fractionNumber: fi + 1,
          scheduledDate: fracDate,
          deliveredAt: isPast ? fracDate : null,
          deliveredDose: isPast ? rr.fracDose : null,
          cumulativeDose: isPast ? cumDose : null,
          setupVerified: isPast ? true : null,
          coneBeamCT: isPast && fi % 3 === 0 ? true : null,
          therapistId: isPast ? radTherapistId : null,
          // 🔴 분획 상태 정본은 DELIVERED/DELIVERING 이다(서버 코드·다른 시드 블록).
          //    이 블록만 COMPLETED/IN_PROGRESS 를 써서 진행률·누적선량 집계에서 빠졌다.
          // 🔴 (2026-10-10) DELIVERING 은 서버가 조사 트랜잭션 안에서만 잠깐 쓰는 선점 상태다 — 시드가 넣으면 그 분할은
          //    조사(SCHEDULED 만)도 취소도 못 하는 채로 영구히 남는다(운영 2건). 미래 분할은 예정으로.
          status: isPast ? 'DELIVERED' : 'SCHEDULED',
        },
      });
    }
  }
  console.log(`   - Radiation plans: ${radSeedPlans.length}, fractions: ${radSeedPlans.length * 10}`);

  // ── 투석실 ──
  const dialysisDoctorId = uid(P.USER, 22);
  const dialysisNurseId = uid(P.USER, 50);

  // 투석기 5대
  const dialysisMachinesSeed = [
    { name: 'HD-01', model: 'Fresenius 5008S', sn: 'FS-2024-001', type: 'HD', loc: '투석실 A존' },
    { name: 'HD-02', model: 'Fresenius 5008S', sn: 'FS-2024-002', type: 'HD', loc: '투석실 A존' },
    { name: 'HD-03', model: 'Nipro NCU-18', sn: 'NP-2024-001', type: 'HD', loc: '투석실 B존' },
    { name: 'HDF-01', model: 'Nikkiso DBB-EXA', sn: 'NK-2024-001', type: 'HDF', loc: '투석실 B존' },
    { name: 'CRRT-01', model: 'Baxter PrisMax', sn: 'BX-2024-001', type: 'CRRT', loc: 'ICU' },
  ];
  const machineIds: string[] = [];
  for (let mi = 0; mi < dialysisMachinesSeed.length; mi++) {
    const m = dialysisMachinesSeed[mi];
    const machineId = makeUuid('00000074', mi + 1);
    machineIds.push(machineId);
    await prisma.dialysisMachine.upsert({
      where: { id: machineId },
      update: {},
      create: {
        id: machineId,
        name: m.name,
        model: m.model,
        serialNumber: m.sn,
        machineType: m.type,
        location: m.loc,
        status: 'AVAILABLE',
        lastDisinfection: day(-1),
        isActive: true,
      },
    });
  }

  // 투석 처방 3건
  const dialysisSeedOrders = [
    { patientIdx: 4, modality: 'HD', freq: '주 3회 (월/수/금)', dur: 240, dialyzer: 'FX CorDiax 80', bfr: 250, df: 500, dryWt: 65.0, uf: 2500, anti: 'Heparin 1000U', access: 'AVF 좌측 전완' },
    { patientIdx: 7, modality: 'HD', freq: '주 3회 (화/목/토)', dur: 240, dialyzer: 'Elisio 21H', bfr: 280, df: 500, dryWt: 72.0, uf: 3000, anti: 'Heparin 1500U', access: 'AVG 우측 상완' },
    { patientIdx: 2, modality: 'HDF', freq: '주 3회 (월/수/금)', dur: 270, dialyzer: 'FX CorDiax 100', bfr: 300, df: 700, dryWt: 58.0, uf: 2000, anti: 'LMWH', access: 'AVF 우측 전완' },
  ];

  for (let di = 0; di < dialysisSeedOrders.length; di++) {
    const dord = dialysisSeedOrders[di];
    const orderId = makeUuid('00000075', di + 1);
    await prisma.dialysisOrder.upsert({
      where: { id: orderId },
      update: {},
      create: {
        id: orderId,
        patientId: uid(P.PATIENT, dord.patientIdx),
        modality: dord.modality,
        frequency: dord.freq,
        duration: dord.dur,
        dialyzerType: dord.dialyzer,
        bloodFlowRate: dord.bfr,
        dialysateFlow: dord.df,
        dryWeight: dord.dryWt,
        ufGoal: dord.uf,
        anticoagulant: dord.anti,
        accessType: dord.access,
        prescribedBy: dialysisDoctorId,
        startDate: day(-30),
        isActive: true,
      },
    });

    // 세션 6건 (과거 4 + 오늘 1 + 미래 1)
    const shifts = ['A', 'B', 'C'];
    for (let si = 0; si < 6; si++) {
      const sessId = makeUuid('00000076', di * 10 + si + 1);
      const daysOff = (si - 4) * 2; // -8, -6, -4, -2, 0, 2
      const isPast = daysOff < 0;
      const isToday = daysOff === 0;
      await prisma.dialysisSession.upsert({
        where: { id: sessId },
        update: {},
        create: {
          id: sessId,
          orderId,
          patientId: uid(P.PATIENT, dord.patientIdx),
          machineId: machineIds[di % machineIds.length],
          scheduledDate: day(daysOff),
          shift: shifts[di % 3],
          preWeight: isPast || isToday ? dord.dryWt + 2.5 : null,
          preTemp: isPast || isToday ? 36.5 : null,
          preBp: isPast || isToday ? '140/85' : null,
          preHr: isPast || isToday ? 78 : null,
          postWeight: isPast ? dord.dryWt + 0.3 : null,
          postTemp: isPast ? 36.3 : null,
          postBp: isPast ? '125/75' : null,
          postHr: isPast ? 72 : null,
          actualUf: isPast ? dord.uf : null,
          actualDuration: isPast ? dord.dur : null,
          ktV: isPast ? 1.4 + Math.random() * 0.3 : null,
          startTime: isPast || isToday ? new Date(day(daysOff).setHours(7 + di, 0, 0, 0)) : null,
          endTime: isPast ? new Date(day(daysOff).setHours(11 + di, 0, 0, 0)) : null,
          nurseId: dialysisNurseId,
          complications: isPast && si === 1 ? [{ type: '저혈압', time: '2시간', action: '생리식염수 200ml 주입' }] : undefined,
          status: isPast ? 'COMPLETED' : isToday ? 'IN_PROGRESS' : 'SCHEDULED',
          notes: isPast ? '투석 잘 진행됨' : null,
        },
      });
    }
  }
  console.log(`   - Dialysis machines: ${dialysisMachinesSeed.length}, orders: ${dialysisSeedOrders.length}, sessions: ${dialysisSeedOrders.length * 6}`);

  // ══════════════════════════════════════════════
  // 내부 코드 마스터 (검사항목/투여경로/진료과/수술마취)
  // ══════════════════════════════════════════════

  // ── 검사항목 코드 (LabTestCode) ──
  const labTestCodes = [
    // 혈액
    { code: 'L0001', loincCode: '26464-8', nameKo: 'CBC (전혈구검사)', nameEn: 'Complete Blood Count', category: '혈액', specimen: 'Blood', unit: '', refRangeMale: '', refRangeFemale: '', turnaround: 60, edi: 'E6541' },
    { code: 'L0002', loincCode: '6690-2', nameKo: 'WBC (백혈구)', nameEn: 'White Blood Cell Count', category: '혈액', specimen: 'Blood', unit: '/μL', refRangeMale: '4000-10000', refRangeFemale: '4000-10000', turnaround: 60, edi: 'E6541' },
    { code: 'L0003', loincCode: '718-7', nameKo: 'Hemoglobin (혈색소)', nameEn: 'Hemoglobin', category: '혈액', specimen: 'Blood', unit: 'g/dL', refRangeMale: '13.0-17.5', refRangeFemale: '12.0-16.0', turnaround: 60, edi: 'E6541' },
    { code: 'L0004', loincCode: '32623-1', nameKo: 'Platelet (혈소판)', nameEn: 'Platelet Count', category: '혈액', specimen: 'Blood', unit: '×10³/μL', refRangeMale: '150-400', refRangeFemale: '150-400', turnaround: 60, edi: 'E6541' },
    { code: 'L0005', loincCode: '4544-3', nameKo: 'Hematocrit (적혈구용적률)', nameEn: 'Hematocrit', category: '혈액', specimen: 'Blood', unit: '%', refRangeMale: '38-52', refRangeFemale: '36-48', turnaround: 60, edi: 'E6541' },
    // 생화학
    { code: 'L0101', loincCode: '2160-0', nameKo: 'Creatinine (크레아티닌)', nameEn: 'Creatinine', category: '생화학', specimen: 'Blood', unit: 'mg/dL', refRangeMale: '0.7-1.3', refRangeFemale: '0.6-1.1', turnaround: 90, edi: 'E6551' },
    { code: 'L0102', loincCode: '3094-0', nameKo: 'BUN (혈중요소질소)', nameEn: 'Blood Urea Nitrogen', category: '생화학', specimen: 'Blood', unit: 'mg/dL', refRangeMale: '8-20', refRangeFemale: '8-20', turnaround: 90, edi: 'E6551' },
    { code: 'L0103', loincCode: '1920-8', nameKo: 'AST (GOT)', nameEn: 'Aspartate Aminotransferase', category: '생화학', specimen: 'Blood', unit: 'IU/L', refRangeMale: '0-40', refRangeFemale: '0-35', turnaround: 90, edi: 'E6561' },
    { code: 'L0104', loincCode: '1742-6', nameKo: 'ALT (GPT)', nameEn: 'Alanine Aminotransferase', category: '생화학', specimen: 'Blood', unit: 'IU/L', refRangeMale: '0-41', refRangeFemale: '0-33', turnaround: 90, edi: 'E6561' },
    { code: 'L0105', loincCode: '2345-7', nameKo: 'Glucose (혈당)', nameEn: 'Glucose', category: '생화학', specimen: 'Blood', unit: 'mg/dL', refRangeMale: '70-110', refRangeFemale: '70-110', turnaround: 60, edi: 'E6571' },
    { code: 'L0106', loincCode: '4548-4', nameKo: 'HbA1c (당화혈색소)', nameEn: 'Hemoglobin A1c', category: '생화학', specimen: 'Blood', unit: '%', refRangeMale: '4.0-6.0', refRangeFemale: '4.0-6.0', turnaround: 120, edi: 'E6591' },
    { code: 'L0107', loincCode: '2093-3', nameKo: 'Total Cholesterol', nameEn: 'Total Cholesterol', category: '생화학', specimen: 'Blood', unit: 'mg/dL', refRangeMale: '<200', refRangeFemale: '<200', turnaround: 90, edi: 'E6581' },
    { code: 'L0108', loincCode: '1988-5', nameKo: 'CRP (C-반응성 단백)', nameEn: 'C-Reactive Protein', category: '생화학', specimen: 'Blood', unit: 'mg/dL', refRangeMale: '<0.5', refRangeFemale: '<0.5', turnaround: 90, edi: 'E6502' },
    { code: 'L0109', loincCode: '33762-6', nameKo: 'NT-proBNP', nameEn: 'N-terminal pro-BNP', category: '생화학', specimen: 'Blood', unit: 'pg/mL', refRangeMale: '<125', refRangeFemale: '<125', turnaround: 120, edi: '' },
    // 전해질
    { code: 'L0201', loincCode: '2951-2', nameKo: 'Na (나트륨)', nameEn: 'Sodium', category: '전해질', specimen: 'Blood', unit: 'mEq/L', refRangeMale: '136-145', refRangeFemale: '136-145', turnaround: 60, edi: 'E6512' },
    { code: 'L0202', loincCode: '2823-3', nameKo: 'K (칼륨)', nameEn: 'Potassium', category: '전해질', specimen: 'Blood', unit: 'mEq/L', refRangeMale: '3.5-5.0', refRangeFemale: '3.5-5.0', turnaround: 60, edi: 'E6512' },
    { code: 'L0203', loincCode: '17861-6', nameKo: 'Ca (칼슘)', nameEn: 'Calcium', category: '전해질', specimen: 'Blood', unit: 'mg/dL', refRangeMale: '8.6-10.2', refRangeFemale: '8.6-10.2', turnaround: 90, edi: 'E6512' },
    // 응고
    { code: 'L0301', loincCode: '5902-2', nameKo: 'PT (프로트롬빈시간)', nameEn: 'Prothrombin Time', category: '응고', specimen: 'Blood', unit: 'sec', refRangeMale: '11.0-13.5', refRangeFemale: '11.0-13.5', turnaround: 60, edi: 'E6532' },
    { code: 'L0302', loincCode: '3173-2', nameKo: 'aPTT', nameEn: 'Activated Partial Thromboplastin Time', category: '응고', specimen: 'Blood', unit: 'sec', refRangeMale: '25-35', refRangeFemale: '25-35', turnaround: 60, edi: 'E6532' },
    { code: 'L0303', loincCode: '6301-6', nameKo: 'INR', nameEn: 'International Normalized Ratio', category: '응고', specimen: 'Blood', unit: '', refRangeMale: '0.8-1.2', refRangeFemale: '0.8-1.2', turnaround: 60, edi: 'E6532' },
    // 소변
    { code: 'L0401', loincCode: '24356-8', nameKo: 'UA (일반뇨검사)', nameEn: 'Urinalysis', category: '소변', specimen: 'Urine', unit: '', refRangeMale: '', refRangeFemale: '', turnaround: 30, edi: 'E6601' },
    // 미생물
    { code: 'L0501', loincCode: '600-7', nameKo: '혈액배양검사', nameEn: 'Blood Culture', category: '미생물', specimen: 'Blood', unit: '', refRangeMale: 'Negative', refRangeFemale: 'Negative', turnaround: 4320, edi: 'E6701' },
    // 갑상선
    { code: 'L0601', loincCode: '3016-3', nameKo: 'TSH (갑상선자극호르몬)', nameEn: 'Thyroid Stimulating Hormone', category: '내분비', specimen: 'Blood', unit: 'μIU/mL', refRangeMale: '0.4-4.0', refRangeFemale: '0.4-4.0', turnaround: 120, edi: 'E6522' },
    // 심장표지자
    { code: 'L0701', loincCode: '49563-0', nameKo: 'Troponin-I', nameEn: 'Troponin I, Cardiac', category: '심장표지자', specimen: 'Blood', unit: 'ng/mL', refRangeMale: '<0.04', refRangeFemale: '<0.04', turnaround: 60, edi: '' },
    { code: 'L0702', loincCode: '2157-6', nameKo: 'CK-MB', nameEn: 'Creatine Kinase MB', category: '심장표지자', specimen: 'Blood', unit: 'ng/mL', refRangeMale: '<5.0', refRangeFemale: '<5.0', turnaround: 60, edi: '' },
    // ABG
    { code: 'L0801', loincCode: '2744-1', nameKo: 'ABG (동맥혈가스)', nameEn: 'Arterial Blood Gas', category: '혈액가스', specimen: 'Arterial Blood', unit: '', refRangeMale: 'pH 7.35-7.45', refRangeFemale: 'pH 7.35-7.45', turnaround: 15, edi: '' },
  ];

  for (const lt of labTestCodes) {
    await prisma.labTestCode.upsert({
      where: { code: lt.code },
      update: {},
      create: { code: lt.code, loincCode: lt.loincCode, nameKo: lt.nameKo, nameEn: lt.nameEn, category: lt.category, specimen: lt.specimen, unit: lt.unit, refRangeMale: lt.refRangeMale, refRangeFemale: lt.refRangeFemale, turnaroundMin: lt.turnaround, ediCode: lt.edi || null },
    });
  }
  console.log(`   - Lab test codes: ${labTestCodes.length}`);

  // ── 검사 기준치 마스터(ReferenceRange) — LabTestCode 26종에서 파생(멱등·source=seed) ──
  const parseRangeStr = (s?: string | null): { low: number | null; high: number | null; text: string | null } => {
    if (!s || !s.trim()) return { low: null, high: null, text: null };
    const t = s.trim();
    let m = t.match(/^(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)$/);
    if (m) return { low: parseFloat(m[1]), high: parseFloat(m[2]), text: null };
    m = t.match(/^[<≤]\s*(\d+(?:\.\d+)?)$/);
    if (m) return { low: null, high: parseFloat(m[1]), text: null };
    m = t.match(/^[>≥]\s*(\d+(?:\.\d+)?)$/);
    if (m) return { low: parseFloat(m[1]), high: null, text: null };
    return { low: null, high: null, text: t }; // 정성(예: Negative)
  };
  // 주요 전해질·혈당 위급역치(문헌 참고) — code 기준. 단위 명확한 항목만 보수적으로.
  const criticalByCode: Record<string, { criticalLow?: number; criticalHigh?: number }> = {
    L0201: { criticalLow: 120, criticalHigh: 160 }, // Na mEq/L
    L0202: { criticalLow: 2.8, criticalHigh: 6.5 }, // K mEq/L
    L0105: { criticalLow: 40, criticalHigh: 500 },  // Glucose mg/dL
  };
  for (const lt of labTestCodes) {
    const male = parseRangeStr(lt.refRangeMale);
    const female = parseRangeStr(lt.refRangeFemale);
    const crit = criticalByCode[lt.code] ?? {};
    await prisma.referenceRange.deleteMany({ where: { source: 'seed', testCode: lt.code } });
    const base = { testCode: lt.code, loincCode: lt.loincCode ?? null, testName: lt.nameKo, unit: lt.unit || null, source: 'seed', criticalLow: crit.criticalLow ?? null, criticalHigh: crit.criticalHigh ?? null };
    const same = male.low === female.low && male.high === female.high && male.text === female.text;
    const rows: Array<Record<string, unknown>> = [];
    const hasVal = (r: { low: number | null; high: number | null; text: string | null }) => r.low != null || r.high != null || r.text != null;
    if (same) {
      if (hasVal(male)) rows.push({ ...base, sex: 'ANY', low: male.low, high: male.high, textNormal: male.text });
    } else {
      if (hasVal(male)) rows.push({ ...base, sex: 'MALE', low: male.low, high: male.high, textNormal: male.text });
      if (hasVal(female)) rows.push({ ...base, sex: 'FEMALE', low: female.low, high: female.high, textNormal: female.text });
    }
    // 범위 문자열이 없어도 위급역치만 있는 경우 ANY 행 생성(전해질/혈당)
    if (rows.length === 0 && (crit.criticalLow != null || crit.criticalHigh != null)) {
      rows.push({ ...base, sex: 'ANY', low: null, high: null, textNormal: null });
    }
    if (rows.length) await prisma.referenceRange.createMany({ data: rows as never });
  }
  console.log(`   - Reference ranges seeded (from ${labTestCodes.length} lab codes)`);

  // ── 소아 연령대 기준치(Hemoglobin·WBC) — 연령 의존성이 크고 성인기준 오판정 위험이 큰 항목. ──
  // 🔴출처=표준 소아혈액학(Nelson 등) 근사치·source='ped-ref' — 병원 검사실이 자체 분석기/방법으로 검증·조정 필요.
  // 단위는 기존 LabTestCode와 일치(Hb g/dL·WBC /μL). 영아는 개월(ageMinMonths/Max) 정밀 매칭.
  const pedRanges = [
    // Hemoglobin L0003 (718-7, g/dL)
    { testCode: 'L0003', loincCode: '718-7', testName: 'Hemoglobin (소아)', unit: 'g/dL', ageMinMonths: 0, ageMaxMonths: 1, low: 14, high: 24 },
    { testCode: 'L0003', loincCode: '718-7', testName: 'Hemoglobin (소아)', unit: 'g/dL', ageMinMonths: 1, ageMaxMonths: 3, low: 10, high: 17 },
    { testCode: 'L0003', loincCode: '718-7', testName: 'Hemoglobin (소아)', unit: 'g/dL', ageMinMonths: 3, ageMaxMonths: 6, low: 9.5, high: 14.5 },
    { testCode: 'L0003', loincCode: '718-7', testName: 'Hemoglobin (소아)', unit: 'g/dL', ageMinMonths: 6, ageMaxMonths: 24, low: 9.5, high: 14 },
    { testCode: 'L0003', loincCode: '718-7', testName: 'Hemoglobin (소아)', unit: 'g/dL', ageMinYears: 2, ageMaxYears: 6, low: 11.5, high: 15.5 },
    { testCode: 'L0003', loincCode: '718-7', testName: 'Hemoglobin (소아)', unit: 'g/dL', ageMinYears: 6, ageMaxYears: 12, low: 11.5, high: 15.5 },
    { testCode: 'L0003', loincCode: '718-7', testName: 'Hemoglobin (청소년)', unit: 'g/dL', ageMinYears: 12, ageMaxYears: 18, low: 11.5, high: 16 },
    // WBC L0002 (6690-2, /μL) — 기존 성인 4000-10000과 단위 일치
    { testCode: 'L0002', loincCode: '6690-2', testName: 'WBC (소아)', unit: '/μL', ageMinMonths: 0, ageMaxMonths: 1, low: 9000, high: 30000 },
    { testCode: 'L0002', loincCode: '6690-2', testName: 'WBC (소아)', unit: '/μL', ageMinMonths: 1, ageMaxMonths: 12, low: 6000, high: 17500 },
    { testCode: 'L0002', loincCode: '6690-2', testName: 'WBC (소아)', unit: '/μL', ageMinYears: 1, ageMaxYears: 12, low: 5000, high: 15500 },
    { testCode: 'L0002', loincCode: '6690-2', testName: 'WBC (청소년)', unit: '/μL', ageMinYears: 12, ageMaxYears: 18, low: 4500, high: 13000 },
  ];
  await prisma.referenceRange.deleteMany({ where: { source: 'ped-ref' } });
  await prisma.referenceRange.createMany({ data: pedRanges.map((p) => ({ ...p, sex: 'ANY' as const, source: 'ped-ref' })) });
  console.log(`   - Pediatric reference ranges seeded (${pedRanges.length} age bands)`);

  // ── 약품 투여경로 (MedicationRoute) ──
  const medRoutes = [
    { code: 'PO', nameKo: '경구', nameEn: 'Per Oral', desc: '입으로 복용' },
    { code: 'IV', nameKo: '정맥주사', nameEn: 'Intravenous', desc: '정맥 내 주입' },
    { code: 'IM', nameKo: '근육주사', nameEn: 'Intramuscular', desc: '근육 내 주사' },
    { code: 'SC', nameKo: '피하주사', nameEn: 'Subcutaneous', desc: '피하 주사' },
    { code: 'ID', nameKo: '피내주사', nameEn: 'Intradermal', desc: '피내 주사' },
    { code: 'SL', nameKo: '설하', nameEn: 'Sublingual', desc: '혀 밑에 투여' },
    { code: 'INH', nameKo: '흡입', nameEn: 'Inhalation', desc: '호흡기를 통해 흡입' },
    { code: 'TOP', nameKo: '외용(도포)', nameEn: 'Topical', desc: '피부에 도포' },
    { code: 'OPH', nameKo: '점안', nameEn: 'Ophthalmic', desc: '눈에 점안' },
    { code: 'OT', nameKo: '점이', nameEn: 'Otic', desc: '귀에 점적' },
    { code: 'NAS', nameKo: '비강', nameEn: 'Nasal', desc: '코에 분무/점적' },
    { code: 'REC', nameKo: '직장', nameEn: 'Rectal', desc: '직장으로 투여 (좌약)' },
    { code: 'VAG', nameKo: '질', nameEn: 'Vaginal', desc: '질 내 투여' },
    { code: 'IT', nameKo: '경막내', nameEn: 'Intrathecal', desc: '척수강 내 주입' },
    { code: 'IA', nameKo: '관절내', nameEn: 'Intra-articular', desc: '관절 내 주사' },
    { code: 'IVPCA', nameKo: 'IV-PCA', nameEn: 'Patient-Controlled Analgesia', desc: '환자조절 진통법' },
    { code: 'TD', nameKo: '경피', nameEn: 'Transdermal', desc: '피부 패치를 통한 투여' },
    { code: 'NEG', nameKo: '네블라이저', nameEn: 'Nebulization', desc: '분무기를 통한 흡입' },
  ];

  for (const r of medRoutes) {
    await prisma.medicationRoute.upsert({
      where: { code: r.code },
      update: {},
      create: { code: r.code, nameKo: r.nameKo, nameEn: r.nameEn, description: r.desc },
    });
  }
  console.log(`   - Medication routes: ${medRoutes.length}`);

  // ── 진료과 코드 (DepartmentCode) ──
  const deptCodes = [
    // 임상 진료과
    { code: 'IM', nameKo: '내과', nameEn: 'Internal Medicine', cat: 'CLINICAL', sort: 1 },
    { code: 'GS', nameKo: '외과', nameEn: 'General Surgery', cat: 'CLINICAL', sort: 2 },
    { code: 'OS', nameKo: '정형외과', nameEn: 'Orthopedic Surgery', cat: 'CLINICAL', sort: 3 },
    { code: 'NS', nameKo: '신경외과', nameEn: 'Neurosurgery', cat: 'CLINICAL', sort: 4 },
    { code: 'PS', nameKo: '성형외과', nameEn: 'Plastic Surgery', cat: 'CLINICAL', sort: 5 },
    { code: 'PD', nameKo: '소아청소년과', nameEn: 'Pediatrics', cat: 'CLINICAL', sort: 6 },
    { code: 'OG', nameKo: '산부인과', nameEn: 'Obstetrics & Gynecology', cat: 'CLINICAL', sort: 7 },
    { code: 'NP', nameKo: '정신건강의학과', nameEn: 'Neuropsychiatry', cat: 'CLINICAL', sort: 8 },
    { code: 'EY', nameKo: '안과', nameEn: 'Ophthalmology', cat: 'CLINICAL', sort: 9 },
    { code: 'EN', nameKo: '이비인후과', nameEn: 'ENT (Otorhinolaryngology)', cat: 'CLINICAL', sort: 10 },
    { code: 'DM', nameKo: '피부과', nameEn: 'Dermatology', cat: 'CLINICAL', sort: 11 },
    { code: 'UR', nameKo: '비뇨의학과', nameEn: 'Urology', cat: 'CLINICAL', sort: 12 },
    { code: 'RM', nameKo: '재활의학과', nameEn: 'Rehabilitation Medicine', cat: 'CLINICAL', sort: 13 },
    { code: 'FM', nameKo: '가정의학과', nameEn: 'Family Medicine', cat: 'CLINICAL', sort: 14 },
    { code: 'EM', nameKo: '응급의학과', nameEn: 'Emergency Medicine', cat: 'CLINICAL', sort: 15 },
    { code: 'AN', nameKo: '마취통증의학과', nameEn: 'Anesthesiology', cat: 'CLINICAL', sort: 16 },
    { code: 'RO', nameKo: '방사선종양학과', nameEn: 'Radiation Oncology', cat: 'CLINICAL', sort: 17 },
    { code: 'DN', nameKo: '치과', nameEn: 'Dentistry', cat: 'CLINICAL', sort: 18 },
    // 내과 세부
    { code: 'IM-CV', nameKo: '순환기내과', nameEn: 'Cardiology', cat: 'CLINICAL', sort: 101, parent: 'IM' },
    { code: 'IM-PU', nameKo: '호흡기내과', nameEn: 'Pulmonology', cat: 'CLINICAL', sort: 102, parent: 'IM' },
    { code: 'IM-GI', nameKo: '소화기내과', nameEn: 'Gastroenterology', cat: 'CLINICAL', sort: 103, parent: 'IM' },
    { code: 'IM-EN', nameKo: '내분비내과', nameEn: 'Endocrinology', cat: 'CLINICAL', sort: 104, parent: 'IM' },
    { code: 'IM-NE', nameKo: '신장내과', nameEn: 'Nephrology', cat: 'CLINICAL', sort: 105, parent: 'IM' },
    { code: 'IM-HO', nameKo: '혈액종양내과', nameEn: 'Hematology-Oncology', cat: 'CLINICAL', sort: 106, parent: 'IM' },
    { code: 'IM-ID', nameKo: '감염내과', nameEn: 'Infectious Disease', cat: 'CLINICAL', sort: 107, parent: 'IM' },
    { code: 'IM-RH', nameKo: '류마티스내과', nameEn: 'Rheumatology', cat: 'CLINICAL', sort: 108, parent: 'IM' },
    // 의료지원
    { code: 'RD', nameKo: '영상의학과', nameEn: 'Radiology', cat: 'SUPPORT', sort: 201 },
    { code: 'PA', nameKo: '병리과', nameEn: 'Pathology', cat: 'SUPPORT', sort: 202 },
    { code: 'LM', nameKo: '진단검사의학과', nameEn: 'Laboratory Medicine', cat: 'SUPPORT', sort: 203 },
    { code: 'PH', nameKo: '약제과', nameEn: 'Pharmacy', cat: 'SUPPORT', sort: 204 },
    { code: 'NR', nameKo: '간호부', nameEn: 'Nursing', cat: 'SUPPORT', sort: 205 },
    { code: 'NU', nameKo: '영양과', nameEn: 'Nutrition', cat: 'SUPPORT', sort: 206 },
    // 행정
    { code: 'AD', nameKo: '원무과', nameEn: 'Administration', cat: 'ADMIN', sort: 301 },
    { code: 'MR', nameKo: '의무기록과', nameEn: 'Medical Records', cat: 'ADMIN', sort: 302 },
    { code: 'QI', nameKo: '질관리팀', nameEn: 'Quality Improvement', cat: 'ADMIN', sort: 303 },
    { code: 'IC', nameKo: '감염관리실', nameEn: 'Infection Control', cat: 'ADMIN', sort: 304 },
  ];

  for (const d of deptCodes) {
    await prisma.departmentCode.upsert({
      where: { code: d.code },
      update: {},
      create: { code: d.code, nameKo: d.nameKo, nameEn: d.nameEn, category: d.cat, parentCode: (d as any).parent ?? null, sortOrder: d.sort },
    });
  }
  console.log(`   - Department codes: ${deptCodes.length}`);

  // ── 수술/마취 코드 (SurgeryAnesthesiaCode) ──
  const surgAnesthCodes = [
    // 수술 유형
    { type: 'SURGERY_TYPE', code: 'MINOR', nameKo: '소수술', nameEn: 'Minor Surgery', desc: '국소마취 가능, 30분 이내', sort: 1 },
    { type: 'SURGERY_TYPE', code: 'MODERATE', nameKo: '중수술', nameEn: 'Moderate Surgery', desc: '전신/부분마취, 1~2시간', sort: 2 },
    { type: 'SURGERY_TYPE', code: 'MAJOR', nameKo: '대수술', nameEn: 'Major Surgery', desc: '전신마취, 2시간 이상', sort: 3 },
    { type: 'SURGERY_TYPE', code: 'EMERGENCY', nameKo: '응급수술', nameEn: 'Emergency Surgery', desc: '즉시 수술 필요', sort: 4 },
    // 마취 방법
    { type: 'ANESTHESIA_METHOD', code: 'GA', nameKo: '전신마취', nameEn: 'General Anesthesia', desc: '기관 삽관 + 전신마취', sort: 1 },
    { type: 'ANESTHESIA_METHOD', code: 'SA', nameKo: '척수마취', nameEn: 'Spinal Anesthesia', desc: '척수강 내 마취제 주입', sort: 2 },
    { type: 'ANESTHESIA_METHOD', code: 'EA', nameKo: '경막외마취', nameEn: 'Epidural Anesthesia', desc: '경막외 공간 마취', sort: 3 },
    { type: 'ANESTHESIA_METHOD', code: 'LA', nameKo: '국소마취', nameEn: 'Local Anesthesia', desc: '수술 부위 국소 마취', sort: 4 },
    { type: 'ANESTHESIA_METHOD', code: 'NB', nameKo: '신경차단', nameEn: 'Nerve Block', desc: '특정 신경 차단', sort: 5 },
    { type: 'ANESTHESIA_METHOD', code: 'MAC', nameKo: '감시마취', nameEn: 'Monitored Anesthesia Care', desc: '진정 + 국소마취 병행', sort: 6 },
    { type: 'ANESTHESIA_METHOD', code: 'TIVA', nameKo: '전정맥마취', nameEn: 'Total IV Anesthesia', desc: '정맥 약물로만 전신마취', sort: 7 },
    // ASA 분류
    { type: 'ASA_CLASS', code: 'I', nameKo: 'ASA I (건강)', nameEn: 'Healthy patient', desc: '정상 건강한 환자', sort: 1 },
    { type: 'ASA_CLASS', code: 'II', nameKo: 'ASA II (경증 전신질환)', nameEn: 'Mild systemic disease', desc: '경미한 전신질환', sort: 2 },
    { type: 'ASA_CLASS', code: 'III', nameKo: 'ASA III (중증 전신질환)', nameEn: 'Severe systemic disease', desc: '중증 전신질환, 일상활동 제한', sort: 3 },
    { type: 'ASA_CLASS', code: 'IV', nameKo: 'ASA IV (생명위협 전신질환)', nameEn: 'Life-threatening disease', desc: '생명을 위협하는 전신질환', sort: 4 },
    { type: 'ASA_CLASS', code: 'V', nameKo: 'ASA V (빈사 상태)', nameEn: 'Moribund patient', desc: '수술 없이는 생존 불가', sort: 5 },
    { type: 'ASA_CLASS', code: 'VI', nameKo: 'ASA VI (뇌사)', nameEn: 'Brain-dead organ donor', desc: '뇌사 장기기증 환자', sort: 6 },
    // 창상 분류
    { type: 'WOUND_CLASS', code: 'CLEAN', nameKo: '청결 (Clean)', nameEn: 'Clean', desc: '감염 없는 수술 창상', sort: 1 },
    { type: 'WOUND_CLASS', code: 'CLEAN_CONTAM', nameKo: '준청결 (Clean-contaminated)', nameEn: 'Clean-contaminated', desc: '소화/호흡/비뇨 생식기 포함', sort: 2 },
    { type: 'WOUND_CLASS', code: 'CONTAM', nameKo: '오염 (Contaminated)', nameEn: 'Contaminated', desc: '개방성 외상, 무균술 위반', sort: 3 },
    { type: 'WOUND_CLASS', code: 'DIRTY', nameKo: '불결/감염 (Dirty/Infected)', nameEn: 'Dirty/Infected', desc: '기존 감염, 천공 내장', sort: 4 },
  ];

  for (const sc of surgAnesthCodes) {
    await prisma.surgeryAnesthesiaCode.upsert({
      where: { codeType_code: { codeType: sc.type, code: sc.code } },
      update: {},
      create: { codeType: sc.type, code: sc.code, nameKo: sc.nameKo, nameEn: sc.nameEn, description: sc.desc, sortOrder: sc.sort },
    });
  }
  console.log(`   - Surgery/Anesthesia codes: ${surgAnesthCodes.length}`);

  // ══════════════════════════════════════════════
  // 표준 매핑 (TerminologyMapping) + 간호코드 + MedDRA
  // ══════════════════════════════════════════════

  // 진단코드 ID 조회 헬퍼
  const diagLookupMapping = async (code: string) => {
    const d = await prisma.diagnosisCode.findFirst({ where: { code, codeSystem: 'KCD-8' }, select: { id: true } });
    return d?.id;
  };

  // ── SNOMED CT 매핑 (주요 진단 40건) ──
  const snomedMappings = [
    { kcd: 'J06.9', snomed: '54150009', display: 'Upper respiratory infection' },
    { kcd: 'J00', snomed: '82272006', display: 'Common cold' },
    { kcd: 'J18.9', snomed: '233604007', display: 'Pneumonia' },
    { kcd: 'J45', snomed: '195967001', display: 'Asthma' },
    { kcd: 'I10', snomed: '59621000', display: 'Essential hypertension' },
    { kcd: 'I21', snomed: '22298006', display: 'Myocardial infarction' },
    { kcd: 'I50', snomed: '84114007', display: 'Heart failure' },
    { kcd: 'I63', snomed: '432504007', display: 'Cerebral infarction' },
    { kcd: 'E11', snomed: '44054006', display: 'Diabetes mellitus type 2' },
    { kcd: 'E10', snomed: '46635009', display: 'Diabetes mellitus type 1' },
    { kcd: 'K21', snomed: '235595009', display: 'Gastroesophageal reflux disease' },
    { kcd: 'K29.5', snomed: '4556007', display: 'Gastritis' },
    { kcd: 'K35', snomed: '74400008', display: 'Appendicitis' },
    { kcd: 'M54.5', snomed: '279039007', display: 'Low back pain' },
    { kcd: 'M17', snomed: '239873007', display: 'Osteoarthritis of knee' },
    { kcd: 'M51.1', snomed: '76107001', display: 'Lumbar disc herniation' },
    { kcd: 'F32', snomed: '35489007', display: 'Depressive disorder' },
    { kcd: 'C50', snomed: '254837009', display: 'Breast cancer' },
    { kcd: 'C34', snomed: '254637007', display: 'Lung cancer' },
    { kcd: 'N18.5', snomed: '46177005', display: 'End-stage renal disease' },
    { kcd: 'D50', snomed: '87522002', display: 'Iron deficiency anaemia' },
    { kcd: 'G81', snomed: '50582007', display: 'Hemiplegia' },
    { kcd: 'S72.0', snomed: '5913000', display: 'Fracture of neck of femur' },
    { kcd: 'C61', snomed: '399068003', display: 'Prostate cancer' },
    { kcd: 'C53', snomed: '363354003', display: 'Cervical cancer' },
    { kcd: 'D65', snomed: '67406007', display: 'Disseminated intravascular coagulation' },
    { kcd: 'N17', snomed: '14669001', display: 'Acute renal failure' },
    { kcd: 'E87.5', snomed: '14140009', display: 'Hyperkalaemia' },
    { kcd: 'R50', snomed: '386661006', display: 'Fever' },
    { kcd: 'A09', snomed: '25374005', display: 'Gastroenteritis' },
  ];

  let snomedCount = 0;
  for (const sm of snomedMappings) {
    const srcId = await diagLookupMapping(sm.kcd);
    if (!srcId) continue;
    await prisma.terminologyMapping.upsert({
      where: { sourceTable_sourceId_targetSystem_targetCode: { sourceTable: 'diagnosis_codes', sourceId: srcId, targetSystem: 'SNOMED_CT', targetCode: sm.snomed } },
      update: {},
      create: { sourceTable: 'diagnosis_codes', sourceId: srcId, sourceCode: sm.kcd, targetSystem: 'SNOMED_CT', targetCode: sm.snomed, targetDisplay: sm.display, equivalence: 'equivalent', mapSource: 'OFFICIAL' },
    });
    snomedCount++;
  }

  // 투여경로 SNOMED 매핑
  const routeMappings = [
    { code: 'PO', snomed: '26643006', display: 'Oral route' },
    { code: 'IV', snomed: '47625008', display: 'Intravenous route' },
    { code: 'IM', snomed: '78421000', display: 'Intramuscular route' },
    { code: 'SC', snomed: '34206005', display: 'Subcutaneous route' },
    { code: 'INH', snomed: '18679011000001101', display: 'Inhalation' },
    { code: 'TOP', snomed: '6064005', display: 'Topical route' },
    { code: 'REC', snomed: '37161004', display: 'Rectal route' },
    { code: 'OPH', snomed: '54485002', display: 'Ophthalmic route' },
  ];
  for (const rm of routeMappings) {
    const route = await prisma.medicationRoute.findUnique({ where: { code: rm.code }, select: { id: true } });
    if (!route) continue;
    await prisma.terminologyMapping.upsert({
      where: { sourceTable_sourceId_targetSystem_targetCode: { sourceTable: 'medication_routes', sourceId: route.id, targetSystem: 'SNOMED_CT', targetCode: rm.snomed } },
      update: {},
      create: { sourceTable: 'medication_routes', sourceId: route.id, sourceCode: rm.code, targetSystem: 'SNOMED_CT', targetCode: rm.snomed, targetDisplay: rm.display, equivalence: 'equivalent', mapSource: 'OFFICIAL' },
    });
    snomedCount++;
  }
  console.log(`   - SNOMED CT mappings: ${snomedCount}`);

  // ── LOINC 매핑 (LabTestCode → TerminologyMapping 이관) ──
  const allLabTests = await prisma.labTestCode.findMany({ where: { isActive: true, loincCode: { not: null } } });
  let loincMapCount = 0;
  for (const lt of allLabTests) {
    if (!lt.loincCode) continue;
    await prisma.terminologyMapping.upsert({
      where: { sourceTable_sourceId_targetSystem_targetCode: { sourceTable: 'lab_test_codes', sourceId: lt.id, targetSystem: 'LOINC', targetCode: lt.loincCode } },
      update: {},
      create: { sourceTable: 'lab_test_codes', sourceId: lt.id, sourceCode: lt.code, targetSystem: 'LOINC', targetCode: lt.loincCode, targetDisplay: lt.nameEn ?? lt.nameKo, equivalence: 'equivalent', mapSource: 'OFFICIAL' },
    });
    loincMapCount++;
  }
  console.log(`   - LOINC mappings: ${loincMapCount}`);

  // ── 수가코드 SNOMED CT 매핑 (주요 시술/처치) ──
  const procSnomedMap = [
    { edi: 'E6541', snomed: '26604007', display: 'Complete blood count' },
    { edi: 'E6561', snomed: '24613005', display: 'Liver function tests' },
    { edi: 'E6571', snomed: '33747003', display: 'Blood glucose measurement' },
    { edi: 'E6591', snomed: '43396009', display: 'Hemoglobin A1c measurement' },
    { edi: 'E6502', snomed: '55235003', display: 'C-reactive protein measurement' },
    { edi: 'HA011', snomed: '399208008', display: 'Chest X-ray' },
    { edi: 'HE101', snomed: '77477000', display: 'CT of head' },
    { edi: 'HE102', snomed: '169070004', display: 'CT of abdomen' },
    { edi: 'HI101', snomed: '241601008', display: 'MRI of brain' },
    { edi: 'HG101', snomed: '45036003', display: 'Ultrasonography of abdomen' },
    { edi: 'E6011', snomed: '29303009', display: 'Electrocardiographic procedure' },
    { edi: 'E7631', snomed: '386788005', display: 'Esophagogastroduodenoscopy' },
    { edi: 'E7651', snomed: '73761001', display: 'Colonoscopy' },
    { edi: 'Q2861', snomed: '80146002', display: 'Appendectomy' },
    { edi: 'MM111', snomed: '91251008', display: 'Physical therapy procedure' },
    { edi: 'MM121', snomed: '84478008', display: 'Occupational therapy' },
    { edi: 'MM131', snomed: '311555001', display: 'Speech therapy' },
    { edi: 'HD013', snomed: '441799006', display: 'Intensity modulated radiation therapy' },
    { edi: 'O7011', snomed: '302497006', display: 'Haemodialysis' },
    { edi: 'O7012', snomed: '233575001', display: 'Haemodiafiltration' },
    { edi: 'O7013', snomed: '238318009', display: 'Continuous renal replacement therapy' },
    { edi: 'X1001', snomed: '252296002', display: 'ABO blood grouping' },
    { edi: 'X1002', snomed: '252306009', display: 'Crossmatch' },
    { edi: 'X2001', snomed: '116863004', display: 'Transfusion of packed red cells' },
    { edi: 'FA011', snomed: '24623002', display: 'DEXA scan' },
  ];

  let procMapCount = 0;
  for (const pm of procSnomedMap) {
    // 🔴 `code` 는 단독 unique 가 아니다(2026-06-10 temporal 복합키) — 최신 유효본을 찾는다
    const proc = await prisma.procedureCode.findFirst({ where: { code: pm.edi }, orderBy: { validFrom: 'desc' }, select: { id: true } });
    if (!proc) continue;
    await prisma.terminologyMapping.upsert({
      where: { sourceTable_sourceId_targetSystem_targetCode: { sourceTable: 'procedure_codes', sourceId: proc.id, targetSystem: 'SNOMED_CT', targetCode: pm.snomed } },
      update: {},
      create: { sourceTable: 'procedure_codes', sourceId: proc.id, sourceCode: pm.edi, targetSystem: 'SNOMED_CT', targetCode: pm.snomed, targetDisplay: pm.display, equivalence: 'equivalent', mapSource: 'OFFICIAL' },
    });
    procMapCount++;
  }
  console.log(`   - Procedure→SNOMED mappings: ${procMapCount}`);

  // ── 약품코드 SNOMED CT 매핑 (주요 약물) ──
  const medSnomedMap = [
    { med: 'M010101', snomed: '387517004', display: 'Paracetamol' },
    { med: 'M010201', snomed: '387207008', display: 'Ibuprofen' },
    { med: 'M020101', snomed: '27658006', display: 'Amoxicillin' },
    { med: 'M020301', snomed: '372574004', display: 'Azithromycin' },
    { med: 'M030101', snomed: '387137007', display: 'Omeprazole' },
    { med: 'M040101', snomed: '373567002', display: 'Losartan' },
    { med: 'M040201', snomed: '386864001', display: 'Amlodipine' },
    { med: 'M040301', snomed: '373444002', display: 'Atorvastatin' },
    { med: 'M040401', snomed: '387458008', display: 'Aspirin' },
    { med: 'M050101', snomed: '109081006', display: 'Metformin' },
    { med: 'M070101', snomed: '372584003', display: 'Escitalopram' },
    { med: 'M099901', snomed: '387390002', display: 'Sodium chloride solution' },
    { med: 'M099903', snomed: '372670001', display: 'Ceftriaxone' },
    { med: 'M200101', snomed: '372877000', display: 'Heparin' },
    { med: 'M200201', snomed: '116508000', display: 'Erythropoietin' },
    { med: 'M300101', snomed: '387318005', display: 'Cisplatin' },
    { med: 'M300201', snomed: '373345002', display: 'Tamoxifen' },
    { med: 'M500301', snomed: '386845007', display: 'Gabapentin' },
  ];

  let medMapCount = 0;
  for (const mm of medSnomedMap) {
    const med = await prisma.medicationCode.findUnique({ where: { code: mm.med }, select: { id: true } });
    if (!med) continue;
    await prisma.terminologyMapping.upsert({
      where: { sourceTable_sourceId_targetSystem_targetCode: { sourceTable: 'medication_codes', sourceId: med.id, targetSystem: 'SNOMED_CT', targetCode: mm.snomed } },
      update: {},
      create: { sourceTable: 'medication_codes', sourceId: med.id, sourceCode: mm.med, targetSystem: 'SNOMED_CT', targetCode: mm.snomed, targetDisplay: mm.display, equivalence: 'equivalent', mapSource: 'OFFICIAL' },
    });
    medMapCount++;
  }
  console.log(`   - Medication→SNOMED mappings: ${medMapCount}`);

  // ── 수술/마취 코드 ICD-10-PCS 매핑 (주요 수술) ──
  const pcsMappings = [
    { source: 'procedure_codes', code: 'Q2861', pcs: '0DTJ4ZZ', display: 'Resection of Appendix, Percutaneous Endoscopic' },
    { source: 'procedure_codes', code: 'R4507', pcs: '10D00Z1', display: 'Extraction, Products of Conception, Classical' },
    { source: 'procedure_codes', code: 'N0601', pcs: '0QS60ZZ', display: 'Reposition Upper Femur, Open' },
    { source: 'procedure_codes', code: 'O7031', pcs: '031C0JF', display: 'Bypass Upper Arm Vein to Upper Arm Vein, Open, Synthetic Substitute' },
    { source: 'procedure_codes', code: 'O7032', pcs: '031D0JG', display: 'Bypass Upper Arm Artery to Upper Arm Vein, Open, Synthetic Substitute' },
  ];

  let pcsCount = 0;
  for (const pm of pcsMappings) {
    const proc = await prisma.procedureCode.findFirst({ where: { code: pm.code }, orderBy: { validFrom: 'desc' }, select: { id: true } });
    if (!proc) continue;
    await prisma.terminologyMapping.upsert({
      where: { sourceTable_sourceId_targetSystem_targetCode: { sourceTable: pm.source, sourceId: proc.id, targetSystem: 'ICD10PCS', targetCode: pm.pcs } },
      update: {},
      create: { sourceTable: pm.source, sourceId: proc.id, sourceCode: pm.code, targetSystem: 'ICD10PCS', targetCode: pm.pcs, targetDisplay: pm.display, equivalence: 'equivalent', mapSource: 'OFFICIAL' },
    });
    pcsCount++;
  }
  console.log(`   - ICD-10-PCS mappings: ${pcsCount}`);

  // ── NANDA-I 간호진단 (30건) ──
  const nandaCodes = [
    { code: '00155', nameKo: '낙상 위험', nameEn: 'Risk for falls', domain: '안전', cls: '신체손상', sort: 1 },
    { code: '00047', nameKo: '피부통합성 장애 위험', nameEn: 'Risk for impaired skin integrity', domain: '안전', cls: '신체손상', sort: 2 },
    { code: '00004', nameKo: '감염 위험', nameEn: 'Risk for infection', domain: '안전', cls: '감염', sort: 3 },
    { code: '00206', nameKo: '출혈 위험', nameEn: 'Risk for bleeding', domain: '안전', cls: '신체손상', sort: 4 },
    { code: '00085', nameKo: '신체 기동성 장애', nameEn: 'Impaired physical mobility', domain: '활동', cls: '활동/운동', sort: 5 },
    { code: '00108', nameKo: '자가간호 결핍: 목욕', nameEn: 'Bathing self-care deficit', domain: '활동', cls: '자가간호', sort: 6 },
    { code: '00109', nameKo: '자가간호 결핍: 옷입기', nameEn: 'Dressing self-care deficit', domain: '활동', cls: '자가간호', sort: 7 },
    { code: '00102', nameKo: '자가간호 결핍: 식사', nameEn: 'Feeding self-care deficit', domain: '활동', cls: '자가간호', sort: 8 },
    { code: '00002', nameKo: '영양 불균형: 필요량 이하', nameEn: 'Imbalanced nutrition: less than body requirements', domain: '영양', cls: '섭취', sort: 9 },
    { code: '00028', nameKo: '체액 부족 위험', nameEn: 'Risk for deficient fluid volume', domain: '영양', cls: '수분', sort: 10 },
    { code: '00195', nameKo: '전해질 불균형 위험', nameEn: 'Risk for electrolyte imbalance', domain: '영양', cls: '수분', sort: 11 },
    { code: '00016', nameKo: '배뇨 장애', nameEn: 'Impaired urinary elimination', domain: '배설', cls: '비뇨기능', sort: 12 },
    { code: '00011', nameKo: '변비', nameEn: 'Constipation', domain: '배설', cls: '위장기능', sort: 13 },
    { code: '00013', nameKo: '설사', nameEn: 'Diarrhea', domain: '배설', cls: '위장기능', sort: 14 },
    { code: '00032', nameKo: '비효과적 호흡양상', nameEn: 'Ineffective breathing pattern', domain: '호흡', cls: '호흡기능', sort: 15 },
    { code: '00031', nameKo: '비효과적 기도 청결', nameEn: 'Ineffective airway clearance', domain: '호흡', cls: '호흡기능', sort: 16 },
    { code: '00030', nameKo: '가스교환 장애', nameEn: 'Impaired gas exchange', domain: '호흡', cls: '호흡기능', sort: 17 },
    { code: '00029', nameKo: '심박출량 감소', nameEn: 'Decreased cardiac output', domain: '순환', cls: '심혈관기능', sort: 18 },
    { code: '00204', nameKo: '비효과적 말초조직 관류', nameEn: 'Ineffective peripheral tissue perfusion', domain: '순환', cls: '조직관류', sort: 19 },
    { code: '00128', nameKo: '급성 혼동', nameEn: 'Acute confusion', domain: '인지', cls: '인지', sort: 20 },
    { code: '00126', nameKo: '지식 부족', nameEn: 'Deficient knowledge', domain: '인지', cls: '인지', sort: 21 },
    { code: '00132', nameKo: '급성 통증', nameEn: 'Acute pain', domain: '통증', cls: '안위', sort: 22 },
    { code: '00133', nameKo: '만성 통증', nameEn: 'Chronic pain', domain: '통증', cls: '안위', sort: 23 },
    { code: '00146', nameKo: '불안', nameEn: 'Anxiety', domain: '심리', cls: '대처', sort: 24 },
    { code: '00148', nameKo: '공포', nameEn: 'Fear', domain: '심리', cls: '대처', sort: 25 },
    { code: '00046', nameKo: '피부통합성 장애', nameEn: 'Impaired skin integrity', domain: '피부', cls: '조직통합성', sort: 26 },
    { code: '00007', nameKo: '고체온증', nameEn: 'Hyperthermia', domain: '체온', cls: '체온조절', sort: 27 },
    { code: '00006', nameKo: '저체온증', nameEn: 'Hypothermia', domain: '체온', cls: '체온조절', sort: 28 },
    { code: '00136', nameKo: '슬픔', nameEn: 'Grieving', domain: '심리', cls: '대처', sort: 29 },
    { code: '00298', nameKo: '활동 지속성 장애', nameEn: 'Decreased activity tolerance', domain: '활동', cls: '활동/운동', sort: 30 },
  ];

  for (const nc of nandaCodes) {
    await prisma.nursingCode.upsert({
      where: { codeSystem_code: { codeSystem: 'NANDA_I', code: nc.code } },
      update: {},
      create: { codeSystem: 'NANDA_I', code: nc.code, nameKo: nc.nameKo, nameEn: nc.nameEn, domain: nc.domain, class: nc.cls, sortOrder: nc.sort },
    });
  }
  console.log(`   - NANDA-I codes: ${nandaCodes.length}`);

  // ── NIC 간호중재 (25건) ──
  const nicCodes = [
    { code: '6680', nameKo: '활력징후 모니터링', nameEn: 'Vital Signs Monitoring', domain: '기본간호', sort: 1 },
    { code: '0840', nameKo: '체위 변경', nameEn: 'Positioning', domain: '기본간호', sort: 2 },
    { code: '3320', nameKo: '산소요법', nameEn: 'Oxygen Therapy', domain: '기본간호', sort: 3 },
    { code: '3160', nameKo: '흡인 간호', nameEn: 'Airway Suctioning', domain: '기본간호', sort: 4 },
    { code: '2304', nameKo: '약물 투여: 경구', nameEn: 'Medication Administration: Oral', domain: '투약', sort: 5 },
    { code: '2314', nameKo: '약물 투여: 정맥', nameEn: 'Medication Administration: IV', domain: '투약', sort: 6 },
    { code: '4120', nameKo: '수혈 관리', nameEn: 'Fluid/Transfusion Management', domain: '투약', sort: 7 },
    { code: '1400', nameKo: '통증 관리', nameEn: 'Pain Management', domain: '통증', sort: 8 },
    { code: '1380', nameKo: '비약물적 통증 완화', nameEn: 'Nonpharmacological Pain Management', domain: '통증', sort: 9 },
    { code: '6490', nameKo: '낙상 예방', nameEn: 'Fall Prevention', domain: '안전', sort: 10 },
    { code: '3540', nameKo: '욕창 예방', nameEn: 'Pressure Ulcer Prevention', domain: '안전', sort: 11 },
    { code: '6580', nameKo: '억제대 적용', nameEn: 'Restraint Management', domain: '안전', sort: 12 },
    { code: '6540', nameKo: '감염 관리', nameEn: 'Infection Control', domain: '안전', sort: 13 },
    { code: '3660', nameKo: '상처 간호', nameEn: 'Wound Care', domain: '상처', sort: 14 },
    { code: '3440', nameKo: '드레싱 관리', nameEn: 'Incision Site Care', domain: '상처', sort: 15 },
    { code: '1160', nameKo: '영양 모니터링', nameEn: 'Nutritional Monitoring', domain: '영양', sort: 16 },
    { code: '5246', nameKo: '식이 상담', nameEn: 'Nutritional Counseling', domain: '영양', sort: 17 },
    { code: '0590', nameKo: '배뇨 관리', nameEn: 'Urinary Elimination Management', domain: '배설', sort: 18 },
    { code: '0430', nameKo: '장 관리', nameEn: 'Bowel Management', domain: '배설', sort: 19 },
    { code: '3140', nameKo: '기도 관리', nameEn: 'Airway Management', domain: '호흡', sort: 20 },
    { code: '5602', nameKo: '환자 교육: 질병 과정', nameEn: 'Teaching: Disease Process', domain: '교육', sort: 21 },
    { code: '7370', nameKo: '퇴원 계획', nameEn: 'Discharge Planning', domain: '교육', sort: 22 },
    { code: '5820', nameKo: '불안 감소', nameEn: 'Anxiety Reduction', domain: '심리', sort: 23 },
    { code: '2930', nameKo: '수술 전 간호', nameEn: 'Surgical Preparation', domain: '수술', sort: 24 },
    { code: '2870', nameKo: '수술 후 간호', nameEn: 'Postoperative Care', domain: '수술', sort: 25 },
  ];

  for (const nc of nicCodes) {
    await prisma.nursingCode.upsert({
      where: { codeSystem_code: { codeSystem: 'NIC', code: nc.code } },
      update: {},
      create: { codeSystem: 'NIC', code: nc.code, nameKo: nc.nameKo, nameEn: nc.nameEn, domain: nc.domain, sortOrder: nc.sort },
    });
  }
  console.log(`   - NIC codes: ${nicCodes.length}`);

  // ── MedDRA PT 코드 (부작용, 50건) ──
  const meddraCodes = [
    { code: '10028813', nameKo: '오심', nameEn: 'Nausea', domain: '위장관 장애' },
    { code: '10047700', nameKo: '구토', nameEn: 'Vomiting', domain: '위장관 장애' },
    { code: '10012735', nameKo: '설사', nameEn: 'Diarrhoea', domain: '위장관 장애' },
    { code: '10000486', nameKo: '복통', nameEn: 'Abdominal pain', domain: '위장관 장애' },
    { code: '10012727', nameKo: '변비', nameEn: 'Constipation', domain: '위장관 장애' },
    { code: '10042772', nameKo: '구내염', nameEn: 'Stomatitis', domain: '위장관 장애' },
    { code: '10019211', nameKo: '두통', nameEn: 'Headache', domain: '신경계 장애' },
    { code: '10013573', nameKo: '어지러움', nameEn: 'Dizziness', domain: '신경계 장애' },
    { code: '10037844', nameKo: '발진', nameEn: 'Rash', domain: '피부 장애' },
    { code: '10037087', nameKo: '소양증', nameEn: 'Pruritus', domain: '피부 장애' },
    { code: '10046735', nameKo: '두드러기', nameEn: 'Urticaria', domain: '피부 장애' },
    { code: '10001760', nameKo: '탈모', nameEn: 'Alopecia', domain: '피부 장애' },
    { code: '10002198', nameKo: '아나필락시스', nameEn: 'Anaphylactic reaction', domain: '면역 장애' },
    { code: '10016558', nameKo: '발열', nameEn: 'Pyrexia', domain: '전신 장애' },
    { code: '10016256', nameKo: '피로', nameEn: 'Fatigue', domain: '전신 장애' },
    { code: '10030124', nameKo: '부종', nameEn: 'Oedema', domain: '전신 장애' },
    { code: '10012378', nameKo: '기침', nameEn: 'Cough', domain: '호흡기 장애' },
    { code: '10013968', nameKo: '호흡곤란', nameEn: 'Dyspnoea', domain: '호흡기 장애' },
    { code: '10020772', nameKo: '저혈압', nameEn: 'Hypotension', domain: '혈관 장애' },
    { code: '10020112', nameKo: '고혈압', nameEn: 'Hypertension', domain: '혈관 장애' },
    { code: '10022891', nameKo: '불면증', nameEn: 'Insomnia', domain: '정신 장애' },
    { code: '10002855', nameKo: '식욕부진', nameEn: 'Decreased appetite', domain: '대사 장애' },
    { code: '10048580', nameKo: '혈소판감소증', nameEn: 'Thrombocytopenia', domain: '혈액 장애' },
    { code: '10033661', nameKo: '호중구감소증', nameEn: 'Neutropenia', domain: '혈액 장애' },
    { code: '10002034', nameKo: '빈혈', nameEn: 'Anaemia', domain: '혈액 장애' },
    { code: '10001367', nameKo: 'ALT 증가', nameEn: 'ALT increased', domain: '검사 이상' },
    { code: '10003481', nameKo: 'AST 증가', nameEn: 'AST increased', domain: '검사 이상' },
    { code: '10005364', nameKo: '크레아티닌 증가', nameEn: 'Blood creatinine increased', domain: '검사 이상' },
    { code: '10019233', nameKo: '두근거림', nameEn: 'Palpitations', domain: '심장 장애' },
    { code: '10047461', nameKo: '체중감소', nameEn: 'Weight decreased', domain: '검사 이상' },
    // 수혈 부작용
    { code: '10044655', nameKo: '수혈 반응', nameEn: 'Transfusion reaction', domain: '면역 장애' },
    { code: '10040047', nameKo: '용혈성 수혈반응', nameEn: 'Haemolytic transfusion reaction', domain: '혈액 장애' },
    { code: '10044653', nameKo: '수혈관련 급성폐손상(TRALI)', nameEn: 'Transfusion-related acute lung injury', domain: '호흡기 장애' },
    { code: '10044290', nameKo: '수혈관련 순환과부하(TACO)', nameEn: 'Transfusion-associated circulatory overload', domain: '심장 장애' },
  ];

  for (const md of meddraCodes) {
    await prisma.nursingCode.upsert({
      where: { codeSystem_code: { codeSystem: 'MedDRA', code: md.code } },
      update: {},
      create: { codeSystem: 'MedDRA', code: md.code, nameKo: md.nameKo, nameEn: md.nameEn, domain: md.domain, sortOrder: 0 },
    });
  }
  console.log(`   - MedDRA PT codes: ${meddraCodes.length}`);

  // ── ICF 코드 (재활 기능분류, 13건) ──
  const icfCodes = [
    { code: 'b730', nameKo: '근력 기능', nameEn: 'Muscle power functions', domain: '신체기능' },
    { code: 'b710', nameKo: '관절운동범위', nameEn: 'Mobility of joint functions', domain: '신체기능' },
    { code: 'b735', nameKo: '근긴장 기능', nameEn: 'Muscle tone functions', domain: '신체기능' },
    { code: 'b760', nameKo: '수의운동 조절', nameEn: 'Control of voluntary movement', domain: '신체기능' },
    { code: 'd450', nameKo: '걷기', nameEn: 'Walking', domain: '활동/참여' },
    { code: 'd410', nameKo: '자세 변경', nameEn: 'Changing basic body position', domain: '활동/참여' },
    { code: 'd510', nameKo: '씻기', nameEn: 'Washing oneself', domain: '활동/참여' },
    { code: 'd540', nameKo: '옷입기', nameEn: 'Dressing', domain: '활동/참여' },
    { code: 'd550', nameKo: '먹기', nameEn: 'Eating', domain: '활동/참여' },
    { code: 'd530', nameKo: '배변', nameEn: 'Toileting', domain: '활동/참여' },
    { code: 's750', nameKo: '하지 구조', nameEn: 'Structure of lower extremity', domain: '신체구조' },
    { code: 's720', nameKo: '어깨 구조', nameEn: 'Structure of shoulder region', domain: '신체구조' },
    { code: 'e120', nameKo: '이동 보조기구', nameEn: 'Products for personal indoor/outdoor mobility', domain: '환경인자' },
  ];

  for (const ic of icfCodes) {
    await prisma.nursingCode.upsert({
      where: { codeSystem_code: { codeSystem: 'ICF', code: ic.code } },
      update: {},
      create: { codeSystem: 'ICF', code: ic.code, nameKo: ic.nameKo, nameEn: ic.nameEn, domain: ic.domain, sortOrder: 0 },
    });
  }
  console.log(`   - ICF codes: ${icfCodes.length}`);

  // ── MedDRA TerminologyMapping (약품→부작용 매핑) ──
  const meddraMappings: { medCode: string; meddraCode: string; meddraDisplay: string }[] = [
    // 타이레놀 → 간독성/구역
    { medCode: 'M040702', meddraCode: '10001367', meddraDisplay: 'ALT increased' },
    { medCode: 'M040702', meddraCode: '10028813', meddraDisplay: 'Nausea' },
    // 부루펜 → 위장/두통
    { medCode: 'M040703', meddraCode: '10028813', meddraDisplay: 'Nausea' },
    { medCode: 'M040703', meddraCode: '10019211', meddraDisplay: 'Headache' },
    { medCode: 'M040703', meddraCode: '10000486', meddraDisplay: 'Abdominal pain' },
    // 아목시실린 → 발진/설사
    { medCode: 'M047801', meddraCode: '10037844', meddraDisplay: 'Rash' },
    { medCode: 'M047801', meddraCode: '10012735', meddraDisplay: 'Diarrhoea' },
    // 세파렉신 → 설사/구역
    { medCode: 'M047802', meddraCode: '10012735', meddraDisplay: 'Diarrhoea' },
    { medCode: 'M047802', meddraCode: '10028813', meddraDisplay: 'Nausea' },
    // 지스로맥스 → 설사/복통
    { medCode: 'M047803', meddraCode: '10012735', meddraDisplay: 'Diarrhoea' },
    { medCode: 'M047803', meddraCode: '10000486', meddraDisplay: 'Abdominal pain' },
    // 오메프라졸 → 두통/복통
    { medCode: 'M065201', meddraCode: '10019211', meddraDisplay: 'Headache' },
    { medCode: 'M065201', meddraCode: '10000486', meddraDisplay: 'Abdominal pain' },
    // 글루코파지(메트포르민) → 설사/구역
    { medCode: 'M082301', meddraCode: '10012735', meddraDisplay: 'Diarrhoea' },
    { medCode: 'M082301', meddraCode: '10028813', meddraDisplay: 'Nausea' },
    // 소론도(프레드니솔론) → 불면/고혈압
    { medCode: 'M085601', meddraCode: '10022891', meddraDisplay: 'Insomnia' },
    { medCode: 'M085601', meddraCode: '10020112', meddraDisplay: 'Hypertension' },
    // 셀레브렉스 → 부종/어지러움
    { medCode: 'M040705', meddraCode: '10030124', meddraDisplay: 'Oedema' },
    { medCode: 'M040705', meddraCode: '10013573', meddraDisplay: 'Dizziness' },
    // 넥시움 → 두통/구역
    { medCode: 'M065204', meddraCode: '10019211', meddraDisplay: 'Headache' },
    { medCode: 'M065204', meddraCode: '10028813', meddraDisplay: 'Nausea' },
    // 트라몰 → 어지러움/구역/변비
    { medCode: 'M040704', meddraCode: '10013573', meddraDisplay: 'Dizziness' },
    { medCode: 'M040704', meddraCode: '10028813', meddraDisplay: 'Nausea' },
    { medCode: 'M040704', meddraCode: '10012727', meddraDisplay: 'Constipation' },
    // 크라비트 → 설사/구역/어지러움
    { medCode: 'M047804', meddraCode: '10012735', meddraDisplay: 'Diarrhoea' },
    { medCode: 'M047804', meddraCode: '10013573', meddraDisplay: 'Dizziness' },
    // 지르텍 → 졸음/두통
    { medCode: 'M073101', meddraCode: '10019211', meddraDisplay: 'Headache' },
    { medCode: 'M073101', meddraCode: '10016256', meddraDisplay: 'Fatigue' },
    // 둘코락스 → 복통/설사
    { medCode: 'M065205', meddraCode: '10000486', meddraDisplay: 'Abdominal pain' },
    { medCode: 'M065205', meddraCode: '10012735', meddraDisplay: 'Diarrhoea' },
    // 아마릴 → 저혈당/어지러움
    { medCode: 'M082302', meddraCode: '10013573', meddraDisplay: 'Dizziness' },
    { medCode: 'M082302', meddraCode: '10028813', meddraDisplay: 'Nausea' },
  ];

  let meddraMapCount = 0;
  for (const mm of meddraMappings) {
    const med = await prisma.medicationCode.findFirst({ where: { code: mm.medCode as string, isActive: true } });
    if (!med) continue;
    await prisma.terminologyMapping.upsert({
      where: { sourceTable_sourceId_targetSystem_targetCode: { sourceTable: 'medication_codes', sourceId: med.id, targetSystem: 'MedDRA', targetCode: mm.meddraCode } },
      update: {},
      create: { sourceTable: 'medication_codes', sourceId: med.id, sourceCode: mm.medCode, targetSystem: 'MedDRA', targetCode: mm.meddraCode, targetDisplay: mm.meddraDisplay, equivalence: 'relatedto', mapSource: 'OFFICIAL' },
    });
    meddraMapCount++;
  }
  console.log(`   - MedDRA TerminologyMapping (약품→부작용): ${meddraMapCount}`);

  // ── ICF TerminologyMapping (재활수가→기능분류 매핑) ──
  const icfMappings: { procCode: string; icfCode: string; icfDisplay: string }[] = [
    { procCode: 'MM101', icfCode: 'b760', icfDisplay: 'Control of voluntary movement' },
    { procCode: 'MM111', icfCode: 'b730', icfDisplay: 'Muscle power functions' },
    { procCode: 'MM112', icfCode: 'b730', icfDisplay: 'Muscle power functions' },
    { procCode: 'MM121', icfCode: 'd510', icfDisplay: 'Washing oneself' },
    { procCode: 'MM122', icfCode: 'd540', icfDisplay: 'Dressing' },
    { procCode: 'MM131', icfCode: 'b760', icfDisplay: 'Control of voluntary movement' },
    { procCode: 'MM141', icfCode: 'd550', icfDisplay: 'Eating' },
    { procCode: 'MM201', icfCode: 'b710', icfDisplay: 'Mobility of joint functions' },
    { procCode: 'MM211', icfCode: 'b735', icfDisplay: 'Muscle tone functions' },
    { procCode: 'MM221', icfCode: 'd450', icfDisplay: 'Walking' },
    { procCode: 'MX221', icfCode: 'd450', icfDisplay: 'Walking' },
    { procCode: 'MX222', icfCode: 'd410', icfDisplay: 'Changing basic body position' },
  ];

  let icfMapCount = 0;
  for (const im of icfMappings) {
    const proc = await prisma.procedureCode.findFirst({ where: { code: im.procCode, isActive: true } });
    if (!proc) continue;
    await prisma.terminologyMapping.upsert({
      where: { sourceTable_sourceId_targetSystem_targetCode: { sourceTable: 'procedure_codes', sourceId: proc.id, targetSystem: 'ICF', targetCode: im.icfCode } },
      update: {},
      create: { sourceTable: 'procedure_codes', sourceId: proc.id, sourceCode: im.procCode, targetSystem: 'ICF', targetCode: im.icfCode, targetDisplay: im.icfDisplay, equivalence: 'relatedto', mapSource: 'OFFICIAL' },
    });
    icfMapCount++;
  }
  console.log(`   - ICF TerminologyMapping (재활수가→기능분류): ${icfMapCount}`);

  // ============================================================
  // CMS — DEPARTMENT 22개 + CENTER 5개 시드 데이터
  // ============================================================
  console.log('\n  [+] Seeding CMS Departments (22) + Centers (5)...');

  const cmsDeptItems = [
    { category: 'DEPARTMENT', slug: 'internal-medicine', title: '내과', content: '내과는 인체 내부 장기의 질환을 진단하고 치료하는 진료과입니다.\n\n순환기, 호흡기, 소화기, 내분비, 신장, 혈액종양, 감염, 류마티스 등 8개 세부전문분야를 운영하며, 각 분야 전문의가 체계적인 진료를 제공합니다.\n\n위루비병원 내과는 급성 질환의 신속한 진단부터 만성질환의 장기 관리까지, 환자의 전체 건강을 책임집니다. 다학제 진료(MDT)를 통해 복합 질환 환자에게 최적의 치료 계획을 수립합니다.', metadata: { departmentName: '내과', specialties: ['순환기내과', '호흡기내과', '소화기내과', '내분비내과', '신장내과', '혈액종양내과', '감염내과', '류마티스내과'], diseases: ['고혈압', '협심증/심근경색', '심부전', '부정맥', '천식/COPD', '폐렴', '위염/위궤양', '역류성식도염', '간경변/간염', '당뇨병', '갑상선질환', '만성신장병', '빈혈/백혈병', '류마티스관절염'], tests: ['심장초음파', '관상동맥 CT(CTA)', '위/대장 내시경', '복부 초음파', '갑상선 초음파', '폐기능 검사(PFT)', '24시간 심전도(Holter)', '운동부하 검사', '골수 검사', '신장 생검'], procedures: ['관상동맥 중재시술(PCI)', '심장 박동기 삽입술', '내시경적 용종 절제술', '간 동맥 색전술(TACE)', '혈액투석', '복막투석 카테터 삽입', '관절강내 주사', '흉강천자/복수천자'], equipment: ['심장초음파(3D)', '128채널 관상동맥 CT', '전자내시경(고해상)', '복부/갑상선 초음파', 'Holter 모니터', '폐기능 검사 장비'], highlights: [{ title: '8개 세부전문분야', desc: '순환기, 호흡기, 소화기, 내분비, 신장, 혈액종양, 감염, 류마티스 8개 분야의 전문의가 진료합니다' }, { title: '24시간 심혈관 응급', desc: '흉통/심근경색 환자를 위한 24시간 응급 심혈관 중재시술(PCI)이 가능합니다' }, { title: '다학제 통합 진료', desc: '복합 질환 환자를 위해 여러 전문분야가 함께 진료하는 다학제 진료(MDT)를 운영합니다' }, { title: '최신 내시경 시스템', desc: '고해상 전자내시경으로 조기 위암, 대장 용종 등을 정밀 진단하고 내시경적 치료를 시행합니다' }], schedule: { weekday: '09:00 ~ 18:00', saturday: '09:00 ~ 13:00', note: '전문분야별 진료 요일이 다를 수 있습니다. 예약 시 확인해주세요' }, location: '2층 외래진료실', phone: '내선 2100' }, sortOrder: 1, tags: ['내과', '순환기', '호흡기', '소화기', '내분비', '신장', '혈액종양'] },
    { category: 'DEPARTMENT', slug: 'surgery', title: '외과', content: '외과는 수술적 치료가 필요한 질환을 전문으로 합니다.\n\n복강경·로봇수술 등 최소침습수술을 적극 도입하여 환자의 빠른 회복을 돕고 있습니다.\n\n위루비병원 외과는 위암, 대장암, 간암, 유방암, 갑상선암 등 주요 암 수술과 탈장, 충수염, 담낭절제 등 일반외과 수술을 시행합니다.', metadata: { departmentName: '외과', specialties: ['위장관외과', '간담췌외과', '유방외과', '갑상선외과', '복강경수술'], diseases: ['위암', '대장암', '직장암', '간암', '담낭염/담석', '유방암', '갑상선암', '탈장', '충수염', '치질/치루'], tests: ['복부 CT', '복부 MRI', '대장내시경', '유방촬영(맘모)', '유방초음파', '갑상선 초음파/세침검사', '종양표지자(CEA/CA19-9)'], procedures: ['복강경 수술', '로봇 수술', '위절제술', '대장절제술', '간절제술', '유방보존술/절제술', '갑상선절제술', '담낭절제술(복강경)', '탈장교정술'], equipment: ['수술용 로봇(다빈치)', '복강경 장비', '초음파 절삭기(하모닉)'], highlights: [{ title: '최소침습 수술 중심', desc: '복강경·로봇 수술을 적극 도입하여 수술 상처를 최소화하고 빠른 회복을 돕습니다' }, { title: '다학제 암 진료', desc: '암센터와 협력하여 수술 전후 항암/방사선 치료를 포함한 최적의 치료 계획을 수립합니다' }, { title: '로봇 수술 1,000례+', desc: '다빈치 로봇을 활용한 정밀 수술 경험이 풍부합니다' }], schedule: { weekday: '09:00 ~ 18:00', saturday: '09:00 ~ 13:00', note: '수술일(화·목)은 외래 진료가 제한될 수 있습니다' }, location: '2층 외래진료실', phone: '내선 2200' }, sortOrder: 2, tags: ['외과', '수술', '복강경', '로봇수술'] },
    { category: 'DEPARTMENT', slug: 'orthopedics', title: '정형외과', content: '정형외과는 뼈, 관절, 근육, 인대 등 근골격계 질환을 진료합니다.\n\n관절경 수술, 인공관절 치환술, 척추수술, 골절 치료, 스포츠 손상 치료 등을 시행합니다.\n\n관절·척추센터와 협력하여 수술부터 재활까지 원스톱 치료를 제공합니다.', metadata: { departmentName: '정형외과', specialties: ['관절외과', '척추외과', '스포츠의학', '소아정형', '수부외과', '외상'], diseases: ['퇴행성 관절염', '류마티스 관절염', '반월상연골 파열', '십자인대 손상', '회전근개 파열', '오십견(동결견)', '허리디스크', '척추관 협착증', '골다공증성 골절', '골절(사지)', '손목터널증후군', '방아쇠손가락'], tests: ['X-ray', 'MRI (관절/척추)', 'CT', '골밀도 검사(DEXA)', '근전도 검사(EMG)', '초음파(근골격)'], procedures: ['인공관절 치환술(슬관절/고관절)', '관절경 수술(어깨/무릎)', '척추 감압·유합술', '골절 수술(관혈적 정복)', '인대 재건술', '회전근개 봉합술', '수근관 감압술', '체외충격파 치료'], equipment: ['관절경', '골밀도 측정기(DEXA)', 'C-arm', '수술 내비게이션', '초음파(MSK)'], highlights: [{ title: '인공관절 전문', desc: '무릎·고관절 인공관절 치환술 연간 200건 이상의 풍부한 경험' }, { title: '관절경 최소침습 수술', desc: '어깨·무릎 관절경으로 흉터 없는 정밀 수술' }, { title: '수술→재활 원스톱', desc: '관절·척추센터 재활의학과와 협력하여 수술 후 재활까지 통합 관리' }], schedule: { weekday: '09:00 ~ 18:00', saturday: '09:00 ~ 13:00', note: '수술일에는 외래 진료가 제한될 수 있습니다' }, location: '2층 외래진료실', phone: '내선 2300' }, sortOrder: 3, tags: ['정형외과', '관절', '골절', '척추', '인공관절'] },
    { category: 'DEPARTMENT', slug: 'pediatrics', title: '소아청소년과', content: '소아청소년과는 신생아부터 청소년(만 18세)까지 아이들의 건강을 전문으로 돌보는 진료과입니다.\n\n감염성 질환, 알레르기, 호흡기, 소화기, 성장발달, 내분비, 예방접종, 영양 상담 등 소아 전 분야를 진료합니다.', metadata: { departmentName: '소아청소년과', specialties: ['소아감염', '소아알레르기', '소아호흡기', '소아소화기', '소아내분비', '성장클리닉', '영유아검진'], diseases: ['급성 기관지염/폐렴', '중이염', '장염/구토', '아토피 피부염', '소아 천식', '식품 알레르기', '성장 부진', '소아 비만', '열성경련', '요로감염', '선천성 심장병', '소아 당뇨'], tests: ['소아 혈액검사', '알레르기 검사(MAST/SPT)', '소아 X-ray', '성장 호르몬 검사', '뼈 나이 검사(골연령)', '소아 초음파', '소변 검사', '영유아 발달 검사'], highlights: [{ title: '영유아 건강검진 지정기관', desc: '국가 영유아 건강검진(4개월~72개월)을 실시합니다' }, { title: '예방접종 전문', desc: '국가필수예방접종 및 선별접종 전 종류를 시행합니다' }, { title: '성장 클리닉', desc: '저신장, 성장 부진 아동의 정밀 진단과 성장 호르몬 치료를 제공합니다' }], schedule: { weekday: '09:00 ~ 18:00', saturday: '09:00 ~ 13:00', note: '영유아검진은 사전 예약 필수' }, location: '5층', phone: '내선 5100' }, sortOrder: 4, tags: ['소아과', '소아청소년과', '예방접종', '어린이', '성장'] },
    { category: 'DEPARTMENT', slug: 'obgyn', title: '산부인과', content: '산부인과는 여성의 임신, 출산, 부인과 질환을 전문으로 합니다.\n\n산전관리, 고위험 임신, 분만, 부인암, 자궁근종, 불임, 갱년기 진료를 제공합니다.\n\n산모와 태아의 안전을 최우선으로, 정상 분만부터 고위험 임신까지 체계적으로 관리합니다.', metadata: { departmentName: '산부인과', specialties: ['산과', '부인과종양', '생식내분비(불임)', '비뇨부인과', '갱년기'], diseases: ['자궁근종', '자궁내막증', '난소낭종', '자궁경부암', '자궁내막암', '난소암', '불임', '다낭성난소증후군', '자궁외임신', '갱년기증후군', '요실금', '임신성당뇨'], tests: ['산전 초음파(2D/3D/4D)', '태아 심음 검사(NST)', '자궁경부 세포검사(Pap)', 'HPV 검사', '유전자 검사(NIPT)', '호르몬 검사', '질확대경 검사(Colposcopy)', '골밀도 검사'], procedures: ['자연분만', '제왕절개', '복강경 자궁근종절제술', '자궁적출술(복강경)', '난관복원술', '인공수정(IUI)', '시험관아기(IVF)', '자궁경 수술'], highlights: [{ title: '24시간 분만 체계', desc: '산부인과 전문의와 마취과 전문의가 24시간 상주하여 안전한 분만을 보장합니다' }, { title: '고위험 임신 전문', desc: '임신성 당뇨, 전치태반, 쌍태임신 등 고위험 임신의 체계적 관리' }, { title: '여성 암 통합 진료', desc: '자궁경부암, 자궁내막암, 난소암의 진단부터 수술, 항암까지 통합 진료' }], schedule: { weekday: '09:00 ~ 18:00', saturday: '09:00 ~ 13:00', note: '분만실은 24시간 운영' }, location: '5층', phone: '내선 5200' }, sortOrder: 5, tags: ['산부인과', '임신', '출산', '부인암', '갱년기'] },
    { category: 'DEPARTMENT', slug: 'emergency-medicine', title: '응급의학과', content: '응급의학과는 365일 24시간 응급 환자를 신속하게 진료합니다.\n\nKTAS(한국형 응급환자 분류) 5단계 분류를 통해 중증도에 따른 치료 우선순위를 결정합니다. AI 트리아지 시스템으로 분류 정확도 98.7%를 달성했습니다.\n\n심근경색, 뇌졸중, 중증 외상 등 시간이 생명인 응급질환의 골든타임을 지킵니다.', metadata: { departmentName: '응급의학과', specialties: ['외상', '심정지 소생', '중독', '소아응급', '뇌졸중', '심혈관 응급'], diseases: ['급성 심근경색', '뇌졸중(뇌경색/뇌출혈)', '중증 외상', '급성 복통', '심정지', '호흡곤란', '약물/화학물질 중독', '소아 응급(열성경련/탈수)', '화상', '알레르기성 쇼크(아나필락시스)'], tests: ['응급 혈액검사(POCT)', '응급 CT/X-ray', '심전도(ECG)', '심장초음파(FAST)', '동맥혈가스 검사(ABGA)', '소변 약물 검사'], procedures: ['심폐소생술(CPR/ACLS)', '기관삽관', '흉관삽입', '중심정맥관 삽입', '골절 정복/부목', '창상 봉합', '위세척'], equipment: ['제세동기(AED)', '인공호흡기', '심장초음파(POCUS)', 'POCT 장비', '모니터링 시스템', '이동형 X-ray', '수혈 급속 주입기'], highlights: [{ title: '24시간 응급 진료', desc: '응급의학과 전문의가 24시간 상주하여 모든 응급 상황에 즉시 대응합니다' }, { title: 'AI 트리아지', desc: 'KTAS 5단계 분류를 AI가 보조하여 분류 정확도 98.7%, 치료 시작 12분 단축' }, { title: '심혈관 응급 핫라인', desc: '흉통/심근경색 환자를 위한 24시간 심혈관 중재시술(PCI) 직통 연계 체계' }, { title: '뇌졸중 골든타임', desc: '뇌졸중 의심 환자 도착→CT→치료 시작까지 60분 이내(Door-to-Treatment)' }], schedule: { weekday: '24시간', saturday: '24시간', note: '365일 24시간 운영. KTAS 분류에 따라 진료 순서가 결정됩니다' }, location: '1층 응급실', phone: '02-000-0119' }, sortOrder: 6, tags: ['응급', '응급실', '24시간', 'KTAS', '트리아지'] },
    { category: 'DEPARTMENT', slug: 'ophthalmology', title: '안과', content: '안과는 눈과 관련된 모든 질환을 진단하고 치료합니다.\n\n백내장, 녹내장, 망막질환, 사시, 굴절이상, 건성안, 각막질환 등을 진료합니다.', metadata: { departmentName: '안과', specialties: ['백내장', '녹내장', '망막', '각막', '사시/소아안과'], procedures: ['백내장 수술', '녹내장 수술', '망막 레이저', '유리체 수술'], equipment: ['OCT', '시야 검사기'], location: '2층 외래진료실', phone: '내선 2400' }, sortOrder: 7, tags: ['안과', '눈', '시력', '백내장', '녹내장'] },
    { category: 'DEPARTMENT', slug: 'ent', title: '이비인후과', content: '이비인후과는 귀, 코, 목의 질환을 전문으로 진료합니다.\n\n중이염, 부비동염(축농증), 편도 질환, 코골이/수면무호흡, 두경부 종양 등을 치료합니다.', metadata: { departmentName: '이비인후과', specialties: ['이과', '비과', '두경부외과', '음성언어'], procedures: ['편도절제술', '부비동 내시경 수술', '고막성형술'], location: '2층 외래진료실', phone: '내선 2500' }, sortOrder: 8, tags: ['이비인후과', '귀', '코', '코골이', '축농증'] },
    { category: 'DEPARTMENT', slug: 'dermatology', title: '피부과', content: '피부과는 피부, 모발, 손발톱 등의 질환을 진료합니다.\n\n습진, 아토피, 건선, 두드러기, 피부종양, 탈모, 여드름 등을 치료합니다.', metadata: { departmentName: '피부과', specialties: ['아토피/습진', '건선', '피부종양', '피부감염', '모발질환', '미용피부'], location: '2층 외래진료실', phone: '내선 2600' }, sortOrder: 9, tags: ['피부과', '아토피', '건선', '피부', '탈모'] },
    { category: 'DEPARTMENT', slug: 'psychiatry', title: '정신건강의학과', content: '정신건강의학과는 마음의 건강을 돌보는 진료과입니다.\n\n우울증, 불안장애, 수면장애, 공황장애, 조현병, 치매, ADHD, 중독 질환 등을 진료합니다.', metadata: { departmentName: '정신건강의학과', specialties: ['기분장애', '불안장애', '노인정신', '소아청소년정신', '중독', '수면'], location: '2층 외래진료실', phone: '내선 2700' }, sortOrder: 10, tags: ['정신과', '우울증', '불안', '수면', '심리'] },
    { category: 'DEPARTMENT', slug: 'rehabilitation', title: '재활의학과', content: '재활의학과는 질병이나 사고로 인한 기능 저하를 회복시킵니다.\n\n뇌졸중 재활, 척수손상 재활, 근골격 재활, 심폐재활 등을 시행합니다.', metadata: { departmentName: '재활의학과', specialties: ['뇌졸중재활', '척수재활', '근골격재활', '심폐재활', '소아재활'], equipment: ['보행 분석기', '근전도'], location: '6층', phone: '내선 6100' }, sortOrder: 11, tags: ['재활', '물리치료', '작업치료', '뇌졸중'] },
    { category: 'DEPARTMENT', slug: 'radiology', title: '영상의학과', content: '영상의학과는 X-ray, CT, MRI, 초음파 등 영상 검사를 통해 질병을 진단합니다.\n\n전문 판독의가 정확한 판독을 제공하며, 인터벤션(비수술 시술)도 시행합니다.', metadata: { departmentName: '영상의학과', specialties: ['복부영상', '흉부영상', '근골격영상', '신경영상', '인터벤션'], equipment: ['3T MRI', '128채널 CT', '디지털 혈관조영기'], location: '2층 영상의학과', phone: '내선 2800' }, sortOrder: 12, tags: ['영상의학', 'MRI', 'CT', '초음파', '판독'] },
    { category: 'DEPARTMENT', slug: 'dental', title: '치과', content: '치과는 구강 건강 전반을 관리합니다.\n\n충치 치료, 치주 치료, 임플란트, 보철, 교정, 구강외과 수술 등을 제공합니다.', metadata: { departmentName: '치과', specialties: ['보존', '보철', '치주', '구강외과', '교정', '소아치과'], procedures: ['임플란트', '치주수술', '사랑니 발치'], location: '2층 외래진료실', phone: '내선 2900' }, sortOrder: 13, tags: ['치과', '임플란트', '치주', '충치'] },
    { category: 'DEPARTMENT', slug: 'urology', title: '비뇨의학과', content: '비뇨의학과는 신장, 요관, 방광, 전립선 등의 질환을 전문으로 합니다.\n\n전립선비대증, 전립선암, 방광암, 신장결석, 요실금 등을 진료합니다.', metadata: { departmentName: '비뇨의학과', specialties: ['비뇨종양', '배뇨장애', '요로결석', '남성의학'], procedures: ['로봇 전립선절제술', '요관경 결석제거술'], location: '2층 외래진료실', phone: '내선 3000' }, sortOrder: 14, tags: ['비뇨기과', '전립선', '결석', '방광'] },
    { category: 'DEPARTMENT', slug: 'neurosurgery', title: '신경외과', content: '신경외과는 뇌, 척수, 말초신경의 질환을 수술적으로 치료합니다.\n\n뇌종양, 뇌혈관질환, 척추 디스크, 척추관 협착증, 두부 외상 등을 진료합니다.', metadata: { departmentName: '신경외과', specialties: ['뇌종양', '뇌혈관', '척추', '기능신경외과'], procedures: ['뇌종양 절제술', '뇌동맥류 결찰술', '척추 감압·유합술'], equipment: ['수술 내비게이션', '미세현미경'], location: '2층 외래진료실', phone: '내선 3100' }, sortOrder: 15, tags: ['신경외과', '뇌종양', '척추', '디스크'] },
    { category: 'DEPARTMENT', slug: 'family-medicine', title: '가정의학과', content: '가정의학과는 전인적 건강관리를 제공합니다.\n\n건강검진 상담, 만성질환 관리, 비만/금연 클리닉, 예방접종, 여행의학 등을 진료합니다.', metadata: { departmentName: '가정의학과', specialties: ['건강검진', '만성질환관리', '비만클리닉', '금연클리닉', '예방접종', '여행의학'], location: '2층 외래진료실', phone: '내선 3200' }, sortOrder: 16, tags: ['가정의학', '건강검진', '비만', '금연', '예방접종'] },
    { category: 'DEPARTMENT', slug: 'anesthesiology', title: '마취통증의학과', content: '마취통증의학과는 수술 마취와 통증 관리를 전문으로 합니다.\n\n수술 중 환자 안전 관리, 만성 통증 치료(신경차단술), 중환자실 관리를 담당합니다.', metadata: { departmentName: '마취통증의학과', specialties: ['전신마취', '부위마취', '통증클리닉', '중환자관리'], procedures: ['신경차단술', '경막외 주사', '고주파 열응고술'], location: '4층 수술실', phone: '내선 4100' }, sortOrder: 17, tags: ['마취', '통증', '수술마취', '신경차단'] },
    // ── 신규 5개 ──
    { category: 'DEPARTMENT', slug: 'plastic-surgery', title: '성형외과', content: '성형외과는 선천적·후천적 신체 변형의 교정과 재건을 전문으로 합니다.\n\n화상 재건, 유방 재건, 두개안면 기형 교정, 미세수술(유리피판술), 수부외과(손 외상/재접합), 안면 골절 치료 등을 시행합니다.', metadata: { departmentName: '성형외과', specialties: ['재건성형', '미세수술', '수부외과', '화상재건', '두개안면', '유방재건'], procedures: ['유리피판 재건술', '유방 재건술', '안면골절 정복술', '절단지 재접합술'], equipment: ['미세수술 현미경', '레이저 장비'], location: '2층 외래진료실', phone: '내선 3300' }, sortOrder: 18, tags: ['성형외과', '재건', '화상', '수부외과', '미세수술'] },
    { category: 'DEPARTMENT', slug: 'thoracic-surgery', title: '흉부외과', content: '흉부외과는 폐, 식도, 종격동, 심장, 대혈관 등 흉부 장기의 수술적 치료를 전문으로 합니다.\n\n폐암 수술, 관상동맥 우회술, 심장판막 수술, 흉강경(VATS) 수술 등을 시행합니다.', metadata: { departmentName: '흉부외과', specialties: ['폐·종격동', '식도외과', '심장외과', '대혈관외과'], procedures: ['흉강경(VATS) 폐엽절제술', '관상동맥 우회술(CABG)', '심장판막 치환/성형술'], equipment: ['흉강경', '체외순환기(인공심폐기)'], location: '2층 외래진료실', phone: '내선 3400' }, sortOrder: 19, tags: ['흉부외과', '폐암', '심장수술', '흉강경'] },
    { category: 'DEPARTMENT', slug: 'pathology', title: '병리과', content: '병리과는 조직검사, 세포검사, 동결절편 검사 등으로 질병을 정확하게 진단합니다.\n\n암의 정확한 진단과 치료 방침 결정에 핵심적인 역할을 합니다. 면역조직화학 검사, 분자병리(유전자) 검사도 시행합니다.', metadata: { departmentName: '병리과', specialties: ['외과병리', '세포병리', '분자병리', '혈액병리'], equipment: ['디지털 병리 스캐너', '면역조직화학 자동염색기', 'NGS'], location: '8층', phone: '내선 8100' }, sortOrder: 20, tags: ['병리과', '조직검사', '세포검사', '암진단', '분자병리'] },
    { category: 'DEPARTMENT', slug: 'laboratory-medicine', title: '진단검사의학과', content: '진단검사의학과는 혈액, 소변, 체액 등의 검체를 분석하여 질병을 진단합니다.\n\n일반혈액검사, 생화학검사, 면역혈청검사, 미생물배양검사, 수혈의학, 유전자검사 등을 수행합니다.', metadata: { departmentName: '진단검사의학과', specialties: ['임상화학', '혈액학', '미생물학', '면역혈청', '수혈의학', '분자유전'], equipment: ['자동화학분석기', '혈구분석기', '혈액배양기', '실시간 PCR'], location: '2층 검사실', phone: '내선 2810' }, sortOrder: 21, tags: ['검사실', '혈액검사', '생화학', '미생물', '수혈'] },
    { category: 'DEPARTMENT', slug: 'radiation-oncology', title: '방사선종양학과', content: '방사선종양학과는 방사선을 이용하여 암을 치료합니다.\n\n세기조절방사선치료(IMRT), 체부정위방사선치료(SBRT), 뇌정위방사선수술(SRS) 등 최신 기술을 적용합니다.', metadata: { departmentName: '방사선종양학과', specialties: ['두경부암', '폐암', '유방암', '소화기암', '비뇨기암'], procedures: ['IMRT', 'SBRT', 'SRS', '근접방사선치료'], equipment: ['선형가속기(LINAC)', 'CT 시뮬레이터'], location: '지하 1층', phone: '내선 9100' }, sortOrder: 22, tags: ['방사선', '방사선치료', '암치료', 'IMRT'] },
    // ── CENTER 5개 ──
    { category: 'CENTER', slug: 'cardiovascular-center', title: '심혈관센터', content: '심혈관센터는 순환기내과와 흉부외과가 협력하여 심장·혈관 질환의 통합 진료를 제공합니다.\n\n24시간 응급 심혈관 중재시술이 가능합니다.', metadata: { departments: ['순환기내과', '흉부외과'], location: '2층', phone: '내선 2150' }, sortOrder: 1, tags: ['심혈관', '심장', '심혈관센터'] },
    { category: 'CENTER', slug: 'cancer-center', title: '암센터', content: '암센터는 암의 진단, 수술, 항암, 방사선치료, 완화의료까지 통합적인 치료를 제공합니다.\n\n다학제 진료(MDT)를 통해 최적의 치료 계획을 수립합니다.', metadata: { departments: ['혈액종양내과', '외과', '방사선종양학과', '병리과'], location: '3층', phone: '내선 3150' }, sortOrder: 2, tags: ['암센터', '암', '항암', '다학제'] },
    { category: 'CENTER', slug: 'joint-spine-center', title: '관절·척추센터', content: '관절·척추센터는 정형외과와 재활의학과가 협력하여 수술부터 재활까지 원스톱 치료를 제공합니다.', metadata: { departments: ['정형외과', '재활의학과', '마취통증의학과'], location: '6층', phone: '내선 6150' }, sortOrder: 3, tags: ['관절', '척추', '관절센터'] },
    { category: 'CENTER', slug: 'checkup-center', title: '건강검진센터', content: '건강검진센터는 종합건강검진, 국가검진, 기업단체검진, 채용검진 등 다양한 프로그램을 운영합니다.', metadata: { departments: ['가정의학과', '영상의학과', '진단검사의학과'], location: '7층', phone: '내선 7100' }, sortOrder: 4, tags: ['건강검진', '검진센터', '종합검진'] },
    { category: 'CENTER', slug: 'dialysis-center', title: '인공신장센터(투석센터)', content: '인공신장센터는 만성 신부전 환자를 위한 혈액투석 서비스를 제공합니다.\n\n평일 주간·야간, 토요일 투석이 가능합니다.', metadata: { departments: ['신장내과'], location: '6층', phone: '내선 6200' }, sortOrder: 5, tags: ['투석', '투석센터', '인공신장'] },
  ];

  for (const item of cmsDeptItems) {
    await prisma.hospitalInfoContent.upsert({
      where: { category_slug: { category: item.category, slug: item.slug } },
      create: {
        category: item.category, slug: item.slug, title: item.title,
        content: item.content, metadata: item.metadata as any,
        sortOrder: item.sortOrder, tags: item.tags, createdBy: adminId,
      },
      update: {
        title: item.title, content: item.content,
        metadata: item.metadata as any, tags: item.tags, updatedBy: adminId,
      },
    });
  }
  console.log(`   - CMS Departments: ${cmsDeptItems.filter(i => i.category === 'DEPARTMENT').length}, Centers: ${cmsDeptItems.filter(i => i.category === 'CENTER').length}`);

  // ============================================================
  // CMS Phase 3 — NEWS, HEALTH_INFO, RECRUIT 시드 데이터
  // ============================================================
  console.log('\n  [+] Seeding CMS Phase 3 (News, Health Info, Recruit)...');

  const cmsPhase3Items = [
    // ── NEWS (뉴스/공지) ──
    { category: 'NEWS', slug: 'notice-parking-system', title: '주차 관제 시스템 개선 안내', content: '2026년 6월 1일부터 주차 관제 시스템이 업그레이드됩니다.\n\n주요 변경사항:\n- 차량번호 자동인식(LPR) 도입으로 주차권 불필요\n- 외래 진료 환자 2시간 무료 자동 적용\n- 전기차 충전구역 4대 → 8대 확대\n\n기존 주차권을 보유하신 분은 6월 30일까지 사용 가능합니다.', metadata: { subType: 'NOTICE', importance: 'HIGH', author: '시설관리팀' }, sortOrder: 1, tags: ['주차', '시설', '공지'], isPinned: true },
    { category: 'NEWS', slug: 'notice-summer-schedule', title: '2026년 여름 진료시간 변경 안내', content: '7~8월 하절기 진료시간을 안내드립니다.\n\n- 평일: 08:30~17:30 (기존 09:00~18:00)\n- 토요일: 08:30~12:30\n- 점심시간: 12:00~13:30\n\n쾌적한 진료 환경을 위해 협조 부탁드립니다.', metadata: { subType: 'NOTICE', importance: 'HIGH', author: '원무과' }, sortOrder: 2, tags: ['진료시간', '공지', '여름'] },
    { category: 'NEWS', slug: 'press-ai-triage', title: '[언론보도] 위루비병원, AI 트리아지 시스템 도입', content: '위루비병원이 인공지능 기반 응급환자 분류 시스템을 국내 최초로 도입했습니다.\n\nKTAS 5단계 분류를 AI가 보조하여 분류 정확도가 95%에서 98.7%로 향상되었으며, 중증 환자의 치료 시작 시간이 평균 12분 단축되었습니다.\n\n이 시스템은 WeRU.B Medical AI 플랫폼을 기반으로 개발되었습니다.', metadata: { subType: 'PRESS', importance: 'NORMAL', author: '홍보팀', sourceUrl: 'https://news.example.com/hospital-run-ai' }, sortOrder: 3, tags: ['AI', '응급', '언론', '트리아지'] },
    { category: 'NEWS', slug: 'press-emr-cert', title: '[언론보도] EMR 인증 최고 등급 획득', content: '위루비병원이 보건복지부 전자의무기록(EMR) 인증심사에서 최고 등급을 획득했습니다.\n\n총 351개 심사항목 중 348개 적합 판정을 받아 99.1%의 적합률을 기록했습니다. 특히 환자안전, 정보보호, 상호운용성 분야에서 높은 평가를 받았습니다.', metadata: { subType: 'PRESS', importance: 'NORMAL', author: '홍보팀' }, sortOrder: 4, tags: ['EMR', '인증', '언론'] },
    { category: 'NEWS', slug: 'event-health-festival', title: '2026 건강 페스티벌 개최 안내', content: '시민 건강증진을 위한 2026 건강 페스티벌을 개최합니다.\n\n일시: 2026년 7월 15일(수) 10:00~16:00\n장소: 병원 1층 로비 및 야외광장\n\n프로그램:\n- 무료 건강검진 (혈압, 혈당, 체성분)\n- 전문의 건강 상담\n- 심폐소생술(CPR) 체험\n- 건강 퀴즈 이벤트 (경품 증정)\n\n사전 예약 없이 누구나 참여 가능합니다.', metadata: { subType: 'EVENT', importance: 'NORMAL', author: '홍보팀' }, sortOrder: 5, tags: ['행사', '건강검진', '무료', '이벤트'] },
    { category: 'NEWS', slug: 'event-blood-donation', title: '사랑의 헌혈 행사', content: '대한적십자사와 함께하는 사랑의 헌혈 행사를 진행합니다.\n\n일시: 매월 셋째 주 수요일 10:00~16:00\n장소: 1층 로비 헌혈버스\n\n헌혈 참여자에게 감사 기념품을 드립니다.\n헌혈 전 충분한 수면과 식사를 부탁드립니다.', metadata: { subType: 'EVENT', importance: 'NORMAL', author: '혈액은행' }, sortOrder: 6, tags: ['헌혈', '행사', '적십자'] },
    { category: 'NEWS', slug: 'award-patient-safety', title: '환자안전 우수기관 인증 획득', content: '위루비병원이 의료기관평가인증원으로부터 환자안전 우수기관 인증을 획득했습니다.\n\n주요 평가 항목:\n- IPSG(국제환자안전목표) 6개 항목 전수 충족\n- 낙상예방 프로그램 운영\n- 투약안전 바코드 시스템\n- 감염관리 활동\n\n앞으로도 환자 안전을 최우선으로 하겠습니다.', metadata: { subType: 'AWARD', importance: 'NORMAL', author: '질관리팀' }, sortOrder: 7, tags: ['환자안전', '인증', '수상', 'IPSG'] },
    { category: 'NEWS', slug: 'notice-visitor-policy', title: '입원 환자 면회 시간 변경 안내', content: '환자 안정과 감염 예방을 위해 면회 시간을 조정합니다.\n\n변경된 면회 시간:\n- 일반병동: 18:00~20:00 (1일 1회)\n- 중환자실: 14:00~14:30, 19:00~19:30 (1일 2회, 보호자 2인)\n- 신생아실: 면회 제한 (유리창 면회)\n\n면회 시 손 소독 및 마스크 착용을 부탁드립니다.', metadata: { subType: 'NOTICE', importance: 'NORMAL', author: '간호부' }, sortOrder: 8, tags: ['면회', '입원', '감염관리'] },
    { category: 'NEWS', slug: 'press-robotic-surgery', title: '[언론보도] 로봇수술센터 1000례 달성', content: '위루비병원 로봇수술센터가 개소 3년 만에 수술 1,000례를 달성했습니다.\n\n주요 수술 분야:\n- 비뇨기과 전립선 수술 420건\n- 일반외과 대장암 수술 280건\n- 산부인과 자궁근종 수술 180건\n- 흉부외과 폐암 수술 120건\n\n로봇수술은 절개 부위를 최소화하여 회복이 빠르고 합병증이 적은 장점이 있습니다.', metadata: { subType: 'PRESS', importance: 'NORMAL', author: '홍보팀' }, sortOrder: 9, tags: ['로봇수술', '수술', '언론'] },
    { category: 'NEWS', slug: 'notice-app-update', title: '환자 포털 앱 업데이트 안내', content: '위루비병원 환자 포털 앱이 v2.0으로 업데이트되었습니다.\n\n새로운 기능:\n- AI 문진표: 채팅형 문진 작성\n- 실시간 대기현황 조회\n- 검사결과 푸시 알림\n- 원격진료 화상 상담\n- 건강검진 예약 및 결과 조회\n\n앱스토어/플레이스토어에서 업데이트해주세요.', metadata: { subType: 'NOTICE', importance: 'NORMAL', author: '정보전산팀' }, sortOrder: 10, tags: ['앱', '포털', '업데이트'] },

    // ── HEALTH_INFO (건강정보) ──
    { category: 'HEALTH_INFO', slug: 'hypertension-guide', title: '고혈압 관리 가이드', content: '고혈압은 성인 3명 중 1명이 앓는 흔한 질환입니다. 하지만 적절히 관리하면 합병증을 예방할 수 있습니다.\n\n정상 혈압: 수축기 120mmHg 미만 / 이완기 80mmHg 미만\n고혈압 전단계: 120-139 / 80-89\n1기 고혈압: 140-159 / 90-99\n2기 고혈압: 160 이상 / 100 이상\n\n생활 수칙:\n1. 소금 섭취 줄이기 (1일 6g 이하)\n2. 규칙적 유산소 운동 (주 5회, 30분)\n3. 적정 체중 유지\n4. 절주 및 금연\n5. 스트레스 관리\n6. 처방약 꾸준히 복용', metadata: { source: '대한고혈압학회' }, sortOrder: 1, tags: ['혈압', '심장', '만성질환', '예방'] },
    { category: 'HEALTH_INFO', slug: 'diabetes-prevention', title: '당뇨병 예방과 관리', content: '당뇨병은 혈당이 비정상적으로 높아지는 대사질환입니다.\n\n정상 공복혈당: 100mg/dL 미만\n당뇨 전단계: 100-125mg/dL\n당뇨병: 126mg/dL 이상 (2회 이상)\n\n위험 요인:\n- 가족력 (부모/형제 당뇨)\n- 비만 (BMI 25 이상)\n- 운동 부족\n- 45세 이상\n\n예방법:\n1. 식이 조절: 정제 탄수화물 줄이기\n2. 규칙적 운동: 주 150분 이상 중강도 운동\n3. 체중 감량: 5-7%만 줄여도 효과\n4. 정기 검진: 연 1회 공복혈당/당화혈색소 검사', metadata: { source: '대한당뇨병학회' }, sortOrder: 2, tags: ['당뇨', '혈당', '만성질환', '예방'] },
    { category: 'HEALTH_INFO', slug: 'cancer-screening', title: '국가암검진 프로그램 안내', content: '국민건강보험공단에서 시행하는 국가암검진 프로그램을 안내합니다.\n\n대상 암종 및 검진 주기:\n\n1. 위암: 만 40세 이상, 2년마다 위내시경\n2. 대장암: 만 50세 이상, 1년마다 분변잠혈검사 → 양성 시 대장내시경\n3. 간암: 만 40세 이상 고위험군, 6개월마다 초음파+혈액검사\n4. 유방암: 만 40세 이상 여성, 2년마다 유방촬영\n5. 자궁경부암: 만 20세 이상 여성, 2년마다 자궁경부세포검사\n6. 폐암: 만 54-74세 고위험 흡연자, 2년마다 저선량 CT\n\n검진비용: 본인부담 10% (건강보험 가입자)', metadata: { source: '국민건강보험공단' }, sortOrder: 3, tags: ['암', '검진', '국가검진', '예방'] },
    { category: 'HEALTH_INFO', slug: 'flu-prevention', title: '독감 예방접종 안내', content: '인플루엔자(독감)는 매년 겨울 유행하는 호흡기 감염질환입니다.\n\n예방접종 권장 대상:\n- 만 65세 이상 어르신\n- 생후 6개월~만 13세 어린이\n- 임산부\n- 만성질환자 (심장, 폐, 당뇨, 신장질환)\n- 의료기관 종사자\n\n접종 시기: 매년 10~11월 (유행 전)\n접종 후 항체 생성: 약 2주 소요\n효과 지속: 약 6개월\n\n접종 후 주의사항:\n- 접종 부위 통증/발적: 정상 반응 (2-3일 소실)\n- 발열 시 해열제 복용 가능\n- 접종 후 15분간 이상반응 관찰', metadata: { source: '질병관리청' }, sortOrder: 4, tags: ['독감', '예방접종', '호흡기', '겨울'] },
    { category: 'HEALTH_INFO', slug: 'back-pain', title: '허리 통증(요통) 예방과 관리', content: '요통은 전체 인구의 80%가 일생에 한 번은 경험하는 매우 흔한 증상입니다.\n\n원인:\n- 근육/인대 손상 (가장 흔함)\n- 디스크 탈출증\n- 척추관 협착증\n- 골다공증성 압박골절\n\n예방 수칙:\n1. 바른 자세 유지 (의자에 깊이 앉기)\n2. 1시간마다 스트레칭\n3. 무거운 물건 들 때 무릎 굽혀 들기\n4. 코어 근육 강화 운동\n5. 적정 체중 유지\n6. 딱딱한 매트리스 사용\n\n즉시 병원 방문이 필요한 경우:\n- 다리 저림/마비\n- 대소변 장애\n- 야간 통증 (잠을 깰 정도)\n- 외상 후 통증', metadata: { source: '대한정형외과학회' }, sortOrder: 5, tags: ['허리', '정형외과', '예방', '운동'] },
    { category: 'HEALTH_INFO', slug: 'mental-health', title: '우울증 조기 발견과 치료', content: '우울증은 뇌의 신경전달물질 불균형으로 발생하는 질환입니다. 의지의 문제가 아닌 치료가 필요한 질병입니다.\n\n주요 증상 (2주 이상 지속 시):\n- 지속적인 우울감/무기력\n- 흥미나 즐거움 상실\n- 수면 장애 (불면 또는 과수면)\n- 식욕 변화 (감소 또는 증가)\n- 집중력 저하\n- 자책감/무가치감\n- 반복적 죽음/자살 생각\n\n치료 방법:\n1. 약물치료: 항우울제 (효과까지 2-4주)\n2. 심리치료: 인지행동치료(CBT)\n3. 생활관리: 규칙적 운동, 충분한 수면\n\n정신건강 위기상담: 1577-0199 (24시간)', metadata: { source: '대한정신건강의학과학회' }, sortOrder: 6, tags: ['정신건강', '우울증', '심리', '상담'] },
    { category: 'HEALTH_INFO', slug: 'child-vaccination', title: '소아 예방접종 일정표', content: '영유아 필수 예방접종 일정을 안내합니다.\n\n출생 시: B형간염 1차, BCG(결핵)\n1개월: B형간염 2차\n2개월: DTaP 1차, IPV 1차, Hib 1차, PCV 1차, 로타바이러스 1차\n4개월: DTaP 2차, IPV 2차, Hib 2차, PCV 2차, 로타바이러스 2차\n6개월: DTaP 3차, B형간염 3차, IPV 3차, Hib 3차, PCV 3차, 인플루엔자\n12-15개월: MMR 1차, 수두, Hib 4차, PCV 4차, A형간염 1차\n18개월: DTaP 4차\n24개월: A형간염 2차, 일본뇌염\n\n※ 무료 접종: 보건소 및 지정 의료기관\n※ 접종 전 체온 확인 필수', metadata: { source: '질병관리청 예방접종도우미' }, sortOrder: 7, tags: ['소아', '예방접종', '영유아', '어린이'] },
    { category: 'HEALTH_INFO', slug: 'stroke-signs', title: '뇌졸중 위험 신호와 대처법', content: '뇌졸중은 뇌혈관이 막히거나(뇌경색) 터져서(뇌출혈) 발생합니다.\n골든타임 3시간 이내 치료가 매우 중요합니다.\n\nFAST 자가 체크법:\nF (Face): 얼굴 한쪽이 처진다\nA (Arm): 한쪽 팔에 힘이 없다\nS (Speech): 말이 어눌해진다\nT (Time): 즉시 119 신고!\n\n위험 요인:\n- 고혈압 (가장 중요)\n- 당뇨병\n- 심방세동\n- 흡연\n- 고지혈증\n- 비만\n\n예방법:\n1. 혈압 관리 (140/90 미만)\n2. 금연\n3. 절주 (1일 2잔 이하)\n4. 규칙적 운동\n5. 건강한 식단 (저염식, 채소 과일)', metadata: { source: '대한뇌졸중학회' }, sortOrder: 8, tags: ['뇌졸중', '응급', '심장', '예방'] },
    { category: 'HEALTH_INFO', slug: 'sleep-hygiene', title: '건강한 수면을 위한 습관', content: '성인의 적정 수면 시간은 7-9시간입니다. 수면의 질은 건강 전반에 큰 영향을 미칩니다.\n\n수면 위생 10가지 수칙:\n1. 매일 같은 시간에 자고 일어나기\n2. 침실은 어둡고 조용하게, 적정 온도(18-22도) 유지\n3. 취침 전 스마트폰/TV 사용 제한 (블루라이트 차단)\n4. 카페인 섭취는 오후 2시 이전까지만\n5. 취침 3시간 전 과식 금지\n6. 낮잠은 30분 이내\n7. 규칙적 운동 (취침 4시간 전 마무리)\n8. 알코올은 수면을 방해함 (잠드는 데는 도움, 깊은 수면 방해)\n9. 잠이 안 오면 억지로 눕지 말고 일어나기\n10. 걱정거리는 메모하고 내려놓기\n\n불면증이 1개월 이상 지속되면 전문의 상담을 권장합니다.', metadata: { source: '대한수면학회' }, sortOrder: 9, tags: ['수면', '불면증', '생활습관', '정신건강'] },
    { category: 'HEALTH_INFO', slug: 'healthy-diet', title: '건강한 식단 가이드', content: '균형 잡힌 식단은 만성질환 예방의 기본입니다.\n\n한국인 영양섭취기준 (성인):\n- 탄수화물: 55-65%\n- 단백질: 15-20%\n- 지방: 15-30%\n- 식이섬유: 25g 이상/일\n- 나트륨: 2,000mg 미만/일\n\n건강 식단 원칙:\n1. 매끼 잡곡밥 + 단백질 + 채소 3가지\n2. 과일은 하루 2회 (주먹 크기)\n3. 우유/유제품 매일 1잔\n4. 가공식품/인스턴트 줄이기\n5. 물 하루 8잔 (1.5-2L)\n6. 음식은 싱겁게, 조리 후 간하기\n\n질환별 식단 상담이 필요하시면 영양상담실로 예약해주세요.', metadata: { source: '대한영양학회' }, sortOrder: 10, tags: ['영양', '식단', '생활습관', '예방'] },

    // ── HEALTH_VIDEO (건강 TV) ──
    { category: 'HEALTH_VIDEO', slug: 'tv-hypertension', title: '고혈압, 이것만 알면 됩니다', content: '고혈압의 원인, 증상, 관리법을 알기 쉽게 설명합니다.', imageUrl: '/images/homepage/doctors/dept-internal-medicine.png', metadata: { videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', duration: '5:32', doctor: '김내과 교수 (순환기내과)', subType: 'EDUCATION' }, sortOrder: 1, tags: ['고혈압', '심장', '내과'] },
    { category: 'HEALTH_VIDEO', slug: 'tv-diabetes', title: '당뇨병 관리의 모든 것', content: '혈당 조절부터 식이요법까지, 당뇨병 관리의 핵심을 전합니다.', imageUrl: '/images/homepage/doctors/dept-family-medicine.png', metadata: { videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', duration: '8:15', doctor: '서내분비 교수 (내분비내과)', subType: 'EDUCATION' }, sortOrder: 2, tags: ['당뇨', '내분비', '식이'] },
    { category: 'HEALTH_VIDEO', slug: 'tv-checkup-guide', title: '건강검진 완벽 가이드', content: '검진 전 준비사항부터 결과 해석까지 한번에 알아보세요.', imageUrl: '/images/homepage/checkup/checkup-program.png', metadata: { videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', duration: '12:03', doctor: '황가정 교수 (가정의학과)', subType: 'GUIDE' }, sortOrder: 3, tags: ['건강검진', '가정의학', '예방'] },
    { category: 'HEALTH_VIDEO', slug: 'tv-brain-health', title: '뇌 건강을 지키는 5가지 습관', content: '치매 예방과 뇌 건강 유지를 위한 생활 수칙입니다.', imageUrl: '/images/homepage/centers/center-cardiovascular.png', metadata: { videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', duration: '7:45', doctor: '백신경 교수 (신경과)', subType: 'EDUCATION' }, sortOrder: 4, tags: ['뇌과학', '치매', '예방'] },
    { category: 'HEALTH_VIDEO', slug: 'tv-skin-care', title: '피부 건강과 자외선 차단', content: '가상의 강한 자외선으로부터 피부를 보호하는 방법입니다.', imageUrl: '/images/homepage/doctors/dept-dermatology.png', metadata: { videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', duration: '6:20', doctor: '노피부 교수 (피부과)', subType: 'EDUCATION' }, sortOrder: 5, tags: ['피부', '자외선', '예방'] },
    { category: 'HEALTH_VIDEO', slug: 'tv-cell-therapy', title: '세포치료란 무엇인가', content: '줄기세포 기반 치료의 원리와 적용 분야를 소개합니다.', imageUrl: '/images/homepage/banners/banner-1.png', metadata: { videoUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ', duration: '10:30', doctor: '위루비병원 세포치료센터', subType: 'SPECIAL' }, sortOrder: 6, tags: ['세포치료', '줄기세포', '특성화'] },

    // ── RECRUIT (채용정보) ──
    { category: 'RECRUIT', slug: 'recruit-nurse-ward', title: '병동 간호사 채용', content: '내과/외과 병동 간호사를 모집합니다.\n\n근무 형태: 3교대 (Day/Evening/Night)\n채용 인원: 5명\n\n주요 업무:\n- 입원 환자 간호 및 활력징후 측정\n- 의사 처방에 따른 투약 및 처치\n- 환자/보호자 교육\n- 간호 기록 작성 (EMR)\n\n우대사항:\n- 종합병원 2년 이상 근무자\n- BLS/ACLS 자격증 소지자\n- 전자의무기록(EMR) 사용 경험자', metadata: { position: '간호사', department: '내과/외과 병동', employmentType: 'FULL_TIME', requirements: ['간호사 면허 소지자', '신규 및 경력 모두 지원 가능', '3교대 근무 가능자'], benefits: ['4대보험', '직원식 제공', '교육비 지원', '자녀 학자금', '경조사 지원', '직원 건강검진'], deadline: '2026-07-31', contactEmail: 'hr@hospital.example.org', status: 'OPEN' }, sortOrder: 1, tags: ['간호사', '병동', '채용', '정규직'], isPinned: true },
    { category: 'RECRUIT', slug: 'recruit-radiologist', title: '영상의학과 전문의 채용', content: '영상의학과 전문의를 모집합니다.\n\n채용 인원: 1명\n\n주요 업무:\n- CT/MRI/초음파 판독\n- 인터벤션(중재시술)\n- 영상의학과 전공의 지도\n- 학술 연구 활동\n\n진료 분야:\n- 복부/흉부 영상\n- 근골격 영상\n- 신경 영상\n- 인터벤션', metadata: { position: '전문의', department: '영상의학과', employmentType: 'FULL_TIME', requirements: ['영상의학과 전문의 자격증', '3년 이상 판독 경험 우대', 'PACS 시스템 사용 능숙'], benefits: ['4대보험', '학회 참가비 지원', '연구비 지원', '직원 건강검진', '주택자금 대출'], deadline: '2026-08-31', contactEmail: 'hr@hospital.example.org', status: 'OPEN' }, sortOrder: 2, tags: ['의사', '영상의학', '전문의', '채용'] },
    { category: 'RECRUIT', slug: 'recruit-admin-it', title: 'IT 전산팀 시스템 엔지니어 채용', content: '위루비병원 정보전산팀 시스템 엔지니어를 모집합니다.\n\n채용 인원: 2명\n\n주요 업무:\n- EMR/HIS 시스템 운영 및 유지보수\n- 서버/네트워크 인프라 관리\n- 정보보안 관리 (ISMS 인증 대응)\n- 의료정보 시스템 도입/연동\n- 사용자 기술 지원\n\n기술 스택:\n- Linux, Docker, PostgreSQL\n- Next.js, NestJS (EMR 시스템)\n- HL7 FHIR, DICOM 연동 경험 우대', metadata: { position: '시스템 엔지니어', department: '정보전산팀', employmentType: 'FULL_TIME', requirements: ['컴퓨터공학/정보통신 관련 학과 졸업', 'Linux 서버 관리 경험 2년 이상', 'RDBMS(PostgreSQL/MySQL) 운영 경험'], benefits: ['4대보험', '자기개발비 지원', '재택근무 일부 가능', '직원 건강검진', '통신비 지원'], deadline: '2026-07-15', contactEmail: 'hr@hospital.example.org', status: 'OPEN' }, sortOrder: 3, tags: ['IT', '전산', '엔지니어', '채용'] },
  ];

  for (const item of cmsPhase3Items) {
    await prisma.hospitalInfoContent.upsert({
      where: { category_slug: { category: item.category, slug: item.slug } },
      create: {
        category: item.category,
        slug: item.slug,
        title: item.title,
        content: item.content,
        metadata: item.metadata as any,
        sortOrder: item.sortOrder,
        tags: item.tags,
        isPinned: (item as any).isPinned ?? false,
        createdBy: adminId,
      },
      update: {
        title: item.title,
        content: item.content,
        metadata: item.metadata as any,
        tags: item.tags,
        isPinned: (item as any).isPinned ?? false,
        updatedBy: adminId,
      },
    });
  }
  console.log(`   - CMS Phase 3: ${cmsPhase3Items.length} items (NEWS ${cmsPhase3Items.filter(i => i.category === 'NEWS').length}, HEALTH_INFO ${cmsPhase3Items.filter(i => i.category === 'HEALTH_INFO').length}, RECRUIT ${cmsPhase3Items.filter(i => i.category === 'RECRUIT').length})`);

  // ============================================================
  // CMS 홈페이지 — CHECKUP_INFO, CSR, VOC, BANNER, GENERAL 추가
  // ============================================================
  console.log('\n  [+] Seeding CMS Homepage (CHECKUP_INFO, CSR, VOC, BANNER, GENERAL)...');

  const cmsHomepageItems = [
    // ── GENERAL 추가 3건 ──
    { category: 'GENERAL', slug: 'ceo-greeting', title: '원장 인사말', content: '안녕하십니까. 위루비병원을 찾아주셔서 감사합니다.\n\n위루비병원은 "Care Today, Ready for Tomorrow"라는 비전 아래, 정확한 진단으로 오늘의 병을 치료하고 정밀한 예측으로 내일의 병을 예방하는 미래 의료를 실현하고 있습니다.\n\n세포치료, 유전자분석, 뇌과학, 항노화 등 최첨단 특성화 센터를 운영하며, 가상의 청정 자연환경 속에서 환자 한 분 한 분께 최상의 의료 서비스를 제공하겠습니다.\n\n감사합니다.\n\n위루비병원 원장', metadata: { pageType: 'SINGLE' }, sortOrder: 0, tags: ['원장', '인사말', '비전', '병원소개'] },
    { category: 'GENERAL', slug: 'history', title: '병원 연혁', content: '2020년 3월 — 위루비병원 개원 (100병상)\n2020년 9월 — 건강검진센터 개설\n2021년 3월 — 심혈관센터 개소\n2021년 9월 — EMR 시스템 도입\n2022년 3월 — 200병상 증축 완료\n2022년 9월 — 암센터 개소\n2023년 3월 — 로봇수술센터 개설\n2023년 9월 — 관절·척추센터 개소\n2024년 3월 — AI 트리아지 시스템 도입\n2024년 9월 — 인공신장센터(투석센터) 개설\n2025년 3월 — EMR 인증 최고 등급 획득\n2025년 9월 — 환자안전 우수기관 인증\n2026년 3월 — AI 진료보조 시스템 가동\n2026년 5월 — 병원 홈페이지 CMS 고도화', metadata: { pageType: 'SINGLE' }, sortOrder: 1, tags: ['연혁', '역사', '병원소개'] },
    { category: 'GENERAL', slug: 'directions', title: '오시는 길', content: '위루비병원은 가상특별자치도 가상시 가상로 126에 위치해 있습니다.\n\n■ 가상 본원\n주소: 가상특별자치도 가상시 가상로 126\n전화: 02-000-0000\n\n■ 서울 사무소\n주소: 서울특별시 가상구 가상로 1 가상 빌딩 5층\n\n■ 교통 안내\n• 가상공항에서: 공항리무진 000번 → 가상관광단지 하차 → 택시 10분 (약 50분 소요)\n• 가상시외버스터미널: 택시 15분\n• 자가용: 가상공항에서 평화로(1135) 이용 약 45분\n• 병원 주차장 무료 이용 가능', metadata: { pageType: 'SINGLE', contactInfo: { address: '가상특별자치도 가상시 가상로 126', phone: '02-000-0000', fax: '02-000-1001' }, mapCoords: { lat: 33.253, lng: 126.510 } }, sortOrder: 3, tags: ['오시는길', '위치', '주소', '교통'] },
    { category: 'GENERAL', slug: 'organization', title: '조직도', content: '병원장\n├── 진료부\n│   ├── 내과 (8개 세부전문과)\n│   ├── 외과\n│   ├── 정형외과\n│   ├── 소아청소년과\n│   ├── 산부인과\n│   ├── 응급의학과\n│   ├── 안과 / 이비인후과 / 피부과\n│   ├── 정신건강의학과\n│   ├── 재활의학과 / 영상의학과\n│   ├── 치과 / 비뇨의학과 / 신경외과\n│   ├── 성형외과 / 흉부외과\n│   ├── 병리과 / 진단검사의학과\n│   ├── 방사선종양학과\n│   └── 가정의학과 / 마취통증의학과\n├── 간호부\n│   ├── 병동 간호팀\n│   ├── 외래 간호팀\n│   ├── 수술실 간호팀\n│   └── 응급실 간호팀\n├── 행정부\n│   ├── 원무과\n│   ├── 인사팀\n│   ├── 재무팀\n│   └── 정보전산팀\n├── 진료지원부\n│   ├── 약제과\n│   ├── 영양과\n│   ├── 의무기록과\n│   └── 중앙공급실(CSSD)\n└── 경영지원부\n    ├── 시설관리팀\n    ├── 홍보팀\n    └── 질관리팀(QI)', metadata: { pageType: 'SINGLE' }, sortOrder: 2, tags: ['조직도', '조직', '병원소개'] },

    // ── CHECKUP_INFO 6건 ──
    { category: 'CHECKUP_INFO', slug: 'checkup-program-a', title: '종합건강검진 A형 (기본)', content: '기본적인 건강 상태를 확인하는 종합검진 프로그램입니다.\n\n검사 항목:\n- 신체계측 (신장, 체중, 체성분, 혈압)\n- 혈액검사 40종 (간기능, 신장기능, 혈당, 지질, 갑상선, 종양표지자)\n- 소변검사, 대변검사\n- 흉부 X-ray\n- 심전도\n- 복부 초음파\n- 위내시경 (수면 선택)\n- 안과 검사 (시력, 안압, 안저)\n- 청력 검사\n\n소요시간: 약 3시간\n결과 상담: 검진 당일 또는 3일 이내', metadata: { subType: 'PROGRAM', programName: '종합건강검진 A형', price: 350000, duration: '3시간', items: ['신체계측', '혈액검사 40종', '소변/대변검사', '흉부 X-ray', '심전도', '복부 초음파', '위내시경', '안과/청력 검사'], targetAge: '만 20세 이상' }, sortOrder: 1, tags: ['건강검진', '종합검진', 'A형', '기본'] },
    { category: 'CHECKUP_INFO', slug: 'checkup-program-b', title: '종합건강검진 B형 (정밀)', content: 'A형 기본검진에 CT, MRI 등 정밀 영상검사를 추가한 프리미엄 프로그램입니다.\n\nA형 전체 항목 포함 + 추가 항목:\n- 저선량 폐 CT\n- 복부/골반 CT\n- 뇌 MRI + MRA\n- 경동맥 초음파\n- 심장 초음파\n- 대장내시경 (수면)\n- 골밀도 검사 (DEXA)\n- 동맥경화도 검사\n\n소요시간: 약 5시간 (1일 검진)\n결과 상담: 검진 당일 전문의 상담', metadata: { subType: 'PROGRAM', programName: '종합건강검진 B형', price: 850000, duration: '5시간', items: ['A형 전체 항목', '폐 CT', '복부/골반 CT', '뇌 MRI+MRA', '경동맥 초음파', '심장 초음파', '대장내시경', '골밀도', '동맥경화도'], targetAge: '만 40세 이상 권장' }, sortOrder: 2, tags: ['건강검진', '종합검진', 'B형', '정밀', 'CT', 'MRI'] },
    { category: 'CHECKUP_INFO', slug: 'checkup-national', title: '국가건강검진', content: '국민건강보험공단에서 시행하는 국가건강검진을 실시합니다.\n\n대상: 건강보험 가입자 및 피부양자\n주기: 2년마다 (비사무직 매년)\n\n검사 항목:\n- 문진 및 진찰\n- 신체계측 (신장, 체중, 허리둘레, 혈압)\n- 혈액검사 (혈당, 지질, 간기능, 신장기능, 혈색소)\n- 소변검사\n- 흉부 X-ray\n- 구강 검진\n\n연령별 추가 검사:\n- 만 40세: 위암 검진 (위내시경)\n- 만 50세: 대장암 검진 (분변잠혈)\n- 만 40세 여성: 유방암 검진 (유방촬영)\n- 만 20세 여성: 자궁경부암 검진\n\n비용: 본인부담 없음 (무료)', metadata: { subType: 'PROGRAM', programName: '국가건강검진', price: 0, duration: '1~2시간', items: ['문진/진찰', '신체계측', '혈액검사', '소변검사', '흉부 X-ray', '구강검진', '암검진(연령별)'], targetAge: '건강보험 가입자' }, sortOrder: 3, tags: ['국가검진', '건강검진', '무료', '건강보험'] },
    { category: 'CHECKUP_INFO', slug: 'checkup-corporate', title: '기업단체검진', content: '기업 및 단체를 위한 맞춤형 건강검진 프로그램입니다.\n\n특징:\n- 기업별 맞춤 검진 항목 구성\n- 단체 예약 및 일정 조율\n- 검진 결과 통계 리포트 제공 (개인정보 비식별)\n- 사후 관리 프로그램 연계\n\n제공 프로그램:\n- 채용 검진\n- 일반 건강검진 (산업안전보건법)\n- 특수 건강검진 (유해인자 노출 근로자)\n- 임원 종합검진\n\n문의: 건강검진센터 ☎ 내선 7100\n이메일: checkup@hospital.example.org', metadata: { subType: 'PROGRAM', programName: '기업단체검진', duration: '협의', items: ['채용검진', '일반건강검진', '특수건강검진', '임원종합검진'], targetAge: '기업/단체' }, sortOrder: 4, tags: ['기업검진', '단체검진', '채용검진', '특수검진'] },
    { category: 'CHECKUP_INFO', slug: 'checkup-process', title: '검진 절차 안내', content: '건강검진 절차를 안내합니다.\n\n1단계: 예약\n- 온라인 예약 (/booking) 또는 전화 예약 (내선 7100)\n- 희망 일자 및 검진 프로그램 선택\n\n2단계: 검진 전 준비\n- 검진 전날 저녁 9시 이후 금식 (물 포함)\n- 검진 당일 아침 약 복용 중단 (혈압약 제외)\n- 편한 복장으로 내원\n- 여성: 생리 기간 피해 예약\n\n3단계: 검진 당일\n- 7층 건강검진센터 접수 (08:00~)\n- 탈의 → 검진복 착용\n- 검사 순서에 따라 이동 (안내원 배치)\n- 수면내시경 선택 시 보호자 동행 권장\n\n4단계: 결과 상담\n- 당일 또는 3~5일 이내 전문의 상담\n- 결과지 우편 또는 환자포털 조회\n- 이상 소견 시 해당 진료과 연계', metadata: { subType: 'PROCESS' }, sortOrder: 10, tags: ['검진절차', '준비사항', '건강검진'] },
    { category: 'CHECKUP_INFO', slug: 'checkup-preparation', title: '검진 전 준비사항', content: '정확한 검진 결과를 위해 아래 사항을 준수해주세요.\n\n식이 제한:\n- 검진 전날 저녁 9시 이후 금식 (물, 껌, 사탕 포함)\n- 검진 전날 저녁은 가벼운 식사 (기름진 음식, 음주 금지)\n- 대장내시경 시 별도 장 정결제 복용 안내\n\n약물:\n- 혈압약: 검진 당일 아침 소량의 물과 함께 복용\n- 당뇨약/인슐린: 검진 당일 아침 복용 중단\n- 아스피린/항응고제: 내시경 5일 전 중단 (담당의 상의)\n\n준비물:\n- 신분증 (주민등록증, 운전면허증)\n- 검진 안내문 (사전 우편 발송)\n- 이전 검진 결과지 (비교 분석용)\n- 편한 복장 (금속 장신구 제거)\n\n주의사항:\n- 콘택트렌즈 → 안경으로 교체\n- 수면내시경 후 운전 금지 (보호자 동행)\n- 임신 가능성 시 사전 고지', metadata: { subType: 'PREPARATION' }, sortOrder: 11, tags: ['준비사항', '금식', '검진준비'] },

    // ── CSR 8건 ──
    { category: 'CSR', slug: 'csr-volunteer-2026', title: '2026 가상 의료봉사 활동', imageUrl: '/images/homepage/checkup/checkup-basic.png', content: '위루비병원은 매년 가상 지역사회 의료 소외 계층을 대상으로 무료 의료봉사를 시행합니다.\n\n■ 2026년 의료봉사 일정\n- 3월: 독거 어르신 건강검진 (가상시 보건소 연계)\n- 6월: 다문화 가정 건강상담 (가상시 다문화센터)\n- 9월: 농촌 주민 건강검진 (중문 보건지소)\n- 12월: 소외 아동 치과 봉사 (가상 지역아동센터)\n\n■ 참여 현황\n- 참여 의료진: 의사 8명, 간호사 12명, 약사 2명\n- 수혜 인원: 연간 약 500명\n- 누적 봉사시간: 2,400시간', metadata: { subType: 'VOLUNTEER', date: '2026-03-15', participants: 22 }, sortOrder: 1, tags: ['봉사', '의료봉사', '사회공헌', '가상'] },
    { category: 'CSR', slug: 'csr-free-clinic', title: '무료 진료 사업', imageUrl: '/images/homepage/doctors/dept-family-medicine.png', content: '의료 사각지대 해소를 위한 무료 진료 사업을 운영합니다.\n\n■ 대상\n- 의료급여 수급자\n- 차상위 계층\n- 외국인 근로자\n- 가상 도서 지역 주민\n\n■ 진료 분야\n- 가정의학과, 내과, 피부과, 신경과\n\n■ 신청 방법\n- 사회사업실 방문 (내선 1500)\n- 가상시청/보건소 의뢰', metadata: { subType: 'FREE_CLINIC', date: '2026-01-01' }, sortOrder: 2, tags: ['무료진료', '사회공헌'] },
    { category: 'CSR', slug: 'csr-education', title: '건강교육 프로그램', imageUrl: '/images/homepage/doctors/dept-emergency.png', content: '위루비병원은 가상 지역 주민을 대상으로 다양한 건강교육 프로그램을 운영합니다.\n\n■ 정기 프로그램\n- 매월 첫째 토요일: 만성질환 관리 교실 (당뇨, 고혈압)\n- 매월 셋째 수요일: 심폐소생술(CPR) 교육\n- 분기별: 항노화 건강 강좌\n- 계절별: 시즌 건강 특강\n\n■ 안내\n- 장소: 교육센터\n- 참가비: 무료\n- 신청: 홈페이지 또는 전화', metadata: { subType: 'EDUCATION', date: '2026-02-01' }, sortOrder: 3, tags: ['건강교육', '사회공헌', 'CPR'] },
    { category: 'CSR', slug: 'csr-jeju-senior', title: '가상 어르신 건강증진 프로젝트', imageUrl: '/images/homepage/checkup/checkup-national.png', content: '가상도 고령 인구를 위한 맞춤형 건강증진 프로젝트를 운영합니다.\n\n■ 프로그램 내용\n- 연 2회 무료 종합 건강검진\n- 치매 조기 선별 검사 (뇌과학 센터 연계)\n- 골다공증 검사 및 예방 교육\n- 만성질환(당뇨/고혈압) 관리 상담\n\n■ 실적\n- 2025년: 320명 검진 완료\n- 치매 조기 발견 12건 → 전문 진료 연계', metadata: { subType: 'VOLUNTEER', date: '2025-09-01', participants: 320 }, sortOrder: 4, tags: ['어르신', '건강검진', '치매', '가상'] },
    { category: 'CSR', slug: 'csr-intl-medical', title: '국제 의료 지원', imageUrl: '/images/homepage/banners/banner-2.png', content: '위루비병원 국제진료센터를 통해 개발도상국 의료 지원 활동을 수행합니다.\n\n■ 주요 활동\n- 동남아 지역 의료 봉사단 파견 (연 1회)\n- 외국인 환자 무료 진료 프로그램\n- 해외 의료진 초청 기술 교류\n- 원격 의료 상담 지원\n\n■ 실적\n- 2025년 캄보디아 의료봉사: 의료진 10명, 환자 250명 진료', metadata: { subType: 'VOLUNTEER', date: '2025-11-01', participants: 10 }, sortOrder: 5, tags: ['국제', '의료봉사', '해외'] },
    { category: 'CSR', slug: 'csr-scholarship', title: '의료인 장학금 사업', imageUrl: '/images/homepage/centers/center-checkup.png', content: '가상 지역 의료인 양성을 위한 장학금을 지원합니다.\n\n■ 대상\n- 가상 출신 의학/간호학/약학 대학생\n- 졸업 후 가상 지역 의료기관 근무 희망자\n\n■ 지원 내용\n- 연간 등록금 전액 (최대 4년)\n- 실습비 지원\n- 졸업 후 위루비병원 우선 채용\n\n■ 실적\n- 2024~2025년: 12명 장학생 선발', metadata: { subType: 'DONATION', date: '2025-03-01' }, sortOrder: 6, tags: ['장학금', '인재양성', '가상'] },
    { category: 'CSR', slug: 'csr-environment', title: '가상 환경보전 활동', imageUrl: '/images/homepage/facilities/facility-lab.png', content: '가상의 아름다운 자연환경을 보전하기 위한 활동에 참여합니다.\n\n■ 주요 활동\n- 분기별 해안가 클린업 캠페인\n- 병원 내 일회용 플라스틱 저감 운동\n- 친환경 의료폐기물 처리 시스템 도입\n- 태양광 발전 설비 운영 (병원 전력 15% 자급)\n\n■ 성과\n- 2025년 플라스틱 사용량 30% 감축\n- 탄소 배출 연간 120톤 감소', metadata: { subType: 'VOLUNTEER', date: '2026-04-22' }, sortOrder: 7, tags: ['환경', '친환경', '가상', '클린업'] },
    { category: 'CSR', slug: 'csr-disaster', title: '재난 의료 지원', imageUrl: '/images/homepage/facilities/facility-emergency.png', content: '자연재해 및 대형 사고 시 긴급 의료 지원 체계를 운영합니다.\n\n■ 운영 체계\n- 재난의료지원팀(DMAT) 상시 편성: 의사 4명, 간호사 6명\n- 가상도 재난대비 협력 병원 지정\n- 이동형 진료 장비 보유 (응급진료차 1대)\n\n■ 주요 출동\n- 2025년 가상 태풍 피해 주민 진료 (3일간 180명)\n- 가상시 산불 현장 응급 의료 지원', metadata: { subType: 'FREE_CLINIC', date: '2025-08-15', participants: 10 }, sortOrder: 8, tags: ['재난', '응급', 'DMAT', '가상'] },

    // ── VOC 2건 ──
    { category: 'VOC', slug: 'voc-guide', title: '고객의 소리 접수 안내', content: '위루비병원은 환자분과 보호자분의 소중한 의견을 경청합니다.\n\n접수 유형:\n- 칭찬: 감사한 직원이나 서비스에 대한 칭찬\n- 건의: 서비스 개선을 위한 건의사항\n- 불만: 진료, 시설, 서비스에 대한 불만\n\n접수 방법:\n1. 홈페이지 고객의 소리 접수\n2. 1층 원무과 의견함\n3. 전화: 02-000-0000 (고객지원팀)\n4. 이메일: voc@hospital.example.org\n\n처리 절차:\n1. 접수 확인 (1영업일 이내)\n2. 해당 부서 조사 (3영업일 이내)\n3. 결과 회신 (7영업일 이내)\n\n* 회신을 원하시는 경우 연락처를 반드시 기재해주세요.', metadata: { subType: 'GUIDE', responseTime: '7영업일 이내', contactPhone: '02-000-0000' }, sortOrder: 1, tags: ['고객의소리', 'VOC', '칭찬', '불만', '건의'] },
    { category: 'VOC', slug: 'voc-policy', title: '고객 불만 처리 방침', content: '위루비병원 고객 불만 처리 방침\n\n1. 기본 원칙\n- 모든 불만은 진지하게 수용하고 신속히 처리합니다\n- 고객의 개인정보는 철저히 보호합니다\n- 처리 결과는 반드시 고객에게 회신합니다\n\n2. 처리 기한\n- 접수 확인: 1영업일 이내\n- 조사 완료: 3영업일 이내\n- 결과 회신: 7영업일 이내 (복잡한 사안은 14영업일)\n\n3. 에스컬레이션\n- 1차: 해당 부서장\n- 2차: 행정부장\n- 3차: 병원장\n\n4. 재발 방지\n- 유사 사례 분석 및 개선 조치\n- 질관리(QI) 활동 연계\n- 직원 교육 강화', metadata: { subType: 'POLICY' }, sortOrder: 2, tags: ['불만처리', 'VOC', '방침', '에스컬레이션'] },

    // ── BANNER 3건 ──
    { category: 'BANNER', slug: 'hero-main', title: 'Care Today, Ready for Tomorrow', content: '정확한 진단으로 오늘의 병을 치료합니다. 정밀한 예측으로, 내일의 병을 예방합니다.', metadata: { subType: 'HERO', linkUrl: '/care/centers', linkText: '특성화 센터', bgColor: '#1e40af', textColor: '#ffffff', displayOrder: 1 }, sortOrder: 1, tags: ['배너', '메인', '히어로'], isPinned: false },
    { category: 'BANNER', slug: 'hero-checkup', title: 'VIP 건강증진 센터', content: '빠르고 정확한 검진시스템으로 진단에서 치료까지 원스톱 맞춤 의료서비스를 제공합니다', metadata: { subType: 'HERO', linkUrl: '/checkup', linkText: '검진 프로그램 보기', bgColor: '#047857', textColor: '#ffffff', displayOrder: 2 }, sortOrder: 2, tags: ['배너', '검진', 'VIP'] },
    { category: 'BANNER', slug: 'strip-summer', title: '여름 진료시간 변경: 평일 08:30~17:30 (7~8월)', content: '7~8월 하절기 진료시간이 변경됩니다. 자세한 내용은 공지사항을 확인해주세요.', metadata: { subType: 'STRIP', linkUrl: '/news', linkText: '공지 보기', bgColor: '#dc2626', textColor: '#ffffff' }, sortOrder: 3, tags: ['배너', '띠배너', '진료시간', '여름'] },

    // ── FACILITY 5건 (층별 시설 안내) ──
    { category: 'FACILITY', slug: 'facility-1f', title: '1층 — 로비·응급실·원무과', content: '1층에는 정문 로비, 응급실, 원무과(접수/수납), 약국, 편의점, 카페가 위치합니다.\n\n주요 시설:\n- 정문 로비: 종합안내, 무인 접수기\n- 응급실: 24시간 운영, KTAS 분류\n- 원무과: 진료 접수, 수납, 제증명 발급\n- 약국: 처방 조제\n- 편의점·카페: 07:00~21:00', metadata: { floor: '1층', sections: [{ name: '로비·안내', detail: '종합안내, 무인접수기' }, { name: '응급실', detail: '24시간, KTAS' }, { name: '원무과', detail: '접수, 수납, 제증명' }, { name: '약국', detail: '처방 조제' }, { name: '편의점·카페', detail: '07:00~21:00' }] }, sortOrder: 1, tags: ['1층', '로비', '응급실', '원무과', '시설'] },
    { category: 'FACILITY', slug: 'facility-2f', title: '2층 — 외래 진료실·채혈실', content: '2층에는 내과, 외과, 가정의학과 등 주요 외래 진료실과 채혈실이 위치합니다.\n\n주요 시설:\n- 내과 외래 (순환기, 호흡기, 소화기)\n- 외과·정형외과 외래\n- 가정의학과 외래\n- 채혈실·검체접수\n- 심혈관센터', metadata: { floor: '2층', sections: [{ name: '내과 외래', detail: '순환기/호흡기/소화기' }, { name: '외과 외래', detail: '외과/정형외과' }, { name: '채혈실', detail: '혈액/소변 검사' }, { name: '심혈관센터', detail: '심장초음파, 중재시술' }] }, sortOrder: 2, tags: ['2층', '외래', '진료실', '채혈실', '시설'] },
    { category: 'FACILITY', slug: 'facility-3f', title: '3층 — 영상검사·내시경실', content: '3층에는 영상의학과(CT, MRI, X-ray), 내시경실, 초음파실이 위치합니다.\n\n주요 시설:\n- CT실: 128채널 CT\n- MRI실: 3.0T MRI\n- X-ray실\n- 내시경실: 위/대장 내시경 (수면내시경 가능)\n- 초음파실: 복부, 갑상선, 유방', metadata: { floor: '3층', sections: [{ name: 'CT실', detail: '128채널 CT' }, { name: 'MRI실', detail: '3.0T MRI' }, { name: '내시경실', detail: '수면내시경 가능' }, { name: '초음파실', detail: '복부/갑상선/유방' }] }, sortOrder: 3, tags: ['3층', '영상', 'CT', 'MRI', '내시경', '시설'] },
    { category: 'FACILITY', slug: 'facility-5f', title: '5층 — 수술실·중환자실', content: '5층에는 수술실(8실)과 중환자실(ICU)이 위치합니다.\n\n주요 시설:\n- 수술실 8실 (로봇수술실 1실 포함)\n- 중환자실 (20병상)\n- 회복실\n- 중앙공급실(CSSD)', metadata: { floor: '5층', sections: [{ name: '수술실', detail: '8실 (로봇수술 포함)' }, { name: '중환자실', detail: '20병상' }, { name: '회복실', detail: '수술 후 회복' }, { name: 'CSSD', detail: '멸균/소독' }] }, sortOrder: 5, tags: ['5층', '수술실', '중환자실', '시설'] },
    { category: 'FACILITY', slug: 'facility-7f', title: '7층 — 건강검진센터', content: '7층 전체가 건강검진센터로 운영됩니다.\n\n주요 시설:\n- 검진 접수·대기실\n- 검진 전용 채혈실\n- 검진 전용 내시경실\n- 검진 전용 영상실 (CT, 유방촬영, 골밀도)\n- 결과 상담실\n- VIP 검진실', metadata: { floor: '7층', sections: [{ name: '검진 접수', detail: '대기실 포함' }, { name: '검진 채혈실', detail: '전용' }, { name: '검진 내시경', detail: '수면내시경' }, { name: '검진 영상', detail: 'CT, 유방촬영, 골밀도' }, { name: '결과 상담실', detail: '전문의 상담' }] }, sortOrder: 7, tags: ['7층', '건강검진', '검진센터', '시설'] },

    // ── GALLERY 30건 (시설/행사/수상/건축) ──
    // 시설 (FACILITY) — 14건
    { category: 'GALLERY', slug: 'gallery-lobby', title: '1층 로비 전경', content: '자연광이 넘치는 가상 위루비병원 1층 로비', imageUrl: '/images/homepage/facilities/facility-lobby.png', metadata: { subType: 'FACILITY', date: '2026-03-01' }, sortOrder: 1, tags: ['갤러리', '로비', '시설'] },
    { category: 'GALLERY', slug: 'gallery-outpatient', title: '외래 진료실', content: '환자 편의를 고려한 외래 진료 공간', imageUrl: '/images/homepage/doctors/dept-internal-medicine.png', metadata: { subType: 'FACILITY', date: '2026-03-01' }, sortOrder: 2, tags: ['갤러리', '외래', '진료실'] },
    { category: 'GALLERY', slug: 'gallery-operating-room', title: '수술실', content: '최첨단 장비를 갖춘 수술실', imageUrl: '/images/homepage/facilities/facility-operating-room.png', metadata: { subType: 'FACILITY', date: '2026-03-01' }, sortOrder: 3, tags: ['갤러리', '수술실'] },
    { category: 'GALLERY', slug: 'gallery-checkup-center', title: 'VIP 건강검진센터', content: '원스톱 맞춤형 건강검진 시설', imageUrl: '/images/homepage/checkup/checkup-vip.png', metadata: { subType: 'FACILITY', date: '2026-03-01' }, sortOrder: 4, tags: ['갤러리', '검진센터'] },
    { category: 'GALLERY', slug: 'gallery-mri', title: '3.0T MRI실', content: '초정밀 3.0T MRI 장비', imageUrl: '/images/homepage/facilities/facility-mri.png', metadata: { subType: 'FACILITY', date: '2026-03-01' }, sortOrder: 5, tags: ['갤러리', 'MRI', '영상'] },
    { category: 'GALLERY', slug: 'gallery-lab', title: '진단검사의학 센터', content: '최첨단 자동화 분석 장비를 갖춘 검사실', imageUrl: '/images/homepage/facilities/facility-lab.png', metadata: { subType: 'FACILITY', date: '2026-03-01' }, sortOrder: 6, tags: ['갤러리', '검사실', '시설'] },
    { category: 'GALLERY', slug: 'gallery-emergency', title: '응급실', content: '24시간 운영되는 응급의료 시설', imageUrl: '/images/homepage/facilities/facility-emergency.png', metadata: { subType: 'FACILITY', date: '2026-03-01' }, sortOrder: 7, tags: ['갤러리', '응급실'] },
    { category: 'GALLERY', slug: 'gallery-pharmacy', title: '약제실', content: '자동조제 시스템을 갖춘 약제실', imageUrl: '/images/homepage/facilities/facility-pharmacy.png', metadata: { subType: 'FACILITY', date: '2026-03-01' }, sortOrder: 8, tags: ['갤러리', '약제실'] },
    { category: 'GALLERY', slug: 'gallery-ward', title: 'VIP 병동', content: '쾌적한 환경의 VIP 입원 병실', imageUrl: '/images/homepage/facilities/facility-ward.png', metadata: { subType: 'FACILITY', date: '2026-03-01' }, sortOrder: 9, tags: ['갤러리', '병동', 'VIP'] },
    { category: 'GALLERY', slug: 'gallery-cafeteria', title: '직원 식당 & 카페', content: '건강식 중심의 직원 식당과 로비 카페', imageUrl: '/images/homepage/facilities/facility-cafeteria.png', metadata: { subType: 'FACILITY', date: '2026-03-01' }, sortOrder: 10, tags: ['갤러리', '식당', '카페'] },
    { category: 'GALLERY', slug: 'gallery-cell-therapy', title: '세포치료 센터', content: '줄기세포 기반 맞춤 치료 시설', imageUrl: '/images/homepage/banners/banner-1.png', metadata: { subType: 'FACILITY', date: '2026-05-01' }, sortOrder: 11, tags: ['갤러리', '세포치료', '특성화'] },
    { category: 'GALLERY', slug: 'gallery-gene-lab', title: '유전자분석 센터', content: '차세대 유전체 분석 장비를 갖춘 연구실', imageUrl: '/images/homepage/facilities/facility-lab.png', metadata: { subType: 'FACILITY', date: '2026-05-01' }, sortOrder: 12, tags: ['갤러리', '유전자', '특성화'] },
    { category: 'GALLERY', slug: 'gallery-surgery-suite', title: '수술실 전경', content: '최신 수술 장비와 무영등 조명 시스템', imageUrl: '/images/homepage/facilities/facility-operating-room.png', metadata: { subType: 'FACILITY', date: '2026-05-01' }, sortOrder: 13, tags: ['갤러리', '수술실'] },
    { category: 'GALLERY', slug: 'gallery-molecular', title: '분자진단실', content: '정밀의학을 위한 분자진단 장비', imageUrl: '/images/homepage/facilities/facility-mri.png', metadata: { subType: 'FACILITY', date: '2026-05-01' }, sortOrder: 14, tags: ['갤러리', '분자진단'] },
    { category: 'GALLERY', slug: 'gallery-icu', title: '중환자실 (ICU)', content: '중증 환자를 위한 첨단 모니터링 시설을 갖춘 중환자실', imageUrl: '/images/homepage/centers/center-cardiovascular.png', metadata: { subType: 'FACILITY', date: '2026-03-01' }, sortOrder: 15, tags: ['갤러리', '중환자실', 'ICU'] },
    // 행사 (EVENT) — 8건
    { category: 'GALLERY', slug: 'gallery-health-festival', title: '2025 건강 페스티벌', content: '시민 대상 무료 건강검진 및 상담 행사', imageUrl: '/images/homepage/checkup/checkup-program.png', metadata: { subType: 'EVENT', date: '2025-07-15' }, sortOrder: 15, tags: ['갤러리', '행사', '건강페스티벌'] },
    { category: 'GALLERY', slug: 'gallery-volunteer', title: '의료봉사 활동', content: '가상 지역사회 무료 의료봉사', imageUrl: '/images/homepage/checkup/checkup-basic.png', metadata: { subType: 'EVENT', date: '2026-03-15' }, sortOrder: 16, tags: ['갤러리', '봉사'] },
    { category: 'GALLERY', slug: 'gallery-cpr-edu', title: 'CPR 교육 프로그램', content: '시민 대상 심폐소생술 교육 현장', imageUrl: '/images/homepage/doctors/dept-emergency.png', metadata: { subType: 'EVENT', date: '2026-04-20' }, sortOrder: 17, tags: ['갤러리', 'CPR', '교육'] },
    { category: 'GALLERY', slug: 'gallery-donation', title: '사랑의 헌혈 캠페인', content: '대한적십자사 연계 헌혈 행사', imageUrl: '/images/homepage/centers/center-cardiovascular.png', metadata: { subType: 'EVENT', date: '2026-02-14' }, sortOrder: 18, tags: ['갤러리', '헌혈', '행사'] },
    { category: 'GALLERY', slug: 'gallery-senior-checkup', title: '어르신 건강검진', content: '독거 어르신 대상 무료 건강검진', imageUrl: '/images/homepage/checkup/checkup-national.png', metadata: { subType: 'EVENT', date: '2026-01-20' }, sortOrder: 19, tags: ['갤러리', '봉사', '검진'] },
    { category: 'GALLERY', slug: 'gallery-opening', title: '개원 기념행사', content: '위루비병원 개원 기념 세레모니', imageUrl: '/images/homepage/banners/banner-1.png', metadata: { subType: 'EVENT', date: '2025-06-01' }, sortOrder: 20, tags: ['갤러리', '개원', '행사'] },
    { category: 'GALLERY', slug: 'gallery-diabetes-edu', title: '당뇨 관리 교실', content: '만성질환 관리 교육 프로그램', imageUrl: '/images/homepage/doctors/dept-family-medicine.png', metadata: { subType: 'EVENT', date: '2026-05-10' }, sortOrder: 21, tags: ['갤러리', '교육', '당뇨'] },
    { category: 'GALLERY', slug: 'gallery-intl-seminar', title: '국제 의료 세미나', content: '해외 의료진 초청 학술 세미나', imageUrl: '/images/homepage/banners/banner-2.png', metadata: { subType: 'EVENT', date: '2026-04-05' }, sortOrder: 22, tags: ['갤러리', '세미나', '국제'] },
    // 수상 (AWARD) — 4건
    { category: 'GALLERY', slug: 'gallery-emr-cert', title: 'EMR 인증 최고등급', content: '보건복지부 EMR 인증 최고등급 획득', imageUrl: '/images/homepage/checkup/checkup-result.png', metadata: { subType: 'AWARD', date: '2025-09-01' }, sortOrder: 23, tags: ['갤러리', '수상', 'EMR'] },
    { category: 'GALLERY', slug: 'gallery-safety-award', title: '환자안전 우수기관', content: '의료기관평가인증원 환자안전 우수기관 인증', imageUrl: '/images/homepage/centers/center-checkup.png', metadata: { subType: 'AWARD', date: '2025-11-15' }, sortOrder: 24, tags: ['갤러리', '수상', '환자안전'] },
    { category: 'GALLERY', slug: 'gallery-jci-prep', title: 'JCI 인증 준비', content: 'JCI 국제 인증 준비 과정', imageUrl: '/images/homepage/centers/center-transplant.png', metadata: { subType: 'AWARD', date: '2026-03-01' }, sortOrder: 25, tags: ['갤러리', 'JCI', '인증'] },
    { category: 'GALLERY', slug: 'gallery-best-hospital', title: '올해의 병원 선정', content: '가상도 올해의 병원 선정 기념', imageUrl: '/images/homepage/banners/banner-3.png', metadata: { subType: 'AWARD', date: '2025-12-20' }, sortOrder: 26, tags: ['갤러리', '수상', '병원'] },
    // 건축 (CONSTRUCTION) — 4건
    { category: 'GALLERY', slug: 'gallery-exterior', title: '병원 외관', content: '가상 가상시 녹지 속 병원 전경', imageUrl: '/images/homepage/guide/guide-parking.png', metadata: { subType: 'CONSTRUCTION', date: '2025-06-01' }, sortOrder: 27, tags: ['갤러리', '건축', '외관'] },
    { category: 'GALLERY', slug: 'gallery-helipad', title: '옥상 헬기장', content: '응급 환자 이송을 위한 헬기 착륙장', imageUrl: '/images/homepage/centers/center-trauma.png', metadata: { subType: 'CONSTRUCTION', date: '2025-06-01' }, sortOrder: 28, tags: ['갤러리', '건축', '헬기장'] },
    { category: 'GALLERY', slug: 'gallery-garden', title: '치유 정원', content: '환자와 보호자를 위한 야외 치유 정원', imageUrl: '/images/homepage/facilities/facility-lab.png', metadata: { subType: 'CONSTRUCTION', date: '2025-08-01' }, sortOrder: 29, tags: ['갤러리', '건축', '정원'] },
    { category: 'GALLERY', slug: 'gallery-parking', title: '지하 주차장', content: '300대 수용 가능한 지하 주차시설', imageUrl: '/images/homepage/guide/guide-reception.png', metadata: { subType: 'CONSTRUCTION', date: '2025-06-01' }, sortOrder: 30, tags: ['갤러리', '건축', '주차'] },

    // ── NON_COVERED 보강 (의료법 §42 — 5개 subType별) ──
    { category: 'NON_COVERED', slug: 'non-covered-procedure', title: '시술 비급여 항목', content: '비급여 시술 항목 안내입니다. 아래 가격은 부가세 포함 금액이며, 변경될 수 있습니다.', metadata: { subType: 'PROCEDURE', items: [{ name: '도수치료 (30분)', price: 80000, unit: '1회', note: '정형외과/재활의학과', effectiveDate: '2026-01-01', insuranceCovered: false }, { name: '체외충격파 치료', price: 50000, unit: '1회', note: '정형외과', effectiveDate: '2026-01-01', insuranceCovered: false }, { name: 'PRP 주사', price: 300000, unit: '1회', note: '자가 혈소판 풍부 혈장', effectiveDate: '2026-01-01', insuranceCovered: false }, { name: '프롤로 주사', price: 100000, unit: '1회', note: '정형외과', effectiveDate: '2026-01-01', insuranceCovered: false }], lastUpdated: '2026-01-01', updateReason: '2026년 비급여 가격 조정' }, sortOrder: 4, tags: ['비급여', '시술', '도수치료', '체외충격파'] },
    { category: 'NON_COVERED', slug: 'non-covered-supply', title: '소모품·재료 비급여 항목', content: '비급여 소모품 및 특수 재료 안내입니다.', metadata: { subType: 'SUPPLY', items: [{ name: '보호자 침대 대여', price: 10000, unit: '1일', note: '입원 시', effectiveDate: '2026-01-01', insuranceCovered: false }, { name: '환자복 대여', price: 5000, unit: '1일', note: '입원 시', effectiveDate: '2026-01-01', insuranceCovered: false }, { name: '특수 고정장치 (보조기)', price: 150000, unit: '1개', note: '정형외과 처방', effectiveDate: '2026-01-01', insuranceCovered: false }, { name: '진공 채혈관 (추가)', price: 3000, unit: '1개', note: '추가 검사 시', effectiveDate: '2026-01-01', insuranceCovered: false }], lastUpdated: '2026-01-01', updateReason: '2026년 비급여 가격 조정' }, sortOrder: 5, tags: ['비급여', '소모품', '재료', '보조기'] },

    // ── FAQ 추가 6건 ──
    { category: 'FAQ', slug: 'faq-checkup-booking', title: '건강검진 예약은 어떻게 하나요?', content: '건강검진은 다음 방법으로 예약할 수 있습니다.\n\n1. 온라인 예약: 홈페이지 예약 페이지에서 검진 프로그램 선택 후 희망 날짜 예약\n2. 전화 예약: 건강검진센터 ☎ 내선 7100 (평일 08:00~17:00)\n3. 방문 예약: 7층 건강검진센터 접수처\n\n예약 변경/취소: 검진일 2영업일 전까지 가능', metadata: {}, sortOrder: 10, tags: ['FAQ', '건강검진', '예약'] },
    { category: 'FAQ', slug: 'faq-checkup-fasting', title: '건강검진 전 금식은 꼭 해야 하나요?', content: '네, 정확한 검진 결과를 위해 금식이 필요합니다.\n\n- 검진 전날 저녁 9시 이후 금식 (물 포함)\n- 혈압약은 검진 당일 아침 소량의 물과 함께 복용 가능\n- 당뇨약/인슐린은 검진 당일 아침 복용 중단\n\n금식을 하지 않으면 혈당, 중성지방 등의 검사 결과가 부정확할 수 있습니다.', metadata: {}, sortOrder: 11, tags: ['FAQ', '건강검진', '금식', '준비'] },
    { category: 'FAQ', slug: 'faq-non-covered', title: '비급여 항목의 가격은 어디서 확인하나요?', content: '비급여 항목 및 가격은 다음에서 확인 가능합니다.\n\n1. 홈페이지: 진료안내 > 비급여 안내 (/care/non-covered)\n2. 1층 원무과 게시판\n3. 건강보험심사평가원 비급여 진료비 공개 포털\n\n의료법 제42조에 따라 비급여 항목의 가격을 투명하게 공개하고 있습니다.\n가격은 변경될 수 있으며, 변경 시 즉시 업데이트됩니다.', metadata: {}, sortOrder: 12, tags: ['FAQ', '비급여', '가격', '의료법'] },
    { category: 'FAQ', slug: 'faq-medical-record', title: '진료기록 사본은 어떻게 발급받나요?', content: '진료기록 사본 발급 방법:\n\n1. 본인 신청\n- 1층 원무과 제증명 창구 방문\n- 신분증 지참 필수\n- 발급 수수료: 1장 1,000원 (추가 100원/장)\n\n2. 대리인 신청\n- 환자 신분증 사본\n- 대리인 신분증\n- 환자 자필 동의서 + 위임장\n\n3. 온라인 신청\n- 환자포털 > 제증명 > 진료기록사본 신청\n- 발급까지 1~3영업일\n\n* 응급 시 팩스 발송 가능 (담당 병원 확인 후)', metadata: {}, sortOrder: 13, tags: ['FAQ', '제증명', '진료기록', '서류'] },
    { category: 'FAQ', slug: 'faq-emergency', title: '응급실은 24시간 운영되나요?', content: '네, 위루비병원 응급실은 365일 24시간 운영됩니다.\n\n응급실 위치: 1층 정문 옆 (별도 출입구)\n응급실 전화: 02-000-0119\n\n내원 시 참고사항:\n- KTAS(한국형 응급환자 분류) 기준으로 진료 순서가 결정됩니다\n- 경증 환자는 대기 시간이 길 수 있습니다\n- 야간/휴일 응급 수술 가능\n- 중증 외상, 심근경색, 뇌졸중 등 응급 질환 즉시 치료', metadata: {}, sortOrder: 14, tags: ['FAQ', '응급실', '24시간', '응급'] },
    { category: 'FAQ', slug: 'faq-wifi', title: '병원에서 Wi-Fi를 사용할 수 있나요?', content: '네, 병원 전 구역에서 무료 Wi-Fi를 제공합니다.\n\n네트워크 이름: HospitalRUN-Guest\n비밀번호: 없음 (개방형)\n\n사용 안내:\n- 외래 대기실, 입원 병동, 로비 등 전 구역 이용 가능\n- 동영상 스트리밍 등 대용량 사용은 제한될 수 있습니다\n- 보안을 위해 개인 금융거래는 자제해주세요', metadata: {}, sortOrder: 15, tags: ['FAQ', 'Wi-Fi', '인터넷', '무선'] },
  ];

  for (const item of cmsHomepageItems) {
    await prisma.hospitalInfoContent.upsert({
      where: { category_slug: { category: item.category, slug: item.slug } },
      create: {
        category: item.category, slug: item.slug, title: item.title,
        content: item.content, metadata: item.metadata as any,
        sortOrder: item.sortOrder, tags: item.tags,
        imageUrl: (item as any).imageUrl ?? null,
        isPinned: (item as any).isPinned ?? false, createdBy: adminId,
      },
      update: {
        title: item.title, content: item.content,
        metadata: item.metadata as any, tags: item.tags,
        imageUrl: (item as any).imageUrl ?? null,
        isPinned: (item as any).isPinned ?? false, updatedBy: adminId,
      },
    });
  }
  const hpCats = cmsHomepageItems.reduce((acc, i) => { acc[i.category] = (acc[i.category] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  console.log(`   - CMS Homepage: ${cmsHomepageItems.length} items (${Object.entries(hpCats).map(([k, v]) => `${k} ${v}`).join(', ')})`);

  // ============================================================
  // 대학병원 Phase A — 임상경로 시드
  // ============================================================
  console.log('  [대학병원] Clinical Pathways...');

  const pathways = [
    { i: 1, code: 'CP-AMI-001', name: '급성심근경색 표준경로', dept: '순환기내과', drg: 'K543', days: 7, desc: '급성 심근경색 환자의 입원부터 퇴원까지 표준 진료 프로토콜' },
    { i: 2, code: 'CP-STROKE-001', name: '급성 뇌경색 표준경로', dept: '신경외과', drg: 'B611', days: 10, desc: '급성 뇌경색 환자의 tPA 투여부터 재활까지' },
    { i: 3, code: 'CP-TKR-001', name: '인공관절치환술 경로', dept: '정형외과', drg: 'N045', days: 14, desc: '인공관절 치환술 수술 전 준비부터 재활 퇴원까지' },
    { i: 4, code: 'CP-CABG-001', name: '관상동맥우회술 경로', dept: '흉부외과', drg: 'K521', days: 12, desc: '관상동맥 우회술 수술 전후 관리' },
    { i: 5, code: 'CP-PNEU-001', name: '지역사회 폐렴 경로', dept: '호흡기내과', drg: 'D641', days: 5, desc: '경증~중등도 지역사회 폐렴 항생제 치료' },
  ];

  for (const p of pathways) {
    const pw = await prisma.clinicalPathway.upsert({
      where: { code: p.code },
      create: { id: uid(P.PATHWAY, p.i), code: p.code, name: p.name, department: p.dept, targetDrg: p.drg, totalDays: p.days, status: 'ACTIVE', description: p.desc, createdBy: adminId },
      update: { name: p.name, department: p.dept, totalDays: p.days, description: p.desc },
    });

    // 마일스톤 (Day 0~2 기본)
    const milestones = [
      { day: 0, cat: 'ASSESSMENT', title: '초기 평가 (입원 시)', req: true },
      { day: 0, cat: 'ORDER', title: '기본 검사 오더 (CBC, BMP, 심전도)', req: true },
      { day: 1, cat: 'MEDICATION', title: '표준 약물 투여 시작', req: true },
      { day: 1, cat: 'EDUCATION', title: '환자/보호자 교육', req: true },
      { day: Math.max(1, p.days - 2), cat: 'ASSESSMENT', title: '퇴원 준비 평가', req: true },
      { day: p.days - 1, cat: 'DISCHARGE', title: '퇴원 교육 + 외래 예약', req: true },
    ];

    for (let mi = 0; mi < milestones.length; mi++) {
      const m = milestones[mi];
      await prisma.pathwayMilestone.upsert({
        where: { id: uid(P.PATHWAY, p.i * 100 + mi) },
        create: { id: uid(P.PATHWAY, p.i * 100 + mi), pathwayId: pw.id, day: m.day, category: m.cat, title: m.title, isRequired: m.req, sortOrder: mi },
        update: { day: m.day, category: m.cat, title: m.title },
      });
    }
  }
  console.log(`   - Clinical Pathways: ${pathways.length} pathways with milestones`);

  // ============================================================
  // 대학병원 Phase A — MDT 컨퍼런스 시드
  // ============================================================
  console.log('  [대학병원] MDT Conferences...');

  const mdtConfs = [
    { i: 1, title: '유방암 다학제 #1', type: 'TUMOR_BOARD', dept: '유방외과', days: -7 },
    { i: 2, title: '폐암 다학제 #1', type: 'TUMOR_BOARD', dept: '호흡기내과', days: -3 },
    { i: 3, title: '간암 다학제 #1', type: 'TUMOR_BOARD', dept: '소화기내과', days: 3 },
    { i: 4, title: '사망 증례 검토회', type: 'MORBIDITY_MORTALITY', dept: '내과', days: 7 },
  ];

  for (const c of mdtConfs) {
    const schedDate = new Date(); schedDate.setDate(schedDate.getDate() + c.days);
    await prisma.mdtConference.upsert({
      where: { id: uid(P.MDT, c.i) },
      create: { id: uid(P.MDT, c.i), title: c.title, conferenceType: c.type, department: c.dept, scheduledAt: schedDate, status: c.days < 0 ? 'COMPLETED' : 'SCHEDULED', chairpersonId: kimNaegwaId },
      update: { title: c.title, department: c.dept },
    });
  }
  console.log(`   - MDT Conferences: ${mdtConfs.length}`);

  // ============================================================
  // 대학병원 Phase A — 암 등록 시드
  // ============================================================
  console.log('  [대학병원] Cancer Registry...');

  const cancerRegs = [
    { i: 1, regNo: 'CR-2026-00001', patIdx: 1, site: 'C50.9', morph: '8500/3', behav: '/3', basis: 'HISTOLOGY', icd: 'C50.9', tnmC: 'cT2N1M0', tnmP: 'pT2N1M0', stage: 'IIA', tx: 'SURGERY' },
    { i: 2, regNo: 'CR-2026-00002', patIdx: 2, site: 'C34.1', morph: '8070/3', behav: '/3', basis: 'HISTOLOGY', icd: 'C34.1', tnmC: 'cT3N2M0', tnmP: null, stage: 'IIIA', tx: 'COMBINED' },
    { i: 3, regNo: 'CR-2026-00003', patIdx: 3, site: 'C22.0', morph: '8170/3', behav: '/3', basis: 'IMAGING', icd: 'C22.0', tnmC: 'cT1N0M0', tnmP: null, stage: 'IA', tx: 'SURGERY' },
  ];

  for (const cr of cancerRegs) {
    await prisma.cancerRegistry.upsert({
      where: { registrationNo: cr.regNo },
      create: {
        id: uid(P.CANCER, cr.i), patientId: uid(P.PATIENT, cr.patIdx), registrationNo: cr.regNo,
        diagnosisDate: new Date('2026-03-15'), primarySite: cr.site, morphology: cr.morph, behavior: cr.behav,
        diagnosisBasis: cr.basis, icdCode: cr.icd, tnmClinical: cr.tnmC, tnmPathological: cr.tnmP,
        ajccStage: cr.stage, ajccEdition: 8, firstTreatment: cr.tx, firstTreatmentDate: new Date('2026-04-01'),
        registrarId: adminId, status: 'VERIFIED',
      },
      update: { primarySite: cr.site, ajccStage: cr.stage },
    });
  }
  console.log(`   - Cancer Registry: ${cancerRegs.length}`);

  // ============================================================
  // 대학병원 Phase A — 임상 연구 시드
  // ============================================================
  console.log('  [대학병원] Research Studies...');

  const studies = [
    { i: 1, no: 'IRB-2026-001', title: '급성심근경색 환자의 신규 항혈소판제 무작위 대조 시험', type: 'INTERVENTIONAL', phase: 'III', dept: '순환기내과', target: 200, current: 45, status: 'APPROVED' },
    { i: 2, no: 'IRB-2026-002', title: '폐암 면역관문억제제 반응 예측 바이오마커 연구', type: 'OBSERVATIONAL', phase: null, dept: '호흡기내과', target: 100, current: 23, status: 'APPROVED' },
    { i: 3, no: 'IRB-2026-003', title: '만성 신질환 진행 위험인자 후향적 코호트', type: 'RETROSPECTIVE', phase: null, dept: '신장내과', target: 500, current: 500, status: 'APPROVED' },
  ];

  for (const s of studies) {
    await prisma.researchStudy.upsert({
      where: { studyNo: s.no },
      create: {
        id: uid(P.RESEARCH, s.i), studyNo: s.no, title: s.title, piUserId: kimNaegwaId,
        department: s.dept, studyType: s.type, phase: s.phase, sponsor: '자체 연구',
        irbStatus: s.status, irbApprovalDate: new Date('2026-01-15'), irbExpiryDate: new Date('2027-01-14'),
        targetEnroll: s.target, currentEnroll: s.current, startDate: new Date('2026-02-01'),
      },
      update: { title: s.title, currentEnroll: s.current },
    });
  }
  console.log(`   - Research Studies: ${studies.length}`);

  // ============================================================
  // 대학병원 Phase A — 원가 센터 시드
  // ============================================================
  console.log('  [대학병원] Cost Centers...');

  const costCenters = [
    { i: 1, code: 'CC-MED-INT', name: '내과 외래', type: 'DIRECT_CARE', dept: '내과' },
    { i: 2, code: 'CC-MED-WARD', name: '내과 병동', type: 'DIRECT_CARE', dept: '내과' },
    { i: 3, code: 'CC-SURG-OR', name: '수술실', type: 'DIRECT_CARE', dept: '외과' },
    { i: 4, code: 'CC-ICU', name: '중환자실', type: 'DIRECT_CARE', dept: 'ICU' },
    { i: 5, code: 'CC-LAB', name: '검사실', type: 'SUPPORT', dept: '진단검사' },
    { i: 6, code: 'CC-RAD', name: '영상의학실', type: 'SUPPORT', dept: '영상의학' },
    { i: 7, code: 'CC-ADMIN', name: '원무과', type: 'ADMIN', dept: '원무과' },
    { i: 8, code: 'CC-PHARM', name: '약제부', type: 'SUPPORT', dept: '약제부' },
  ];

  for (const cc of costCenters) {
    await prisma.costCenter.upsert({
      where: { code: cc.code },
      create: { id: uid(P.COST, cc.i), code: cc.code, name: cc.name, type: cc.type, department: cc.dept },
      update: { name: cc.name, type: cc.type },
    });
  }

  // 원가 동인
  const costDrivers = [
    { i: 1, code: 'CD-LABOR-DR', name: '의사 인건비', cat: 'LABOR', unit: 'HOUR', cost: 150000, period: '2026-Q2' },
    { i: 2, code: 'CD-LABOR-NR', name: '간호사 인건비', cat: 'LABOR', unit: 'HOUR', cost: 80000, period: '2026-Q2' },
    { i: 3, code: 'CD-MAT-SURG', name: '수술 재료비', cat: 'MATERIAL', unit: 'COUNT', cost: 500000, period: '2026-Q2' },
    { i: 4, code: 'CD-EQUIP-CT', name: 'CT 장비 감가', cat: 'EQUIPMENT', unit: 'COUNT', cost: 120000, period: '2026-Q2' },
    { i: 5, code: 'CD-OVER-UTIL', name: '시설 유지비', cat: 'OVERHEAD', unit: 'SQMETER', cost: 50000, period: '2026-Q2' },
  ];

  for (const cd of costDrivers) {
    await prisma.costDriver.upsert({
      where: { code: cd.code },
      create: { id: uid(P.COST, 100 + cd.i), code: cd.code, name: cd.name, category: cd.cat, unit: cd.unit, unitCost: cd.cost, period: cd.period },
      update: { name: cd.name, unitCost: cd.cost, period: cd.period },
    });
  }
  console.log(`   - Cost Centers: ${costCenters.length}, Drivers: ${costDrivers.length}`);

  // ============================================================
  // EXTENDED SEED DATA — 128 미시딩 모델 대학병원급 확장
  // ============================================================
  console.log('\n🏥 Phase E: Extended Seed Data (128 models)...');
  const extStart = Date.now();

  try {
  // ── 참조용 ID ──
  const extLeeOegwaId = uid(P.USER, 4);
  const extChoiOegwaId = uid(P.USER, 5);
  const jungSoaaId = uid(P.USER, 6);
  const hanSanbuId = uid(P.USER, 7);
  const ohJeonghyungId = uid(P.USER, 8);
  const extKangEunggupId = uid(P.USER, 9);
  const choGanhoId = uid(P.USER, 10);
  const yoonGanhoId = uid(P.USER, 11);
  const hwangGanhoId = uid(P.USER, 12);
  const seoGanhoId = uid(P.USER, 13);
  const limYaksaId = uid(P.USER, 14);
  const moonGeomsaId = uid(P.USER, 15);
  const leeWonmuId = uid(P.USER, 16);
  const kimIcuNurseId = uid(P.USER, 45);
  const testJeongshinId = uid(P.USER, 28);
  const testJaehwalId = uid(P.USER, 33);
  const testByeongliId = uid(P.USER, 37);

  const patient1 = uid(P.PATIENT, 1);
  const patient2 = uid(P.PATIENT, 2);
  const patient3 = uid(P.PATIENT, 3);
  const patient4 = uid(P.PATIENT, 4);
  const patient5 = uid(P.PATIENT, 5);
  const patient6 = uid(P.PATIENT, 6);
  const patient7 = uid(P.PATIENT, 7);
  const patient8 = uid(P.PATIENT, 8);
  const patient9 = uid(P.PATIENT, 9);
  const patient10 = uid(P.PATIENT, 10);

  // ============================================================
  // E1. 시스템 설정 (SystemConfig)
  // ============================================================
  console.log('  [E1] SystemConfig, HolidayCalendar, Notification...');

  const systemConfigs = [
    // 🔴 `access.dept.원무과`·`access.dept.약제과` 시드 제거 — 화면 실사용 점검 W8(2026-08-14).
    //    이 두 행이 **운영 관리자를 시스템에서 잠그고 있었다**. `admin@hospital.example.org`·`admin@werub.example` 의
    //    `department` 가 '원무과' 라서 사이드바 narrowing 이 발동했고(narrowing 은 ADMIN 도 예외가 아니다),
    //    남은 nav 가 3개뿐이라 **관리자 섹션 전체가 사라져 `/admin/access-control` 화면 자체에 갈 수 없었다.**
    //    허용 경로에 앱에 존재하지 않는 경로가 섞여 있던 것이 잔재라는 근거다 —
    //    `/deposit`·`/dispensing` 은 어떤 라우트로도 없고, `/controlled-substance` 는 `/admin/` 아래에만 있다.
    //    실제 부서 접근 정책은 `/admin/access-control` 화면에서 운영자가 등록한다. **시드가 정책을 정하지 않는다.**
    //    되돌릴 SQL: docs/05-reference/manual/w8-access-dept-rollback.sql
    { key: 'access.role.DOCTOR', cat: 'access', label: '의사 접근 권한', value: { allowedPaths: ['*'], restrictedPaths: ['/admin/users'] } },
    { key: 'access.role.NURSE', cat: 'access', label: '간호사 접근 권한', value: { allowedPaths: ['/nursing', '/encounter', '/vitals', '/medication-admin'] } },
    { key: 'general.hospital.name', cat: 'general', label: '병원명', value: { ko: '가상대학교병원', en: 'Example University Hospital A' } },
    { key: 'general.hospital.beds', cat: 'general', label: '총 병상 수', value: { total: 1786, icu: 120, general: 1500, emergency: 86, ob: 80 } },
    { key: 'general.business.hours', cat: 'general', label: '진료 시간', value: { weekday: '08:30-17:30', saturday: '08:30-12:30', sunday: 'CLOSED', emergency: '24H' } },
    { key: 'clinical.vitals.threshold', cat: 'clinical', label: '바이탈 위급값 기준', value: { systolicBp: { low: 90, high: 180 }, heartRate: { low: 50, high: 120 }, spo2: { low: 90 }, temperature: { low: 35.0, high: 38.5 } } },
    { key: 'clinical.lab.criticalValues', cat: 'clinical', label: '검사 위급값 기준', value: { potassium: { low: 2.5, high: 6.5 }, glucose: { low: 40, high: 500 }, hemoglobin: { low: 7.0 }, platelets: { low: 20000 } } },
    { key: 'billing.deductible.rates', cat: 'billing', label: '본인부담률 설정', value: { outpatient: { tertiary: 60, general: 40 }, inpatient: 20, pharmacy: 30 } },
    { key: 'mapping.ai.enabled', cat: 'mapping', label: 'AI 자동 매핑 활성화', value: { enabled: true, confidenceThreshold: 0.85, autoApprove: false } },
    { key: 'notification.channels', cat: 'notification', label: '알림 채널 설정', value: { sse: true, push: true, sms: false, kakao: false } },
    /**
     * 🔴 **AI 서버 설정은 시드가 넣지 않는다**(2026-09-21 · 형제 프로젝트 인바운드 H1/R10).
     *   종전 시드는 `ai.server.url`(특정 설치본 도메인) · `ai.server.enabled=true` · `gpuKey` · `timeout`
     *   **네 줄을 DB 행으로 심었다.** 그 값들은 `config-runtime.service.ts` 의 **코드 기본값과 글자 그대로 같다** —
     *   즉 동작은 하나도 바뀌지 않으면서, 화면에서 "기본값으로 떨어짐"이어야 할 상태가 **"사람이 설정함"**
     *   으로 보였다(설정값 출처 3상태). 같은 사실에 정본이 둘이면 갈라진다 — 기본값 정본은 코드 한 곳이다.
     *   🔴 `ai.server.url` 코드 기본값이 특정 설치본 도메인인 것은 **여기서 고칠 일이 아니다**(코드 기본값 축) —
     *      다만 시드가 그것을 "선택된 값"으로 둔갑시키던 자리는 여기였다.
     *   API 키만은 환경변수로 들어온 **실값**이라 기본값 복제가 아니다 — 그래서 값이 있을 때만 넣는다
     *   (빈 문자열 행은 "설정했는데 비었다"로 읽혀 진단을 막는다).
     */
    ...(process.env.MEDICAL_AI_KEY
      ? [{ key: 'ai.server.apiKey', cat: 'ai', label: 'AI 서버 API 키 (X-Medical-Key)', value: process.env.MEDICAL_AI_KEY }]
      : []),
  ];

  for (let i = 0; i < systemConfigs.length; i++) {
    const sc = systemConfigs[i];
    await prisma.systemConfig.upsert({
      where: { key: sc.key },
      create: { id: uid(P.SYSCFG, i + 1), key: sc.key, value: sc.value, category: sc.cat, label: sc.label, updatedBy: adminId },
      // 🔴 **운영자가 바꾼 값을 시드가 되돌리지 않는다**(2026-09-21 · 형제 프로젝트 인바운드 H1).
      //    종전 `update: { value: sc.value }` 는 재실행 때마다 기존 행을 덮어썼다 — 관리자가 `/admin/ai-settings`
      //    에서 꺼 둔 `ai.server.enabled` 가 다시 켜지고, `ai.server.url` 이 특정 설치본 주소로 돌아가고,
      //    기관이 입력한 `general.hospital.name`·병상 수·진료 시간·본인부담률·위급값 기준이 데모 값으로 되돌아갔다.
      //    같은 파일의 다른 설정 시드(연동 게이트·R1 기능 게이트)는 이미 `update: {}` 로 보존한다 — 여기만 갈라져 있었다.
      //    시드는 **없을 때 기본값을 넣는 일**만 한다. 값 변경은 관리 화면(사람)의 몫이다.
      //    가드: `apps/api/test/architecture/seed-system-config-no-overwrite.spec.ts`
      update: {},
    });
  }

  /**
   * 사람 결정 — **개발 시드 형태**(2026-10-03 사용자 지시 "현재는 시드형태로 의결").
   *   D8 `journey.outpatientEnd` = BILLING_PAID · D9 `emergency.departureTimeSource` = DEPARTED_AT_FIELD 는 이미 코드로 구현됐다.
   *   🔴 근거에 `개발 시드(DEV-SEED)` 를 박는다 — 결정 등록부·개원 단계는 이 표식이 있으면 **실결정으로 세지 않는다**
   *      (decision.service `isSeedDecisionRecord` · go-live 와 같은 규칙). 실결정은 /admin/decisions 에서 근거와 함께 다시 기록한다.
   *   🔴 없을 때만 만든다(`update: {}`) — 사람이 남긴 실결정을 시드가 덮지 않는다.
   */
  const seededDecisions: Array<{ key: string; choice: string }> = [
    { key: 'journey.outpatientEnd', choice: 'BILLING_PAID' },
    { key: 'emergency.departureTimeSource', choice: 'DEPARTED_AT_FIELD' },
  ];
  for (let i = 0; i < seededDecisions.length; i++) {
    const sd = seededDecisions[i];
    await prisma.systemConfig.upsert({
      where: { key: `decision.${sd.key}` },
      create: {
        id: uid(P.SYSCFG, 900 + i + 1), key: `decision.${sd.key}`, category: 'general', label: `decision.${sd.key}`, updatedBy: adminId,
        value: {
          choice: sd.choice,
          legalReviewRef: '개발 시드(DEV-SEED) — 2026-10-03 사용자 지시(위원회 의결 전)',
          authorityClaim: '개발 시드(DEV-SEED) — 허가권 미검증',
          note: '실결정 아님 — /admin/decisions 에서 근거와 함께 다시 기록해야 결정으로 센다',
          decidedByUserId: adminId,
          decidedAt: '2026-10-03T03:00:00.000Z',
          applied: false,
          appliedDetail: '코드·스키마 변경이라 배포로만 반영된다 — 이 기록은 개발 시드다',
        },
      },
      update: {},
    });
  }

  /**
   * 간호 원내 규정 — **개발 시드 값**(2026-10-27 사용자 지시 · 값·이유 정본 `prisma/seeds/nursing-rules-dev-seed.ts`).
   *   🔴 label 에 `개발 시드(DEV-SEED)` 표식 → 서버는 출처 SEED(원내 규정 아님)로 말한다 · 관리자가 저장하면 표식이 사라진다.
   *   🔴 없을 때만(`update: {}`) — 사람이 저장한 값을 덮지 않는다.
   */
  for (const ns of NURSING_RULE_DEV_SEEDS) {
    await prisma.systemConfig.upsert({
      where: { key: ns.key },
      create: { key: ns.key, value: ns.value as never, category: 'nursing', label: `${DEV_SEED_CONFIG_LABEL} — 원내 규정 아님`, updatedBy: null },
      update: {},
    });
  }

  /**
   * 결정 등록부 배치 10-F 위원회 몫 — **개발 시드 형태**(2026-10-10 사용자 지시 "위원회몫은 시드 데이터로 결정해둘것").
   *   D8·D9 와 같은 규칙: 근거에 `개발 시드(DEV-SEED)` → 실결정으로 세지 않는다(위원회 의결은 /admin/gld 안건으로 다시 남긴다).
   *   D8·D9 와 다른 점: 이 결정들은 설정 값이 동작을 바꾼다 — 데모가 결정된 모양으로 돌도록 **설정 값도 시드한다**.
   *   🔴 둘 다 없을 때만 만든다(`update: {}`) — 사람이 남긴 실결정·관리자가 바꾼 설정을 덮지 않는다.
   *   🔴 시드 진입점 REAL 모드 가드가 막는다 — 리얼 전환 뒤에는 이 시드가 정책을 정하지 않는다.
   *   선택지는 등록부에 있는 값만(가드 `decision-seed-records.spec.ts` 가 등록부·집행 대상과 기계 대조한다).
   *   대외 발신(서류 환자 알림)은 타입 스위치만 켠다 — 마스터 `notification.patientPush.enabled` 는 그대로 꺼져 있어 실제로 나가지 않는다.
   */
  // 선택은 데이터 파일 하나가 정본 — `prisma/seeds/decision-dev-seeds.ts`(선택 원칙·이유는 그 파일에)
  const committeeSeedDecisions = DECISION_DEV_SEEDS;
  for (let i = 0; i < committeeSeedDecisions.length; i++) {
    const sd = committeeSeedDecisions[i];
    await prisma.systemConfig.upsert({
      where: { key: `decision.${sd.key}` },
      create: {
        id: uid(P.SYSCFG, 1000 + i), key: `decision.${sd.key}`, category: 'general', label: `decision.${sd.key}`, updatedBy: adminId,
        value: {
          choice: sd.choice,
          legalReviewRef: '개발 시드(DEV-SEED) — 2026-10-10 사용자 지시(위원회 의결 전)',
          authorityClaim: '개발 시드(DEV-SEED) — 위원회 의결 미검증',
          note: `실결정 아님 — 위원회 안건(/admin/gld)으로 의결해 다시 기록해야 결정으로 센다 · 시드 선택 이유: ${sd.why}`,
          decidedByUserId: adminId,
          decidedAt: '2026-10-10T03:00:00.000Z',
          applied: sd.config != null,
          appliedDetail: sd.config
            ? `개발 시드가 설정 ${sd.config.key} 를 없을 때만 넣었다 — 집행 엔진·위원회 의결을 거치지 않았다`
            : '이 선택은 아무것도 바꾸지 않는다',
        },
      },
      update: {},
    });
    if (sd.config) {
      await prisma.systemConfig.upsert({
        where: { key: sd.config.key },
        create: {
          // label 표식 — 설정 화면이 "개발 시드"라고 말한다(2026-10-27 · 의결 집행이 config.set 으로 저장하면 사라진다)
          id: uid(P.SYSCFG, 3000 + i), key: sd.config.key, category: sd.config.category, label: `${DEV_SEED_CONFIG_LABEL} — 위원회 의결 전`, updatedBy: adminId,
          value: sd.config.value as never,
        },
        update: {},
      });
    }
  }

  /**
   * 결정 이력 원장 — 시드 결정마다 "개발 시드 기록" 한 줄(2026-10-11 결정 엔진).
   *   🔴 그 결정에 이력이 하나도 없을 때만 — 운영처럼 마이그레이션이 원장 시작 전 기록(BACKFILL)을 이미 옮긴 DB 에 같은 사건을 두 번 쌓지 않는다.
   */
  const seedLogRows: Array<{ key: string; choice: string; legal: string; authority: string; at: string }> = [
    ...seededDecisions.map((sd) => ({ key: sd.key, choice: sd.choice, legal: '개발 시드(DEV-SEED) — 2026-10-03 사용자 지시(위원회 의결 전)', authority: '개발 시드(DEV-SEED) — 허가권 미검증', at: '2026-10-03T03:00:00.000Z' })),
    ...committeeSeedDecisions.map((sd) => ({ key: sd.key, choice: sd.choice, legal: '개발 시드(DEV-SEED) — 2026-10-10 사용자 지시(위원회 의결 전)', authority: '개발 시드(DEV-SEED) — 위원회 의결 미검증', at: '2026-10-10T03:00:00.000Z' })),
  ];
  for (let i = 0; i < seedLogRows.length; i++) {
    const r = seedLogRows[i];
    const has = await prisma.decisionLogEntry.findFirst({ where: { decisionKey: r.key }, select: { id: true } });
    if (has) continue;
    await prisma.decisionLogEntry.create({
      data: {
        id: makeUuid('00000077', i + 1), decisionKey: r.key, kind: 'SEED_RECORDED', choice: r.choice,
        basisRef: r.legal, authorityClaim: r.authority, actorUserId: adminId,
        detail: { note: '개발 시드 — 실결정 아님(위원회 의결·권한자 기록으로 다시 남겨야 결정으로 센다)' },
        occurredAt: new Date(r.at),
      },
    });
  }

  /**
   * 위원회 결정권한자 표 — 개발 시드로 확정(2026-10-11 사용자 지시 "결정권한자 표도 시드 데이터로 확정해둘것").
   *   정의(shared `COMMITTEE_AUTHORITIES`)를 그대로 `DEV-SEED` 기록으로 — 없을 때만(사람이 원내 규정으로 바꿔 적으면 시드가 덮지 않는다).
   *   🔴 실채택이 아니다 — 화면은 "개발 시드로 확정"으로 그리고, 원내 위원회 규정 번호로 다시 기록해야 채택이다.
   */
  for (let i = 0; i < COMMITTEE_CODES.length; i++) {
    const code = COMMITTEE_CODES[i];
    const key = committeeAuthorityConfigKey(code);
    await prisma.systemConfig.upsert({
      where: { key },
      create: {
        id: uid(P.SYSCFG, 5000 + i), key, category: 'general', label: key, updatedBy: adminId,
        value: { ...committeeAuthoritySeedRecord(code, '2026-10-11T00:00:00.000Z'), recordedByUserId: adminId } as never,
      },
      update: {},
    });
  }

  // HolidayCalendar (2026년)
  const holidays = [
    { date: '2026-01-01', name: '신정', type: 'NATIONAL' },
    { date: '2026-02-16', name: '설날 전날', type: 'NATIONAL' },
    { date: '2026-02-17', name: '설날', type: 'NATIONAL' },
    { date: '2026-02-18', name: '설날 다음날', type: 'NATIONAL' },
    { date: '2026-03-01', name: '삼일절', type: 'NATIONAL' },
    { date: '2026-05-05', name: '어린이날', type: 'NATIONAL' },
    { date: '2026-05-24', name: '석가탄신일', type: 'NATIONAL' },
    { date: '2026-06-06', name: '현충일', type: 'NATIONAL' },
    { date: '2026-08-15', name: '광복절', type: 'NATIONAL' },
    { date: '2026-09-24', name: '추석 전날', type: 'NATIONAL' },
    { date: '2026-09-25', name: '추석', type: 'NATIONAL' },
    { date: '2026-09-26', name: '추석 다음날', type: 'NATIONAL' },
    { date: '2026-10-03', name: '개천절', type: 'NATIONAL' },
    { date: '2026-10-09', name: '한글날', type: 'NATIONAL' },
    { date: '2026-12-25', name: '성탄절', type: 'NATIONAL' },
    { date: '2026-05-25', name: '석가탄신일 대체', type: 'SUBSTITUTE' },
    { date: '2026-06-01', name: '개원기념일', type: 'HOSPITAL' },
  ];

  for (let i = 0; i < holidays.length; i++) {
    const h = holidays[i];
    await prisma.holidayCalendar.upsert({
      where: { date_name: { date: new Date(h.date), name: h.name } },
      create: { id: uid(P.HOLIDAY, i + 1), date: new Date(h.date), name: h.name, type: h.type, year: 2026, source: 'SEED' },
      update: {},
    });
  }

  // Notification
  const notifications = [
    { userId: kimNaegwaId, type: 'LAB_CRITICAL', title: '위급값 보고', message: '환자 김영수(P2026-0001) 칼륨 6.8 mEq/L — 즉시 확인 필요', severity: 'CRITICAL', refType: 'LAB_RESULT' },
    { userId: kimNaegwaId, type: 'ORDER_COMPLETE', title: '검사 완료', message: '환자 이미숙(P2026-0002) CBC+Diff 결과 완료', severity: 'INFO', refType: 'LAB_RESULT' },
    { userId: choGanhoId, type: 'VITAL_ALERT', title: '바이탈 이상', message: '환자 박철수(P2026-0003) 수축기혈압 190mmHg', severity: 'WARNING', refType: 'VITAL_SIGN' },
    { userId: limYaksaId, type: 'DISPENSING_PENDING', title: '조제 대기', message: '처방 5건 조제 대기 중', severity: 'INFO', refType: 'DISPENSING' },
    { userId: leeWonmuId, type: 'BILLING_OVERDUE', title: '미수금 알림', message: '환자 최순자(P2026-0004) 미수금 ₩350,000', severity: 'WARNING', refType: 'BILLING' },
    { userId: adminId, type: 'SYSTEM', title: '시스템 업데이트', message: 'HIS v3.2.0 업데이트 예정 — 2026-06-01 02:00', severity: 'INFO' },
    { userId: hwangGanhoId, type: 'FALL_RISK', title: '낙상 고위험 알림', message: '환자 오대한(P2026-0007) Morse 75점 — 낙상 예방 중재 필요', severity: 'WARNING', refType: 'ASSESSMENT' },
    { userId: kimIcuNurseId, type: 'ICU_ALERT', title: 'ICU 환자 상태 변화', message: '환자 서준혁(P2026-0011) SOFA 12→15 악화', severity: 'CRITICAL', refType: 'ICU_RECORD' },
  ];

  for (let i = 0; i < notifications.length; i++) {
    const n = notifications[i];
    await prisma.notification.create({
      data: { id: uid(P.NOTIF, i + 1), userId: n.userId, type: n.type, title: n.title, message: n.message, severity: n.severity, refType: n.refType },
    });
  }
  console.log(`   - SystemConfig: ${systemConfigs.length}, Holidays: ${holidays.length}, Notifications: ${notifications.length}`);

  // ============================================================
  // E2. 재고관리 확장 (Inventory)
  // ============================================================
  console.log('  [E2] Inventory: Storage, Supplier, Lot, Transaction, Count, Request...');

  // InventoryStorage (보관장소)
  const storages = [
    { i: 1, code: 'WH-MAIN', name: '중앙창고', type: 'WAREHOUSE', loc: '지하 1층 A동', temp: '실온(15~25℃)', cap: 5000 },
    { i: 2, code: 'WH-COLD', name: '냉장창고', type: 'COLD_STORAGE', loc: '지하 1층 B동', temp: '냉장(2~8℃)', cap: 500 },
    { i: 3, code: 'PH-MAIN', name: '약제과 약품창고', type: 'PHARMACY', loc: '1층 약제과', temp: '실온', cap: 2000 },
    { i: 4, code: 'PH-NARCO', name: '마약류 보관함', type: 'PHARMACY', loc: '1층 약제과 금고', temp: '실온', cap: 100 },
    { i: 5, code: 'WD-3INT', name: '3층 내과병동 부서창고', type: 'WARD', loc: '3층 간호스테이션', temp: '실온', cap: 300 },
    { i: 6, code: 'WD-4SUR', name: '4층 외과병동 부서창고', type: 'WARD', loc: '4층 간호스테이션', temp: '실온', cap: 300 },
    { i: 7, code: 'OR-SURG', name: '수술실 재료실', type: 'DEPARTMENT', loc: '2층 수술실', temp: '실온', cap: 800 },
    { i: 8, code: 'ER-STOCK', name: '응급실 재료실', type: 'DEPARTMENT', loc: '1층 응급실', temp: '실온', cap: 500 },
    { i: 9, code: 'LAB-MAIN', name: '검사실 시약창고', type: 'DEPARTMENT', loc: '1층 검사실', temp: '냉장(2~8℃)', cap: 200 },
    { i: 10, code: 'ICU-STOCK', name: 'ICU 재료실', type: 'DEPARTMENT', loc: '2층 ICU', temp: '실온', cap: 200 },
  ];
  for (const s of storages) {
    await prisma.inventoryStorage.upsert({
      where: { code: s.code },
      create: { id: uid(P.INVSTOR, s.i), code: s.code, name: s.name, type: s.type, location: s.loc, temperature: s.temp, capacity: s.cap },
      update: {},
    });
  }

  // InventorySupplier (거래처)
  const suppliers = [
    { i: 1, code: 'SUP-001', name: '(주)한국메디칼서플라이', biz: '123-45-67890', rep: '김대표', cName: '이영업', cPhone: '02-000-0000', cEmail: 'sales@kms.example', pay: 'NET30', rating: 'A' },
    { i: 2, code: 'SUP-002', name: '대한의료기기', biz: '234-56-78901', rep: '박대표', cName: '정영업', cPhone: '02-2345-6789', cEmail: 'sales@daehan-med.example', pay: 'NET60', rating: 'A' },
    { i: 3, code: 'SUP-003', name: '글로벌파마코리아', biz: '345-67-89012', rep: '최대표', cName: '한영업', cPhone: '02-3456-7890', cEmail: 'order@globalpharma.example', pay: 'NET30', rating: 'B' },
    { i: 4, code: 'SUP-004', name: '메디텍수술재료', biz: '456-78-90123', rep: '오대표', cName: '강영업', cPhone: '031-456-7890', cEmail: 'sales@meditek.example', pay: 'NET45', rating: 'A' },
    { i: 5, code: 'SUP-005', name: '바이오진단시약', biz: '567-89-01234', rep: '조대표', cName: '윤영업', cPhone: '031-567-8901', cEmail: 'lab@biodiag.example', pay: 'NET30', rating: 'B' },
  ];
  for (const s of suppliers) {
    await prisma.inventorySupplier.upsert({
      where: { code: s.code },
      create: { id: uid(P.INVSUPP, s.i), code: s.code, name: s.name, businessNumber: s.biz, representative: s.rep, contactName: s.cName, contactPhone: s.cPhone, contactEmail: s.cEmail, paymentTerms: s.pay, rating: s.rating },
      update: {},
    });
  }

  // InventoryLot (로트)
  const lots = [
    { i: 1, itemCode: 'INV-001', lot: 'LOT-2026-A001', exp: '2027-06-30', qty: 500, stIdx: 1, cost: 150 },
    { i: 2, itemCode: 'INV-002', lot: 'LOT-2026-B002', exp: '2027-03-15', qty: 200, stIdx: 3, cost: 2500 },
    { i: 3, itemCode: 'INV-003', lot: 'LOT-2026-C003', exp: '2027-12-31', qty: 100, stIdx: 7, cost: 35000 },
    { i: 4, itemCode: 'INV-004', lot: 'LOT-2026-D004', exp: '2026-12-31', qty: 300, stIdx: 5, cost: 800 },
    { i: 5, itemCode: 'INV-005', lot: 'LOT-2026-E005', exp: '2027-09-30', qty: 50, stIdx: 2, cost: 12000 },
  ];
  // Get inventory items for lot association
  const invItems = await prisma.inventoryItem.findMany({ take: 10 });
  for (const l of lots) {
    const item = invItems.find(it => it.code === l.itemCode) ?? invItems[l.i - 1];
    if (!item) continue;
    await prisma.inventoryLot.upsert({
      where: { id: uid(P.INVLOT, l.i) },
      create: { id: uid(P.INVLOT, l.i), itemId: item.id, lotNumber: l.lot, expiryDate: new Date(l.exp), quantity: l.qty, storageId: uid(P.INVSTOR, l.stIdx), unitCost: l.cost },
      update: {},
    });
  }

  // InventoryTransaction (입출고 이력)
  for (let i = 1; i <= 10; i++) {
    const item = invItems[(i - 1) % invItems.length];
    if (!item) continue;
    const txTypes: Array<'RECEIVE' | 'ISSUE' | 'ADJUST' | 'RETURN'> = ['RECEIVE', 'ISSUE', 'ISSUE', 'RECEIVE', 'ADJUST', 'ISSUE', 'RECEIVE', 'RETURN', 'ISSUE', 'RECEIVE'];
    const depts = ['내과', '외과', 'ICU', '응급실', '수술실', '소아청소년과', '약제과', '내과', '외과', 'ICU'];
    // 금액은 **이 수량 하나**에서 나온다 — 수량과 금액이 각자 다른 식을 쓰면 반드시 갈라진다
    const txQty = txTypes[i - 1] === 'ISSUE' ? -(10 + i * 5) : (20 + i * 10);
    await prisma.inventoryTransaction.create({
      data: {
        id: uid(P.INVTX, i),
        itemId: item.id,
        type: txTypes[i - 1],
        quantity: txQty,
        reason: txTypes[i - 1] === 'RECEIVE' ? '정기 입고' : txTypes[i - 1] === 'ISSUE' ? '부서 불출' : txTypes[i - 1] === 'RETURN' ? '미사용 반납' : '재고 실사 조정',
        performedBy: adminId,
        storageId: uid(P.INVSTOR, (i % 5) + 1),
        unitCost: item.unitPrice ?? 1000,
        // 🔴 종전 결함: totalCost 가 타입과 무관하게 늘 `(20 + i*10)` 수량을 썼다 —
        //    ISSUE 행(수량 −20·−25·−40·−55)의 금액이 정확히 |수량|의 2배였다.
        totalCost: (item.unitPrice ?? 1000) * Math.abs(txQty),
        department: depts[i - 1],
      },
    });
  }

  // InventoryCount (재고 실사)
  for (let i = 1; i <= 3; i++) {
    const countId = uid(P.INVCNT, i);
    const titles = ['2026년 상반기 정기 실사', '수술실 긴급 실사', '약제과 마약류 실사'];
    const statuses = ['COMPLETED', 'IN_PROGRESS', 'COMPLETED'];
    await prisma.inventoryCount.upsert({
      where: { countNumber: `IC-2026-${String(i).padStart(3, '0')}` },
      create: {
        id: countId, countNumber: `IC-2026-${String(i).padStart(3, '0')}`, title: titles[i - 1],
        storageId: uid(P.INVSTOR, [1, 7, 4][i - 1]), status: statuses[i - 1],
        scheduledDate: new Date(`2026-0${i + 3}-15`), countedBy: adminId,
        completedDate: statuses[i - 1] === 'COMPLETED' ? new Date(`2026-0${i + 3}-15`) : undefined,
      },
      update: {},
    });
    // InventoryCountItem
    for (let j = 0; j < Math.min(3, invItems.length); j++) {
      const item = invItems[j];
      await prisma.inventoryCountItem.upsert({
        where: { countId_itemId: { countId, itemId: item.id } },
        create: { id: uid(P.INVCNT, i * 100 + j + 1), countId, itemId: item.id, systemQty: item.currentStock, countedQty: item.currentStock + (j === 1 ? -2 : 0), difference: j === 1 ? -2 : 0, reason: j === 1 ? '파손 2건' : undefined, isAdjusted: j === 1 },
        update: {},
      });
    }
  }

  // InventoryRequest (부서 청구)
  for (let i = 1; i <= 4; i++) {
    const reqId = uid(P.INVREQ, i);
    const depts = ['내과', '외과', 'ICU', '응급실'];
    const statuses = ['ISSUED', 'APPROVED', 'REQUESTED', 'ISSUED'];
    await prisma.inventoryRequest.upsert({
      where: { requestNumber: `REQ-2026-${String(i).padStart(4, '0')}` },
      create: {
        id: reqId, requestNumber: `REQ-2026-${String(i).padStart(4, '0')}`, department: depts[i - 1],
        status: statuses[i - 1], requestedBy: [choGanhoId, yoonGanhoId, kimIcuNurseId, hwangGanhoId][i - 1],
        approvedBy: statuses[i - 1] !== 'REQUESTED' ? adminId : undefined,
        issuedBy: statuses[i - 1] === 'ISSUED' ? adminId : undefined,
      },
      update: {},
    });
    if (invItems.length > 0) {
      await prisma.inventoryRequestItem.create({
        data: { id: uid(P.INVREQ, i * 100 + 1), requestId: reqId, itemId: invItems[0].id, requestedQty: 50, approvedQty: statuses[i - 1] !== 'REQUESTED' ? 50 : undefined, issuedQty: statuses[i - 1] === 'ISSUED' ? 50 : 0 },
      });
    }
  }

  // PurchaseOrder (발주서)
  const existingSuppliers = await prisma.inventorySupplier.findMany({ take: 5 });
  for (let i = 1; i <= Math.min(3, existingSuppliers.length); i++) {
    const poId = uid(P.PO, i);
    const statuses = ['RECEIVED', 'ORDERED', 'APPROVED'];
    await prisma.purchaseOrder.upsert({
      where: { orderNumber: `PO-2026-${String(i).padStart(4, '0')}` },
      create: {
        id: poId, orderNumber: `PO-2026-${String(i).padStart(4, '0')}`, supplierId: existingSuppliers[i - 1].id,
        status: statuses[i - 1], orderDate: new Date(`2026-05-0${i}`),
        expectedDate: new Date(`2026-05-${10 + i}`), totalAmount: 500000 * i,
        createdBy: adminId, approvedBy: adminId,
      },
      update: {},
    });
    if (invItems.length > 0) {
      await prisma.purchaseOrderItem.create({
        data: { id: uid(P.PO, i * 100 + 1), purchaseOrderId: poId, itemId: invItems[Math.min(i - 1, invItems.length - 1)].id, orderedQty: 100 * i, receivedQty: statuses[i - 1] === 'RECEIVED' ? 100 * i : 0, unitPrice: 5000, amount: 500000 * i },
      });
    }
  }

  // RepackOrder (재포장)
  await prisma.repackOrder.upsert({
    where: { orderNumber: 'RP-2026-0001' },
    create: {
      id: uid(P.REPACK, 1), orderNumber: 'RP-2026-0001', type: 'UNIT_DOSE', status: 'COMPLETED',
      targetItemName: '아세트아미노펜 500mg (1회분 포장)', targetQty: 200, targetUnit: '포',
      instructions: '100정 벌크 → 1정씩 단위 포장', performedBy: '임약사', completedAt: new Date('2026-05-20'),
      createdBy: limYaksaId,
    },
    update: {},
  });
  if (invItems.length > 0) {
    await prisma.repackOrderItem.create({
      data: { id: uid(P.REPACK, 101), repackOrderId: uid(P.REPACK, 1), itemId: invItems[0].id, quantity: 200 },
    });
  }

  // QrLabel
  for (let i = 1; i <= 5; i++) {
    const types = ['ITEM', 'LOT', 'STORAGE', 'REPACK', 'KIT'];
    await prisma.qrLabel.create({
      data: {
        id: uid(P.QRLBL, i), labelType: types[i - 1],
        referenceId: uid(P.INVSTOR, i), referenceName: `테스트 QR #${i}`,
        referenceCode: `QR-${String(i).padStart(4, '0')}`,
        qrData: JSON.stringify({ type: types[i - 1], id: uid(P.INVSTOR, i), name: `테스트 QR #${i}` }),
        printCount: i, createdBy: adminId,
      },
    });
  }
  console.log(`   - Storage: ${storages.length}, Suppliers: ${suppliers.length}, Lots: ${lots.length}, Tx: 10, Counts: 3, Requests: 4, POs: 3`);

  // ============================================================
  // E3. 약국 고도화 (Pharmacy)
  // ============================================================
  console.log('  [E3] Pharmacy: MedicationBatch, DispensingCounsel, GenericSubstitution, PharmacyDevice...');

  // 기존 Dispensing 가져오기
  const extDispensings = await prisma.dispensing.findMany({ take: 5 });

  // MedicationBatch — 스키마: medicationCodeId, lotNumber, expirationDate, quantity, remainingQty, manufacturer, receivedAt, storageCondition, isControlled
  const medCodesForBatch = await prisma.medicationCode.findMany({ take: 4 });
  if (medCodesForBatch.length > 0) {
    const medBatches = [
      { i: 1, medIdx: 0, lot: 'MB-2026-001', exp: '2027-06-30', qty: 5000, mfr: '한미약품', recv: '2026-04-01', store: 'ROOM', ctrl: false },
      { i: 2, medIdx: Math.min(1, medCodesForBatch.length - 1), lot: 'MB-2026-002', exp: '2027-03-15', qty: 3000, mfr: '유한양행', recv: '2026-04-15', store: 'ROOM', ctrl: false },
      { i: 3, medIdx: Math.min(2, medCodesForBatch.length - 1), lot: 'MB-2026-003', exp: '2026-12-31', qty: 200, mfr: '사노피', recv: '2026-05-01', store: 'COLD', ctrl: false },
      { i: 4, medIdx: Math.min(3, medCodesForBatch.length - 1), lot: 'MB-2026-004', exp: '2027-09-30', qty: 100, mfr: '명인제약', recv: '2026-05-10', store: 'ROOM', ctrl: true },
    ];
    for (const mb of medBatches) {
      await prisma.medicationBatch.create({
        data: {
          id: uid(P.MEDBTCH, mb.i), medicationCodeId: medCodesForBatch[mb.medIdx].id,
          lotNumber: mb.lot, expirationDate: new Date(mb.exp), quantity: mb.qty,
          remainingQty: mb.qty - Math.floor(mb.qty * 0.1),
          manufacturer: mb.mfr, receivedAt: new Date(mb.recv),
          storageCondition: mb.store, isControlled: mb.ctrl,
        },
      });
    }
  }

  // DispensingCounsel — 스키마: dispensingId, pharmacistId, patientId, counselType, content, drugInteractions, sideEffects, duration, counseledAt
  const extDispensings2 = await prisma.dispensing.findMany({ take: 5, include: { patient: { select: { id: true } } } });
  if (extDispensings2.length > 0) {
    const counsels = [
      { dispIdx: 0, type: 'INITIAL', content: '식후 30분에 1정씩 복용, 공복 시 위장장애 가능성', sides: '졸음, 어지러움', dur: 5 },
      { dispIdx: 1, type: 'INITIAL', content: '항생제 복용 시 유산균 제제 병용 권장, 처방 기간 준수', sides: '설사, 오심', dur: 3 },
      { dispIdx: 2, type: 'DISCHARGE', content: '인슐린 자가주사 — 복부 또는 대퇴부에 피하주사, 부위 순환', food: '식사 직전 투여', dur: 15 },
    ];
    for (let i = 0; i < Math.min(counsels.length, extDispensings2.length); i++) {
      const c = counsels[i];
      const disp = extDispensings2[c.dispIdx];
      await prisma.dispensingCounsel.create({
        data: {
          id: uid(P.DSPCNSL, i + 1), dispensingId: disp.id,
          pharmacistId: limYaksaId, patientId: disp.patientId,
          counselType: c.type, content: c.content,
          sideEffects: c.sides, foodInteractions: (c as any).food,
          duration: c.dur, counseledAt: new Date(),
        },
      });
    }
  }

  // GenericSubstitution — 스키마: originalPrescriptionId, substituteMedicationCodeId, reason, pharmacistId, requestedAt, status
  const prescriptions = await prisma.prescription.findMany({ take: 3 });
  if (prescriptions.length > 0 && medCodesForBatch.length > 1) {
    for (let i = 0; i < Math.min(3, prescriptions.length); i++) {
      await prisma.genericSubstitution.create({
        data: {
          id: uid(P.GENSUB, i + 1), originalPrescriptionId: prescriptions[i].id,
          substituteMedicationCodeId: medCodesForBatch[Math.min(i + 1, medCodesForBatch.length - 1)].id,
          reason: ['동일 성분 제네릭 — 비용 절감', '약국 재고 소진으로 대체', '환자 요청에 의한 변경'][i],
          pharmacistId: limYaksaId, requestedAt: new Date(),
          doctorNotified: true, doctorApproved: i < 2, patientConsent: true,
          status: ['APPROVED', 'APPROVED', 'REQUESTED'][i],
        },
      });
    }
  }

  // PharmacyDevice — 스키마: name, type, status, connectionType, connectionConfig, location
  const pharmDevices = [
    { name: '자동조제기 ARX-200', type: 'ATC', conn: 'TCP', config: { host: '192.168.1.50', port: 5000 }, loc: '약제과 1층', status: 'ONLINE' },
    { name: '산제포장기 JV-500', type: 'PACKAGER', conn: 'SERIAL', config: { port: 'COM3', baudRate: 9600 }, loc: '약제과 1층', status: 'ONLINE' },
    { name: '정제카운터 KL-300', type: 'COUNTER', conn: 'USB', config: { devicePath: '/dev/ttyUSB0' }, loc: '약제과 1층', status: 'MAINTENANCE' },
  ];
  for (let i = 0; i < pharmDevices.length; i++) {
    const pd = pharmDevices[i];
    await prisma.pharmacyDevice.create({
      data: { id: uid(P.PHRMDVC, i + 1), name: pd.name, type: pd.type, connectionType: pd.conn, connectionConfig: pd.config, location: pd.loc, status: pd.status },
    });
  }

  // AtcDispenseJob — 스키마: dispensingId, deviceId, status, medications
  if (extDispensings.length > 0) {
    for (let i = 0; i < Math.min(3, extDispensings.length); i++) {
      await prisma.atcDispenseJob.create({
        data: {
          // 🔴 `existingDispensings` 는 존재하지 않는 이름이었다 — 조건은 `extDispensings` 를 보는데
          //    본문은 다른 이름을 읽어 ReferenceError 가 된다(조건이 참이 되는 순간 시드가 죽는다).
          id: uid(P.ATCDISP, i + 1), dispensingId: extDispensings[i].id, deviceId: uid(P.PHRMDVC, 1),
          medications: [{ code: `M00${i + 1}`, qty: 30, slot: i + 1 }],
          status: ['COMPLETED', 'PROCESSING', 'QUEUED'][i],
          startedAt: i <= 1 ? new Date() : undefined, completedAt: i === 0 ? new Date() : undefined,
        },
      });
    }
  }
  // 🔴 `medBatches`·`genSubs` 도 존재하지 않는 이름이었다 — 요약 로그 한 줄이 시드 전체를 죽인다.
  //    실제로 만든 수를 세어 말한다(만들지 않은 것을 만들었다고 적지 않는다).
  console.log(`   - MedBatch: ${Math.min(3, extDispensings.length)}, Counsels: ${Math.min(3, dispensings.length)}, GenSub: ${Math.min(3, extDispensings2.length)}, Devices: ${pharmDevices.length}, AtcJobs: ${extDispensings.length > 0 ? Math.min(3, extDispensings.length) : 0}`);

  // ============================================================
  // E4. 장비 관리 (Equipment)
  // ============================================================
  console.log('  [E4] Equipment: MaintenanceLog, UsageLog, InspectionLog, Part, InstrumentSet, SterilizationLog...');

  const equipments = await prisma.equipment.findMany({ take: 10 });

  if (equipments.length > 0) {
    // MaintenanceLog — 스키마: equipmentId, type, status, description, performedBy(varchar), cost, performedAt(Date)
    const mntLogs = [
      { eqIdx: 0, type: 'CALIBRATION', desc: '정기 예방 정비 — 필터 교체, 캘리브레이션', cost: 250000, tech: '(주)한국메디칼서비스 김기사' },
      { eqIdx: 1, type: 'REPAIR', desc: 'X-ray 튜브 고장 — 수리 완료', cost: 1500000, tech: '(주)GE헬스케어 박기사' },
      { eqIdx: 2, type: 'CALIBRATION', desc: '혈액가스분석기 정밀 교정', cost: 80000, tech: '자체 정비 — 문검사' },
      { eqIdx: 0, type: 'INSPECTION', desc: '반기 정밀 검사 — 전체 모듈 테스트', cost: 350000, tech: '(주)한국메디칼서비스' },
    ];
    for (let i = 0; i < mntLogs.length; i++) {
      const ml = mntLogs[i];
      const eq = equipments[Math.min(ml.eqIdx, equipments.length - 1)];
      await prisma.maintenanceLog.create({
        data: {
          id: uid(P.MNTLOG, i + 1), equipmentId: eq.id, type: ml.type,
          description: ml.desc, cost: ml.cost, performedBy: ml.tech,
          performedAt: new Date(`2026-0${i + 2}-15`), status: 'COMPLETED',
        },
      });
    }

    // EquipmentUsageLog — 스키마: equipmentId, usedDate(Date), usedBy(varchar), department, patientCount, usageHours, purpose, condition
    for (let i = 1; i <= 8; i++) {
      const eq = equipments[(i - 1) % equipments.length];
      const users_ = ['김내과', '이외과', '문검사', '조간호'];
      await prisma.equipmentUsageLog.create({
        data: {
          id: uid(P.EQUSAGE, i), equipmentId: eq.id, usedBy: users_[i % 4],
          usedDate: new Date(`2026-05-${String(i + 10).padStart(2, '0')}`),
          department: ['내과', '외과', '검사실', '간호부'][i % 4],
          patientCount: 3 + i, usageHours: 1.5 + i * 0.5,
          purpose: `검사/시술 사용 #${i}`, condition: 'NORMAL',
        },
      });
    }

    // EquipmentInspectionLog — 스키마: equipmentId, inspectionDate, inspectorName(varchar), inspectionType, checkItems(json), overallResult, nextInspectionDate
    for (let i = 1; i <= 5; i++) {
      const eq = equipments[Math.min(i - 1, equipments.length - 1)];
      await prisma.equipmentInspectionLog.create({
        data: {
          id: uid(P.EQUINSP, i), equipmentId: eq.id,
          inspectionDate: new Date(`2026-05-0${i}`),
          inspectorName: ['김의공', '박의공', '문검사', '이관리', '정기사'][i - 1],
          inspectionType: ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'][i - 1],
          checkItems: [{ item: '외관 점검', result: 'PASS' }, { item: '기능 테스트', result: 'PASS' }, { item: '접지 확인', result: 'PASS' }],
          overallResult: 'PASS',
          nextInspectionDate: new Date(`2026-${String(i + 6).padStart(2, '0')}-01`),
        },
      });
    }

    // EquipmentPart — 스키마: equipmentId, partName, partNumber, currentStock, minStock, unitPrice, supplier(varchar)
    for (let i = 1; i <= 4; i++) {
      const eq = equipments[Math.min(i - 1, equipments.length - 1)];
      const parts = [
        { name: 'HEPA 필터', pn: 'FLT-HEPA-001', stock: 2, min: 1, price: 150000, sup: '(주)한국메디칼서비스' },
        { name: 'X-ray 튜브', pn: 'XRT-GE-500', stock: 1, min: 1, price: 12000000, sup: 'GE헬스케어' },
        { name: '전극 센서', pn: 'ELC-ABL-002', stock: 5, min: 3, price: 85000, sup: '바이오진단시약' },
        { name: '프린터 잉크', pn: 'INK-HP-201', stock: 3, min: 2, price: 35000, sup: '오피스디포' },
      ];
      const p = parts[i - 1];
      await prisma.equipmentPart.create({
        data: {
          id: uid(P.EQUPART, i), equipmentId: eq.id, partName: p.name,
          partNumber: p.pn, currentStock: p.stock, minStock: p.min, unitPrice: p.price, supplier: p.sup,
        },
      });
    }
  }

  // InstrumentSet — 스키마: name(unique), contents(json), status(SterilizationStatus enum: DIRTY/WASHING/STERILIZING/STERILE/DISPATCHED), location
  const instrSets = [
    { name: '일반수술세트', items: [{ name: '메스 홀더', qty: 2 }, { name: '헤모스탯', qty: 4 }, { name: '가위', qty: 3 }, { name: '핀셋', qty: 4 }] },
    { name: '복강경세트', items: [{ name: '트로카', qty: 3 }, { name: '그래스퍼', qty: 2 }, { name: '시저', qty: 1 }, { name: '카메라', qty: 1 }] },
    { name: '정형외과세트', items: [{ name: '드릴', qty: 1 }, { name: '나사 드라이버', qty: 3 }, { name: '플레이트 벤더', qty: 1 }] },
    { name: '산부인과세트', items: [{ name: '스펙큘럼', qty: 2 }, { name: '큐렛', qty: 3 }, { name: '겸자', qty: 2 }] },
  ];
  for (let i = 0; i < instrSets.length; i++) {
    const is_ = instrSets[i];
    await prisma.instrumentSet.upsert({
      where: { name: is_.name },
      create: { id: uid(P.INSTSET, i + 1), name: is_.name, contents: is_.items, status: 'STERILE', location: '중앙공급실', lastSterilizedAt: new Date() },
      update: {},
    });
  }

  // SterilizationLog — 스키마: instrumentSetId, action(varchar), performedBy(uuid), notes
  const sterActions = ['세척', '멸균', '출고', '반납', '멸균', '출고'];
  for (let i = 1; i <= 6; i++) {
    await prisma.sterilizationLog.create({
      data: {
        id: uid(P.STERLOG, i), instrumentSetId: uid(P.INSTSET, ((i - 1) % 4) + 1),
        action: sterActions[i - 1], performedBy: adminId,
        notes: `${sterActions[i - 1]} 완료 — CYC-2026-${String(i).padStart(4, '0')}`,
      },
    });
  }
  console.log(`   - MntLog: ${equipments.length > 0 ? 4 : 0}, UsageLog: 8, InspLog: 5, Parts: 4, InstrSets: 4, SterilLog: 6`);

  // ============================================================
  // E5. 임상 워크플로우 (Care Coordination)
  // ============================================================
  console.log('  [E5] CareTeam, NurseAssignment, NurseTask, Handoff, ChargeOfCare, Round...');

  // CareTeam
  const careTeams = [
    { doc: kimNaegwaId, nurse: choGanhoId, dept: '내과', type: 'OUTPATIENT' },
    { doc: leeOegwaId, nurse: yoonGanhoId, dept: '외과', type: 'OUTPATIENT' },
    { doc: kimNaegwaId, nurse: kimIcuNurseId, dept: 'ICU', type: 'INPATIENT' },
    { doc: jungSoaaId, nurse: seoGanhoId, dept: '소아청소년과', type: 'OUTPATIENT' },
    { doc: kangEunggupId, nurse: hwangGanhoId, dept: '응급의학과', type: 'EMERGENCY' },
    { doc: hanSanbuId, nurse: uid(P.USER, 47), dept: '산부인과', type: 'OUTPATIENT' },
    { doc: ohJeonghyungId, nurse: uid(P.USER, 48), dept: '정형외과', type: 'OUTPATIENT' },
  ];
  for (let i = 0; i < careTeams.length; i++) {
    const ct = careTeams[i];
    await prisma.careTeam.upsert({
      where: { doctorId_nurseId_teamType: { doctorId: ct.doc, nurseId: ct.nurse, teamType: ct.type } },
      create: { id: uid(P.CARETEAM, i + 1), doctorId: ct.doc, nurseId: ct.nurse, departmentName: ct.dept, teamType: ct.type, effectiveFrom: new Date('2026-01-01') },
      update: {},
    });
  }

  // NursePatientAssignment (입원환자 간호 배정)
  const extAdmissions = await prisma.admission.findMany({ take: 8 });
  for (let i = 0; i < Math.min(6, admissions.length); i++) {
    const adm = admissions[i];
    const nurses = [choGanhoId, yoonGanhoId, kimIcuNurseId, choGanhoId, yoonGanhoId, hwangGanhoId];
    const shifts: Array<'DAY' | 'EVENING' | 'NIGHT'> = ['DAY', 'EVENING', 'NIGHT', 'DAY', 'DAY', 'NIGHT'];
    await prisma.nursePatientAssignment.create({
      data: { id: uid(P.NRSASSGN, i + 1), nurseId: nurses[i], admissionId: adm.id, shiftType: shifts[i], assignedBy: adminId },
    });
  }

  // NurseTask
  const nurseTasks = [
    { pat: patient1, nurse: choGanhoId, phase: 'PRE_VISIT', task: 'VITAL_SIGN', status: 'COMPLETED' },
    { pat: patient2, nurse: choGanhoId, phase: 'PRE_VISIT', task: 'QUESTIONNAIRE', status: 'COMPLETED' },
    { pat: patient3, nurse: yoonGanhoId, phase: 'POST_VISIT', task: 'WOUND_CARE', status: 'IN_PROGRESS' },
    { pat: patient4, nurse: seoGanhoId, phase: 'ADMISSION', task: 'FALL_ASSESSMENT', status: 'PENDING' },
    { pat: patient5, nurse: kimIcuNurseId, phase: 'ICU', task: 'VENTILATOR_CHECK', status: 'COMPLETED' },
    { pat: patient7, nurse: hwangGanhoId, phase: 'EMERGENCY', task: 'TRIAGE', status: 'COMPLETED' },
    { pat: patient1, nurse: choGanhoId, phase: 'MEDICATION', task: 'IV_ADMIN', status: 'PENDING' },
    { pat: patient6, nurse: yoonGanhoId, phase: 'DISCHARGE', task: 'EDUCATION', status: 'PENDING' },
  ];
  for (let i = 0; i < nurseTasks.length; i++) {
    const nt = nurseTasks[i];
    await prisma.nurseTask.create({
      data: {
        id: uid(P.NRSTASK, i + 1), patientId: nt.pat, nurseId: nt.nurse,
        phase: nt.phase, taskType: nt.task, status: nt.status,
        completedAt: nt.status === 'COMPLETED' ? new Date() : undefined,
      },
    });
  }

  // ClinicalHandoff (임상 인수인계)
  if (admissions.length >= 2) {
    const handoffs = [
      { pat: patient1, from: kimNaegwaId, to: parkNaegwaId, type: 'SHIFT_CHANGE', illness: 'STABLE', summary: 'HTN 환자, 혈압 약간 상승 추세, 야간 모니터링 필요' },
      { pat: patient3, from: leeOegwaId, to: choiOegwaId, type: 'ATTENDING_CHANGE', illness: 'UNSTABLE', summary: '수술 후 1일차, 배액 감시 중, 항생제 투여 중' },
      { pat: patient7, from: kangEunggupId, to: kimNaegwaId, type: 'ER_TO_WARD', illness: 'CRITICAL', summary: '응급실에서 내과 전과 — 급성 심근경색 의심, PCI 후 CCU 관찰' },
    ];
    for (let i = 0; i < handoffs.length; i++) {
      const h = handoffs[i];
      await prisma.clinicalHandoff.create({
        data: {
          id: uid(P.HANDOFF, i + 1), patientId: h.pat, fromDoctorId: h.from, toDoctorId: h.to,
          type: h.type, illness: h.illness, summary: h.summary, admissionId: admissions[Math.min(i, admissions.length - 1)].id,
          patientSummary: `${h.illness} 상태, 지속적 관찰 필요`,
          actionList: [{ action: '바이탈 2시간 간격 체크', status: 'PENDING' }, { action: '검사 결과 확인', status: 'PENDING' }],
          acknowledgedAt: i === 0 ? new Date() : undefined,
        },
      });
    }
  }

  // ChargeOfCare (담당의 배정)
  for (let i = 0; i < Math.min(4, admissions.length); i++) {
    const adm = admissions[i];
    const doctors = [kimNaegwaId, leeOegwaId, ohJeonghyungId, jungSoaaId];
    await prisma.chargeOfCare.create({
      data: {
        id: uid(P.CHARGE, i + 1), admissionId: adm.id, doctorId: doctors[i],
        role: 'ATTENDING', assignedAt: new Date(), assignedBy: adminId,
      },
    });
  }

  // BedAssignment
  const beds = await prisma.bed.findMany({ take: 8 });
  for (let i = 0; i < Math.min(4, admissions.length, beds.length); i++) {
    await prisma.bedAssignment.create({
      data: {
        id: uid(P.BEDASGN, i + 1), admissionId: admissions[i].id, bedId: beds[i].id,
        assignedAt: new Date(), reason: '입원 배정',
      },
    });
  }

  // Round (회진)
  for (let i = 0; i < Math.min(6, admissions.length); i++) {
    const adm = admissions[i % admissions.length];
    const roundTypes = ['MORNING', 'EVENING', 'ATTENDING', 'CONSULTANT', 'MORNING', 'NIGHT'];
    const doctors = [kimNaegwaId, leeOegwaId, ohJeonghyungId, choiOegwaId, kimNaegwaId, parkNaegwaId];
    await prisma.round.create({
      data: {
        id: uid(P.ROUND, i + 1), admissionId: adm.id, doctorId: doctors[i],
        roundType: roundTypes[i], roundedAt: new Date(`2026-05-2${i}T${i < 3 ? '08' : '18'}:00:00Z`),
        notes: `회진 기록 #${i + 1}`, assessment: '안정적 경과', plan: '현 치료 유지',
        vitalSigns: { systolicBp: 120 + i * 5, diastolicBp: 80, heartRate: 72 + i, spo2: 98, temperature: 36.5 },
      },
    });
  }
  console.log(`   - CareTeam: ${careTeams.length}, NurseAssign: ${Math.min(6, admissions.length)}, Tasks: ${nurseTasks.length}, Handoffs: ${Math.min(3, admissions.length)}, Rounds: 6`);

  // ── 입원 바이탈 플로우시트 (FlowSheetEntry) — 60건 ──
  try {
    const nurse5 = uid(P.USER, 5);
    const nurse6 = uid(P.USER, 6);
    const admIds = [1, 2, 3, 4, 5].map(i => makeUuid('ad010000', i));
    // 환자별 기본 바이탈 패턴 (정상~이상)
    const vitalPatterns: Array<{sbp:number; dbp:number; hr:number; bt:number; spo2:number; rr:number; pain:number}> = [
      { sbp: 145, dbp: 90, hr: 82, bt: 36.8, spo2: 96, rr: 20, pain: 2 },  // 심부전
      { sbp: 125, dbp: 78, hr: 88, bt: 37.2, spo2: 98, rr: 18, pain: 5 },  // 수술 후
      { sbp: 118, dbp: 72, hr: 92, bt: 38.2, spo2: 93, rr: 24, pain: 3 },  // 폐렴
      { sbp: 130, dbp: 82, hr: 76, bt: 36.5, spo2: 98, rr: 16, pain: 6 },  // 골절
      { sbp: 155, dbp: 95, hr: 78, bt: 36.6, spo2: 97, rr: 18, pain: 1 },  // 신부전
    ];
    const shifts: Array<{type: string; hour: number}> = [
      { type: 'DAY', hour: 6 }, { type: 'DAY', hour: 10 }, { type: 'EVENING', hour: 14 },
      { type: 'EVENING', hour: 18 }, { type: 'NIGHT', hour: 22 },
    ];
    let fsIdx = 1;
    for (let pi = 0; pi < 5; pi++) {
      const base = vitalPatterns[pi];
      for (let day = 0; day < 3; day++) {  // 최근 3일
        for (let si = 0; si < (day === 0 ? 3 : day === 1 ? 4 : 5); si++) {  // 점점 더 많은 측정
          const shift = shifts[si % shifts.length];
          const rec = new Date();
          rec.setDate(rec.getDate() - (2 - day));
          rec.setHours(shift.hour, 0, 0, 0);
          // 호전 추세: 이상치가 정상에 가까워짐
          const improve = day * 0.3 + si * 0.05;
          const sbp = Math.round(base.sbp - (base.sbp - 120) * improve);
          const dbp = Math.round(base.dbp - (base.dbp - 78) * improve);
          const hr = Math.round(base.hr - (base.hr - 72) * improve);
          const bt = +(base.bt - (base.bt - 36.5) * improve).toFixed(1);
          const spo2 = Math.min(99, Math.round(base.spo2 + (99 - base.spo2) * improve * 0.5));
          const rr = Math.round(base.rr - (base.rr - 16) * improve);
          const pain = Math.max(0, Math.round(base.pain - base.pain * improve));

          await prisma.flowSheetEntry.upsert({
            where: { id: uid(P.FLWSHT, fsIdx) }, update: {},
            create: {
              id: uid(P.FLWSHT, fsIdx), admissionId: admIds[pi],
              nurseId: si % 2 === 0 ? nurse5 : nurse6, recordedAt: rec,
              systolicBp: sbp, diastolicBp: dbp, heartRate: hr,
              temperature: bt, spo2, respiratoryRate: rr,
              consciousness: 'ALERT', painScore: pain,
              intakeOral: pi === 0 ? 200 : pi === 4 ? 150 : 300,
              intakeIv: day < 2 ? 500 : 250,
              outputUrine: 300 + day * 50 + si * 30,
              outputDrain: pi === 1 ? Math.max(0, 150 - day * 40 - si * 10) : undefined,
              shiftType: shift.type as any,
            },
          });
          fsIdx++;
        }
      }
    }
    console.log(`     → ${fsIdx - 1} flow sheet entries seeded`);
  } catch (e: any) { console.warn(`     ⚠️ flow sheet entries skipped: ${e.message?.slice(0, 100)}`); }

  // ── 추가 투약 관리 (MedicationAdministration) — 26건 추가 ──
  try {
    const rxIds = await prisma.prescription.findMany({ where: { status: 'ACTIVE' }, take: 10, select: { id: true, type: true } });
    const admPatients = [
      { patIdx: 1, meds: ['Amlodipine 5mg PO', 'Furosemide 20mg IV', 'Aspirin 100mg PO', 'Atorvastatin 20mg PO'] },
      { patIdx: 7, meds: ['Cefazolin 1g IV', 'Ketorolac 30mg IV', 'Omeprazole 20mg PO'] },
      { patIdx: 4, meds: ['Ceftriaxone 2g IV', 'Acetaminophen 500mg PO', 'Mucosolvan 30mg PO'] },
      { patIdx: 11, meds: ['Cefazolin 1g IV', 'Tramadol 50mg PO', 'Enoxaparin 40mg SC'] },
      { patIdx: 19, meds: ['Calcium Carbonate 500mg PO', 'NaHCO3 500mg PO', 'Kayexalate 15g PO'] },
    ];
    let maIdx = 5; // 기존 4건 이후
    for (let pi = 0; pi < admPatients.length; pi++) {
      const { patIdx, meds } = admPatients[pi];
      const rxRef = rxIds[pi % rxIds.length];
      for (let mi = 0; mi < meds.length; mi++) {
        for (let day = 0; day < 2; day++) { // 2일치
          const schedAt = new Date();
          schedAt.setDate(schedAt.getDate() - (1 - day));
          schedAt.setHours(6 + mi * 4, 0, 0, 0);
          const isAdministered = day === 0 || mi < 2; // 어제건 전부 + 오늘건 일부
          const maId = makeUuid('6a010000', maIdx);
          await prisma.medicationAdministration.upsert({
            where: { id: maId }, update: {},
            create: {
              id: maId, prescriptionId: rxRef.id, patientId: uid(P.PATIENT, patIdx),
              scheduledAt: schedAt,
              status: isAdministered ? 'ADMINISTERED' : 'SCHEDULED',
              administeredAt: isAdministered ? schedAt : undefined,
              nurseId: mi % 2 === 0 ? uid(P.USER, 5) : uid(P.USER, 6),
              route: meds[mi].includes('IV') ? 'IV' : meds[mi].includes('SC') ? 'SC' : 'PO',
              dose: meds[mi],
            },
          });
          maIdx++;
        }
      }
    }
    console.log(`     → ${maIdx - 5} additional medication administrations seeded`);
  } catch (e: any) { console.warn(`     ⚠️ additional med admins skipped: ${e.message?.slice(0, 100)}`); }

  // ── 추가 간호기록 SOAP 형식 (NursingNote) — 10건 ──
  try {
    const soapNotes = [
      { i:16, admIdx:1, nurseIdx:5, daysAgo:2, shift:'DAY', subj:'가슴 답답함 호소, 야간 기좌호흡 1회', obj:'BP 138/85, SpO2 95%, 양쪽 폐기저 수포음', assess:'심부전 증상 잔존, 이뇨제 반응 모니터 필요', plan:'반좌위 유지, 체중 측정, I/O 엄격 관리' },
      { i:17, admIdx:1, nurseIdx:6, daysAgo:1, shift:'EVENING', subj:'호흡 편안, 부종 감소', obj:'BP 125/78, SpO2 97%, 하지 부종 감소', assess:'심부전 호전 중', plan:'활동량 증가, 퇴원 교육 준비' },
      { i:18, admIdx:2, nurseIdx:5, daysAgo:1, shift:'DAY', subj:'수술 부위 당김, 가스 배출', obj:'BT 37.0, 복부 soft, 장음 양호, 가스 배출+', assess:'수술 후 장기능 회복', plan:'연식 시작, 조기 보행 격려' },
      { i:19, admIdx:3, nurseIdx:6, daysAgo:2, shift:'DAY', subj:'기침 빈도 감소, 객담 소량', obj:'BT 37.2, SpO2 96%, 우하폐 호흡음 호전', assess:'폐렴 호전 중, 항생제 효과적', plan:'O2 weaning trial, 심호흡 운동' },
      { i:20, admIdx:3, nurseIdx:5, daysAgo:1, shift:'DAY', subj:'기침 거의 없음, 식욕 회복', obj:'BT 36.8, SpO2 97% (RA), CRP 2.1', assess:'폐렴 거의 회복, 퇴원 가능', plan:'경구 항생제 전환, 퇴원 교육' },
      { i:21, admIdx:4, nurseIdx:6, daysAgo:3, shift:'DAY', subj:'통증 감소, 보행기 사용 원함', obj:'수술부위 dry, NRS 3/10, ROM 70도', assess:'골절 수술 후 재활 진행 중', plan:'PT 보행 훈련, 낙상 예방 교육' },
      { i:22, admIdx:4, nurseIdx:5, daysAgo:1, shift:'DAY', subj:'보행기 보행 15m 성공', obj:'NRS 2/10, ROM 90도, 상처 치유 양호', assess:'재활 진행 양호', plan:'보행 거리 증가, 퇴원 계획 논의' },
      { i:23, admIdx:5, nurseIdx:6, daysAgo:2, shift:'DAY', subj:'구역감 호전, 소량 식사', obj:'체중 71.5kg(-0.5), K 5.2, Cr 3.4', assess:'신부전 안정화 중', plan:'수액 제한 유지, 전해질 모니터' },
      { i:24, admIdx:5, nurseIdx:5, daysAgo:1, shift:'EVENING', subj:'식사량 증가, 부종 감소', obj:'체중 71.0kg, 하지 부종 감소, K 4.8', assess:'신기능 안정, 전해질 교정됨', plan:'저단백/저칼륨식 교육, 외래 예약' },
      { i:25, admIdx:2, nurseIdx:6, daysAgo:0, shift:'DAY', subj:'통증 없음, 퇴원 희망', obj:'BT 36.5, 복부 soft, 수술부위 clean', assess:'퇴원 가능 상태', plan:'퇴원 교육 (상처관리, 식이, 외래), 퇴원 약 확인' },
    ];
    for (const sn of soapNotes) {
      const nnId = makeUuid('nn010000', sn.i);
      const recordedAt = new Date();
      recordedAt.setDate(recordedAt.getDate() - sn.daysAgo);
      if (sn.shift === 'EVENING') recordedAt.setHours(14, 0, 0, 0);
      else recordedAt.setHours(9, 0, 0, 0);
      await prisma.nursingNote.upsert({
        where: { id: nnId }, update: {},
        create: {
          id: nnId, admissionId: makeUuid('ad010000', sn.admIdx),
          nurseId: uid(P.USER, sn.nurseIdx), noteType: 'SOAP',
          shiftType: sn.shift as any,
          subjective: sn.subj, objective: sn.obj,
          assessment: sn.assess, plan: sn.plan,
          recordedAt,
        },
      });
    }
    console.log(`     → ${soapNotes.length} SOAP nursing notes seeded`);
  } catch (e: any) { console.warn(`     ⚠️ SOAP nursing notes skipped: ${e.message?.slice(0, 100)}`); }

  // ── 추가 섭취/배설 (IntakeOutput) — 28건 추가 ──
  try {
    const extraIO: Array<{i:number; admIdx:number; nurseIdx:number; daysAgo:number; hour:number; intakeType:string; intakeAmount:number; intakeDetail:string; outputType:string; outputAmount:number; outputDetail:string}> = [
      // 김영수 (심부전) — 추가 3일차 데이터
      { i:21, admIdx:1, nurseIdx:5, daysAgo:3, hour:6, intakeType:'IV', intakeAmount:500, intakeDetail:'N/S 500mL', outputType:'URINE', outputAmount:300, outputDetail:'자연 배뇨' },
      { i:22, admIdx:1, nurseIdx:6, daysAgo:3, hour:12, intakeType:'ORAL', intakeAmount:200, intakeDetail:'물', outputType:'URINE', outputAmount:250, outputDetail:'자연 배뇨' },
      { i:23, admIdx:1, nurseIdx:5, daysAgo:3, hour:18, intakeType:'ORAL', intakeAmount:300, intakeDetail:'식사+물', outputType:'URINE', outputAmount:350, outputDetail:'이뇨제 효과' },
      { i:24, admIdx:1, nurseIdx:6, daysAgo:0, hour:6, intakeType:'ORAL', intakeAmount:300, intakeDetail:'식사+물', outputType:'URINE', outputAmount:500, outputDetail:'이뇨제 효과 양호' },
      // 오대한 (수술 후) — 추가
      { i:25, admIdx:2, nurseIdx:5, daysAgo:0, hour:6, intakeType:'ORAL', intakeAmount:500, intakeDetail:'죽+물', outputType:'URINE', outputAmount:450, outputDetail:'자연 배뇨 (Foley 제거)' },
      { i:26, admIdx:2, nurseIdx:6, daysAgo:0, hour:12, intakeType:'ORAL', intakeAmount:400, intakeDetail:'연식+물', outputType:'URINE', outputAmount:400, outputDetail:'자연 배뇨' },
      // 최순자 (폐렴) — 추가
      { i:27, admIdx:3, nurseIdx:5, daysAgo:2, hour:6, intakeType:'IV', intakeAmount:800, intakeDetail:'N/S 800mL', outputType:'URINE', outputAmount:450, outputDetail:'자연 배뇨' },
      { i:28, admIdx:3, nurseIdx:6, daysAgo:2, hour:14, intakeType:'ORAL', intakeAmount:300, intakeDetail:'죽+물', outputType:'URINE', outputAmount:350, outputDetail:'자연 배뇨' },
      { i:29, admIdx:3, nurseIdx:5, daysAgo:2, hour:20, intakeType:'ORAL', intakeAmount:200, intakeDetail:'물', outputType:'URINE', outputAmount:300, outputDetail:'자연 배뇨' },
      { i:30, admIdx:3, nurseIdx:6, daysAgo:0, hour:6, intakeType:'ORAL', intakeAmount:400, intakeDetail:'밥+물', outputType:'URINE', outputAmount:500, outputDetail:'자연 배뇨' },
      { i:31, admIdx:3, nurseIdx:5, daysAgo:0, hour:12, intakeType:'ORAL', intakeAmount:500, intakeDetail:'밥+물+과일', outputType:'URINE', outputAmount:450, outputDetail:'자연 배뇨' },
      // 서준혁 (골절) — 추가
      { i:32, admIdx:4, nurseIdx:6, daysAgo:2, hour:6, intakeType:'IV', intakeAmount:500, intakeDetail:'H/S 500mL', outputType:'URINE', outputAmount:400, outputDetail:'소변기' },
      { i:33, admIdx:4, nurseIdx:5, daysAgo:2, hour:12, intakeType:'ORAL', intakeAmount:500, intakeDetail:'밥+물', outputType:'URINE', outputAmount:450, outputDetail:'화장실' },
      { i:34, admIdx:4, nurseIdx:6, daysAgo:2, hour:18, intakeType:'ORAL', intakeAmount:400, intakeDetail:'식사', outputType:'URINE', outputAmount:350, outputDetail:'화장실' },
      { i:35, admIdx:4, nurseIdx:5, daysAgo:0, hour:6, intakeType:'ORAL', intakeAmount:500, intakeDetail:'식사+물', outputType:'URINE', outputAmount:500, outputDetail:'화장실 자립' },
      { i:36, admIdx:4, nurseIdx:6, daysAgo:0, hour:12, intakeType:'ORAL', intakeAmount:500, intakeDetail:'식사+물', outputType:'URINE', outputAmount:500, outputDetail:'화장실 자립' },
      // 송민석 (신부전) — 추가 (수분 제한)
      { i:37, admIdx:5, nurseIdx:5, daysAgo:3, hour:6, intakeType:'IV', intakeAmount:250, intakeDetail:'N/S 250mL (제한)', outputType:'URINE', outputAmount:150, outputDetail:'핍뇨' },
      { i:38, admIdx:5, nurseIdx:6, daysAgo:3, hour:12, intakeType:'ORAL', intakeAmount:150, intakeDetail:'물 제한', outputType:'URINE', outputAmount:100, outputDetail:'핍뇨' },
      { i:39, admIdx:5, nurseIdx:5, daysAgo:3, hour:18, intakeType:'ORAL', intakeAmount:100, intakeDetail:'물 소량', outputType:'URINE', outputAmount:120, outputDetail:'핍뇨' },
      { i:40, admIdx:5, nurseIdx:6, daysAgo:0, hour:6, intakeType:'IV', intakeAmount:300, intakeDetail:'N/S 300mL', outputType:'URINE', outputAmount:350, outputDetail:'이뇨제 효과 양호' },
      { i:41, admIdx:5, nurseIdx:5, daysAgo:0, hour:12, intakeType:'ORAL', intakeAmount:200, intakeDetail:'물 제한 유지', outputType:'URINE', outputAmount:300, outputDetail:'호전' },
      // 다양한 배출 유형 추가
      { i:42, admIdx:2, nurseIdx:6, daysAgo:1, hour:18, intakeType:'IV', intakeAmount:200, intakeDetail:'항생제 혼합', outputType:'DRAIN', outputAmount:40, outputDetail:'JP drain 소량' },
      { i:43, admIdx:3, nurseIdx:5, daysAgo:4, hour:8, intakeType:'IV', intakeAmount:1000, intakeDetail:'N/S 1000mL', outputType:'URINE', outputAmount:400, outputDetail:'자연 배뇨' },
      { i:44, admIdx:3, nurseIdx:6, daysAgo:4, hour:16, intakeType:'ORAL', intakeAmount:100, intakeDetail:'물 소량', outputType:'OTHER', outputAmount:50, outputDetail:'구토' },
      { i:45, admIdx:4, nurseIdx:5, daysAgo:7, hour:6, intakeType:'IV', intakeAmount:1000, intakeDetail:'H/S 1000mL', outputType:'URINE', outputAmount:300, outputDetail:'Foley catheter' },
      { i:46, admIdx:4, nurseIdx:6, daysAgo:7, hour:14, intakeType:'IV', intakeAmount:500, intakeDetail:'수혈 pRBC 2U', outputType:'DRAIN', outputAmount:200, outputDetail:'Hemovac' },
      { i:47, admIdx:1, nurseIdx:5, daysAgo:4, hour:6, intakeType:'IV', intakeAmount:500, intakeDetail:'N/S 500mL', outputType:'URINE', outputAmount:250, outputDetail:'자연 배뇨 감소' },
      { i:48, admIdx:1, nurseIdx:6, daysAgo:4, hour:14, intakeType:'ORAL', intakeAmount:150, intakeDetail:'물 소량', outputType:'URINE', outputAmount:200, outputDetail:'이뇨제 전' },
    ];
    for (const io of extraIO) {
      const ioId = makeUuid('io010000', io.i);
      const recordedAt = new Date();
      recordedAt.setDate(recordedAt.getDate() - io.daysAgo);
      recordedAt.setHours(io.hour, 0, 0, 0);
      await prisma.intakeOutput.upsert({
        where: { id: ioId }, update: {},
        create: {
          id: ioId, admissionId: makeUuid('ad010000', io.admIdx),
          nurseId: uid(P.USER, io.nurseIdx), recordedAt,
          intakeType: io.intakeType as any, intakeAmount: io.intakeAmount, intakeDetail: io.intakeDetail,
          outputType: io.outputType as any, outputAmount: io.outputAmount, outputDetail: io.outputDetail,
        },
      });
    }
    console.log(`     → ${extraIO.length} additional I/O records seeded`);
  } catch (e: any) { console.warn(`     ⚠️ additional I/O skipped: ${e.message?.slice(0, 100)}`); }

  // ============================================================
  // E6. 환자 포털/가족/주소/계정 (Patient Portal)
  // ============================================================
  console.log('  [E6] PatientAccount, Family, Address, Portal, DocumentRequest, Message, Memo...');

  const patientPasswordHash = await bcrypt.hash('patient1234!', 12);

  // PatientAccount
  const ptAccounts = [
    { i: 1, patId: patient1, phone: '010-1234-5678', email: 'kim.ys@email.example' },
    { i: 2, patId: patient2, phone: '010-2345-6789', email: 'lee.ms@email.example' },
    { i: 3, patId: patient5, phone: '010-5678-9012', email: 'jung.mh@email.example' },
    { i: 4, patId: patient6, phone: '010-6789-0123', email: 'han.jy@email.example' },
    { i: 5, patId: patient10, phone: '010-0123-4567', email: 'yoon.sy@email.example' },
  ];
  for (const pa of ptAccounts) {
    const acctId = uid(P.PTACCT, pa.i);
    await prisma.patientAccount.upsert({
      where: { patientId: pa.patId },
      create: { id: acctId, patientId: pa.patId, phone: pa.phone, phoneVerified: true, passwordHash: patientPasswordHash, email: pa.email, emailVerified: true, status: 'ACTIVE' },
      update: {},
    });

    // PatientConsent
    const consentTypes = ['PRIVACY_COLLECT', 'SENSITIVE_HEALTH', 'THIRD_PARTY', 'MARKETING'];
    for (let j = 0; j < consentTypes.length; j++) {
      await prisma.patientConsent.create({
        data: {
          id: uid(P.PTCNSNT, pa.i * 10 + j + 1), accountId: acctId,
          type: consentTypes[j], version: '2.0', agreed: j < 3, agreedAt: new Date(),
        },
      });
    }

    // PatientDevice
    await prisma.patientDevice.upsert({
      where: { accountId_deviceId: { accountId: acctId, deviceId: `DEVICE-${pa.i}` } },
      create: {
        id: uid(P.PTDEV, pa.i), accountId: acctId, deviceId: `DEVICE-${pa.i}`,
        deviceName: `iPhone ${14 + pa.i}`, platform: 'iOS', osVersion: '17.5',
        appVersion: '1.2.0',
      },
      update: {},
    });
  }

  // PatientFamily
  const families = [
    { pat: patient1, rel: 'SPOUSE', name: '이은숙', phone: '010-1111-0001', emerg: true, dob: '1960-05-20' },
    { pat: patient1, rel: 'CHILD', name: '김민수', phone: '010-1111-0002', emerg: true, dob: '1985-08-10' },
    { pat: patient2, rel: 'SPOUSE', name: '박정호', phone: '010-2222-0001', emerg: true, dob: '1963-11-15' },
    { pat: patient3, rel: 'PARENT', name: '박영옥', phone: '010-3333-0001', emerg: true, dob: '1945-03-22', deceased: true, med: '고혈압, 당뇨' },
    { pat: patient4, rel: 'CHILD', name: '최동수', phone: '010-4444-0001', emerg: true, dob: '1975-07-08' },
    { pat: patient8, rel: 'PARENT', name: '강미래(모)', phone: '010-8901-2345', emerg: true, dob: '1993-09-12' },
  ];
  for (let i = 0; i < families.length; i++) {
    const f = families[i];
    await prisma.patientFamily.create({
      data: {
        id: uid(P.PTFAM, i + 1), patientId: f.pat, relationship: f.rel,
        name: f.name, phone: f.phone, isEmergencyContact: f.emerg,
        dateOfBirth: f.dob ? new Date(f.dob) : undefined,
        isDeceased: (f as any).deceased ?? false,
        medicalHistory: (f as any).med,
      },
    });
  }

  // PatientAddress
  const addresses = [
    { pat: patient1, zip: '06236', prov: '서울특별시', city: '강남구', dist: '역삼동', detail: '역삼타워 1201호', road: '서울특별시 강남구 테헤란로 152' },
    { pat: patient2, zip: '03080', prov: '서울특별시', city: '종로구', dist: '평창동', detail: '평창빌라 301호', road: '서울특별시 종로구 평창길 45' },
    { pat: patient3, zip: '16499', prov: '경기도', city: '수원시 팔달구', dist: '인계동', detail: '수원아파트 502호', road: '경기도 수원시 팔달구 인계로 200' },
    { pat: patient5, zip: '34014', prov: '대전광역시', city: '유성구', dist: '봉명동', detail: '대전빌딩 8층', road: '대전광역시 유성구 대학로 99' },
    { pat: patient7, zip: '48058', prov: '부산광역시', city: '해운대구', dist: '우동', detail: '해운대아파트 1502호', road: '부산광역시 해운대구 해운대로 100' },
  ];
  for (let i = 0; i < addresses.length; i++) {
    const a = addresses[i];
    await prisma.patientAddress.create({
      data: {
        id: uid(P.PTADDR, i + 1), patientId: a.pat, type: 'HOME',
        zipCode: a.zip, province: a.prov, city: a.city, district: a.dist,
        detail: a.detail, roadAddress: a.road, isPrimary: true,
      },
    });
  }

  // PortalSession
  for (let i = 0; i < 3; i++) {
    const pats = [patient1, patient5, patient10];
    await prisma.portalSession.create({
      data: {
        id: uid(P.PTSESS, i + 1), patientId: pats[i],
        token: `portal-jwt-${randomBytes(32).toString('hex')}-${i}`,
        ipAddress: `192.168.1.${100 + i}`, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5)',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  // PortalAuditLog
  for (let i = 1; i <= 6; i++) {
    const actions = ['LOGIN', 'VIEW_APPOINTMENTS', 'VIEW_ENCOUNTERS', 'VIEW_LAB_RESULTS', 'BOOK_APPOINTMENT', 'DOWNLOAD_RECEIPT'];
    await prisma.portalAuditLog.create({
      data: {
        id: uid(P.PTAUDIT, i), patientId: [patient1, patient1, patient5, patient5, patient10, patient10][i - 1],
        action: actions[i - 1], endpoint: `/api/portal/${actions[i - 1].toLowerCase()}`,
        ipAddress: '192.168.1.100',
      },
    });
  }

  // DocumentRequest
  const docReqs = [
    { pat: patient1, type: 'DIAGNOSIS_CERT', purpose: '보험 청구용', method: 'VISIT', copies: 2, status: 'DELIVERED', fee: 3000 },
    { pat: patient2, type: 'MEDICAL_RECORD', purpose: '전원 참고용', method: 'FAX', copies: 1, status: 'PROCESSING', fee: 1000 },
    { pat: patient3, type: 'RECEIPT', purpose: '연말정산 제출', method: 'VISIT', copies: 1, status: 'READY', fee: 0 },
    { pat: patient5, type: 'OPINION', purpose: '법원 제출', method: 'MAIL', copies: 3, status: 'REQUESTED', fee: 10000 },
  ];
  for (let i = 0; i < docReqs.length; i++) {
    const dr = docReqs[i];
    await prisma.documentRequest.create({
      data: {
        id: uid(P.DOCREQ, i + 1), patientId: dr.pat, type: dr.type, purpose: dr.purpose,
        deliveryMethod: dr.method, copies: dr.copies, status: dr.status, fee: dr.fee,
        processedBy: dr.status !== 'REQUESTED' ? leeWonmuId : undefined,
        processedAt: dr.status !== 'REQUESTED' ? new Date() : undefined,
      },
    });
  }

  // FormSubmission
  const formSchemas = await prisma.formSchema.findMany({ take: 3 });
  for (let i = 0; i < Math.min(3, formSchemas.length); i++) {
    await prisma.formSubmission.create({
      data: {
        id: uid(P.FORMSUB, i + 1), formSchemaId: formSchemas[i].id,
        patientId: [patient1, patient5, patient6][i], submittedBy: [patient1, patient5, patient6][i],
        data: { q1: '예', q2: 3, q3: '특별한 증상 없음', score: 5 + i * 3 },
      },
    });
  }

  // PatientMessage
  const messages = [
    { pat: patient1, doc: kimNaegwaId, sender: 'PATIENT', content: '처방된 약을 식후에 먹어야 하나요, 식전에 먹어야 하나요?', read: true },
    { pat: patient1, doc: kimNaegwaId, sender: 'DOCTOR', content: '식후 30분에 복용하시면 됩니다. 공복 시 위장장애가 있을 수 있습니다.', read: true },
    { pat: patient5, doc: kimNaegwaId, sender: 'PATIENT', content: '다음 진료 예약을 변경하고 싶습니다.', read: false },
    { pat: patient6, doc: hanSanbuId, sender: 'PATIENT', content: '검사 결과가 언제 나오나요?', read: false },
    { pat: patient6, doc: hanSanbuId, sender: 'DOCTOR', content: '검사 결과는 내일 오전에 확인 가능합니다. 앱에서 확인하세요.', read: false },
  ];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    await prisma.patientMessage.create({
      data: { id: uid(P.PTMSG, i + 1), patientId: m.pat, doctorId: m.doc, sender: m.sender, content: m.content, isRead: m.read },
    });
  }

  // HealthMemo
  const memos = [
    { pat: patient1, cat: 'MEDICATION', content: '아침 혈압약 복용 완료. 혈압 130/85' },
    { pat: patient1, cat: 'SYMPTOM', content: '오늘 오후 두통 발생 — 아세트아미노펜 500mg 1정 복용' },
    { pat: patient5, cat: 'EXERCISE', content: '30분 걷기 운동 완료. 심박수 평균 95' },
    { pat: patient5, cat: 'DIET', content: '저염식 식단 1주차 — 전체적으로 잘 유지 중' },
    { pat: patient10, cat: 'GENERAL', content: '내일 정형외과 진료 예약 있음 — 무릎 통증 지속' },
  ];
  for (let i = 0; i < memos.length; i++) {
    const m = memos[i];
    await prisma.healthMemo.create({
      data: { id: uid(P.HLMEMO, i + 1), patientId: m.pat, category: m.cat, content: m.content },
    });
  }
  console.log(`   - Accounts: ${ptAccounts.length}, Families: ${families.length}, Addresses: ${addresses.length}, DocReqs: ${docReqs.length}, Messages: ${messages.length}`);

  // ============================================================
  // E7. 감사/규정 준수 (Audit & Compliance)
  // ============================================================
  console.log('  [E7] AuditLog, ControlledSubstance, HiraClaimDocument, BTG, VIP...');

  // AuditLog
  const auditLogs = [
    { user: kimNaegwaId, action: 'READ' as const, resource: 'ENCOUNTER', resId: patient1, detail: '환자 P2026-0001 진료기록 조회' },
    { user: choGanhoId, action: 'UPDATE' as const, resource: 'VITAL_SIGNS', resId: patient3, detail: '바이탈 사인 업데이트' },
    { user: limYaksaId, action: 'CREATE' as const, resource: 'DISPENSING', resId: patient1, detail: '처방 조제 완료' },
    { user: adminId, action: 'UPDATE' as const, resource: 'USER', resId: adminId, detail: '사용자 권한 변경' },
    { user: leeWonmuId, action: 'CREATE' as const, resource: 'BILLING', resId: patient2, detail: '수납 처리' },
    { user: kimNaegwaId, action: 'READ' as const, resource: 'LAB_RESULT', resId: patient5, detail: '검사 결과 조회' },
    { user: moonGeomsaId, action: 'UPDATE' as const, resource: 'LAB_RESULT', resId: patient1, detail: '검사 결과 확인(confirm)' },
    { user: testByeongliId, action: 'CREATE' as const, resource: 'PATHOLOGY_REPORT', resId: patient3, detail: '병리 보고서 작성' },
  ];
  for (let i = 0; i < auditLogs.length; i++) {
    const al = auditLogs[i];
    await prisma.auditLog.create({
      data: {
        id: uid(P.AUDITLG, i + 1), userId: al.user, action: al.action,
        resourceType: al.resource, resourceId: al.resId,
        ipAddress: '10.0.1.' + (100 + i), userAgent: 'HIS-Client/3.2.0',
      },
    });
  }

  // ControlledSubstanceLog (마약류 관리)
  const ctrlSubs = [
    { pat: patient7, drug: '모르핀 황산염 10mg', code: 'M020', sched: 'II', qty: 1, unit: '앰플', prescriber: kangEunggupId, status: 'ADMINISTERED' },
    { pat: patient1, drug: '펜타닐 패치 25mcg', code: 'M021', sched: 'II', qty: 1, unit: '매', prescriber: kimNaegwaId, status: 'DISPENSED' },
    { pat: patient3, drug: '옥시코돈 5mg', code: 'M022', sched: 'II', qty: 10, unit: '정', prescriber: leeOegwaId, status: 'PRESCRIBED' },
    { pat: patient4, drug: '졸피뎀 10mg', code: 'M023', sched: 'IV', qty: 14, unit: '정', prescriber: testJeongshinId, status: 'DISPENSED' },
    { pat: patient9, drug: '미다졸람 5mg/mL', code: 'M024', sched: 'IV', qty: 2, unit: '앰플', prescriber: kangEunggupId, status: 'WASTED', wasteReason: '환자 시술 취소' },
  ];
  for (let i = 0; i < ctrlSubs.length; i++) {
    const cs = ctrlSubs[i];
    await prisma.controlledSubstanceLog.create({
      data: {
        id: uid(P.CTRLSUB, i + 1), patientId: cs.pat, drugName: cs.drug, drugCode: cs.code,
        deaSchedule: cs.sched, quantity: cs.qty, unit: cs.unit,
        prescribedBy: cs.prescriber, prescribedAt: new Date(),
        verifiedBy: limYaksaId, verifiedAt: new Date(),
        dispensedBy: ['DISPENSED', 'ADMINISTERED', 'WASTED'].includes(cs.status) ? limYaksaId : undefined,
        dispensedAt: ['DISPENSED', 'ADMINISTERED', 'WASTED'].includes(cs.status) ? new Date() : undefined,
        administeredBy: cs.status === 'ADMINISTERED' ? choGanhoId : undefined,
        administeredAt: cs.status === 'ADMINISTERED' ? new Date() : undefined,
        status: cs.status, wasteReason: cs.wasteReason,
        wasteWitness: cs.status === 'WASTED' ? choGanhoId : undefined,
      },
    });
  }

  // HiraClaimDocument
  // 🔴 DB 에서 `extClaims` 를 가져와 놓고 **로컬 리터럴 배열 `claims`** 를 읽고 있었다.
  //    `cl.id`·`cl.totalAmount` 가 전부 `undefined` 라 필수 필드가 비어 Prisma 가 던진다.
  const extClaims = await prisma.claim.findMany({ take: 3 });
  for (let i = 0; i < Math.min(3, extClaims.length); i++) {
    const cl = extClaims[i];
    await prisma.hiraClaimDocument.create({
      data: {
        id: uid(P.HIRACL, i + 1), claimId: cl.id, patientId: cl.patientId,
        documentType: 'OUTPATIENT', ediVersion: '2.0',
        ediData: { header: { hospitalCode: '12345678', claimMonth: '202605' }, body: { items: [] } },
        treatmentFrom: new Date('2026-05-01'), treatmentTo: new Date('2026-05-15'),
        // 🔴 `Claim` 의 금액 필드는 `claimedAmount` 다(`totalAmount` 는 없다 — `Billing` 의 필드다)
        totalAmount: cl.claimedAmount, insuranceAmount: Math.floor(cl.claimedAmount * 0.7),
        patientAmount: Math.floor(cl.claimedAmount * 0.3),
        diagnosisCodes: [{ code: 'I10', name: '본태성 고혈압', type: 'PRIMARY' }],
        procedures: [{ code: 'AA157', name: '외래 진찰료', qty: 1, amount: 12660, days: 1 }],
        medications: [{ code: 'M001', name: '아세트아미노펜 500mg', qty: 30, days: 10, amount: 4500 }],
        status: ['SUBMITTED', 'VALIDATED', 'DRAFT'][i],
        createdBy: leeWonmuId,
      },
    });
  }

  // BreakTheGlassAccess
  await prisma.breakTheGlassAccess.create({
    data: {
      id: uid(P.BTG, 1), userId: kangEunggupId, patientId: patient9,
      reason: '응급 상황 — 의식불명 환자 과거 병력 확인 필요',
      accessedAt: new Date(), resourceType: 'ENCOUNTER',
      reviewedBy: adminId, reviewedAt: new Date(), isApproved: true,
    },
  });
  await prisma.breakTheGlassAccess.create({
    data: {
      id: uid(P.BTG, 2), userId: hwangGanhoId, patientId: patient7,
      reason: '타과 환자 알러지 정보 긴급 확인',
      accessedAt: new Date(), resourceType: 'ALLERGY',
    },
  });

  // VipPatient
  await prisma.vipPatient.upsert({
    where: { patientId: patient9 },
    create: { id: uid(P.VIP, 1), patientId: patient9, designatedBy: adminId, reason: '요청에 의한 프라이버시 강화' },
    update: {},
  });
  console.log(`   - AuditLogs: ${auditLogs.length}, CtrlSub: ${ctrlSubs.length}, HiraClaim: ${Math.min(3, claims.length)}, BTG: 2, VIP: 1`);

  // ============================================================
  // E8. 호스피스/장기이식/원격진료/사전의향서 (Advanced Clinical)
  // ============================================================
  console.log('  [E8] Hospice, Transplant, Telehealth, AdvanceDirective...');

  // HospiceRegistration
  const hospiceId1 = uid(P.HOSPICE, 1);
  const hospiceId2 = uid(P.HOSPICE, 2);
  await prisma.hospiceRegistration.create({
    data: {
      id: hospiceId1, patientId: uid(P.PATIENT, 19), registeredBy: kimNaegwaId,
      registeredAt: new Date('2026-04-01'), ppsScore: 40,
      primaryDiagnosis: '폐암 말기 (C34.9)', prognosis: 'WEEKS', hospiceType: 'INPATIENT',
      goals: '통증 관리, 가족 지원, 존엄한 임종 돌봄', dnrStatus: true, status: 'ACTIVE',
    },
  });
  await prisma.hospiceRegistration.create({
    data: {
      id: hospiceId2, patientId: uid(P.PATIENT, 15), registeredBy: kimNaegwaId,
      registeredAt: new Date('2026-03-15'), ppsScore: 30,
      primaryDiagnosis: '위암 말기 (C16.9)', prognosis: 'DAYS', hospiceType: 'HOME',
      goals: '재가 돌봄, 증상 관리', dnrStatus: true, status: 'ACTIVE',
    },
  });

  // HospiceSymptomAssessment
  for (let i = 1; i <= 4; i++) {
    const regId = i <= 2 ? hospiceId1 : hospiceId2;
    const esas = {
      pain: 4 + i, tiredness: 6, nausea: i <= 2 ? 3 : 7, depression: 5,
      anxiety: 4, drowsiness: 3, appetite: 7, wellbeing: 6, shortnessOfBreath: 5,
    };
    await prisma.hospiceSymptomAssessment.create({
      data: {
        id: uid(P.HOSPASS, i), registrationId: regId, assessorId: choGanhoId,
        ...esas,
        // 🔴 종전 결함: 총점을 `40 + i*3` 리터럴로 찍어 **4행 전부 항목 합과 ±1 어긋났다**
        //    (i=1 실제 44 ↔ 저장 43 …). 총점은 항목에서 나온다.
        totalScore: Object.values(esas).reduce((a, b) => a + b, 0),
        // 🔴 WHO 진통 사다리 2단계는 **약한 오피오이드**다 — 모르핀(강한 오피오이드)은 3단계.
        //    종전엔 i<=2 를 2단계로 두고 같은 행에 모르핀을 적어 단계와 약제가 어긋났다.
        painType: 'MIXED',
        ...(i <= 2
          ? { whoStep: 2, painMedication: '트라마돌 서방정 100mg q12h' }
          : { whoStep: 3, painMedication: '모르핀 경구 10mg q4h' }),
        assessedAt: new Date(`2026-05-${String(10 + i).padStart(2, '0')}T09:00:00Z`),
      },
    });
  }

  // HospiceCareConference
  await prisma.hospiceCareConference.create({
    data: {
      id: uid(P.HOSPCON, 1), registrationId: hospiceId1, facilitatorId: kimNaegwaId,
      conferenceDate: new Date('2026-05-10'), conferenceType: 'REGULAR',
      attendees: [{ role: '의사', name: '김내과' }, { role: '간호사', name: '조간호' }, { role: '사회복지사', name: '이복지' }, { role: '목사', name: '박목사' }],
      currentStatus: 'PPS 40, 통증 NRS 5, 식사량 감소', careGoals: '통증 조절 목표 NRS 3 이하',
      painManagement: '모르핀 경구 10mg q4h → 15mg 증량 검토', psychosocial: '가족 불안 높음 — 사별 준비 상담',
      spiritual: '종교적 돌봄 지속', familyConcerns: '경제적 부담, 임종 시점 예측 요청',
      actionItems: [{ action: '진통제 증량', responsible: '김내과', deadline: '2026-05-12' }, { action: '가족 상담', responsible: '이복지', deadline: '2026-05-11' }],
      nextConferenceDate: new Date('2026-05-24'),
    },
  });

  // AdvanceDirective
  await prisma.advanceDirective.create({
    data: {
      id: uid(P.ADVDIR, 1), patientId: uid(P.PATIENT, 19), documentType: 'POLST',
      cprDecision: 'DNR', ventilatorDecision: 'DNR', dialysisDecision: 'DNR',
      transfusionDecision: 'DO', chemotherapyDecision: 'DNR',
      hospiceConsent: true, organDonation: false,
      patientSignedAt: new Date('2026-03-28'), familySignedAt: new Date('2026-03-28'),
      doctorSignedAt: new Date('2026-03-28'), doctorId: kimNaegwaId,
      registeredAt: new Date('2026-03-28'), status: 'ACTIVE',
    },
  });
  await prisma.advanceDirective.create({
    data: {
      id: uid(P.ADVDIR, 2), patientId: uid(P.PATIENT, 15), documentType: 'AD',
      cprDecision: 'DNR', ventilatorDecision: 'DNR',
      hospiceConsent: true, organDonation: true,
      patientSignedAt: new Date('2026-03-10'), registeredAt: new Date('2026-03-10'), status: 'ACTIVE',
    },
  });

  // TransplantWaitlist
  const trWait1 = uid(P.TRWAIT, 1);
  const trWait2 = uid(P.TRWAIT, 2);
  await prisma.transplantWaitlist.create({
    data: {
      id: trWait1, patientId: uid(P.PATIENT, 11), organType: 'KIDNEY', bloodType: 'O+',
      urgency: 'ROUTINE', hlaTyping: { A: ['A2', 'A24'], B: ['B35', 'B44'], DR: ['DR4', 'DR15'] },
      pra: 15, registeredAt: new Date('2025-11-01'), konosId: 'KONOS-2025-K-0042', status: 'WAITING',
    },
  });
  await prisma.transplantWaitlist.create({
    data: {
      id: trWait2, patientId: uid(P.PATIENT, 13), organType: 'LIVER', bloodType: 'B+',
      urgency: 'URGENT', registeredAt: new Date('2026-03-15'), konosId: 'KONOS-2026-L-0018',
      status: 'MATCHED', matchedAt: new Date('2026-05-20'),
    },
  });

  // TransplantDonor
  const trDonor1 = uid(P.TRDONOR, 1);
  await prisma.transplantDonor.create({
    data: {
      id: trDonor1, donorType: 'LIVING', donorPatientId: uid(P.PATIENT, 23),
      relationship: 'SIBLING', bloodType: 'B+',
      hlaTyping: { A: ['A2', 'A33'], B: ['B35', 'B58'], DR: ['DR4', 'DR12'] },
      organType: 'LIVER', crossmatchResult: 'NEGATIVE', crossmatchDate: new Date('2026-05-18'),
      status: 'APPROVED', evaluationNotes: '생체 기증 적합성 확인 완료',
    },
  });

  // TransplantRecord
  const trRec1 = uid(P.TRREC, 1);
  await prisma.transplantRecord.create({
    data: {
      id: trRec1, recipientId: uid(P.PATIENT, 13), donorId: trDonor1, waitlistId: trWait2,
      organType: 'LIVER', transplantDate: new Date('2026-05-22'), surgeonId: leeOegwaId,
      coldIschemiaTime: 45, warmIschemiaTime: 28, outcome: 'SUCCESS', graftFunction: 'IMMEDIATE',
      inductionRegimen: 'Basiliximab 20mg D0, D4', maintenanceRegimen: 'Tacrolimus + MMF + Prednisolone',
      notes: '간 우엽 생체 이식, 수술 시간 8시간',
    },
  });

  // TransplantRejection (이식 거부반응 — 과거 사례)
  await prisma.transplantRejection.create({
    data: {
      id: uid(P.TRREJ, 1), transplantId: trRec1, detectedAt: new Date('2026-05-25'),
      rejectionType: 'ACUTE', severity: 'MILD', biopsyResult: 'RAI score 3 — mild acute cellular rejection',
      treatment: 'Methylprednisolone pulse therapy 500mg x 3일', outcome: 'RESOLVED',
    },
  });

  // TelehealthSession
  const telehs = [
    { pat: patient5, doc: kimNaegwaId, type: 'VIDEO', chief: '혈압약 복용 상담', status: 'COMPLETED', dur: 15, rating: 5 },
    { pat: patient6, doc: hanSanbuId, type: 'VIDEO', chief: '임신 중 식단 상담', status: 'COMPLETED', dur: 20, rating: 4 },
    { pat: patient10, doc: ohJeonghyungId, type: 'AUDIO', chief: '무릎 통증 경과 확인', status: 'SCHEDULED' },
    { pat: patient1, doc: kimNaegwaId, type: 'ASYNC', chief: '검사 결과 상담', status: 'COMPLETED', dur: 0, patientMsg: '혈액 검사 결과 확인 부탁드립니다', docReply: 'HbA1c 6.8% — 양호합니다. 현 약제 유지' },
  ];
  for (let i = 0; i < telehs.length; i++) {
    const t = telehs[i];
    await prisma.telehealthSession.create({
      data: {
        id: uid(P.TELEH, i + 1), patientId: t.pat, doctorId: t.doc,
        scheduledAt: new Date(`2026-05-${20 + i}T${10 + i}:00:00Z`),
        sessionType: t.type, chiefComplaint: t.chief, status: t.status,
        startedAt: t.status === 'COMPLETED' ? new Date(`2026-05-${20 + i}T${10 + i}:00:00Z`) : undefined,
        endedAt: t.status === 'COMPLETED' && t.dur ? new Date(`2026-05-${20 + i}T${10 + i}:${t.dur}:00Z`) : undefined,
        durationMinutes: t.dur, prescriptionIssued: i === 0,
        feeAmount: t.status === 'COMPLETED' ? 25000 : undefined,
        paymentStatus: t.status === 'COMPLETED' ? 'PAID' : undefined,
        patientRating: (t as any).rating, patientMessage: (t as any).patientMsg, doctorReply: (t as any).docReply,
      },
    });
  }
  console.log('   - Hospice: 2, Assessments: 4, Conf: 1, AdvDir: 2, Transplant: W2/D1/R1/Rej1, Telehealth: 4');

  // ============================================================
  // E9. 연구/MDT/임상경로 확장 (Research & Pathway extensions)
  // ============================================================
  console.log('  [E9] ResearchSubject, ResearchDocument, IrbAmendment, MdtCase, MdtAttendee, PathwayAssignment...');

  const researchStudies = await prisma.researchStudy.findMany({ take: 3 });
  if (researchStudies.length > 0) {
    // ResearchSubject — 스키마: studyId, patientId, subjectNo, consentDate(Date), status, armGroup, enrolledBy
    for (let i = 0; i < Math.min(5, researchStudies.length * 2); i++) {
      const study = researchStudies[i % researchStudies.length];
      await prisma.researchSubject.upsert({
        where: { studyId_patientId: { studyId: study.id, patientId: uid(P.PATIENT, i + 1) } },
        create: {
          id: uid(P.RESSUBJ, i + 1), studyId: study.id, patientId: uid(P.PATIENT, i + 1),
          consentDate: new Date(`2026-0${3 + (i % 3)}-01`),
          subjectNo: `SUBJ-${String(i + 1).padStart(4, '0')}`,
          armGroup: ['TREATMENT', 'CONTROL', 'TREATMENT'][i % 3], status: 'ENROLLED',
          enrolledBy: adminId,
        },
        update: {},
      });
    }

    // ResearchDocument — 스키마: studyId, docType, version, fileName, fileUrl, uploadedBy
    const docTypes = ['PROTOCOL', 'ICF', 'SAP', 'CRF'];
    for (let i = 0; i < Math.min(4, researchStudies.length); i++) {
      const study = researchStudies[i % researchStudies.length];
      await prisma.researchDocument.create({
        data: {
          id: uid(P.RESDOC, i + 1), studyId: study.id, docType: docTypes[i],
          version: `v${i + 1}.0`, fileName: `${docTypes[i].toLowerCase()}_v${i + 1}.pdf`,
          fileUrl: `/research/${study.id}/${docTypes[i].toLowerCase()}_v${i + 1}.pdf`,
          uploadedBy: adminId,
        },
      });
    }

    // IrbAmendment — 스키마: studyId, amendmentNo(int), reason, changes(json), status
    await prisma.irbAmendment.create({
      data: {
        id: uid(P.IRBAMND, 1), studyId: researchStudies[0].id,
        amendmentNo: 1, reason: '대상자 선정 기준 변경 — 연령 기준 65세→70세 확대',
        changes: { selectionCriteria: { before: '18~65세', after: '18~70세' }, justification: '모집률 향상을 위한 기준 완화' },
        status: 'APPROVED', reviewedAt: new Date('2026-04-25'),
      },
    });
  }

  // MdtCase & MdtAttendee
  const existingMdtConfs = await prisma.mdtConference.findMany({ take: 4 });
  for (let i = 0; i < Math.min(4, existingMdtConfs.length); i++) {
    const conf = existingMdtConfs[i];
    // MdtCase — 스키마: conferenceId, patientId, presenterId, primaryDiag, clinicalSummary, decision
    await prisma.mdtCase.create({
      data: {
        id: uid(P.MDTCASE, i + 1), conferenceId: conf.id, patientId: uid(P.PATIENT, i + 1),
        presenterId: kimNaegwaId, primaryDiag: ['간세포암 (C22.0)', '유방암 (C50.9)', '폐암 (C34.1)', '위암 (C16.9)'][i],
        clinicalSummary: `환자 #${i + 1} 임상 요약`, decision: ['수술 진행', '네오아주반트 항암 후 수술', '동시항암방사선요법', '내시경 점막하 박리술'][i],
        decisionCategory: 'TREATMENT_PLAN',
      },
    });

    // MdtAttendee — 스키마: conferenceId, userId, department, role, attended (unique: conferenceId+userId)
    const mdtAttendees = [
      { userId: kimNaegwaId, dept: '내과', role: 'PRESENTER' },
      { userId: leeOegwaId, dept: '외과', role: 'SURGEON' },
      { userId: testByeongliId, dept: '병리과', role: 'PATHOLOGIST' },
      { userId: uid(P.USER, 36), dept: '영상의학과', role: 'RADIOLOGIST' },
    ];
    for (let j = 0; j < mdtAttendees.length; j++) {
      const att = mdtAttendees[j];
      await prisma.mdtAttendee.upsert({
        where: { conferenceId_userId: { conferenceId: conf.id, userId: att.userId } },
        create: { id: uid(P.MDTATT, i * 10 + j + 1), conferenceId: conf.id, userId: att.userId, department: att.dept, role: att.role, attended: true },
        update: {},
      });
    }
  }

  /**
   * 임상경로 배정·마일스톤 결과 — 🔴 **이 블록은 개통 이래 한 번도 성공한 적이 없었다**(2026-08-28).
   *
   * 종전 코드는 주석에 *"스키마: pathwayId, patientId, assignedBy, status"* 라고 적어 두고
   * 그대로 만들었는데, `PathwayAssignment` 는 **`encounterId`·`startDate` 가 NOT NULL** 이고
   * `MilestoneOutcome` 은 **`actualDay` 가 NOT NULL**이며 `note` 라는 필드는 **없다**(`variance` 다).
   * 그래서 여기서 예외가 터졌고, **이 지점 뒤의 시드 57개 생성 호출이 전부 실행되지 않았다**
   * (실측: `pathway_assignments` 0 · `milestone_outcomes` 0 · `cancer_treatments` 0 ·
   *  그 앞의 `clinical_pathways` 5 · `pathway_milestones` 30 은 정상).
   *
   * 🔴 근본 원인은 `prisma/seed.ts` 가 **tsc 범위 밖**이라는 것이다(`include: ["src/**\/*"]`).
   *    타입이 붙어 있었다면 컴파일러가 잡았을 오류다.
   *
   * 시드 설계에서 지킨 것:
   *  · 🔴 **허구 실적을 만들지 않는다** — 진행 중인 배정은 마일스톤을 **일부만** 완료한다.
   *    전건 완료로 채우면 "실행하지 않고 성공 상태만 기록"이 된다(외래 COMPLETED 456건 전례).
   *  · 🔴 **표본을 일부러 남긴다** — 이탈(variance) 있는 배정을 하나 둔다.
   *    전건이 정상이면 이탈 탐지기가 작동하는지 알 수 없다.
   *  · 🔴 `deviations` 카운트는 **실제 이탈 결과 수와 일치**시킨다(숫자만 올리면 같은 병이다).
   */
  const existingPathways = await prisma.clinicalPathway.findMany({ orderBy: { code: 'asc' }, take: 3 });
  const pwEncounters = await prisma.encounter.findMany({
    orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, patientId: true },
  });
  if (existingPathways.length > 0 && pwEncounters.length > 0) {
    const allMilestones = await prisma.pathwayMilestone.findMany({
      where: { pathwayId: { in: existingPathways.map((p) => p.id) } },
      orderBy: [{ pathwayId: 'asc' }, { sortOrder: 'asc' }],
    });

    /** 배정 3건 — 진행 중 / 완료 / 🔴 이탈 발생(탐지기 표본) */
    const plans: { status: 'ACTIVE' | 'COMPLETED'; doneCount: number; deviateAt: number | null; startDaysAgo: number }[] = [
      { status: 'ACTIVE', doneCount: 2, deviateAt: null, startDaysAgo: 2 },   // 진행 중 — 나머지는 아직 안 했다
      { status: 'COMPLETED', doneCount: 6, deviateAt: null, startDaysAgo: 9 }, // 완료 — 전 마일스톤 수행
      { status: 'ACTIVE', doneCount: 3, deviateAt: 2, startDaysAgo: 4 },       // 🔴 이탈 표본
    ];

    for (let i = 0; i < Math.min(plans.length, existingPathways.length, pwEncounters.length); i++) {
      const pw = existingPathways[i];
      const enc = pwEncounters[i];
      const plan = plans[i];
      const assignId = uid(P.PWASSGN, i + 1);
      const rel = allMilestones.filter((m) => m.pathwayId === pw.id);
      const done = rel.slice(0, Math.min(plan.doneCount, rel.length));
      const deviationCount = plan.deviateAt != null && plan.deviateAt < done.length ? 1 : 0;

      await prisma.pathwayAssignment.upsert({
        where: { id: assignId },
        create: {
          id: assignId, pathwayId: pw.id, patientId: enc.patientId, encounterId: enc.id,
          startDate: new Date(Date.now() - plan.startDaysAgo * 86400000),
          status: plan.status,
          // 🔴 실제 이탈 결과 수와 같은 값 — 숫자만 올리지 않는다
          deviations: deviationCount,
          // 완료된 배정만 실제 소요일을 갖는다(진행 중은 모른다 → null)
          actualDays: plan.status === 'COMPLETED' ? plan.startDaysAgo : null,
          completedAt: plan.status === 'COMPLETED' ? new Date(Date.now() - 86400000) : null,
          assignedBy: kimNaegwaId,
        },
        update: { status: plan.status, deviations: deviationCount },
      });

      for (let j = 0; j < done.length; j++) {
        const ms = done[j];
        const deviated = plan.deviateAt === j;
        await prisma.milestoneOutcome.upsert({
          where: { assignmentId_milestoneId: { assignmentId: assignId, milestoneId: ms.id } },
          create: {
            id: uid(P.MLSTONE, i * 10 + j + 1), assignmentId: assignId, milestoneId: ms.id,
            // 계획일(day)과 실제 수행일 — 이탈 건만 하루 늦다
            actualDay: ms.day + (deviated ? 1 : 0),
            status: deviated ? 'DEVIATED' : 'COMPLETED',
            variance: deviated ? '검사 결과 지연으로 익일 시행' : null,
            performedBy: kimNaegwaId,
            performedAt: new Date(Date.now() - Math.max(0, plan.startDaysAgo - ms.day) * 86400000),
          },
          update: {},
        });
      }
    }
  }

  // CancerTreatment & CancerFollowUp
  const existingCancerRegs = await prisma.cancerRegistry.findMany({ take: 3 });
  for (let i = 0; i < Math.min(3, existingCancerRegs.length); i++) {
    const cr = existingCancerRegs[i];
    // CancerTreatment — 스키마: registryId, treatmentType, startDate, endDate, regimen, cycles, response, note
    await prisma.cancerTreatment.create({
      data: {
        id: uid(P.CANCRTX, i + 1), registryId: cr.id,
        treatmentType: ['SURGERY', 'CHEMOTHERAPY', 'RADIATION'][i],
        startDate: new Date(`2026-04-${10 + i}`), endDate: i < 2 ? new Date(`2026-05-${10 + i}`) : undefined,
        regimen: i === 1 ? 'AC-T (Adriamycin + Cyclophosphamide → Taxol)' : undefined,
        cycles: i === 1 ? 6 : undefined,
        response: i < 2 ? ['CR', 'PR'][i] : undefined,
        note: `치료 기록 #${i + 1}`,
      },
    });

    // CancerFollowUp — 스키마: registryId, followUpDate, status, recurrence, note, recordedBy
    await prisma.cancerFollowUp.create({
      data: {
        id: uid(P.CANCRFU, i + 1), registryId: cr.id,
        followUpDate: new Date(`2026-05-${20 + i}`), status: 'NED',
        recurrence: false, note: 'CT 추적 검사 — 이상 소견 없음. CEA 정상.',
        recordedBy: kimNaegwaId,
      },
    });
  }

  // CostAllocation — 스키마: costCenterId, costDriverId, period, amount(Decimal), quantity, source
  await prisma.costAllocation.create({
    data: {
      id: uid(P.COSTALL, 1), costCenterId: uid(P.COST, 1), costDriverId: uid(P.COST, 101),
      period: '2026-Q2', amount: 15000000, quantity: 100, source: 'MANUAL',
    },
  });
  // ProcedureCost — 스키마: procedureCode, procedureName, period, directCost, indirectCost, totalCost, revenueAvg, margin, volumeCount
  await prisma.procedureCost.upsert({
    where: { procedureCode_period: { procedureCode: 'HA101', period: '2026-Q2' } },
    create: {
      id: uid(P.PROCCST, 1), procedureCode: 'HA101', procedureName: '일반 외래 진찰',
      period: '2026-Q2', directCost: 50000, indirectCost: 15000, totalCost: 65000,
      revenueAvg: 80000, margin: 0.2308, volumeCount: 1500,
    },
    update: {},
  });
  console.log(`   - ResSubj: ${Math.min(5, researchStudies.length * 2)}, ResDocs: ${Math.min(4, researchStudies.length)}, MdtCases: ${Math.min(4, mdtConfs.length)}, PathAssign: ${Math.min(3, pathways.length)}, CancerTx: ${Math.min(3, cancerRegs.length)}`);

  // ============================================================
  // E10. 기타 누락 모델 (Remaining Models)
  // ============================================================
  console.log('  [E10] Remaining models: AI, Bot, Safety, Satisfaction, Vaccination, Dental, EWS, Deposit, TextMacro...');

  // Deposit (예치금)
  const deposits = [
    { pat: patient1, amt: 500000, bal: 350000, type: 'ADMISSION', method: 'CARD' },
    { pat: patient3, amt: 1000000, bal: 1000000, type: 'ADMISSION', method: 'TRANSFER' },
    { pat: patient7, amt: 200000, bal: 0, type: 'EMERGENCY', method: 'CASH', refunded: true },
    { pat: patient4, amt: 300000, bal: 300000, type: 'ADMISSION', method: 'CARD' },
  ];
  for (let i = 0; i < deposits.length; i++) {
    const d = deposits[i];
    await prisma.deposit.create({
      data: {
        id: uid(P.DEPOSIT, i + 1), patientId: d.pat, amount: d.amt, balance: d.bal,
        depositType: d.type, paymentMethod: d.method, processedBy: leeWonmuId,
        refundedAt: d.refunded ? new Date() : undefined,
      },
    });
  }

  // InstallmentPlan + Payments
  // 🔴 같은 형태 — `extBillings` 를 가져와 놓고 로컬 배열 `billings` 를 읽었다(아래 회차 금액에 남아 있던 것을 2026-09-21 회수)
  const extBillings = await prisma.billing.findMany({ take: 2, where: { totalAmount: { gte: 100000 } } });
  if (extBillings.length > 0) {
    const planId = uid(P.INSTALL, 1);
    await prisma.installmentPlan.create({
      data: {
        id: planId, billingId: extBillings[0].id, totalAmount: extBillings[0].totalAmount,
        installments: 3, paidCount: 1, nextDueDate: new Date('2026-07-01'), status: 'ACTIVE',
      },
    });
    for (let i = 1; i <= 3; i++) {
      await prisma.installmentPayment.create({
        data: {
          id: uid(P.INSTALL, 100 + i), planId, seqNo: i,
          // 🔴 회차 합 = 계획 총액(불변식 68). 나누어떨어지지 않는 나머지는 **마지막 회차**가 흡수한다.
          amount: i < 3
            ? Math.floor(extBillings[0].totalAmount / 3)
            : extBillings[0].totalAmount - Math.floor(extBillings[0].totalAmount / 3) * 2,
          dueDate: new Date(`2026-0${5 + i}-01`),
          paidAt: i === 1 ? new Date('2026-06-01') : undefined,
          status: i === 1 ? 'PAID' : 'PENDING',
        },
      });
    }
  }

  // AiFeedback
  for (let i = 1; i <= 5; i++) {
    await prisma.aiFeedback.create({
      data: {
        id: uid(P.AIFDBK, i),
        userMessage: ['두통이 심해요', '혈압약 바꿔야 할까요', '검사 결과 설명해주세요', '다음 예약 잡아주세요', '허리가 아파요'][i - 1],
        aiResponse: ['두통 증상에 대해 안내드립니다...', '혈압 수치를 확인하겠습니다...', '검사 결과를 분석하겠습니다...', '예약을 잡아드리겠습니다...', '정형외과 진료를 권합니다...'][i - 1],
        rating: ['GOOD', 'GOOD', 'NEUTRAL', 'GOOD', 'BAD'][i - 1],
        comment: i === 5 ? '영상 분석까지는 아직 부족' : undefined,
        toolsUsed: [['TRIAGE'], ['SCHEDULE', 'ENCOUNTER'], ['LAB'], ['SCHEDULE'], ['TRIAGE']][i - 1],
        latencyMs: 800 + i * 200, model: 'gpt-4o',
      },
    });
  }

  // AgentSession
  for (let i = 1; i <= 4; i++) {
    await prisma.agentSession.create({
      data: {
        id: uid(P.AGTSESS, i), channel: ['CHATBOT', 'KIOSK', 'APP', 'PHONE'][i - 1],
        patientId: [patient1, patient5, patient6, patient10][i - 1],
        state: ['COMPLETED', 'COMPLETED', 'IDLE', 'COMPLETED'][i - 1],
        context: { intent: ['booking', 'triage', 'inquiry', 'booking'][i - 1] },
        messages: [
          { role: 'user', content: '예약하고 싶어요' },
          { role: 'assistant', content: '어느 과 진료를 원하시나요?' },
        ],
        resultType: i !== 3 ? 'BOOKING' : undefined,
        completedAt: i !== 3 ? new Date() : undefined,
      },
    });
  }

  // OnlineBooking
  for (let i = 1; i <= 4; i++) {
    await prisma.onlineBooking.upsert({
      where: { bookingNumber: `OB-2026-${String(i).padStart(4, '0')}` },
      create: {
        id: uid(P.ONLBOOK, i), bookingNumber: `OB-2026-${String(i).padStart(4, '0')}`,
        patientName: ['김영수', '정민호', '한지영', '윤서연'][i - 1],
        patientPhone: ['010-1234-5678', '010-5678-9012', '010-6789-0123', '010-0123-4567'][i - 1],
        department: ['내과', '정형외과', '산부인과', '피부과'][i - 1],
        preferredDate: new Date(`2026-06-0${i}`), preferredTime: `${9 + i}:00`,
        reason: ['혈압 검사', '무릎 통증', '정기 검진', '피부 발진'][i - 1],
        status: ['CONFIRMED', 'PENDING', 'CONFIRMED', 'CANCELLED'][i - 1],
      },
      update: {},
    });
  }

  // PreOrder
  const medCodes = await prisma.medicationCode.findMany({ take: 3 });
  if (medCodes.length > 0) {
    for (let i = 1; i <= 3; i++) {
      await prisma.preOrder.create({
        data: {
          id: uid(P.PREORD, i), patientId: [patient1, patient5, patient3][i - 1],
          doctorId: kimNaegwaId, type: 'MEDICATION',
          medicationCodeId: medCodes[Math.min(i - 1, medCodes.length - 1)].id,
          dosage: '500mg', frequency: '1일 3회', duration: 7, quantity: 21,
          route: '경구', priority: 'ROUTINE', status: ['APPROVED', 'PENDING', 'APPROVED'][i - 1],
          approvedBy: i !== 2 ? kimNaegwaId : undefined, scheduledDate: new Date(`2026-06-0${i}`),
        },
      });
    }
  }

  // TextMacro
  const textMacros = [
    { user: kimNaegwaId, cat: 'SOAP_S', shortcut: '#두통', content: '두통을 주소로 내원. 1주 전부터 발생, 간헐적 박동성 두통. 오심/구토 동반 없음.' },
    { user: kimNaegwaId, cat: 'SOAP_A', shortcut: '#HTN평가', content: '혈압 조절 양호. 현 약제 유지하며 3개월 뒤 재평가.' },
    { user: leeOegwaId, cat: 'SOAP_P', shortcut: '#수술후', content: '수술 후 1일차. 배액 감시 중. JP drain 양 50mL. 항생제 cefazolin 1g IV q8h.' },
    { user: choGanhoId, cat: 'NURSING', shortcut: '#낙상예방', content: '낙상 고위험 중재: 침대 난간 올림, 미끄럼 방지 양말 착용, 콜벨 손 닿는 곳 배치' },
    { user: limYaksaId, cat: 'COUNSEL', shortcut: '#와파린', content: '와파린 복약 지도: 매일 같은 시간 복용. 녹색 채소 일정하게 섭취. INR 검사 정기적으로.' },
  ];
  for (let i = 0; i < textMacros.length; i++) {
    const tm = textMacros[i];
    await prisma.textMacro.upsert({
      where: { userId_shortcut: { userId: tm.user, shortcut: tm.shortcut } },
      create: { id: uid(P.TXTMACR, i + 1), userId: tm.user, category: tm.cat, shortcut: tm.shortcut, content: tm.content },
      update: {},
    });
  }

  // FavoriteOrder
  await prisma.favoriteOrder.create({
    data: {
      id: uid(P.FAVORD, 1), userId: kimNaegwaId, name: 'HTN 기본 처방',
      items: [{ type: 'MEDICATION', name: '암로디핀 5mg', dosage: '1일 1회', duration: 30 }, { type: 'LAB', name: 'BMP + 전해질' }],
      useCount: 45,
    },
  });
  await prisma.favoriteOrder.create({
    data: {
      id: uid(P.FAVORD, 2), userId: leeOegwaId, name: '수술 전 기본 검사',
      items: [{ type: 'LAB', name: 'CBC, PT/aPTT, BMP' }, { type: 'LAB', name: '혈액형/교차시험' }, { type: 'IMAGING', name: '흉부 X-ray' }],
      useCount: 28,
    },
  });

  // UserChartPreference
  for (let i = 0; i < 3; i++) {
    const users_ = [kimNaegwaId, leeOegwaId, jungSoaaId];
    await prisma.userChartPreference.upsert({
      where: { userId: users_[i] },
      create: { id: uid(P.UCHPREF, i + 1), userId: users_[i] },
      update: {},
    });
  }

  // DoctorProfile
  const drProfiles = [
    { userId: kimNaegwaId, pos: '교수', edu: [{ school: '서울대학교 의과대학', year: 2000 }], career: [{ org: '가상대학교병원', period: '2005~현재', role: '순환기내과 교수' }], certs: ['순환기내과 전문의', '심장초음파 인증의'], research: [{ title: '심부전 AI 진단 연구', journal: 'JAMA Cardiology', year: 2024 }], intro: '순환기내과 전문의로 20년간 심혈관 질환을 연구하고 있습니다.' },
    { userId: leeOegwaId, pos: '부교수', edu: [{ school: '연세대학교 의과대학', year: 2003 }], career: [{ org: '가상중앙병원', period: '2008~2020' }], certs: ['일반외과 전문의', '복강경수술 인증의'], research: [], intro: '최소 침습 수술 전문의입니다.' },
    { userId: jungSoaaId, pos: '조교수', edu: [{ school: '고려대학교 의과대학', year: 2010 }], career: [{ org: '서울대학교 어린이병원', period: '2015~현재' }], certs: ['소아청소년과 전문의'], research: [], intro: '소아 감염 질환 전문입니다.' },
  ];
  for (let i = 0; i < drProfiles.length; i++) {
    const dp = drProfiles[i];
    await prisma.doctorProfile.upsert({
      where: { userId: dp.userId },
      create: {
        id: uid(P.DRPROF, i + 1), userId: dp.userId, position: dp.pos,
        education: dp.edu, career: dp.career, certifications: dp.certs,
        research: dp.research, introduction: dp.intro,
      },
      update: {},
    });
  }

  // SatisfactionSurvey
  const encounters = await prisma.encounter.findMany({ take: 5 });
  for (let i = 0; i < Math.min(5, encounters.length); i++) {
    const enc = encounters[i];
    await prisma.satisfactionSurvey.create({
      data: {
        id: uid(P.SATSUV, i + 1), patientId: enc.patientId, encounterId: enc.id,
        overallRating: 3 + (i % 3), waitRating: 2 + (i % 4), staffRating: 4 + (i % 2),
        facilityRating: 3 + (i % 3),
        comment: i === 0 ? '대기 시간이 좀 길었지만 진료는 만족스러웠습니다.' : undefined,
      },
    });
  }

  // Vaccination
  const vaccinations = [
    { pat: patient8, name: 'BCG (결핵)', code: 'BCG', dose: 1, at: '2021-04-20', by: '서울대학교 어린이병원', loc: '신생아실' },
    { pat: patient8, name: 'B형간염 1차', code: 'HepB-1', dose: 1, at: '2021-04-20', by: '서울대학교 어린이병원', loc: '신생아실' },
    { pat: patient8, name: 'DTaP 1차', code: 'DTaP-1', dose: 1, at: '2021-06-18', by: '정소아 소아과', loc: '소아청소년과' },
    { pat: patient1, name: '인플루엔자 2025-2026', code: 'FLU-2526', dose: 1, at: '2025-10-15', by: '가상대학교병원', loc: '예방접종실' },
    { pat: patient4, name: '코로나19 6차', code: 'COVID-6', dose: 6, at: '2025-11-01', by: '가상대학교병원', loc: '예방접종실' },
  ];
  for (let i = 0; i < vaccinations.length; i++) {
    const v = vaccinations[i];
    await prisma.vaccination.create({
      data: {
        id: uid(P.VACC, i + 1), patientId: v.pat, vaccineName: v.name, vaccineCode: v.code,
        doseNumber: v.dose, administeredAt: new Date(v.at), administeredBy: v.by, location: v.loc,
      },
    });
  }

  // DentalRecall
  await prisma.dentalRecall.create({
    data: {
      id: uid(P.DENTRCL, 1), patientId: patient5, recallType: '6MONTH',
      scheduledDate: new Date('2026-11-15'), status: 'SCHEDULED', createdBy: uid(P.USER, 44),
    },
  });
  await prisma.dentalRecall.create({
    data: {
      id: uid(P.DENTRCL, 2), patientId: patient6, tooth: '36', recallType: '1YEAR',
      scheduledDate: new Date('2027-05-20'), status: 'SCHEDULED', createdBy: uid(P.USER, 44),
    },
  });

  // EarlyWarningScore
  //
  // 🔴 결함 ① — **이 블록은 한 번도 성공한 적이 없다.** 필드명이 스키마에 없고(`spo2`→`spO2`,
  //    `assessedBy`→`nurseId`, `assessedAt`→`recordedAt`) 필수 필드(`scoreBreakdown`)가 빠져 있어
  //    Prisma 검증 오류로 터진다. 이 자리는 9254 줄에서 열린 **하나의 거대한 try** 안이라
  //    여기서 터지면 뒤따르는 확장 시드가 통째로 조용히 건너뛰어진다("Extended seed partially failed").
  //    seed.ts 는 `@ts-nocheck` 라 타입도 잡아주지 못했다 — **"데이터 0행"이 쓰기 경로가 막힌 것**이었다.
  //
  // 🔴 결함 ② — totalScore·riskLevel 을 리터럴로 찍어 **같은 행의 활력징후와 어긋났다**:
  //    i=2 는 실제 NEWS2 11점(HIGH)인데 7점·MEDIUM, i=3 은 16점인데 9점으로 저장하려 했다.
  //    점수는 정본 `computeNews2`(icu-scores)가 산출한다.
  //
  // ⚠️ src 에 NEWS2 등급 밴드가 **두 벌** 있다(아래 '기능 코드 발견'에 보고):
  //    `icu-scores.computeNews2` 는 `총점≥5 || 단일3점 → MEDIUM`, `patient-safety.calculateNews2` 는
  //    `단일3점 → LOW_MEDIUM`. 두 정본이 갈라지는 구간(총점 1–6)을 **피해서** 검체를 고른다 —
  //    시드가 어느 한쪽 편을 드는 순간 같은 테이블 안에서 등급의 뜻이 갈린다.
  const ewsSamples = [
    // 정상 — 총점 0(두 정본 모두 LOW)
    { patientId: patient1, nurseId: choGanhoId, respiratoryRate: 16, spO2: 98, fio2: 21, systolicBp: 130, heartRate: 72, temperature: 36.5, consciousness: 'ALERT' },
    // 패혈증 의심 — 총점 11(두 정본 모두 HIGH)
    { patientId: patient3, nurseId: yoonGanhoId, respiratoryRate: 24, spO2: 92, fio2: 32, systolicBp: 85, heartRate: 110, temperature: 38.8, consciousness: 'ALERT' },
    // 급성 호흡부전 — 총점 16(두 정본 모두 HIGH)
    { patientId: patient7, nurseId: hwangGanhoId, respiratoryRate: 28, spO2: 88, fio2: 40, systolicBp: 90, heartRate: 120, temperature: 37.2, consciousness: 'VERBAL' },
    // 관찰 필요 — 총점 5(두 정본 모두 MEDIUM · 단일 3점 없음)
    { patientId: patient4, nurseId: seoGanhoId, respiratoryRate: 21, spO2: 96, fio2: 21, systolicBp: 95, heartRate: 105, temperature: 37.0, consciousness: 'ALERT' },
  ];
  for (const [i, ews] of ewsSamples.entries()) {
    const news2 = computeNews2({
      respiratoryRate: ews.respiratoryRate, spo2: ews.spO2, fio2: ews.fio2,
      systolicBp: ews.systolicBp, heartRate: ews.heartRate,
      temperature: ews.temperature, consciousness: ews.consciousness,
    });
    await prisma.earlyWarningScore.create({
      data: {
        id: uid(P.EWS, i + 1), patientId: ews.patientId, nurseId: ews.nurseId,
        respiratoryRate: ews.respiratoryRate, spO2: ews.spO2,
        supplementalO2: ews.fio2 > 21, spO2Scale: 1,
        systolicBp: ews.systolicBp, heartRate: ews.heartRate,
        consciousness: ews.consciousness, temperature: ews.temperature,
        totalScore: news2.score, riskLevel: news2.riskLevel,
        // 🔴 `computeNews2` 는 수축기혈압 키를 `sbp` 로, 이 테이블에 쓰는 정본
        //    (`patient-safety.calculateNews2`)과 스키마 주석은 `bp` 로 쓴다 — 같은 개념에 어휘가 둘.
        //    저장 어휘는 이 테이블의 정본을 따른다(시드가 제3의 어휘를 만들지 않는다).
        scoreBreakdown: {
          rr: news2.params.rr, spo2: news2.params.spo2, o2: news2.params.o2,
          bp: news2.params.sbp, hr: news2.params.hr, temp: news2.params.temp,
          consciousness: news2.params.consciousness,
        },
        escalationRequired: news2.riskLevel === 'HIGH' || news2.riskLevel === 'MEDIUM',
        recordedAt: new Date(`2026-05-2${i + 1}T08:00:00Z`),
      },
    });
  }

  // SmsVerification
  for (let i = 1; i <= 3; i++) {
    await prisma.smsVerification.create({
      data: {
        id: uid(P.SMSVRF, i), phone: ['010-1234-5678', '010-5678-9012', '010-6789-0123'][i - 1],
        code: String(100000 + i * 11111), purpose: ['SIGNUP', 'LOGIN_2FA', 'PASSWORD_RESET'][i - 1],
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), verified: i < 3,
      },
    });
  }

  // Bot — 스키마: name(unique), description, triggerType(enum: RESOURCE_CREATED/UPDATED/DELETED/SCHEDULE/MANUAL), triggerConfig(json), action(json), status(enum), createdBy
  const botsData = [
    { name: '예약 생성 알림 봇', trigger: 'RESOURCE_CREATED' as const, triggerCfg: { resourceType: 'Appointment', event: 'created' }, action: { type: 'notification', config: { channel: 'SSE', template: 'appointment_created' } } },
    { name: '검사 완료 알림 봇', trigger: 'RESOURCE_UPDATED' as const, triggerCfg: { resourceType: 'LabResult', field: 'status', value: 'COMPLETED' }, action: { type: 'notification', config: { channel: 'SSE', template: 'lab_completed' } } },
    { name: '정기 보고서 생성 봇', trigger: 'SCHEDULE' as const, triggerCfg: { cron: '0 8 * * 1', timezone: 'Asia/Seoul' }, action: { type: 'report', config: { reportType: 'weekly_summary' } } },
  ];
  for (let i = 0; i < botsData.length; i++) {
    const b = botsData[i];
    await prisma.bot.upsert({
      where: { name: b.name },
      create: { id: uid(P.BOT, i + 1), name: b.name, description: `${b.name} — 자동화`, triggerType: b.trigger, triggerConfig: b.triggerCfg, action: b.action, createdBy: adminId },
      update: {},
    });
    await prisma.botExecution.create({
      data: {
        id: uid(P.BOTEXEC, i + 1), botId: uid(P.BOT, i + 1),
        status: 'SUCCESS', input: b.triggerCfg, output: { result: '처리 완료' },
        durationMs: 1200 + i * 500,
      },
    });
  }

  // DicomStudy
  for (let i = 1; i <= 3; i++) {
    await prisma.dicomStudy.create({
      data: {
        id: uid(P.DICOM, i), patientId: [patient1, patient3, patient7][i - 1],
        studyInstanceUid: `1.2.410.200051.2026.${String(i).padStart(10, '0')}`,
        accessionNumber: `ACC-2026-${String(i).padStart(6, '0')}`,
        modality: ['CT', 'MRI', 'XR'][i - 1], studyDescription: ['흉부 CT', '뇌 MRI', '흉부 X-ray'][i - 1],
        studyDate: new Date(`2026-05-${15 + i}`), numberOfSeries: [3, 5, 1][i - 1], numberOfInstances: [120, 380, 2][i - 1],
        orthanStableId: `orthanc-study-${i}`,
      },
    });
  }

  // PatientIdentificationCheck
  for (let i = 1; i <= 4; i++) {
    await prisma.patientIdentificationCheck.create({
      data: {
        id: uid(P.PTIDCHK, i), patientId: [patient1, patient3, patient5, patient7][i - 1],
        checkedBy: [choGanhoId, yoonGanhoId, choGanhoId, hwangGanhoId][i - 1],
        method: ['WRISTBAND', 'NAME_DOB', 'WRISTBAND', 'NAME_DOB'][i - 1],
        context: ['MEDICATION', 'PROCEDURE', 'LAB_DRAW', 'BLOOD_TRANSFUSION'][i - 1],
        result: 'MATCH', checkedAt: new Date(`2026-05-2${i}T08:30:00Z`),
      },
    });
  }

  // SafetyIncident
  await prisma.safetyIncident.create({
    data: {
      id: uid(P.SAFETY, 1), patientId: patient4,
      incidentType: 'NEAR_MISS', category: 'MEDICATION',
      description: '환자 최순자에게 타환자 약 투여 직전 — 간호사 신원 확인 시 발견하여 투약 중단',
      severity: 'MODERATE', reportedBy: choGanhoId, reportedAt: new Date('2026-05-18T14:30:00Z'),
      actionsTaken: '투약 프로세스 재교육, 바코드 스캔 의무화', status: 'INVESTIGATED',
    },
  });

  // WebhookSubscription
  await prisma.webhookSubscription.create({
    data: {
      id: uid(P.WEBHOOK, 1), url: 'https://clinic.example.com/webhook/his',
      events: ['APPOINTMENT_CREATED', 'APPOINTMENT_CANCELLED', 'LAB_COMPLETED'],
      secret: createHash('sha256').update('webhook-secret-key').digest('hex'),
    },
  });

  // DisplayApiKey
  await prisma.displayApiKey.upsert({
    where: { key: 'display-api-key-lobby-001' },
    create: { id: uid(P.DSPAKEY, 1), key: 'display-api-key-lobby-001', name: '로비 대기 현황판', createdBy: adminId },
    update: {},
  });
  await prisma.displayApiKey.upsert({
    where: { key: 'display-api-key-er-001' },
    create: { id: uid(P.DSPAKEY, 2), key: 'display-api-key-er-001', name: '응급실 현황판', createdBy: adminId },
    update: {},
  });

  // ClinicClosure
  await prisma.clinicClosure.create({
    data: {
      id: uid(P.CLNSYNC, 1), departmentName: '내과', closureDate: new Date('2026-06-01'),
      reason: '개원기념일 휴진', createdBy: adminId,
    },
  });

  // RiskReassessmentSchedule
  for (let i = 1; i <= 3; i++) {
    // 🔴 등급·주기를 리터럴로 적지 않는다 — 정본에서 산출한다(W8).
    //    종전 시드는 Morse 45 를 MODERATE(정본은 HIGH)로, 고위험 낙상 주기를 8h/4h(정본 2h)로
    //    적어 두어 시드를 돌리면 **잘못된 위험등급이 법정기록에 들어갔다.**
    const rrType = (['FALL_RISK', 'PRESSURE_ULCER', 'FALL_RISK'] as AssessmentType[])[i - 1];
    const rrScore = [45, 14, 75][i - 1];
    const rrLevel = deriveRiskLevel(rrType, rrScore);
    const rrInterval = intervalHoursFor(rrType, rrLevel);
    await prisma.riskReassessmentSchedule.create({
      data: {
        id: uid(P.EWS, 10 + i), patientId: [patient1, patient4, patient7][i - 1],
        assessmentType: rrType,
        toolName: ['MORSE', 'BRADEN', 'MORSE'][i - 1],
        intervalHours: rrInterval,
        nextDueAt: new Date(Date.now() + rrInterval * 60 * 60 * 1000),
        lastScore: rrScore, lastRiskLevel: rrLevel,
        lastAssessedAt: new Date(), lastAssessedBy: [choGanhoId, yoonGanhoId, hwangGanhoId][i - 1],
        interventions: [{ type: 'NON_SLIP_SOCKS', description: '미끄럼 방지 양말', applied: true }],
      },
    });
  }

  // DepartmentFormMapping
  if (formSchemas.length > 0) {
    const deptForms = [
      { dept: '내과', visit: 'ALL' },
      { dept: '정형외과', visit: 'INITIAL' },
      { dept: '정신건강의학과', visit: 'ALL' },
    ];
    for (let i = 0; i < Math.min(deptForms.length, formSchemas.length); i++) {
      const df = deptForms[i];
      await prisma.departmentFormMapping.upsert({
        where: { departmentName_formSchemaId_visitType: { departmentName: df.dept, formSchemaId: formSchemas[i].id, visitType: df.visit } },
        create: { id: uid(P.DEPTFRM, i + 1), departmentName: df.dept, formSchemaId: formSchemas[i].id, visitType: df.visit, createdBy: adminId },
        update: {},
      });
    }
  }

  // CheckupResultItem, CheckupSummary, CheckupInterpretation, CheckupReferral, CheckupFollowUp, CheckupContract
  const checkupVisits = await prisma.checkupVisit.findMany({ take: 3 });
  const extCheckupPrograms = await prisma.checkupProgram.findMany({ take: 2 });
  for (let i = 0; i < Math.min(3, checkupVisits.length); i++) {
    const cv = checkupVisits[i];
    // CheckupResultItem
    const resultItems = [
      { cat: '혈액검사', name: '혈색소(Hb)', value: '14.2', unit: 'g/dL', refMin: '13.0', refMax: '17.0', status: 'NORMAL' },
      { cat: '혈액검사', name: '공복혈당', value: '118', unit: 'mg/dL', refMin: '70', refMax: '100', status: 'BORDERLINE' },
      { cat: '간기능', name: 'AST(GOT)', value: '28', unit: 'IU/L', refMin: '0', refMax: '40', status: 'NORMAL' },
      { cat: '간기능', name: 'ALT(GPT)', value: '35', unit: 'IU/L', refMin: '0', refMax: '40', status: 'NORMAL' },
      { cat: '지질검사', name: '총콜레스테롤', value: '225', unit: 'mg/dL', refMin: '0', refMax: '200', status: 'ABNORMAL' },
    ];
    for (let j = 0; j < resultItems.length; j++) {
      const ri = resultItems[j];
      await prisma.checkupResultItem.create({
        data: {
          id: uid(P.CKRSLT, i * 10 + j + 1), visitId: cv.id, category: ri.cat,
          itemName: ri.name, resultValue: ri.value, unit: ri.unit,
          referenceMin: ri.refMin, referenceMax: ri.refMax, status: ri.status,
        },
      });
    }

    // CheckupSummary
    await prisma.checkupSummary.create({
      data: {
        id: uid(P.CKSUM, i + 1), visitId: cv.id, doctorId: uid(P.USER, 60),
        overallGrade: ['A', 'B', 'C'][i], findings: ['특이 소견 없음', '경계성 혈당 — 식이 관리 권고', '고콜레스테롤혈증 — 생활습관 개선 + 추적 필요'][i],
        recommendations: '정기 건강검진 연 1회 권고', summarizedAt: new Date(),
      },
    });

    // CheckupInterpretation
    await prisma.checkupInterpretation.create({
      data: {
        id: uid(P.CKINTERP, i + 1), visitId: cv.id, category: '혈액검사',
        interpretation: ['전체적으로 양호', '공복혈당 경계 — 당뇨 전단계 주의', '지질 이상 — 식이요법 및 운동 권고'][i],
        grade: ['NORMAL', 'BORDERLINE', 'ABNORMAL'][i], doctorId: uid(P.USER, 60),
      },
    });
  }

  // CheckupReferral
  if (checkupVisits.length > 1) {
    await prisma.checkupReferral.create({
      data: {
        id: uid(P.CKREF, 1), visitId: checkupVisits[1].id,
        department: '내분비내과', reason: '공복혈당 118mg/dL — 당뇨 전단계 정밀 검사',
        priority: 'NORMAL', status: 'REFERRED',
        referredBy: uid(P.USER, 60), referredAt: new Date(),
      },
    });
  }

  // CheckupFollowUp
  if (checkupVisits.length > 0) {
    await prisma.checkupFollowUp.create({
      data: {
        id: uid(P.CKFOLUP, 1), visitId: checkupVisits[0].id,
        followUpType: '3개월 후 재검', scheduledDate: new Date('2026-08-15'),
        items: ['공복혈당', 'HbA1c', '지질 패널'], status: 'SCHEDULED',
        createdBy: uid(P.USER, 60),
      },
    });
  }

  // CheckupContract
  if (checkupPrograms.length > 0) {
    await prisma.checkupContract.create({
      data: {
        id: uid(P.CKCTRCT, 1), programId: checkupPrograms[0].id,
        companyName: '(주)삼성전자', contactName: '김인사', contactPhone: '02-2255-1234',
        contractFrom: new Date('2026-01-01'), contractTo: new Date('2026-12-31'),
        headCount: 500, discountRate: 15, status: 'ACTIVE',
      },
    });
  }

  console.log('   - Deposits: 4, Installment: 1, AiFeedback: 5, Bot: 3, Vaccination: 5, EWS: 4, DicomStudy: 3, Safety: 1');
  console.log(`\n✅ Extended seed (128 models) complete in ${Date.now() - extStart}ms`);
  } catch (extErr: any) {
    console.warn(`\n⚠️ Extended seed partially failed: ${extErr.message?.slice(0, 120)}`);
    console.warn('   Core seed data is intact. Extended data may be incomplete.');
  }

  // ── 원외처방전 시드 ──
  try {
    const extDoctor = await prisma.user.findFirst({ where: { role: 'DOCTOR' }, select: { id: true } });
    const extMeds = await prisma.medicationCode.findMany({ take: 8, select: { id: true } });
    const extEncs = await prisma.encounter.findMany({ take: 5, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (extDoctor && extMeds.length && extEncs.length) {
      const dosages = ['1정', '2정', '1캡슐'];
      const freqs = ['1일 3회', '1일 2회', '1일 1회'];
      // 🔴 종전 결함: quantity 가 `duration * (i%3===0 ? 3 : 2)` 라 **'1일 1회 × 30일'이 60정**이었다
      //    (삼항이 1회/일 케이스를 놓쳤다). 총량은 **투여 빈도에서** 나온다.
      const dosesPerDay = [3, 2, 1];
      const durations = [7, 14, 30];
      const priorities = ['ROUTINE', 'ROUTINE', 'URGENT', 'STAT', 'ROUTINE'];
      for (let i = 0; i < extEncs.length; i++) {
        const rx = await prisma.prescription.create({
          data: {
            encounterId: extEncs[i].id, type: 'MEDICATION', status: 'ACTIVE',
            dispensingType: 'EXTERNAL', medicationCodeId: extMeds[i % extMeds.length].id,
            dosage: dosages[i % 3], frequency: freqs[i % 3], route: 'PO',
            duration: durations[i % 3], quantity: durations[i % 3] * dosesPerDay[i % 3],
            createdBy: extDoctor.id,
          },
        });
        await prisma.order.create({
          data: { prescriptionId: rx.id, department: 'PHARMACY', status: 'ORDERED', pharmacyType: 'EXTERNAL', priority: priorities[i] },
        });
        if (i < 3) {
          const rx2 = await prisma.prescription.create({
            data: {
              encounterId: extEncs[i].id, type: 'MEDICATION', status: 'ACTIVE',
              dispensingType: 'EXTERNAL', medicationCodeId: extMeds[(i + 3) % extMeds.length].id,
              dosage: '1정', frequency: '1일 2회', route: 'PO', duration: 14, quantity: 28,
              createdBy: extDoctor.id,
            },
          });
          await prisma.order.create({
            data: { prescriptionId: rx2.id, department: 'PHARMACY', status: 'ORDERED', pharmacyType: 'EXTERNAL', priority: 'ROUTINE' },
          });
        }
      }
      console.log('  [External Rx] 원외처방 시드 완료');
    }
  } catch { console.warn('  [External Rx] skip'); }

  // ── SMART Client + 전원 기록 시드 ──
  try {
    console.log('  [SMART/Transfer] SmartClient + TransferRecord...');
    const selfOrg = await prisma.organization.findFirst({ where: { isSelf: true } });
    const partnerOrgs = await prisma.organization.findMany({ where: { isSelf: false }, take: 3 });
    const seedPatients = await prisma.patient.findMany({ take: 3, select: { id: true } });
    const seedDoctors = await prisma.user.findMany({ where: { role: 'DOCTOR' }, take: 2, select: { id: true } });

    if (selfOrg && partnerOrgs.length >= 2 && seedPatients.length >= 2 && seedDoctors.length >= 1) {
      // SmartClient 시드
      const smartClients = [
        { clientId: 'partner-a-smart-001', clientSecret: 'b9e5f8c2d4a1e7f3b6c9d2e5f8a1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2', name: '가상대학교병원 SMART 클라이언트', scopes: ['patient/*.read', 'encounter/*.read', 'observation/*.read'], orgId: partnerOrgs[0].id },
        { clientId: 'partner-b-smart-001', clientSecret: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2', name: '가상의료원 SMART 클라이언트', scopes: ['patient/*.read', 'patient/*.write'], orgId: partnerOrgs[1].id },
      ];
      // 시크릿은 SHA-256 해시로 저장(평문 미보관) — 위 clientSecret 리터럴이 클라이언트가 보낼 원문(문서용).
      for (const sc of smartClients) {
        const existing = await prisma.smartClient.findUnique({ where: { clientId: sc.clientId } });
        if (!existing) await prisma.smartClient.create({ data: { ...sc, clientSecret: createHash('sha256').update(sc.clientSecret).digest('hex'), isActive: true } });
      }
      console.log(`     → ${smartClients.length} SMART clients seeded`);

      // TransferRecord 시드
      const transferData = [
        {
          patientId: seedPatients[0].id,
          fromOrgId: selfOrg.id,
          toOrgId: partnerOrgs[0].id,
          transferType: 'OUTGOING_REFERRAL',
          status: 'COMPLETED',
          urgency: 'URGENT',
          reason: '상급병원 전문 진료 필요 — 좌전하행지 협착 의심, PCI 필요',
          clinicalSummary: '흉통 지속 3일, Troponin 양성, ECG ST elevation V3-V6',
          requestedBy: seedDoctors[0].id,
          requestedAt: new Date('2026-05-28T09:30:00+09:00'),
          acceptedAt: new Date('2026-05-28T10:00:00+09:00'),
          transferredAt: new Date('2026-05-28T10:30:00+09:00'),
          completedAt: new Date('2026-05-28T14:00:00+09:00'),
        },
        {
          patientId: seedPatients[1].id,
          fromOrgId: partnerOrgs[1].id,
          toOrgId: selfOrg.id,
          transferType: 'INCOMING_REFERRAL',
          status: 'ACCEPTED',
          urgency: 'ROUTINE',
          reason: '재활 치료 목적 전원',
          clinicalSummary: '슬관절 전치환술 후 2주, 재활치료 위해 전원',
          requestedBy: null,
          requestedAt: new Date('2026-05-30T14:00:00+09:00'),
          acceptedAt: new Date('2026-05-30T15:30:00+09:00'),
          acceptedBy: seedDoctors[0].id,
        },
        {
          patientId: seedPatients[0].id,
          fromOrgId: selfOrg.id,
          toOrgId: partnerOrgs[0].id,
          transferType: 'OUTGOING_REFERRAL',
          status: 'REQUESTED',
          urgency: 'EMERGENT',
          reason: '다발성 외상 — 응급 수술 필요',
          clinicalSummary: '교통사고, GCS 12, 비장파열 의심, CT 확인 필요',
          requestedBy: seedDoctors[0].id,
          requestedAt: new Date('2026-06-01T08:15:00+09:00'),
        },
      ];
      for (const td of transferData) {
        const existing = await prisma.transferRecord.findFirst({
          where: { patientId: td.patientId, fromOrgId: td.fromOrgId, reason: td.reason },
        });
        if (!existing) await prisma.transferRecord.create({ data: td });
      }
      console.log(`     → ${transferData.length} transfer records seeded`);
    }
  } catch (err) { console.warn('  [SMART/Transfer] skip:', (err as Error).message); }

  // ============================================================
  // CRM 시드 데이터
  // ============================================================
  try {
    console.log('\n🔗 Seeding CRM data...');

    // CRM 사용자 ID 찾기
    const crmManager = await prisma.user.findUnique({ where: { email: 'crm.manager@hospital.example.org' } });
    const crmStaff = await prisma.user.findUnique({ where: { email: 'crm.intl@hospital.example.org' } });
    if (crmManager) {
      // CRM 템플릿
      const templateData = [
        { name: '국가검진 안내', type: 'REMINDER', channel: 'SMS', locale: 'ko', content: '{{patientName}}님, 올해 국가건강검진 대상입니다. 지금 예약하세요. ☎ 02-1234-5678' },
        { name: '재검진 리마인더 D-14', type: 'RECALL', channel: 'SMS', locale: 'ko', content: '{{patientName}}님, 검진 이상 소견 재검진 예정일이 2주 앞으로 다가왔습니다. 외래 예약을 권장합니다.' },
        { name: '프리미엄 검진 프로모션', type: 'PROMOTION', channel: 'SMS', locale: 'ko', content: '{{patientName}}님, 여름 프리미엄 검진 20% 할인! 6월 한정. 지금 예약하세요.' },
        { name: '진료 만족도 설문', type: 'SURVEY', channel: 'PUSH', locale: 'ko', content: '{{patientName}}님, 최근 진료 경험은 어떠셨나요? 30초 설문에 참여해주세요.' },
        { name: 'Checkup Reminder (EN)', type: 'REMINDER', channel: 'EMAIL', locale: 'en', content: 'Dear {{patientName}}, Your annual health checkup is due. Please schedule an appointment.' },
        { name: '검진案内 (ZH)', type: 'REMINDER', channel: 'EMAIL', locale: 'zh', content: '{{patientName}}先生/女士，您的年度体检即将到期。请预约检查。' },
        { name: '예약 리마인더 D-1', type: 'REMINDER', channel: 'PUSH', locale: 'ko', content: '{{patientName}}님, 내일 {{appointmentDate}} {{department}} 예약이 있습니다.' },
        { name: '이탈 위험 재방문 유도', type: 'FOLLOW_UP', channel: 'SMS', locale: 'ko', content: '{{patientName}}님, 건강은 안녕하세요? 정기 진료를 권장합니다. 예약: 02-1234-5678' },
      ];
      for (const t of templateData) {
        const exists = await prisma.crmTemplate.findFirst({ where: { name: t.name } });
        if (!exists) await prisma.crmTemplate.create({ data: t });
      }
      console.log(`     → ${templateData.length} CRM templates`);

      // CRM 세그먼트
      const segmentData = [
        { name: '이탈 위험 환자 (HIGH)', type: 'AUTO', rules: { churnRisk: 'HIGH' }, patientCount: 0 },
        { name: '이탈 위험 환자 (MEDIUM)', type: 'AUTO', rules: { churnRisk: 'MEDIUM' }, patientCount: 0 },
        { name: '해외 환자', type: 'AUTO', rules: { nationality: { not: 'KR' } }, patientCount: 0 },
        { name: 'VIP 환자', type: 'MANUAL', rules: { tags: ['VIP'] }, patientCount: 0 },
        { name: '검진 재방문 대상', type: 'AUTO', rules: { tags: ['검진'] }, patientCount: 0 },
      ];
      for (const s of segmentData) {
        const exists = await prisma.crmSegment.findFirst({ where: { name: s.name } });
        if (!exists) await prisma.crmSegment.create({ data: s });
      }
      console.log(`     → ${segmentData.length} CRM segments`);

      // CRM 캠페인
      const templates = await prisma.crmTemplate.findMany({ take: 3 });
      const segments = await prisma.crmSegment.findMany({ take: 2 });
      const campaignData = [
        { name: '6월 국가검진 안내 캠페인', type: 'REMINDER', channel: 'SMS', status: 'COMPLETED', content: '국가검진 대상 안내 일괄 발송', targetCount: 1250, sentCount: 1230, deliveredCount: 1180, openedCount: 890, createdBy: crmManager.id, templateId: templates[0]?.id, segmentId: segments[0]?.id, sentAt: new Date('2026-06-01T09:00:00+09:00'), completedAt: new Date('2026-06-01T09:15:00+09:00') },
        { name: '여름 프리미엄 검진 프로모션', type: 'PROMOTION', channel: 'PUSH', status: 'COMPLETED', content: '프리미엄 검진 20% 할인 안내', targetCount: 3200, sentCount: 3150, deliveredCount: 3000, openedCount: 1800, createdBy: crmManager.id, templateId: templates[2]?.id, sentAt: new Date('2026-06-02T10:00:00+09:00'), completedAt: new Date('2026-06-02T10:30:00+09:00') },
        { name: '이상소견 재검진 리마인더', type: 'RECALL', channel: 'SMS', status: 'DRAFT', content: '이상 소견 환자 대상 재검진 안내', targetCount: 45, sentCount: 0, deliveredCount: 0, openedCount: 0, createdBy: crmManager.id, templateId: templates[1]?.id },
        { name: '진료 만족도 설문', type: 'SURVEY', channel: 'PUSH', status: 'COMPLETED', content: '최근 진료 경험 만족도 설문', targetCount: 500, sentCount: 498, deliveredCount: 490, openedCount: 312, clickedCount: 156, createdBy: crmManager.id, sentAt: new Date('2026-05-28T09:00:00+09:00'), completedAt: new Date('2026-05-28T09:10:00+09:00') },
        { name: '해외환자 사후관리 D+30', type: 'FOLLOW_UP', channel: 'EMAIL', status: 'DRAFT', content: 'Follow-up email for international patients', targetCount: 12, sentCount: 0, deliveredCount: 0, openedCount: 0, createdBy: crmManager.id },
      ];
      for (const c of campaignData) {
        const exists = await prisma.crmCampaign.findFirst({ where: { name: c.name } });
        if (!exists) await prisma.crmCampaign.create({ data: c });
      }
      console.log(`     → ${campaignData.length} CRM campaigns`);

      // 해외환자 케이스
      const crmPatients = await prisma.patient.findMany({ take: 5, select: { id: true } });
      if (crmStaff && crmPatients.length > 3) {
        const foreignCaseData = [
          { patientId: crmPatients[3].id, assignedTo: crmStaff.id, source: 'AGENCY', agencyName: 'China Med Tour', packageType: 'CHECKUP_PREMIUM', status: 'CONFIRMED', interpreterLang: 'zh', arrivalDate: new Date('2026-06-10'), departureDate: new Date('2026-06-14'), estimatedCost: 5500000, note: '프리미엄 검진 + 피부과 상담' },
          { patientId: crmPatients[Math.min(4, crmPatients.length - 1)].id, assignedTo: crmStaff.id, source: 'WEBSITE', packageType: 'CHECKUP_BASIC', status: 'INQUIRY', interpreterLang: 'en', note: '웹사이트 문의, 7월 방문 희망' },
          { patientId: crmPatients[2].id, assignedTo: crmStaff.id, source: 'REFERRAL', packageType: 'TREATMENT', status: 'IN_TREATMENT', interpreterLang: 'vi', arrivalDate: new Date('2026-05-28'), estimatedCost: 12000000, actualCost: 10500000, note: '정형외과 수술' },
        ];
        for (const fc of foreignCaseData) {
          const exists = await prisma.crmForeignPatientCase.findFirst({ where: { patientId: fc.patientId, source: fc.source } });
          if (!exists) await prisma.crmForeignPatientCase.create({ data: fc });
        }
        console.log(`     → ${foreignCaseData.length} foreign patient cases`);
      }

      // 포털 배너
      const bannerData = [
        { type: 'MAIN_BANNER', title: '여름 건강검진 프로모션', content: '프리미엄 검진 20% 할인! 6월 한정', linkType: 'CHECKUP_RESERVE', publishFrom: new Date('2026-06-01'), publishUntil: new Date('2026-06-30'), sortOrder: 1, createdBy: crmManager.id },
        { type: 'POPUP', title: '국가건강검진 안내', content: '올해 국가건강검진 대상자이신가요? 지금 예약하세요!', showOncePerDay: true, publishFrom: new Date('2026-06-01'), publishUntil: new Date('2026-12-31'), sortOrder: 1, createdBy: crmManager.id },
        { type: 'INLINE', title: '고혈압 관리 프로그램', content: '만성질환 관리 프로그램에 참여해보세요', linkType: 'INTERNAL', publishFrom: new Date('2026-06-01'), publishUntil: new Date('2026-09-30'), sortOrder: 2, createdBy: crmManager.id },
      ];
      for (const b of bannerData) {
        const exists = await prisma.crmPortalBanner.findFirst({ where: { title: b.title } });
        if (!exists) await prisma.crmPortalBanner.create({ data: b });
      }
      console.log(`     → ${bannerData.length} portal banners`);

      console.log('  ✅ CRM seed complete');
    }
  } catch (err) { console.warn('  [CRM] skip:', (err as Error).message); }

  // ── 제로 트러스트 단말 보안(terminal-zero-trust) — 데모/실설치 준비용 시드 ──
  try {
    // 전용(PRIVATE) 단말 전담자 = 첫 DOCTOR (있으면)
    const doctor = await prisma.user.findFirst({
      where: { role: 'DOCTOR' },
      select: { id: true },
    });
    const terminals = [
      { deviceUuid: 'TERM-NS-3F-01', mode: 'PUBLIC', location: '본관 3층 간호 스테이션', label: '간호스테이션 공용 PC', dedicatedUserId: null as string | null },
      { deviceUuid: 'TERM-ER-01', mode: 'PUBLIC', location: '응급실', label: '응급실 공용 PC', dedicatedUserId: null as string | null },
      { deviceUuid: 'TERM-RESIDENT-01', mode: 'PUBLIC', location: '전공의 의국', label: '의국 공용 PC', dedicatedUserId: null as string | null },
      { deviceUuid: 'TERM-ADMIN-01', mode: 'PUBLIC', location: '원무과', label: '원무 접수 공용 PC', dedicatedUserId: null as string | null },
      { deviceUuid: 'TERM-OFFICE-IM-01', mode: 'PRIVATE', location: '내과 교수 진료실', label: '교수 전용 iMac', dedicatedUserId: doctor?.id ?? null },
    ];
    for (const t of terminals) {
      await prisma.terminalRegistry.upsert({
        where: { deviceUuid: t.deviceUuid },
        update: { mode: t.mode, location: t.location, label: t.label, dedicatedUserId: t.dedicatedUserId, status: 'ACTIVE' },
        create: { deviceUuid: t.deviceUuid, mode: t.mode, location: t.location, label: t.label, dedicatedUserId: t.dedicatedUserId },
      });
    }
    console.log(`  ✅ Terminal registry seed: ${terminals.length} terminals (4 PUBLIC + 1 PRIVATE)`);
  } catch (err) { console.warn('  [Terminal] skip:', (err as Error).message); }

  // ── 데이터 보유/파기 정책(G1) — 전부 REPORT_ONLY·법무 미확정(파기 안 함). 의료법 시행규칙 §15 보존기간 참고값. ──
  try {
    const policies = [
      { resourceType: 'AUDIT_LOG', retentionDays: 1095, legalMinDays: 365, action: 'REPORT_ONLY', description: '접속기록(개보법 1년+) — 아카이빙(G4) 대상' },
      { resourceType: 'PRE_BOARD_ACCOUNT', retentionDays: 30, legalMinDays: 0, action: 'SOFT_DELETE', description: '미활성 임시 입사예정 계정(30일 후 비활성)' },
      { resourceType: 'MEDICAL_RECORD', retentionDays: 3650, legalMinDays: 3650, action: 'ANONYMIZE', description: '진료기록부 10년(의료법 §15) — 익명화, 법무 확정 필요' },
      { resourceType: 'PRESCRIPTION', retentionDays: 730, legalMinDays: 730, action: 'REPORT_ONLY', description: '처방전 2년(의료법 §15)' },
      { resourceType: 'CONSENT_FORM', retentionDays: 1825, legalMinDays: 1825, action: 'REPORT_ONLY', description: '동의서 5년(준용)' },
      // (2026-09-23 VoiceEMR §13 D6) 진료 대화 전사·발화 — 🔴 기간 정본은 설정 `scribe.transcript.retention` 이라 이 행의 retentionDays 는
      // 쓰이지 않는다(0 은 자리표시). REPORT_ONLY·법무 미확정 = 집계만 · 파기 요청은 서버가 거부한다(켜는 것은 사람 몫).
      { resourceType: 'SCRIBE_TRANSCRIPT', retentionDays: 0, legalMinDays: 0, action: 'REPORT_ONLY', description: '진료 대화 전사·발화(기간은 설정 scribe.transcript.retention · 법무 미결 · draftSnapshot 은 대상 아님)' },
    ];
    for (const p of policies) {
      await prisma.retentionPolicy.upsert({
        where: { resourceType: p.resourceType },
        update: { retentionDays: p.retentionDays, legalMinDays: p.legalMinDays, action: p.action, description: p.description },
        create: { ...p, legalConfirmed: false, enabled: true },
      });
    }
    console.log(`  ✅ Retention policy seed: ${policies.length} (전부 법무 미확정·DRY-RUN)`);
  } catch (err) { console.warn('  [Retention] skip:', (err as Error).message); }

  // ── 연동 개통 게이트 (LIS Reflex) — 개발 시드: 결재 3건 CONFIRMED + 인바운드 ON ──
  // ⚠️ 실운영 전 실제 결재로 교체: /admin/integration-gates에서 회수 후 실제 결재 근거로 재기록
  try {
    const lisGates = [
      { key: 'A-1', title: '수용·청구 정책 결재', owner: '진료부·원무' },
      { key: 'A-2', title: '프로토콜 승인권자 지정 + 실 프로토콜 정식 승인(four-eyes)', owner: '진단검사의학과' },
      { key: 'A-3', title: 'LIS client에 ServiceRequest.write 자격증명 발급', owner: '보안팀' },
    ];
    for (const g of lisGates) {
      await prisma.integrationGate.upsert({
        where: { track_key: { track: 'LIS_REFLEX', key: g.key } },
        update: {}, // 기존 기록(실제 결재 포함) 보존 — 멱등
        create: {
          track: 'LIS_REFLEX', key: g.key, title: g.title, owner: g.owner,
          status: 'CONFIRMED', confirmedAt: new Date(),
          evidenceType: 'OTHER', evidenceRef: '개발 시드(DEV-SEED)',
          note: '개발 시드 — 실운영 전 실제 결재로 교체 필요',
        },
      });
    }
    /**
     * 🔴 **인바운드 수용(`fhir.serviceRequestInbound.enabled`)은 시드가 켜지 않는다**
     *    (2026-09-21 · 형제 프로젝트 인바운드 R62). 이유 셋:
     *      ① 코드 기본값이 OFF 다(`config-runtime.service.ts` "외부 FHIR ServiceRequest 인바운드 수용 — 기본 OFF(차단)").
     *      ② 이 키는 **위원회 의결 표면**으로 등록돼 있다(`gld/governance.service.ts` `config:fhir.serviceRequestInbound.enabled`
     *         · OPS · "외부 기관 오더 수신"). 시드가 켜면 의결을 앞질러 결정해 버린다.
     *      ③ 개통에는 이미 **엔진이 있다** — `IntegrationGateService.activate()` 는 전 게이트 CONFIRMED 를 확인하고
     *         config 를 켜면서 `ACTIVATE` 이벤트(행위자·시각)를 남긴다. 시드가 config 를 직접 쓰면
     *         그 원장이 비어 있는 채로 열린 상태가 된다(자동화 엔진 옆에 약한 것을 만들지 않는다).
     *    게이트 3건은 `개발 시드(DEV-SEED)` 근거로 남으므로, 데모는 `/admin/integration-gates` 에서
     *    **개통 버튼 한 번**으로 켤 수 있다 — 그때 누가 열었는지가 원장에 남는다.
     */
    console.log('  ✅ Integration gate seed: LIS_REFLEX A-1~3 CONFIRMED(개발 시드) — 개통은 /admin/integration-gates 에서(시드가 켜지 않는다)');
  } catch (err) { console.warn('  [IntegrationGate] skip:', (err as Error).message); }

  /**
   * ── R1 활성화(2026-07 전체검토): 구현 완료·게이트 OFF였던 기능 ON (멱등 — 운영자 변경 보존) ──
   *
   * 🔴 이것은 **데모·리허설 기본값이지 기관의 결정이 아니다**(2026-09-21 · 인바운드 R10).
   *    여섯 키 모두 코드 기본값은 OFF 이고 설명에 "기본 OFF·opt-in" 이라 적혀 있다 — 시드가 그 위에 ON 을 얹는다.
   *    **REAL 모드에서는 이 시드가 아예 돌지 않으므로**(`seed-mode-guard` · 파일 머리) 판매 설치본은
   *    이 행들을 받지 않는다. 영향 범위는 개발·리허설 설치본이다.
   *    🔴 리허설이 어떤 기능을 켠 채 시작해야 하는지는 **사람 결정**이다 — 이 갈래는 등록부(`decision.registry*`)를
   *       건드리지 않으므로 등재는 별도 갈래·병합 후 확인 대상이다(키 후보 `seed.rehearsalFeatureDefaults` · 미등재면 등재).
   *    남은 것은 지금 이 자리에서 닫을 수 있는 것뿐이다 — 어휘 드리프트(아래 durGate).
   */
  try {
    const r1Configs: { key: string; label: string; value: unknown }[] = [
      { key: 'portal.selfBooking', label: '환자포털 셀프 예약', value: true },
      { key: 'portal.aiDrugExplain', label: '포털 AI 복약 설명', value: true },
      { key: 'portal.medicationReminder', label: '포털 복약 리마인더', value: true },
      { key: 'portal.insuranceDocBundle', label: '실손보험 서류 번들 발급', value: true },
      { key: 'treatmentSchedule.reminder', label: '치료일정 D-1 환자 리마인더', value: true },
      /**
       * 🔴 어휘는 시드에서 갈라진다 — 이 키의 정본 어휘는 **3상(OFF|WARN|BLOCK)** 인데
       *    시드가 `true`(구 boolean) 를 넣고 있었다. 호환 규칙상 `true`=BLOCK 이라 **동작은 같다** —
       *    바꾸는 것은 값이 아니라 어휘다(정책 변경 아님). 구 값이 남아 있는 DB 는 호환 분기가 계속 받는다.
       */
      { key: 'pharmacy.durGate.enforce', label: 'DUR 미해결 조제 차단(규제 §37)', value: 'BLOCK' },
    ];
    for (const c of r1Configs) {
      await prisma.systemConfig.upsert({
        where: { key: c.key },
        update: {}, // 운영자가 바꾼 값 보존
        create: { key: c.key, value: c.value as never, category: 'feature', label: c.label },
      });
    }
    console.log('  ✅ R1 feature gates ON (6) — 개발·리허설 기본값(REAL 에서는 이 시드가 돌지 않는다)');
  } catch (err) { console.warn('  [IntegrationGate] skip:', (err as Error).message); }

  console.log(`\n✅ University Hospital seed complete in ${Date.now() - startTime}ms`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
