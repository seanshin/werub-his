'use client';

import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';

// 공개(토큰) 온보딩 API — staff apiClient 미사용(상대경로 fetch).
async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  // 🔴 (2026-09-14) 종전 `res.json().catch(() => ({}))` 는 성공 응답을 해석하지 못해도 `{}` 를 데이터로 돌려줬다 —
  //    화면이 "빈 프로필·빈 서류 목록"을 사실처럼 그린다. 본문이 비면(204 등) null, 해석 실패는 성공이어도 실패로 던진다.
  const text = await res.text();
  let json: any = null;
  let parseFailed = false;
  if (text.trim()) {
    try { json = JSON.parse(text); } catch { parseFailed = true; }
  }
  if (res.ok && parseFailed) throw new Error(`응답을 해석하지 못했습니다 (${res.status})`);
  if (!res.ok) {
    const err = json?.error ?? json?.message ?? json;
    throw new Error(err?.message || err?.code || `요청 실패 (${res.status})`);
  }
  return (json === null ? null : (json.data ?? json)) as T;
}

const base = (token: string) => `/api/v1/onboarding/${encodeURIComponent(token)}`;

export const onboardingApi = {
  view: (t: string) => req<any>('GET', base(t)),
  welcome: (t: string) => req<any>('GET', `${base(t)}/welcome`),
  ackWelcome: (t: string) => req<any>('POST', `${base(t)}/welcome/ack`),
  claim: (t: string, birthDate: string) => req<{ provisionalUserId: string }>('POST', `${base(t)}/claim`, { birthDate }),
  getProfile: (t: string) => req<any>('GET', `${base(t)}/profile`),
  putProfile: (t: string, p: Record<string, unknown>) => req<any>('PUT', `${base(t)}/profile`, p),
  listDocuments: (t: string) => req<any[]>('GET', `${base(t)}/documents`),
  signContract: (t: string, p?: Record<string, unknown>) => req<any>('POST', `${base(t)}/contract/sign`, p ?? {}),
  uploadDocument: (t: string, category: string, file: File) => {
    const fd = new FormData();
    fd.append('category', category);
    fd.append('file', file);
    return req<any>('POST', `${base(t)}/documents`, fd);
  },
};

// 생체등록(서버 챌린지) — 기존 passkey 백엔드(온보딩 토큰 경유)
export async function registerOnboardingBiometric(token: string, deviceName?: string) {
  const options = await req<PublicKeyCredentialCreationOptionsJSON>('POST', `${base(token)}/passkey/register/options`);
  const attResp = await startRegistration({ optionsJSON: options });
  return req<any>('POST', `${base(token)}/passkey/register/verify`, { response: attResp, deviceName });
}
