/**
 * 모바일 ↔ 서버 계약 소스 가드 (2026-08-18 신설)
 *
 * 🔴 이 저장소에는 모바일 테스트 인프라가 없다(알려진 갭). 러너를 급조하지 않기 위해
 *    **의존성 0** 으로 만든다 — Node 내장 `node:test` 만 쓴다(`npm test` → turbo `test` 태스크).
 *    렌더링을 검증하지 않는다. **소스가 규약을 어겼는지**만 문자열·패턴으로 본다.
 *
 * 🔴 부분 문자열 단언은 깨진 출력을 숨긴다(v3.95 교훈: `toContain` 이 훼손된 URL 을 놓쳤다).
 *    따옴표·경계까지 보는 정규식으로 단언한다.
 *
 * 지키는 규약(web 과 동일):
 *   - 조회 실패를 "없음"으로 말하지 않는다
 *   - null(산출 불가)을 0/false 로 접지 않는다
 *   - 서버가 거절하면 화면이 그 사실을 말한다(삼키지 않는다)
 *   - 모바일은 **환자 앱**이다 — 스태프/PACS EP 를 직접 부르지 않는다
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = (p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * 🔴 주석을 걷어낸 **코드만** 본다.
 *
 * 이 가드를 처음 돌렸을 때 스스로 오탐을 냈다 — 옛 결함을 설명하는 주석
 * (`!data?.refreshToken` 을 인용한 W9 문서 주석)을 코드로 읽고 실패했다.
 * 반대 방향이 더 위험하다: 주석에만 있는 `reports.isError` 를 배선으로 착각하면
 * **가드가 아무것도 지키지 않으면서 통과**한다.
 *
 * 블록 주석(`/* *\/`)과 **줄 맨 앞** 라인 주석만 제거한다 —
 * `'https://…'` 같은 문자열 안의 `//` 는 건드리지 않는다.
 */
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

/** 모바일 소스 전체(.ts/.tsx) 목록 — node_modules 제외 */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.expo' || name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) out.push(relative(ROOT, full));
    }
  };
  walk(ROOT);
  return out;
}

