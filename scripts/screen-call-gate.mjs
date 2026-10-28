/**
 * 화면의 **호출 자리**가 게이트를 달고 있는가 — 정본 하나.
 *
 * 🔴 (2026-09-16 K3) 이 판정이 두 곳에 따로 있으면 갈라진다. J2 의 실프로브(`probe-least-privilege.mjs`)가
 *    호출 단위로 판정하고 있었는데, 정적 스캐너(`role-endpoint-scan.ts`)는 **화면 단위**로 판정해
 *    한 버튼만 역할로 감싸도 그 화면의 EP 를 통째로 스캔에서 뺐다 — 실측: `/billing` 은 예치금 버튼
 *    한 줄(`useHasRole('RECEPTIONIST','CHECKUP')`) 때문에 7개 EP 가 전부 빠져 있었고, 그래서
 *    J2 가 찾은 수납 드리프트(세 번째 재발)를 **전수 가드가 못 잡았다.** 둘이 같은 규칙을 쓰게 한다.
 *
 * 🔴 이 판정은 **상한이 아니라 하한**이다 — 게이트를 놓치면(gated=false) 그 자리는 대조 대상이 되어
 *    미스매치 후보로 올라온다(사람이 판정). 반대로 넓게 잡으면 **결함이 조용히 빠진다** — 그래서
 *    신호를 좁게 유지한다.
 */

/**
 * 파일 안에서 **인증 훅으로부터 선언된** 게이트 식별자 — `const canDischarge = useHasRole('DOCTOR')`.
 *
 * 🔴 (2026-09-17 L3) 종전 신호 목록은 `canSee|canAct|canReview|canAccess` 네 이름만 알아서,
 *    **바로 윗줄의 `useHasRole(...)` 게이트를 못 봤다.** 실측: `/icu` 의 퇴실은
 *    `const canDischarge = useHasRole('DOCTOR')` 가 mutation 선언 **한 줄 위**에 있는데도
 *    미스매치로 올라왔다(`/diagnostics`·`/lab`·`/imaging` 등 같은 모양 다수).
 *    이름 목록을 넓히는 대신(넓히면 결함이 조용히 빠진다) **선언이 인증 훅인 식별자만** 인정한다 —
 *    그 이름이 무엇이든(`canDischarge`·`isNutritionist`) 게이트인 것은 선언이 증명한다.
 */
/**
 * 🔴 명시적으로 이름 붙인 **권한 훅**도 센다 — `useCanManageCheckupVisit()`·`useXxxAccess()`.
 *    이 저장소의 정본 패턴(`safety-access.ts`)이 그 모양이고, 이름이 `useCan…`/`…Access` 인 훅은
 *    "이 사람이 이걸 해도 되는가"만 답한다. 아무 `useX()` 나 받아들이면 결함이 조용히 빠지므로
 *    **이 두 꼴만** 인정한다.
 */
