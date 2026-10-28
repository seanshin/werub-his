import { describe, it, expect } from 'vitest';
import { stripComments, stripI18nKeys, koFragments, koExprFragments } from '../../../../scripts/i18n-unwired-scan.mjs';

/**
 * 🔴 `scripts/i18n-unwired-scan.mjs` 는 **여러 가드의 계측 정본**이다
 * (i18n-exclusion-vs-gap · 각 라운드의 화면별 잔여 기준선).
 * 이 토크나이저가 어긋나면 "기준선이 초록"이 "그 화면이 배선됐다"를 뜻하지 않게 된다.
 *
 * TSX 에서 `/` 는 네 가지다 — 나눗셈 · 정규식 · JSX 닫는 태그 `</div>` · JSX 자기닫기 `/>`.
 * 직전 문자만 보고 정규식이라 판정하면 뒤 셋이 전부 정규식이 되고, 오탐 하나가 문자열 모드를 열어
 * **파일 끝까지** 삼킨다(정본 `docs/01-plan/features/ui-locale-i18n.plan.md` §11 — 실제로 그랬다).
 *
 * 아래는 전부 이 저장소의 **실제 소스에서 나온 형태**다. 기준선을 늘리지 말고 여기를 지켜라.
 */
const LEAK = '주석안한국어문구';
/**
 * 🔴 주석을 **같은 줄 끝**에 둔다. 다음 줄에 두면 "문자열은 줄을 넘지 못한다" 규칙이 먼저 막아서
 * 다른 이유로 통과한다 — 실제로 재주입에서 ①②가 그렇게 통과했다(2026-09-09).
 * 한 가드가 한 결함을 겨누게 하려면 픽스처가 그 결함의 경로를 실제로 지나야 한다.
 */
const wrap = (body: string) => `const A = () => {\n${body} // ${LEAK}\n  return null;\n};\n`;

describe('🔴 i18n 스캐너 토크나이저 — 주석이 코드로 남지 않는다', () => {
  it('JSX 닫는 태그 `</span>` 뒤에 슬래시가 든 키가 와도 새지 않는다 (orders/page.tsx:511)', () => {
    const src = wrap(`  const el = <span>⚠️</span>; const t = <T k="DUR/CDSS만" />;`);
    expect(stripComments(src)).not.toContain(LEAK);
  });

  it('JSX 자기닫기 `{expr} />` 뒤에 슬래시가 든 키가 와도 새지 않는다 (safety/page.tsx:605)', () => {
    const src = wrap(`  const t = <T k={label} />; const u = <T k=", 두 가지 식별자/바코드/팔찌)" />;`);
    expect(stripComments(src)).not.toContain(LEAK);
  });

  it('JSX 본문 `{a} / {b}` 뒤에 템플릿이 와도 새지 않는다 (crm/campaigns/[id]:109)', () => {
    const src = wrap('  const el = <p>{a} / {b} {c ? `/ ${d.name}` : \'\'}</p>;');
    expect(stripComments(src)).not.toContain(LEAK);
  });

  it('템플릿 보간 `${...}` 안의 주석은 제거된다 (admin/rbac:219)', () => {
    const src = 'const c = `h-6 ${\n  // ' + LEAK + '\n  x ? "a" : "b"\n}`;\n';
    expect(stripComments(src)).not.toContain(LEAK);
  });

  it('정규식 리터럴 안의 따옴표가 문자열을 열지 않는다 (§11 원 사례 · workstation/consent:546)', () => {
    const src = wrap(`  const o = origin.replace(/^https?:\\/\\//, '');`);
    expect(stripComments(src)).not.toContain(LEAK);
  });

  it('닫히지 않은 따옴표는 줄 끝에서 되돌아온다 — 오탐이 파일 전체를 삼키지 않는다', () => {
    // 🔴 이 축만은 주석이 **다음 줄**에 있어야 뜻이 산다(같은 줄이면 그 문자열 안이라 남는 게 맞다)
    const src = `const A = () => {\n  const s = "열린 채 줄 끝;\n  // ${LEAK}\n  return null;\n};\n`;
    expect(stripComments(src)).not.toContain(LEAK);
  });

  it('🔴 대조군 — 진짜 주석은 실제로 제거되고, 보이는 텍스트는 남는다(검사기가 무력하지 않다)', () => {
    const src = wrap(`  const el = <p>보이는 문구</p>;`);
    const out = stripComments(src);
    expect(out, '주석이 제거되지 않았다').not.toContain(LEAK);
    expect(out, '보이는 JSX 텍스트가 사라졌다 — 이러면 잔여 계측이 0 으로 위장된다').toContain('보이는 문구');
  });
});

