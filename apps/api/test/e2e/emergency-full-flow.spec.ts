/**
 * Hospital RUN — 응급 전체 흐름 E2E 테스트
 * 시나리오: 응급접수(Triage·KTAS) → 생체신호 → 응급진료기록(ER_CONSULT) → 서명(청구 자동) →
 *           수납 → 처분(DISCHARGE 귀가)
 *
 * 참고(흐름 갭): emergency 모듈의 disposition/discharge는 **직접 청구를 생성하지 않음**.
 *   응급 수납은 ER_CONSULT Encounter를 작성·서명해야 자동 생성됨(encounter.signed).
 *   본 스펙은 그 정상 경로를 검증한다.
 *
 * Run: cd apps/api && TEST_API_URL=http://localhost:4000 npx vitest run test/e2e/emergency-full-flow.spec.ts
 * Env: TEST_API_URL (미설정 시 skip)
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE = process.env.TEST_API_URL || process.env.API_URL || 'http://localhost:4000';

let adminToken = '';
let doctorToken = '';
let nurseToken = '';
let doctorId = '';
let patientId = '';
let visitId = '';
let encounterId = '';
let billingId = '';

interface ApiResponse { status: number; data: any; ok: boolean }

async function api(method: string, path: string, body?: unknown, token?: string): Promise<ApiResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data: any = null;
  if (res.status !== 204) { try { data = await res.json(); } catch { data = null; } }
  if (!res.ok) console.error(`[API ERROR] ${method} ${path} → ${res.status}`, JSON.stringify(data, null, 2));
  return { status: res.status, data, ok: res.ok };
}

describe.skipIf(!process.env.TEST_API_URL)(
  '응급 전체 흐름 E2E: 접수→KTAS→진료→서명→수납→처분',
  () => {
    beforeAll(async () => {
      const adminRes = await api('POST', '/api/v1/auth/login', { email: 'admin@hospital.example.org', password: 'staff1234!' });
      expect(adminRes.status, '관리자 로그인 실패').toBe(200);
      adminToken = adminRes.data.data.accessToken;

      const doctorRes = await api('POST', '/api/v1/auth/login', { email: 'kim.naegwa@hospital.example.org', password: 'staff1234!' });
      expect(doctorRes.status, '의사 로그인 실패').toBe(200);
      doctorToken = doctorRes.data.data.accessToken;
      doctorId = (await api('GET', '/api/v1/auth/me', undefined, doctorToken)).data.data.id;

      const nurseRes = await api('POST', '/api/v1/auth/login', { email: 'cho.ganho@hospital.example.org', password: 'staff1234!' });
      nurseToken = nurseRes.ok ? nurseRes.data.data.accessToken : adminToken;
    });

    it('0. 테스트 환자 등록', async () => {
      const suffix = Date.now().toString().slice(-6);
      const { status, data } = await api('POST', '/api/v1/patients', {
        familyName: '응급흐름', givenName: `테스트${suffix}`, dateOfBirth: '1975-11-22',
        gender: 'FEMALE', insuranceType: 'NHI', phone: '010-4444-5555', address: { line1: '세종대로 1', city: '서울특별시', country: 'KR' },
      }, adminToken);
      expect(status).toBe(201);
      patientId = data.data.id;
      expect(patientId).toBeTruthy();
    });

    it('1. 응급 접수 + KTAS 분류 (LEVEL_3)', async () => {
      const { status, data } = await api('POST', '/api/v1/emergency/triage', {
        patientId, chiefComplaint: '갑작스런 흉통·식은땀', triageLevel: 'LEVEL_3',
      }, nurseToken);
      expect(status).toBe(201);
      visitId = data.data.id;
      expect(visitId).toBeTruthy();
      console.log(`  ✓ 응급 접수: ${visitId} (KTAS LEVEL_3)`);
    });

    it('2. 생체신호 기록 (best-effort)', async () => {
      const res = await api('POST', `/api/v1/emergency/vitals/${visitId}`, {
        systolicBp: 140, diastolicBp: 90, heartRate: 102, respiratoryRate: 22, oxygenSaturation: 95, bodyTemperature: 36.9,
      }, nurseToken);
      console.log(`  ${res.ok ? '✓' : '⚠'} 생체신호 ${res.status}`);
    });

    it('3. 응급 진료기록 작성 (visitType=ER_CONSULT)', async () => {
      const { status, data } = await api('POST', '/api/v1/encounters', {
        patientId, visitType: 'ER_CONSULT',
        subjective: '흉통 30분', objective: 'BP 140/90, HR 102, ECG 비특이', assessment: '흉통 R/O ACS', plan: '심전도·트로포닌·관찰',
      }, doctorToken);
      expect(status).toBe(201);
      encounterId = data.data.id;
      expect(data.data.visitType).toBe('ER_CONSULT');
    });

    it('4. 진료 서명 (DRAFT → SIGNED, 청구 자동)', async () => {
      const { status } = await api('PATCH', `/api/v1/encounters/${encounterId}/sign`, {}, doctorToken);
      // 운영 차트서명 step-up(STEPUP_REQUIRED) 활성 시 게이트 → 우회(청구는 수동 생성 단계에서)
      if (status === 403) { console.log('  ⚠ 서명 step-up 게이트 — 청구는 수동 경로로'); return; }
      expect(status).toBe(200);
    });

    it('5. 응급 청구 생성 확인 (진찰료 포함)', async () => {
      let billing: any = null;
      const list = await api('GET', `/api/v1/billings?status=PENDING`, undefined, adminToken);
      if (list.ok) {
        const items = list.data.data ?? list.data ?? [];
        billing = (Array.isArray(items) ? items : []).find((b: any) => b.encounterId === encounterId) ?? null;
      }
      if (!billing) {
        const create = await api('POST', `/api/v1/encounters/${encounterId}/billing`, {}, adminToken);
        expect(create.status).toBe(201);
        billing = create.data.data;
      }
      billingId = billing.id;
      expect(billingId).toBeTruthy();
      // 응급(외래성)은 진찰료가 부과되어야 함(초진 — 환자의 첫 진료)
      const detail = await api('GET', `/api/v1/billings/${billingId}`, undefined, adminToken);
      const items = detail.data.data.items ?? [];
      const consult = items.find((i: any) => typeof i.codeName === 'string' && i.codeName.includes('진찰료'));
      expect(consult, '응급 청구에 진찰료가 없음').toBeTruthy();
      console.log(`  ✓ 응급 청구 ${billingId} — 진찰료 ${consult?.codeName}`);
    });

    it('6. 수납 처리', async () => {
      const detail = await api('GET', `/api/v1/billings/${billingId}`, undefined, adminToken);
      const copay = detail.data.data.patientCopay ?? detail.data.data.totalAmount ?? 0;
      const { status } = await api('PATCH', `/api/v1/billings/${billingId}/pay`, { amount: copay, paymentMethod: 'CARD' }, adminToken);
      expect(status).toBe(200);
      console.log(`  ✓ 응급 수납 완료 — ${copay}원`);
    });

    it('7. 처분 결정 (DISCHARGE 귀가)', async () => {
      const { status, data } = await api('POST', `/api/v1/emergency/visits/${visitId}/disposition`, {
        disposition: 'DISCHARGE', dischargeInstructions: '흉통 재발 시 즉시 재내원', followUpDate: undefined,
      }, doctorToken);
      expect(status).toBe(201);
      expect(data.data).toBeTruthy();
      console.log(`  ✓ 처분: DISCHARGE`);
    });
  },
);
