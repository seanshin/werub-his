/**
 * 환자 여정 **단계** 정본 — 서버가 내는 값 그대로.
 *
 * 🔴 발단(2026-08-26): 상황판(`/command-center`)이 서버와 다른 단계표를 갖고 있었다.
 *   - **유령 단계 4종** — `WAITING`·`POST_CONSULT`·`EXAM`·`PHARMACY` 는 서버가 낸 적이 없다.
 *     화면은 그것들을 **영구 `0`** 으로 그렸고, 관제자는 "검사 대기 없음"으로 읽었다.
 *     🔴 **추적하지 않는 것과 아무도 없는 것은 다른 사실이다.**
 *   - **키 오타 2종** — `ADMIT`/`DISCHARGE_PLAN` 인데 서버는 `ADMITTED`/`DISCHARGE_PLANNED`.
 *     그 단계에 사람이 있으면 라벨이 **영문 그대로** 새어 나갔다.
 *
 * 서버 정본: `apps/api/src/modules/journey-console/journey-console.service.ts`
 * (가드가 그 파일과 이 표를 기계로 대조한다).
 */
export interface JourneyStageDef {
  key: string;
  label: string;
  /** 종결 단계 — 관제 대상이 아니다(카드가 아니라 카운트로 접는다) */
  terminal?: boolean;
}

export const OPD_JOURNEY_STAGES: JourneyStageDef[] = [
  { key: 'RECEPTION', label: '접수' },
  { key: 'CALLED', label: '호출' },
  { key: 'IN_CONSULT', label: '진료중' },
  { key: 'CASHIER_WAITING', label: '수납대기' },
  { key: 'DONE', label: '완료', terminal: true },
];

export const IPD_JOURNEY_STAGES: JourneyStageDef[] = [
  { key: 'ADMITTED', label: '입원' },
  { key: 'INWARD', label: '재원' },
  { key: 'DISCHARGE_PLANNED', label: '퇴원예정' },
  { key: 'DISCHARGED', label: '퇴원', terminal: true },
];

export const ER_JOURNEY_STAGES: JourneyStageDef[] = [
  { key: 'ER_ARRIVED', label: '도착' },
  { key: 'ER_TRIAGED', label: '분류완료' },
  { key: 'ER_TREATMENT', label: '처치중' },
  { key: 'ER_DISPOSITION', label: '퇴실결정' },
  { key: 'ER_DONE', label: '퇴실', terminal: true },
];

export const JOURNEY_STAGES_BY_TRACK: Record<string, JourneyStageDef[]> = {
  OPD: OPD_JOURNEY_STAGES,
  IPD: IPD_JOURNEY_STAGES,
  ER: ER_JOURNEY_STAGES,
};

/** 🔴 모르는 단계를 한국어인 척하지 않는다 — 원문 그대로 보여주고 가드가 이 표를 고치라고 실패한다 */
export function journeyStageLabel(track: string, stage: string): string {
  return JOURNEY_STAGES_BY_TRACK[track]?.find((s) => s.key === stage)?.label ?? stage;
}

export const ALL_JOURNEY_STAGE_KEYS: string[] = Object.values(JOURNEY_STAGES_BY_TRACK)
  .flat()
  .map((s) => s.key);
