import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useUiLocaleStore } from '../../src/stores/ui-locale-store';
import { usePortalLocale, trOf } from '../../src/lib/i18n/portal-i18n';
import { EmptyState, Ratio } from '../../src/components/ui/display';
import { Data } from '../../src/components/ui/i18n-text';
import { EmptyState as PortalEmptyState } from '../../src/app/portal/_shared/index';
import fs from 'node:fs';
import path from 'node:path';

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTsx(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}
/** 🔴 주석을 먼저 걷는다 — 이 저장소는 주석이 문자열 검사에 걸려 가드가 엉뚱한 곳을 가리킨 적이 있다 */
const stripLineComments = (s: string) => s.replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '');

/**
 * 빈 상태·비율 부품이 **사실을 말하는가** — 2026-09-12.
 *
 * 🔴 두 가지가 동시에 틀려 있었다.
 *
 *  ① **서버가 만든 문장에 "번역 미등록"(`EN×`) 티를 달았다.** `EmptyState`/`Ratio` 는 문자열 prop 을
 *     카탈로그 키로 조회했는데, 거기로 `list.unavailableReason`·`report?.reason`·`zeroMeaning`
 *     같은 **서버 정직성 문구**가 들어왔다. 카탈로그에 있을 리 없으니 전부 미등록으로 판정돼
 *     "번역이 빠졌다"고 말했다 — 하필 그 문장들이 "왜 셀 수 없는지"를 말하려고 만든 것이었다.
 *     화면이 **자기가 아는 것에 대해 거짓말**을 한 자리다.
 *
 *  ② **환자 포털 `EmptyState` 는 번역 조회를 하나도 지나지 않았다.** 호출부가 `title` 만 번역해
 *     넘겼고 `description`·`actionLabel` 18건은 **생 한국어**로 en/zh/ja 환자에게 그대로 나갔다.
 *
 * 계약: **문자열 = 카탈로그 키**(조회 + 미등록 티) · **노드 = 그대로**(`<Data>` 로 감싼 서버 문장).
 */

const TIE = /[A-Z]{2}×/; // EN×/JA×/ZH× — "번역 미등록" 티

beforeEach(() => {
  useUiLocaleStore.setState({ locale: 'ko' });
  usePortalLocale.setState({ locale: 'ko' });
});
afterEach(() => cleanup());

describe('① 서버가 만든 문장에 거짓 티를 달지 않는다', () => {
  it('🔴 en — `<Data>` 로 넘긴 서버 사유에는 "번역 미등록" 티가 붙지 않는다', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const reason = '2026-08-01 이후 스윕 기록이 없습니다'; // 서버가 그때그때 만드는 문장
    const { container } = render(<EmptyState title="산출 불가" hint={<Data>{reason}</Data>} />);
    expect(container.textContent).toContain(reason);
    expect(container.querySelector('[title="번역 미등록 — 한국어 원문을 표시합니다"]')).toBeNull();
  });

  it('🔴 en — `Ratio` 의 서버 사유도 마찬가지다', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const note = '관측 3건 중 2건이 기간 밖입니다';
    const { container } = render(<Ratio numerator={null} denominator={0} unavailableHint={<Data>{note}</Data>} />);
    expect(container.textContent).toContain(note);
    expect(container.textContent).not.toMatch(TIE);
  });

  it('en — 반면 **카탈로그 키**(문자열)는 그대로 조회한다 — 미등록이면 티가 붙어야 한다', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { container } = render(<EmptyState title="이 문장은 카탈로그에 없는 화면 문구입니다" />);
    expect(container.textContent).toMatch(TIE); // 🔴 티를 없애는 변경이면 여기서 걸린다
  });

  it('ko — 티도 조회도 없다(종전 화면과 동일)', () => {
    const { container } = render(<EmptyState title="대상 환자가 없습니다." hint={<Data>{'서버 사유'}</Data>} />);
    expect(container.textContent).toContain('대상 환자가 없습니다.');
    expect(container.textContent).not.toMatch(TIE);
  });
});

