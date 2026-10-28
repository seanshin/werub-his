import { describe, it, expect } from 'vitest';
import { stageFlow, delayedPatients, delayedCount, flagLabel, type JourneyRow } from './journey-view';

/** 상황판 여정 표시 골든 — 2026-07-31 */
const opd: JourneyRow[] = [
  { patientId: 'p1', name: '윤서연', mrn: 'M1', track: 'OPD', stage: 'RECEPTION', dept: '비뇨의학과', room: '1진료실', stayMin: 1606, flags: [] },
  { patientId: 'p2', name: '장우진', mrn: 'M2', track: 'OPD', stage: 'CASHIER_WAITING', dept: '내과', stayMin: 1369, flags: ['CASHIER_DELAY'] },
  { patientId: 'p3', name: '김진료', mrn: 'M3', track: 'OPD', stage: 'IN_CONSULT', dept: '외과', stayMin: 95, flags: ['CONSULT_DELAY'] },
];
const ipd: JourneyRow[] = [
  { patientId: 'i1', name: '박재원', mrn: 'M9', track: 'IPD', stage: 'INWARD', ward: '3병동', bed: '301', stayDays: 47, flags: ['LONG_STAY'] },
];

describe('단계 분포(stageFlow)', () => {
  it('흐름 순서를 지키고 인원 0 단계도 남긴다(빈 구간이 보여야 병목이 읽힌다)', () => {
    const f = stageFlow(opd, 'OPD');
    expect(f.map((s) => s.label)).toEqual(['접수', '호출', '진료중', '수납대기', '완료']);
    // 실제로 존재하는 단계는 0 이어도 남긴다 — 빈 구간이 보여야 병목이 읽힌다
    expect(f.find((s) => s.stage === 'CALLED')!.count).toBe(0);
  });

  it('🔴 서버가 내지 않는 단계를 만들어 0 으로 그리지 않는다', () => {
    // 종전엔 `WAITING`·`POST_CONSULT`·`EXAM`·`PHARMACY` 4종이 **영구 0** 으로 떠 있었다.
    // 관제자는 그것을 "검사 대기 없음"으로 읽었지만, 사실은 **추적하지 않는 단계**였다.
    const keys = stageFlow(opd, 'OPD').map((s) => s.stage);
    for (const ghost of ['WAITING', 'POST_CONSULT', 'EXAM', 'PHARMACY']) {
      expect(keys, `${ghost} 는 서버가 낸 적이 없다`).not.toContain(ghost);
    }
  });

  it('🔴 입원 단계 키가 서버와 같다 — 오타 하나면 라벨이 영문으로 샌다', () => {
    const f = stageFlow(
      [{ patientId: 'x', name: 'ㄱ', mrn: 'M', track: 'IPD', stage: 'ADMITTED', flags: [] },
       { patientId: 'y', name: 'ㄴ', mrn: 'M', track: 'IPD', stage: 'DISCHARGE_PLANNED', flags: [] }],
      'IPD',
    );
    expect(f.find((s) => s.stage === 'ADMITTED')).toMatchObject({ label: '입원', count: 1 });
    expect(f.find((s) => s.stage === 'DISCHARGE_PLANNED')).toMatchObject({ label: '퇴원예정', count: 1 });
    // 대조군: 알 수 없는 단계는 뒤에 원문 그대로 붙는다(인원이 사라지지 않는다)
    expect(f.map((s) => s.stage)).not.toContain('ADMIT');
  });

  it('단계별 지연 인원을 함께 센다', () => {
    const f = stageFlow(opd, 'OPD');
    expect(f.find((s) => s.stage === 'CASHIER_WAITING')).toMatchObject({ count: 1, delayed: 1 });
    expect(f.find((s) => s.stage === 'RECEPTION')).toMatchObject({ count: 1, delayed: 0 });
  });

  it('🔴 정의에 없는 단계가 와도 인원을 잃지 않는다(뒤에 붙임)', () => {
    const f = stageFlow([{ ...opd[0], stage: 'NEW_STAGE' }], 'OPD');
    expect(f.find((s) => s.stage === 'NEW_STAGE')).toMatchObject({ count: 1 });
  });

  it('입원 트랙은 입원 단계 정의를 쓴다', () => {
    expect(stageFlow(ipd, 'IPD').find((s) => s.stage === 'INWARD')).toMatchObject({ count: 1, delayed: 1 });
  });
});

