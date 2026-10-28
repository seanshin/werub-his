import { assertSeedAllowed } from '../seed-mode-guard';
/**
 * 임상 볼륨 확장 — 영상(imaging_results) · 실행: 아래 명령
 *
 *   cd apps/api && npx ts-node --transpile-only prisma/seeds/clinical-volume-imaging.ts
 *
 * 전제: 메인 `prisma/seed.ts` 가 적용돼 환자·의사·진료(Encounter)가 있어야 한다.
 * 멱등: 결정적 UUID upsert(`upsertArgs` — `update:{}` 금지). 재실행하면 시각이 오늘 기준으로 다시 굴러간다.
 *
 * ── 왜 이 축인가 ────────────────────────────────────────────────────────
 * 운영 실측(2026-08-18): `imaging_results` **3행**. 같은 병원의 `lab_result_items` 는 1,881행이라
 * 영상 화면은 사실상 비어 있다. 환자 차트의 영상 탭·판독 대기열·워크스테이션이 전부 빈 목록이다.
 *
 * ── 🔴 PACS 에는 실제 영상이 없다 ───────────────────────────────────────
 * OpenPACS 는 별도 프로젝트이고 이 시드는 DICOM 을 만들지 않는다. 그래서
 *   · `Order.accessionNumber` 를 **채우지 않는다** (워크리스트에 등록된 적이 없다)
 *   · `Order.worklistStatus` 를 **`REGISTERED` 로 적지 않는다** (등록을 흉내내지 않는다)
 *   · 판독문은 `[시연]` 접두로 **가상임이 드러나게** 쓰고, 실제 증례를 흉내내지 않는다
 * 영상이 있는 척하면 "영상 없음"이 결함인지 사실인지 구분할 수 없게 된다.
 *
 * ── 상태 기계는 서비스와 같다 ───────────────────────────────────────────
 * `imaging.service` 실측: 결과행은 **촬영(acquire) 시점에 생긴다**(ORDERED 단계엔 결과행이 없다).
 *   ACQUIRED  = Order IN_PROGRESS(startedAt) + result.acquiredAt · 판독문 **null**(아직 안 읽었다)
 *   REPORTED  = Order COMPLETED(completedAt=reportedAt) + finding·impression·radiologistId
 * 그래서 이 시드도 ACQUIRED·REPORTED 만 만든다. 판독 전 소견을 채우면 P16(실행하지 않고 성공만 기록)이다.
 */

import type { Prisma } from '@prisma/client';

import {
  CV_TAGS,
  CvContext,
  TimeOrderRule,
  cvRandom,
  cvReport,
  cvUuid,
  intBetween,
  pickOne,
  plusHours,
  plusMinutes,
  upsertArgs,
} from './clinical-volume-core';

// ─────────────────────────── 카탈로그 ───────────────────────────

/**
 * 검사 카탈로그. 🔴 판독문은 **부위·모달리티에 맞는 일반 문구**만 쓴다 —
 * 부위와 무관한 상수 소견을 돌려 쓰면(뇌파 결과지에 심전도 판독문) 임상 오정보가 된다.
 * `normalImpression` 은 정상, `abnormalFinding`/`abnormalImpression` 은 경미 이상 소견이다.
 */
export interface ImagingStudySpec {
  modality: string;
  bodyPart: string;
  /** 촬영 소요(분) — acquiredAt 산정 */
  acquireMinutes: [number, number];
  /** 판독 소요(시간) — reportedAt 산정 */
  reportHours: [number, number];
  normalFinding: string;
  normalImpression: string;
  abnormalFinding: string;
  abnormalImpression: string;
}

