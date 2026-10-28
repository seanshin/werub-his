import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 지정 처방의 승인 토큰의 **전송 경로** 계약 — 2026-08-03.
 *
 * 🔴 여기서 지키는 것: 토큰은 `x-prescriber-step-up-token` **헤더**로만 간다.
 *    서버 컨트롤러는 `@Headers('x-prescriber-step-up-token')` 만 읽으므로, body 에 실으면
 *    토큰이 서버에 닿지 않아 `PRESCRIBER_AUTH_REQUIRED` 로 거부된다.
 *    화면상으로는 "폰 승인은 났는데 저장만 안 되는" 형태라 원인이 보이지 않는다 —
 *    실제로 이 형태로 배포돼 비처방 역할의 처방 입력 경로 전부가 죽어 있었다.
 *
 * 그래서 전송은 `usePrescriberDelegate().authorize()` 한 곳에 가둔다. 이 테스트는
 * 호출부가 그 경로를 우회해 body 로 되돌아가지 않는지를 소스에서 감시한다.
 */
const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((p) => ({ path: p, text: readFileSync(p, 'utf-8') }));
const rel = (p: string) => p.slice(SRC.length + 1);

const DELEGATE_COMPONENT = 'components/prescription/PrescriberDelegate.tsx';

/**
 * 호출 인자 전체를 괄호 균형으로 떠낸다 — 정규식은 중첩 객체(`...(x ? { … } : {})`)의
 * `})` 에서 조기 종료돼 뒤따르는 인자를 놓친다(테스트가 통과해야 할 코드를 실패로 판정했다).
 */
function callArgsOf(src: string, callee: string): string[] {
  const out: string[] = [];
  for (let i = src.indexOf(callee); i !== -1; i = src.indexOf(callee, i + 1)) {
    let depth = 0;
    const start = i + callee.length - 1; // '(' 위치
    for (let j = start; j < src.length; j += 1) {
      const c = src[j];
      if (c === '(' || c === '{' || c === '[') depth += 1;
      else if (c === ')' || c === '}' || c === ']') {
        depth -= 1;
        if (depth === 0) { out.push(src.slice(start + 1, j)); break; }
      }
    }
  }
  return out;
}

describe('지정 처방의 승인 토큰 전송 계약', () => {
  it('토큰을 요청 body 에 싣는 호출부가 없다 (헤더 전용)', () => {
    // `payload.prescriberStepUpToken = …` / `{ prescriberStepUpToken: … }` 형태를 잡는다.
    const offenders = FILES
      .filter((f) => rel(f.path) !== DELEGATE_COMPONENT)
      .filter((f) => /prescriberStepUpToken\s*[:=][^=]/.test(f.text))
      .map((f) => rel(f.path));
    expect(offenders).toEqual([]);
  });

  it('헤더 이름은 공용 부품 한 곳에서만 정의된다', () => {
    const definers = FILES
      .filter((f) => f.text.includes("'x-prescriber-step-up-token'"))
      .map((f) => rel(f.path));
    expect(definers).toEqual([DELEGATE_COMPONENT]);
  });

  it('승인 토큰은 authorize() 가 만든 headers 로만 전달된다', () => {
    const delegate = FILES.find((f) => rel(f.path) === DELEGATE_COMPONENT)!;
    expect(delegate.text).toMatch(/export function prescriberAuthHeaders/);
    // authorize 는 헤더를 만들어 돌려주고, 승인 실패 시 null 로 저장을 막는다
    expect(delegate.text).toMatch(/headers:\s*prescriberAuthHeaders\(token\)/);
    expect(delegate.text).toMatch(/if\s*\(!token\)\s*return null/);
  });

  it('위임 훅을 쓰는 화면은 전부 authorize() 를 거친다', () => {
    const consumers = FILES.filter(
      (f) => rel(f.path) !== DELEGATE_COMPONENT && f.text.includes('usePrescriberDelegate('),
    );
    expect(consumers.length).toBeGreaterThan(0);
    const bypassing = consumers.filter((f) => !f.text.includes('delegate.authorize(')).map((f) => rel(f.path));
    expect(bypassing).toEqual([]);
  });
});

describe('차트 진료화면 역할 게이팅', () => {
  const chart = FILES.find((f) => rel(f.path) === join('app', '(main)', 'patients', '[id]', 'encounter', 'new', 'page.tsx'))!;

  it('차트도 공용 위임 부품을 쓴다 (자체 구현 금지)', () => {
    expect(chart).toBeDefined();
    expect(chart.text).toMatch(/usePrescriberDelegate\(encounterId\)/);
    expect(chart.text).toMatch(/<PrescriberPicker/);
  });

  it('처방 저장 경로가 전부 승인 헤더를 동봉한다', () => {
    // 저장 호출 = addPrescription.mutateAsync — 매 호출에 headers 가 붙어야 한다.
    // 하나라도 빠지면 그 경로만 조용히 403 이 된다(종전 결함의 형태).
    const calls = callArgsOf(chart.text, 'addPrescription.mutateAsync(');
    expect(calls.length).toBeGreaterThanOrEqual(5);
    const missing = calls.filter((arg) => !arg.includes('headers:'));
    expect(missing.map((arg) => arg.slice(0, 100))).toEqual([]);
  });

  it('의사 전용 경로(복사·사전처방)는 비처방 역할에게 감춘다', () => {
    // 서버가 DOCTOR/ADMIN 전용으로 막는 버튼 — 띄워두면 누르는 순간 403 이다
    expect(chart.text).toMatch(/!delegate\.info\?\.delegationRequired\s*&&[\s\S]{0,200}CopyPrescriptionButton/);
  });
});
