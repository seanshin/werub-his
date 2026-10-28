import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **SSE 가 인증 실패를 빈 스트림으로 말하지 않는다** (2026-08-29 · 발굴 15회차).
 *
 * 실측: 동의서 태블릿 스트림에 **없는 uid·틀린 secret** 으로 붙었더니 **HTTP 200 + 빈 스트림**.
 * 데이터가 새지는 않았다(인가는 정확했다). 문제는 **말하는 방식**이다 —
 * 브라우저 `EventSource` 는 200 을 **"연결 성공"** 으로 읽으므로, secret 이 낡은 태블릿은
 * 오류 없이 **영원히 이벤트를 기다린다**(화면은 정상으로 보인다).
 *
 * 🔴 같은 서비스의 `deviceSigned()` 는 같은 인증 실패를 **예외로 던졌다** —
 *    **한 인증 실패를 두 가지로 말하고 있었다.**
 *
 * 🔴 규약: *"조회 실패를 영구 로딩으로 굳히지 않는다"* ·
 *    *"`.catch(() => 기본값)` 은 실패를 없음으로 번역하는 코드다"* — `EMPTY` 도 같은 형태다.
 */
const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('🔴 인가 실패한 SSE 는 빈 스트림이 아니라 오류다', () => {
  const CTRL = strip(read('modules/consent/consent-device-public.controller.ts'));

  /**
   * 🔴 **처음엔 이 검사가 `throw new UnauthorizedException` 문자열만 봤고, 통과했는데
   *    운영 동작은 그대로 200 이었다.** `@Sse` 는 **헤더를 먼저 보내고** 옵저버블을
   *    구독하므로 핸들러 안에서 던져도 상태 코드가 이미 나간 뒤다.
   *    → 인가는 **응답 시작 전**에 끝나야 하고 그 자리는 **가드**다.
   *    가드는 **작동하는 메커니즘**을 겨눈다(문자열이 아니라).
   */
  it('🔴 인가가 **가드**로 걸려 있다 — 핸들러 안의 throw 로는 200 이 나간다', () => {
    expect(CTRL, '@UseGuards 로 응답 시작 전에 막는다').toMatch(/@UseGuards\(ConsentDeviceStreamGuard\)/);
    const g = strip(read('modules/consent/consent-device-stream.guard.ts'));
    expect(g, '가드가 인가를 실제로 본다').toMatch(/authorizeStream\(/);
    expect(g, '가드가 실패를 오류로 말한다').toMatch(/throw new UnauthorizedException/);
  });

  it('🔴 가드가 모듈에 등록돼 있다 — 안 되면 조용히 무시된다', () => {
    expect(strip(read('modules/consent/consent.module.ts'))).toMatch(/ConsentDeviceStreamGuard/);
  });

  it('🔴 `EMPTY` 로 조용히 접지 않는다', () => {
    expect(CTRL, 'EMPTY 는 실패를 "이벤트 없음"으로 번역한다').not.toMatch(/\bEMPTY\b/);
  });

  it('인가 검사 자체는 살아 있다(대조군 — 지우면 데이터가 샌다)', () => {
    expect(strip(read('modules/consent/consent-device-stream.guard.ts'))).toMatch(/authorizeStream\(deviceUid, secret\)/);
  });

  /**
   * 🔴 **다른 SSE 가 같은 형태를 새로 만들지 않는지** 센다.
   *    `switchMap(... : EMPTY)` 는 "인가 실패 → 빈 스트림" 관용구다.
   */
  it('SSE 컨트롤러 전체에 인가-실패-빈스트림 관용구가 없다(0 동결)', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const f = join(d, e);
        if (statSync(f).isDirectory()) walk(f);
        else if (e.endsWith('.controller.ts')) files.push(f);
      }
    };
    walk(SRC);
    expect(files.length, '컨트롤러를 실제로 훑었다(대조군)').toBeGreaterThan(100);
    const bad = files.filter((f) => {
      const c = strip(readFileSync(f, 'utf8'));
      return /@Sse\(/.test(c) && /\?\s*[^:]*:\s*EMPTY/.test(c);
    });
    expect(bad.map((f) => f.split('/src/')[1]), '인가 실패를 빈 스트림으로 접는 SSE').toEqual([]);
  });
});
