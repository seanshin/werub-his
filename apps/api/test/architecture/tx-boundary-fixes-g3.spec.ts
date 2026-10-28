import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { stripForScan } from './egress-scan';
import { scanTxBoundaries } from './tx-boundary-scan';

/**
 * G3 가 묶은 자리 — **그 메서드가 실제로 한 트랜잭션 안에서 쓰는가**를 스캐너 판정으로 못박는다(2026-09-16).
 *
 * 🔴 소스에 `$transaction` 이라는 **글자가 있는지**로 보지 않는다. F3 의 재주입이 그렇게 통과했다 —
 *    `$transaction(async (tx) => …)` 를 `(async (tx) => …)` 로 바꿔 트랜잭션을 통째로 벗겨도
 *    `tx.` 라는 이름만 보고 "트랜잭션 안"으로 세었다. 여기서는 정본 스캐너(`scanTxBoundaries`)가
 *    그 메서드를 **다중쓰기로 집어내지 않는다**는 사실로 판정한다(벗기면 다시 집힌다 = 재주입에서 실패).
 *
 * 각 자리의 반쪽 상태(고치기 전에 남던 것)는 위 주석이 아니라 **소스의 봉합 주석**에 적혀 있다.
 */
const MODULES = resolve(__dirname, '../../src/modules');
const { rows } = scanTxBoundaries(MODULES);
const multiWrite = new Set(rows.map((r) => `${r.file}#${r.method}`));

/** 고친 자리 — 스캐너가 더는 '트랜잭션 밖 다중쓰기'로 세지 않아야 한다 */
const SEALED: { file: string; method: string; half: string }[] = [
  { file: 'imaging/imaging.service.ts', method: 'acquire', half: '오더만 IN_PROGRESS — 상태 검사가 재시도를 막아 오더가 영구히 잠긴다' },
  { file: 'imaging/imaging.service.ts', method: 'report', half: '판독 없는 완료 오더' },
  { file: 'imaging/imaging.service.ts', method: 'cancelAcquisition', half: '오더는 재촬영 대기인데 영상결과는 촬영됨' },
  { file: 'lab/lab.service.ts', method: 'collect', half: '오더만 IN_PROGRESS — 검사 오더가 영구히 잠긴다' },
  { file: 'lab/lab.service.ts', method: 'cancelTesting', half: '검사 항목만 지워지고 결과는 검사 중(지운 항목은 되돌릴 수 없다)' },
  { file: 'telehealth/telehealth.service.ts', method: 'endSession', half: '세션이 안 닫혀 재종료 시 진료기록·청구가 한 벌 더' },
  { file: 'document-sign/document-sign.service.ts', method: 'sign', half: '서명은 남고 문서는 미완결(카운트가 영영 어긋난다)' },
  { file: 'transplant/transplant.service.ts', method: 'updateCrossmatch', half: '기증자 요약이 옛 판정을 말한다' },
  { file: 'transplant/transplant.service.ts', method: 'recordCrossmatch', half: '기증자 요약이 옛 판정을 말한다' },
  { file: 'patient-safety/patient-safety.service.ts', method: 'recordRestraintMonitoring', half: '원장은 "지속 불필요"인데 신체보호대는 ACTIVE(법정 기록 모순)' },
  { file: 'installment/installment.service.ts', method: 'createPlan', half: '청구는 PENDING 인데 계획만 존재 — 같은 청구에 계획이 한 벌 더' },
];

describe('🔴 G3 — 반쪽 상태가 남던 자리는 한 트랜잭션이다', () => {
  it.each(SEALED)('$file#$method — 트랜잭션 밖 다중쓰기가 아니다 (종전: $half)', ({ file, method }) => {
    expect(multiWrite.has(`${file}#${method}`), `${file}#${method} 가 여전히 트랜잭션 밖 다중쓰기다`).toBe(false);
  });

  /**
   * 🔴 대조군 — 탐지기가 살아 있는지. 전건이 통과하면 "고쳐서 통과"인지 "아무것도 못 보고 통과"인지 알 수 없다.
   *    아직 묶지 않은 자리가 실제로 집히는 것을 확인한다(이 자리를 고치면 이 대조군을 다른 자리로 옮긴다).
   */
  it('대조군 — 아직 묶지 않은 자리는 스캐너가 집어낸다', () => {
    expect(rows.length).toBeGreaterThan(100);
    expect(multiWrite.has('consent/consent.service.ts#sign'), '동의서 서명은 서명 쌍만 묶었고 다른 쓰기가 남아 여전히 집혀야 한다').toBe(true);
  });
});

