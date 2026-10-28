/**
 * 성문(생체정보) 원격 파기 결과 — **정본 어휘**(VoiceEMR 등록 철회).
 *
 * 왜 shared 에 있는가: 서버가 파기 여부를 갈라 실어보내도 화면이 다른 어휘를 읽으면 분기는 영원히
 * 타지 않는다([[erp-read-failure]] 와 같은 이유). 어휘는 여기 하나, BE·FE 가 가져다 쓴다.
 *
 * 🔴 **철회 ≠ 파기.** 동의 철회는 로컬에서 즉시 효력(게이트 off·표본 0·동의 회수)이지만, AI 서버(WeRU.B)에
 * 있는 성문이 실제로 지워졌는지는 **다른 사실**이다. 종전에는 원격 삭제 결과를 버리고(`.catch(() => undefined)`)
 * 화면이 무조건 '철회·삭제 완료'라고 말했다 — 개인정보보호법 §21(파기의무) 경로에서 파기하지 못한 것을
 * 파기했다고 말한 자리다.
 *
 *   PURGED             — 성문 서버가 삭제를 확인했다
 *   NOT_PRESENT        — 지울 성문·표본이 애초에 없었다(파기할 것이 없음 — 실패가 아니다)
 *   REMOTE_UNAVAILABLE — 물어보지 못했다(미설정·망·타임아웃·egress 차단·삭제 EP 미구현 404/405/501)
 *   REMOTE_FAILED      — 물었고 성문 서버가 거절·오류로 답했다
 */
export const VOICEPRINT_PURGE_OUTCOMES = ['PURGED', 'NOT_PRESENT', 'REMOTE_UNAVAILABLE', 'REMOTE_FAILED'] as const;
export type VoiceprintPurgeOutcome = (typeof VOICEPRINT_PURGE_OUTCOMES)[number];

/** 파기가 끝난 것으로 말해도 되는 결과 — 나머지는 "파기 미완료"이고 재시도 대상이다 */
export function isVoiceprintPurged(v: VoiceprintPurgeOutcome | null | undefined): boolean {
  return v === 'PURGED' || v === 'NOT_PRESENT';
}

export function isVoiceprintPurgeOutcome(v: unknown): v is VoiceprintPurgeOutcome {
  return typeof v === 'string' && (VOICEPRINT_PURGE_OUTCOMES as readonly string[]).includes(v);
}
