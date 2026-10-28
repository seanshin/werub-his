import { describe, it, expect } from 'vitest';
import { computeNews2, computeApache2, computeSofa } from './icu-scores';

describe('ICU scores (실계산)', () => {
  // 🔴 2026-08-19 정본 수렴: 이 블록의 종전 단언들은 **어긋난 동작을 고정하고 있었다.**
  //    ① 단일 3점을 `MEDIUM` 이라 단언했다 — RCP 2017 은 `LOW_MEDIUM`(총점 5 이상이 MEDIUM).
  //    ② 보충산소를 관측하지 않고도 점수가 나오는 것을 정상으로 봤다 — 실내공기로 단정하면 2점 낮아진다.
  //    통과하는 테스트가 아무것도 보증하지 않을 수 있다.

  it('NEWS2 정상 활력 → 0점 LOW (보충산소까지 관측된 경우)', () => {
    const r = computeNews2({ respiratoryRate: 16, spo2: 98, systolicBp: 120, heartRate: 72, temperature: 36.8, consciousness: 'ALERT', fio2: 21 });
    expect(r.score).toBe(0);
    expect(r.riskLevel).toBe('LOW');
    expect(r.missing).toEqual([]);
  });

  it('🔴 보충산소를 모르면 산출하지 않는다 — 실내공기로 단정하면 2점이 조용히 사라진다', () => {
    const r = computeNews2({ respiratoryRate: 16, spo2: 98, systolicBp: 120, heartRate: 72, temperature: 36.8, consciousness: 'ALERT' });
    expect(r.score).toBeNull(); // 0점이 아니다
    expect(r.riskLevel).toBe('UNSCORABLE');
    expect(r.missing).toContain('보충산소(FiO₂·환기모드)');
  });

  it('NEWS2 패혈증 활력 → 고위험(HIGH) · 구 AVPU "VERBAL" 도 정본이 접는다', () => {
    // RR26(2)·SpO2 90(3)·O2(2)·SBP85(3)·HR122(2)·Temp39.2(2)·V의식(3) = 17
    const r = computeNews2({ respiratoryRate: 26, spo2: 90, fio2: 40, systolicBp: 85, heartRate: 122, temperature: 39.2, consciousness: 'VERBAL' });
    expect(r.score).toBeGreaterThanOrEqual(7);
    expect(r.riskLevel).toBe('HIGH');
    expect(r.params.consciousness).toBe(3); // 운영 실측 VERBAL 4건 — 정규화 없으면 어휘로 갈라진다
  });

  it('🔴 단일 3점은 LOW_MEDIUM 이다 — 종전 ICU 판은 MEDIUM 이라 안전바와 등급이 달랐다', () => {
    const r = computeNews2({ respiratoryRate: 16, spo2: 98, systolicBp: 88, heartRate: 72, temperature: 36.8, consciousness: 'ALERT', fio2: 21 });
    expect(r.params.bp).toBe(3);
    expect(r.score).toBe(3);
    expect(r.riskLevel).toBe('LOW_MEDIUM');
  });

  it('🔴 총점 1~4 는 LOW 다 — 종전 ICU 판은 LOW_MEDIUM 으로 한 단계 올려 불렀다', () => {
    // HR 100(1) 만 벗어난 경우 → 총점 1
    const r = computeNews2({ respiratoryRate: 16, spo2: 98, systolicBp: 120, heartRate: 100, temperature: 36.8, consciousness: 'ALERT', fio2: 21 });
    expect(r.score).toBe(1);
    expect(r.riskLevel).toBe('LOW');
  });

  it('APACHE II 실계산 — GCS·연령 반영·검사성분 missing 명시', () => {
    const r = computeApache2({ temperature: 39.5, systolicBp: 90, diastolicBp: 50, heartRate: 145, respiratoryRate: 36, gcScore: 10 }, 70);
    expect(r.score).toBeGreaterThan(0);
    expect(r.gcsPoints).toBe(5); // 15-10
    expect(r.agePoints).toBe(5); // 65-74
    expect(r.missingParams).toContain('creatinine');
  });

  it('SOFA 실계산 — GCS·MAP·요량 성분', () => {
    const r = computeSofa({ gcScore: 8, systolicBp: 80, diastolicBp: 50, outputUrine: 150 });
    expect(r.organScores.cns).toBe(3); // GCS 6-9
    expect(r.organScores.cardiovascular).toBe(1); // MAP<70
    expect(r.organScores.renal).toBe(4); // <200
    expect(r.assessedComponents.length).toBe(3);
  });

  it('결정적(동일 입력 동일 결과) — 랜덤 아님', () => {
    const v = { respiratoryRate: 22, spo2: 93, systolicBp: 95, heartRate: 110, temperature: 38.5, consciousness: 'ALERT', fio2: 21 };
    expect(computeNews2(v).score).toBe(computeNews2(v).score);
  });
});
