import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 전송 코드 없이 '신고완료'를 적지 못하게 하는 구조 가드 — 화면 실사용 점검 W7(2026-08-14).
 *
 * 무엇이 잘못이었나: 법정감염병 신고는 질병관리청으로 **한 번도 나간 적이 없는데**
 * `status:'SUBMITTED'` 와 `reportRef:'KCDC-'+Date.now().toString(36)` 를 적었다.
 * 코드에 "(시뮬레이션)"이라는 주석은 있었지만 화면에는 아무 표시가 없었다 —
 * 주석은 환자를 지키지 못한다(P16: 실행하지 않고 성공 상태만 기록).
 *
 * 그래서 **문자열 수준에서** 되살아남을 막는다:
 *  - 기관 접수번호처럼 보이는 문자열을 코드가 만들지 않는다(`'KCDC-…'`/`` `KONIS-${…}` ``).
 *  - 'SUBMITTED'/reportedToKonis=true 는 전송 결과 판정(`outcome === 'SENT'`)을 거친
 *    자리에서만 쓰인다.
 *  - 전송 판정은 `transmitNotifiable`/`transmitKonis` 두 함수에만 있다(연동을 붙일 때 고칠 자리).
 */
const SERVICE = join(process.cwd(), 'src/modules/infection-control/infection-control.service.ts');
const CHANNELS = join(process.cwd(), 'src/modules/infection-control/external-reporting.ts');

const src = readFileSync(SERVICE, 'utf-8');
const channelSrc = readFileSync(CHANNELS, 'utf-8');

/** 주석을 뺀 코드 줄만 본다(주석 속 설명은 결함이 아니다) */
const codeLines = src
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
  });
const code = codeLines.join('\n');

describe('법정보고 — 전송 없이 접수를 적지 않는다(구조 가드)', () => {
  it('🔴 기관 접수번호를 코드가 만들어 내지 않는다 — 원내 번호는 LOCAL- 접두어', () => {
    expect(code, "'KCDC-' 로 시작하는 접수번호를 코드가 만들면 안 된다").not.toMatch(/['"`]KCDC-/);
    expect(code, "'KONIS-' 로 시작하는 접수번호를 코드가 만들면 안 된다").not.toMatch(/['"`]KONIS-/);
    expect(code, '접수번호는 localReportRef() 로만 만든다').toContain('localReportRef(');
  });

  it("🔴 status:'SUBMITTED' 는 전송 성공 판정 뒤에서만 쓰인다", () => {
    const offenders: string[] = [];
    codeLines.forEach((line, i) => {
      if (!/status:\s*(NOTIFIABLE_STATUS\.SUBMITTED|['"`]SUBMITTED['"`])/.test(line)) return;
      // 같은 블록(앞 12줄) 안에 전송 성공 판정이 있어야 한다
      const ctx = codeLines.slice(Math.max(0, i - 12), i).join('\n');
      if (!/outcome === 'SENT'|transmitted\b/.test(ctx)) offenders.push(`${i + 1}: ${line.trim().slice(0, 90)}`);
    });
    expect(offenders, '전송 결과를 확인하지 않고 제출 완료를 기록하는 자리:\n  ' + offenders.join('\n  ')).toEqual([]);
  });

  it('🔴 reportedToKonis=true 는 전송 성공 또는 수기 보고 근거번호가 있을 때만 쓰인다', () => {
    const offenders: string[] = [];
    codeLines.forEach((line, i) => {
      if (!/reportedToKonis\s*[:=]\s*true/.test(line)) return;
      const ctx = codeLines.slice(Math.max(0, i - 12), i).join('\n');
      if (!/outcome === 'SENT'|manualRef/.test(ctx)) offenders.push(`${i + 1}: ${line.trim().slice(0, 90)}`);
    });
    expect(offenders, 'KONIS 로 보내지도 않고 보고완료를 적는 자리:\n  ' + offenders.join('\n  ')).toEqual([]);
  });

  it('전송 판정은 transmitNotifiable / transmitKonis 두 곳에만 있다(연동 시 고칠 자리)', () => {
    expect(src).toContain('private async transmitNotifiable(');
    expect(src).toContain('private async transmitKonis(');
    expect(channelSrc).toMatch(/implemented:\s*false/);
  });

  it('🔴 미구현 채널의 라벨이 "신고완료"가 아니다 — 화면이 그대로 읽는다', () => {
    // classifyNotifiableTransmission 의 '신고완료' 라벨은 transmitted:true 분기에만 존재한다
    const sentBranch = channelSrc.slice(channelSrc.indexOf("state: 'SENT'"));
    expect(sentBranch).toContain('신고완료');
    const beforeSent = channelSrc.slice(0, channelSrc.indexOf("state: 'SENT'"));
    expect(beforeSent, '미전송 분기에 신고완료 라벨이 있으면 안 된다').not.toContain("label: '신고완료'");
  });
});