export const IMAGING_STUDIES: readonly ImagingStudySpec[] = [
  {
    modality: 'CR', bodyPart: 'CHEST', acquireMinutes: [10, 45], reportHours: [1, 20],
    normalFinding: '[시연] 양측 폐야 청명. 심비대 없음. 늑횡격막각 예각 유지.',
    normalImpression: '[시연] 흉부 단순촬영상 특이 소견 없음.',
    abnormalFinding: '[시연] 우하폐야에 경계 불명확한 음영 증가. 심비대 없음. 흉수 소견 없음.',
    abnormalImpression: '[시연] 우하엽 침윤 의심 — 임상 소견과 대조 및 추적촬영 권고.',
  },
  {
    modality: 'CR', bodyPart: 'L-SPINE', acquireMinutes: [10, 40], reportHours: [2, 24],
    normalFinding: '[시연] 요추 정렬 정상. 추체 높이 유지. 급성 골절선 관찰되지 않음.',
    normalImpression: '[시연] 요추 단순촬영상 급성 이상 소견 없음.',
    abnormalFinding: '[시연] L4-5 추간판 간격 감소 및 종판 경화. 급성 골절선은 없음.',
    abnormalImpression: '[시연] 퇴행성 추간판 변화 — 증상 지속 시 MRI 고려.',
  },
  {
    modality: 'CR', bodyPart: 'KNEE', acquireMinutes: [10, 35], reportHours: [2, 24],
    normalFinding: '[시연] 관절 간격 유지. 골절 및 탈구 소견 없음.',
    normalImpression: '[시연] 슬관절 단순촬영상 특이 소견 없음.',
    abnormalFinding: '[시연] 내측 관절 간격 감소와 골극 형성. 골절선은 관찰되지 않음.',
    abnormalImpression: '[시연] 내측 구획 퇴행성 관절 변화.',
  },
  {
    modality: 'CT', bodyPart: 'ABDOMEN', acquireMinutes: [20, 60], reportHours: [2, 26],
    normalFinding: '[시연] 간·췌장·비장·신장에 국소 병변 없음. 복수 및 림프절 종대 없음.',
    normalImpression: '[시연] 복부 CT 상 특이 소견 없음.',
    abnormalFinding: '[시연] 담낭벽 비후와 주위 지방 침윤. 담석 의심 음영 동반. 복수 소견 없음.',
    abnormalImpression: '[시연] 담낭염 의심 — 임상·검사 소견과 대조 필요.',
  },
  {
    modality: 'CT', bodyPart: 'BRAIN', acquireMinutes: [15, 45], reportHours: [1, 12],
    normalFinding: '[시연] 뇌실질 밀도 정상. 급성 출혈 및 종괴 효과 없음. 뇌실 크기 정상.',
    normalImpression: '[시연] 두부 CT 상 급성 두개내 병변 없음.',
    abnormalFinding: '[시연] 좌측 기저핵 부위에 저밀도 병변. 급성 출혈 소견은 없음.',
    abnormalImpression: '[시연] 만성 허혈성 변화 의심 — MRI 로 추가 평가 권고.',
  },
  {
    modality: 'CT', bodyPart: 'CHEST', acquireMinutes: [15, 50], reportHours: [2, 26],
    normalFinding: '[시연] 폐실질에 결절 및 경화 소견 없음. 종격동 림프절 종대 없음.',
    normalImpression: '[시연] 흉부 CT 상 특이 소견 없음.',
    abnormalFinding: '[시연] 우상엽에 6mm 고형 결절. 종격동 림프절 종대는 없음.',
    abnormalImpression: '[시연] 소결절 — 추적 CT 권고.',
  },
  {
    modality: 'MR', bodyPart: 'BRAIN', acquireMinutes: [30, 75], reportHours: [4, 40],
    normalFinding: '[시연] 확산강조영상에서 제한 확산 없음. 백질 신호 정상.',
    normalImpression: '[시연] 뇌 MRI 상 급성 병변 없음.',
    abnormalFinding: '[시연] 백질에 다발성 소혈관 허혈성 신호 변화. 급성 제한 확산은 없음.',
    abnormalImpression: '[시연] 소혈관성 백질 변화 — 위험인자 관리 권고.',
  },
  {
    modality: 'MR', bodyPart: 'L-SPINE', acquireMinutes: [30, 80], reportHours: [6, 44],
    normalFinding: '[시연] 추간판 신호 유지. 신경공 협착 없음. 척수 신호 정상.',
    normalImpression: '[시연] 요추 MRI 상 신경 압박 소견 없음.',
    abnormalFinding: '[시연] L4-5 추간판 후방 돌출로 경막낭 전방 압박. 척수 신호 변화는 없음.',
    abnormalImpression: '[시연] L4-5 추간판 팽윤 — 임상 증상과 대조 필요.',
  },
  {
    modality: 'US', bodyPart: 'ABDOMEN', acquireMinutes: [15, 40], reportHours: [1, 8],
    normalFinding: '[시연] 간 실질 에코 균질. 담낭 내 결석 없음. 신장 크기·피질 두께 정상.',
    normalImpression: '[시연] 복부 초음파상 특이 소견 없음.',
    abnormalFinding: '[시연] 간 실질 에코 증가 및 심부 감쇠. 담석·담관 확장은 없음.',
    abnormalImpression: '[시연] 지방간 소견 — 대사 위험인자 평가 권고.',
  },
  {
    modality: 'US', bodyPart: 'THYROID', acquireMinutes: [12, 35], reportHours: [1, 10],
    normalFinding: '[시연] 갑상선 실질 균질. 국소 결절 없음. 경부 림프절 종대 없음.',
    normalImpression: '[시연] 갑상선 초음파상 특이 소견 없음.',
    abnormalFinding: '[시연] 우엽에 8mm 등에코 결절, 경계 명확, 미세석회화 없음.',
    abnormalImpression: '[시연] 양성 가능성 높은 결절 — 추적 초음파 권고.',
  },
  {
    modality: 'MG', bodyPart: 'BREAST', acquireMinutes: [15, 40], reportHours: [4, 40],
    normalFinding: '[시연] 유방 실질 밀도 균등. 종괴 및 미세석회화 군집 없음.',
    normalImpression: '[시연] 유방촬영상 악성 시사 소견 없음.',
    abnormalFinding: '[시연] 좌측 상외측에 국소 비대칭 음영. 미세석회화 군집은 없음.',
    abnormalImpression: '[시연] 추가 압박촬영 및 초음파 권고.',
  },
] as const;