const AUTH_HOOK = /\b(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(?:useHasRole|useAdminWrite|useHasPermission|useHasAllPermissions|useCan[A-Z]\w*|use\w*Access)\s*\(/g;

export function gateIdentifiers(src) {
  return [...src.matchAll(AUTH_HOOK)].map((m) => m[1]);
}

/**
 * 호출 자리 주변(앞 10줄·뒤 8줄)에서 읽는 게이트 신호
 * @param ctx 호출 문맥
 * @param gateIds `gateIdentifiers()` 가 뽑은 **그 파일의** 인증 훅 파생 식별자
 */
export function gateSignals(ctx, gateIds = []) {
  const s = [];
  if (/enabled\s*:/.test(ctx)) s.push('enabled');
  if (/\buseHasRole\s*\(|\buseAdminWrite\s*\(|\buseHasPermission\s*\(/.test(ctx)) s.push('role-hook');
  if (gateIds.length && new RegExp(`\\b(?:${gateIds.join('|')})\\b`).test(ctx)) s.push('gate-id');
  /**
   * 🔴 (2026-09-16 K3) `allowed\b` 가 대소문자를 구분해 `myQueueAllowed` 를 놓쳤다 —
   *    `/clinic-queue` 의 `queue/my` 는 `myQueueAllowed` 로 이미 막혀 있는데(칩 자체를 렌더하지 않고
   *    `enabled` 도 건다) 미스매치로 올라왔다. 이 저장소에서 **같은 대소문자 실수가 두 번째**다
   *    (`currentUser?.role` 을 자기게이팅으로 못 본 스캐너 6번째 오류).
   *    `Allowed` 로 끝나는 식별자만 추가로 인정한다 — 통째로 `/i` 를 걸면 신호가 넓어져 결함이 빠진다.
   */
  if (/canSee|canAct|canReview|canAccess|-access'|allowed\b|[a-z]Allowed\b/.test(ctx)) s.push('access-gate');
  if (/role\s*===|roles\.includes|isAdmin|isExecutive/.test(ctx)) s.push('role-check');
  return s;
}

/** 호출 자리의 문맥 — 줄 기준(앞 10·뒤 8)으로 자른다 */
export function callContext(src, index) {
  const lines = src.split('\n');
  const at = src.slice(0, index).split('\n').length - 1;
  return lines.slice(Math.max(0, at - 10), at + 8).join('\n');
}

/**
 * **트리거 게이트** — 호출은 컴포넌트 상단(`useMutation`·`async 함수`)에 있고
 * 버튼은 아래 JSX 에 있는 자리를 따라간다.
 *
 * 🔴 (2026-09-17 L3) 문맥 ±10줄만 보면 이 모양을 **전부 놓친다.** 실측으로 확인한 것만 적는다:
 *    `/inpatient` 는 `{isNurse && <button onClick={() => handleTransfer(a)}`(전동)·`{isDoctor && …}`(퇴원)로
 *    이미 막고 주석까지 달려 있는데(2026-08-31 판정) 미스매치로 올라왔고, `/workstation/consent` 의
 *    `doctor-sign`·`/workstation/documents` 의 작성·서명·`/pathology` 의 판독 보고서도 같았다
 *    (병리는 "판독 보고서 작성·서명은 병리의 권한입니다" 라고 **화면이 말하기까지** 한다).
 *
 * 🔴 넓히면 결함이 조용히 빠지므로 **두 조건을 모두** 요구한다:
 *    ① 호출을 감싼 선언 이름을 찾을 수 있고
 *    ② 그 이름을 쓰는 줄이 `{gate && …}` · `gate ? … : …` 처럼 **게이트 식별자의 조건 안**에 있다.
 *    못 찾으면 게이트 없음으로 남긴다(하한 유지 — 사람이 판정하게).
 */
const ROLE_CONST = /\b(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(?:[^;\n]*\b(?:\w*[Uu]ser|me|auth|account|profile|session|viewer)\?\.role\b[^;\n]*|\[[^\]]*\]\.includes\([^)]*\?\.role[^)]*\))/g;

/** 파일의 게이트 식별자 — 인증 훅 파생 + 로그인 역할 비교 파생 */
export function allGateIdentifiers(src) {
  return [...new Set([...gateIdentifiers(src), ...[...src.matchAll(ROLE_CONST)].map((m) => m[1])])];
}

export function triggerGated(src, index, gateIds = allGateIdentifiers(src)) {
  if (!gateIds.length) return null;
  const lines = src.split('\n');
  const at = src.slice(0, index).split('\n').length - 1;
  let name = '';
  for (let i = at; i >= 0 && i > at - 40; i--) {
    const m = lines[i].match(/(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(?:use(?:Mutation|Query)|async|\()/)
      ?? lines[i].match(/(?:async\s+)?function\s+(\w+)\s*\(/);
    if (m && !/^(qc|queryClient|apiClient|toast|router|fetcher)$/.test(m[1])) { name = m[1]; break; }
  }
  if (!name) return null;
  const gate = `(?:${gateIds.join('|')})`;
  const cond = new RegExp(`\\b${gate}\\b\\s*(?:&&|\\?)|\\b${gate}\\b[^\\n]*\\?[^\\n]*:`);
  const used = new RegExp(`\\b${name}\\b`);
  for (let i = 0; i < lines.length; i++) {
    if (i === at || !used.test(lines[i])) continue;
    // 그 줄 또는 바로 위 3줄(조건이 줄바꿈된 JSX)에 게이트 조건이 있는가
    // 🔴 JSX 조건은 중첩되며 줄바꿈된다 — `{gate && a ? (` … `) : b ? (` … 버튼. 실측(비대면진료
    //    화상 수락)에서 게이트가 **4줄 위**라 3줄 창에서 빠졌다. 6줄까지 본다(더 넓히면 무관한
    //    조건까지 게이트로 읽는다).
    if (cond.test(lines.slice(Math.max(0, i - 6), i + 1).join('\n'))) return `trigger:${name}@${i + 1}`;
  }
  return null;
}
