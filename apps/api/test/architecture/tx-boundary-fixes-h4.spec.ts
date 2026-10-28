import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { stripForScan } from './egress-scan';
import { scanTxBoundaries } from './tx-boundary-scan';

/**
 * H4 가 묶은 자리(2026-09-16 트랜잭션 3차) — G3 와 같은 방식으로 **정본 스캐너 판정**으로 못박는다.
 *
 * 🔴 소스에 `$transaction` 이라는 글자가 있는지로 보지 않는다(F3 의 재주입이 그렇게 통과했다).
 *    `scanTxBoundaries` 가 그 메서드를 **트랜잭션 밖 다중쓰기로 집어내지 않는다**는 사실로 판정한다 —
 *    트랜잭션을 벗기면 다시 집히므로 재주입에서 실패한다.
 *
 * 🔴 이번 라운드의 절반은 **쌍둥이 경로**였다. G3 가 `imaging.service`·`patient-safety`(신체보호대)에서
 *    고친 바로 그 결함이 워크스테이션·정신과 판에 그대로 남아 있었다("한 곳만 고치면 갈라진다").
 */
const MODULES = resolve(__dirname, '../../src/modules');
const { rows } = scanTxBoundaries(MODULES);
const multiWrite = new Set(rows.map((r) => `${r.file}#${r.method}`));

/** 고친 자리 — 스캐너가 더는 '트랜잭션 밖 다중쓰기'로 세지 않아야 한다 */
const SEALED: { file: string; method: string; half: string }[] = [
  { file: 'workstation/workstation.service.ts', method: 'acquireImaging', half: '영상결과는 ACQUIRED 로 판독 대기열에 떠 있는데 오더는 시작되지 않았다(G3 imaging.service 의 쌍둥이)' },
  { file: 'workstation/workstation.service.ts', method: 'reportImaging', half: '판독은 REPORTED 인데 오더 미완료 — 청구 트리거 이벤트도 나가지 않는다' },
  { file: 'workstation/workstation.service.ts', method: 'receiveOrder', half: '오더만 RECEIVED — 전이 검사가 재접수를 막아 검체 채취시각이 영구히 비어 있다' },
  { file: 'pacs-proxy/pacs-webhook.controller.ts', method: 'onStudyReceived', half: '오더는 촬영 중인데 영상결과에 수신 시각이 없다(웹훅 재전송 보장 없음)' },
  { file: 'pacs-proxy/pacs-webhook.controller.ts', method: 'onReportCompleted', half: '소견 없이 닫힌 오더 — 판독문이 영영 들어오지 않는다' },
  { file: 'equipment/equipment.service.ts', method: 'addInspectionLog', half: '불합격 점검 기록은 남았는데 장비는 ACTIVE 로 계속 쓰인다(안전 게이트)' },
  { file: 'checkup/checkup.service.ts', method: 'signSummary', half: '결과서는 서명됐는데 방문 미완료 — 재서명 차단(E1)이 재시도를 막아 영구히 잠긴다' },
  { file: 'psychiatry/psychiatry.service.ts', method: 'recordSeclusionMonitoring', half: '원장은 "지속 불필요"인데 격리는 ACTIVE(법정 최대시간 기록 · G3 신체보호대의 쌍둥이)' },
  { file: 'emergency/emergency.service.ts', method: 'reassess', half: '원장은 KTAS 를 올렸다고 적혔는데 방문은 옛 등급으로 줄 세워진다' },
  { file: 'cssd/cssd-package.service.ts', method: 'createLoad', half: '패키지 없는 빈 로드에 BI/CI 합격이 적힌다(인증 심사 기록)' },
  { file: 'lab/lab.service.ts', method: 'addWorksheetItem', half: '워크시트는 OPEN 인데 항목만 들어가 중복 항목이 쌓인다' },
  { file: 'voucher/voucher-cron.service.ts', method: 'anchorPending', half: '이벤트가 PENDING 으로 남아 다음 주기에 같은 이벤트가 새 앵커로 다시 앵커된다(append-only 원장)' },
];

describe('🔴 H4 — 반쪽 상태가 남던 자리는 한 트랜잭션이다', () => {
  it.each(SEALED)('$file#$method — 트랜잭션 밖 다중쓰기가 아니다 (종전: $half)', ({ file, method }) => {
    expect(multiWrite.has(`${file}#${method}`), `${file}#${method} 가 여전히 트랜잭션 밖 다중쓰기다`).toBe(false);
  });

  /**
   * 🔴 대조군 — 탐지기가 살아 있는지. 전건이 통과하면 "고쳐서 통과"인지 "아무것도 못 보고 통과"인지 알 수 없다.
   */
  it('대조군 — 아직 묶지 않은 자리는 스캐너가 집어낸다', () => {
    expect(rows.length).toBeGreaterThan(100);
    expect(multiWrite.has('consent/consent.service.ts#sign'), '동의서 서명은 아직 다중쓰기로 집혀야 한다').toBe(true);
  });
});

/**
 * 외부·장시간 호출은 트랜잭션 **밖**이다 — 긴 트랜잭션이 DB 를 막은 이력이 있다
 * (ERP 26일 트랜잭션이 전 DB VACUUM 을 차단).
 */
describe('외부 호출은 트랜잭션 안에 넣지 않는다', () => {
  const read = (f: string) => stripForScan(readFileSync(join(MODULES, f), 'utf8')).blanked;

  /**
   * 🔴 판정은 "외부 호출이 트랜잭션 **콜백 안에 없다**" 로 한다.
   *    첫 판은 "호출 위치가 트랜잭션 끝보다 뒤에 있다" 로 봤는데, 같은 이름이 파일 앞쪽(메서드 정의·다른 호출)에
   *    먼저 나와 엉뚱한 위치를 집었다. 그리고 문자열은 `stripForScan` 이 지우므로 식별자로만 찾는다.
   */
  const txBody = (code: string, marker: string) => {
    const at = code.indexOf(marker);
    expect(at, `트랜잭션 표식을 찾지 못했다: ${marker}`).toBeGreaterThan(-1);
    const open = code.indexOf('(', at);
    let depth = 0;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') { depth--; if (depth === 0) return code.slice(open, i + 1); }
    }
    throw new Error('트랜잭션 인자 블록을 닫지 못했다');
  };

  it('영상 촬영 — 피폭선량 기록(다른 서비스 호출)은 트랜잭션 콜백 안에 없다', () => {
    const code = read('workstation/workstation.service.ts');
    const body = txBody(code, 'const imagingResultId = await this.prisma.$transaction');
    expect(body).toContain('tx.imagingResult');
    expect(body).not.toContain('recordExposure');
  });

  it('장비 점검 — ERP 통지는 트랜잭션 콜백 안에 없다', () => {
    const code = read('equipment/equipment.service.ts');
    const body = txBody(code, 'const { log, outOfService } = await this.prisma.$transaction');
    expect(body).toContain('tx.equipmentInspectionLog');
    expect(body).not.toContain('this.erpEvent(');
  });

  it('PACS 판독 완료 — 알림 이벤트 발행은 트랜잭션 콜백 안에 없다', () => {
    const code = read('pacs-proxy/pacs-webhook.controller.ts');
    const at = code.indexOf('async onReportCompleted');
    const body = txBody(code.slice(at), 'await this.prisma.$transaction');
    expect(body).toContain('tx.imagingResult');
    expect(body).not.toContain('this.eventEmitter.emit(');
  });
});
