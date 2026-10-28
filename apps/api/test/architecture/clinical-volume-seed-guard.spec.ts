import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  INCIDENT_SEVERITIES,
  isCanonicalAnesthesiaCode,
  normalizeIncidentSeverity,
  shiftOf,
} from '@hospital-run/shared';

import { scoreNews2 } from '@hospital-run/shared';
import { CreateFlowSheetEntryDto } from '../../src/modules/nursing/dto/create-flowsheet-entry.dto';

import {
  CV_TAGS,
  CV_UUID_PREFIX,
  CvContext,
  checkNoFuture,
  checkPlausible,
  CV_PLAUSIBLE_RANGE,
  checkTimeOrder,
  cvUuid,
  plausibleKeysCovered,
  upsertArgs,
} from '../../prisma/seeds/clinical-volume-core';
import {
  IMAGING_ORDER_TIME_RULES,
  IMAGING_RESULT_TIME_RULES,
  ImagingSeedContext,
  buildImagingStudies,
} from '../../prisma/seeds/clinical-volume-imaging';
import {
  HANDOFF_TIME_RULES,
  NursingSeedContext,
  ROUND_WINDOWS,
  buildFlowSheetEntries,
  buildHandoffs,
  buildNursingNotes,
  buildRounds,
} from '../../prisma/seeds/clinical-volume-nursing';
import {
  CODE_BLUE_TIME_RULES,
  CriticalSeedContext,
  DISPOSITION_TIME_RULES,
  ICU_TIME_RULES,
  RRT_TIME_RULES,
  buildCodeBlueEvents,
  buildEmergencyDispositions,
  buildEmergencyReassessments,
  buildIcuAdmissions,
  buildRrtActivations,
} from '../../prisma/seeds/clinical-volume-critical';
import {
  ANESTHESIA_TIME_RULES,
  ANESTHESIA_TO_PLAN,
  CHECKLIST_TIME_RULES,
  OPNOTE_TIME_RULES,
  PRE_ANESTHESIA_TIME_RULES,
  SURGERY_TIME_RULES,
  SurgerySeedContext,
  buildSurgeries,
} from '../../prisma/seeds/clinical-volume-surgery';
import {
  HAI_SPECS,
  INCIDENT_TIME_RULES,
  MDRO_SPECS,
  buildHaiCases,
  buildMdroRegistry,
  buildSafetyIncidents,
} from '../../prisma/seeds/clinical-volume-safety';
import {
  ADMISSION_TIME_RULES,
  CvInpatientAdmissionRef,
  CvMedRef,
  InpatientSeedContext,
  MAR_ALLOWED_INGREDIENTS,
  MAR_DENY_SUBSTRINGS,
  MAR_TIME_RULES,
  NURSING_NOTE_TIME_RULES,
  buildAdmissionNursingNotes,
  buildDischargedAdmissions,
  buildInpatientMedications,
  isMarSafeMedication,
} from '../../prisma/seeds/clinical-volume-inpatient';

/**
 * 🔴 임상 볼륨 확장 시드가 **모순된 데이터를 만들지 않는가** — 시드를 실행하지 않고 검증한다.
 *
 * 생성 로직이 Prisma 에서 분리된 순수 함수라 DB 없이 결과를 직접 본다
 * (`prisma/seeds/qi-measurement.ts` + `qi-seed-derivation-guard.spec.ts` 와 같은 구조).
 *
 * 각 단언은 **이 저장소에서 실제로 난 결함**을 막는다:
 *   · Morse 45 를 MODERATE 로 심음 → 판정은 정본 함수로 재계산해 비교한다
 *   · 농뇨 50-100/HPF 를 '정상' 으로 심음 → 어휘는 정본 목록으로 검사한다
 *   · 만료 혈소판을 AVAILABLE 로 심음 → 상태는 날짜에서 파생됨을 검사한다(여기선 MDRO active↔clearedAt)
 *   · QI 측정 273/300 이 값≠분자/분모 → 파생값은 원자료에서 재계산해 비교한다
 *   · 14세 신장 260cm → 생리학적 가능 범위 밖 값을 거른다
 *
 * 🔴 **가드는 결함을 재주입하면 실패해야 가드다.** 재주입 검증 결과는 보고서에 적었다.
 *    (부분 문자열 단언·주석 오독으로 헛돈 사례가 이 저장소에 10건 있다 — 여기서는 값으로 검사한다)
 */

// ─────────────────────────── 고정 픽스처 ───────────────────────────
//
// 🔴 `now` 를 고정한다. `new Date()` 를 쓰면 "오늘은 통과하고 내일은 실패하는" 가드가 된다.

const NOW = new Date('2026-08-18T09:00:00+09:00');
const uid = (n: number) => `00000000-0000-4000-9000-${n.toString(16).padStart(12, '0')}`;

const PATIENTS = Array.from({ length: 40 }, (_, i) => ({
  id: uid(1000 + i),
  dateOfBirth: new Date(1960 + (i % 45), i % 12, 1 + (i % 27)),
  gender: i % 2 === 0 ? 'MALE' : 'FEMALE',
}));
const DOCTORS = Array.from({ length: 8 }, (_, i) => uid(2000 + i));
const NURSES = Array.from({ length: 10 }, (_, i) => uid(3000 + i));

const BASE: CvContext = { now: NOW, patients: PATIENTS, doctors: DOCTORS, nurses: NURSES };

/**
 * 🔴 진료 표본에 **몇 시간 전 진료**를 반드시 섞는다.
 *    전부 며칠 전이면 영상이 전건 REPORTED 가 되어 "판독 전에는 소견이 없다" 단언의
 *    else 가지가 한 번도 실행되지 않는다 — 결함을 재주입해도 통과했다(실제로 확인함).
 *    표본이 없으면 가드는 아무것도 보증하지 않는다.
 */
const ENCOUNTERS = [
  ...Array.from({ length: 30 }, (_, i) => ({
    id: uid(4000 + i),
    patientId: PATIENTS[i % PATIENTS.length].id,
    at: new Date(NOW.getTime() - (i + 1) * 3 * 86_400_000),
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    id: uid(4900 + i),
    patientId: PATIENTS[(i + 5) % PATIENTS.length].id,
    at: new Date(NOW.getTime() - (5 + i * 2) * 3_600_000), // 5·7·9…19시간 전 = 판독 대기 표본
  })),
];

const ADMISSIONS = Array.from({ length: 12 }, (_, i) => ({
  id: uid(5000 + i),
  patientId: PATIENTS[i % PATIENTS.length].id,
  admitDate: new Date(NOW.getTime() - (14 + i * 5) * 86_400_000),
  dischargeDate: i % 3 === 0 ? null : new Date(NOW.getTime() - (14 + i * 5 - 7) * 86_400_000),
  admittingDoctorId: DOCTORS[i % DOCTORS.length],
}));

const EMERGENCY_VISITS = Array.from({ length: 40 }, (_, i) => ({
  id: uid(6000 + i),
  patientId: PATIENTS[i % PATIENTS.length].id,
  arrivalAt: new Date(NOW.getTime() - (i + 1) * 2 * 86_400_000),
  triageLevel: (['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4', 'LEVEL_5'] as const)[i % 5],
  status: i % 10 === 0 ? 'IN_TREATMENT' : 'COMPLETED',
  doctorId: i % 4 === 0 ? null : DOCTORS[i % DOCTORS.length],
  hasDisposition: i % 9 === 0,
}));

const ICU_BEDS = Array.from({ length: 8 }, (_, i) => ({ id: uid(7000 + i), unitName: 'ICU-A', bedNumber: `A-${i + 1}` }));

