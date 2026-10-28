import React from 'react';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { renderServerMessageKo, serverMsg, type ServerMessage } from '@hospital-run/shared';
import { ServerText, useServerTextAttr } from '../../src/components/ui/server-text';
import { useUiLocaleStore } from '../../src/stores/ui-locale-store';

/**
 * 🔴 서버 표시 문장 렌더 — `<ServerText msg>` (2026-09-15 I1 · 배치 1 go-live).
 *
 * 종전 `/admin/go-live` 는 서버가 조립한 `detail` 문자열(`입력 3 / 필수 13 · 행 없음 …`)을 그대로 그려
 * 영어 화면에서도 한국어였다. 이제 서버가 `detailMsg { k, params }` 를 주고 이 부품이 `<Tf>` 로 조립한다.
 *
 * 지키는 사실:
 *   ① en — go-live 가 실제로 내려보내는 모양의 문장이 **한국어 0 · EN× 0** 으로 그려진다(조각 `{k}` 도 번역).
 *   ② ko — 서버의 종전 `detail`(= `renderServerMessageKo`)과 **글자 단위로 같다**(한국어 화면 불변).
 *   ③ 대조군 — msg 가 없는 구 응답은 fallback 원문을 `<Data>` 로(거짓 EN× 없이) 그린다 / 미등재 키는 EN× 로 드러난다.
 *   ④ 화면 배선 — go-live 페이지의 사유 두 곳·준비율 근거가 `<ServerText msg=…>` 를 지난다(원문 `{it.detail}` 로 되돌리면 실패).
 *   ⑤ 배치 2(I2) — opening 파생 사유·주기 라벨, `/admin/codes` 안내·행 변경·자동 매핑 사유가 같은 부품을 지난다 ·
 *      속성·토스트 자리 `useServerTextAttr` 도 같은 규칙(en 한국어 0 · ko 동일).
 */

// go-live.service.ts 가 내려보내는 실제 모양(키는 서버 코드와 글자 하나까지 같다 — API 가드가 소스에서 대조)
const SAMPLES: ServerMessage[] = [
  serverMsg('입력 {입력} / 필수 {필수} · 행 없음 {행없음수}({행없음키}) — 판정은 DB 행 실재(기본값은 설정이 아니다) · 발급 차단은 identity.unsetIssuance 결정 뒤', { 입력: 3, 필수: 13, 행없음수: 10, 행없음키: 'hospital.code, hospital.name' }),
  serverMsg('종별 {종별}({코드}) — 종별가산·의료급여 정액·수가 단가 열이 이 값을 따릅니다. 개설 허가와 일치하는지는 사람이 확인합니다.', { 종별: { k: '종합병원' }, 코드: 'GENERAL' }),
  serverMsg('현재 {현재} (개시 목표 {목표})', { 현재: { k: '미설정' }, 목표: 'false' }),
  serverMsg('필수 {필수}건 중 준비 {준비}건(시스템 실검증 {실검증} · 담당자 자가신고 {자가신고})', { 필수: 20, 준비: 9, 실검증: 6, 자가신고: 3 }),
  serverMsg('🔴 ENCRYPTION_KEY 가 all-zeros(개발 플레이스홀더) — 실 키로 로테이션 + 기존 암호문 재암호화 필요'),
  serverMsg('{key}={value}', { key: 'hira.mode', value: 'REAL' }),
  // 배치 2 — opening.service.ts · code-master/* 가 내려보내는 실제 모양
  serverMsg('{head} · {tail}', {
    head: serverMsg('{head} · {tail}', { head: serverMsg('위원 {위원}명 / 정족수 {정족수}', { 위원: 3, 정족수: 5 }), tail: serverMsg('실제 임명 {임명}명', { 임명: 2 }) }),
    tail: serverMsg('⚠ 같은 이름의 위원회가 따로 있다(코드 없음 · 위원 {위원}명)', { 위원: 4 }),
  }),
  serverMsg('결정됨 · {집행}', { 집행: { k: '결정·반영대기' } }),
  serverMsg('{연}년 {분기}분기', { 연: 2026, 분기: 3 }),
  serverMsg('명칭: {이전} → {이후}', { 이전: 'Old', 이후: 'New' }),
  serverMsg('🔴 전체 {전체}건 중 {시작}–{끝}건입니다 — 다음 장이 있습니다(이대로 제출하면 일부만 제출됩니다).', { 전체: '166,744', 시작: '1', 끝: '20,000' }),
  serverMsg('자동 매핑을 수행하지 못했습니다: {오류}', { 오류: 'ECONNREFUSED' }),
];

