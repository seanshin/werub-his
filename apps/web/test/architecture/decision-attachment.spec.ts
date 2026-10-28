/**
 * 🔴 허가 다이얼로그·SMS 설정 — **켤 수 없는 것을 켤 수 있는 것처럼 보이지 않게** (2026-08-20).
 *
 * 사람 지시: 허가 결정은 **별도 다이얼로그 + 관련 문서 첨부**, SMS 는 **별도 설정 다이얼로그**.
 *
 * 이 가드가 막는 것:
 * ① 허가권자 층 다이얼로그에서 **첨부 없이 제출**할 수 있게 되는 것(서버도 막지만 화면도 막아야 한다)
 * ② SMS 설정이 **"저장하면 켜진다"고 읽히는 것** — 제공자 코드가 없으면 저장해도 안 나간다
 * ③ 시스템이 **문서 진위를 검증한다고 오해**되는 것
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const P = (...p: string[]) => path.join(__dirname, '..', '..', 'src', ...p);
const decisions = fs.readFileSync(P('app', '(main)', 'admin', 'decisions', 'page.tsx'), 'utf8');
const sms = fs.readFileSync(P('app', '(main)', 'admin', 'outbound-channels', 'SmsChannelSettings.tsx'), 'utf8');

describe('허가 다이얼로그 — 근거 문서 없이 제출할 수 없다', () => {
  it('🔴 허가권자 층은 첨부가 0건이면 제출 버튼이 잠긴다', () => {
    // 2026-10-11 작업대 — 빠진 입력 안내(missing)가 제출 단추를 잠근다: 첨부 0건이면 '근거 문서를 첨부하세요'
    expect(decisions).toMatch(/LICENSE_HOLDER'\s*&&\s*!open\.pendingAttachments\?\.length\s*\?\s*tAttr\('근거 문서를 첨부하세요'\)/);
    expect(decisions).toMatch(/disabled=\{!!missing \|\| save\.isPending\}/);
  });

  it('첨부 업로드 경로가 결정 전용 EP 다(공개 미디어 경로가 아니다)', () => {
    expect(decisions).toContain('/admin/decisions/${p.key}/attachments');
    expect(decisions, '공개 정적 미디어 경로로 법적 문서를 올리면 노출된다').not.toContain('/api/v1/media/upload');
  });

  it('🔴 시스템이 문서 진위를 검증하지 못한다는 사실을 그 자리에서 말한다', () => {
    expect(decisions).toContain('진위');
    expect(decisions).toContain('올라왔는지만');
  });

  it('기록된 근거 문서를 다시 볼 수 있다', () => {
    expect(decisions).toMatch(/record\.attachments\?\.length/);
  });
});

describe('SMS 설정 — 저장이 곧 발송이 아니다', () => {
  it('🔴 제공자 코드가 없으면 그 사실을 먼저 말한다', () => {
    expect(sms).toContain('설정을 저장해도 문자가 나가지 않습니다');
    expect(sms).toContain('서버 로그에만');
  });

  it('🔴 저장 성공 문구가 "켜졌다"로 읽히지 않는다', () => {
    expect(sms).toContain('아직 발송되지 않습니다');
    expect(sms, '성공 토스트만 띄우면 켜진 줄 안다').not.toMatch(/toast\.success\('설정을 저장했습니다'\)/);
  });

  it('발송 조건 3가지를 분모와 함께 낸다 — 하나만 보고 "설정했다"고 하지 않는다', () => {
    expect(sms).toMatch(/\{done\}<\/b>\/3/);
    expect(sms).toContain('위탁계약');
    expect(sms).toContain('제공자 코드 구현');
  });

  it('위탁계약 상태는 결정 등록부에서 읽는다 — 여기서 다시 적지 않는다', () => {
    expect(sms).toContain("legal.sms.entrustment");
  });
});
