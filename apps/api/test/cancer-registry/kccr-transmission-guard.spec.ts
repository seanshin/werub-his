import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KCCR_CHANNEL,
  classifyKccrTransmission,
  isLocalKccrRef,
  localKccrRef,
} from '../../src/modules/cancer-registry/kccr-reporting';

/**
 * 🔴 KCCR 전송 근거 가드 — 2026-08-18(전송 근거 컬럼 신설분 배선).
 *
 * 규약: **전송을 흉내내지 않는다.** 연동이 없으면
 *  - `kccrTransmittedAt` 은 **null**(모르는 시각을 원장에 박지 않는다)
 *  - 접수번호는 **`LOCAL-` 접두**(기관이 준 번호가 아님을 드러낸다)
 *  - 상태는 미전송, 그리고 **재제출이 열려 있어야 한다**(한 번 눌러 영구 미보고로 굳지 않게)
 *
 * `reportedToKccr`(Boolean) 와 새 컬럼의 관계도 여기서 고정한다:
 *  reportedToKccr = **보고 대상 확정(자료 산출 완료)** 이지 전송 여부가 아니다.
 *  전송 여부의 정본은 `classifyKccrTransmission()` 하나뿐이다.
 */
const SERVICE = join(process.cwd(), 'src/modules/cancer-registry/cancer-registry.service.ts');
const CANON = join(process.cwd(), 'src/modules/cancer-registry/kccr-reporting.ts');
const src = readFileSync(SERVICE, 'utf-8');
const canonSrc = readFileSync(CANON, 'utf-8');

const codeLines = src.split('\n').filter((l) => {
  const t = l.trim();
  return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
});
const code = codeLines.join('\n');

describe('KCCR — 나가지 않은 전송에 시각을 박지 않는다(구조 가드)', () => {
  it('🔴 kccrTransmittedAt 은 전송 성공 판정 뒤에서만 쓰인다', () => {
    const offenders: string[] = [];
    codeLines.forEach((line, i) => {
      if (!/kccrTransmittedAt\s*:/.test(line)) return;
      // null 을 명시적으로 넣는 것은 사실 그대로이므로 허용
      if (/kccrTransmittedAt\s*:\s*null/.test(line)) return;
      // 읽기(전달)만 하는 자리도 허용 — `kccrTransmittedAt: r.kccrTransmittedAt`
      if (/kccrTransmittedAt\s*:\s*\w+\.kccrTransmittedAt/.test(line)) return;
      const ctx = codeLines.slice(Math.max(0, i - 12), i).join('\n');
      if (!/outcome === 'SENT'|transmitted\b/.test(ctx)) offenders.push(`${i + 1}: ${line.trim().slice(0, 90)}`);
    });
    expect(
      offenders,
      '전송 결과를 확인하지 않고 전송 시각을 박는 자리:\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('🔴 기관 접수번호처럼 보이는 문자열을 코드가 만들지 않는다 — 원내 번호는 LOCAL- 접두', () => {
    expect(code, "'KCCR-' 로 시작하는 접수번호를 코드가 만들면 안 된다").not.toMatch(/['"`]KCCR-/);
    expect(code, '접수번호는 localKccrRef() 로만 만든다').toContain('localKccrRef(');
    expect(localKccrRef(new Date(0))).toMatch(/^LOCAL-KCCR-/);
    expect(isLocalKccrRef(localKccrRef())).toBe(true);
  });

  it('전송 판정이 일어나는 자리는 transmitKccr 한 곳뿐이다(연동 시 고칠 자리)', () => {
    expect(src).toContain('private async transmitKccr(');
    expect(canonSrc).toMatch(/implemented:\s*false/);
  });

  it('🔴 미구현 채널에서는 "전송 완료" 라벨이 나올 수 없다', () => {
    const sentBranch = canonSrc.slice(canonSrc.indexOf("state: 'TRANSMITTED'"));
    expect(sentBranch).toContain('전송 완료');
    const beforeSent = canonSrc.slice(0, canonSrc.indexOf("state: 'TRANSMITTED'"));
    expect(beforeSent, '미전송 분기에 전송 완료 라벨이 있으면 안 된다').not.toContain("label: '전송 완료'");
  });
});

describe('KCCR 전송 판정 계약 — reportedToKccr 는 전송 여부가 아니다', () => {
  it('연동이 없는 동안에는 어떤 조합도 transmitted=true 가 되지 않는다', () => {
    expect(KCCR_CHANNEL.implemented).toBe(false);
    const combos = [
      { reportedToKccr: false, kccrTransmittedAt: null, kccrSubmissionId: null },
      { reportedToKccr: true, kccrTransmittedAt: null, kccrSubmissionId: 'LOCAL-KCCR-ABC' },
      // 🔴 원장에 시각이 박혀 있어도(구 데이터·오조작) 근거로 인정하지 않는다
      { reportedToKccr: true, kccrTransmittedAt: new Date('2026-01-01'), kccrSubmissionId: 'K2026-1' },
    ];
    for (const c of combos) {
      expect(classifyKccrTransmission(c).transmitted, JSON.stringify(c)).toBe(false);
    }
  });

  it('🔴 reportedToKccr=true 하나로 "보고 완료"가 되지 않는다 — 라벨이 미전송을 말한다', () => {
    const t = classifyKccrTransmission({ reportedToKccr: true, kccrTransmittedAt: null, kccrSubmissionId: null });
    expect(t.state).toBe('PREPARED_NOT_TRANSMITTED');
    expect(t.transmitted).toBe(false);
    expect(t.label).toContain('미전송');
    expect(t.note).toContain('전송되지 않았습니다');
  });

  it('🔴 나가지 않은 건은 항상 재제출 가능하다 — 영구 미보고로 굳지 않는다', () => {
    for (const c of [
      { reportedToKccr: false },
      { reportedToKccr: true },
      { reportedToKccr: true, kccrSubmissionId: 'LOCAL-KCCR-ABC' },
      { reportedToKccr: true, kccrTransmittedAt: new Date('2026-01-01'), kccrSubmissionId: 'LOCAL-KCCR-ABC' },
    ]) {
      const t = classifyKccrTransmission(c);
      expect(t.transmitted).toBe(false);
      expect(t.resubmittable, JSON.stringify(c)).toBe(true);
    }
  });

  it('전송 시각이 있어도 원내(LOCAL-) 번호면 근거 없음으로 읽는다', () => {
    const t = classifyKccrTransmission({
      reportedToKccr: true,
      kccrTransmittedAt: new Date('2026-01-01'),
      kccrSubmissionId: 'LOCAL-KCCR-ABC',
    });
    expect(t.state).toBe('UNVERIFIED');
    expect(t.submissionIdIsLocal).toBe(true);
    expect(t.label).not.toBe('전송 완료');
  });

  it('미전송이면 transmittedAt 을 지어내지 않는다(null 그대로)', () => {
    const t = classifyKccrTransmission({ reportedToKccr: true });
    expect(t.transmittedAt).toBeNull();
    expect(t.submissionId).toBeNull();
  });
});
