import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EXTERNAL_CREDENTIALS,
  EXTERNAL_CREDENTIAL_BY_KEY,
  type ExternalCredentialSpec,
} from './external-credentials';

export interface CredentialStatus {
  key: string;
  label: string;
  configured: boolean;
  /** 설정되지 않은 환경변수 이름들 — **값이 아니라 이름만** */
  missing: string[];
  blocking: ExternalCredentialSpec['blocking'];
  unavailableCode: string;
  neededFor: string[];
  provider: string;
  owner: string;
  notes?: string;
}

/**
 * 외부 자격증명 상태 — **값을 나눠주는 곳이 아니라, 있는지 없는지를 말하는 곳**이다.
 *
 * 🔴 값이 필요한 모듈은 `requireValue()` 로 직접 받되, **미설정이면 예외로 멈춘다.**
 *    `?? 기본값` 으로 이어가지 않는다 — 그렇게 하면 "설정 안 된 채로 도는 기능"이 생기고,
 *    그 기능은 자기가 무엇을 못 하고 있는지 말하지 못한다.
 */
@Injectable()
export class ExternalCredentialsService {
  private readonly logger = new Logger(ExternalCredentialsService.name);

  constructor(private readonly config: ConfigService) {}

  private has(e: string): boolean {
    const v = this.config.get<string>(e) ?? process.env[e];
    return !!v && !!String(v).trim();
  }

  /**
   * 부족한 환경변수 — `env` 는 **전부 필요**(AND), `anyOfEnv` 는 **하나면 충족**(OR).
   * 🔴 둘을 한 배열로 뭉치면 "택일인데 전부 없다"와 "전부 필요한데 하나 없다"가 같은 말이 된다.
   */
  private missingEnv(spec: ExternalCredentialSpec): string[] {
    const missing = spec.env.filter((e) => !this.has(e));
    const anyOf = spec.anyOfEnv ?? [];
    if (anyOf.length > 0 && !anyOf.some((e) => this.has(e))) {
      missing.push(`${anyOf.join(' 또는 ')} 중 하나`);
    }
    return missing;
  }

  isConfigured(key: string): boolean {
    const spec = EXTERNAL_CREDENTIAL_BY_KEY.get(key);
    if (!spec) return false;
    return this.missingEnv(spec).length === 0;
  }

  /** 값을 꺼낸다 — 미설정이면 **되는 척하지 않고** 그 자리에서 멈춘다 */
  requireValue(key: string, env: string): string {
    const spec = EXTERNAL_CREDENTIAL_BY_KEY.get(key);
    const v = this.config.get<string>(env) ?? process.env[env];
    if (!v || !String(v).trim()) {
      throw new ServiceUnavailableException({
        code: spec?.unavailableCode ?? 'DEPENDENCY_UNAVAILABLE',
        message: `외부 자격증명이 설정되지 않았습니다(${spec?.label ?? key}). 담당: ${spec?.owner ?? '미지정'}`,
        details: { credential: key, missingEnv: env },
      });
    }
    return String(v).trim();
  }

  /** 미설정이면 `null` — 기능을 끈 상태로 정직하게 응답할 때 쓴다(FEATURE_OFF) */
  optionalValue(env: string): string | null {
    const v = this.config.get<string>(env) ?? process.env[env];
    return v && String(v).trim() ? String(v).trim() : null;
  }

  status(): CredentialStatus[] {
    return EXTERNAL_CREDENTIALS.map((spec) => {
      const missing = this.missingEnv(spec);
      return {
        key: spec.key,
        label: spec.label,
        configured: missing.length === 0,
        missing,
        blocking: spec.blocking,
        unavailableCode: spec.unavailableCode,
        neededFor: spec.neededFor,
        provider: spec.provider,
        owner: spec.owner,
        notes: spec.notes,
      };
    });
  }

  /** 개시 준비 요약 — 🔴 **합치지 않는다**(FAIL_CLOSED 와 FEATURE_OFF 는 성격이 다르다) */
  summary() {
    const rows = this.status();
    return {
      failClosed: {
        total: rows.filter((r) => r.blocking === 'FAIL_CLOSED').length,
        configured: rows.filter((r) => r.blocking === 'FAIL_CLOSED' && r.configured).length,
      },
      featureOff: {
        total: rows.filter((r) => r.blocking === 'FEATURE_OFF').length,
        configured: rows.filter((r) => r.blocking === 'FEATURE_OFF' && r.configured).length,
      },
    };
  }
}
