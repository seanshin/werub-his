import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { VoiceConfirmCard } from '../../src/components/voice-emr/VoiceConfirmCard';
import type { ConfirmCard } from '../../src/components/voice-emr/types';

/**
 * VoiceEMR 확인 카드 ↔ BE outcome **계약 대조**(2026-08-27).
 *
 * 🔴 이 가드가 생긴 이유 — 셋 다 실제로 열려 있던 결함이다:
 *   ① BE 는 n-best 를 `{ candidates, preSelect }` 객체로 주는데 카드가 `nbest.map(...)` 을 불렀다.
 *      **처방·검사 음성 오더의 확인 카드가 렌더 시 죽었다.** `tsc` 도 기존 스펙도 통과했다 —
 *      FE 타입이 배열이라 **선언**하고 있었고, 목이 그 선언대로 만들어졌기 때문이다.
 *   ② 고위험을 불리언 하나로 그려 `UNSCREENED`(확인 못 함)를 아무 표시 없이 지나쳤다.
 *   ③ 재확인 체크가 로컬 state 라 버튼만 막고 서버엔 남지 않았다(가짜 게이트).
 *
 * 🔴 아래 payload 는 **손으로 지어내지 않았다** — 실제 `processUtterance('헤파린 5000단위 정맥주사
 *    처방', …)` 출력을 그대로 옮긴 것이다(목은 정본의 실제 반환 모양을 쓴다).
 *
 * 재주입 역검증: `VoiceConfirmCard` 를 `nbest.map` 으로 되돌리면 첫 테스트가 TypeError 로 실패하고,
 * `UNSCREENED` 분기를 지우면 두 번째가, ack 를 `useState` 로 되돌리면 네 번째가 실패한다.
 */
const patient = { name: '홍길동', mrn: '00012345', sexAge: 'M/64' };
const noop = () => {};
const props = { onSelect: noop, onAckHighAlert: noop, onConfirm: noop, onCancel: noop };

/** BE `processUtterance` 실제 출력(마스터 후보 주입) */
const RX_MASTER: ConfirmCard = {
  kind: 'order-rx', patient, term: '헤파린',
  nbest: { candidates: [{ code: 'A', name: '헤파린주', score: 0.9 }], preSelect: 'A' },
  dose: 5000, route: 'IV',
  highAlert: true, highAlertSource: 'MASTER', highAlertCategory: 'ANTICOAGULANT',
  doubleCheckRequired: true,
  highAlertReason: '약품 마스터 고위험 표식 — 헤파린주(A). 항응고제 비경구(IV) 투여 — 독립 이중확인 대상.',
};

describe('확인 카드는 BE 가 실제로 주는 모양을 읽는다', () => {
  it('🔴 n-best 는 객체다 — 후보가 렌더된다(배열로 읽으면 카드가 죽는다)', () => {
    const { container } = render(<VoiceConfirmCard card={RX_MASTER} {...props} />);
    expect(container.textContent).toContain('헤파린주');
    expect(container.querySelectorAll('input[type=radio]').length).toBe(1);
  });

  it('🔴 검사 오더도 같은 모양이다', () => {
    const lab: ConfirmCard = {
      kind: 'order-lab', patient,
      labs: [{ term: 'CBC', nbest: { candidates: [{ code: 'L1', name: '일반혈액검사', score: 0.9 }, { code: 'L2', name: 'CBC with diff', score: 0.8 }], preSelect: 'L1' } }],
    };
    const { container } = render(<VoiceConfirmCard card={lab} {...props} />);
    expect(container.textContent).toContain('일반혈액검사');
  });

  it('🔴 UNSCREENED 를 "고위험 아님"으로 뭉개지 않는다', () => {
    const un: ConfirmCard = {
      ...RX_MASTER, term: '무슨약',
      nbest: { candidates: [], preSelect: null },
      highAlert: false, highAlertSource: 'UNSCREENED', highAlertCategory: null,
      doubleCheckRequired: null,
      highAlertReason: '약품 마스터에서 후보를 찾지 못했고 선별어에도 걸리지 않았습니다 — 고위험 여부를 확인하지 못했습니다.',
    };
    const t = render(<VoiceConfirmCard card={un} {...props} />).container.textContent ?? '';
    expect(t).toContain('고위험 여부 미확인');
    expect(t).toContain('확인하지 못했습니다');
    // 판정 불가를 false 로 뭉개지 않는다
    expect(t).toContain('판정하지 못했습니다');
    // 미확인인데 이중확인 대상이라고 단정하지 않는다
    expect(t).not.toContain('독립 이중확인(2인) 대상입니다');
  });

  it('🔴 마스터가 답했고 표식이 없을 때만 배지가 사라진다', () => {
    const clean: ConfirmCard = {
      ...RX_MASTER,
      highAlert: false, highAlertSource: 'MASTER', highAlertCategory: null, doubleCheckRequired: false,
      highAlertReason: '약품 마스터 후보 1건 모두 고위험(high-alert) 표식이 없습니다.',
    };
    const t = render(<VoiceConfirmCard card={clean} {...props} />).container.textContent ?? '';
    expect(t).not.toContain('고위험 여부 미확인');
    expect(t).not.toContain('⚠ 고위험');
  });

  it('🔴 고위험 확정은 ack 전까지 막히고, ack 는 카드(=서버 slots)에 담긴다', () => {
    const before = render(<VoiceConfirmCard card={RX_MASTER} {...props} />).container;
    expect(before.querySelector('button[disabled]')?.textContent).toContain('확정');
    // ack 는 컴포넌트 로컬 state 가 아니라 카드에서 온다 — 카드에 실려야 버튼이 열린다
    const after = render(<VoiceConfirmCard card={{ ...RX_MASTER, highAlertAck: true }} {...props} />).container;
    expect(after.querySelector('button[disabled]')).toBeNull();
  });

  it('🔴 판정 사유는 서버 문장을 그대로 — 화면이 근거를 지어내지 않는다', () => {
    const t = render(<VoiceConfirmCard card={RX_MASTER} {...props} />).container.textContent ?? '';
    expect(t).toContain('약품 마스터 고위험 표식');
    expect(t).toContain('독립 이중확인(2인) 대상입니다');
  });
});

