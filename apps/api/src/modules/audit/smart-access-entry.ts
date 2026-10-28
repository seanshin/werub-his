/**
 * 외부 SMART 앱 접근 기록 항목 구성 — 순수 로직.
 *
 * 왜 별도 기록인가: `AuditLog.userId` 는 User FK 필수라 **사용자 없는 클라이언트 접근**
 * (client_credentials·system/*)을 담을 수 없다. 그래서 주체가 클라이언트인 접근은
 * SmartAccessLog 에 남기고, per-user launch 면 userId 도 함께 채워 두 축(클라이언트·사용자)으로 집계한다.
 */

export interface SmartAccessEntry {
  clientId: string;
  clientName?: string;
  userId?: string;
  patientId?: string;
  resourceType: string;
  action: 'read' | 'search' | 'write';
  path: string;
  scope?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/fhir/R4/Observation/<id>` → { resourceType:'Observation', id } · 단건/검색 구분 */
export function parseFhirPath(path: string): { resourceType: string; id?: string } | null {
  const m = /^\/fhir\/(?:R4|r4)\/([A-Za-z]+)(?:\/([^/?]+))?/.exec(path);
  if (!m) return null;
  return { resourceType: m[1], id: m[2] || undefined };
}

/** fhirUser 클레임(`Practitioner/<uuid>`)에서 의료진 UUID — 형식이 다르면 남기지 않는다(오귀속 금지) */
export function userIdFromFhirUser(fhirUser?: string): string | undefined {
  if (!fhirUser) return undefined;
  const id = fhirUser.split('/').pop() ?? '';
  return UUID.test(id) ? id : undefined;
}

/** 대상 환자 — 토큰 문맥 우선, 없으면 요청 파라미터(patient/subject), Patient 단건은 경로 id */
export function targetPatientId(
  parsed: { resourceType: string; id?: string },
  tokenPatient?: string,
  query?: Record<string, unknown>,
): string | undefined {
  if (tokenPatient && UUID.test(tokenPatient)) return tokenPatient;
  if (parsed.resourceType.toLowerCase() === 'patient' && parsed.id && UUID.test(parsed.id)) return parsed.id;
  const raw = String((query?.patient ?? query?.subject ?? '') || '');
  const id = raw.includes('/') ? raw.split('/').pop()! : raw;
  return UUID.test(id) ? id : undefined;
}

/** 요청 하나를 기록 항목으로 — FHIR 경로가 아니면 기록 대상이 아니다(null) */
export function buildSmartAccessEntry(input: {
  path: string;
  method: string;
  smartClient: { client_id: string; scope?: string; patient?: string; fhirUser?: string };
  clientName?: string;
  query?: Record<string, unknown>;
}): SmartAccessEntry | null {
  const parsed = parseFhirPath(input.path);
  if (!parsed) return null;
  const method = input.method?.toUpperCase?.() ?? "GET";
  const action: SmartAccessEntry['action'] = method === 'GET' ? (parsed.id ? 'read' : 'search') : 'write';
  return {
    clientId: input.smartClient.client_id,
    clientName: input.clientName,
    userId: userIdFromFhirUser(input.smartClient.fhirUser),
    patientId: targetPatientId(parsed, input.smartClient.patient, input.query),
    resourceType: parsed.resourceType,
    action,
    path: input.path.slice(0, 300),
    scope: input.smartClient.scope?.slice(0, 500),
  };
}
