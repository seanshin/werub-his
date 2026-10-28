/**
 * Hospital RUN — E2E API Test Suite (스모크: FHIR·병상·대시보드·코드마스터·HR·보안)
 *
 * Run: cd apps/api && TEST_API_URL=http://localhost:4000 npx vitest run test/e2e.spec.ts
 * Env: TEST_API_URL (미설정 시 skip)
 *
 * 🔴 2026-08-18: 종전 파일명이 `e2e.test.ts` 라 vitest include 글롭(test 아래 .spec.ts)에 걸리지 않았고,
 *    게이트도 이 파일만 `API_URL` 을 봐서 형제 E2E 11개(`TEST_API_URL`)와 갈라져 있었다.
 *    **어떤 러너도 실행하지 않던 테스트** — 파일명·게이트를 저장소 관례로 정렬했다.
 */
import { describe, it, expect } from 'vitest';

// E2E 는 실 서버 연결 필요 — TEST_API_URL 미설정 시 전체 skip(형제 e2e-workflow.spec.ts 와 동일 규약)
const BASE = process.env.TEST_API_URL || process.env.API_URL || 'http://localhost:4000';

let adminToken = '';
let doctorToken = '';
let patientId = '';
let encounterId = '';
let prescriptionId = '';
let billingId = '';
let appointmentId = '';

async function api(method: string, path: string, body?: any, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
}