// ─────────────────────────── 생성기 ───────────────────────────

export interface CvEncounterRef {
  id: string;
  patientId: string;
  /** 진료 시각 — 영상 오더는 이 뒤에 난다 */
  at: Date;
}

export interface ImagingSeedContext extends CvContext {
  encounters: CvEncounterRef[];
  /** 판독의(영상의학과가 따로 없으면 의사 풀) */
  radiologists: string[];
}

/**
 * 생성 행 — 🔴 타입을 **Prisma 의 CreateInput 그대로** 쓴다.
 *    자체 인터페이스로 적으면 필드명 오타를 tsc 가 못 잡는다(비-리터럴 대입은 초과 속성
 *    검사를 타지 않는다 — 실제로 가짜 필드가 통과하는 것을 확인하고 이 형태로 바꿨다).
 *    여기서는 객체 리터럴이 이 타입에 직접 대입되므로 오타·타입 불일치가 즉시 실패한다.
 */
export interface ImagingSeedRow {
  index: number;
  prescription: Prisma.PrescriptionUncheckedCreateInput & { id: string };
  order: Prisma.OrderUncheckedCreateInput & { id: string };
  result: Prisma.ImagingResultUncheckedCreateInput & { id: string };
}

/** 시각 순서 규칙 — 가드가 이 표대로 검사한다 */
export const IMAGING_ORDER_TIME_RULES: readonly TimeOrderRule[] = [
  ['createdAt', 'receivedAt'],
  ['receivedAt', 'startedAt'],
  ['startedAt', 'completedAt'],
] as const;

export const IMAGING_RESULT_TIME_RULES: readonly TimeOrderRule[] = [
  ['createdAt', 'acquiredAt'],
  ['acquiredAt', 'reportedAt'],
] as const;

/** 기본 생성 건수 — 화면 목록·필터·페이지네이션이 의미를 갖는 최소 규모 */
export const IMAGING_DEFAULT_COUNT = 160;

/**
 * 영상 검사 생성. **미래 시각은 만들지 않는다** — 판독 예정 시각이 now 를 넘으면
 * 그 건은 REPORTED 가 아니라 **ACQUIRED(판독 대기)** 가 된다. 그게 사실이다.
 * 촬영 시각조차 now 를 넘으면 그 건은 **아예 만들지 않는다**(잘랐다고 로그로 말한다).
 */
