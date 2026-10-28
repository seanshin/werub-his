/**
 * 스크라이브(대화 기록) 세션 어휘 — **정본**.
 *
 * 왜 shared 에 있는가: BE(시계열 `CONVERSATION` 트랙)와 FE(진료 화면 패널·환자 시계열)가 같은 상태를
 * 각자 번역하면 갈라진다([[ai-proposal]] 와 같은 규약). 라벨은 여기 하나, 양쪽이 가져다 쓴다.
 *
 * 🔴 상태는 "무엇이 일어났는가"이고 **"기록에 들어갔는가"가 아니다** — `APPLIED` 만 진료기록에 반영된
 *    것이고, `DRAFTED` 는 초안이 있을 뿐이다(초안≠확정). 화면이 둘을 같은 색으로 그리면 "N건 완료"가
 *    아무것도 안 들어간 상태를 가린다.
 */
export const SCRIBE_SESSION_STATUSES = [
  'RECORDING',
  'UPLOADED',
  'TRANSCRIBING',
  'TRANSCRIBED',
  'DRAFTED',
  'APPLIED',
  'FAILED',
  'DELETED',
] as const;

export type ScribeSessionStatusValue = (typeof SCRIBE_SESSION_STATUSES)[number];

export const SCRIBE_SESSION_STATUS_LABEL: Record<ScribeSessionStatusValue, string> = {
  RECORDING: '기록 중',
  UPLOADED: '업로드됨(전사 대기)',
  TRANSCRIBING: '전사 중',
  TRANSCRIBED: '전사 완료(초안 없음)',
  DRAFTED: '초안 생성됨(미반영)',
  APPLIED: '진료기록에 반영됨',
  FAILED: '실패',
  DELETED: '파기됨',
};

/** 대화가 어떤 경로로 들어왔는가 — 발화 단위 저장 여부가 갈린다(AMBIENT 만 발화 수가 있다) */
export const SCRIBE_SOURCE_LABEL: Record<string, string> = {
  AMBIENT: '라이브 대화',
  RECORDING: '녹음 사후 전사',
};

export function scribeSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null; // 모르면 지어내지 않는다
  return SCRIBE_SOURCE_LABEL[source] ?? source;
}

export function scribeSessionStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return SCRIBE_SESSION_STATUS_LABEL[status as ScribeSessionStatusValue] ?? status;
}
