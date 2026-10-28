import { describe, it, expect } from 'vitest';
import { processUtterance, type OrchestratorCtx } from '../../src/modules/voice-emr/orchestrator';
import type { Candidate } from '../../src/modules/voice-emr/nbest-matcher';

const DRUGS: Candidate[] = [
  { code: 'A001', name: '메트포르민정 500mg', form: '정' },
  { code: 'A002', name: '메트포르민서방정 500mg', form: '서방정' },
  { code: 'A006', name: '푸로세미드정 40mg', synonyms: ['라식스'], form: '정' },
  { code: 'H001', name: '헤파린주 5000단위', form: '주사' },
];
const LABS: Candidate[] = [
  { code: 'L1', name: '당화혈색소' }, { code: 'L2', name: '크레아티닌' }, { code: 'L3', name: '소변검사' },
];
const ctx: OrchestratorCtx = {
  patient: { name: '홍길동', mrn: '00012345', sexAge: 'M/64' },
  lookupCandidates: (term, kind) => (kind === 'drug' ? DRUGS : LABS),
  isVitalAbnormal: (m, v) => (m === 'BP' && v[0] >= 140),
};

describe('오케스트레이터 종단', () => {
  it('조회=확인 불요', () => {
    const [o] = processUtterance('지난 검사 결과 보여줘', ctx);
    expect(o).toMatchObject({ kind: 'read', target: 'lab' });
  });

  it('활력=환자 신원+needsConfirm+정상판정', () => {
    const [o] = processUtterance('혈압 백삼십에 팔십', ctx) as any;
    expect(o.kind).toBe('vital');
    expect(o.patient).toMatchObject({ name: '홍길동', mrn: '00012345' }); // G3
    expect(o.needsConfirm).toBe(true);
    expect(o.abnormal).toBe(false);
  });
  it('활력 이탈 판정', () => {
    const [o] = processUtterance('혈압 백오십에 구십', ctx) as any;
    expect(o.abnormal).toBe(true); // 150 ≥ 140
  });

  it('처방=n-best+환자 신원+needsConfirm', () => {
    const [o] = processUtterance('메트포르민 오백 밀리그램 하루 두 번', ctx) as any;
    expect(o.kind).toBe('order-rx');
    expect(o.patient.mrn).toBe('00012345'); // G3
    expect(o.needsConfirm).toBe(true);
    expect(o.freq).toBe('bid');
    expect(o.nbest.candidates.map((c: any) => c.code)).toEqual(expect.arrayContaining(['A001', 'A002']));
  });

  it('상품명→성분 n-best', () => {
    const drugsWithSyn = [...DRUGS, { code: 'A003', name: '아토르바스타틴칼슘정 20mg', synonyms: ['리피토'] }];
    const c2 = { ...ctx, lookupCandidates: () => drugsWithSyn };
    const [o] = processUtterance('리피토 이십 밀리그램 취침 전', c2) as any;
    expect(o.nbest.candidates[0].code).toBe('A003');
  });

  it('고위험 약물 플래그(2단 확인 대상)', () => {
    const [o] = processUtterance('헤파린 오천 단위 정맥주사', ctx) as any;
    expect(o.kind).toBe('order-rx');
    expect(o.highAlert).toBe(true);
  });

  it('검사 나열=lab별 n-best+needsConfirm', () => {
    const [o] = processUtterance('당화혈색소하고 크레아티닌하고 소변검사 나가고', ctx) as any;
    expect(o.kind).toBe('order-lab');
    expect(o.labs.map((l: any) => l.term)).toEqual(expect.arrayContaining(['당화혈색소', '크레아티닌', '소변검사']));
    expect(o.needsConfirm).toBe(true);
  });

  it('복합 처방=2 outcome 모두 needsConfirm+환자', () => {
    const os = processUtterance('메트포르민 오백 밀리그램 하고 라식스 이십 밀리그램 처방', ctx) as any[];
    const rx = os.filter((o) => o.kind === 'order-rx');
    expect(rx).toHaveLength(2);
    rx.forEach((o) => { expect(o.needsConfirm).toBe(true); expect(o.patient.mrn).toBe('00012345'); });
  });

  it('저신뢰=hold(실행 없음)', () => {
    const [o] = processUtterance('어쩌구', { ...ctx, confidence: 0.3 });
    expect(o).toMatchObject({ kind: 'hold' });
  });

  /**
   * 🔴 구술(T2)도 쓰기다 — 2026-09-22 전까지 `{ kind: 'dictate', text }` 뿐이어서 확인 카드·환자 신원(G3)을 건너뛰고
   *    화면이 S 를 덮어썼다(기획서 voice-emr-ambient-conversation §13.2 P0-1). 파서는 규칙에 안 걸린 발화·의문형을
   *    전부 DICTATE 로 폴백하므로 잡담 한 마디가 기록이 됐다.
   * 재주입: `toOutcome` 의 DICTATE 분기를 `{ kind: 'dictate', text: r.text }` 로 되돌리면 아래 둘이 실패한다.
   */
  it('🔴 구술(폴백·의문형)=환자 신원+needsConfirm — 확인 카드 규약의 예외가 아니다', () => {
    for (const u of ['오늘 날씨가 좋네요', '어디가 아프세요']) {
      const [o] = processUtterance(u, ctx) as any;
      expect(o.kind).toBe('dictate');
      expect(o.text).toBe(u);
      expect(o.needsConfirm).toBe(true);
      expect(o.patient).toMatchObject({ name: '홍길동', mrn: '00012345' }); // G3
    }
  });

  it('불변: 모든 write/order outcome 은 needsConfirm(구술 포함)', () => {
    const utterances = ['혈압 백삼십에 팔십', '메트포르민 오백 밀리그램 처방', '흉부 엑스레이 오더 낼게', '당화혈색소 검사 추가', '오늘 날씨가 좋네요'];
    const seen = new Set<string>();
    for (const u of utterances) {
      for (const o of processUtterance(u, ctx) as any[]) {
        seen.add(o.kind);
        if (['vital', 'order-rx', 'order-lab', 'order-imaging', 'alias', 'dictate'].includes(o.kind)) {
          expect(o.needsConfirm).toBe(true);
          expect(o.patient).toBeDefined();
        }
      }
    }
    // 대조군 — 픽스처가 dictate 분기를 실제로 겨눴는지(겨누지 못하면 위 검사는 아무것도 보증하지 않는다)
    expect(seen.has('dictate')).toBe(true);
  });
});
