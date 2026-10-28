import { z } from 'zod';
import { reportNoAiEgressAllowlist } from './util/ai-egress-url';
import { devSwitchOn, releaseSecurityFindings } from './release-security';

/**
 * 환경변수 런타임 검증 스키마
 * 애플리케이션 시작 시 필수 환경변수를 검증하여 누락 시 명확한 에러를 제공합니다.
 */
export const envSchema = z.object({
  // Database
  DATABASE_URL: z
    .string()
    .url('DATABASE_URL은 유효한 PostgreSQL 접속 URL이어야 합니다')
    .startsWith('postgresql://', 'DATABASE_URL은 postgresql:// 으로 시작해야 합니다'),

  // Redis
  REDIS_URL: z
    .string()
    .default('redis://localhost:6379'),

  // Auth
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET은 최소 32자 이상이어야 합니다'),
  AUTH_REFRESH_SECRET: z
    .string()
    .min(32, 'AUTH_REFRESH_SECRET은 최소 32자 이상이어야 합니다'),

  // Encryption
  ENCRYPTION_KEY: z
    .string()
    .length(64, 'ENCRYPTION_KEY는 64자 hex 문자열이어야 합니다 (AES-256)')
    .regex(/^[0-9a-f]+$/i, 'ENCRYPTION_KEY는 hex 문자열이어야 합니다')
    // 🔴 2026-08-25: 종전 조건은 `NODE_ENV !== 'production'` 이었다 — 그런데 운영 서버에
    //    **NODE_ENV 가 설정돼 있지 않다.** 그래서 운영에서 이 검증이 한 번도 발동하지 않았다
    //    (같은 함정의 4번째 사례 — fake 본인확인 어댑터·development attestation·Swagger 공개).
    //    all-zeros 키는 **어디서도 허용할 이유가 없다.** 위험한 쪽을 명시적 옵트인으로만 연다.
    // 🔴 2026-08-25 — 이 검증을 fail-fast 로 바꿨더니 **운영 API 가 부팅에 실패했다**:
    //    운영 ENCRYPTION_KEY 가 실제로 all-zeros 였다(종전 조건이 NODE_ENV==='production' 이라
    //    운영에 그 변수가 없어 한 번도 발동하지 않았고, 그래서 아무도 몰랐다).
    //    🔴 **키를 바꾸면 기존 암호문(주민번호·여권 등 PID)을 복호화할 수 없다** — 교체는
    //    키 로테이션(재암호화 마이그레이션) 작업이고 사람 결정이다. 그때까지 서비스를 죽이지 않는다.
    //    → 부팅은 시키되 **매 부팅 경고를 남긴다**. 침묵하지 않고, 막지도 않는다.
    //    등재: 실서비스 전환 전 필수(키 로테이션) — production-operations.md §11.
    .superRefine((v, ctx) => {
      if (!/^0+$/.test(v)) return;
      // 🔴 T4-3 — REAL 은 옵트인이 먹지 않는다(아래 validateEnv 가 all-zeros 키로 부팅을 거부한다)
      if (devSwitchOn('ALLOW_INSECURE_ENCRYPTION_KEY')) return;
      // eslint-disable-next-line no-console
      console.warn(
        '\n🔴 ENCRYPTION_KEY 가 all-zeros 입니다 — PID 암호화가 사실상 무력합니다.\n' +
        '   키 교체는 기존 암호문 재암호화(로테이션)를 동반합니다 — 실서비스 전환 전 필수 작업으로 등재돼 있습니다.\n' +
        '   이 경고를 인지했다면 ALLOW_INSECURE_ENCRYPTION_KEY=true 로 명시하세요(경고가 사라집니다).\n',
      );
      void ctx;
    }),

  // Server
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('debug'),

  // Optional: AI Server
  AI_SERVER_URL: z.string().url().optional(),

  // 🔴 AI 전송 목적지 허용 호스트(쉼표 구분). **미설정이면 외부 호스트로의 AI 전송이 전부 차단된다**
  //    (fail-closed · 원내 사설망 목적지는 예외). 막지는 않고 부팅 시 1회 ERROR 로 말한다 — 아래 validateEnv().
  AI_EGRESS_ALLOWED_HOSTS: z.string().optional(),

  // CORS
  CORS_ORIGIN: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * 환경변수를 검증하고 파싱된 설정을 반환합니다.
 * 검증 실패 시 명확한 에러 메시지를 출력하고 프로세스를 종료합니다.
 */
export function validateEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    console.error('\n╔══════════════════════════════════════════════════╗');
    console.error('║  ❌ 환경변수 검증 실패                            ║');
    console.error('╠══════════════════════════════════════════════════╣');

    for (const [key, msgs] of Object.entries(errors)) {
      console.error(`║  ${key}:`);
      msgs?.forEach((msg) => console.error(`║    → ${msg}`));
    }

    console.error('╚══════════════════════════════════════════════════╝');
    console.error('\n.env.example 파일을 참고하여 환경변수를 설정해 주세요.\n');
    process.exit(1);
  }

  // 🔴 부팅 시 1회 — `AI_EGRESS_ALLOWED_HOSTS` 미설정은 이제 "통제 없음"이 아니라 **외부 AI 전송 차단**이다.
  //    부팅을 막지는 않는다(원내 사설망 목적지는 여전히 동작하고, AI 는 임상 필수 경로가 아니다).
  //    대신 배포 직후 "AI 가 전부 UNAVAILABLE 인데 이유를 모르는" 상황을 만들지 않도록 로그로 말한다.
  //    ENCRYPTION_KEY all-zeros 와 같은 취급 — 침묵하지 않고, 막지도 않는다.
  reportNoAiEgressAllowlist();

  // 🔴 (2026-09-13 상용 릴리즈 T4) 판매본 보안 기본값 — REAL 빌드는 공개 개발 비밀·개발 편의 스위치·all-zeros 키로
  //    **부팅하지 않는다.** DEV·REHEARSAL 은 막지 않고 매 부팅 경고만 남긴다(운영 his.example.org 은 REHEARSAL).
  //    판정 정본 `release-security.ts` — 순수 함수라 테스트가 env 를 넘겨 판정을 본다.
  const sec = releaseSecurityFindings(process.env);
  for (const w of sec.warn) {
    // eslint-disable-next-line no-console
    console.warn(`⚠️  [보안 기본값 · ${sec.mode}] ${w.key}: ${w.reason}`);
  }
  if (sec.refuse.length > 0) {
    console.error('\n╔══════════════════════════════════════════════════╗');
    console.error('║  ❌ REAL 모드 보안 기본값 위반 — 부팅을 거부합니다   ║');
    console.error('╠══════════════════════════════════════════════════╣');
    for (const r of sec.refuse) console.error(`║  ${r.key}: ${r.reason}`);
    console.error('╚══════════════════════════════════════════════════╝');
    console.error('\n.env.example 의 [판매본 필수] 절을 참고하세요. 개발기라면 HIS_MODE=DEV 를 명시하세요.\n');
    process.exit(1);
  }

  return result.data;
}