const imagingCtx: ImagingSeedContext = { ...BASE, encounters: ENCOUNTERS, radiologists: DOCTORS };
const nursingCtx: NursingSeedContext = {
  ...BASE,
  admissions: ADMISSIONS,
  encounters: ENCOUNTERS,
  emergencyVisits: EMERGENCY_VISITS.map((v) => ({ id: v.id, patientId: v.patientId, at: v.arrivalAt })),
};
const criticalCtx: CriticalSeedContext = {
  ...BASE,
  emergencyVisits: EMERGENCY_VISITS,
  icuBeds: ICU_BEDS,
};
const surgeryCtx: SurgerySeedContext = { ...BASE, anesthetists: DOCTORS };

// 생성물 — describe 밖에서 한 번만 만든다(결정적이라 매번 같다)
const imaging = buildImagingStudies(imagingCtx);
const flowsheets = buildFlowSheetEntries(nursingCtx);
const nursingNotes = buildNursingNotes(nursingCtx);
const handoffs = buildHandoffs(nursingCtx);
const rounds = buildRounds(nursingCtx);
const codeBlues = buildCodeBlueEvents(criticalCtx);
const rrts = buildRrtActivations(criticalCtx);
const icuAdmissions = buildIcuAdmissions(criticalCtx);
const dispositions = buildEmergencyDispositions(criticalCtx);
const reassessments = buildEmergencyReassessments(criticalCtx);
const surgeries = buildSurgeries(surgeryCtx);
const incidents = buildSafetyIncidents(BASE);
const haiCases = buildHaiCases(BASE);
const mdro = buildMdroRegistry(BASE);

/** 전 도메인의 행을 (라벨, 행) 쌍으로 편다 — 공통 규칙을 한 번에 검사한다 */
const ALL_ROWS: { label: string; rows: Record<string, unknown>[] }[] = [
  { label: 'imaging.prescription', rows: imaging.map((x) => x.prescription) },
  { label: 'imaging.order', rows: imaging.map((x) => x.order) },
  { label: 'imaging.result', rows: imaging.map((x) => x.result) },
  { label: 'flowSheetEntry', rows: flowsheets },
  { label: 'nursingNote', rows: nursingNotes },
  { label: 'handoff', rows: handoffs },
  { label: 'round', rows: rounds },
  { label: 'codeBlue', rows: codeBlues },
  { label: 'rrt', rows: rrts.map((x) => x.row) },
  { label: 'icuAdmission', rows: icuAdmissions },
  { label: 'emergencyDisposition', rows: dispositions },
  { label: 'emergencyReassessment', rows: reassessments },
  { label: 'surgery', rows: surgeries.map((x) => x.surgery) },
  { label: 'surgery.opNote', rows: surgeries.map((x) => x.opNote) },
  { label: 'surgery.anesthesia', rows: surgeries.map((x) => x.anesthesia) },
  { label: 'surgery.checklist', rows: surgeries.map((x) => x.checklist) },
  { label: 'surgery.preAnesthesia', rows: surgeries.map((x) => x.preAnesthesia) },
  { label: 'safetyIncident', rows: incidents.map((x) => x.incident) },
  { label: 'rcaReport', rows: incidents.filter((x) => x.rca).map((x) => x.rca!) },
  { label: 'haiCase', rows: haiCases },
  { label: 'mdroRegistry', rows: mdro },
];

describe('임상 볼륨 시드 — 공통 규칙', () => {
  it('① 생성기가 실제로 행을 만든다 (빈 배열을 통과시키면 아래 단언 전부가 헛돈다)', () => {
    // 🔴 이 가드가 헛돌던 전형: 픽스처가 비어 생성물이 0건인데 "위반 0건"으로 통과한다.
    for (const { label, rows } of ALL_ROWS) {
      expect(rows.length, `${label} 이 0건 — 생성기가 아무것도 만들지 않았다`).toBeGreaterThan(0);
    }
    expect(imaging.length).toBeGreaterThan(50);
    expect(flowsheets.length).toBeGreaterThan(100);
    // 🔴 상태별 표본도 있어야 한다 — 한쪽이 0건이면 그 가지의 단언은 헛돈다
    expect(imaging.some((x) => x.result.status === 'REPORTED'), '판독 완료 표본 0').toBe(true);
    expect(imaging.some((x) => x.result.status === 'ACQUIRED'), '판독 대기 표본 0 — 아래 else 가지가 헛돈다').toBe(true);
  });

  it('⑧ 🔴 멱등 규약 — upsert 의 update 는 비어 있지 않다 (`update:{}` 는 재실행해도 날짜가 안 굴러간다)', () => {
    // 기존 시드 207 upsert 중 159 가 `update:{}` 라 축마다 시점이 고착됐다. 그 형태로 되돌아가면 실패한다.
    const sample = { id: 'x', a: 1, at: NOW } as const;
    const args = upsertArgs(sample);
    expect(Object.keys(args.update).length, 'update 가 비었다 — 재실행이 아무것도 갱신하지 않는다').toBeGreaterThan(0);
    expect(args.update).toEqual({ a: 1, at: NOW });
    expect(args.create).toEqual(sample);
    expect('id' in args.update, 'update 에 id 가 들어 있다').toBe(false);

    // 실제 생성 행으로도 확인한다(도메인 시드가 이 헬퍼를 통과시키는 형태인지)
    for (const { label, rows } of ALL_ROWS) {
      const row = rows[0] as { id: string };
      const u = upsertArgs(row);
      expect(Object.keys(u.update).length, `${label}: update 가 비었다`).toBeGreaterThan(0);
    }
  });

  it('② 모든 id 가 이 축 전용 네임스페이스이고 서로 겹치지 않는다', () => {
    const seen = new Map<string, string>();
    for (const { label, rows } of ALL_ROWS) {
      for (const row of rows) {
        const id = row.id as string;
        expect(id, `${label} 행에 id 가 없다`).toBeTruthy();
        expect(id.startsWith(CV_UUID_PREFIX), `${label}: ${id} 가 이 축 네임스페이스(${CV_UUID_PREFIX})가 아니다`).toBe(true);
        // 다른 시드(메인 seed.ts) 네임스페이스와 겹치면 남의 행을 덮어쓴다
        expect(id.startsWith('00000000-0000-4000-a000-'), `${label}: ${id} 가 기존 시드 네임스페이스와 겹친다`).toBe(false);
        const prev = seen.get(id);
        expect(prev, `id 중복 ${id} — ${prev} 와 ${label} 이 같은 행을 덮어쓴다`).toBeUndefined();
        seen.set(id, label);
      }
    }
  });

  it('③ 테이블 태그가 서로 겹치지 않는다 (겹치면 두 테이블이 같은 id 공간을 쓴다)', () => {
    const values = Object.values(CV_TAGS);
    expect(new Set(values).size, `CV_TAGS 값 중복: ${values.join(',')}`).toBe(values.length);
    for (const v of values) expect(v, `태그 형식 오류: ${v}`).toMatch(/^[0-9a-f]{4}$/);
  });

  it('④ id 공간을 벗어나면 조용히 겹치지 않고 터진다', () => {
    expect(() => cvUuid(CV_TAGS.imagingResult, -1)).toThrow();
    expect(() => cvUuid(CV_TAGS.imagingResult, 0x1_0000_0000)).toThrow();
  });

  it('⑤ 미래 시각이 없다 (followUpDate=예약만 예외)', () => {
    const bad: string[] = [];
    for (const { label, rows } of ALL_ROWS) {
      // 🔴 추적 예약일은 앞날의 계획이라 미래가 정상이다. 그 외 시각은 전부 기록된 사실이어야 한다.
      const stripped = rows.map((r) => {
        const { followUpDate: _f, ...rest } = r as Record<string, unknown>;
        return rest;
      });
      bad.push(...checkNoFuture(stripped, NOW, label));
    }
    expect(bad, `미래 시각 ${bad.length}건`).toEqual([]);
  });

  it('⑥ 시각 순서가 뒤집히지 않는다 (결과는 오더 뒤 · 완료는 시작 뒤 · 종료는 시작 뒤)', () => {
    const bad = [
      ...checkTimeOrder(imaging.map((x) => x.order), IMAGING_ORDER_TIME_RULES, 'imaging.order'),
      ...checkTimeOrder(imaging.map((x) => x.result), IMAGING_RESULT_TIME_RULES, 'imaging.result'),
      ...checkTimeOrder(handoffs, HANDOFF_TIME_RULES, 'handoff'),
      ...checkTimeOrder(codeBlues, CODE_BLUE_TIME_RULES, 'codeBlue'),
      ...checkTimeOrder(rrts.map((x) => x.row), RRT_TIME_RULES, 'rrt'),
      ...checkTimeOrder(icuAdmissions, ICU_TIME_RULES, 'icuAdmission'),
      ...checkTimeOrder(dispositions, DISPOSITION_TIME_RULES, 'emergencyDisposition'),
      ...checkTimeOrder(surgeries.map((x) => x.surgery), SURGERY_TIME_RULES, 'surgery'),
      ...checkTimeOrder(surgeries.map((x) => x.opNote), OPNOTE_TIME_RULES, 'surgery.opNote'),
      ...checkTimeOrder(surgeries.map((x) => x.anesthesia), ANESTHESIA_TIME_RULES, 'surgery.anesthesia'),
      ...checkTimeOrder(surgeries.map((x) => x.checklist), CHECKLIST_TIME_RULES, 'surgery.checklist'),
      ...checkTimeOrder(surgeries.map((x) => x.preAnesthesia), PRE_ANESTHESIA_TIME_RULES, 'surgery.preAnesthesia'),
      ...checkTimeOrder(incidents.map((x) => x.incident), INCIDENT_TIME_RULES, 'safetyIncident'),
    ];
    expect(bad, `시각 순서 위반 ${bad.length}건`).toEqual([]);
  });

  it('⑦ 생리학적으로 불가능한 값이 없다 (14세 신장 260cm·HbA1c 2% 재발 방지)', () => {
    const bad: string[] = [];
    for (const { label, rows } of ALL_ROWS) bad.push(...checkPlausible(rows, label));
    bad.push(...checkPlausible(rrts.map((x) => x.vitals as unknown as Record<string, unknown>), 'rrt.vitals'));
    expect(bad, `범위 밖 값 ${bad.length}건`).toEqual([]);
  });

  it('⑨ 🔴 범위표의 모든 키가 실제 행에 존재한다 (없는 키를 적어두면 검사가 있는 척만 한다)', () => {
    const all = ALL_ROWS.flatMap((x) => x.rows).concat(rrts.map((x) => x.vitals as unknown as Record<string, unknown>));
    const covered = plausibleKeysCovered(all);
    const dead = Object.keys(CV_PLAUSIBLE_RANGE).filter((k) => !covered.has(k));
    expect(dead, `어느 행에도 없는 범위표 키 ${dead.length}개 — 이 항목의 범위 검사는 한 번도 실행되지 않는다`).toEqual([]);
  });
});

