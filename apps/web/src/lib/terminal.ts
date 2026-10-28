'use client';

import { apiClient } from '@/lib/api-client';

// 제로 트러스트 단말 보안 — 프론트 클라이언트 (terminal-zero-trust 설계 §6 / D3)
// 단말 식별자(X-Device-UUID)는 브라우저에 1회 생성·영속(실운영은 단말 에이전트/MDM이 주입).

const DEVICE_KEY = 'terminalDeviceUuid';

export function getDeviceUuid(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `web-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

// 데모/키오스크: 시드된 단말 UUID(TERM-*)로 강제 지정
export function setDeviceUuid(uuid: string): void {
  if (typeof window !== 'undefined') localStorage.setItem(DEVICE_KEY, uuid);
}

export interface SecurityProfile {
  deviceUuid: string;
  mode: 'PUBLIC' | 'PRIVATE';
  roleClass: 'CLINICIAN' | 'STAFF';
  ui: string[];
  clinicalFeatures: boolean;
  stepUpHighRisk: boolean;
  lockTimeoutSec: number;
  selfScopeOnly: boolean;
  dedicated: boolean;
  registered: boolean;
}

function withDevice(): Record<string, string> {
  return { 'X-Device-UUID': getDeviceUuid() };
}

export async function fetchContext(): Promise<SecurityProfile> {
  const res = await apiClient.fetch<{ data: SecurityProfile }>('/api/v1/terminal/context', {
    method: 'GET',
    headers: withDevice(),
  });
  return res.data;
}

export async function issueDailyPin(): Promise<{ pin: string; expiresAt: string }> {
  const res = await apiClient.fetch<{ data: { pin: string; expiresAt: string } }>(
    '/api/v1/terminal/daily-pin',
    { method: 'POST', headers: withDevice() },
  );
  return res.data;
}

export async function verifyDailyPin(employeeNumber: string, pin: string) {
  const res = await apiClient.fetch<{ data: { valid: boolean; userId: string; deviceUuid: string } }>(
    '/api/v1/terminal/daily-pin/verify',
    {
      method: 'POST',
      headers: withDevice(),
      body: JSON.stringify({ deviceUuid: getDeviceUuid(), employeeNumber, pin }),
    },
  );
  return res.data;
}

export async function saveDraft(snapshot: Record<string, unknown>) {
  const res = await apiClient.fetch<{ data: { savedAt: string } }>('/api/v1/terminal/draft', {
    method: 'POST',
    headers: withDevice(),
    body: JSON.stringify({ snapshot }),
  });
  return res.data;
}

export async function restoreDraft<T = unknown>(): Promise<T | null> {
  const res = await apiClient.fetch<{ data: T | null }>('/api/v1/terminal/draft', {
    method: 'GET',
    headers: withDevice(),
  });
  return res.data;
}
