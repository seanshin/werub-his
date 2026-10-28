import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { scanTxBoundaries, writesByFile } from './tx-boundary-scan';
import { TX_MULTI_WRITE_BY_FILE, TX_MULTI_WRITE_TOTAL } from './tx-boundary-inventory.baseline';

/**
 * 🔴 트랜잭션 경계 — 여러 쓰기가 한 트랜잭션이 아니면 **중간 실패가 반쪽 상태를 남긴다**(2026-09-16 F3).
 *
 * 이 저장소에서 실제로 확인한 모양:
 *  · 오더는 '조제 중'인데 조제 기록이 없어 **그 오더가 영구히 잠긴다**(재시도를 상태 검사가 막는다)
 *  · 사전처방이 PENDING 에 남아 재승인하면 **처방·오더가 한 벌 더 생긴다**
 *  · 수혈은 REACTION 인데 **부작용 보고서가 없어** 혈액원 보고 목록에 안 뜬다
 *  · 결과 정정에서 기존 항목만 지워지고 재생성이 실패하면 **검사 결과가 통째로 사라진다**
 *
 * 🔴 기준선은 **결함 수가 아니다.** 베스트에포트(감사·알림)와 분기상 함께 실행되지 않는 쓰기가 섞여 있다.
 *    한 건씩 봐야 안다 — 지키는 것은 "늘지 않는다" 하나다.
 */
const MODULES = path.resolve(process.cwd(), 'src/modules');

describe('🔴 트랜잭션 경계 — 다중 쓰기가 조용히 늘지 않는다', () => {
  const { rows, escapes } = scanTxBoundaries(MODULES);

  it('대조군 — 스캐너가 살아 있다(다중쓰기 자리를 실제로 찾는다)', () => {
    // 하한: 0 이 되면 스캐너가 죽은 것이지 저장소가 완벽해진 것이 아니다
    expect(rows.length).toBeGreaterThan(150);
    expect(rows.every((r) => r.writes >= 2)).toBe(true);
  });

  it('전체 다중쓰기 메서드 수가 기준선과 같다(늘면 새 경로 · 줄면 이 수를 내린다)', () => {
    expect(rows.length).toBe(TX_MULTI_WRITE_TOTAL);
  });

  it('파일별 다중쓰기 메서드 수가 기준선과 정확히 같다', () => {
    expect(writesByFile(rows)).toEqual(TX_MULTI_WRITE_BY_FILE);
  });

  it('파일별 합이 전체와 일치한다(한쪽만 고치면 갈라진다)', () => {
    const sum = Object.values(TX_MULTI_WRITE_BY_FILE).reduce((a, b) => a + b, 0);
    expect(sum).toBe(TX_MULTI_WRITE_TOTAL);
  });

  /**
   * 🔴 트랜잭션 콜백 안에서 바깥 `prisma` 로 쓰면 그 쓰기만 트랜잭션을 빠져나간다.
   *    남은 1건은 **의도된 예외**다 — 안전 게이트 위반 원장(GateViolationLog)은 차단 롤백에도 남아야 한다
   *    (규약: 게이트 위반은 tx 밖 기록). 늘어나면 의도인지 확인해야 하므로 정확값으로 동결한다.
   */
  it('트랜잭션을 빠져나가는 쓰기는 의도된 1건뿐이다(안전 게이트 위반 원장)', () => {
    expect(escapes.map((e) => `${e.file}:${e.model}`)).toEqual([
      'inventory/inventory.service.ts:gateViolationLog',
    ]);
  });
});

describe('F3 에서 봉합한 자리는 다중쓰기가 남아 있지 않다(회귀 대조)', () => {
  const { rows } = scanTxBoundaries(MODULES);
  /**
   * 🔴 (2026-09-16 K4) **안전 게이트 위반 원장은 규약상 tx 밖**이다(차단 롤백에도 보존).
   *    K4 가 그 쓰기를 정본 헬퍼로 수렴시키며 스캐너에 드러나자(종전엔 `this.prisma.gateViolationLog`\n`.create(`
   *    줄바꿈 때문에 **보이지 않았다**) `startDispensing` 이 `gateViolationLog+prescription` 으로 걸렸다.
   *    이 대조군이 지키는 것은 "도메인 쓰기 둘이 갈라지지 않는다"이지 "원장이 tx 밖이다"가 아니다 —
   *    조준을 도메인 모델로 좁힌다(완화가 아니라 겨냥 교정 · 아래 하한이 대상 0 을 막는다).
   */
  const LEDGER_OUTSIDE_TX = new Set(['gateViolationLog']);
  const domainWrites = (r: { models: string[] }) => r.models.filter((m) => !LEDGER_OUTSIDE_TX.has(m));
  const has = (file: string, method: string) =>
    rows.some((r) => r.file === file && r.method === method && domainWrites(r).length >= 2);

  it('하한 — 조준을 좁혀도 스캐너가 도메인 다중쓰기를 실제로 찾는다(대상 0 이 아니다)', () => {
    expect(rows.filter((r) => domainWrites(r).length >= 2).length).toBeGreaterThan(100);
  });

  it.each([
    ['pharmacy/pharmacy.service.ts', 'startDispensing', '오더 잠김'],
    ['pharmacy/pharmacy.service.ts', 'cancelDispensing', '이중 불출'],
    ['pre-order/pre-order.service.ts', 'approve', '중복 처방'],
    ['remote-consultation/remote-consultation.service.ts', 'createPrescription', '약국 큐 누락'],
    ['blood-bank/blood-bank.service.ts', 'startTransfusion', '오더 미추종'],
    ['blood-bank/blood-bank.service.ts', 'completeTransfusion', '마지막 단위 미완료'],
    ['blood-bank/blood-bank.service.ts', 'reportReactionDetail', '부작용 보고 누락'],
    ['cssd/cssd.service.ts', 'updateStatus', '재처리 이력 불일치'],
    ['workstation/workstation.service.ts', 'completeLabResult', '검사 결과 소실'],
    ['workstation/workstation.service.ts', 'createTherapyOrder', '유령 치료 오더'],
  ])('%s %s — %s', (file, method) => {
    expect(has(file as string, method as string)).toBe(false);
  });
});
