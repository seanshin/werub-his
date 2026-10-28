/**
 * 🔴 **HIS 코드가 요구하는 모델 태그** — 손으로 등재한 목록이다(2026-09-09 grep 실측).
 *
 * 왜 필요했나(실측한 피해):
 *   AI 서버 이전 후 `gemma3:12b` 가 상류에 **없어졌는데** 컨시어지는 상시 FALLBACK 이었고,
 *   화면 어디에도 "우리가 부르는 모델이 서버에 없다"는 사실이 없었다. 태그가 12곳에 흩어져 있어
 *   무엇을 요구하는지조차 한눈에 볼 수 없었다. 이 파일은 그 목록을 **한 곳에 모은 것**이고,
 *   `GET /api/v1/admin/ai/upstream-models` 가 상류 보유 목록과 대조해 `missing` 을 낸다.
 *
 * 🔴 이 파일은 **정본이 아니다 — 사본이다.** 태그의 정본은 여전히 각 서비스의 코드 상수이며
 *   (그것을 설정으로 수렴하는 것이 기획서 §2.2 의 남은 일이다), 여기는 "지금 코드가 무엇을 부르는가"의
 *   기계 대조용 스냅샷이다. 그래서 가드(`test/ai-call-log/model-releases.spec.ts`)가 아래 `sites` 의
 *   파일에 그 태그 문자열이 실제로 있는지 확인한다 — 코드에서 사라진 태그를 요구하고 있으면 실패한다.
 *
 * 🔴 `ai.model`(SystemConfig) 은 현재 번역 1곳만 소비한다. 그래서 설정을 바꿔도 나머지 11곳은
 *    아래 상수 그대로 나간다 — 화면은 이 사실을 "코드 고정"으로 말한다(설정이 정책인 척하지 않는다).
 */

export interface RequiredModelTag {
  /** 상류(ollama)에 요청하는 태그 그대로 */
  tag: string;
  /** 이 태그를 쓰는 코드 위치(파일:줄은 움직이므로 파일까지만) */
  sites: string[];
  /** 없으면 무슨 일이 벌어지는가 — 지어내지 않고 관측된 것만 */
  note: string;
}

export const REQUIRED_MODEL_TAGS: readonly RequiredModelTag[] = [
  {
    tag: 'qwen2.5:14b',
    sites: [
      'src/modules/medical-ai/medical-ai.service.ts',
      'src/modules/portal/drug-explain.service.ts',
      'src/modules/data-quality/data-quality.service.ts',
      'src/modules/voc/voc-ai.service.ts',
      'src/modules/formulary/formulary.service.ts',
      'src/modules/gld/governance.service.ts',
      'src/modules/i18n/translation.service.ts',
      'src/modules/agent-session/agent-session.service.ts',
      'src/modules/orchestrator/orchestrator-engine.ts',
      'src/modules/config/config-runtime.service.ts', // ai.model 기본값
    ],
    note: '주력 태그. 없으면 위 경로 대부분이 실패하거나 규칙 기반 폴백으로 내려간다.',
  },
  {
    tag: 'qwen2.5:7b',
    sites: ['src/modules/medical-ai/medical-ai.service.ts'],
    note: '14b 실패 시 폴백 체인 2단(14b → 7b → 규칙). 없으면 체인이 한 칸 짧아진다.',
  },
  {
    tag: 'gemma3:12b',
    sites: ['src/modules/concierge/concierge.service.ts'],
    note:
      '🔴 2026-09-09 실측: AI 서버 이전 후 상류에 없어 컨시어지가 상시 FALLBACK. ' +
      '환경변수 CONCIERGE_LLM_MODEL 이 있으면 그 값이 이긴다(그때는 이 태그를 안 부른다).',
  },
  {
    tag: 'gemma3:4b',
    sites: ['src/modules/concierge/concierge.service.ts'],
    note: '컨시어지 폴백 2단. 이것까지 없으면 키워드 응답으로 떨어진다.',
  },
];

/**
 * 🔴 요구 목록에 넣지 않은 것 — 이유를 적어 둔다(빠뜨린 것과 뺀 것은 다른 사실이다).
 *   · `werub/qwen2.5:14b` (`src/modules/gld/governance.service.ts`) — 상류에 **요청하는 태그가 아니라**
 *     위원회 안건 레코드에 적히는 **표시 문자열**이다(실제 요청은 같은 파일에서 `qwen2.5:14b`).
 *     즉 기록된 모델명과 실제 요청 태그가 다르다 — 이 축의 잔여 결함으로 남긴다(내 소유 파일이 아니다).
 */
export const NON_REQUESTED_MODEL_LABELS: readonly string[] = ['werub/qwen2.5:14b'];

export const REQUIRED_MODEL_TAG_LIST: readonly string[] = REQUIRED_MODEL_TAGS.map((t) => t.tag);

/**
 * 상류 태그 정규화 — ollama 는 같은 모델을 `qwen2.5:14b` 로도 `qwen2.5:14b`(+`:latest`)로도 낸다.
 * 🔴 여기서 하는 것은 **표기 차이 흡수뿐**이다. 이름이 비슷하다고 같은 모델로 치지 않는다.
 */
export function normalizeModelTag(tag: string): string {
  const t = tag.trim().toLowerCase();
  return t.endsWith(':latest') ? t.slice(0, -':latest'.length) : t;
}

/** 요구 태그 중 상류에 없는 것. `available` 이 null(=물어보지 못함)이면 **판정하지 않는다**. */
export function computeMissingTags(available: string[] | null): string[] | null {
  if (available == null) return null; // 🔴 모르는 것을 "없음"으로 접지 않는다
  const have = new Set(available.map(normalizeModelTag));
  return REQUIRED_MODEL_TAG_LIST.filter((t) => !have.has(normalizeModelTag(t)));
}
