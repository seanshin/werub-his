import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 임상 UX 규약 구조 가드 — 정본 `docs/01-plan/features/clinical-ux-agent-era.plan.md`.
 *
 * 🔴 기준선에 **여유를 두지 않는다.** 처음 이 파일을 쓸 때 여유를 뒀더니
 *    위반을 하나 재주입해도 가드가 통과했다 — 여유가 신규 위반을 흡수한 것이다.
 *    (가드는 결함을 재주입해 실패해야 가드다.) 그래서 전부 **실측 정확값**으로 동결한다.
 *    고쳐서 숫자가 내려가면 이 테스트가 "기준선이 낡았다"고 알려준다 — 그때 내린다.
 *
 * 🔴 규약만 적으면 지켜지지 않는다는 것이 이 저장소의 실측이다(2026-07 UX 규약의 날짜 정본 채택률은
 *    절반 남짓이었다). 그래서 **기준선을 동결**한다 — 지금 있는 것은 목록으로 인정하되,
 *    **새로 늘어나면 실패**한다. 목록을 줄이는 것은 언제나 환영이고, 늘리려면 이 파일을 고쳐야 한다.
 *
 * 기준선을 낮추면(고치면) 이 테스트가 "기준선이 낡았다"고 알려준다 — 그때 숫자를 내린다.
 */
const APP = path.join(__dirname, '..', '..', 'src', 'app');
const COMPONENTS = path.join(__dirname, '..', '..', 'src', 'components');

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}
const FILES = [...walk(APP), ...walk(COMPONENTS)];
const read = (f: string) => fs.readFileSync(f, 'utf8');
const countAll = (re: RegExp) =>
  FILES.reduce((n, f) => n + (read(f).match(re) ?? []).length, 0);

