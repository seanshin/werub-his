import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AuditAction } from '@prisma/client';
import { AuditService } from './audit.service';
import { NO_AUDIT_KEY, AUDIT_RESOURCE_KEY, AI_READ_KEY } from './no-audit.decorator';
import {
  actionForMethod,
  deriveResourceType,
  extractResourceId,
  isExempt,
  patientIdFromQuery,
  PHI_READ_PATTERNS,
  UUID_RE,
  ZERO_UUID,
} from './audit-routes';
import { buildSmartAccessEntry } from './smart-access-entry';

/** 감사 changes 에 담는 요청 필드 키 상한 — PHI 값은 절대 복사하지 않고 '무엇이 바뀌었는지'만 남김 */
const MAX_FIELD_KEYS = 40;

const UUID_FULL = new RegExp(`^${UUID_RE}$`, 'i');

/**
 * 🔴 `@AuditAiRead` 가 붙은 환자 지목 AI 조회의 귀속 환자를 찾는다.
 *
 * 감사 규약상 열람 기록의 `resourceId` 는 **환자**다. 그런데 이 EP 들은 경로가
 * `orders/:orderId`·`visits/:id` 처럼 환자를 직접 담지 않는 경우가 많다.
 * 응답 → 라우트 파라미터 → 쿼리 순으로 찾고, **못 찾으면 못 찾았다고 적는다**
 * (`patientBound=false`). 모르는 값을 patientId 인 척 넣지 않는다.
 */
function resolveAiPatient(responseData: any, params: any, query: any): { patientId: string | null; via: string } {
  const cands: Array<[string, unknown]> = [
    ['response', responseData?.data?.patientId ?? responseData?.patientId],
    ['param', params?.patientId],
    ['query', query?.patientId],
  ];
  for (const [via, v] of cands) {
    if (typeof v === 'string' && UUID_FULL.test(v)) return { patientId: v, via };
  }
  return { patientId: null, via: 'none' };
}

/**
 * 🔴 직원 JWT 로 부른 `/fhir/R4/*` 열람 — 2026-08-27 신설.
 *
 * SMART 토큰은 위쪽 분기에서 `SmartAccessLog` 로 남는다. 그런데 **직원 JWT 경로는 아무 데도 안 남았다**:
 * `PHI_READ_PATTERNS` 는 `/fhir/R4/Patient`(검색)를 모르고 쿼리에 `patientId` 도 없다.
 * 운영 실측(2026-08-27) — 급양 계정이 `GET /fhir/R4/Patient` 로 **환자 873명**을 받았는데
 * `audit_logs` 에 그 열람 행이 **0건**이었다.
 *
 * 🔴 **몇 명이 나갔는지 함께 남긴다** — FHIR 는 한 번에 다수가 나가는 자리라
 *    "누가 열람했다"만으로는 규모를 알 수 없다.
 */
function fhirResourceType(path: string): string {
  // `/fhir/R4/Patient`·`/fhir/R4/Patient/<id>`·`/fhir/R4/metadata`
  const m = /^\/fhir\/[^/]+\/([A-Za-z]+)/.exec(path);
  return m ? `Fhir${m[1]}` : 'FhirRead';
}

