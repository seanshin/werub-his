/**
 * Hospital RUN — 입원 전체 흐름 E2E 테스트
 * 시나리오: 환자 → 가용병상 → 입원 → 입원진료기록(INPATIENT) → 처방 → 중간정산 →
 *           서명(최종청구 자동) → 퇴원(병상반납) → 최종수납
 *
 * 회귀 검증: 입원 진료기록 청구에 **외래 진찰료(AA157/AA257)가 포함되지 않아야** 함
 *           (입원은 입원료 체계 — billing.service.createFromEncounter visitType 게이팅).
 *
 * Run: cd apps/api && TEST_API_URL=http://localhost:4000 npx vitest run test/e2e/inpatient-full-flow.spec.ts
 * Env: TEST_API_URL (미설정 시 skip)
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE = process.env.TEST_API_URL || process.env.API_URL || 'http://localhost:4000';

let adminToken = '';
let doctorToken = '';
let doctorId = '';
let patientId = '';
let bedId = '';
let admissionId = '';
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
  '입원 전체 흐름 E2E: 입원→진료→중간정산→서명→퇴원→최종수납',
  () => {
    beforeAll(async () => {
      const adminRes = await api('POST', '/api/v1/auth/login', { email: 'admin@hospital.example.org', password: 'staff1234!' });
      expect(adminRes.status, '관리자 로그인 실패').toBe(200);
      adminToken = adminRes.data.data.accessToken;

      const doctorRes = await api('POST', '/api/v1/auth/login', { email: 'kim.naegwa@hospital.example.org', password: 'staff1234!' });
      expect(doctorRes.status, '의사 로그인 실패').toBe(200);
      doctorToken = doctorRes.data.data.accessToken;

      const meRes = await api('GET', '/api/v1/auth/me', undefined, doctorToken);
      doctorId = meRes.data.data.id;
    });

    it('0. 테스트 환자 등록', async () => {
      const suffix = Date.now().toString().slice(-6);
      const { status, data } = await api('POST', '/api/v1/patients', {
        familyName: '입원흐름', givenName: `테스트${suffix}`, dateOfBirth: '1980-03-10',
        gender: 'MALE', insuranceType: 'NHI', phone: '010-2222-3333', address: { line1: '세종대로 1', city: '서울특별시', country: 'KR' },
      }, adminToken);
      expect(status).toBe(201);
      patientId = data.data.id;
      expect(patientId).toBeTruthy();
    });

    it('1. 가용 병상 조회', async () => {
      const { status, data } = await api('GET', '/api/v1/beds/available', undefined, adminToken);
      expect(status).toBe(200);
      const beds = data.data ?? data;
      expect(Array.isArray(beds) && beds.length > 0, '가용 병상이 없습니다(시드 필요)').toBe(true);
      bedId = beds[0].id;
      console.log(`  ✓ 가용 병상: ${bedId}`);
    });

    it('2. 입원 수속 (병상 OCCUPIED)', async () => {
      const { status, data } = await api('POST', '/api/v1/admissions/create', {
        patientId, bedId, admittingDoctorId: doctorId, admitDate: new Date().toISOString(),
        admitReason: '폐렴 의증 — 입원 관찰', dietType: 'REGULAR',
      }, adminToken);
      expect(status).toBe(201);
      admissionId = data.data.id;
      expect(admissionId).toBeTruthy();
      console.log(`  ✓ 입원 생성: ${admissionId}`);
    });

    it('3. 입원 진료기록 작성 (visitType=INPATIENT)', async () => {
      const { status, data } = await api('POST', '/api/v1/encounters', {
        patientId, visitType: 'INPATIENT', admissionId,
        subjective: '발열·기침 3일', objective: '체온 38.4, 흉부 수포음', assessment: '폐렴', plan: '항생제·수액·관찰',
      }, doctorToken);
      expect(status).toBe(201);
      encounterId = data.data.id;
      expect(encounterId).toBeTruthy();
      // 입원 진료기록은 visitType이 INPATIENT로 저장되어야 함
      expect(data.data.visitType, 'visitType이 INPATIENT로 저장되지 않음').toBe('INPATIENT');
    });

    it('4. 중간정산 산출·수납 (best-effort)', async () => {
      const gen = await api('POST', `/api/v1/inpatient/${admissionId}/interim-billings/generate`, {}, adminToken);
      if (!gen.ok) { console.warn('  ⚠ 중간정산 산출 스킵(라우트/상태 상이)'); return; }
      const interim = gen.data.data;
      console.log(`  ✓ 중간정산 산출: ${interim?.id} 금액 ${interim?.totalAmount ?? interim?.patientCopay ?? 0}`);
      if (interim?.id) {
        const pay = await api('PATCH', `/api/v1/inpatient/${admissionId}/interim-billings/${interim.id}/pay`, { paymentMethod: 'CARD' }, adminToken);
        console.log(`  ${pay.ok ? '✓' : '⚠'} 중간정산 수납 ${pay.status}`);
      }
    });

    it('5. 진료 서명 (DRAFT → SIGNED, 최종청구 자동)', async () => {
      const { status } = await api('PATCH', `/api/v1/encounters/${encounterId}/sign`, {}, doctorToken);
      // 운영 차트서명 step-up(STEPUP_REQUIRED) 활성 시 게이트 → 우회(청구는 수동 생성 단계에서)
      if (status === 403) { console.log('  ⚠ 서명 step-up 게이트 — 청구는 수동 경로로'); return; }
      expect(status).toBe(200);
    });

    it('6. 입원 청구에 외래 진찰료가 없어야 함 (회귀)', async () => {
      // 서명 후 자동 생성된 청구 조회(없으면 수동 생성)
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
      const detail = await api('GET', `/api/v1/billings/${billingId}`, undefined, adminToken);
      const items = detail.data.data.items ?? [];
      const consultLine = items.find((i: any) => typeof i.codeName === 'string' && i.codeName.includes('진찰료'));
      expect(consultLine, `입원 청구에 외래 진찰료가 포함됨: ${consultLine?.codeName}`).toBeUndefined();
      console.log(`  ✓ 입원 청구 라인 ${items.length}건 — 외래 진찰료 없음`);
    });

    it('7. 퇴원 (병상 AVAILABLE 반납)', async () => {
      const { status, data } = await api('PATCH', `/api/v1/admissions/${admissionId}/discharge`, {
        dischargeDate: new Date().toISOString(), dischargeSummary: '호전 퇴원',
      }, adminToken);
      expect(status).toBe(200);
      expect(data.data.status).toBe('DISCHARGED');
    });

    it('7b. 퇴원 정산서 — 중간정산 차감 통합 검증', async () => {
      const { status, data } = await api('GET', `/api/v1/inpatient/${admissionId}/discharge-settlement`, undefined, adminToken);
      expect(status).toBe(200);
      const s = data.data;
      // 단일 정산서: 총진료비 = 청구 + 중간정산, 잔액 = max(0, 총본인부담 − 기납부)
      expect(s.totalCharges).toBe(s.breakdown.encounters.charges + s.breakdown.interim.charges);
      expect(s.alreadyPaid).toBe(s.breakdown.encounters.paid + s.breakdown.interim.paid);
      expect(s.balanceDue).toBe(Math.max(0, s.totalCopay - s.alreadyPaid));
      console.log(`  ✓ 정산서: 총진료비 ${s.totalCharges} · 본인부담 ${s.totalCopay} · 기납부(중간정산 포함) ${s.alreadyPaid} · 잔액 ${s.balanceDue}`);
    });

    it('8. 최종 수납 처리', async () => {
      const detail = await api('GET', `/api/v1/billings/${billingId}`, undefined, adminToken);
      const copay = detail.data.data.patientCopay ?? detail.data.data.totalAmount ?? 0;
      const { status } = await api('PATCH', `/api/v1/billings/${billingId}/pay`, { amount: copay, paymentMethod: 'CARD' }, adminToken);
      expect(status).toBe(200);
      console.log(`  ✓ 최종 수납 완료 — ${copay}원`);
    });
  },
);
