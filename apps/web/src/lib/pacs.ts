'use client';

import { toast } from '@/stores/toast-store';
import { apiClient } from './api-client';

/**
 * PACS 뷰어를 SSO 토큰 경유로 연다 (FR-07/08 경로 A).
 *
 * 🔴 대상은 반드시 **OHIF(`/viewer/`)** 다. `/pacs/` 는 Orthanc 이고 자체 Basic 인증
 *    (`WWW-Authenticate: Basic realm="Orthanc Secure Area"`)이 걸려 있어, 링크를 열면
 *    브라우저가 **HIS 로그인과 무관한 아이디/비밀번호 창**을 띄운다(사용자에겐 "왜 또 로그인?").
 *    HIS 프록시가 발급하는 URL 도 `/viewer/?StudyInstanceUIDs=...&token=...` 형태다.
 * - studyUid 있으면 기존 pacs-proxy viewer URL(스터디별 토큰)
 * - 없으면 sso-idp grant(audience=ohif) 단기 토큰으로 OHIF 홈 진입
 * 실패 시에도 PACS는 열리도록 폴백.
 */
export async function openPacsViewer(studyUid?: string, patientMrn?: string) {
  try {
    if (studyUid) {
      const { data } = await apiClient.get<{ data: { url: string } }>(
        `/api/v1/pacs/viewer/${encodeURIComponent(studyUid)}`,
      );
      window.open(data.url, '_blank', 'noopener,noreferrer');
      return;
    }
    const { data } = await apiClient.post<{ data: { mode: string; token?: string } }>(
      '/api/v1/sso/internal/grant',
      { audience: 'ohif' },
    );
    const qs = new URLSearchParams();
    if (patientMrn) qs.set('PatientID', patientMrn);
    if (data.token) qs.set('token', data.token);
    const url = qs.toString() ? `/viewer/?${qs.toString()}` : '/viewer/';
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (e) {
    // 🔴 (2026-09-14) 폴백은 유지하되(막으면 방치된다) 조용히 하지 않는다 — 특정 검사·환자로 열지 못하고 뷰어 홈이 열린다는 사실을
    //    그 자리에서 말한다. 종전엔 사용자가 "그 환자의 영상"을 보고 있다고 믿을 수 있었다.
    if (studyUid || patientMrn) {
      toast.warning('영상을 이 검사·환자로 열지 못해 뷰어 홈을 엽니다 — 대상 검사를 직접 찾아야 합니다.');
    }
    console.warn('[pacs] 뷰어 토큰 발급 실패 — 뷰어 홈으로 폴백', (e as { code?: string })?.code ?? e);
    window.open('/viewer/', '_blank', 'noopener,noreferrer');
  }
}
