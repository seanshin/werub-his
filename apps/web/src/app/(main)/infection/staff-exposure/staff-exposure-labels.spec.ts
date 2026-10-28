import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPOSURE_TYPES,
  EXPOSURE_TYPE_LABEL,
  FOLLOW_UP_BADGE,
  FOLLOW_UP_LABEL,
  FOLLOW_UP_STATUSES,
  exposureTypeLabel,
  followUpLabel,
  serologyToPayload,
  serologyView,
} from './staff-exposure-labels';

/**
 * 🔴 직원 노출 사고 화면 진실성 가드 — 2026-08-18.
 *
 * 이 화면이 저지르기 쉬운 세 가지 거짓말을 **재주입하면 반드시 실패**하도록 붙잡는다.
 *  ① 원환자 감염상태의 **미상을 음성으로** 표시 → 노출자가 "안전하다"고 읽고 PEP 시점을 놓친다.
 *  ② 목록 **0 건을 "사고 없음"** 으로 → 접수 경로가 막혀 있어도 초록으로 보인다(P17).
 *  ③ **조회 실패를 빈 목록으로** 삼킴 → 사고가 있는데 없는 것처럼 보인다.
 * 그리고 라벨 정본이 서버와 갈라지는 것(P12)도 파일을 직접 읽어 대조한다.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const API_CANON = join(HERE, '../../../../../../api/src/modules/infection-control/staff-exposure.ts');
const canonSrc = readFileSync(API_CANON, 'utf-8');
const pageSrc = readFileSync(join(HERE, 'page.tsx'), 'utf-8');
const formSrc = readFileSync(join(HERE, 'ReportForm.tsx'), 'utf-8');

/** 주석을 뺀 코드 줄만 본다 — 주석 속 "하지 말 것" 설명은 결함이 아니다 */
function codeOnly(src: string): string {
  return src
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}
const pageCode = codeOnly(pageSrc);
const formCode = codeOnly(formSrc);