export function buildImagingStudies(ctx: ImagingSeedContext, count = IMAGING_DEFAULT_COUNT): ImagingSeedRow[] {
  if (!ctx.encounters.length || !ctx.doctors.length || !ctx.radiologists.length) return [];
  const rows: ImagingSeedRow[] = [];

  for (let i = 0; i < count; i++) {
    const enc = ctx.encounters[i % ctx.encounters.length];
    const r = cvRandom(`cv-imaging:${i}:${enc.id}`);
    const spec = pickOne(IMAGING_STUDIES, r());

    const doctorId = ctx.doctors[i % ctx.doctors.length];
    const techId = ctx.nurses[i % ctx.nurses.length]; // 촬영 접수·시행자(방사선사 역할 계정이 별도로 없다)
    const radId = ctx.radiologists[i % ctx.radiologists.length];

    // 진료 → 오더 → 접수 → 촬영 → 판독. 각 구간은 결정적이되 겹치지 않는다.
    const orderedAt = plusMinutes(enc.at, intBetween(r(), 5, 90));
    const receivedAt = plusMinutes(orderedAt, intBetween(r(), 5, 60));
    const acquiredAt = plusMinutes(receivedAt, intBetween(r(), spec.acquireMinutes[0], spec.acquireMinutes[1]));
    const plannedReportAt = plusHours(acquiredAt, intBetween(r(), spec.reportHours[0], spec.reportHours[1]));

    // 촬영조차 미래면 이 건은 존재할 수 없다 — 만들지 않는다
    if (acquiredAt.getTime() > ctx.now.getTime()) continue;

    const reported = plannedReportAt.getTime() <= ctx.now.getTime();
    const abnormal = r() < 0.28; // 이상 소견 비율 — 전부 정상이면 화면이 아무것도 못 보여준다
    const priority = r() < 0.15 ? 'STAT' : 'ROUTINE';

    const prescriptionId = cvUuid(CV_TAGS.imagingPrescription, i);
    const orderId = cvUuid(CV_TAGS.imagingOrder, i);
    const resultId = cvUuid(CV_TAGS.imagingResult, i);

    rows.push({
      index: i,
      prescription: {
        id: prescriptionId, encounterId: enc.id, type: 'IMAGING',
        instructions: `${spec.modality} ${spec.bodyPart} — 시연용 영상 오더`,
        priority, status: 'ACTIVE', createdAt: orderedAt, createdBy: doctorId, prescriberId: doctorId,
      },
      order: {
        id: orderId, prescriptionId, department: 'IMAGING',
        status: reported ? 'COMPLETED' : 'IN_PROGRESS', priority,
        receivedAt, receivedById: techId,
        startedAt: acquiredAt, startedById: techId,
        completedAt: reported ? plannedReportAt : null,
        completedById: reported ? radId : null,
        createdAt: orderedAt,
        // 🔴 accessionNumber·worklistStatus 는 비운다 — PACS 워크리스트에 등록한 적이 없다
        notes: '시연 데이터(clinical-volume) — PACS 워크리스트 미등록·DICOM 없음',
      },
      result: {
        id: resultId, orderId, patientId: enc.patientId,
        modality: spec.modality, bodyPart: spec.bodyPart,
        status: reported ? 'REPORTED' : 'ACQUIRED',
        radiologistId: reported ? radId : null,
        // 🔴 판독 전에는 소견이 없다 — null 이 사실이다
        finding: reported ? (abnormal ? spec.abnormalFinding : spec.normalFinding) : null,
        impression: reported ? (abnormal ? spec.abnormalImpression : spec.normalImpression) : null,
        acquiredAt,
        reportedAt: reported ? plannedReportAt : null,
        createdAt: acquiredAt,
      },
    });
  }
  return rows;
}

// ─────────────────────────── 실행 ───────────────────────────

async function main(): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const now = new Date();
    const encounters = await prisma.encounter.findMany({
      select: { id: true, patientId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 400,
    });
    const doctors = await prisma.user.findMany({ where: { role: 'DOCTOR' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    const nurses = await prisma.user.findMany({ where: { role: 'NURSE' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    if (!encounters.length || !doctors.length || !nurses.length) {
      console.log('[clinical-volume:imaging] 진료/의사/간호사 없음 — 메인 seed 먼저. 건너뜀');
      return;
    }

    const ctx: ImagingSeedContext = {
      now,
      patients: [],
      doctors: doctors.map((d) => d.id),
      nurses: nurses.map((n) => n.id),
      radiologists: doctors.map((d) => d.id),
      encounters: encounters.map((e) => ({ id: e.id, patientId: e.patientId, at: e.createdAt })),
    };

    const rows = buildImagingStudies(ctx);
    if (rows.length < IMAGING_DEFAULT_COUNT) {
      console.log(`[clinical-volume:imaging] ${IMAGING_DEFAULT_COUNT - rows.length}건은 촬영 시각이 미래라 만들지 않았다(잘랐다)`);
    }

    // 🔴 Prisma 델리게이트를 직접 부른다 — 범용 헬퍼로 감싸면 필드명 오타를 tsc 가 못 잡는다.
    //    부모(처방)→오더→결과 순서. FK 가 없는 상태로 자식을 먼저 넣으면 전건 실패한다.
    for (const x of rows) await prisma.prescription.upsert(upsertArgs(x.prescription));
    for (const x of rows) await prisma.order.upsert(upsertArgs(x.order));
    for (const x of rows) await prisma.imagingResult.upsert(upsertArgs(x.result));

    cvReport('imaging', {
      prescriptions: rows.length,
      orders: rows.length,
      results: rows.length,
      reported: rows.filter((x) => x.result.status === 'REPORTED').length,
      acquired: rows.filter((x) => x.result.status === 'ACQUIRED').length,
    });
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) assertSeedAllowed(__filename, 'DEMO'); // 🔴 실행 진입에서만 판정 — 테스트가 이 모듈을 import 하므로 최상단에 두지 않는다(상용 릴리즈 T2-3)
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