describe('영상 — 상태와 판독문이 서로 맞는다', () => {
  it('판독 완료가 아니면 소견이 없다 (판독 전 소견은 P16: 실행하지 않고 성공만 기록)', () => {
    for (const x of imaging) {
      if (x.result.status === 'REPORTED') {
        expect(x.result.finding, `${x.index}: REPORTED 인데 소견이 없다`).toBeTruthy();
        expect(x.result.impression).toBeTruthy();
        expect(x.result.radiologistId).toBeTruthy();
        expect(x.result.reportedAt).toBeInstanceOf(Date);
        expect(x.order.status, `${x.index}: 판독 완료인데 오더가 COMPLETED 가 아니다`).toBe('COMPLETED');
        expect(x.order.completedAt).toEqual(x.result.reportedAt);
      } else {
        expect(x.result.finding, `${x.index}: 촬영만 했는데 소견이 있다`).toBeNull();
        expect(x.result.impression).toBeNull();
        expect(x.result.radiologistId).toBeNull();
        expect(x.result.reportedAt).toBeNull();
        expect(x.order.status).toBe('IN_PROGRESS');
        expect(x.order.completedAt).toBeNull();
      }
    }
  });

  it('🔴 PACS 워크리스트 등록을 흉내내지 않는다 (DICOM 이 없다)', () => {
    for (const x of imaging) {
      expect(x.order.accessionNumber ?? null, 'accession 번호를 채웠다 — 워크리스트에 등록한 적이 없다').toBeNull();
      expect(x.order.worklistStatus ?? null, '워크리스트 상태를 채웠다 — 등록을 흉내내는 것이다').toBeNull();
    }
  });

  it('소견은 검사 부위에 맞는 것만 쓴다 (뇌파 결과지에 심전도 판독문 재발 방지)', () => {
    const reported = imaging.filter((x) => x.result.status === 'REPORTED');
    expect(reported.length).toBeGreaterThan(0);
    // 같은 modality/bodyPart 조합에서 나온 소견은 그 조합의 카탈로그 문구여야 한다
    const byPair = new Map<string, Set<string>>();
    for (const x of reported) {
      const key = `${x.result.modality}/${x.result.bodyPart}`;
      if (!byPair.has(key)) byPair.set(key, new Set());
      byPair.get(key)!.add(String(x.result.finding));
    }
    for (const [key, findings] of byPair) {
      // 한 조합당 정상/이상 두 문구까지만 — 셋 이상이면 다른 검사 문구가 섞인 것이다
      expect(findings.size, `${key}: 소견 문구가 ${findings.size}종 — 다른 검사 문구가 섞였다`).toBeLessThanOrEqual(2);
    }
  });
});

