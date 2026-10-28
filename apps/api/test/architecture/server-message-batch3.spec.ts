import { describe, it, expect } from 'vitest';
import { renderServerMessageKo, type ServerMessage } from '@hospital-run/shared';
import { buildInsights, type RawItem, type IssueLike } from '../../src/modules/record-timeline/record-insights';
import { SERVER_MESSAGE_SOURCES, sourceKeysOf, unregisteredKeys, assertWellFormed, composedLines } from './server-message-sources';

/**
 * 🔴 서버 표시 문장 `{ k, params }` 계약 — 배치 3 (2026-09-15 I3) · record-timeline `record-insights.ts`.
 *
 * 환자 기록 '의미찾기'(InsightView)의 묶음 근거(`위급 2건 포함`·`약품 3종 · 변화 4건`)·항목 문장(`메트포르민 용량 변경`·
 * `2026-07-01 처방 30일분 · 2026-07-31 이후 재처방 없음`)은 서버가 값을 끼워 조립해 영어 화면에서도 한국어였다.
 * 이제 서버는 `titleMsg`·`hintMsg`·`noteMsg`·`labelMsg`·`detailMsg` 를 주고 화면 `<ServerText>` 가 조립한다.
 *
 * 못박는 것:
 *   (a) 소스 키·조각(`orWord` 낱말 포함)이 전부 en·ja·ar 에 있다.
 *   (b) 옮긴 자리가 조립 템플릿으로 되돌아가지 않았다 — record-insights 잔여 조립 줄 **0** · 연결 우회 0.
 *       같은 모듈의 나머지(record-summary=AI 프롬프트 재료 겸용 · record-issues=임상 판정 사유)는 옮기지 않았다(설계 §6).
 *   (c) 실제 반환 — 여섯 묶음 전부에서 `*Msg` 가 있고, 종전 문자열은 **같은 정본에서 파생**(글자 단위 동일) · 자리표시자↔params 일치.
 *   (d) 대조군 — ATTENTION 항목은 이슈 정본 문구를 그대로 옮기므로 `labelMsg`/`detailMsg` 가 **없다**(지어낸 키로 감싸지 않는다).
 */

const FILES = SERVER_MESSAGE_SOURCES.recordTimeline;

describe('(a) 소스 키가 전부 카탈로그에 있다', () => {
  const keys = sourceKeysOf(FILES);

  it('대조군 — 추출기가 실제로 키를 읽는다(0이면 아래 검사가 헛돈다)', () => {
    expect(keys.size).toBeGreaterThanOrEqual(35);
    expect(keys.has('{약품} 투약기간 종료')).toBe(true);
    expect(keys.has('마무리 안 된 것')).toBe(true);
    expect(keys.has('기재 없음'), 'orWord 낱말 조각').toBe(true);
  });

  it('🔴 한글이 든 키는 en·ja·ar 모두 등재(한글 자리 이름만 쓴 비번역 키도 0)', () => {
    expect(unregisteredKeys(keys)).toEqual([]);
  });
});

describe('(b) 옮긴 자리가 조립 템플릿으로 되돌아가지 않았다', () => {
  it('🔴 record-insights.ts — 잔여 조립 줄 0 · 연결(+) 우회 0', () => {
    const { composed, concat } = composedLines(FILES[0]);
    expect(composed, `조립 줄:\n${composed.join('\n')}`).toEqual([]);
    expect(concat).toEqual([]);
  });
});

const check = (msg: ServerMessage | null | undefined, text: string | null | undefined, where: string) => {
  expect(msg, `${where} — 구 응답 모양(문자열만)으로 되돌아갔다`).toBeTruthy();
  assertWellFormed(msg!);
  expect(text, where).toBe(renderServerMessageKo(msg!));
};

