import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * 무인증 공개 EP — **미설정 시 여는 방향으로 열리지 않는다**(2026-09-16 G2).
 *
 * 🔴 실측: `POST /api/v1/webhooks/clinic` 은 레거시 분기가 `if (secret) { …검증… }` 이라
 *    HIS_WEBHOOK_SECRET·WEBHOOK_SECRET 둘 다 미설정이면 **검증을 통째로 건너뛰었다**.
 *    운영에는 CLINIC_CALLBACK_SECRET 만 있어, 공격자가 `X-Clinic-Signature` 를 **빼기만 하면**
 *    레거시 분기로 떨어져 무인증 통과했다 — 운영 프로브에서 `201 {received:true}` 를 받았다.
 *    이 EP 는 `hospital-register` 로 CLINIC_API_KEY·CLINIC_API_URL(아웃바운드 연동 대상)을 덮어쓰고
 *    `wsign.*` 로 전자결재 결과를 릴레이한다.
 *
 * 🔴 같은 저장소의 형제 구현은 **fail-closed 였다** — `sign-integration` 은 시크릿 미구성 시 던지고,
 *    `IntegrationAuthService` 의 EMS·LIS·PACS·edu 키도 전부 `if (!expected) throw`.
 *    즉 이 자리만 규약에서 벗어나 있었다.
 */
const ROOT = resolve(__dirname, '../..');
const CTRL = join(ROOT, 'src/modules/clinic-integration/clinic-integration.controller.ts');

/** 핸들러의 인증 구간만 뽑는다(스위치 이후 본문은 이 가드의 관심이 아니다) */
function authSection(): string {
  const src = readFileSync(CTRL, 'utf8');
  const i = src.indexOf('async receiveWebhook(');
  expect(i, 'receiveWebhook 핸들러를 못 찾았다 — 가드가 빈 문자열을 검사하고 있다').toBeGreaterThan(-1);
  const j = src.indexOf('// Replay 방지', i);
  expect(j, '인증 구간 끝 앵커(Replay 방지)를 못 찾았다').toBeGreaterThan(i);
  return src.slice(i, j);
}