beforeEach(() => useUiLocaleStore.setState({ locale: 'ko' }));
afterEach(() => cleanup());

describe('<ServerText> — 서버 문장을 카탈로그로 조립한다', () => {
  it('① en — 한국어 0 · EN× 0(조각까지 번역)', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    for (const m of SAMPLES) {
      const { container } = render(<p><ServerText msg={m} /></p>);
      expect(container.textContent, `한국어가 남았다: ${m.k}`).not.toMatch(/[가-힣]/);
      expect(container.textContent, `미등재 티: ${m.k}`).not.toMatch(/EN×/);
      cleanup();
    }
  });

  it('① en — 값은 그대로, 조각은 번역문으로', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { container } = render(<ServerText msg={SAMPLES[1]} />);
    expect(container.textContent).toContain('GENERAL');
    expect(container.textContent).not.toContain('종합병원');
  });

  it('② ko — 서버의 종전 detail 과 글자 단위로 같다', () => {
    for (const m of SAMPLES) {
      const { container } = render(<ServerText msg={m} />);
      expect(container.textContent).toBe(renderServerMessageKo(m));
      cleanup();
    }
  });

  it('② 중첩 문장도 조립한다(재귀)', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const nested = serverMsg('현재 {현재} (개시 목표 {목표})', { 현재: serverMsg('현재 {값}', { 값: 'BLOCK' }), 목표: 'BLOCK' });
    const { container } = render(<ServerText msg={nested} />);
    expect(container.textContent).not.toMatch(/[가-힣]|EN×/);
    expect(container.textContent).toContain('BLOCK');
  });

  it('③ 대조군 — msg 가 없으면 fallback 원문을 티 없이(서버 데이터로) 그린다', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { container } = render(<ServerText msg={null} fallback="입력 3 / 필수 13" />);
    expect(container.textContent).toBe('입력 3 / 필수 13');
    expect(container.textContent).not.toMatch(/EN×/);
    cleanup();
    const empty = render(<ServerText msg={undefined} fallback={null} />);
    expect(empty.container.textContent).toBe('');
  });

  it('③ 대조군 — 미등재 키는 EN× 로 드러난다(부품이 무엇이든 통과시키지 않는다)', () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { container } = render(<ServerText msg={serverMsg('어느 카탈로그에도 없는 서버 문장 {값}', { 값: 1 })} />);
    expect(container.textContent).toMatch(/EN×/);
  });
});

describe('④ go-live 화면 배선', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const src = readFileSync(join(ROOT, 'apps/web/src/app/(main)/admin/go-live/page.tsx'), 'utf-8');

  it('사유 두 곳·준비율 근거가 <ServerText msg> 를 지난다', () => {
    expect(src.match(/<ServerText msg=\{it\.detailMsg\} fallback=\{it\.detail\} \/>/g)?.length).toBe(1);
    expect(src.match(/<ServerText msg=\{item\.detailMsg\} fallback=\{item\.detail\} \/>/g)?.length).toBe(1);
    expect(src).toMatch(/<ServerText msg=\{r\.readiness\.basisMsg\} fallback=\{r\.readiness\.basis\} \/>/);
  });

  it('🔴 서버 문자열을 직접 그리는 자리가 남지 않았다', () => {
    expect(src).not.toMatch(/\{it\.detail\}<|· \{it\.detail\}|<span>\{item\.detail\}<\/span>|\{r\.readiness\?\.basis \?\?/);
  });
});