describe('문서 서명 완료 판정은 읽어둔 옛 값이 아니라 증가된 실제 값으로 한다', () => {
  /**
   * 🔴 **주석·문자열은 정본 `stripForScan` 으로 지우고 본다.** 첫 판은 그냥 소스를 검사해
   *    바로 위 봉합 주석에 적힌 `signedDoc.completedSigners + 1` 을 코드로 읽고 실패했다 —
   *    E4 가 자기 주석 속 `.catch(() => undefined)` 를 코드로 세었던 것과 같은 함정이다.
   */
  const code = stripForScan(readFileSync(join(MODULES, 'document-sign/document-sign.service.ts'), 'utf8')).blanked;

  /**
   * 🔴 종전: `signedDoc.completedSigners + 1 >= signedDoc.requiredSigners` — **트랜잭션 전에 읽어둔 값**이다.
   *    두 서명자가 동시에 서명하면 둘 다 0 을 읽어, 증가는 원자적으로 2가 되는데 상태는 둘 다 PENDING 으로
   *    계산된다(필수 2명을 채우고도 미완결). 증가 결과(`counted`)로 판정해야 한다.
   */
  it('옛 값(signedDoc.completedSigners + 1)으로 상태를 계산하지 않는다', () => {
    expect(code).not.toContain('signedDoc.completedSigners + 1');
  });

  it('증가된 값으로 판정한다 — counted.completedSigners >= counted.requiredSigners', () => {
    expect(code).toContain('counted.completedSigners >= counted.requiredSigners');
  });

  it('대조군 — 주석 제거기가 코드를 통째로 지우지 않았다(그러면 위 검사가 헛돈다)', () => {
    expect(code).toContain('documentSignature.create');
    expect(code).toContain('$transaction');
  });
});

describe('트랜잭션 안에 외부·장시간 호출을 넣지 않는다', () => {
  /**
   * 🔴 ERP 장기 트랜잭션(26일)이 전 DB VACUUM 을 막은 이력이 있다. 트랜잭션 안에는 쓰기만 둔다.
   *
   * 🔴 **첫 판 가드는 텍스트 순서(`호출 위치 < 트랜잭션 위치`)만 봤고, 재주입이 통과해 버렸다** —
   *    호출을 그 자리에 둔 채 결과만 트랜잭션 안에서 쓰게 바꿔도 순서는 그대로였다.
   *    지금은 **트랜잭션 블록의 span 안에 그 호출이 있는가**로 본다(순서가 아니라 포함 관계).
   */
  /** `$transaction(` 의 인자 블록 span 들 — 괄호 균형으로 닫는다 */
  const txSpans = (code: string): [number, number][] => {
    const out: [number, number][] = [];
    const re = /\$transaction\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const open = re.lastIndex - 1;
      let depth = 0;
      for (let i = open; i < code.length; i++) {
        if (code[i] === '(') depth++;
        else if (code[i] === ')') {
          depth--;
          if (depth === 0) { out.push([open, i]); break; }
        }
      }
    }
    return out;
  };
  const callsInsideTx = (file: string, needle: string): number => {
    const code = stripForScan(readFileSync(join(MODULES, file), 'utf8')).blanked;
    const spans = txSpans(code);
    expect(spans.length, `${file}: $transaction 을 찾지 못했다(가드가 헛돈다)`).toBeGreaterThan(0);
    let n = 0;
    const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      if (spans.some(([s, e]) => m!.index > s && m!.index < e)) n++;
    }
    return n;
  };

  it('원격진료 종료 — 자격 조회(resolveCopayRate)가 트랜잭션 블록 안에 없다', () => {
    expect(callsInsideTx('telehealth/telehealth.service.ts', 'resolveCopayRate(')).toBe(0);
  });

  it('영상 촬영 — 피폭선량 기록(recordExposure)이 트랜잭션 블록 안에 없다', () => {
    expect(callsInsideTx('imaging/imaging.service.ts', 'recordExposure(')).toBe(0);
  });

  it('대조군 — 탐지기가 산다: 트랜잭션 안의 쓰기는 "안"으로 센다', () => {
    expect(callsInsideTx('imaging/imaging.service.ts', 'tx.imagingResult.create(')).toBeGreaterThan(0);
    expect(callsInsideTx('telehealth/telehealth.service.ts', 'tx.billing.create(')).toBeGreaterThan(0);
  });
});
