'use client';

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/browser';
import { apiClient } from './api-client';

/**
 * step-up 생체 assertion 만 획득(검증/토큰발급 없이) — 푸시 승인 등 호출측이 직접 검증 엔드포인트에 전달.
 * (requestStepUp 은 verify 까지 해 토큰을 발급하므로, 서버측 바인딩 검증이 필요한 경로는 본 함수 사용.)
 */
export async function getStepUpAssertion(): Promise<AuthenticationResponseJSON> {
  const { data: options } = await apiClient.post<{ data: PublicKeyCredentialRequestOptionsJSON }>(
    '/api/v1/auth/step-up/options',
    {},
  );
  return startAuthentication({ optionsJSON: options });
}

export const passkeySupported = () => browserSupportsWebAuthn();
export const platformAuthAvailable = () => platformAuthenticatorIsAvailable();

/** 로그인 사용자가 현재 기기에 패스키 추가 등록 (FR-02) */
export async function registerPasskey(deviceName?: string) {
  const { data: options } = await apiClient.post<{ data: PublicKeyCredentialCreationOptionsJSON }>(
    '/api/v1/auth/passkey/register/options',
    {},
  );
  const attResp = await startRegistration({ optionsJSON: options });
  return apiClient.post('/api/v1/auth/passkey/register/verify', { response: attResp, deviceName });
}

/** 패스워드리스 로그인 (FR-03/04). 토큰 반환 */
export async function loginWithPasskey(identifier?: string): Promise<{ accessToken: string }> {
  const { data } = await apiClient.post<{
    data: { flowId: string; options: PublicKeyCredentialRequestOptionsJSON };
  }>('/api/v1/auth/passkey/login/options', { identifier });

  const asseResp = await startAuthentication({ optionsJSON: data.options });
  const res = await apiClient.post<{ data: { accessToken: string } }>(
    '/api/v1/auth/passkey/login/verify',
    { flowId: data.flowId, response: asseResp },
  );
  return res.data;
}

/**
 * Step-up 재인증 (FR-09/10) — 고위험 행위 직전 생체 재확인.
 * action·resourceId·bodyHash 바인딩 step-up 토큰 반환 → 호출 측이 x-step-up-token 헤더로 사용.
 */
export async function requestStepUp(
  action: string,
  resourceId?: string,
  bodyHash?: string,
): Promise<{ stepUpToken: string }> {
  const { data: options } = await apiClient.post<{ data: PublicKeyCredentialRequestOptionsJSON }>(
    '/api/v1/auth/step-up/options',
    {},
  );
  const asseResp = await startAuthentication({ optionsJSON: options });
  const res = await apiClient.post<{ data: { stepUpToken: string } }>('/api/v1/auth/step-up/verify', {
    response: asseResp,
    action,
    resourceId,
    bodyHash,
  });
  return res.data;
}

/** 디바이스 등록(직원 측): 인증번호 → 패스키 등록 (FR-30) */
export async function enrollDevice(sessionId: string, code: string, deviceName?: string) {
  const { data: options } = await apiClient.post<{ data: PublicKeyCredentialCreationOptionsJSON }>(
    `/api/v1/staff-devices/enroll/${sessionId}/claim`,
    { code },
  );
  const attResp = await startRegistration({ optionsJSON: options });
  return apiClient.post(`/api/v1/staff-devices/enroll/${sessionId}/register`, {
    code,
    response: attResp,
    deviceName,
  });
}