function resolveFhirPatient(path: string, params: any, query: any): { patientId: string | null; via: string } {
  const cands: Array<[string, unknown]> = [
    ['param', params?.id],
    ['query', query?.patient ?? query?.subject ?? query?.patientId],
  ];
  for (const [via, raw] of cands) {
    const v = typeof raw === 'string' ? raw.replace(/^Patient\//, '') : raw;
    if (typeof v === 'string' && UUID_FULL.test(v)) return { patientId: v, via };
  }
  // `/fhir/R4/Patient/<uuid>` 처럼 경로 끝이 환자면 그것을 쓴다
  const tail = /\/fhir\/[^/]+\/Patient\/([0-9a-f-]{36})/i.exec(path);
  if (tail) return { patientId: tail[1], via: 'path' };
  return { patientId: null, via: 'none' };
}

/** 번들이면 몇 건이 나갔는지 — 모르면 `null`(0 이라 말하지 않는다) */
function fhirReturnedCount(data: any): number | null {
  if (!data || typeof data !== 'object') return null;
  if (data.resourceType === 'Bundle') {
    if (typeof data.total === 'number') return data.total;
    return Array.isArray(data.entry) ? data.entry.length : null;
  }
  return data.resourceType ? 1 : null;
}

/**
 * 감사 인터셉터 — 변이는 기본 감사 ON(면제만 명시), 열람은 환자 지목 조회만 기록.
 * 규약·판정 근거: audit-routes.ts + docs/03-analysis/audit-coverage-audit-2026-07.md
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const path: string | undefined = request?.path;
    if (!path) return next.handle();

    const { method, user, ip, headers, query, body } = request;
    if (this.reflector.getAllAndOverride<boolean>(NO_AUDIT_KEY, [context.getHandler(), context.getClass()])) {
      return next.handle();
    }

    // 🔴 외부 SMART 앱 접근은 `user.id` 가 없어 아래 감사 경로에서 전부 탈락했다(주체=클라이언트).
    //    AuditLog(userId 필수·User FK)에 담을 수 없으므로 SmartAccessLog 로 남기고,
    //    per-user launch(fhirUser)면 의료진 본인 감사에도 이어 붙인다.
    const smartEntry = request.smartClient
      ? buildSmartAccessEntry({ path, method, smartClient: request.smartClient, query })
      : null;
    if (smartEntry) {
      const shared = { ipAddress: ip, userAgent: headers?.['user-agent'] };
      return next.handle().pipe(
        tap(() => {
          void this.auditService.logSmartAccess({ ...smartEntry, ...shared });
          if (smartEntry.userId && smartEntry.patientId) {
            void this.auditService
              .logReadOnce({
                userId: smartEntry.userId,
                action: 'READ' as AuditAction,
                resourceType: `Fhir${smartEntry.resourceType}`,
                resourceId: smartEntry.patientId,
                changes: { via: { old: null, new: smartEntry.clientId } },
                ...shared,
              })
              .catch(() => {});
          }
        }),
      );
    }
    if (isExempt(path)) return next.handle();

    const mutation = actionForMethod(method);
    // 열람은 ①환자 지목 상세 조회(PHI 경로) ②query.patientId 조회만 — 목록/집계는 대상 아님
    const readPatientId = mutation ? null : patientIdFromQuery(query);
    const phiRead = !mutation && method === 'GET' && PHI_READ_PATTERNS.some((p) => p.test(path));
    // 🔴 환자 지목 AI 조회 — 경로 패턴으로는 잡히지 않아 개통 이래 감사 0 이던 자리(§ai-phi-audit-coverage)
    const aiRead = mutation ? undefined : this.reflector.getAllAndOverride<string>(AI_READ_KEY, [context.getHandler(), context.getClass()]);
    // 🔴 직원 JWT FHIR 열람 — 경로 패턴에도 쿼리에도 안 걸려 개통 이래 감사 0 이던 자리.
    //    (SMART 토큰은 위에서 이미 처리되어 여기 도달하지 않는다.)
    const fhirRead = !mutation && method === 'GET' && path.startsWith('/fhir/');
    if (!mutation && !phiRead && !readPatientId && !aiRead && !fhirRead) return next.handle();

    const action: AuditAction = (mutation ?? 'READ') as AuditAction;
    const resourceType =
      aiRead ??
      (fhirRead ? fhirResourceType(path) : undefined) ??
      this.reflector.getAllAndOverride<string>(AUDIT_RESOURCE_KEY, [context.getHandler(), context.getClass()]) ??
      deriveResourceType(path);

    return next.handle().pipe(
      tap((responseData) => {
        if (!user?.id) return; // 인증되지 않은 요청(서버-서버 통합 키 등)은 actor 특정 불가 — 각 모듈 자체 로그 소관

        // 환자 지목 조회는 대상 환자에 귀속(접근 이력 조회의 축), 그 외는 경로/응답의 리소스 ID
        const ai = aiRead ? resolveAiPatient(responseData, request?.params, query) : null;
        const fhir = fhirRead ? resolveFhirPatient(path, request?.params, query) : null;
        const resourceId =
          ai?.patientId ??
          fhir?.patientId ??
          readPatientId ??
          (ai || fhir ? ZERO_UUID : extractResourceId(path, responseData?.data?.id ?? responseData?.id));

        const entry = {
          userId: user.id,
          action,
          resourceType,
          resourceId,
          // 🔴 환자 귀속에 실패했으면 원장이 그렇게 말한다 — 나중에 "환자별 접근이력"이
          //    이 행을 빠뜨린다는 사실을 숨기지 않기 위해서다.
          changes: mutation
            ? fieldKeys(body)
            : fhir
              // 🔴 몇 명이 나갔는지 함께 남긴다 — FHIR 는 한 번에 다수가 나가는 자리다.
              //    모르면 `unknown`(0 이라 말하지 않는다).
              ? {
                  egress: {
                    old: null,
                    new: `patientBound=${fhir.patientId ? 'true' : 'false'};via=${fhir.via};path=${path};returned=${fhirReturnedCount(responseData) ?? 'unknown'}`,
                  },
                }
            : ai
              ? { egress: { old: null, new: `patientBound=${ai.patientId ? 'true' : 'false'};via=${ai.via};path=${path}` } }
              : undefined,
          ipAddress: ip,
          userAgent: headers?.['user-agent'],
        };

        // 🔴 FHIR 는 **반복 인출 자체가 봐야 할 사실**이라 억제하지 않는다(억제하면 규모가 사라진다).
        const done = action === 'READ' && !fhirRead
          ? this.auditService.logReadOnce(entry) // 동일 열람 반복(폴링·탭 재방문) 억제
          : this.auditService.log(entry);

        done.catch(() => {
          // 감사 로그 실패가 요청을 차단하지 않도록 무시
        });
      }),
    );
  }
}

/** 요청 body 의 필드 키만 기록 — 값(PHI)은 담지 않음 */
function fieldKeys(body: unknown): Record<string, { old: unknown; new: unknown }> | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const keys = Object.keys(body as Record<string, unknown>);
  if (!keys.length) return undefined;
  return { fields: { old: null, new: keys.slice(0, MAX_FIELD_KEYS).join(',') } };
}
