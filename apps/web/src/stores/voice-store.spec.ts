import { describe, it, expect, beforeEach } from 'vitest';
import { useVoiceStore, canSignNote } from './voice-store';
import type { ConfirmCard } from '@/components/voice-emr/types';

const patient = { name: '홍길동', mrn: '00012345', sexAge: 'M/64' };
const S = () => useVoiceStore.getState();

describe('VoiceEMR 상태기계', () => {
  beforeEach(() => S().reset());

  it('세션 시작 → warming → listening', () => {
    S().startSession({ id: 's1', encounterId: 'e1', patient }, 'command');
    expect(S().state).toBe('warming');
    S().setWarm(true);
    expect(S().state).toBe('listening');
    expect(S().session?.patient.mrn).toBe('00012345');
  });

  it('PTT: listening → capturing, partial=replace', () => {
    S().startSession({ id: 's1', encounterId: 'e1', patient }, 'command'); S().setWarm(true);
    S().beginCapture();
    expect(S().state).toBe('capturing');
    S().setPartial('혈압 백삼');
    S().setPartial('혈압 백삼십에 팔십'); // replace(누적 아님)
    expect(S().partial).toBe('혈압 백삼십에 팔십');
  });

  it('PTT 사이클: capturing → endCapture → listening → 재발화 가능(고착 방지)', () => {
    S().startSession({ id: 's1', encounterId: 'e1', patient }, 'command'); S().setWarm(true);
    S().beginCapture();
    expect(S().state).toBe('capturing');
    S().endCapture();
    expect(S().state).toBe('listening'); // 릴리즈 후 복귀(영구 '말하는 중' 고착 회귀 방지)
    // 두 번째 발화가 정상 시작되어야 함
    S().beginCapture();
    expect(S().state).toBe('capturing');
  });

  it('endCapture 는 confirming/error 상태를 덮지 않음', () => {
    S().startSession({ id: 's1', encounterId: 'e1', patient }, 'command'); S().setWarm(true);
    S().fail();
    S().endCapture();
    expect(S().state).toBe('error');
  });

  it('구술 스티칭 append + dropped_s → 서명 차단(G5)', () => {
    S().startSession({ id: 's1', encounterId: 'e1', patient }, 'dictate'); S().setWarm(true);
    S().appendNote('첫 문장');
    S().appendNote('둘째 문장');
    expect(S().noteText).toBe('첫 문장 둘째 문장');
    expect(canSignNote(S())).toBe(true);
    S().appendNote('유실 후', true); // dropped
    expect(S().dropped).toBe(true);
    expect(canSignNote(S())).toBe(false); // 서명 차단
  });

  it('구술 확인 카드: 필드 미선택으로 시작 → 필드 선택·본문 편집이 카드에 담긴다(확정 시 slots 로 서버 로그)', () => {
    S().startSession({ id: 's1', encounterId: 'e1', patient }, 'dictate'); S().setWarm(true);
    // 🔴 BE processUtterance 실제 출력 모양(patient·text·needsConfirm) — field 는 없다(미선택)
    const card: ConfirmCard = { kind: 'dictate', patient, text: '오늘 날씨가 좋네요' };
    S().requireConfirm(card);
    expect(S().state).toBe('confirming');
    expect((S().confirm as { field?: string }).field).toBeUndefined();
    S().setDictateField('objective');
    S().setDictateText('두통 3일');
    expect(S().confirm).toMatchObject({ kind: 'dictate', field: 'objective', editedText: '두통 3일', text: '오늘 날씨가 좋네요' });
    // 대조군 — 구술이 아닌 카드에는 아무 영향이 없다
    S().cancel();
    S().requireConfirm({ kind: 'vital', patient, metric: 'BP', values: [130, 80], abnormal: false });
    S().setDictateField('plan');
    expect((S().confirm as { field?: string }).field).toBeUndefined();
  });

  it('오더 확인: n-best 선택 → 확정 → executing', () => {
    S().startSession({ id: 's1', encounterId: 'e1', patient }, 'command'); S().setWarm(true);
    // 🔴 목은 **BE 가 실제로 주는 모양**을 쓴다 — 종전 이 목이 `nbest` 를 배열로 써서
    //    FE↔BE 계약 불일치(카드 렌더 크래시)를 통과시키고 있었다.
    const card: ConfirmCard = {
      kind: 'order-rx', patient, term: '메트포르민',
      nbest: {
        candidates: [{ code: 'A1', name: '메트포르민정 500mg', score: 0.9 }, { code: 'A2', name: '메트포르민서방정 500mg', score: 0.88 }],
        preSelect: 'A1',
      },
      highAlert: false, highAlertSource: 'MASTER', doubleCheckRequired: false,
    };
    S().requireConfirm(card);
    expect(S().state).toBe('confirming');
    S().selectCandidate('A2');
    expect((S().confirm as any).selectedCode).toBe('A2');
    S().confirmAction();
    expect(S().state).toBe('executing');
  });

  it('🔴 고위험 재확인 체크는 카드에 남는다(확정 slots 로 서버에 기록 — 가짜 게이트 금지)', () => {
    S().startSession({ id: 's1', encounterId: 'e1', patient }, 'command'); S().setWarm(true);
    S().requireConfirm({
      kind: 'order-rx', patient, term: '헤파린',
      nbest: { candidates: [{ code: 'H1', name: '헤파린주', score: 0.9 }], preSelect: 'H1' },
      highAlert: true, highAlertSource: 'MASTER', doubleCheckRequired: true,
    });
    expect((S().confirm as any).highAlertAck).toBeUndefined();
    S().ackHighAlert(true);
    // 확정 시 slots 로 그대로 서버에 넘어가는 자리다. 로컬 state 였다면 여기서 아무것도 안 보인다.
    expect((S().confirm as any).highAlertAck).toBe(true);
    S().ackHighAlert(false);
    expect((S().confirm as any).highAlertAck).toBe(false);
  });

  it('확인 취소 → listening(실행 안 함)', () => {
    S().startSession({ id: 's1', encounterId: 'e1', patient }, 'command'); S().setWarm(true);
    S().requireConfirm({ kind: 'vital', patient, metric: 'BP', values: [130, 80], abnormal: false });
    S().cancel();
    expect(S().state).toBe('listening');
    expect(S().confirm).toBeNull();
  });

  it('kill-switch/실패 → error(키보드 폴백)', () => {
    S().startSession({ id: 's1', encounterId: 'e1', patient }, 'command');
    S().fail();
    expect(S().state).toBe('error');
  });

  it('환자 신원은 확인 카드에 항상 존재(G3)', () => {
    const card: ConfirmCard = { kind: 'vital', patient, metric: 'BP', values: [130, 80], abnormal: false };
    S().requireConfirm(card);
    expect((S().confirm as any).patient.mrn).toBe('00012345');
  });
});