describe('영상검사 화면 — PACS 조회 실패를 "영상/판독문 없음"으로 말하지 않는다', () => {
  const src = read('app/(tabs)/imaging.tsx');

  test('studies 실패는 서버 문구를 그대로 전한다(일반 오류로 뭉개지 않는다)', () => {
    // 서버는 503 `{ error: { code: 'PACS_UNAVAILABLE', message } }` 를 낸다.
    // 화면은 그 message 를 살려서 보여줘야 한다 — 고정 문구로 덮으면 "왜"가 사라진다.
    assert.match(
      src,
      /<ErrorState\s+message=\{failMessage\(\s*error\s*,/,
      'studies 실패 화면이 서버 error 를 근거로 문구를 만들지 않는다',
    );
    assert.match(
      src,
      /code\s*===\s*'PACS_UNAVAILABLE'/,
      "PACS_UNAVAILABLE 코드를 구분하지 않는다(서버 envelope: error.code)",
    );
  });

  test('reports 실패는 화면에 고지된다 — 푸터가 비는 것을 "판독문 없음"으로 읽히게 두지 않는다', () => {
    assert.match(
      src,
      /reports\.isError/,
      'reports 쿼리의 실패를 화면이 전혀 보지 않는다 → 조회 실패가 "판독문 없음"으로 보인다',
    );
    // 실패 고지에 재시도 경로가 붙어 있어야 한다(막다른 골목 금지)
    assert.match(src, /reports\.refetch\(\)/, 'reports 실패 고지에 재시도가 없다');
  });
});

describe('원격진료 예약 화면 — 서버 거절·조회 실패를 삼키지 않는다', () => {
  const src = read('app/(tabs)/telehealth-book.tsx');

  test('예약 거절(400/403)이 화면에 표시된다', () => {
    // 서버는 2026-08-18 부터 담당의·진료과를 검증해 400/403 으로 거절한다.
    // onError/isError 를 화면이 보지 않으면 환자는 버튼만 누르고 아무 일도 안 일어난다.
    assert.match(
      src,
      /bookMutation\.isError/,
      '예약 실패가 화면에 표시되지 않는다 — 거절이 조용히 삼켜진다',
    );
    assert.match(
      src,
      /errText\(\s*bookMutation\.error\s*,/,
      '서버 거절 사유(문구)를 그대로 보여주지 않는다',
    );
  });

  test('"없습니다" 안내는 조회가 성공했을 때만 나온다', () => {
    // 실패해서 목록이 빈 것과, 정말 없는 것은 다른 사실이다.
    for (const q of ['departments', 'doctors', 'slots']) {
      assert.match(
        src,
        new RegExp(`!${q}\\.isError`),
        `${q} 조회 실패와 "없음"을 구분하지 않는다`,
      );
    }
  });

  test('조회 실패를 한 곳에서 고지한다', () => {
    assert.match(src, /loadFailed/, '조회 실패 고지 배너가 없다');
  });
});

describe('환자 앱 4화면 — 조회 실패를 "없음"으로 말하지 않는다 (2026-08-27)', () => {
  test('약물 상호작용: 실패를 "상호작용 없음"(안심)으로 접지 않는다', () => {
    const src = read('app/(tabs)/ai-health.tsx');
    // 🔴 종전: catch → setResult([]) 이고 언랩도 `?? []` 라, 호출 실패가
    //    "약물 간 상호작용이 발견되지 않았습니다" 로 보였다.
    assert.doesNotMatch(
      src,
      /catch\s*\{\s*setResult\(\s*\[\s*\]\s*\)/,
      'catch 가 빈 배열을 결과로 삼는다 — 조회 실패가 "상호작용 없음"으로 보인다',
    );
    assert.doesNotMatch(
      src,
      /data\?\.interactions\s*\?\?\s*\[\s*\]/,
      '언랩이 `?? []` 로 접힌다 — 응답 형태가 달라도 "상호작용 없음"이 된다',
    );
    // 형제 AI 카드(AiFreeQuestion·AiExplainCard)와 같은 방식: errorText 로 말한다
    assert.match(
      src,
      /Array\.isArray\(\s*interactions\s*\)/,
      '배열로 온 것만 결과로 받지 않는다',
    );
    // errorText 상태를 쓰는 카드가 3개(자유질문·설명·상호작용) 모두여야 한다
    const cards = src.match(/const \[errorText, setErrorText\]/g) ?? [];
    assert.equal(
      cards.length,
      3,
      `AI 카드 3종 중 ${cards.length}종만 errorText 로 실패를 말한다`,
    );
  });

  test('동의서: 실패를 "동의서가 없습니다"로 말하지 않는다', () => {
    const src = read('app/(tabs)/consent.tsx');
    // 🔴 종전엔 isError 를 구조분해조차 하지 않아, 실패 → EmptyState "동의서가 없습니다" 였다.
    //    환자가 서명해야 할 동의서를 "없다"고 읽는다.
    assert.match(
      src,
      /const\s*\{[^}]*\bisError\b[^}]*\}\s*=\s*useQuery/,
      'useQuery 가 isError 를 꺼내지 않는다 — 조회 실패가 "동의서 없음"으로 보인다',
    );
    assert.match(src, /if\s*\(isError\)/, '실패 분기가 없다');
    assert.match(src, /<ErrorState/, '실패를 정본 ErrorState 로 말하지 않는다');
    // 로딩 중을 "확인 불가"로 말하지 않는다 — isLoading 분기가 isError 보다 앞에 있어야 한다
    assert.ok(
      src.indexOf('if (isLoading)') < src.indexOf('if (isError)'),
      '로딩 분기가 실패 분기보다 뒤에 있다 — 아직 안 온 것을 "못 불러왔다"고 말한다',
    );
  });

  test('수납: 실패가 "미수납 0원"으로 보이지 않는다', () => {
    const src = read('app/(tabs)/billing.tsx');
    // 🔴 종전: 실패 → billings [] → unpaidAmount 0 → 초록색 "미수납액 0원".
    assert.match(
      src,
      /const\s*\{[^}]*\bisError\b[^}]*\}\s*=\s*useQuery/,
      'useQuery 가 isError 를 꺼내지 않는다 — 조회 실패가 미수납 0원으로 보인다',
    );
    assert.match(src, /if\s*\(isError\)/, '실패 분기가 없다');
    assert.match(src, /<ErrorState/, '실패를 정본 ErrorState 로 말하지 않는다');
    assert.ok(
      src.indexOf('if (isLoading)') < src.indexOf('if (isError)'),
      '로딩 분기가 실패 분기보다 뒤에 있다',
    );
  });

  test('원격진료: 실패를 "예정된 원격진료가 없습니다"로 말하지 않는다', () => {
    const src = read('app/(tabs)/telehealth.tsx');
    assert.match(
      src,
      /const\s*\{[^}]*\bisError\b[^}]*\}\s*=\s*useQuery/,
      'useQuery 가 isError 를 꺼내지 않는다 — 환자가 예약을 놓친다',
    );
    // "없습니다" 문구가 isError 분기 뒤에서만 나와야 한다(questionnaire 화면과 같은 방식)
    assert.match(
      src,
      /isError\s*\?[\s\S]{0,200}?:\s*'예정된 원격진료가 없습니다'/,
      '"예정된 원격진료가 없습니다" 를 조회 성공 여부와 무관하게 단정한다',
    );
  });

  test('빈 목록은 그대로 "없음"이라고 말한다 — 실패로 뭉개지 않는다', () => {
    // 🔴 대조군. 반대 방향 과잉교정을 막는다:
    //    진짜 빈 것을 "불러오지 못했습니다" 라고 하면 그것도 사실이 아니다.
    for (const [f, phrase] of [
      ['app/(tabs)/consent.tsx', '동의서가 없습니다'],
      ['app/(tabs)/billing.tsx', '수납 내역이 없습니다'],
      ['app/(tabs)/telehealth.tsx', '예정된 원격진료가 없습니다'],
    ]) {
      assert.match(
        read(f),
        new RegExp(phrase),
        `${f} 가 빈 목록 안내를 잃었다 — 진짜 0건을 말할 방법이 없어졌다`,
      );
    }
    // 상호작용 없음(진짜 0건)도 그대로 남아 있어야 한다
    assert.match(
      read('app/(tabs)/ai-health.tsx'),
      /약물 간 상호작용이 발견되지 않았습니다/,
      '검사 성공 + 0건을 말할 방법이 없어졌다',
    );
  });
});

