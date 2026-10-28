import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { scanFileFlows, countByAuth, stripCommentLines } from './file-access-scan';
import { safeUploadSegment } from '../../src/common/util/upload-url';

const SRC = path.resolve(__dirname, '../../src');

/**
 * 첨부·미디어 접근 통제(2026-09-16 G4).
 *
 * 🔴 이 가드가 지키는 것은 **"파일 바이트를 드나들게 하는 자리가 조용히 늘지 않는다"** 하나다.
 *    분류는 상한이지 확정이 아니다 — 소유 대조는 별개 축(D2/E2 의 중첩 경로 가드)이 본다.
 */
describe('🔴 파일 바이트 입출력 자리 — 조용히 늘지 않는다', () => {
  const rows = scanFileFlows(SRC);

  it('대조군 — 스캐너가 실제로 자리를 찾는다(0건이면 정규식이 죽은 것)', () => {
    expect(rows.length).toBeGreaterThan(15);
    expect(rows.some((r) => r.kind === 'upload')).toBe(true);
    expect(rows.some((r) => r.kind === 'serve')).toBe(true);
  });

  it('총계·인증 수단별 수가 기준선과 같다(늘면 새 표면 · 줄면 이 수를 내린다)', () => {
    // 2026-09-28 +1: 경영성과 벤치마크 공시 CSV 가져오기(`finance-benchmark` · ADMIN 가드 · 메모리 버퍼 파싱만 — 디스크에 쓰지 않음)
    // 2026-09-29 +1: 오더 결과지 첨부(`POST orders/:id/result/attachments` · JWT+@Roles 가드 · 서비스가 시행 직종(canExecuteOrder) 확인 ·
    //   `/uploads/order-results` 는 서명 게이트 뒤 — 응답 URL 은 UploadUrlSignInterceptor 가 서명)
    // 2026-10-02 +1: 초진 동의서 종이 스캔 등록(`POST patients/:patientId/registration-consents/collect/paper-scan` · JWT+@Roles 가드 ·
    //   jpeg/png/webp/pdf · 10MB · `/uploads/consent` 는 서명 게이트 뒤 — 기존 동의서 첨부와 같은 디렉터리)
    expect(rows.length).toBe(26);
    expect(countByAuth(rows)).toEqual({ guard: 19, hmac: 7 });
  });

  it('🔴 인증 없이 바이트를 내보내는 자리는 없다 — 정적 서빙 2곳은 별도 게이트', () => {
    expect(rows.filter((r) => r.auth === 'public')).toEqual([]);
  });

  /**
   * 정적 마운트는 핸들러가 아니라 main.ts 라 위 스캔에 안 잡힌다 — 따로 못박는다.
   * `/uploads` 는 PHI(환자 사진·여권 사본·동의서 스캔)라 서명 게이트가 **먼저** 와야 한다.
   */
  it('🔴 /uploads 정적 서빙 앞에 서명 게이트가 있다(순서까지)', () => {
    const main = stripCommentLines(readFileSync(path.join(SRC, 'main.ts'), 'utf8'));
    // 🔴 `indexOf('verifyUploadSignature')` 로 재면 **import 문**이 먼저 잡혀, 마운트를 게이트 앞으로
    //    옮기는 재주입이 그대로 통과했다(CLAUDE.md §3 "import 문이 검사를 대신 통과"). 미들웨어 등록
    //    자체를 겨눈다.
    const gate = main.indexOf("app.use('/uploads'");
    const mount = main.indexOf("useStaticAssets(join(process.cwd(), 'uploads')");
    expect(gate, "'/uploads' 서명 게이트 미들웨어가 없다").toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(-1);
    expect(gate, '서명 게이트가 정적 마운트보다 뒤에 있으면 무인증으로 열린다').toBeLessThan(mount);
    // 게이트가 실제로 서명을 검증하는지(빈 미들웨어가 순서만 맞추지 않게)
    expect(main.slice(gate, mount)).toContain('verifyUploadSignature(');
  });
});

/**
 * 🔴 저장 경로 세그먼트 — 종전 `replace(/[^a-zA-Z0-9._-]/g,'')` 는 `.`·`-` 를 허용해
 *    `..` 가 그대로 살아남았다. 같은 자리의 주석은 "서비스가 검증하므로 안전"이라 적혀 있었으나,
 *    그 검증은 핸들러에서 일어나고 multer destination 은 **그보다 먼저** 돈다.
 */
describe('🔴 업로드 저장 경로 세그먼트 — 디렉터리 밖으로 새지 않는다', () => {
  it('상위 이동·점만 있는 이름을 거부한다', () => {
    for (const bad of ['..', '.', '...', '....', '', '   ', '/', '../..']) {
      expect(safeUploadSegment(bad), `거부해야 한다: ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it('대조군 — 정상 키는 그대로 통과한다(막기만 하면 업로드가 죽는다)', () => {
    expect(safeUploadSegment('legal.ai.deviceClassification')).toBe('legal.ai.deviceClassification');
    expect(safeUploadSegment('inst.custom-1')).toBe('inst.custom-1');
    expect(safeUploadSegment('KR-045')).toBe('KR-045');
  });

  it('경로 구분자를 품은 입력도 한 세그먼트로 접힌다', () => {
    // Express 가 %2f 를 디코드해 넘겨도 `/` 는 제거된다 — 깊은 탈출 불가
    expect(safeUploadSegment('a/../b')).toBe('a..b');
  });

  it('🔴 두 업로드 destination 이 이 정본을 쓴다(각자 구현하면 한쪽만 고쳐진다)', () => {
    for (const rel of [
      'modules/opening/opening.controller.ts',
      'modules/decision-registry/decision.controller.ts',
    ]) {
      const src = stripCommentLines(readFileSync(path.join(SRC, rel), 'utf8'));
      expect(src, `${rel} 가 safeUploadSegment 를 쓰지 않는다`).toContain('safeUploadSegment(');
      expect(src, `${rel} 에 옛 인라인 정제가 남아 있다`).not.toMatch(/\.replace\(\/\[\^a-zA-Z0-9\._-\]\/g/);
    }
  });
});