describe('⑤ 배치 2 — 속성·토스트 자리와 화면 배선', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const read = (rel: string) => readFileSync(join(ROOT, 'apps/web/src/app/(main)/admin', rel), 'utf-8');

  function Probe({ msg, fallback }: { msg?: ServerMessage | null; fallback?: string | null }) {
    const attr = useServerTextAttr();
    return <span title={attr(msg, fallback)} />;
  }

  it('useServerTextAttr — en 한국어 0(중첩·조각 포함) · ko 는 서버 파생 문자열과 같다 · msg 없으면 fallback', () => {
    for (const m of SAMPLES) {
      useUiLocaleStore.setState({ locale: 'en' });
      const en = render(<Probe msg={m} />);
      expect(en.container.querySelector('span')!.getAttribute('title'), m.k).not.toMatch(/[가-힣]/);
      cleanup();
      useUiLocaleStore.setState({ locale: 'ko' });
      const ko = render(<Probe msg={m} />);
      expect(ko.container.querySelector('span')!.getAttribute('title')).toBe(renderServerMessageKo(m));
      cleanup();
    }
    const fb = render(<Probe msg={null} fallback="서버 원문" />);
    expect(fb.container.querySelector('span')!.getAttribute('title')).toBe('서버 원문');
  });

  it('opening — 파생 사유·주기 라벨 두 곳이 <ServerText msg> 를 지난다', () => {
    const src = read('opening/page.tsx');
    expect(src.match(/<ServerText msg=\{t\.derived\.detailMsg\} fallback=\{t\.derived\.detail\} \/>/g)?.length).toBe(1);
    expect(src.match(/<ServerText msg=\{r\.periodLabelMsg\} fallback=\{r\.periodLabel\} \/>/g)?.length).toBe(2);
    // 🔴 서버 문자열을 직접 그리던 자리가 남지 않았다
    expect(src).not.toMatch(/`: \$\{t\.derived\.detail\}`|\{r\.periodLabel\} <T/);
  });

  it('codes — 안내(notes)·행 변경/오류·분류 없음·동의어 경고·자동 매핑 사유가 서버 문장 부품을 지난다', () => {
    const imp = read('codes/code-import-panel.tsx');
    expect(imp).toMatch(/<ServerText msg=\{preview\.notesMsg\?\.\[i\]\} fallback=\{n\} \/>/);
    expect(imp).toMatch(/<ServerText msg=\{r\.errorMsg\} fallback=\{r\.error\} \/>/);
    expect(imp).toMatch(/<ServerText msg=\{r\.changesMsg\?\.\[ci\]\} fallback=\{c\} \/>/);
    expect(imp).not.toMatch(/\{r\.error \?\? r\.changes\?\.join/);
    expect(read('codes/category-derive-panel.tsx')).toMatch(/<ServerText msg=\{rep\.notesMsg\?\.\[i\]\} fallback=\{n\} \/>/);
    const maint = read('codes/code-maintenance-panel.tsx');
    expect(maint).toMatch(/<ServerText msg=\{report\.notesMsg\?\.\[i\]\} fallback=\{n\} \/>/);
    expect(maint).toMatch(/<ServerText msg=\{lastExport\.notesMsg\?\.\[i\]\} fallback=\{n\} \/>/);
    // 🔴 안내 문자열을 그대로 그리는 자리가 남지 않았다
    for (const src of [imp, read('codes/category-derive-panel.tsx'), maint]) expect(src).not.toMatch(/>\{n\}<\/p>/);
    expect(read('codes/page.tsx')).toMatch(/serverAttr\(catData\?\.data\?\.noteMsg, catData\?\.data\?\.note\)/);
    expect(read('codes/code-synonym-panel.tsx')).toMatch(/toast\.error\(serverAttr\(r\.warningMsg, r\.warning\)\)/);
    expect(read('codes/auto-mapping-dashboard.tsx')).toMatch(/<ServerText msg=\{r\.reasonMsg\} fallback=\{r\.reason\} \/>/);
  });
});