describe('지연 환자(delayedPatients)', () => {
  it('플래그 없는 환자는 넣지 않는다', () => {
    expect(delayedPatients(opd, ipd).map((d) => d.mrn)).not.toContain('M1');
  });

  it('위험(진료 지연) 먼저, 같은 등급은 오래 기다린 순', () => {
    const d = delayedPatients(opd, ipd);
    expect(d[0].mrn).toBe('M3');          // CONSULT_DELAY = danger
    expect(d[1].mrn).toBe('M9');          // 47일 > 1369분
  });

  it('외래는 분·시간·일로, 입원은 일로 체류를 표기한다', () => {
    const d = delayedPatients(opd, ipd);
    expect(d.find((x) => x.mrn === 'M9')!.stay).toBe('47일');
    expect(d.find((x) => x.mrn === 'M2')!.stay).toBe('22시간');
  });

  it('위치는 부서·진료실 또는 병동·병상으로 조립한다', () => {
    const d = delayedPatients(opd, ipd);
    // 🔴 진료과와 장소는 **분리해서** 넘긴다 — 합치면 진료과를 번역할 수 없다(2026-09-10)
    expect(d.find((x) => x.mrn === 'M9')!.place).toBe('3병동 301');
    expect(d.find((x) => x.mrn === 'M9')!.dept).toBe('');
    expect(d.find((x) => x.mrn === 'M3')!.dept).toBe('외과');
    expect(d.find((x) => x.mrn === 'M3')!.place).toBe('');
  });

  it('플래그는 한국어 라벨로', () => {
    expect(flagLabel('CASHIER_DELAY')).toBe('수납 지연');
    expect(flagLabel('UNKNOWN_FLAG')).toBe('UNKNOWN_FLAG'); // 모르는 값도 버리지 않는다
  });

  it('상한을 넘기면 잘라 낸다(상황판은 진입점)', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...opd[1], patientId: `x${i}`, mrn: `X${i}` }));
    expect(delayedPatients(many, [], 12)).toHaveLength(12);
  });
});

describe('지연 목록은 잘린다 — 잘랐다고 말할 수 있어야 한다', () => {
  const mk = (n: number, flag = 'WAIT_DELAY'): JourneyRow[] =>
    Array.from({ length: n }, (_, i) => ({
      patientId: `p${i}`, name: `환자${i}`, mrn: `M${i}`,
      track: 'OPD', stage: 'RECEPTION', stayMin: i, flags: [flag],
    }));

  it('🔴 총계는 자르기 전 인원이다 — 종전엔 잘린 12건이 그대로 "12명"이었다', () => {
    const rows = mk(198);
    expect(delayedCount(rows, [])).toBe(198);
    expect(delayedPatients(rows, []).length).toBeLessThan(198);
  });

  it('대조군 — 적으면 총계와 표시 수가 같다(무조건 자르지 않는다)', () => {
    const rows = mk(3);
    expect(delayedCount(rows, [])).toBe(3);
    expect(delayedPatients(rows, [])).toHaveLength(3);
  });

  it('🔴 플래그 없는 사람은 총계에 들어가지 않는다', () => {
    const rows: JourneyRow[] = [
      { patientId: 'a', name: 'ㄱ', mrn: 'M1', track: 'OPD', stage: 'RECEPTION', flags: [] },
      { patientId: 'b', name: 'ㄴ', mrn: 'M2', track: 'OPD', stage: 'RECEPTION', flags: ['WAIT_DELAY'] },
    ];
    expect(delayedCount(rows, [])).toBe(1);
  });

  it('🔴 서버가 내는 접수 지연이 한국어로 나온다 — 종전엔 영문 enum 이었다', () => {
    const [first] = delayedPatients(mk(1), []);
    expect(first.flagLabels).toEqual(['접수 지연']);
  });
});
