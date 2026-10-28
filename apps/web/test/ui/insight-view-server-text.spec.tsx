import React from 'react';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { renderServerMessageKo, serverMsg, type ServerMessage } from '@hospital-run/shared';
import { useUiLocaleStore } from '../../src/stores/ui-locale-store';

const get = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a) } }));

import { InsightView } from '../../src/components/record-timeline/InsightView';

/**
 * 🔴 의미찾기(InsightView) — 서버 문장 배치 3(2026-09-15 I3).
 *
 * 서버 `record-insights.ts` 가 `titleMsg`·`hintMsg`·`noteMsg`·`labelMsg`·`detailMsg` 를 주고 이 화면이 `<ServerText>` 로 조립한다.
 * 화면 크롬(로딩·실패·안내·'외 N건')도 카탈로그 키다 — 종전엔 부품 전체가 배선 0 이라 영어 화면에서도 한국어였다.
 *
 * 지키는 사실:
 *   ① en — 서버가 실제로 내려보내는 모양(키는 서버 코드와 글자 하나까지 같다 — API 가드 batch3 가 소스에서 대조)이면
 *      값이 ASCII 인 한 **한국어 0 · EN× 0**.
 *   ② ko — 종전 문자열 필드와 글자 단위로 같다(한국어 화면 불변).
 *   ③ 대조군 — `*Msg` 없는 항목(ATTENTION 의 이슈 문구)은 서버 원문을 **티 없이** 그린다(거짓 EN× 없음).
 *   ④ 소스 배선 — 원문 `{g.title}`·`{it.label}`·`{it.detail}` 직접 렌더로 되돌리면 실패.
 */

const m = (msg: ServerMessage) => ({ msg, text: renderServerMessageKo(msg) });
const title = m({ k: '약물 변화' });
const hint = m({ k: '시작·용량 변경·투약기간 종료만 남겼습니다 — 같은 약의 반복 처방은 변화가 아닙니다.' });
const note = m(serverMsg('약품 {종수}종 · 변화 {건수}건', { 종수: 2, 건수: 9 }));
const label = m(serverMsg('{약품} 용량 변경', { 약품: { k: '약품' } }));
const detail = m(serverMsg('{from} → {to} ({date})', { from: { k: '기재 없음' }, to: '1000mg', date: '2026-06-01' }));
const endDetail = m(serverMsg('{처방일} 처방 {일수}일분 · {종료일} 이후 재처방 없음', { 처방일: '2026-06-01', 일수: 30, 종료일: '2026-07-01' }));

const item = (i: number) => ({
  type: 'PRESCRIPTION', id: `r${i}`, at: '2026-06-01T00:00:00Z', level: 'WARN',
  label: label.text, labelMsg: label.msg, ...(i % 2 ? { detail: detail.text, detailMsg: detail.msg } : { detail: endDetail.text, detailMsg: endDetail.msg }),
});
const GROUPS = [
  {
    key: 'MEDICATION', level: 'INFO',
    title: title.text, titleMsg: title.msg, hint: hint.text, hintMsg: hint.msg, note: note.text, noteMsg: note.msg,
    items: Array.from({ length: 9 }, (_, i) => item(i)),
  },
  {
    key: 'ATTENTION', level: 'ALERT',
    ...(() => { const t = m({ k: '확인 필요' }); const h = m({ k: '위급 역치 도달·참고범위 이탈·미확인 위급값을 한곳에 모았습니다.' }); const n = m(serverMsg('위급 {건수}건 포함', { 건수: 1 })); return { title: t.text, titleMsg: t.msg, hint: h.text, hintMsg: h.msg, note: n.text, noteMsg: n.msg }; })(),
    items: [{ type: 'LAB', id: 'l1', at: '2026-07-10T00:00:00Z', level: 'ALERT', label: 'K 6.8 mmol/L', detail: 'critical threshold' }],
  },
];

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: { groups: GROUPS, itemCount: 42 } });
  useUiLocaleStore.setState({ locale: 'ko' });
});
afterEach(() => cleanup());

describe('의미찾기 — 서버 문장·화면 크롬', () => {
  it('① en — 한국어 0 · EN× 0(묶음 제목·힌트·근거·항목·크롬·외 N건)', async () => {
    useUiLocaleStore.setState({ locale: 'en' });
    const { container } = render(<InsightView patientId="p1" months={null} />);
    await screen.findAllByText(/1000mg/);
    const text = container.textContent ?? '';
    expect(text, '대조군 — 목록이 실제로 그려졌다').toMatch(/K 6\.8 mmol\/L/);
    expect(text, '외 N건 자리').toMatch(/1 more/);
    expect(text, `한국어가 남았다: ${text.match(/[가-힣]+/g)?.slice(0, 5)}`).not.toMatch(/[가-힣]/);
    expect(text).not.toMatch(/EN×/);
  });

  it('② ko — 종전 문자열과 같은 문장이 그려진다', async () => {
    const { container } = render(<InsightView patientId="p1" months={null} />);
    await screen.findByText(note.text);
    const text = container.textContent ?? '';
    for (const s of [title.text, hint.text, label.text, detail.text, endDetail.text, '기록 42건을 의미 단위로 자동 배치했습니다']) expect(text).toContain(s);
    expect(text).not.toMatch(/KO×|EN×/);
  });

  it('① en — 로딩·실패·빈 상태 크롬도 한국어 0', async () => {
    useUiLocaleStore.setState({ locale: 'en' });
    get.mockReturnValueOnce(new Promise(() => {}));
    const loading = render(<InsightView patientId="p1" months={null} />);
    expect(loading.container.textContent, '대조군 — 로딩 문구가 그려졌다').toMatch(/\S/);
    expect(loading.container.textContent).not.toMatch(/[가-힣]|EN×/);
    cleanup();
    get.mockRejectedValueOnce(new Error('x'));
    const failed = render(<InsightView patientId="p1" months={null} />);
    await screen.findByText(/Could not load/);
    expect(failed.container.textContent).not.toMatch(/[가-힣]|EN×/);
    cleanup();
    get.mockResolvedValueOnce({ data: { groups: [], itemCount: 0 } });
    const empty = render(<InsightView patientId="p1" months={null} />);
    await screen.findByText(/No records to group yet/);
    expect(empty.container.textContent).not.toMatch(/[가-힣]|EN×/);
  });

  it('③ 대조군 — msg 없는 항목(ATTENTION 이슈 문구)은 원문을 티 없이', async () => {
    useUiLocaleStore.setState({ locale: 'en' });
    render(<InsightView patientId="p1" months={null} />);
    const el = await screen.findByText('critical threshold');
    expect(el.textContent).not.toMatch(/EN×/);
  });
});

describe('④ 소스 배선', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const src = readFileSync(join(ROOT, 'apps/web/src/components/record-timeline/InsightView.tsx'), 'utf-8');

  it('제목·힌트·근거·항목 label/detail 이 <ServerText msg> 를 지난다', () => {
    for (const f of ['g.titleMsg} fallback={g.title}', 'g.hintMsg} fallback={g.hint}', 'g.noteMsg} fallback={g.note}', 'it.labelMsg} fallback={it.label}', 'it.detailMsg} fallback={it.detail}']) {
      expect(src).toContain(`<ServerText msg={${f} />`);
    }
  });

  it('🔴 서버 문자열을 직접 그리는 자리가 남지 않았다', () => {
    expect(src).not.toMatch(/>\{(g\.title|g\.hint|g\.note|it\.label|it\.detail)\}</);
    expect(src).not.toMatch(/^\s*\{g\.note\}\s*$/m);
  });
});