/**
 * 구술(dictate) 카드 — 2026-09-22(기획서 voice-emr-ambient-conversation §13.2 P0-1 · §13.4 D1).
 * 🔴 아래 payload 도 실제 `processUtterance('오늘 날씨가 좋네요', …)` 출력이다:
 *    `{"kind":"dictate","patient":{…},"text":"오늘 날씨가 좋네요","needsConfirm":true}`
 * 재주입: 카드의 `dictateBlocked` 를 `false` 로 박으면 ⓑ가, `DICTATE_FIELDS` 라디오를 지우면 ⓐ가, `PatientHeader` 를
 *         dictate 에서 빼면 ⓐ의 이름·MRN 검사가 실패한다.
 */
const DICTATE: ConfirmCard = { kind: 'dictate', patient, text: '오늘 날씨가 좋네요' };

describe('구술 카드 — 환자 신원 고정·필드 선택·본문 편집·확정은 사람', () => {
  it('ⓐ 환자 이름·MRN 이 고정 표시되고(G3) S/O/A/P 네 필드 라디오가 있으며 본문이 편집 가능하다', () => {
    const { container } = render(<VoiceConfirmCard card={DICTATE} {...props} />);
    const t = container.textContent ?? '';
    expect(t).toContain('홍길동');
    expect(t).toContain('MRN 00012345');
    const radios = container.querySelectorAll('input[type=radio][name="dictate-field"]');
    expect(radios.length).toBe(4);
    // 🔴 초기값 미선택 — 기본으로 S 를 골라 두지 않는다(쓰기 폼 초기값은 미선택)
    expect(Array.from(radios).some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('오늘 날씨가 좋네요');
    // 덮어쓰지 않는다는 사실을 카드가 말한다
    expect(t).toContain('덮어쓰지 않음');
  });

  it('ⓑ 🔴 필드를 고르기 전엔 확정이 막히고, 고르면 열린다 · 본문을 전부 지우면 다시 막힌다', () => {
    const before = render(<VoiceConfirmCard card={DICTATE} {...props} />).container;
    expect(before.querySelector('button[disabled]')?.textContent).toContain('확정');
    const after = render(<VoiceConfirmCard card={{ ...DICTATE, field: 'objective' }} {...props} />).container;
    expect(after.querySelector('button[disabled]')).toBeNull();
    const emptied = render(<VoiceConfirmCard card={{ ...DICTATE, field: 'objective', editedText: '   ' }} {...props} />).container;
    expect(emptied.querySelector('button[disabled]')?.textContent).toContain('확정');
  });

  it('ⓒ 편집한 본문(editedText)이 원문 대신 그려진다', () => {
    const { container } = render(<VoiceConfirmCard card={{ ...DICTATE, field: 'subjective', editedText: '두통 3일' }} {...props} />);
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('두통 3일');
  });
});

describe('FE 타입은 BE orchestrator 와 같은 어휘를 든다(기계 대조)', () => {
  const be = fs.readFileSync(
    path.join(__dirname, '../../../api/src/modules/voice-emr/orchestrator.ts'), 'utf-8');
  const fe = fs.readFileSync(
    path.join(__dirname, '../../src/components/voice-emr/types.ts'), 'utf-8');

  it('BE order-rx 가 내보내는 필드를 FE 타입이 전부 선언한다', () => {
    const fields = ['term', 'highAlert', 'highAlertSource', 'highAlertCategory', 'doubleCheckRequired', 'highAlertReason'];
    for (const f of fields) {
      expect(be, `BE 가 ${f} 를 더는 내보내지 않는다면 이 가드부터 고친다`).toContain(f);
      expect(fe, `FE 타입에 ${f} 가 없다 — 화면이 읽지 못한다`).toContain(f);
    }
  });

  it('🔴 BE dictate outcome 이 patient·needsConfirm 을 싣고, FE 는 dictate 를 ConfirmCard(확인 필요) 로 든다', () => {
    const beCode = be.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const feCode = fe.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(beCode).toMatch(/kind:\s*'dictate';\s*patient:\s*PatientRef;\s*text:\s*string;\s*needsConfirm:\s*true/);
    expect(beCode, 'toOutcome 의 DICTATE 분기가 환자 신원·needsConfirm 없이 되돌아갔다').toMatch(/case 'DICTATE': return \{ kind: 'dictate', patient, text: r\.text, needsConfirm: true \}/);
    // FE: dictate 가 확인 불요 Outcome 으로 되돌아가지 않았다(ConfirmCard 안에만 있다)
    expect(feCode).not.toMatch(/\|\s*\{\s*kind:\s*'dictate';\s*text:\s*string\s*\}/);
    expect(feCode).toMatch(/kind:\s*'dictate';\s*patient:\s*PatientRef;\s*text:\s*string/);
  });

  it('🔴 FE 가 n-best 를 배열로 되돌리지 않는다', () => {
    // 🔴 주석에는 종전 잘못된 선언이 근거로 인용돼 있다 — 코드만 본다(오탐 방지).
    const code = fe.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toContain('candidates: NbestCandidate[]');
    expect(code, 'BE 는 NbestResult 객체를 준다 — 배열 선언은 카드 렌더 크래시로 돌아간다')
      .not.toMatch(/nbest:\s*NbestCandidate\[\]/);
  });
});