describe('간호 — 근무 판정과 API 검증 범위를 지킨다', () => {
  it('🔴 shiftType 은 정본 `shiftOf(recordedAt)` 와 같다 (시드가 자기 교대 경계를 적지 않는다)', () => {
    const bad = flowsheets
      .filter((e) => e.shiftType !== shiftOf(e.recordedAt as Date))
      .map((e) => `${(e.recordedAt as Date).toISOString()} → 저장 ${e.shiftType} · 정본 ${shiftOf(e.recordedAt as Date)}`);
    expect(bad, `근무 판정 불일치 ${bad.length}건`).toEqual([]);
  });

  it('🔴 생성한 활력이 실제 API DTO 검증을 통과한다 (화면엔 있는데 재입력하면 400 인 값 금지)', () => {
    const bad: string[] = [];
    for (const e of flowsheets) {
      const dto = plainToInstance(CreateFlowSheetEntryDto, {
        recordedAt: (e.recordedAt as Date).toISOString(),
        systolicBp: e.systolicBp, diastolicBp: e.diastolicBp, heartRate: e.heartRate,
        temperature: e.temperature, spo2: e.spo2, respiratoryRate: e.respiratoryRate,
        consciousness: e.consciousness, painScore: e.painScore,
        ...(e.painLocation ? { painLocation: e.painLocation } : {}),
        intakeOral: e.intakeOral, intakeIv: e.intakeIv, intakeOther: e.intakeOther,
        outputUrine: e.outputUrine, outputDrain: e.outputDrain, outputOther: e.outputOther,
        gcsScore: e.gcsScore, shiftType: e.shiftType,
      });
      const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: false });
      if (errors.length) bad.push(`${(e.recordedAt as Date).toISOString()}: ${errors.map((x) => x.property).join(',')}`);
    }
    expect(bad.slice(0, 10), `DTO 검증 실패 ${bad.length}/${flowsheets.length}건`).toEqual([]);
  });

  it('기록은 입원 기간 안에서만 난다 (입원 전·퇴원 후 기록 금지)', () => {
    const byId = new Map(ADMISSIONS.map((a) => [a.id, a]));
    for (const e of flowsheets) {
      const adm = byId.get(e.admissionId as string)!;
      const at = (e.recordedAt as Date).getTime();
      expect(at, `입원 전 기록`).toBeGreaterThanOrEqual(adm.admitDate.getTime());
      const end = adm.dischargeDate ? adm.dischargeDate.getTime() : NOW.getTime();
      expect(at, `퇴원 후 기록`).toBeLessThanOrEqual(end);
    }
    for (const r of rounds) {
      const adm = byId.get(r.admissionId as string)!;
      const at = (r.roundedAt as Date).getTime();
      expect(at).toBeGreaterThanOrEqual(adm.admitDate.getTime());
      expect(at).toBeLessThanOrEqual(adm.dischargeDate ? adm.dischargeDate.getTime() : NOW.getTime());
    }
  });

  it('회진 유형과 회진 시각이 맞는다 (야간 회진이 오전 9시에 있지 않다)', () => {
    for (const r of rounds) {
      const [lo, hi] = ROUND_WINDOWS[r.roundType as string];
      const h = (r.roundedAt as Date).getHours();
      expect(h, `${r.roundType} 회진이 ${h}시 — 창(${lo}~${hi}) 밖`).toBeGreaterThanOrEqual(lo);
      expect(h).toBeLessThanOrEqual(hi);
    }
  });

  it('간호기록 컨텍스트 어휘는 화면이 아는 값만 쓴다', () => {
    const known = new Set(['EMERGENCY', 'PACU', 'SURGERY', 'OUTPATIENT', 'LAB', 'IMAGING']);
    for (const n of nursingNotes) {
      expect(known.has(n.contextType as string), `화면이 모르는 contextType: ${n.contextType}`).toBe(true);
      expect(n.shiftType).toBe(shiftOf(n.recordedAt as Date));
    }
  });
});

