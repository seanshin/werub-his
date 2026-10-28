import { createHmac, timingSafeEqual } from 'crypto';
import { signingSecret } from './signing-secret';

/**
 * 업로드 파일(PHI) 접근 서명 — 2026-07 파일 접근 권한 전수검토.
 *
 * `/uploads` 는 Express 정적 서빙이라 **인증이 전혀 없었다**(환자 사진·상담/VoC 첨부·
 * 여권 사본·동의서 스캔이 URL 만 알면 누구나 내려받히는 상태). 환자 사진 경로는
 * `/uploads/patients/<patientId>/photo.jpg` 로 **완전히 예측 가능**했다.
 *
 * `<img src>` 는 Authorization 헤더를 실을 수 없으므로, 코드베이스 정본 패턴
 * (스크라이브 오디오·진료 첨부)과 동일하게 **HMAC 단기 토큰**으로 인증한다.
 */

export const UPLOAD_URL_PREFIX = '/uploads/';
/** 서명 유효기간 — 화면 표시에 충분하고 유출 시 창이 짧다 */
export const UPLOAD_TOKEN_TTL_MS = 60 * 60 * 1000;

const secret = () => signingSecret('upload-url');

/** 경로 정규화 — `..`·중복 슬래시 제거(traversal 차단). 정규화 실패 시 null */
export function normalizeUploadPath(pathname: string): string | null {
  if (typeof pathname !== 'string' || !pathname.startsWith(UPLOAD_URL_PREFIX)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const parts = decoded.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  return '/' + parts.join('/');
}

/**
 * 업로드 저장 디렉터리의 **한 세그먼트**(결정 키·개원 항목 키 등)를 안전하게 만든다.
 *
 * 🔴 2026-09-16 G4: 종전 `key.replace(/[^a-zA-Z0-9._-]/g, '')` 는 `.` 과 `-` 를 허용하므로
 *    `..` 가 **그대로 살아남아** 저장 경로가 한 단계 위로 샜다(`uploads/opening/..` = `uploads/`).
 *    `/` 는 걸러지니 더 깊이 나가지는 못하지만, 의도한 디렉터리 밖에 쓰는 것은 부여된 권한이 아니다.
 *    같은 자리의 주석은 "등록부에 있는 키만 통과하므로 안전"이라 적혀 있었으나 **그 검증은 서비스에서
 *    일어난다** — multer 의 destination 콜백은 핸들러보다 먼저 돌아 파일이 이미 디스크에 쓰인 뒤다.
 *    주석이 약속한 보호가 실행 순서 때문에 성립하지 않았다.
 *
 * 통과하지 못하면 `null` — 호출부(destination 콜백)는 업로드를 거부한다.
 */
export function safeUploadSegment(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!s || s === '.' || s === '..') return null;
  // 점만으로 이루어진 이름(`...`)은 정상 키가 아니고 파일시스템마다 해석이 갈린다
  if (/^\.+$/.test(s)) return null;
  return s;
}

export function uploadSignature(normalizedPath: string, exp: number): string {
  return createHmac('sha256', secret()).update(`${normalizedPath}:${exp}`).digest('hex').slice(0, 32);
}

/** 저장 URL → 서명 URL. 이미 서명돼 있거나 uploads 경로가 아니면 그대로 반환 */
export function signUploadUrl(url: string, now = Date.now(), ttlMs = UPLOAD_TOKEN_TTL_MS): string {
  if (typeof url !== 'string' || !url.startsWith(UPLOAD_URL_PREFIX) || url.includes('ut=')) return url;
  const [pathname] = url.split('?');
  const normalized = normalizeUploadPath(pathname);
  if (!normalized) return url;
  const exp = now + ttlMs;
  return `${normalized}?uexp=${exp}&ut=${uploadSignature(normalized, exp)}`;
}

/** 서명 검증 — 만료·위조는 false. 상수시간 비교. */
export function verifyUploadSignature(
  pathname: string,
  exp: unknown,
  token: unknown,
  now = Date.now(),
): boolean {
  const normalized = normalizeUploadPath(pathname);
  if (!normalized) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < now) return false;
  const expected = Buffer.from(uploadSignature(normalized, expNum));
  const given = Buffer.from(String(token ?? ''));
  return expected.length === given.length && timingSafeEqual(expected, given);
}