describe('(c) 실제 반환 — 여섯 묶음', () => {
  const NOW = new Date('2026-07-31T00:00:00Z');
  const items: RawItem[] = [
    { type: 'ENCOUNTER', id: 'e1', at: '2026-05-15', diagnoses: [{ code: 'I10', name: 'HTN' }, { code: 'E11', name: 'DM' }] },
    { type: 'ENCOUNTER', id: 'e2', at: '2026-07-24', diagnoses: [{ code: 'I10', name: 'HTN' }] },
    { type: 'PRESCRIPTION', id: 'r1', at: '2026-05-01', title: 'Metformin(500mg)', dosage: '500mg', duration: 30, code: 'D1', rxType: 'MEDICATION' },
    { type: 'PRESCRIPTION', id: 'r2', at: '2026-06-01', title: 'Metformin(500mg)', dosage: '1000mg', duration: 30, code: 'D1', rxType: 'MEDICATION' },
    { type: 'PRESCRIPTION', id: 'r3', at: '2026-06-02', title: null, dosage: null, duration: 5, code: 'D2', rxType: 'MEDICATION' },
    ...['2026-05-01', '2026-06-01', '2026-07-01'].map((at, i): RawItem => ({ type: 'LAB', id: `l${i}`, at, title: 'CBC', verifiedAt: at, results: [{ name: 'Hb', value: String(10 + i * 2), unit: 'g/dL' }, { name: 'WBC', value: '7', unit: '' }] })),
    { type: 'LAB', id: 'lp', at: '2026-07-30', title: null, verifiedAt: null, results: [] },
    { type: 'IMAGING', id: 'i1', at: '2026-07-29', title: 'CT', reportedAt: null },
    { type: 'PROGRESS_NOTE', id: 'n1', at: '2026-07-28', title: null, status: 'DRAFT' },
    { type: 'ADMISSION', id: 'a1', at: '2026-06-10', admissionId: 'A1' },
    { type: 'ADMISSION', id: 'a2', at: '2026-06-15', admissionId: 'A1', subType: 'DISCHARGE' },
    { type: 'NURSING', id: 'x1', at: '2026-06-11', admissionId: 'A1' },
    { type: 'ADMISSION', id: 'a3', at: '2026-07-20', admissionId: 'A2' },
    { type: 'SURGERY', id: 's1', at: '2026-06-12', title: null },
    { type: 'SURGERY', id: 's2', at: '2026-06-13', title: 'Appendectomy' },
  ];
  const issues: IssueLike[] = [
    { level: 'CRITICAL', at: '2026-07-10', category: '검사', label: 'K', value: '6.8 mmol/L', why: '위급 기준 도달', source: { type: 'LAB', id: 'l1' } },
    { level: 'WARN', at: '2026-07-09', category: '검사', label: 'HbA1c', why: '상회', source: { type: 'LAB', id: 'l2' } },
  ];
  const groups = buildInsights(items, issues, NOW);

  it('대조군 — 여섯 묶음이 전부 만들어진다(한 묶음이라도 빠지면 아래 검사가 그 분기를 못 겨눈다)', () => {
    expect(groups.map((g) => g.key).sort()).toEqual(['ATTENTION', 'DIAGNOSIS', 'EPISODE', 'MEDICATION', 'PENDING', 'TREND']);
  });

  it('🔴 묶음 제목·힌트·근거 — `*Msg` 가 정본, 문자열은 그 파생', () => {
    for (const g of groups) {
      check(g.titleMsg, g.title, `${g.key}.title`);
      check(g.hintMsg, g.hint, `${g.key}.hint`);
      check(g.noteMsg, g.note, `${g.key}.note`);
    }
  });

  it('🔴 항목 문장 — ATTENTION 밖의 한글 label/detail 은 전부 `*Msg` 파생이다', () => {
    let seen = 0;
    for (const g of groups) {
      if (g.key === 'ATTENTION') continue;
      for (const it of g.items) {
        if (it.labelMsg) { check(it.labelMsg, it.label, `${g.key}.label`); seen++; }
        else expect(/[가-힣]/.test(it.label), `${g.key} 한글 label 이 메시지 없이 나갔다: ${it.label}`).toBe(false);
        if (it.detailMsg) { check(it.detailMsg, it.detail, `${g.key}.detail`); seen++; }
        else expect(/[가-힣]/.test(it.detail ?? ''), `${g.key} 한글 detail 이 메시지 없이 나갔다: ${it.detail}`).toBe(false);
      }
    }
    expect(seen, '대조군 — 메시지를 실제로 검사했다').toBeGreaterThanOrEqual(15);
  });

  it('한국어는 종전 문장과 글자 단위로 같다(표본)', () => {
    const med = groups.find((g) => g.key === 'MEDICATION')!;
    expect(med.note).toBe('약품 2종 · 변화 5건'); // 시작 2 · 용량 변경 1 · 투약기간 종료 2
    expect(med.items.map((i) => i.label)).toContain('Metformin 용량 변경');
    expect(med.items.find((i) => i.label === 'Metformin 용량 변경')!.detail).toBe('500mg → 1000mg (2026-06-01)');
    expect(med.items.find((i) => i.label === '약품 시작')!.labelMsg).toEqual({ k: '{약품} 시작', params: { 약품: { k: '약품' } } });
    const trend = groups.find((g) => g.key === 'TREND')!;
    expect(trend.items.map((i) => i.label)).toEqual(['HB 상승', 'WBC 유지']);
    expect(trend.items[0].detail).toBe('3회 · 10 (2026-05-01) → 14 (2026-07-01) g/dL · +4');
    expect(trend.items[1].detail).toBe('3회 · 7 (2026-05-01) → 7 (2026-07-01)');
    const ep = groups.find((g) => g.key === 'EPISODE')!;
    expect(ep.items.map((i) => i.detail)).toEqual(expect.arrayContaining(['2026-06-10 ~ 2026-06-15 · 기간 내 기록 1건', '2026-07-20 ~ (재원)']));
    expect(ep.items.find((i) => i.id === 's2')!.label).toBe('Appendectomy');
    const pend = groups.find((g) => g.key === 'PENDING')!;
    expect(pend.items.map((i) => i.label).sort()).toEqual(['CT 판독 전', '검사 확정 전', '기록 미서명']);
    expect(groups.find((g) => g.key === 'DIAGNOSIS')!.items[0].detail).toBe('최초 2026-05-15 · 최근 2026-07-24 · 2회 기재');
  });

  it('(d) 대조군 — ATTENTION 항목은 이슈 정본 문구를 그대로(메시지 없음)', () => {
    const att = groups.find((g) => g.key === 'ATTENTION')!;
    expect(att.note).toBe('위급 1건 포함');
    expect(att.items[0]).toMatchObject({ label: 'K 6.8 mmol/L', detail: '위급 기준 도달' });
    expect(att.items[0].labelMsg).toBeUndefined();
    expect(att.items[0].detailMsg).toBeUndefined();
  });
});