describe('🔴 Clinic 웹훅 — 시크릿 미구성 시 수신을 거부한다(fail-closed)', () => {
  it('대조군 — 인증 구간을 실제로 뽑았다(빈 검사가 아니다)', () => {
    const s = authSection();
    expect(s.length).toBeGreaterThan(300);
    expect(s).toContain('CLINIC_CALLBACK_SECRET');
  });

  it('어느 시크릿도 없으면 UnauthorizedException — 검증 블록을 건너뛰지 않는다', () => {
    const s = authSection();
    // 두 시크릿을 먼저 모두 읽고, 둘 다 없으면 던지는 분기가 있어야 한다
    expect(s).toMatch(/if\s*\(\s*!clinicSecret\s*&&\s*!legacySecret\s*\)/);
    expect(s).toMatch(/if\s*\(\s*!clinicSecret\s*&&\s*!legacySecret\s*\)[\s\S]{0,160}throw new UnauthorizedException/);
  });

  /**
   * 🔴 이 검사의 첫 두 판이 **결함을 재주입해도 통과했다**(2026-09-16 G2 재주입 r2 · 2회).
   *    ① `else { … throw … }` 를 느슨히 찾으니 `else if (legacySecret)` **안쪽의 else** 가 대신 매칭됐다.
   *    ② 사슬 전체를 정규식으로 쓰자 lazy 수량자가 **안쪽 `}` 에서 끊겨** 또 안쪽 else 를 잡았다.
   *    중첩 괄호는 정규식의 일이 아니다 — **괄호 깊이를 실제로 세어** 같은 깊이의 마지막 else 를 찾는다.
   */
  it('🔴 서명 없이 들어온 요청이 "검증 없음"으로 흘러가지 않는다 — 분기 사슬의 마지막 else 가 던진다', () => {
    const s = authSection();
    const start = s.indexOf('if (clinicSignature)');
    expect(start, '`if (clinicSignature)` 분기를 못 찾았다').toBeGreaterThan(-1);

    // `if (clinicSignature) { … }` 의 여는 중괄호부터 깊이를 세어 사슬의 끝(같은 깊이)을 따라간다
    let i = s.indexOf('{', start);
    const tail = (() => {
      let depth = 0;
      for (let j = i; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') {
          depth--;
          if (depth === 0) {
            const rest = s.slice(j + 1);
            const m = /^\s*else\s+if\s*\([^)]*\)\s*{/.exec(rest);
            if (m) { i = j + 1 + m[0].length - 1; return null; } // 다음 사슬로 이동
            return rest; // 사슬의 끝 — 여기부터가 마지막 else(있다면)
          }
        }
      }
      return '';
    });
    let rest: string | null = null;
    for (let guard = 0; guard < 8 && rest === null; guard++) rest = tail();
    expect(rest, '분기 사슬을 끝까지 따라가지 못했다').not.toBeNull();

    const lastElse = /^\s*else\s*{([\s\S]*?)\n\s{4}}/.exec(rest as string);
    expect(lastElse, '사슬의 마지막 else 가 없다 — 서명 미동봉 + 레거시 시크릿 없음이 그대로 통과한다').not.toBeNull();
    expect(lastElse![1], '마지막 else 가 던지지 않는다 — 무인증 요청이 그대로 통과한다').toContain('throw new UnauthorizedException');
    // 종전 결함의 모양(조건부 검증만 하고 통과)이 되돌아오지 않았다
    expect(s).not.toMatch(/}\s*else\s*{\s*\/\/\s*레거시 경로[\s\S]{0,200}const secret =[\s\S]{0,120}if\s*\(secret\)\s*{/);
  });

  it('서명을 동봉했으면 정본 경로로만 판정한다(시크릿 미구성 시 레거시로 흘리지 않는다)', () => {
    const s = authSection();
    expect(s).toMatch(/if\s*\(clinicSignature\)\s*{/);
    expect(s).toMatch(/if\s*\(!clinicSecret\)\s*throw new UnauthorizedException/);
  });

  it('레거시 시크릿 비교는 상수시간(secureKeyEqual) — 문자열 === 로 되돌아가지 않는다', () => {
    const s = authSection();
    expect(s).toContain('secureKeyEqual(webhookSecret, legacySecret)');
    expect(s, '타이밍 사이드채널이 있는 === 비교로 되돌아갔다').not.toMatch(/webhookSecret\s*===\s*(secret|legacySecret)/);
  });
});

/**
 * 진단서 PDF 다운로드(무인증·토큰)는 열람 기록을 남긴다.
 * AuditLog 는 `userId` 가 User FK 필수라 무인증 주체를 담지 못한다 → `SmartAccessLog`(userId nullable).
 */
describe('🔴 완료본 PDF 다운로드 — "누가 언제 받아갔는가"가 남는다', () => {
  const DOC = join(ROOT, 'src/modules/document/document.controller.ts');
  function downloadSection(): string {
    const src = readFileSync(DOC, 'utf8');
    const i = src.indexOf('async download(');
    expect(i, 'download 핸들러를 못 찾았다').toBeGreaterThan(-1);
    return src.slice(i, src.indexOf('res.end(buf)', i));
  }

  it('대조군 — 핸들러를 실제로 뽑았다', () => {
    expect(downloadSection()).toContain('generatePdfWithToken');
  });

  it('토큰 검증 뒤에 SmartAccessLog 로 기록한다(환자·경로·IP·UA)', () => {
    const s = downloadSection();
    expect(s).toContain('logSmartAccess');
    expect(s).toContain("clientId: 'public:document-dl'");
    expect(s).toContain('patientId');
    expect(s).toContain('ipAddress');
    // 순서: 토큰 검증(generatePdfWithToken)이 기록보다 먼저 — 실패한 시도를 "받아갔다"로 적지 않는다
    expect(s.indexOf('generatePdfWithToken')).toBeLessThan(s.indexOf('logSmartAccess'));
  });

  it('기록 실패가 다운로드를 막지 않는다(void — 감사 실패 ≠ 서비스 중단)', () => {
    expect(downloadSection()).toMatch(/void this\.audit\.logSmartAccess/);
  });
});

/**
 * 동작 대조 — `logSmartAccess` 가 무인증 주체(userId 없음)를 실제로 받아 쓴다.
 * 소스 문자열이 아니라 **목이 받은 인자**를 본다(§가드: 목은 정본의 실제 반환 모양을 쓴다).
 */
describe('logSmartAccess — 무인증 주체를 담는다', () => {
  let created: Record<string, unknown> | null = null;
  beforeEach(() => { created = null; });

  it('userId 없이도 기록된다(SmartAccessLog.userId nullable)', async () => {
    const prisma = { smartAccessLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { created = data; return data; }) } };
    const { AuditService } = await import('../../src/modules/audit/audit.service');
    const svc = new (AuditService as unknown as new (...a: unknown[]) => {
      logSmartAccess: (e: Record<string, unknown>) => Promise<void>;
    })(prisma, { set: vi.fn(), get: vi.fn() });

    await svc.logSmartAccess({
      clientId: 'public:document-dl', userId: undefined, patientId: '11111111-1111-4111-8111-111111111111',
      resourceType: 'DocumentPdf', action: 'read', path: '/api/v1/documents/dl/X', ipAddress: '1.2.3.4',
    });

    expect(prisma.smartAccessLog.create).toHaveBeenCalledTimes(1);
    expect(created).toMatchObject({ clientId: 'public:document-dl', resourceType: 'DocumentPdf', action: 'read', ipAddress: '1.2.3.4' });
    expect(created?.userId ?? null).toBeNull();
  });
});