describe('② 환자 포털 EmptyState 는 세 문자열 prop 을 전부 조회한다', () => {
  it('🔴 en — description·actionLabel 이 생 한국어로 나가지 않는다(미등록이면 티로 드러난다)', () => {
    usePortalLocale.setState({ locale: 'en' });
    const { container } = render(
      <PortalEmptyState title="검사 결과가 없습니다." description="검사 결과가 등록되면 이곳에서 확인하실 수 있습니다."
        actionLabel="예약하러 가기" onAction={() => {}} />,
    );
    // 조회를 지났다는 증거 = 번역됐거나(한글 사라짐) 미등록 티가 붙었거나 — **조용한 한국어는 아니다**
    for (const frag of ['검사 결과가 등록되면 이곳에서 확인하실 수 있습니다.', '예약하러 가기']) {
      const stillKo = (container.textContent ?? '').includes(frag);
      expect(stillKo && !TIE.test(container.textContent ?? ''),
        `"${frag}" 가 티도 번역도 없이 한국어로 나갔다`).toBe(false);
    }
  });

  it('🔴 en — 등재한 18문구는 실제로 번역돼 나온다(티도 한국어도 아니다)', () => {
    usePortalLocale.setState({ locale: 'en' });
    const { container } = render(
      <PortalEmptyState title="검사 결과가 없습니다." description="검사 결과가 등록되면 이곳에서 확인하실 수 있습니다."
        actionLabel="예약하러 가기" onAction={() => {}} />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/[가-힣]/);
    expect(text).not.toMatch(TIE);
    expect(text).toContain('No lab results');
    expect(text).toContain('Book an appointment');
  });

  it('🔴 포털 EmptyState 의 한국어 문자열 prop 은 전부 환자 축 카탈로그에 있다(0 동결)', () => {
    const missing: string[] = [];
    const root = path.resolve(__dirname, '../../src/app/portal');
    for (const file of walkTsx(root)) {
      const src = fs.readFileSync(file, 'utf-8');
      for (const m of src.matchAll(/<EmptyState\b/g)) {
        let j = m.index! + 1, depth = 0, q: string | null = null, end = -1;
        while (j < src.length) {
          const c = src[j];
          if (q) { if (c === '\\') { j += 2; continue; } if (c === q) q = null; }
          else if (c === '"' || c === "'" || c === '`') q = c;
          else if (c === '{') depth++;
          else if (c === '}') depth--;
          else if (c === '>' && depth === 0) { end = j; break; }
          j++;
        }
        if (end < 0) continue;
        for (const pm of src.slice(m.index!, end + 1).matchAll(/\b(title|description|actionLabel)="([^"]*)"/g)) {
          if (!/[가-힣]/.test(pm[2])) continue;
          if (trOf(pm[2], 'en').missing) missing.push(`${path.relative(root, file)}: ${pm[2]}`);
        }
      }
    }
    expect(missing, `환자 축 카탈로그에 없는 빈 상태 문구 ${missing.length}건 — 환자에게 EN× 티로 나간다:\n` + missing.join('\n')).toEqual([]);
  });

  it('ko — 종전 문안 그대로다', () => {
    const { container } = render(
      <PortalEmptyState title="검사 결과가 없습니다." description="검사 결과가 등록되면 이곳에서 확인하실 수 있습니다." />,
    );
    expect(container.textContent).toContain('검사 결과가 없습니다.');
    expect(container.textContent).toContain('검사 결과가 등록되면 이곳에서 확인하실 수 있습니다.');
    expect(container.textContent).not.toMatch(TIE);
  });
});

/**
 * ③ 🔴 **호출부 규칙** — 서버가 준 문장을 맨 문자열로 넘기면 ①이 되살아난다.
 *    부품만 고치고 호출부를 안 보면 "고쳤다"가 거짓이 된다(정본을 만든 것 ≠ 소비처가 쓰는 것).
 *    여는 태그를 중괄호 깊이로 잘라 **서버 접근자**가 든 prop 값을 찾고, 그 값이 `<Data>` 를
 *    지나는지 본다. 기준선 0 동결 — 새 화면이 같은 실수를 하면 여기서 걸린다.
 */