describe.skipIf(!process.env.TEST_API_URL)('Hospital RUN E2E', () => {
  // ============================
  // Auth
  // ============================
  describe('Auth', () => {
    it('should login as admin', async () => {
      const { status, data } = await api('POST', '/api/v1/auth/login', {
        email: 'admin@hospitalrun.example',
        password: 'staff1234!',
      });
      expect(status).toBe(200);
      expect(data.data.accessToken).toBeTruthy();
      adminToken = data.data.accessToken;
    });

    it('should login as doctor', async () => {
      const { status, data } = await api('POST', '/api/v1/auth/login', {
        email: 'kim.naegwa@hospitalrun.example',
        password: 'staff1234!',
      });
      expect(status).toBe(200);
      doctorToken = data.data.accessToken;
    });

    it('should reject invalid credentials', async () => {
      const { status } = await api('POST', '/api/v1/auth/login', {
        email: 'admin@hospitalrun.example',
        password: 'wrongpassword',
      });
      expect(status).toBe(401);
    });

    it('should get profile', async () => {
      const { status, data } = await api('GET', '/api/v1/auth/me', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.data.email).toBe('admin@hospitalrun.example');
    });
  });

  // ============================
  // Health
  // ============================
  describe('Health', () => {
    it('should return health status', async () => {
      const { status, data } = await api('GET', '/health');
      expect(status).toBe(200);
      expect(data.status).toBe('ok');
    });
  });

  // ============================
  // Patients
  // ============================
  describe('Patients', () => {
    it('should create a patient', async () => {
      const { status, data } = await api('POST', '/api/v1/patients', {
        familyName: '테스트',
        givenName: `E2E${Date.now()}`,
        dateOfBirth: '1990-01-15',
        gender: 'MALE',
        insuranceType: 'NHI',
        phone: '010-0000-0000',
      }, adminToken);
      expect(status).toBe(201);
      expect(data.data.id).toBeTruthy();
      patientId = data.data.id;
    });

    it('should list patients', async () => {
      const { status, data } = await api('GET', '/api/v1/patients?limit=5', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.pagination.total).toBeGreaterThan(0);
    });

    it('should get patient by id', async () => {
      const { status, data } = await api('GET', `/api/v1/patients/${patientId}`, undefined, adminToken);
      expect(status).toBe(200);
      expect(data.data.familyName).toBe('테스트');
    });

    it('should search patients', async () => {
      const { status, data } = await api('GET', '/api/v1/patients?q=테스트', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.data.length).toBeGreaterThan(0);
    });
  });

  // ============================
  // Appointments
  // ============================
  describe('Appointments', () => {
    it('should create an appointment', async () => {
      const doctorProfile = await api('GET', '/api/v1/auth/me', undefined, doctorToken);
      const doctorId = doctorProfile.data.data.id;

      const { status, data } = await api('POST', '/api/v1/appointments', {
        patientId,
        doctorId,
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        duration: 30,
        type: 'INITIAL',
        reason: 'E2E Test',
      }, adminToken);
      expect(status).toBe(201);
      expect(data.data.status).toBe('SCHEDULED');
      appointmentId = data.data.id;
    });

    it('should change appointment status', async () => {
      const { status, data } = await api('PATCH', `/api/v1/appointments/${appointmentId}/status`, {
        status: 'CHECKED_IN',
      }, adminToken);
      expect(status).toBe(200);
      expect(data.data.status).toBe('CHECKED_IN');
    });
  });

  // ============================
  // Encounters (Clinical Workflow)
  // ============================
  describe('Encounters', () => {
    it('should create an encounter', async () => {
      const { status, data } = await api('POST', '/api/v1/encounters', {
        patientId,
      }, doctorToken);
      expect(status).toBe(201);
      expect(data.data.status).toBe('DRAFT');
      encounterId = data.data.id;
    });

    it('should update SOAP notes', async () => {
      const { status, data } = await api('PUT', `/api/v1/encounters/${encounterId}`, {
        subjective: 'E2E test headache',
        objective: 'BP 120/80',
        assessment: 'Tension headache',
        plan: 'Analgesic prescribed',
      }, doctorToken);
      expect(status).toBe(200);
      expect(data.data.subjective).toBe('E2E test headache');
    });

    it('should sign encounter', async () => {
      const { status, data } = await api('PATCH', `/api/v1/encounters/${encounterId}/sign`, undefined, doctorToken);
      expect(status).toBe(200);
      expect(data.data.status).toBe('SIGNED');
    });
  });

  // ============================
  // Prescriptions
  // ============================
  describe('Prescriptions', () => {
    let newEncounterId = '';

    it('should create encounter for prescription', async () => {
      const { data } = await api('POST', '/api/v1/encounters', { patientId }, doctorToken);
      newEncounterId = data.data.id;
    });

    it('should add medication prescription', async () => {
      // Get a medication code
      const medsRes = await api('GET', '/api/v1/codes/medication?limit=1', undefined, doctorToken);
      const medId = medsRes.data.data?.[0]?.id;
      if (!medId) return;

      const { status, data } = await api('POST', `/api/v1/encounters/${newEncounterId}/prescriptions`, {
        type: 'MEDICATION',
        medicationCodeId: medId,
        dosage: '500mg',
        frequency: '1일 3회',
        duration: 7,
        quantity: 21,
        route: '경구',
      }, doctorToken);
      expect(status).toBe(201);
      expect(data.data.type).toBe('MEDICATION');
      prescriptionId = data.data.id;
    });

    it('should add lab prescription', async () => {
      const procsRes = await api('GET', '/api/v1/codes/procedure?limit=1', undefined, doctorToken);
      const procId = procsRes.data.data?.[0]?.id;
      if (!procId) return;

      const { status, data } = await api('POST', `/api/v1/encounters/${newEncounterId}/prescriptions`, {
        type: 'LAB',
        procedureCodeId: procId,
      }, doctorToken);
      expect(status).toBe(201);
      expect(data.data.type).toBe('LAB');
    });
  });

  // ============================
  // Billing
  // ============================
  describe('Billing', () => {
    it('should create billing from encounter', async () => {
      const { status, data } = await api('POST', `/api/v1/encounters/${encounterId}/billing`, undefined, adminToken);
      expect(status).toBe(201);
      expect(data.data.totalAmount).toBeGreaterThan(0);
      billingId = data.data.id;
    });

    it('should pay billing', async () => {
      const billingRes = await api('GET', `/api/v1/billings/${billingId}`, undefined, adminToken);
      const copay = billingRes.data.data.patientCopay;

      const { status, data } = await api('PATCH', `/api/v1/billings/${billingId}/pay`, {
        amount: copay,
      }, adminToken);
      expect(status).toBe(200);
      expect(data.data.status).toBe('PAID');
    });
  });

  // ============================
  // Dashboard
  // ============================
  describe('Dashboard', () => {
    it('should return overview', async () => {
      const { status, data } = await api('GET', '/api/v1/dashboard/overview', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.data.patients).toBeGreaterThan(0);
    });
  });

  // ============================
  // Code Master
  // ============================
  describe('Code Master', () => {
    it('should search diagnosis codes', async () => {
      const { status, data } = await api('GET', '/api/v1/codes/diagnosis?limit=5', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.data.length).toBeGreaterThan(0);
    });

    it('should search medication codes', async () => {
      const { status, data } = await api('GET', '/api/v1/codes/medication?limit=5', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.data.length).toBeGreaterThan(0);
    });

    it('should search procedure codes', async () => {
      const { status, data } = await api('GET', '/api/v1/codes/procedure?limit=5', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.data.length).toBeGreaterThan(0);
    });
  });

  // ============================
  // HR
  // ============================
  describe('HR', () => {
    it('should list staff (admin)', async () => {
      const { status, data } = await api('GET', '/api/v1/hr/staff', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.data.length).toBeGreaterThan(0);
    });

    it('should deny staff list for doctor (ADMIN only)', async () => {
      const { status } = await api('GET', '/api/v1/hr/staff', undefined, doctorToken);
      expect(status).toBe(403);
    });

    it('should allow doctor to view own HR profile', async () => {
      const { status } = await api('GET', '/api/v1/hr/me', undefined, doctorToken);
      expect(status).toBe(200);
    });

    it('should get my record', async () => {
      const { status, data } = await api('GET', '/api/v1/hr/me', undefined, doctorToken);
      expect(status).toBe(200);
      expect(data.data.department).toBe('내과');
    });
  });

  // ============================
  // FHIR R4
  // ============================
  describe('FHIR R4', () => {
    it('should return CapabilityStatement', async () => {
      const { status, data } = await api('GET', '/fhir/R4/metadata');
      expect(status).toBe(200);
      expect(data.resourceType).toBe('CapabilityStatement');
      expect(data.fhirVersion).toBe('4.0.1');
    });

    it('should search FHIR Patients', async () => {
      const { status, data } = await api('GET', '/fhir/R4/Patient', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.resourceType).toBe('Bundle');
      expect(data.total).toBeGreaterThan(0);
    });

    it('should search FHIR Encounters', async () => {
      const { status, data } = await api('GET', '/fhir/R4/Encounter', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.resourceType).toBe('Bundle');
    });

    it('should search FHIR MedicationRequests', async () => {
      const { status, data } = await api('GET', '/fhir/R4/MedicationRequest', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.resourceType).toBe('Bundle');
    });
  });

  // ============================
  // Beds
  // ============================
  describe('Beds', () => {
    it('should list wards', async () => {
      const { status, data } = await api('GET', '/api/v1/beds/wards', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.data.length).toBeGreaterThan(0);
    });

    it('should get bed status', async () => {
      const { status, data } = await api('GET', '/api/v1/beds/status', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.data.total).toBeGreaterThan(0);
    });
  });

  // ============================
  // Equipment & Inventory
  // ============================
  describe('Equipment & Inventory', () => {
    it('should list equipment', async () => {
      const { status, data } = await api('GET', '/api/v1/equipment', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.data.length).toBeGreaterThan(0);
    });

    it('should list inventory', async () => {
      const { status, data } = await api('GET', '/api/v1/inventory', undefined, adminToken);
      expect(status).toBe(200);
      expect(data.data.length).toBeGreaterThan(0);
    });
  });

  // ============================
  // Security
  // ============================
  describe('Security', () => {
    it('should reject unauthorized access', async () => {
      const { status } = await api('GET', '/api/v1/patients');
      expect(status).toBe(401);
    });

    it('should reject invalid token', async () => {
      const { status } = await api('GET', '/api/v1/patients', undefined, 'invalid-token');
      expect(status).toBe(401);
    });

    it('should enforce RBAC on admin-only endpoints', async () => {
      const nurseRes = await api('POST', '/api/v1/auth/login', {
        email: 'cho.ganho@hospitalrun.example',
        password: 'staff1234!',
      });
      const nurseToken = nurseRes.data.data.accessToken;

      const { status } = await api('POST', '/api/v1/hr/staff', { familyName: 'test' }, nurseToken);
      expect(status).toBe(403);
    });
  });
});
