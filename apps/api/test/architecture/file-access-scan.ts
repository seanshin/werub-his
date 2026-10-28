import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 첨부·미디어 접근 통제 계측(2026-09-16 G4) — 파일 바이트가 드나드는 자리를 전부 센다.
 *
 * 이 축의 실패 모양: **파일 경로만 알면 남의 검사지·동의서·여권 사본을 받는다.**
 * 실제 이력 — `/uploads` 정적 서빙이 무인증이라 `/uploads/patients/<patientId>/photo.jpg` 가
 * 완전히 예측 가능했다(2026-07 회수). `<img src>`·`<audio src>` 는 Authorization 헤더를
 * 실을 수 없으므로, 이 저장소의 정본 패턴은 **HMAC 단기 토큰**(경로·만료에 바인딩)이다.
 *
 * 🔴 분류는 상한이지 확정이 아니다. `공개` 로 분류됐다고 결함이 아니고(전광판·헬스체크),
 *    `가드` 로 분류됐다고 안전한 것도 아니다(소유 대조는 별개 축 — D2/E2 가 본다).
 *    이 계측이 지키는 것은 **"바이트를 내보내는 자리가 조용히 늘지 않는다"** 하나다.
 */

export type FileFlowKind = 'upload' | 'serve';
/** 인증 수단 — 파일 바이트에 도달하기 위해 무엇을 통과해야 하는가 */
export type FileAuthKind = 'guard' | 'hmac' | 'signed-static' | 'public';

export interface FileFlowRow {
  file: string;
  line: number;
  kind: FileFlowKind;
  auth: FileAuthKind;
  /** 요청 값(파라미터·쿼리·바디)이 디스크 경로 계산에 들어가는가 */
  pathFromRequest: boolean;
}

/** 업로드 진입점 — multer 인터셉터 */
const UPLOAD = /@UseInterceptors\(\s*(?:Any)?Files?Interceptor\(|^\s*(?:Any)?Files?Interceptor\(/;
/** 바이트를 내보내는 자리 — 스트림·버퍼 전송 */
const SERVE = /createReadStream\(|\.sendFile\(|res\.download\(|new StreamableFile\(|res\.(?:send|end)\(\s*(?:buf|buffer|pdf)/i;
/**
 * HMAC 단기 토큰(정본 패턴).
 * 🔴 첫 판은 검증 코드(`timingSafeEqual`)만 찾아 **정본 패턴을 쓰는 두 컨트롤러를 '무인증'으로** 셌다 —
 *    검증은 서비스에 있고 컨트롤러는 토큰을 받아 넘기기만 한다(진료 첨부·스크라이브 오디오).
 *    토큰을 **받는 자리**(`@Query('token')`·`@Query('exp')`·`:token` 경로)도 같이 본다.
 */
const HMAC = /timingSafeEqual|verify\w*Token|verifyUploadSignature|@Query\(\s*'(?:token|exp|t|rt|ut)'|@Param\(\s*'token'|:token\b/;
/** 인증 가드 */
const GUARD = /@UseGuards\(/;
/** 요청 값이 경로 계산에 들어가는 자리 */
const PATH_FROM_REQ = /join\([^)]*\b(?:req\.params|params\.|fname|filename|folder|key|encounterId|id)\b/;

const SKIP_DIR = new Set(['node_modules', 'dist', '.next']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIR.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/**
 * 🔴 주석·문자열을 코드로 읽지 않는다 — 이 저장소에서 두 번 났다(E4 의 스캐너가 자기 주석의
 *    `.catch(() => undefined)` 를 세어 고친 파일을 "여전히 삼킨다"고 했고, D4 의 주석 제거기가
 *    문자열 `(system/*)` 를 주석 시작으로 읽어 9,057자를 지웠다).
 *    줄 단위 제거라 블록 주석 안의 코드형 문자열까지 완벽히 가리지는 못한다(상한).
 */
export function stripCommentLines(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (inBlock) {
      out.push('');
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (line.startsWith('/*')) {
      out.push('');
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    if (line.startsWith('//') || line.startsWith('*')) {
      out.push('');
      continue;
    }
    out.push(raw);
  }
  return out.join('\n');
}

export function scanFileFlows(srcDir: string): FileFlowRow[] {
  const rows: FileFlowRow[] = [];
  for (const f of walk(srcDir)) {
    const src = stripCommentLines(readFileSync(f, 'utf8'));
    const lines = src.split('\n');
    const whole = src;
    const rel = relative(srcDir, f);

    lines.forEach((line, i) => {
      const isUpload = UPLOAD.test(line);
      const isServe = SERVE.test(line);
      if (!isUpload && !isServe) return;

      // 인증 수단은 파일 단위로 본다(가드는 클래스에, 토큰 검증은 서비스에 있을 수 있다).
      const auth: FileAuthKind = HMAC.test(whole)
        ? 'hmac'
        : GUARD.test(whole)
          ? 'guard'
          : 'public';

      rows.push({
        file: rel,
        line: i + 1,
        kind: isUpload ? 'upload' : 'serve',
        auth,
        pathFromRequest: PATH_FROM_REQ.test(whole),
      });
    });
  }
  return rows.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function countByAuth(rows: FileFlowRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.auth] = (out[r.auth] ?? 0) + 1;
  return out;
}
