import jwt from 'jsonwebtoken';

/**
 * 🔴 Jitsi(Prosody) JWT 서명 **정본** — 외부 점검(HIS → Jitsi).
 *
 * 같은 서명 코드가 세 곳에 따로 있었다(P12 — 같은 사실에 정본이 셋):
 *   · `telehealth.service.ts` generateJitsiToken
 *   · `consult.service.ts` buildJitsiToken (context.user 에 email·avatar 가 없어 payload 모양이 달랐다)
 *   · `remote-consultation.service.ts` (인라인 `jwt.sign`)
 * 세 곳이 각자 `JITSI_JWT_APP_ID`/`JITSI_JWT_DOMAIN` 기본값을 다시 적고 있었고, 만료도 각자 '2h' 였다.
 * 한 곳만 고치면 갈라진다 — 여기 하나로 모은다.
 *
 * 🔴 **표시명은 부르는 사람의 이름이다.** 회의방 참가자 이름표는 "그 자리에 누가 있는가"를 말하는 것이라
 *    요청자가 아닌 사람(특히 환자)의 이름을 붙이면 화면이 거짓을 말한다. 호출부는 `userName` 에
 *    **토큰을 받는 당사자의 이름**만 넘긴다.
 */

export interface JitsiEnv {
  /** HS256 공유 비밀 — Prosody `JWT_APP_SECRET` 과 같은 값 */
  secret: string;
  /** `JITSI_JWT_APP_ID` — Prosody `JWT_ACCEPTED_ISSUERS`/`AUDIENCES` */
  appId: string;
  /** `JITSI_JWT_DOMAIN` — Prosody 내부 XMPP 도메인(`sub`) */
  domain: string;
}

export interface JitsiTokenOptions {
  roomName: string;
  /** 🔴 토큰을 받는 당사자의 표시명(남의 이름을 넣지 않는다) */
  userName: string;
  userId: string;
  email?: string;
  isModerator: boolean;
  /** 기본 2시간 — 회의 길이보다 길게 두지 않는다 */
  expiresIn?: string | number;
}

/**
 * env 에서 Jitsi 서명 설정을 읽는다. 비밀이 없으면 `null`(호출부가 "설정되지 않았다"고 말하게 한다).
 * 🔴 `cfg.get('KEY')` 모양을 유지한다 — `.env.example` 대조 스캐너(`scripts/env-keys-scan.mjs`)가
 *    ConfigService 경로를 이 모양으로 찾는다. 익명 함수로 감싸면 키가 시야에서 사라진다.
 */
export function readJitsiEnv(cfg: { get: (key: string) => string | undefined }): JitsiEnv | null {
  const secret = cfg.get('JITSI_JWT_SECRET');
  if (!secret) return null;
  return {
    secret,
    appId: cfg.get('JITSI_JWT_APP_ID') || 'hospitalrun',
    domain: cfg.get('JITSI_JWT_DOMAIN') || 'meet.jitsi',
  };
}

/** Jitsi JWT 서명 — payload 모양의 정본. */
export function signJitsiToken(env: JitsiEnv, opts: JitsiTokenOptions): string {
  return jwt.sign(
    {
      context: {
        user: {
          id: opts.userId,
          name: opts.userName,
          email: opts.email || '',
          avatar: '',
          affiliation: opts.isModerator ? 'owner' : 'member',
        },
      },
      moderator: opts.isModerator,
      aud: env.appId,
      iss: env.appId,
      sub: env.domain,
      room: opts.roomName,
    },
    env.secret,
    { expiresIn: (opts.expiresIn ?? '2h') as jwt.SignOptions['expiresIn'] },
  );
}
