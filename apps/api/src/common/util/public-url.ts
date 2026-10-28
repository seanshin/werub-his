/**
 * 자기 공개 base URL 단일 해석기(배치중립 N1 — 위치 가정 금지).
 * 콜백/딥링크/발급문서 URL의 하드코딩 폴백(his.example.org)을 제거 — 배치를 바꾸면
 * env 하나만 세팅하면 되고, 미설정 시 조용히 원 병원으로 가는 대신 상대경로가 된다.
 * 별칭 수용: PUBLIC_BASE_URL 정본, APP_BASE_URL·FRONTEND_URL·PUBLIC_URL 하위호환.
 */
export function publicBaseUrl(): string {
  const v = process.env.PUBLIC_BASE_URL
    || process.env.APP_BASE_URL
    || process.env.FRONTEND_URL
    || process.env.PUBLIC_URL
    || '';
  return v.replace(/\/$/, '');
}

/** FHIR issuer — publicBaseUrl과 같을 수도 다를 수도(표준 issuer). FHIR_ISS 우선. */
export function fhirIssuer(): string {
  return (process.env.FHIR_ISS || publicBaseUrl()).replace(/\/$/, '');
}