describe('api-client — 실패를 성공/빈 결과로 바꾸지 않는다', () => {
  const src = read('src/lib/api-client.ts');

  test('non-2xx 는 반드시 throw 한다', () => {
    assert.match(
      src,
      /if\s*\(\s*!response\.ok\s*\)[\s\S]{0,400}?throw\s+error/,
      '!response.ok 경로가 throw 하지 않는다 — 실패가 빈 응답으로 흘러간다',
    );
    // 실패를 빈 배열/객체로 바꿔치기하는 흔한 안티패턴
    assert.doesNotMatch(
      src,
      /!response\.ok[\s\S]{0,200}?return\s*(\[\]|\{\s*data:\s*\[\]\s*\})/,
      '실패를 빈 결과로 대체한다',
    );
  });

  test('서버 에러 envelope `{ error: { code, message } }` 를 그대로 읽는다', () => {
    // 🔴 P11. 서버 GlobalExceptionFilter 는 `{ error: { code, message, details }, meta }` 를 낸다.
    //    여기서 키가 어긋나면 화면은 모든 실패를 "요청 실패 (503)" 로만 말한다.
    assert.match(src, /errorBody\?\.error\?\.code/, 'error.code 를 읽지 않는다');
    assert.match(src, /errorBody\?\.error\?\.message/, 'error.message 를 읽지 않는다');
  });

  test('토큰 갱신은 accessToken 만 필수로 본다(서버는 refreshToken 을 재발급하지 않는다)', () => {
    // 회귀 방지: refreshToken 을 필수로 보면 갱신이 100% 실패해 1시간마다 강제 로그아웃된다.
    assert.doesNotMatch(
      src,
      /!data\?\.refreshToken/,
      'refreshToken 을 필수로 봐 갱신이 항상 실패한다(W9 회귀)',
    );
    assert.match(src, /!data\?\.accessToken/, 'accessToken 유효성을 확인하지 않는다');
  });
});

describe('모바일은 환자 앱이다 — 스태프/PACS EP 를 직접 부르지 않는다', () => {
  const ALLOWED = /^\/api\/v1\/(portal|patient-auth|booking)\//;

  test('호출하는 EP 는 portal · patient-auth · booking 뿐이다', () => {
    const violations = [];
    for (const f of sourceFiles()) {
      const src = read(f); // 주석 안의 예시 경로를 위반으로 세지 않는다
      for (const m of src.matchAll(/['"`](\/api\/v1\/[^'"`\s?]*)/g)) {
        const path = m[1];
        if (!ALLOWED.test(path)) violations.push(`${f}: ${path}`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      `환자 앱이 환자 스코프 밖 EP 를 부른다:\n${violations.join('\n')}`,
    );
  });

  test('PACS 를 직접 호출하지 않는다(HIS 프록시로만)', () => {
    for (const f of sourceFiles()) {
      const src = read(f);
      assert.doesNotMatch(
        src,
        /\/(pacs-api|dicom-web|wado)\//,
        `${f} 가 PACS 를 직접 부른다 — HIS 의 인증·감사·소유권 검증을 우회한다`,
      );
    }
  });
});