describe('③ 호출부 — 서버가 준 문장은 <Data> 로 넘긴다', () => {
  /** 서버 응답에서 오는 "왜 못 세는지" 문장들(실측으로 확인한 필드 이름) */
  const SERVER_FIELD = /\.(unavailableReason|zeroMeaning|reason|note)\b/;
  const PROPS = /\b(title|hint|unavailableHint|description|actionLabel)=\{/g;

  function openTagEnd(src: string, i: number): number {
    let j = i + 1, depth = 0, q: string | null = null;
    while (j < src.length) {
      const c = src[j];
      if (q) { if (c === '\\') { j += 2; continue; } if (c === q) q = null; }
      else if (c === '"' || c === "'" || c === '`') q = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) return j;
      j++;
    }
    return -1;
  }
  function propValue(tag: string, from: number): string {
    let j = from, depth = 0;
    while (j < tag.length) {
      if (tag[j] === '{') depth++;
      else if (tag[j] === '}') { depth--; if (depth === 0) return tag.slice(from, j + 1); }
      j++;
    }
    return tag.slice(from);
  }

  /** 같은 파일에 선언된 도우미 함수의 본문(중괄호 균형으로 자른다) */
  function bodyOf(src: string, name: string): string | null {
    const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(src);
    if (!m) return null;
    let i = src.indexOf('{', m.index);
    if (i < 0) return null;
    let depth = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
    }
    return null;
  }

  it('🔴 서버 사유를 번역 조회에 태우는 호출부가 없다(0 동결)', () => {
    const offenders: string[] = [];
    for (const file of walkTsx(path.resolve(__dirname, '../../src'))) {
      const src = stripLineComments(fs.readFileSync(file, 'utf-8'));
      for (const m of src.matchAll(/<(?:EmptyState|Ratio)\b/g)) {
        const end = openTagEnd(src, m.index!);
        if (end < 0) continue;
        const tag = src.slice(m.index!, end + 1);
        for (const pm of tag.matchAll(PROPS)) {
          const val = propValue(tag, pm.index! + pm[0].length - 1);
          const rel = path.relative(path.resolve(__dirname, '../../src'), file);
          /**
           * 🔴 **두 모양을 본다.** ① 태그 안에 서버 접근자가 그대로 있는 경우.
           *    ② 같은 파일 도우미 함수로 빼낸 경우 — 첫 판이 ①만 봐서 `sentinel` 의
           *    `axisUnavailableReason()` 재주입을 **통과시켰다**(재주입 역검증이 잡아냈다).
           *    다른 파일로 나간 도우미·훅은 여전히 사각지대다 — 여기서 보증하지 않는다.
           */
          if (SERVER_FIELD.test(val)) {
            if (!/<Data>/.test(val)) offenders.push(`${rel}  ${pm[1]}=${val.slice(0, 90)}`);
            continue;
          }
          for (const cm of val.matchAll(/\b([a-z][A-Za-z0-9_]*)\s*\(/g)) {
            const body = bodyOf(src, cm[1]);
            if (!body || !SERVER_FIELD.test(body)) continue;
            if (/<Data>/.test(body)) continue;
            offenders.push(`${rel}  ${pm[1]}={…${cm[1]}()…} — 도우미가 서버 문장을 그대로 돌려준다`);
          }
        }
      }
    }
    expect(
      offenders,
      `서버 문장을 카탈로그 키로 조회하는 자리 ${offenders.length}건 — \`<Data>\` 로 감싸세요\n` +
        '(그대로 두면 화면이 "번역 미등록"이라는 거짓을 말한다):\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('대조군 — 검사기가 실제로 태그를 읽는다(0 이 되면 통과가 무의미하다)', () => {
    let tags = 0;
    for (const file of walkTsx(path.resolve(__dirname, '../../src'))) {
      tags += [...fs.readFileSync(file, 'utf-8').matchAll(/<(?:EmptyState|Ratio)\b/g)].length;
    }
    expect(tags, '<EmptyState>/<Ratio> 를 하나도 못 찾았다').toBeGreaterThan(300);
  });
});