describe('중환자·응급 — 결과와 근거가 서로 맞는다', () => {
  it('🔴 RRT 사유 NEWS2 는 실제로 NEWS2 고위험일 때만 쓴다 (정본 재계산 일치)', () => {
    const bad: string[] = [];
    for (const x of rrts) {
      // 🔴 재계산은 **정본**(shared)으로 한다 — 종전엔 ICU 판으로 검산해서
      //    ICU 판이 정본과 어긋나 있어도 이 가드는 초록이었다(같은 틀린 자로 두 번 잰 셈).
      const recomputed = scoreNews2({ ...x.vitals, spO2: x.vitals.spo2 })?.totalScore ?? null;
      if (recomputed == null) { bad.push('활력 관측이 부족해 NEWS2 를 산출할 수 없는 행이 만들어졌다'); continue; }
      if (recomputed !== x.news2) bad.push(`저장 근거 ${x.news2} ≠ 정본 재계산 ${recomputed}`);
      if (x.row.trigger === 'NEWS2' && recomputed < 7) bad.push(`trigger=NEWS2 인데 점수 ${recomputed}(<7)`);
      if (x.row.trigger !== 'NEWS2' && recomputed >= 7) bad.push(`점수 ${recomputed}(≥7) 인데 trigger=${x.row.trigger}`);
    }
    expect(bad, `RRT 사유↔활력 불일치 ${bad.length}건`).toEqual([]);
    expect(rrts.filter((x) => x.row.trigger === 'NEWS2').length, 'NEWS2 발동이 하나도 없다 — 표본이 없으면 위 단언이 헛돈다').toBeGreaterThan(0);
  });

  it('코드블루 결과와 시각이 맞는다 (사망인데 ROSC 시각이 있지 않다)', () => {
    for (const e of codeBlues) {
      if (e.outcome === 'DEATH') expect(e.roscAt ?? null, '사망인데 자발순환 회복 시각이 있다').toBeNull();
      else expect(e.roscAt, `${e.outcome} 인데 ROSC 시각이 없다`).toBeInstanceOf(Date);
      expect(e.endedAt, '종료 시각이 없다').toBeInstanceOf(Date);
    }
    expect(codeBlues.some((e) => e.outcome === 'DEATH')).toBe(true);
    expect(codeBlues.some((e) => e.outcome === 'ROSC')).toBe(true);
  });

  it('🔴 ICU 이력은 전부 퇴실 완료다 (재원 중을 만들면 병상 점유와 어긋난다)', () => {
    for (const a of icuAdmissions) {
      expect(a.status, 'ADMITTED 를 만들면 icu_beds 점유 상태와 어긋난다').toBe('DISCHARGED');
      expect(a.dischargeDate, '퇴실 완료인데 퇴실 시각이 없다').toBeInstanceOf(Date);
      // 경증에 인공호흡기가 붙으면 지표가 거짓이 된다
      if (a.severity === 'MODERATE') expect(a.ventilator).toBe(false);
    }
  });

  it('응급 처분 — 이미 처분이 있거나 진행 중인 방문은 건드리지 않는다', () => {
    const byId = new Map(EMERGENCY_VISITS.map((v) => [v.id, v]));
    for (const d of dispositions) {
      const v = byId.get(d.visitId as string)!;
      expect(v.hasDisposition, '이미 처분이 있는 방문에 덮어쓴다').toBe(false);
      expect(v.status, '진행 중인 방문에 처분을 박았다').toBe('COMPLETED');
      expect((d.decidedAt as Date).getTime(), '처분이 내원보다 이르다').toBeGreaterThan(v.arrivalAt.getTime());
    }
    // 방문 1건당 처분 1건(visitId @unique)
    const ids = dispositions.map((d) => d.visitId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('중증(KTAS 1-2)이 귀가로 몰리지 않는다', () => {
    const byId = new Map(EMERGENCY_VISITS.map((v) => [v.id, v]));
    const severe = dispositions.filter((d) => {
      const lv = byId.get(d.visitId as string)!.triageLevel;
      return lv === 'LEVEL_1' || lv === 'LEVEL_2';
    });
    expect(severe.length).toBeGreaterThan(0);
    expect(severe.every((d) => d.disposition !== 'DISCHARGE'), 'KTAS 1-2 에 귀가 처분이 있다').toBe(true);
  });

  it('재평가는 등급이 실제로 바뀐 것만 기록한다', () => {
    expect(reassessments.length).toBeGreaterThan(0);
    for (const r of reassessments) {
      expect(r.previousLevel).not.toBe(r.newLevel);
      expect(String(r.previousLevel)).toMatch(/^LEVEL_[1-5]$/);
      expect(String(r.newLevel)).toMatch(/^LEVEL_[1-5]$/);
    }
    // 방문당 1건까지 — 같은 방문에 같은 id 가 두 번 나오면 재실행 때 덮어쓴다
    const ids = reassessments.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('수술 — 같은 사실이 여러 테이블에서 갈라지지 않는다', () => {
  it('🔴 마취 종류가 4곳에서 같다 + 정본 코드다', () => {
    for (const x of surgeries) {
      const t = x.surgery.anesthesiaType as string;
      expect(isCanonicalAnesthesiaCode(t), `정본 코드가 아닌 마취 종류: ${t}`).toBe(true);
      expect(x.opNote.anesthesiaType, '수술기록의 마취 종류가 다르다').toBe(t);
      expect(x.anesthesia.anesthesiaType, '마취기록의 마취 종류가 다르다').toBe(t);
      expect(x.preAnesthesia.plan, '마취전평가 계획이 마취 종류와 다르다').toBe(ANESTHESIA_TO_PLAN[t as keyof typeof ANESTHESIA_TO_PLAN]);
    }
  });

  it('🔴 실혈량이 3곳에서 같다', () => {
    for (const x of surgeries) {
      expect(x.opNote.estimatedBloodLoss, '수술기록 실혈량이 다르다').toBe(x.surgery.ebl);
      expect(x.anesthesia.ebl, '마취기록 실혈량이 다르다').toBe(x.surgery.ebl);
    }
  });

  it('🔴 ASA 등급이 2곳에서 같다', () => {
    for (const x of surgeries) {
      expect(String(x.opNote.asaClass), 'ASA 등급이 마취전평가와 다르다').toBe(String(x.preAnesthesia.asaClass));
    }
  });

  it('WHO 체크리스트 3단계가 수술 시각 안에서 순서대로 난다', () => {
    for (const x of surgeries) {
      const incision = (x.surgery.incisionTime as Date).getTime();
      const closure = (x.surgery.closureTime as Date).getTime();
      const ended = (x.surgery.endedAt as Date).getTime();
      // 🔴 Sign-in 미완료는 **정상 상태**다(필수 항목이 덜 찼으면 완료 스탬프가 없다).
      //    그 경우 시각 검사가 아니라 "왜 미완료인지"가 근거로 남아 있어야 한다.
      if (x.checklist.signInCompletedAt == null) {
        expect(x.checklist.signInSiteMarked, 'Sign-in 미완료인데 필수 항목이 전부 차 있다').toBe(false);
        expect(x.checklist.signInCompletedBy ?? null, '완료 시각이 없는데 확인자가 있다').toBeNull();
      } else {
        expect((x.checklist.signInCompletedAt as Date).getTime(), 'Sign-in 이 절개 뒤다').toBeLessThan(incision);
        expect(x.checklist.signInSiteMarked, '완료인데 필수 항목이 비어 있다').toBe(true);
      }
      expect((x.checklist.timeOutCompletedAt as Date).getTime(), 'Time-out 이 절개 뒤다').toBeLessThan(incision);
      const signOut = (x.checklist.signOutCompletedAt as Date).getTime();
      expect(signOut, 'Sign-out 이 봉합 전이다').toBeGreaterThan(closure);
      expect(signOut, 'Sign-out 이 퇴실 뒤다').toBeLessThanOrEqual(ended);
    }
  });

  it('🔴 미완료 Sign-in 표본이 실제로 존재한다 — 없으면 미이행 탐지가 표본 없이 돈다', () => {
    const incomplete = surgeries.filter((x) => x.checklist.signInCompletedAt == null);
    expect(incomplete.length, 'Sign-in 미완료 표본이 0건이면 위 분기가 한 번도 실행되지 않는다').toBeGreaterThan(0);
    expect(incomplete.length, '미완료가 과반이면 시연 데이터가 아니라 결함이다').toBeLessThan(surgeries.length / 2);
  });

  it('🔴 수술 계수는 품목 기록과 함께 저장된다 — status 만 박으면 잔류이물 게이트가 셀 것이 없다', () => {
    for (const x of surgeries) {
      const items = x.checklist.countItems as Array<{ initial: number; final: number; status: string }> | null;
      expect(Array.isArray(items) && items.length > 0, '계수 품목이 비어 있는데 countStatus 가 있다').toBe(true);
      const numericMismatch = (items ?? []).some((r) => r.initial !== r.final);
      if (numericMismatch) {
        expect(x.checklist.countStatus, '숫자가 어긋나는데 MISMATCH 가 아니다').toBe('MISMATCH');
        expect(x.checklist.countDiscrepancyNote ?? null, 'MISMATCH 인데 해소 기록이 없다').not.toBeNull();
      }
    }
    const mismatched = surgeries.filter((x) => x.checklist.countStatus === 'MISMATCH');
    expect(mismatched.length, '계수 불일치 표본이 0건이면 잔류이물 게이트가 시연되지 않는다').toBeGreaterThan(0);
  });

  it('기도 확보는 마취 종류를 따른다 (국소마취에 기관삽관이 붙지 않는다)', () => {
    for (const x of surgeries) {
      if (x.surgery.anesthesiaType === 'GENERAL') {
        expect(x.anesthesia.airwayType).toBe('ETT');
        expect(x.anesthesia.intubationTime, '전신마취인데 삽관 시각이 없다').toBeInstanceOf(Date);
        expect(x.anesthesia.extubationTime).toBeInstanceOf(Date);
      } else {
        expect(x.anesthesia.intubationTime ?? null, `${x.surgery.anesthesiaType} 인데 기관삽관 시각이 있다`).toBeNull();
        expect(x.anesthesia.extubationTime ?? null).toBeNull();
      }
    }
    expect(surgeries.some((x) => x.surgery.anesthesiaType === 'GENERAL')).toBe(true);
    expect(surgeries.some((x) => x.surgery.anesthesiaType !== 'GENERAL')).toBe(true);
  });

  it('마취전평가는 수술 전에 끝난다 · NPO 는 평가 뒤 자정부터', () => {
    for (const x of surgeries) {
      expect((x.preAnesthesia.completedAt as Date).getTime(), '마취전평가가 수술 뒤에 끝났다')
        .toBeLessThan((x.surgery.scheduledAt as Date).getTime());
      expect((x.preAnesthesia.npoSince as Date).getTime(), 'NPO 시작이 수술 뒤다')
        .toBeLessThan((x.surgery.scheduledAt as Date).getTime());
    }
  });

  it('합병증이 없으면 합병증 등급도 없다 (없는 사실에 등급을 붙이지 않는다)', () => {
    for (const x of surgeries) {
      if (!x.opNote.complications) expect(x.opNote.complicationGrade ?? null).toBeNull();
    }
  });
});

describe('환자안전·감염 — 어휘와 파생값', () => {
  it('🔴 심각도가 정본 어휘다 (`LOW` 처럼 화면이 못 접는 값을 쓰지 않는다)', () => {
    const canon = new Set<string>(INCIDENT_SEVERITIES as readonly string[]);
    for (const x of incidents) {
      const s = x.incident.severity as string;
      expect(canon.has(s), `정본 밖 심각도: ${s}`).toBe(true);
      // 왕복이 같아야 화면 차트의 막대에 정확히 한 번 들어간다
      expect(normalizeIncidentSeverity(s), `정본 접기 왕복 불일치: ${s}`).toBe(s);
      expect(s, '미분류를 시드가 만들면 안 된다(모르는 것을 기록하는 것과 다르다)').not.toBe('UNSPECIFIED');
    }
  });

  it('🔴 rcaCompleted 는 RCA 보고서 상태에서 파생된다', () => {
    for (const x of incidents) {
      const done = !!x.rca && (x.rca.status === 'COMPLETED' || x.rca.status === 'APPROVED');
      expect(x.incident.rcaCompleted, `RCA 완료 표시와 보고서 상태가 어긋난다 (${x.rca?.status ?? '보고서 없음'})`).toBe(done);
      if (!x.rca) expect(x.incident.rcaCompleted).toBe(false);
    }
    expect(incidents.some((x) => x.rca), 'RCA 표본이 0건 — 위 단언이 헛돈다').toBe(true);
  });

  it('승인되지 않은 RCA 에 승인자·승인시각이 없다', () => {
    for (const x of incidents) {
      if (!x.rca) continue;
      if (x.rca.status === 'APPROVED') {
        expect(x.rca.approvedBy, '승인인데 승인자가 없다').toBeTruthy();
        expect(x.rca.approvedAt).toBeInstanceOf(Date);
      } else {
        expect(x.rca.approvedBy ?? null, '미승인인데 승인자가 있다').toBeNull();
        expect(x.rca.approvedAt ?? null, '미승인인데 승인 시각이 있다').toBeNull();
      }
      // 진행 중이면 결론(findings)이 없다 — 결론을 흉내내지 않는다
      if (x.rca.status === 'IN_PROGRESS') expect(x.rca.findings ?? null).toBeNull();
    }
  });

  it('🔴 HAI 기구일수는 삽입일~발생일에서 파생된다 · 유형과 기구가 짝이다', () => {
    const specByType = new Map(HAI_SPECS.map((s) => [s.haiType, s]));
    for (const c of haiCases) {
      const spec = specByType.get(c.haiType as string)!;
      expect(c.deviceType ?? null, `${c.haiType} 의 기구가 정의와 다르다`).toBe(spec.deviceType);
      expect(spec.organisms.includes(c.organism as string), `${c.haiType} 에 맞지 않는 균: ${c.organism}`).toBe(true);
      if (spec.deviceType) {
        const days = Math.round(((c.onsetAt as Date).getTime() - (c.deviceInsertedAt as Date).getTime()) / 86_400_000);
        expect(c.deviceDays, `기구일수가 날짜에서 나오지 않았다 (저장 ${c.deviceDays} · 산출 ${days})`).toBe(days);
        // 기구 관련 감염은 정의상 유치 2일 초과
        expect(c.deviceDays as number).toBeGreaterThan(2);
      } else {
        expect(c.deviceDays ?? null).toBeNull();
        expect(c.deviceInsertedAt ?? null).toBeNull();
      }
      expect(c.reportedToKonis, 'KONIS 보고를 흉내냈다 — 전송한 적이 없다').toBe(false);
    }
  });

  it('🔴 MDRO active 와 해제일은 같은 사실의 두 표현이다 · 균종과 내성유형이 짝이다', () => {
    const specByType = new Map(MDRO_SPECS.map((s) => [s.mdroType, s]));
    for (const m of mdro) {
      expect(m.active, `active=${m.active} 인데 clearedAt=${m.clearedAt} — 만료 혈소판이 AVAILABLE 이던 결함과 같은 형태`)
        .toBe(!m.clearedAt);
      const spec = specByType.get(m.mdroType as string)!;
      expect(m.organism, `${m.mdroType} 에 맞지 않는 균: ${m.organism}`).toBe(spec.organism);
      if (m.clearedAt) {
        expect((m.clearedAt as Date).getTime(), '해제일이 검출일보다 이르다').toBeGreaterThan((m.detectedAt as Date).getTime());
      }
    }
    expect(mdro.some((m) => m.active), '활성 균 표본 0').toBe(true);
    expect(mdro.some((m) => !m.active), '해제 균 표본 0').toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 입원 축 — 간호기록(nursing_notes) · 투약 실시(MAR) · 퇴원 완료 입원 이력
// ═══════════════════════════════════════════════════════════════════════

/** 재원 중 2건 + 퇴원 2건 — 기존 운영 데이터의 형태(오래 전 입원 후 계속 재원)를 본떴다 */
const INPATIENT_ADMISSIONS: CvInpatientAdmissionRef[] = [
  { id: uid(8000), patientId: PATIENTS[0].id, admitDate: new Date(NOW.getTime() - 70 * 86_400_000), dischargeDate: null, attendingDoctorId: DOCTORS[0] },
  { id: uid(8001), patientId: PATIENTS[1].id, admitDate: new Date(NOW.getTime() - 39 * 86_400_000), dischargeDate: null, attendingDoctorId: DOCTORS[1] },
  { id: uid(8002), patientId: PATIENTS[2].id, admitDate: new Date(NOW.getTime() - 30 * 86_400_000), dischargeDate: new Date(NOW.getTime() - 24 * 86_400_000), attendingDoctorId: DOCTORS[2] },
  { id: uid(8003), patientId: PATIENTS[3].id, admitDate: new Date(NOW.getTime() - 12 * 86_400_000), dischargeDate: new Date(NOW.getTime() - 9 * 86_400_000), attendingDoctorId: DOCTORS[3] },
];

const med = (over: Partial<CvMedRef> & { ingredient: string; nameKo: string; id: string }): CvMedRef => ({
  code: 'X', narcoticType: null, controlSchedule: null, highAlertFlag: false, aspRestrictedLevel: null, ...over,
});

/**
 * 🔴 약품 마스터에 **안전 필터가 걸러야 할 것**을 일부러 섞는다.
 *    운영 실측: `acetaminophen+hydrocodone`(마약 복합제)이 `narcotic_type IS NULL` 로 등재돼
 *    플래그 필터를 그대로 통과했다. 필터가 실제로 막는지는 이렇게만 확인된다.
 */
const POISONED_MEDS: CvMedRef[] = [
  med({ id: uid(8500), ingredient: 'acetaminophen   0.325g, hydrocodone bitartrate   5mg', nameKo: '하이코돈정5.0밀리그램' }),
  med({ id: uid(8501), ingredient: 'acetaminophen   0.325g, tramadol hydrochloride   37.5mg', nameKo: '건트라셋세미서방정' }),
  med({ id: uid(8502), ingredient: 'Acetaminophen', nameKo: '[함정] tramadol 복합제로 표기된 품목' }),
  med({ id: uid(8503), ingredient: 'Ceftriaxone', nameKo: '고위험 표시된 세프트리악손', highAlertFlag: true }),
  med({ id: uid(8504), ingredient: 'Famotidine', nameKo: '마약류로 등재된 파모티딘', narcoticType: 'NARCOTIC' }),
  med({ id: uid(8505), ingredient: 'Levofloxacin', nameKo: 'ASP 제한 등재 레보플록사신', aspRestrictedLevel: 'RESTRICTED' }),
];

const CLEAN_MEDS: CvMedRef[] = MAR_ALLOWED_INGREDIENTS.map((ing, i) =>
  med({ id: uid(8600 + i), ingredient: ing, nameKo: `[시연] ${ing} 정` }),
);

const inpatientCtx: InpatientSeedContext = {
  ...BASE,
  admissions: INPATIENT_ADMISSIONS,
  unadmittedPatients: PATIENTS.slice(20),
  beds: Array.from({ length: 20 }, (_, i) => uid(8700 + i)),
  meds: [...CLEAN_MEDS, ...POISONED_MEDS],
};

const newAdmissions = buildDischargedAdmissions(inpatientCtx);
const admissionNotes = buildAdmissionNursingNotes(INPATIENT_ADMISSIONS, BASE);
const medRows = buildInpatientMedications(inpatientCtx);
const allMar = medRows.flatMap((m) => m.admins);

describe('입원 축 — 표본', () => {
  it('생성기가 실제로 행을 만든다', () => {
    expect(newAdmissions.length, '신규 퇴원 입원 0건').toBeGreaterThan(0);
    expect(admissionNotes.length, '입원 간호기록 0건').toBeGreaterThan(0);
    expect(medRows.length, '입원 처방 0건').toBeGreaterThan(0);
    expect(allMar.length, 'MAR 0건').toBeGreaterThan(0);
    // 상태별 표본 — 한쪽이 0건이면 그 가지의 단언은 헛돈다
    expect(allMar.some((a) => a.status === 'ADMINISTERED'), '실시 표본 0').toBe(true);
    expect(allMar.some((a) => a.status !== 'ADMINISTERED'), '미실시 표본 0').toBe(true);
    expect(admissionNotes.some((n) => n.noteType === 'SOAP')).toBe(true);
    expect(admissionNotes.some((n) => n.noteType === 'DAR')).toBe(true);
    expect(admissionNotes.some((n) => n.noteType === 'NARRATIVE')).toBe(true);
  });

  it('미래 시각이 없다 · 시각 순서가 뒤집히지 않는다', () => {
    const bad = [
      ...checkNoFuture(newAdmissions, NOW, 'admission'),
      ...checkNoFuture(admissionNotes, NOW, 'nursingNote'),
      // 🔴 MAR 의 `scheduledAt` 은 **예정**이라 미래가 정상이다. `administeredAt` 만 사실이어야 한다.
      ...checkNoFuture(allMar.map(({ scheduledAt: _s, ...rest }) => rest), NOW, 'mar'),
      ...checkTimeOrder(newAdmissions, ADMISSION_TIME_RULES, 'admission'),
      ...checkTimeOrder(admissionNotes, NURSING_NOTE_TIME_RULES, 'nursingNote'),
      ...checkTimeOrder(allMar, MAR_TIME_RULES, 'mar'),
    ];
    expect(bad, `위반 ${bad.length}건`).toEqual([]);
  });

  it('id 가 이 축 네임스페이스이고 서로 겹치지 않는다', () => {
    const ids = [
      ...newAdmissions.map((a) => a.id),
      ...admissionNotes.map((n) => n.id),
      ...medRows.map((m) => m.encounter.id),
      ...medRows.map((m) => m.prescription.id),
      ...medRows.map((m) => m.order.id),
      ...allMar.map((a) => a.id),
    ];
    for (const id of ids) expect(id.startsWith(CV_UUID_PREFIX), `${id} 네임스페이스 밖`).toBe(true);
    // 진료(Encounter)는 입원 1건당 1개라 처방 수만큼 중복 등장한다 — 그건 정상이다
    const dedupExpected = ids.length - (medRows.length - new Set(medRows.map((m) => m.encounter.id)).size);
    expect(new Set(ids).size, 'id 충돌 — 재실행 때 다른 행을 덮어쓴다').toBe(dedupExpected);
  });
});

describe('입원 이력 — 병상·환자 충돌을 만들지 않는다', () => {
  it('🔴 전부 퇴원 완료다 (재원 중을 만들면 병상 점유와 어긋난다)', () => {
    for (const a of newAdmissions) {
      expect(a.status, 'ADMITTED 를 만들면 beds.status 와 어긋난다').toBe('DISCHARGED');
      expect(a.dischargeDate, '퇴원 완료인데 퇴원일이 없다').toBeInstanceOf(Date);
      expect(a.dischargeSummary, '퇴원인데 퇴원요약이 없다').toBeTruthy();
    }
  });

  it('🔴 이미 입원 이력이 있는 환자를 다시 입원시키지 않는다 · 한 환자에 두 건을 만들지 않는다', () => {
    const existingPatients = new Set(INPATIENT_ADMISSIONS.map((a) => a.patientId));
    const used = new Set<string>();
    for (const a of newAdmissions) {
      expect(existingPatients.has(a.patientId as string), '기존 입원 환자에 입원을 또 만들었다').toBe(false);
      expect(used.has(a.patientId as string), '같은 환자에 입원 2건').toBe(false);
      used.add(a.patientId as string);
    }
  });

  it('🔴 같은 병상에 재원 기간이 겹치지 않는다', () => {
    const byBed = new Map<string, [number, number][]>();
    for (const a of newAdmissions) {
      const bed = a.bedId as string;
      const win: [number, number] = [(a.admitDate as Date).getTime(), (a.dischargeDate as Date).getTime()];
      const list = byBed.get(bed) ?? [];
      for (const [s, e] of list) {
        expect(win[0] > e || win[1] < s, `병상 ${bed} 에 재원 기간이 겹치는 입원 2건`).toBe(true);
      }
      list.push(win);
      byBed.set(bed, list);
    }
  });

  it('입원일이 최근 6주 안이다 (입원 축의 정지 상태를 실제로 푼다)', () => {
    for (const a of newAdmissions) {
      const daysAgo = (NOW.getTime() - (a.admitDate as Date).getTime()) / 86_400_000;
      expect(daysAgo, `입원일이 ${Math.round(daysAgo)}일 전 — 최근 구간을 벗어난다`).toBeLessThanOrEqual(45);
    }
    const latest = Math.max(...newAdmissions.map((a) => (a.admitDate as Date).getTime()));
    expect((NOW.getTime() - latest) / 86_400_000, '가장 최근 입원조차 28일 예산 밖이다').toBeLessThanOrEqual(28);
  });
});

describe('입원 간호기록 — 형식과 서명', () => {
  it('🔴 shiftType 은 정본 `shiftOf(recordedAt)` 와 같다', () => {
    const bad = admissionNotes
      .filter((n) => n.shiftType !== shiftOf(n.recordedAt as Date))
      .map((n) => `${(n.recordedAt as Date).toISOString()} → ${n.shiftType}`);
    expect(bad, `근무 판정 불일치 ${bad.length}건`).toEqual([]);
  });

  it('🔴 기록 → 작성 → 서명 순서다 (운영 데이터의 `signed_at < created_at` 187건을 다시 만들지 않는다)', () => {
    for (const n of admissionNotes) {
      const rec = (n.recordedAt as Date).getTime();
      const cre = (n.createdAt as Date).getTime();
      const sig = (n.signedAt as Date).getTime();
      expect(cre, '작성이 관찰보다 이르다').toBeGreaterThanOrEqual(rec);
      expect(sig, '서명이 작성보다 이르다').toBeGreaterThanOrEqual(cre);
      expect(n.status).toBe('SIGNED');
      expect(n.signedBy, '서명 완료인데 서명자가 없다').toBe(n.nurseId);
    }
  });

  it('🔴 기록 형식과 채운 칸이 한 벌이다 (SOAP 노트에 DAR 칸을 채우지 않는다)', () => {
    const SOAP = ['subjective', 'objective', 'assessment', 'plan'];
    const DAR = ['focus', 'data', 'action', 'response'];
    for (const n of admissionNotes) {
      const row = n as Record<string, unknown>;
      if (n.noteType === 'SOAP') {
        for (const k of SOAP) expect(row[k], `SOAP 인데 ${k} 가 비었다`).toBeTruthy();
        for (const k of [...DAR, 'content']) expect(row[k] ?? null, `SOAP 인데 ${k} 를 채웠다`).toBeNull();
      } else if (n.noteType === 'DAR') {
        for (const k of DAR) expect(row[k], `DAR 인데 ${k} 가 비었다`).toBeTruthy();
        for (const k of [...SOAP, 'content']) expect(row[k] ?? null, `DAR 인데 ${k} 를 채웠다`).toBeNull();
      } else {
        expect(row.content, 'NARRATIVE 인데 본문이 없다').toBeTruthy();
        for (const k of [...SOAP, ...DAR]) expect(row[k] ?? null, `NARRATIVE 인데 ${k} 를 채웠다`).toBeNull();
      }
    }
  });

  it('기록이 입원 기간 안에서만 난다 · 재원 중인 입원은 최근 48시간 안에 기록이 있다', () => {
    const byId = new Map(INPATIENT_ADMISSIONS.map((a) => [a.id, a]));
    for (const n of admissionNotes) {
      const adm = byId.get(n.admissionId as string)!;
      const at = (n.recordedAt as Date).getTime();
      expect(at).toBeGreaterThanOrEqual(adm.admitDate.getTime());
      expect(at).toBeLessThanOrEqual(adm.dischargeDate ? adm.dischargeDate.getTime() : NOW.getTime());
    }
    // 🔴 이것이 `admitted.no_nursing_note_48h` 프로브가 보는 조건이다
    for (const adm of INPATIENT_ADMISSIONS.filter((a) => !a.dischargeDate)) {
      const recent = admissionNotes.filter(
        (n) => n.admissionId === adm.id && NOW.getTime() - (n.recordedAt as Date).getTime() <= 48 * 3_600_000,
      );
      expect(recent.length, `재원 중 ${adm.id} 에 최근 48시간 간호기록이 없다`).toBeGreaterThan(0);
    }
  });
});

describe('투약 실시(MAR) — 처방과 이어지고, 법정 약물은 만들지 않는다', () => {
  it('🔴 마약류·향정·고위험·ASP 제한 약물은 안전 필터가 막는다 (플래그만 믿지 않는다)', () => {
    for (const m of POISONED_MEDS) {
      expect(isMarSafeMedication(m), `안전 필터가 못 막았다: ${m.nameKo} (${m.ingredient})`).toBe(false);
    }
    for (const m of CLEAN_MEDS) {
      expect(isMarSafeMedication(m), `안전한 약품을 막았다: ${m.ingredient}`).toBe(true);
    }
    // 생성물에도 실제로 섞이지 않았는가
    const poisonedIds = new Set(POISONED_MEDS.map((m) => m.id));
    for (const m of medRows) {
      expect(poisonedIds.has(m.prescription.medicationCodeId as string), '제외 대상 약품으로 처방을 만들었다').toBe(false);
    }
    expect(MAR_DENY_SUBSTRINGS.length, '금지어 목록이 비었다').toBeGreaterThan(10);
  });

  it('🔴 실시는 처방 사슬 위에 있다 (진료 → 처방 → 약제 오더 → 실시)', () => {
    for (const m of medRows) {
      expect(m.prescription.encounterId, '처방이 진료에 매달려 있지 않다').toBe(m.encounter.id);
      expect(m.order.prescriptionId, '오더가 처방에 매달려 있지 않다').toBe(m.prescription.id);
      expect(m.encounter.admissionId, '입원 진료인데 입원 연결이 없다').toBeTruthy();
      expect(m.prescription.type).toBe('MEDICATION');
      expect(m.order.department).toBe('PHARMACY');
      for (const a of m.admins) {
        expect(a.prescriptionId, '실시가 다른 처방을 가리킨다').toBe(m.prescription.id);
        expect(a.orderId).toBe(m.order.id);
      }
    }
  });

  it('🔴 실시 건수 = 1일 투여 횟수 × 투여일수 · 처방 총량도 같은 식에서 나온다', () => {
    for (const m of medRows) {
      const expected = m.dosesPerDay * m.therapyDays;
      expect(m.admins.length, `${m.prescription.dosage}: 실시 ${m.admins.length} ≠ ${m.dosesPerDay}회×${m.therapyDays}일`).toBe(expected);
      expect(m.prescription.quantity, '처방 총량이 빈도×일수에서 나오지 않았다').toBe(expected);
      expect(m.prescription.duration).toBe(m.therapyDays);
    }
  });

  it('🔴 용량·경로가 처방과 실시에서 같다 (같은 사실이 두 곳에서 갈라지지 않는다)', () => {
    for (const m of medRows) {
      for (const a of m.admins) {
        expect(a.dose, '실시 용량이 처방과 다르다').toBe(m.prescription.dosage);
        expect(a.route, '실시 경로가 처방과 다르다').toBe(m.prescription.route);
      }
    }
  });

  it('🔴 실시하지 않은 것에 실시 시각을 적지 않는다 (예정은 계획이지 사실이 아니다)', () => {
    for (const a of allMar) {
      if (a.status === 'ADMINISTERED') {
        expect(a.administeredAt, '실시인데 실시 시각이 없다').toBeInstanceOf(Date);
        expect(a.nurseId, '실시인데 투약자가 없다').toBeTruthy();
        expect(a.holdReason ?? null, '실시인데 보류 사유가 있다').toBeNull();
      } else {
        expect(a.administeredAt ?? null, `${a.status} 인데 실시 시각이 있다`).toBeNull();
        if (a.status === 'SCHEDULED') {
          expect((a.scheduledAt as Date).getTime(), '예정 상태인데 예정 시각이 과거다').toBeGreaterThan(NOW.getTime());
          expect(a.nurseId ?? null, '아직 예정인데 투약자가 정해져 있다').toBeNull();
        } else {
          expect(a.holdReason, `${a.status} 인데 사유가 없다`).toBeTruthy();
        }
      }
    }
  });

  it('실시가 입원 기간 안에서 난다', () => {
    const byId = new Map(INPATIENT_ADMISSIONS.map((a) => [a.patientId, a]));
    for (const a of allMar) {
      const adm = byId.get(a.patientId as string)!;
      expect((a.scheduledAt as Date).getTime(), '입원 전 투약').toBeGreaterThanOrEqual(adm.admitDate.getTime());
    }
  });
});

describe('🔴 이미 운영 DB 에 들어간 행의 id 가 흔들리지 않는다', () => {
  /**
   * flow sheet·회진·인수인계 id 는 **입원 목록 순번**에서 나온다. 입원이 하나만 늘어도
   * 순번이 밀려 이미 들어간 987행이 재실행 때 다른 id 로 통째로 다시 들어간다(중복).
   * 그래서 런너가 inpatient 축의 입원을 제외하도록 했고, 여기서 그 id 생성 규칙을 동결한다.
   */
  it('nursing 축의 id 규칙이 그대로다 (첫·마지막 id 동결)', () => {
    expect(flowsheets[0].id).toBe(cvUuid(CV_TAGS.flowSheetEntry, 0));
    expect(flowsheets[flowsheets.length - 1].id).toBe(cvUuid(CV_TAGS.flowSheetEntry, flowsheets.length - 1));
    expect(rounds[0].id).toBe(cvUuid(CV_TAGS.round, 0));
    expect(handoffs[0].id).toBe(cvUuid(CV_TAGS.clinicalHandoff, 0));
  });

  it('🔴 nursing 런너가 inpatient 축이 만든 입원을 제외한다 (제외가 빠지면 순번이 밀린다)', () => {
    const src = readFileSync(join(process.cwd(), 'prisma/seeds/clinical-volume-nursing.ts'), 'utf-8');
    expect(src, 'inpatient 축 입원 제외 필터가 사라졌다 — 기존 987행이 재실행 때 중복된다')
      .toContain('admissionRows.filter((a) => !a.id.startsWith(CV_UUID_PREFIX))');
  });

  it('inpatient 축의 id 는 자연키 파생이라 목록 순서에 흔들리지 않는다', () => {
    // 입원 목록을 뒤집어도 같은 id 가 나와야 한다
    const reversed = buildAdmissionNursingNotes([...INPATIENT_ADMISSIONS].reverse(), BASE);
    expect(new Set(reversed.map((n) => n.id))).toEqual(new Set(admissionNotes.map((n) => n.id)));
    const ctx2: InpatientSeedContext = { ...inpatientCtx, admissions: [...INPATIENT_ADMISSIONS].reverse() };
    const med2 = buildInpatientMedications(ctx2);
    expect(new Set(med2.flatMap((m) => m.admins.map((a) => a.id)))).toEqual(new Set(allMar.map((a) => a.id)));
  });
});
