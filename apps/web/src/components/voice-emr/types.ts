/**
 * VoiceEMR — FE 타입. **BE `orchestrator.ts` 의 `Outcome` 과 같은 모양이어야 한다.**
 *
 * 🔴 2026-08-27. 이 파일은 "프로토타입·미배선"이라 적어 두고 있었지만, 실제로는
 *    `encounter/new` → `VoiceHub` → `VoiceEmrLauncher` → `voiceApi.parse()` 로 **배선되어 있었다**.
 *    그 사이 BE 는 n-best 를 `{ candidates, preSelect }` **객체**로 바꿨는데 이 파일은 계속
 *    `nbest: NbestCandidate[]`(배열)로 선언하고 있었다 — 그래서
 *      · `tsc` 는 통과했고(선언이지 검증이 아니다)
 *      · `voice-store.spec.ts` 도 통과했다(목이 **내가 가정한 모양**을 썼다)
 *      · 실제로는 확인 카드가 `card.nbest.map` 에서 죽었다(처방·검사 음성 오더 전부).
 *    P11(FE↔서버 계약 불일치) + "목은 정본의 실제 반환 모양을 쓴다"의 교과서 사례다.
 *    모양은 `apps/api/src/modules/voice-emr/orchestrator.ts` 가 정본이고, 기계 대조는
 *    `apps/web/test/ui/voice-confirm-card-contract.spec.tsx` 가 강제한다.
 */
export type VoiceMode = 'read' | 'dictate' | 'command';

export type VoiceState =
  | 'idle' | 'warming' | 'listening' | 'capturing' | 'parsing' | 'confirming' | 'executing' | 'error';

export interface PatientRef {
  name: string;
  mrn: string;
  sexAge?: string;
}

/** n-best 후보(BE `Scored`) */
export interface NbestCandidate {
  code: string;
  name: string;
  score: number;
}

/**
 * BE `NbestResult` — **객체다(배열이 아니다).**
 * `preSelect` 는 BE 의 추천일 뿐 화면이 자동 선택하지 않는다(단일 자동선택 금지·P-6).
 */
export interface NbestResult {
  candidates: NbestCandidate[];
  preSelect: string | null;
}

/** 고위험 판정 출처 — BE `HighAlertSource`. 🔴 `UNSCREENED` 는 "고위험 아님"이 아니라 **미확인**이다. */
export type HighAlertSource = 'MASTER' | 'TERM_SCREEN' | 'UNSCREENED';

/** SOAP 필드 — 진료 화면 `appendSoap` 의 첫 인자와 같은 어휘 */
export type SoapField = 'subjective' | 'objective' | 'assessment' | 'plan';

/**
 * orchestrator 결과(BE processUtterance 와 동일 형태)
 * · `hold.reason` — `low_confidence`(파서) · `DICTATE_OFF`(서버 `gateDictate` — 세션 mode≠DICTATE 또는 게이트 OFF)
 */
export type Outcome =
  | { kind: 'read'; target: string; term?: string }
  | { kind: 'hold'; reason: string }
  | { kind: 'system'; action: string }
  | ConfirmCard; // vital·order-rx·order-lab·order-imaging·alias·dictate(확인 필요)

/** 확인 카드 페이로드 — 환자 신원 항상 포함(G3) */
export type ConfirmCard =
  | { kind: 'vital'; patient: PatientRef; metric: string; values: number[]; unit?: string; abnormal: boolean }
  | {
      kind: 'order-rx'; patient: PatientRef;
      /** 구술 원문(약품명) — BE 가 마스터 재조회·재판정에 쓴다. */
      term?: string;
      nbest: NbestResult; selectedCode?: string; dose?: number; unit?: string; freq?: string; route?: string;
      /** 🔴 `false` 만 보고 "고위험 아님"이라 말하지 않는다 — `highAlertSource` 와 함께 읽는다. */
      highAlert: boolean;
      highAlertSource?: HighAlertSource;
      highAlertCategory?: string | null;
      /** 독립 이중확인(IPSG.3) 대상. **판정 불가는 `null`** — false 로 뭉개지 않는다. */
      doubleCheckRequired?: boolean | null;
      highAlertReason?: string;
      /**
       * 고위험 재확인 체크. 🔴 **카드에 담는다** — 확정 시 `slots` 로 서버 `VoiceCommandLog` 에
       * 저장되기 때문이다. 로컬 state 로 두면 버튼만 막고 아무 데도 남지 않는 가짜 게이트가 된다.
       */
      highAlertAck?: boolean;
    }
  | { kind: 'order-lab'; patient: PatientRef; labs: { term: string; nbest: NbestResult; selectedCode?: string }[] }
  | { kind: 'order-imaging'; patient: PatientRef; modality: string; bodyPart?: string }
  | { kind: 'alias'; patient: PatientRef; label: string }
  /**
   * 구술(T2) — 🔴 종전엔 `Outcome` 에 `{ kind: 'dictate'; text }` 로만 있어 확인 카드를 지나지 않고
   * S 를 **덮어썼다**(기획서 voice-emr-ambient-conversation §13.2 P0-1). BE 가 `patient`·`needsConfirm` 을
   * 실어 주고, 화면은 필드(S/O/A/P)를 사람이 고르고 본문을 고친 뒤 **확정 시에만 append** 한다.
   * · `field` — 🔴 초기값은 **미선택**(쓰기 폼의 초기값은 미선택 · CLAUDE.md §4) · 확정 버튼은 선택 전까지 막힌다
   * · `editedText` — 사람이 카드에서 고친 본문(없으면 `text`)
   */
  | { kind: 'dictate'; patient: PatientRef; text: string; field?: SoapField; editedText?: string };
