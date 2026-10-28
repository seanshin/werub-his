import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 구조 가드 — **QR 은 로컬에서 만든다. 외부로 내용을 보내지 않는다**(2026-08-18).
 *
 * 봉합한 결함: 8개 화면이 `https://api.qrserver.com/v1/create-qr-code/?data=…` 로
 * QR 내용을 **외부 서버의 URL 쿼리**에 실어 보냈다(외부 접근 로그·리퍼러에 그대로 잔존).
 *   · 환자 팔찌/포털 QR — MRN·성명·생년월일·성별(PHI)
 *   · 기기 페어링 코드·직원 기기 등록 링크·설문 링크(자격증명·토큰)
 * 부수적으로 폐쇄망에서는 QR 이 렌더되지 않아 팔찌·라벨이 빈칸으로 인쇄됐다.
 *
 * 이 가드는 (1) 외부 QR API 재도입, (2) 임의 외부 이미지/iframe 호스트 추가,
 * (3) 환자 QR 페이로드에 PHI 재주입을 막는다.
 */

const ROOTS = [
  path.join(__dirname, '..', '..', 'src'),
  path.join(__dirname, '..', '..', '..', 'homepage', 'src'),
].filter((p) => fs.existsSync(p));

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 주석은 제외하고 본다 — 주석의 "이렇게 하지 말 것" 기록까지 잡으면 가드가 아니라 검열이다 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const FILES = ROOTS.flatMap((r) => walk(r));

/** 외부 호스트 허용 목록 — 추가하려면 폐쇄망·PHI 유출 관점의 근거가 필요하다 */
const ALLOWED_EXTERNAL_HOSTS = new Set(['www.google.com']);

describe('QR 로컬 생성 가드', () => {
  it('파일을 실제로 수집한다(스캔이 비면 가드가 아니다)', () => {
    expect(FILES.length).toBeGreaterThan(300);
  });

  it('외부 QR 생성 API 를 호출하지 않는다', () => {
    const hits = FILES.filter((f) => /qrserver\.com/.test(stripComments(fs.readFileSync(f, 'utf8'))));
    expect(hits.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });

  it('src/href 로 외부 호스트를 직접 부르지 않는다(허용 목록 외)', () => {
    const found: string[] = [];
    for (const f of FILES) {
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      const re = /src=\{?\s*[`"']https?:\/\/([^/`"'\s]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        if (!ALLOWED_EXTERNAL_HOSTS.has(m[1])) found.push(`${path.relative(process.cwd(), f)} → ${m[1]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('환자 식별 QR 페이로드는 정본(buildPatientQr)만 쓴다 — 성명·생년월일·성별 재주입 금지', () => {
    const issuers = [
      'src/app/(main)/patients/[id]/components/PatientHeader.tsx',
      'src/app/portal/_profile/ProfileTab.tsx',
      'src/app/portal/_home/SelfCheckIn.tsx',
    ].map((r) => path.join(__dirname, '..', '..', r));
    for (const f of issuers) {
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      expect(src, `${f} 는 발급 정본을 써야 한다`).toContain('buildPatientQr(');
      expect(/t:\s*'PATIENT'/.test(src), `${f} 에 구 JSON 페이로드가 남아 있다`).toBe(false);
    }
  });
});
