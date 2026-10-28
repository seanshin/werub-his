import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 대외 발신 정직성 — 2026-09-02(메시징 축 실측).
 *
 * 🔴 관제(`/admin/outbound-channels`)는 '구현 + 설정 + 승인' 3조건을 그리는데,
 *    **'구현'이 거짓인 항목이 있었다**: EMAIL_SMTP 가 `implemented: true` 인데
 *    발송 코드는 `await import('nodemailer')` 이고 그 패키지는 선언도 설치도 되어 있지 않다.
 *    관리자가 smtp.config.host 를 채우면 화면은 '발신 가능'이라 말하지만 한 통도 나가지 않는다.
 *
 * 🔴 그리고 그 catch 는 **'설치 안 됨'과 '발송 실패'를 하나로 접어** 실제 SMTP 실패까지
 *    `simulated: true`(= 시도하지 않음)로 보고했다.
 */
const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const strip = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('🔴 대외 발신 — 구현 선언이 실제 코드와 맞는가', () => {
  it('🔴 nodemailer 가 없으면 EMAIL_SMTP 를 구현됨이라 말하지 않는다', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
    const declared = Boolean(pkg.dependencies?.nodemailer || pkg.optionalDependencies?.nodemailer);
    const installed = existsSync(join(process.cwd(), 'node_modules/nodemailer'))
      || existsSync(join(process.cwd(), '../../node_modules/nodemailer'));
    const reg = strip(read('modules/outbound-channel/outbound-channel.registry.ts'));
    const block = /key: 'EMAIL_SMTP'[\s\S]*?\n  \},/.exec(reg)?.[0] ?? '';
    expect(block, 'EMAIL_SMTP 항목을 찾지 못했습니다 — 검사가 헛돕니다').toContain('EMAIL_SMTP');
    if (!declared && !installed) {
      expect(block, 'nodemailer 미설치인데 관제에 구현됨으로 보고합니다').toContain('implemented: false');
    } else {
      expect(block, 'nodemailer 가 설치됐으니 구현됨으로 올릴 수 있습니다').toContain('implemented: true');
    }
  });

  it('🔴 발송 실패를 "시도하지 않음"으로 번역하지 않는다', () => {
    const svc = strip(read('modules/crm/crm-channel.service.ts'));
    // 모듈 부재만 simulated 로 접고, 그 외 오류는 실패로 말한다
    expect(svc, '모듈 부재를 따로 판정해야 한다').toMatch(/moduleMissing/);
    expect(svc, '그 외 오류는 success:false 로 말한다').toMatch(/success: false, simulated: false/);
  });
});

describe('🔴 전광판 SSE 인가 — 키 없이 통과하지 않는다', () => {
  const CTRL = strip(read('modules/waiting-queue/queue-display.controller.ts'));

  it('🔴 인가가 가드로 걸려 있다 — @Sse 는 헤더를 먼저 보낸다', () => {
    expect(CTRL).toMatch(/@UseGuards\(DisplayKeyStreamGuard\)/);
    const g = strip(read('modules/waiting-queue/display-key-stream.guard.ts'));
    expect(g, '가드가 키를 실제로 검증한다').toMatch(/validateApiKey\(/);
    expect(g, '가드가 실패를 오류로 말한다').toMatch(/throw new UnauthorizedException/);
  });

  it('🔴 키가 없으면 통과하는 fail-open 이 남아 있지 않다', () => {
    expect(CTRL, "`if (queryKey)` 는 없는 키를 통과시킨다").not.toMatch(/if\s*\(\s*queryKey\s*\)/);
    expect(CTRL, '200 스트림에 error 를 흘리는 것은 거부가 아니다').not.toMatch(/error:\s*'Invalid API key'/);
  });

  it('🔴 가드가 모듈에 등록돼 있다 — 아니면 조용히 무시된다', () => {
    expect(strip(read('modules/waiting-queue/waiting-queue.module.ts'))).toMatch(/DisplayKeyStreamGuard/);
  });

  it('대조군 — 의도적 공개 EP 는 그대로 열려 있다(막는 가드만 만들지 않는다)', () => {
    expect(CTRL, "공개 안내 스트림은 인증 없이 유지된다").toMatch(/@Sse\('stream'\)/);
  });
});