/**
 * 🔴 (2026-09-11 §12-H) 계측 사각지대 3종 — 전부 §12-B 라운드에서 실제로 드러났다.
 *   ① `<T className="…" k="…">` — 속성 순서가 다르면 키를 못 벗겨 **배선한 원문이 잔여로** 남았다
 *   ② `<Tf k>`·`tfAttr('…')` — 보간 키를 몰라 **보간으로 옮기면 ko 가 올랐다**(배선할수록 나빠 보이는 계측)
 *   ③ JSX **식 옆** 텍스트 — `<p>표본 {n}개는 …</p>` 를 한 글자도 세지 않았다(`koExpr` 로 따로 센다)
 */
const ko = (src: string) => [...koFragments(stripI18nKeys(src))];
const koExpr = (src: string) => [...koExprFragments(stripI18nKeys(src))];

describe('🔴 i18n 스캐너 — 배선 부품 인식 · 식 옆 텍스트', () => {
  it('① 속성이 먼저 와도 <T> 키를 벗긴다', () => {
    expect(ko(`<T className="text-xs" k="배선된 문구" />`)).toEqual([]);
    expect(ko(`<T className={cls} k={open ? '열기' : '닫기'} />`)).toEqual([]);
  });

  it('② 보간 부품(<Tf k> · tfAttr) 키를 벗긴다 — 보간으로 옮긴 문장이 잔여로 남지 않는다', () => {
    expect(ko(`<Tf k="{전체}건 중 {표시}건 표시" params={{ 전체: a, 표시: b }} />`)).toEqual([]);
    expect(ko(`toast.success(tfAttr('책임자 {명}명에게 발송', { 명: n }))`)).toEqual([]);
    expect(ko(`const x = tAttrG('별칭 훅 문구')`)).toEqual([]);
  });

  it('③ 식 옆 JSX 텍스트를 koExpr 로 센다 — ko(종전 정의)는 바뀌지 않는다', () => {
    const src = `const A = () => <p>표본 {n}개는 산출 불가</p>;`;
    expect(ko(src), '종전 ko 정의가 바뀌었다 — 기준선 13종이 걸려 있다').toEqual([]);
    expect(koExpr(src).sort()).toEqual(['개는 산출 불가', '표본']);
  });

  it('🔴 코드 속 한글(정규식 리터럴·문장)은 식 옆 텍스트가 아니다', () => {
    // 🔴 코드가 **닫힌 블록 `}` 뒤·여는 `{` 앞**에 있어야 이 규칙의 경로를 지난다(booking/page.tsx 실제 형태).
    //    첫 픽스처는 함수 여는 `{` 바로 뒤라 규칙이 애초에 매칭하지 않아, 필터를 지워도 통과했다(재주입이 잡음).
    const src = `function f(msg) {\n  if (a) { x(); }\n  if (/주차/.test(msg)) { return 1; }\n}`;
    expect(koExpr(src)).toEqual([]);
  });

  it('🔴 대조군 — HTML 엔티티의 세미콜론은 코드 표지가 아니다(텍스트로 센다)', () => {
    expect(koExpr(`<span>{name}님 &middot;</span>`)).toEqual(['님 &middot;']);
  });

  it('🔴 노드 자리표시자 params 사이의 객체 키(`, 나:`)는 텍스트가 아니다 — 대조군: `, 나이 미상` 은 센다', () => {
    expect(ko(`<Tf k="{가}와 {나}" params={{ 가: <b>x</b>, 나: <b>y</b> }} />`)).toEqual([]);
    expect(ko(`<span>{name}</span><span>, 나이 미상</span>`)).toEqual([', 나이 미상']);
  });

  it('대조군 — `>…<` 조각은 ko 에만 있고 koExpr 에 이중으로 세지 않는다', () => {
    const src = `<p>그냥 문구</p>`;
    expect(ko(src)).toEqual(['그냥 문구']);
    expect(koExpr(src)).toEqual([]);
  });
});
