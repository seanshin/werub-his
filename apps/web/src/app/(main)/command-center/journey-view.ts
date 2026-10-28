/**
 * 상황판 하단 '환자 여정' 표시 규칙 — 순수 로직.
 *
 * 여정 콘솔은 환자 한 줄씩(194건)을 준다. 상황판에서 필요한 것은 목록이 아니라
 *  ① **지금 어느 단계에 몇 명이 있는가**(흐름의 병목)
 *  ② **어디서 막혀 있는가**(지연 플래그가 붙은 환자)
 * 두 가지다 — 나머지는 여정 콘솔로 넘긴다(상황판은 진입점이지 작업 화면이 아니다).
 */

import {
  journeyFlagLabel,
  journeyFlagTone,
  OPD_JOURNEY_STAGES,
  IPD_JOURNEY_STAGES,
  ER_JOURNEY_STAGES,
} from '@hospital-run/shared';

export interface JourneyRow {
  patientId: string;
  name: string;
  mrn: string;
  track: string;
  stage: string;
  dept?: string | null;
  room?: string | null;
  ward?: string | null;
  bed?: string | null;
  doctorName?: string | null;
  stayMin?: number;
  stayDays?: number;
  unpaid?: number;
  flags?: string[];
}

export interface StageCount {
  stage: string;
  label: string;
  count: number;
  /** 이 단계에서 지연이 걸린 인원 */
  delayed: number;
}

export interface DelayedPatient {
  patientId: string;
  name: string;
  mrn: string;
  stageLabel: string;
  /** 진료과(마스터 영문명이 있는 축 — 화면이 `<DeptName>` 으로 그린다) */
  dept: string;
  /** 장소(병동·호실 — 마스터 영문명 미확인이라 원문 그대로) */
  place: string;
  /** 체류 시간 표기(외래=분, 입원=일) */
  stay: string;
  flagLabels: string[];
  tone: 'warn' | 'danger';
}

/**
 * 🔴 단계표는 **shared 정본 하나**(`journey-stages.ts`). 여기에 다시 적었다가 갈라졌다(2026-08-26):
 *   - **유령 단계 4종** — `WAITING`·`POST_CONSULT`·`EXAM`·`PHARMACY` 는 서버가 낸 적이 없는데
 *     화면이 **영구 `0`** 으로 그렸다. 🔴 **추적하지 않는 것과 아무도 없는 것은 다른 사실이다.**
 *   - **키 오타 2종** — `ADMIT`/`DISCHARGE_PLAN` 인데 서버는 `ADMITTED`/`DISCHARGE_PLANNED` 였다.
 */
const OPD_STAGES = OPD_JOURNEY_STAGES;
const IPD_STAGES = IPD_JOURNEY_STAGES;
const ER_STAGES = ER_JOURNEY_STAGES;

/**
 * 🔴 지연 플래그 라벨·색은 **shared 정본 하나**(`journey-flags.ts`).
 *    여기에 다시 적었다가 갈라졌다 — 이 파일에는 `WAIT_DELAY` 가 없어서
 *    운영 지연 198명 중 **194명이 영문 enum 으로 찍히고** 있었고,
 *    반대로 서버가 낸 적 없는 `EXAM_DELAY`·`PHARMACY_DELAY` 를 갖고 있었다(2026-08-26).
 */
export const flagLabel = journeyFlagLabel;

/** 단계 분포 — 정의된 순서로, 인원 0인 단계도 남긴다(흐름의 빈 구간이 보여야 병목이 읽힌다) */
export function stageFlow(rows: JourneyRow[], track: 'OPD' | 'IPD' | 'ER'): StageCount[] {
  const defs = track === 'OPD' ? OPD_STAGES : track === 'ER' ? ER_STAGES : IPD_STAGES;
  const known = new Set(defs.map((d) => d.key));
  const counts = new Map<string, { n: number; delayed: number }>();
  for (const r of rows) {
    const cur = counts.get(r.stage) ?? { n: 0, delayed: 0 };
    cur.n += 1;
    if ((r.flags ?? []).length > 0) cur.delayed += 1;
    counts.set(r.stage, cur);
  }
  const out = defs.map((d) => ({
    stage: d.key,
    label: d.label,
    count: counts.get(d.key)?.n ?? 0,
    delayed: counts.get(d.key)?.delayed ?? 0,
  }));
  // 정의에 없는 단계가 오면 뒤에 붙인다(서버가 단계를 늘려도 인원이 사라지지 않게)
  for (const [stage, v] of counts) {
    if (!known.has(stage)) out.push({ stage, label: stage, count: v.n, delayed: v.delayed });
  }
  return out;
}

const fmtStayMin = (min?: number) => {
  if (min === undefined || min === null) return '';
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}시간` : `${Math.floor(h / 24)}일`;
};

/**
 * 지연 환자 전체 인원 — 🔴 **목록은 잘리므로 분모를 따로 낸다.**
 * 종전엔 잘린 12건을 그대로 "지연 환자 12명"이라 적어, 198명이 12명으로 보였다(2026-08-26).
 */
export function delayedCount(opd: JourneyRow[], ipd: JourneyRow[]): number {
  return [...opd, ...ipd].filter((r) => (r.flags ?? []).length > 0).length;
}

/** 지연 환자 — 플래그가 붙은 사람만, 위험 먼저·오래 기다린 순. 🔴 잘린다(총계는 `delayedCount`) */
export function delayedPatients(opd: JourneyRow[], ipd: JourneyRow[], limit = 24): DelayedPatient[] {
  const stageLabel = (track: string, stage: string) =>
    (track === 'IPD' ? IPD_STAGES : track === 'ER' ? ER_STAGES : OPD_STAGES).find((s) => s.key === stage)?.label ?? stage;

  const rows = [...opd, ...ipd].filter((r) => (r.flags ?? []).length > 0);
  const mapped = rows.map((r) => {
    const flags = r.flags ?? [];
    const tone: 'warn' | 'danger' = journeyFlagTone(flags);
    return {
      patientId: r.patientId,
      name: r.name,
      mrn: r.mrn,
      stageLabel: stageLabel(r.track, r.stage),
      /**
       * 🔴 진료과와 장소를 **합쳐서 넘기지 않는다**(2026-09-10). 합친 문자열(`내과 · 3층 301`)은
       *    번역할 수 없어서, 화면 언어를 English 로 둬도 진료과가 한국어로 남았다.
       *    진료과는 코드 마스터에 영문명이 있으므로(36/36) 화면이 그 값을 쓰려면 조각이 필요하다.
       *    장소(병동·호실)는 마스터 영문명이 확인되지 않아 원문 그대로 둔다 — 지어내지 않는다.
       */
      dept: r.dept ?? '',
      place: r.room ?? (r.ward && r.bed ? `${r.ward} ${r.bed}` : (r.ward ?? '')),
      stay: r.stayDays !== undefined ? `${r.stayDays}일` : fmtStayMin(r.stayMin),
      flagLabels: flags.map(flagLabel),
      tone,
      _sort: r.stayDays !== undefined ? r.stayDays * 1440 : r.stayMin ?? 0,
    };
  });

  return mapped
    .sort((a, b) => (a.tone === b.tone ? b._sort - a._sort : a.tone === 'danger' ? -1 : 1))
    .slice(0, limit)
    .map(({ _sort, ...rest }) => rest);
}
