/**
 * 설정값이 **어디서 왔는지** 말하는 어휘 — "설정돼 있다"와 "기본값으로 떨어졌다"는 다른 사실이다.
 *
 * 🔴 2026-09-09 실측: ERP SSO 진단이 여기서 막혔다. `erp.allowedRoles` 를 조회하면 값이 오는데,
 *    그 값이 **누가 설정한 것인지** 코드가 넣은 기본값인지 응답 어디에도 없었다 —
 *    그래서 "설정을 되돌리기 전 값"을 확인할 방법이 없었다([[erp_sso_browser_probe]]).
 *    같은 함정이 `i18n.reviewers`(서버는 읽는데 설정 화면이 없었다)에서도 나왔다.
 *
 * 🔴 이것은 **막는 장치가 아니다**(CLAUDE.md §4 — "기본값으로 떨어진 것을 조용히 하지 않는다,
 *    다만 막지 않는다"). 기본값으로도 시스템은 돌아가야 한다. 여기서 하는 일은 **드러내는 것** 하나다.
 */
export type ConfigSource =
  /** DB `system_configs` 에 행이 있다 — 사람이(또는 시드가) 설정한 값 */
  | 'db'
  /** DB 행이 없다 — 코드 `DEFAULTS` 카탈로그의 기본값이 쓰이고 있다 */
  | 'default'
  /** DB 행도 없고 `DEFAULTS` 등재도 없다 — 값 자체가 없다(`null`). "기본값"이라 부르면 거짓말이다 */
  | 'unset'
  /**
   * 🔴 환경변수가 이긴 값 — **배포로만 바꾸는 키**(예: AI egress 목적지 `ai.server.url`).
   *    화면에서 바꿀 수 없다고 막아 놓고 환경변수를 코드가 읽지 않으면, 설치 기관은 **DB 를 직접 고치는 수밖에**
   *    없다. 값이 어디서 왔는지 화면이 말해야 한다.
   */
  | 'env';

export const CONFIG_SOURCE_TEXT: Record<ConfigSource, string> = {
  db: '설정됨',
  default: '기본값',
  unset: '미설정',
  env: '환경변수',
};

/** 화면이 붙이는 한 줄 — 배지만으로는 "그래서 뭐"가 남는다 */
export const CONFIG_SOURCE_HINT: Record<ConfigSource, string> = {
  db: '이 값은 저장돼 있습니다(사람 또는 시드가 설정).',
  default: '저장된 값이 없어 코드 기본값이 쓰이고 있습니다 — 아무도 이 값을 정한 적이 없습니다.',
  unset: '저장된 값도 코드 기본값도 없습니다. 이 키를 읽는 곳은 값을 받지 못합니다.',
  env: '배포 환경변수가 정한 값입니다 — 화면에서 바꿀 수 없고, 바꾸려면 환경변수를 고쳐 다시 배포해야 합니다.',
};

/**
 * 🔴 목록에 뜨지 않던 자리 — DB 행은 있는데 `DEFAULTS` 미등재인 키.
 *    시드 잔재가 정책을 정해버린 사례가 이 저장소에 있다(`access.dept.원무과` 가 운영 관리자를 잠갔다).
 *    등재되지 않았다는 이유로 관리 화면에서 **보이지도 않으면** 그것을 되돌릴 방법이 없다.
 */
export const CONFIG_UNREGISTERED_TEXT = '미등재';
export const CONFIG_UNREGISTERED_HINT =
  '코드 설정 카탈로그(DEFAULTS)에 없는 키인데 DB 에 값이 저장돼 있습니다 — 시드 잔재이거나 폐기된 키일 수 있습니다.';

/**
 * 🔴 개발 시드가 넣은 값(2026-10-27) — 출처는 `db` 이지만 **사람이 정한 값이 아니다**(설정 행 label 표식 · shared `DEV_SEED_CONFIG_LABEL`).
 *    데모가 결정된 모양으로 돌게 할 뿐이다. "설정됨"만 보이면 원내가 정한 값으로 읽힌다.
 *    관리자가 그 키를 저장하면(같은 값이라도) 표식이 사라진다.
 */
export const CONFIG_SEEDED_TEXT = '개발 시드';
export const CONFIG_SEEDED_HINT = '개발 시드가 넣은 값입니다 — 원내가 정한 값이 아닙니다. 확인해 저장하면 원내가 정한 값이 됩니다.';