describe('라벨 정본은 서버 하나 — 폴백이 서버와 갈라지면 실패', () => {
  it('노출 유형 코드·순서가 서버 STAFF_EXPOSURE_TYPES 와 같다', () => {
    const block = canonSrc.slice(
      canonSrc.indexOf('export const STAFF_EXPOSURE_TYPES'),
      canonSrc.indexOf('export type StaffExposureType'),
    );
    const codes = [...block.matchAll(/^\s*'([A-Z_]+)',/gm)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(0);
    expect([...EXPOSURE_TYPES]).toEqual(codes);
  });

  it('노출 유형 한글 폴백이 서버 라벨과 글자까지 같다', () => {
    const block = canonSrc.slice(canonSrc.indexOf('STAFF_EXPOSURE_TYPE_LABELS'));
    for (const code of EXPOSURE_TYPES) {
      const m = block.match(new RegExp(`${code}:\\s*'([^']+)'`));
      expect(m, `서버 라벨에서 ${code} 를 찾지 못했다`).toBeTruthy();
      expect(EXPOSURE_TYPE_LABEL[code]).toBe(m![1]);
    }
  });

  it('추적관찰 상태 어휘·라벨이 서버와 같다', () => {
    const block = canonSrc.slice(canonSrc.indexOf('STAFF_EXPOSURE_FOLLOW_UP_LABELS'));
    for (const code of FOLLOW_UP_STATUSES) {
      const m = block.match(new RegExp(`${code}:\\s*'([^']+)'`));
      expect(m, `서버 라벨에서 ${code} 를 찾지 못했다`).toBeTruthy();
      expect(FOLLOW_UP_LABEL[code]).toBe(m![1]);
      // 배지도 같은 문구를 쓴다(배지만 따로 드리프트하는 것을 막는다)
      expect(FOLLOW_UP_BADGE[code].label).toBe(m![1]);
    }
  });

  it('서버가 label 을 주면 그것을 우선한다(폴백은 응답이 없을 때만)', () => {
    expect(exposureTypeLabel('NEEDLESTICK', '서버라벨')).toBe('서버라벨');
    expect(exposureTypeLabel('NEEDLESTICK')).toBe('주사침 자상');
    expect(followUpLabel('OPEN')).toBe('접수(추적 미개시)');
    // 모르는 코드는 지어내지 않고 원문 그대로
    expect(exposureTypeLabel('BOGUS')).toBe('BOGUS');
  });
});

describe('🔴 3상 — 미상은 음성이 아니다', () => {
  it('UNKNOWN 은 "미상"이고, 음성의 글자도 색도 쓰지 않는다', () => {
    const unknown = serologyView('UNKNOWN');
    const negative = serologyView('NEGATIVE');

    expect(unknown.label).toBe('미상');
    // 🔴 결함 재주입(UNKNOWN 을 음성으로 접기)이면 아래가 깨진다
    expect(unknown.label).not.toBe(negative.label);
    expect(unknown.tone).not.toBe(negative.tone);
    expect(unknown.tone).not.toContain('emerald'); // 초록 = "안전하다"로 읽힌다
    expect(unknown.title).toContain('음성이 아닙니다');
  });

  it('양성은 위험색이고 PEP 판단을 지시한다', () => {
    const p = serologyView('POSITIVE');
    expect(p.label).toBe('양성');
    expect(p.tone).toContain('red');
    expect(p.title).toContain('PEP');
  });

  it('서버가 3상을 주지 않으면 화면이 추측하지 않는다', () => {
    expect(serologyView(undefined).label).toBe('확인 불가');
    expect(serologyView(undefined).label).not.toBe('음성');
  });

  it('🔴 신고 폼의 미상은 전송하지 않는다 — false 를 보내면 원장에 "음성"이 박힌다', () => {
    expect(serologyToPayload('UNKNOWN')).toBeUndefined();
    expect(serologyToPayload('UNKNOWN')).not.toBe(false);
    expect(serologyToPayload('NEGATIVE')).toBe(false);
    expect(serologyToPayload('POSITIVE')).toBe(true);
  });

  it('신고 폼의 기본값은 미상이다(음성으로 시작하지 않는다)', () => {
    const empty = formSrc.slice(formSrc.indexOf('const EMPTY'), formSrc.indexOf('const LABEL'));
    for (const k of ['sourceHbv', 'sourceHcv', 'sourceHiv']) {
      expect(empty).toMatch(new RegExp(`${k}:\\s*'UNKNOWN'`));
      expect(empty, `${k} 기본값이 음성이면 회귀`).not.toMatch(new RegExp(`${k}:\\s*'NEGATIVE'`));
    }
  });

  it('🔴 화면이 boolean 을 직접 3상으로 접지 않는다 — 판정 정본은 서버 하나', () => {
    for (const src of [pageCode, formCode]) {
      expect(src).not.toMatch(/source(Hbv|Hcv|Hiv)\s*===\s*(true|false)/);
      expect(src).not.toMatch(/source(Hbv|Hcv|Hiv)[^\n]*(\?\?|\|\|)\s*false/);
    }
    // 표시는 서버가 준 sourceStatus 만 읽는다
    expect(pageSrc).toContain('r.sourceStatus?.hbv');
  });
});

describe('🔴 0 건과 실패 — 다른 사실을 같은 화면으로 말하지 않는다', () => {
  it('빈 목록 문구는 서버 zeroMeaning 을 그대로 쓴다', () => {
    expect(pageSrc).toContain('list?.zeroMeaning');
    // 🔴 화면이 "사고가 없다"로 바꿔 말하면 회귀 — 미접수·미배선을 안전으로 읽게 만든다
    expect(pageCode).not.toMatch(/사고가\s*없|노출\s*없음|사고\s*없음/);
  });

  it('조회 실패를 빈 목록으로 삼키지 않는다', () => {
    expect(pageSrc).toContain('q.isError');
    expect(pageSrc).toContain('QueryErrorFallback');
    // 실패한 응답을 빈 배열로 갈아끼우는 폴백이 생기면 회귀
    expect(pageCode).not.toMatch(/exposures\s*(\?\?|\|\|)\s*\[\]/);
  });

  it('본인 이력을 셀 수 없는 경우는 0 이 아니라 "산출 불가"로 말한다', () => {
    expect(pageSrc).toContain('unavailableReason');
    expect(pageSrc).toContain('산출 불가');
    // totalCount 가 null 이면 건수를 아예 표시하지 않는다(0 으로 접지 않는다)
    expect(pageSrc).toContain('list.totalCount != null');
  });

  it('잘랐으면 잘랐다고 말한다', () => {
    expect(pageSrc).toContain('list.truncated');
  });
});

describe('표현 규약', () => {
  it('상태 배지는 StatusBadge 로만 — 로컬 배지 컴포넌트를 새로 만들지 않는다', () => {
    expect(pageSrc).toContain('<StatusBadge status={r.followUpStatus} config={FOLLOW_UP_BADGE} />');
  });

  it('날짜는 KDate 로 — raw toLocaleString 을 쓰지 않는다', () => {
    expect(pageSrc).toContain('<KDate');
    expect(pageCode).not.toContain('toLocaleDateString');
    expect(pageCode).not.toContain('toLocaleString');
  });

  it('종결되지 않은 사고의 종결 시각은 "-" 가 아니라 "아직 없음"이다', () => {
    expect(pageSrc).toMatch(/value=\{r\.closedAt\}[^\n]*unknown="PENDING"/);
  });

  it('🔴 nav 숨김을 권한 회수로 말하지 않는다(실제 차단은 서버)', () => {
    expect(pageSrc).toContain('staff:exposure:manage');
    expect(pageSrc).toMatch(/권한 회수가 아니다|서버\(RolesGuard\)/);
  });
});