/**
 * 주석 제거 — 규약을 **적어 둔 주석**과 규약을 **어긴 코드**를 같이 세면 기준선이 거짓말한다.
 * 블록(`/* … *\/` · JSX `{/* … *\/}`)과 줄(`//`, URL 의 `://` 는 제외)을 지운다.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const codeOf = (f: string) => stripComments(read(f));
const countCode = (re: RegExp) =>
  FILES.reduce((n, f) => n + (codeOf(f).match(re) ?? []).length, 0);

describe('임상 UX 규약 — 기준선 동결(신규 위반 차단)', () => {
  /**
   * 🔴 `queryFn` 안에서 `.catch(() => 기본값)` 을 하면 promise 가 resolve 되어 `isError` 가
   *    영원히 false 가 된다 → 화면이 `QueryErrorFallback` 을 써도 **도달 불가 코드**다.
   *    서버가 죽어도 "담당 환자 없음 / 낙상 위험 0" 이라고 말하게 된다.
   */
  it('queryFn 안의 .catch(() => 빈값) 이 늘어나지 않는다', () => {
    // 🔴 2026-08-19 전 범위(app+components) 실측 = 503.
    //    검토가 보고한 축별 합(관리 65·WS 28·간호 18·포털 52)은 **부분집합**이었다 —
    //    기준선은 부분집합이 아니라 전 범위에서 잰다(분모부터 재실측한다).
    // 2026-08-20: 503 → 465. 회수한 38개소는 **이미 `isError`/`error` 를 구조분해해
    //   `QueryErrorFallback` 을 렌더하고 있던** 쿼리들이다 — `.catch` 가 그 UI 를 도달 불가로
    //   만들고 있었다. 나머지 337개소(쿼리 단위 실측)는 에러를 아예 받지 않아서,
    //   `.catch` 만 떼면 `!data` 로 로딩을 판정하는 화면이 **영구 로딩**이 된다.
    //   🔴 그쪽은 "에러 표시를 먼저 만들고" 떼야 한다 — 순서를 바꾸면 더 나빠진다.
    // 2026-08-20 2차: 465 → 146. `queryFn` 안 `.catch` 는 **384 → 13**.
    //   회수 방식 = "에러 표시를 먼저 만들고 catch 를 뗀다"(순서를 바꾸면 실패가 조용해지거나
    //   `!data` 로 로딩을 판정하는 화면이 영구 로딩이 된다).
    //   🔴 남은 13 은 **전부 삼킴이 아니다** — 진짜 폴백 체인(receipt→billing 원본),
    //   404 만 접고 나머지는 재throw 하는 것(OpNotePanel), 렌더 표면이 없는 config 훅,
    //   그리고 설계 판단이 남은 `Promise.all` 부분 실패 3건(nurse-station)이다.
    //   이 지표는 "패턴 개수"지 "거짓말 개수"가 아니다 — 0 을 목표로 삼지 않는다.
    //   🔴 계수 함수를 `countAll` → `countCode` 로 바꿨다(2026-08-20). 이 파일이 스스로 적어 둔
    //   원칙("규약을 적어 둔 주석과 규약을 어긴 코드를 같이 세면 기준선이 거짓말한다")과
    //   어긋나 있었다 — 회수 근거를 주석에 적자 그 주석이 위반으로 세어졌다(156 vs 146).
    //   그래서 이 숫자는 이전(503·465)과 **같은 자로 잰 값이 아니다**: 주석 제외 실측이다.
    // 2026-09-14: 146 → 122 로 낮춤. 실측은 이미 125 까지 줄어 있었다(여유 21 이 신규 위반을 흡수할 자리였다) —
    //   queryFn 교정 3곳(ErpLauncher·서명 2)으로 122. queryFn 안만 보는 목록 동결 가드는 `queryfn-catch-default.spec.ts`.
    const BASELINE = 122; // 줄이는 것은 환영, 늘리면 실패
    const n = countCode(/\.catch\(\s*\(\s*\)\s*=>\s*[({[]/g);
    expect(n, `조회 실패를 빈값으로 접는 코드가 기준선(${BASELINE})을 넘었다: ${n}`).toBeLessThanOrEqual(BASELINE);
  });

  /**
   * 🔴 조건식에서 미측정을 폴백하면 **경고가 조용히 사라진다.**
   *    `(spo2 ?? 100) < 95` 는 활력을 하나도 안 잰 환자를 "정상"으로 판정한다.
   */
  it('조건식 `?? 값)` 뒤에 비교가 오는 코드가 늘어나지 않는다', () => {
    const BASELINE = 201; // 2026-08-19 전 범위 실측(검토가 센 151 은 app 만 본 부분집합이었다)
    const n = countAll(/\?\?\s*[\w.'"-]+\s*\)\s*(?:>=|<=|>|<|===|!==)/g);
    expect(n, `미측정 폴백 후 비교하는 코드가 기준선(${BASELINE})을 넘었다: ${n}`).toBeLessThanOrEqual(BASELINE);
  });

  /** 🔴 날짜는 설정(`ui.dateStyle`)을 타야 병원 정책이 화면에 닿는다 */
  it('raw 날짜 포맷 직접 호출이 늘어나지 않는다', () => {
    // 2026-09-12 128 → 90: 정확 매핑 3모양(`toLocaleDateString('ko-KR')`·`toLocaleTimeString('ko-KR',{hour,minute[,hour12:false]})`)
    //   61곳/47파일을 정본 `kdate()` 로 옮겼다. 🔴 display/**(기기 화면 결정)·(homepage)·portal(다른 언어 축)은 손대지 않았다.
    // 2026-09-12 (2차) 90 → 75: 월/요일 이름·날짜시각 조합 다섯 모양(monthDay·monthDayWeekday·dateWeekday·datetimeShort·timeSec)을
    //   정본 모드로 흡수하고 37곳/31파일을 옮겼다. 남긴 것: 예약 슬롯의 Asia/Seoul 고정 2곳(시간대 정책 — 사유 주석) · 숫자 포맷 1.
    // 2026-09-13 (F1) 75 → 66: 로케일을 `'ko'` 로 적은 원시 호출(admin·components)을 정본으로 옮겼다. 🔴 이 가드는 **파일 단위**이고
    //   `toLocaleString(` 을 안 센다 — 호출 단위·`toLocaleString` 날짜 수신자는 `date-locale-literal-guard.spec.ts` 가 센다.
    // 2026-09-13 (F1+F2+F3 병합 재계측) 66 → 27: `(main)` 비-admin 53곳/43파일(F2) · portal 23곳/11파일(F3 — 포털 언어 축 정본
    //   `portal-date.ts` 로, 직원 `kdate` 가 아니다). 남은 27파일: 초 단위가 필요한 옵션 없는 `toLocaleString`(정본에 모드 없음 —
    //   서명·수납·동의 철회 시각) · 두 자리 연도 · display/**·(homepage)·print(축 결정) · 예약 슬롯 Asia/Seoul 고정.
    // 2026-09-13 (W6) 27 → 26: `VitalsTab` 차트 축의 두 자리 연도(`toLocaleDateString('ko',{year:'2-digit'…})`) → 정본 `dateShortYear`.
    const BASELINE = 26; // 실측 정확값(여유 없음)
    const n = FILES.filter((f) => /\.toLocale(Date|Time)String\(/.test(read(f))).length;
    expect(n, `날짜 정본을 쓰지 않는 파일이 기준선(${BASELINE})을 넘었다: ${n}`).toBeLessThanOrEqual(BASELINE);
  });

  /** 🔴 폴링 주기는 `ui.poll.*` 로 병원이 일괄 조정한다 */
  it('refetchInterval 숫자 리터럴이 늘어나지 않는다', () => {
    const BASELINE = 54; // 2026-08-19 실측 정확값(여유 없음)
    const n = FILES.filter((f) => /refetchInterval:\s*\d/.test(read(f))).length;
    expect(n, `폴링 리터럴 파일이 기준선(${BASELINE})을 넘었다: ${n}`).toBeLessThanOrEqual(BASELINE);
  });

  /**
   * 🔴 `window.print()` 직접 호출은 인쇄 감사·워터마크를 우회한다.
   *    정본은 `sanctionedPrint()` 또는 `/print/*` 경로다.
   */
  it('window.print() 직접 호출이 늘어나지 않는다', () => {
    const BASELINE = 8; // 2026-08-19 실측 정확값(여유 없음)
    const n = FILES.filter((f) => /window\.print\(\)/.test(read(f))).length;
    expect(n, `인쇄 정본을 우회하는 파일이 기준선(${BASELINE})을 넘었다: ${n}`).toBeLessThanOrEqual(BASELINE);
  });

  /**
   * 🔴 비율·완결률은 **분모와 함께** 낸다(§2.1·§3.3) — `xRate != null ? `${xRate}%` : '-'` 는 표본 부재를
   *    미측정(`-`)처럼 그리고 분모를 잃는다. 정본은 shared `ratioText`/`<Ratio>`(분모 0·미상 = 산출 불가).
   *    2026-08-19 실측 5건(손위생·QI 달성률·종료율·AI 비중·병상 점유율) 전량 수렴 → **0 동결**.
   */
  it('비율 라벨(rate/ratio/pct)을 null → `-`/`—` 로 접는 코드가 없다(0 동결)', () => {
    const re = /([Rr]ate|[Rr]atio|[Pp]ct)\w*\s*(!=|!==)\s*null\s*\?\s*`\$\{[^}]+\}%`\s*:\s*'(-|—|–)'/g;
    const n = countAll(re);
    expect(n, '비율을 `-` 로 접는 코드가 생겼다 — ratioText/<Ratio> 를 쓴다').toBe(0);
  });

  /**
   * 🔴 `산출 불가` 를 **화면마다 손으로 적으면** 규칙이 갈라진다 —
   *    "어휘 정본을 만든 것과 모든 소비처가 그것을 쓰는 것은 다른 일이다"(v4.4.0 교훈).
   *    정본은 shared `RATIO_UNAVAILABLE` / `ratioText` / `<Ratio>` 이고, 화면은 **분자·분모만** 넘긴다.
   *
   *    남아 있는 것들은 대부분 **비율이 아닌 값**(NEWS2 점수·평균 재원일·잔량·금액·해석문)이라
   *    `<Ratio>` 로 바꿀 수 없다 — 그래서 0 이 아니라 실측값으로 동결한다.
   *    비율인데 남은 것은 **서버가 분자 또는 분모를 주지 않는 것**들이다(BE 후속 과제).
   */
  it('자체 `산출 불가` 문자열이 늘어나지 않는다(기준선 동결)', () => {
    // 🔴 2026-08-20 실측 정확값(app+components · **주석 제외**). 여유를 두지 않는다 —
    //    여유를 두면 신규 위반을 흡수한다(이 파일 상단 교훈).
    // 2026-08-20(2) — BE 가 분자·분모를 노출해 9개 EP 소비 화면이 `<Ratio>` 로 수렴 → 73 → 65 로 내린다.
    // 🔴 2026-09-10 — 65 → 66. 늘어난 1건은 **비율 폴백을 화면이 지어낸 것이 아니라 번역 키**다:
    //    서버가 조립하던 QI 각주(`qiBasis`)를 회수하며 그 문장이 화면 소유가 됐고, 카탈로그 키는
    //    한국어 원문 그대로여야 하므로(정본 상수로 조립하면 고아 키 검사가 못 본다) 리터럴로 남는다.
    //    비율 문구 자체는 여전히 `<Ratio>`/`ratioText` 정본이 만든다 — 그 규약은 깨지지 않았다.
    // 🔴 2026-09-21(갈래 H · 지표 0폴백 축) — 66 → 72. **비율이 아닌 값 6건**이고, 전부
    //    "0 을 말하던 자리를 3상태로 바꾸며" 생겼다(줄어든 폴백의 반대쪽 값이지 새 자체구현이 아니다):
    //      · lab QC 5 — z-score 는 **비율이 아니다**(목표 SD 가 0/미설정이면 산출 자체가 불가).
    //        종전엔 z=0 이 찍혀 Westgard 가 `PASS` 를 기록했다(P17). 판정 배지·요약 칸·z 열·
    //        L-J 차트·장비 배지 다섯 자리가 같은 사실을 말한다.
    //      · crm RFM 세그먼트 평균 점수 1 — 평균이지 비율이 아니라 `<Ratio>` 로 바꿀 수 없다.
    //    🔴 여섯 개 다 `<T k="…" />` **카탈로그 키**다 — 65→66 때와 같은 이유로 한국어 원문
    //       리터럴이어야 한다(정본 상수로 조립하면 고아 키 검사가 못 본다).
    //    🔴 2026-09-23 T1 회수 — main(`02080139f`) 위에서 `countCode` 로 다시 잰 **정확값 72**(71 로 내리면
    //       "72 > 71" 로 실패하는 것을 확인했다). 베이스 QcTab 은 '산출 불가' 0 → 회수 후 5(비주석) · crm 1.
    // 🔴 2026-09-23 U3(전사 보존 D6) — 72 → 75. 세 자리 전부 `/admin/retention` 이고 **비율이 아니다**:
    //      · 보존 기간이 설정에 없으면 cutoff 를 낼 수 없다(`산출 불가(기간 없음)` 2자리 — 표 두 곳)
    //      · 설정값이 숫자가 아니면 일수를 낼 수 없다(`산출 불가(설정값이 숫자가 아님)` 1자리)
    //    기간이 **정해진 적 없다**는 사실을 0 일이나 빈칸으로 그리면 "오늘 이전은 다 지운다"로 읽힌다.
    //    셋 다 `<T k="…">` 카탈로그 키(legalhold)라 한국어 원문 리터럴이어야 한다 — 위 65→66 과 같은 이유.
    // 🔴 2026-09-27 V3b(앰비언트 정돈 초안 D2) — 75 → 76. `ConversationStreamPanel` 의 SOAP 초안 머리글 1자리.
    //      **비율이 아니다** — 'N발화 중 M발화에서 제안'(분모 병기)이라 `<Ratio>` 의 'M/N (x%)' 모양이 아니고,
    //      0발화일 때 '(산출 불가 · 발화 없음)' 로 말한다. i18n 키는 리터럴이어야 해서 `RATIO_UNAVAILABLE`
    //      상수를 끼울 수 없다(카탈로그가 키를 못 찾는다).
    const BASELINE = 76;
    const n = countCode(/산출 불가/g);
    expect(
      n,
      `화면이 '산출 불가'를 자체 구현한 지점이 기준선(${BASELINE})을 넘었다: ${n}. ` +
        'shared `RATIO_UNAVAILABLE`/`ratioText`/`<Ratio>` 를 쓴다(분자·분모만 넘기면 문구는 정본이 만든다).',
    ).toBeLessThanOrEqual(BASELINE);
  });

  /**
   * 🔴 **임상 비율은 분모와 함께** — 화면이 `Math.round((n / d) * 100)` 로 백분율을 직접 만들어
   *    그리면 ① 분모가 화면에서 사라지고 ② 분모 0 에서 `0%`(또는 `NaN%`)가 되어
   *    "안전"으로 읽힌다(분모 0이면 완결률은 100% 가 된다 — v4.4.0).
   *    정본은 `<Ratio numerator denominator />` / `ratioText` 다.
   *
   *    대상을 **좁힌다**(오탐이 나는 가드는 곧 무시된다):
   *      - 같은 줄에서 **계산하고 곧바로 백분율로 렌더**하는 것만(`}%` / `}<Unit>%`)
   *      - 진행률 바의 `style`·`width`·`calc()`·`clamp()` 는 CSS 값이라 제외(표시 수치가 아니다)
   */
  it('백분율을 인라인 계산해 그대로 그리는 지점이 늘어나지 않는다(분모가 사라진다)', () => {
    const BASELINE = 3; // 2026-08-20 실측 정확값(코드 자동매핑 진행률·검진 성비·접수 초/재진 비율)
    const CALC = /[\w.?![\]]+\s*\/\s*[\w.?![\]]+\s*\)\s*\*\s*100/;
    const RENDER = /\}\s*(<Unit>\s*%|%)/;
    const SKIP = /style=|width:|calc\(|clamp\(/;
    const hits: string[] = [];
    for (const f of FILES) {
      codeOf(f).split('\n').forEach((line, i) => {
        if (SKIP.test(line)) return;
        if (CALC.test(line) && RENDER.test(line)) hits.push(`${f}:${i + 1}`);
      });
    }
    expect(
      hits.length,
      `비율을 인라인 계산해 백분율만 그리는 지점이 기준선(${BASELINE})을 넘었다: ${hits.length}\n${hits.join('\n')}\n` +
        '→ `<Ratio numerator={n} denominator={N} />`(또는 shared `ratioText`)를 쓴다. 분모 0·미상이면 정본이 산출 불가를 그린다.',
    ).toBeLessThanOrEqual(BASELINE);
  });

  /**
   * 🔴 기준선이 **낡았는지도** 본다 — 고쳐서 숫자가 크게 내려갔는데 기준선이 그대로면
   *    그 사이에 새 위반이 들어와도 안 잡힌다(고친 만큼 여유가 생긴다).
   */
  it('기준선이 실측보다 크게 높지 않다(고친 만큼 내린다)', () => {
    const date = FILES.filter((f) => /\.toLocale(Date|Time)String\(/.test(read(f))).length;
    const poll = FILES.filter((f) => /refetchInterval:\s*\d/.test(read(f))).length;
    expect(26 - date, '날짜 위반이 줄었다 — 기준선을 내려라').toBeLessThanOrEqual(10);
    expect(54 - poll, '폴링 위반이 줄었다 — 기준선을 내려라').toBeLessThanOrEqual(10);
    // 🔴 '산출 불가' 자체 구현은 정본 수렴으로 계속 줄어야 한다 — 많이 줄면 기준선도 내린다
    expect(65 - countCode(/산출 불가/g), "'산출 불가' 자체 구현이 줄었다 — 기준선을 내려라").toBeLessThanOrEqual(5);
  });

  /**
   * 🔴 터치 규약은 라우트가 아니라 **행위** 기준(CLAUDE.md) — 쓰기(mutate) 버튼이 44px 미만이면
   *    tablet 밖에서도 위반이다. 종전 가드 2개는 파일 핀 고정이라 이 부류를 못 봤다
   *    (투약 확인 30px·수혈 시작 24px·간호기록 서명 20px 가 전부 초록으로 지나갔다 — 2026-09-03 실측).
   *    휴리스틱: `<button` 여는 태그 안에 `.mutate(` 가 있고 소형 크기 클래스
   *    (py-0.5/1/1.5·text-[10px]/[11px])인데 `min-h-[44px|48px]` 가 없는 것.
   *    화살표(`=>`) 는 태그 경계 판정 전에 치환한다(안 하면 onClick 에서 태그가 끊긴다).
   */
  it('쓰기(mutate) 버튼의 44px 미달이 늘어나지 않는다(행위 기준)', () => {
    let total = 0;
    for (const f of FILES) {
      const src = codeOf(f);
      let i = 0;
      while ((i = src.indexOf('<button', i)) !== -1) {
        const s = src.slice(i, i + 600).replace(/=>/g, '=@');
        const gt = s.indexOf('>');
        const tag = s.slice(0, gt === -1 ? 600 : gt);
        if (
          tag.includes('.mutate(') &&
          // 🔴 py-3 미만 전부 — 첫 버전이 py-0.5~1.5 만 보다가 재주입(py-2 text-xs ≈30px)을 통과시켰다.
          //    원래의 투약 확인 30px 이 딱 그 크기였다 — 잡으려던 결함이 휴리스틱을 지나가면 가드가 아니다.
          /py-(0\.5|1|1\.5|2|2\.5)(?![\d.])|text-\[10px\]|text-\[11px\]/.test(tag) &&
          !/min-h-\[4[48]px\]/.test(tag)
        ) total += 1;
        i += 7;
      }
    }
    // 🔴 2026-09-04 실측 328(4차 상환 14파일 77버튼 — 워크스테이션 5·간호스테이션·약국·격리강박·
    //    동의·암등록·원가·시뮬레이터·거버넌스·개원. 1차 599·2차 527·3차 406). 잔여는 화면 회수 때마다
    //    내린다(.catch 503→465 와 같은 점진 상환 경로).
    expect(total, '쓰기 버튼 44px 미달이 늘었다 — min-h-[44px](확정급은 48px) 관용구를 쓰라').toBeLessThanOrEqual(328);
    expect(total, '0이 되면 스캐너가 깨진 것일 수 있다 — 전수 해소가 확인되면 이 하한과 기준선을 함께 정리하라').toBeGreaterThan(0);
    expect(328 - total, '많이 줄었다 — 기준선을 내려라').toBeLessThanOrEqual(20);
  });

  /** 가드 자신이 헛돌지 않는지 — 대상 파일을 실제로 찾았는가 */
  it('가드가 화면 파일을 실제로 스캔한다(분모 확인)', () => {
    expect(FILES.length, '스캔 대상이 없으면 위 단언은 전부 무의미하다').toBeGreaterThan(500);
  });
});
