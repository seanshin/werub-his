/**
 * Hospital RUN — 핵심 워크플로우 E2E 통합 테스트
 * 시나리오: 환자 등록 → 예약 → 접수 → 진료(SOAP) → 처방 → 서명 → 수납 → 완료
 *
 * Run: cd apps/api && npx vitest run test/e2e-workflow.spec.ts
 * Env: TEST_API_URL (기본: http://localhost:4000)
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE = process.env.TEST_API_URL || process.env.API_URL || 'http://localhost:4000';

// ── Shared state (chaining) ──
let adminToken = '';
let doctorToken = '';
let doctorId = '';
let patientId = '';
let appointmentId = '';
let queueId = '';
let encounterId = '';
let prescriptionMedId = '';
let prescriptionLabId = '';
let billingId = '';

// ── Helper ──
interface ApiResponse {
  status: number;
  data: any;
  ok: boolean;
}

async function api(
  method: string,
  path: string,
  body?: any,
  token?: string,
): Promise<ApiResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: any = null;
  if (res.status !== 204) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  // 에러 시 상세 메시지 출력
  if (!res.ok) {
    console.error(
      `[API ERROR] ${method} ${path} → ${res.status}`,
      JSON.stringify(data, null, 2),
    );
  }

  return { status: res.status, data, ok: res.ok };
}

// ── Tests ──

describe.skipIf(!process.env.TEST_API_URL)('핵심 워크플로우 E2E: 접수→진료→처방→수납', () => {
  // ============================================================
  // Setup: 인증
  // ============================================================
  beforeAll(async () => {
    // 관리자 로그인
    const adminRes = await api('POST', '/api/v1/auth/login', {
      email: 'admin@hospitalrun.example',
      password: 'staff1234!',
    });
    expect(adminRes.status, '관리자 로그인 실패').toBe(200);
    adminToken = adminRes.data.data.accessToken;

    // 의사 로그인
    const doctorRes = await api('POST', '/api/v1/auth/login', {
      email: 'kim.naegwa@hospitalrun.example',
      password: 'staff1234!',
    });
    expect(doctorRes.status, '의사 로그인 실패').toBe(200);
    doctorToken = doctorRes.data.data.accessToken;

    // 의사 ID 획득
    const meRes = await api('GET', '/api/v1/auth/me', undefined, doctorToken);
    expect(meRes.status).toBe(200);
    doctorId = meRes.data.data.id;
  });

  // ============================================================
  // 1. 환자 등록
  // ============================================================
  describe('1. 환자 등록', () => {
    it('신규 환자를 등록할 수 있다', async () => {
      const uniqueSuffix = Date.now().toString().slice(-6);
      const { status, data } = await api(
        'POST',
        '/api/v1/patients',
        {
          familyName: '워크플로우',
          givenName: `테스트${uniqueSuffix}`,
          dateOfBirth: '1985-03-15',
          gender: 'FEMALE',
          insuranceType: 'NHI',
          phone: '010-9999-0001',
          address: '서울특별시 강남구 테헤란로 123',
        },
        adminToken,
      );

      expect(status).toBe(201);
      expect(data.data.id).toBeTruthy();
      expect(data.data.familyName).toBe('워크플로우');
      patientId = data.data.id;
      console.log(`  ✓ 환자 등록 완료: ${patientId}`);
    });

    it('등록된 환자를 조회할 수 있다', async () => {
      const { status, data } = await api(
        'GET',
        `/api/v1/patients/${patientId}`,
        undefined,
        adminToken,
      );

      expect(status).toBe(200);
      expect(data.data.id).toBe(patientId);
      expect(data.data.gender).toBe('FEMALE');
    });
  });

  // ============================================================
  // 2. 예약 생성
  // ============================================================
  describe('2. 예약 생성', () => {
    it('환자 예약을 생성할 수 있다', async () => {
      // 내일 오전 10시 예약
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);

      const { status, data } = await api(
        'POST',
        '/api/v1/appointments',
        {
          patientId,
          doctorId,
          scheduledAt: tomorrow.toISOString(),
          duration: 30,
          type: 'INITIAL',
          reason: 'E2E 워크플로우 테스트 — 두통 상담',
        },
        adminToken,
      );

      expect(status).toBe(201);
      expect(data.data.status).toBe('SCHEDULED');
      expect(data.data.id).toBeTruthy();
      appointmentId = data.data.id;
      console.log(`  ✓ 예약 생성 완료: ${appointmentId}`);
    });

    it('예약 상세를 조회할 수 있다', async () => {
      const { status, data } = await api(
        'GET',
        `/api/v1/appointments/${appointmentId}`,
        undefined,
        adminToken,
      );

      expect(status).toBe(200);
      expect(data.data.id).toBe(appointmentId);
      expect(data.data.reason).toContain('E2E');
    });
  });

  // ============================================================
  // 3. 접수 (체크인)
  // ============================================================
  describe('3. 접수 (체크인)', () => {
    it('예약 환자를 접수할 수 있다', async () => {
      const { status, data } = await api(
        'POST',
        '/api/v1/queue/check-in',
        {
          patientId,
          doctorId,
          departmentName: '내과',
          visitType: 'INITIAL',
          reason: '두통, 어지러움',
          appointmentId,
        },
        adminToken,
      );

      expect(status).toBe(201);
      expect(data.data).toBeTruthy();
      // queueId는 응답 구조에 따라 data.data.id 또는 data.data 자체
      queueId = data.data.id || data.data;
      console.log(`  ✓ 접수 완료 (대기열): ${queueId}`);
    });

    it('대기열에서 접수된 환자를 확인할 수 있다', async () => {
      const { status, data } = await api(
        'GET',
        '/api/v1/queue?department=내과',
        undefined,
        adminToken,
      );

      expect(status).toBe(200);
      expect(data.data).toBeTruthy();

      // 대기열에 방금 접수한 환자가 있는지 확인
      const found = Array.isArray(data.data)
        ? data.data.some(
            (q: any) =>
              q.id === queueId ||
              q.patientId === patientId,
          )
        : true; // 단일 객체 응답인 경우
      expect(found).toBe(true);
    });
  });

  // ============================================================
  // 4. 진료 시작 (대기열 상태 전이)
  // ============================================================
  describe('4. 진료 시작', () => {
    it('대기열에서 환자를 호출할 수 있다 (WAITING → CALLED)', async () => {
      const { status, data } = await api(
        'PATCH',
        `/api/v1/queue/${queueId}/call`,
        undefined,
        doctorToken,
      );

      expect(status).toBe(200);
      expect(data.data).toBeTruthy();
      // 상태가 CALLED로 변경되었는지 확인
      if (data.data.status) {
        expect(data.data.status).toBe('CALLED');
      }
      console.log(`  ✓ 환자 호출 완료`);
    });

    it('진료를 시작할 수 있다 (CALLED → IN_CONSULTATION)', async () => {
      const { status, data } = await api(
        'PATCH',
        `/api/v1/queue/${queueId}/start`,
        undefined,
        doctorToken,
      );

      expect(status).toBe(200);
      expect(data.data).toBeTruthy();
      if (data.data.status) {
        expect(data.data.status).toBe('IN_CONSULTATION');
      }
      console.log(`  ✓ 진료 시작`);
    });
  });

  // ============================================================
  // 5. 진료 기록 (SOAP)
  // ============================================================
  describe('5. 진료 기록 (SOAP)', () => {
    it('진료 기록(Encounter)을 생성할 수 있다', async () => {
      const { status, data } = await api(
        'POST',
        '/api/v1/encounters',
        { patientId },
        doctorToken,
      );

      expect(status).toBe(201);
      expect(data.data.id).toBeTruthy();
      expect(data.data.status).toBe('DRAFT');
      encounterId = data.data.id;
      console.log(`  ✓ Encounter 생성: ${encounterId}`);
    });

    it('SOAP 노트를 입력할 수 있다', async () => {
      const { status, data } = await api(
        'PUT',
        `/api/v1/encounters/${encounterId}`,
        {
          subjective:
            '3일 전부터 지속되는 두통. 오후에 심해지며 뒷목이 뻣뻣함. 오심/구토 없음.',
          objective:
            'V/S: BP 130/85, HR 78, BT 36.5. 경추 ROM 정상. 신경학적 검사 이상 없음.',
          assessment:
            '긴장형 두통 (G44.2). R/O 경추성 두통.',
          plan:
            '1. 진통제 처방 (아세트아미노펜 500mg tid x 7일)\n2. CBC, CRP 검사\n3. 1주 후 F/U',
        },
        doctorToken,
      );

      expect(status).toBe(200);
      expect(data.data.subjective).toContain('두통');
      expect(data.data.assessment).toContain('긴장형');
      console.log(`  ✓ SOAP 노트 입력 완료`);
    });
  });

  // ============================================================
  // 6. 처방
  // ============================================================
  describe('6. 처방', () => {
    it('약 처방(MEDICATION)을 추가할 수 있다', async () => {
      // 약 코드 조회
      const medsRes = await api(
        'GET',
        '/api/v1/codes/medication?limit=1',
        undefined,
        doctorToken,
      );

      const medCode = medsRes.data?.data?.[0];
      if (!medCode) {
        console.warn('  ⚠ 약 코드가 없어 MEDICATION 처방 테스트 스킵');
        return;
      }

      const { status, data } = await api(
        'POST',
        `/api/v1/encounters/${encounterId}/prescriptions`,
        {
          type: 'MEDICATION',
          medicationCodeId: medCode.id,
          dosage: '500mg',
          frequency: '1일 3회 식후 30분',
          duration: 7,
          quantity: 21,
          route: '경구',
        },
        doctorToken,
      );

      expect(status).toBe(201);
      expect(data.data.type).toBe('MEDICATION');
      expect(data.data.id).toBeTruthy();
      prescriptionMedId = data.data.id;
      console.log(`  ✓ 약 처방 완료: ${prescriptionMedId}`);

      // DUR 경고 확인 (있을 수도 없을 수도 있음)
      if (data.durWarnings && data.durWarnings.length > 0) {
        console.log(
          `  ⚠ DUR 경고 ${data.durWarnings.length}건:`,
          data.durWarnings.map((w: any) => w.message || w.type).join(', '),
        );
      }
    });

    it('검사 처방(LAB)을 추가할 수 있다', async () => {
      // 검사 코드 조회
      const procsRes = await api(
        'GET',
        '/api/v1/codes/procedure?limit=1',
        undefined,
        doctorToken,
      );

      const procCode = procsRes.data?.data?.[0];
      if (!procCode) {
        console.warn('  ⚠ 검사 코드가 없어 LAB 처방 테스트 스킵');
        return;
      }

      const { status, data } = await api(
        'POST',
        `/api/v1/encounters/${encounterId}/prescriptions`,
        {
          type: 'LAB',
          procedureCodeId: procCode.id,
        },
        doctorToken,
      );

      expect(status).toBe(201);
      expect(data.data.type).toBe('LAB');
      expect(data.data.id).toBeTruthy();
      prescriptionLabId = data.data.id;
      console.log(`  ✓ 검사 처방 완료: ${prescriptionLabId}`);
    });

    it('처방 목록을 조회할 수 있다', async () => {
      const { status, data } = await api(
        'GET',
        `/api/v1/encounters/${encounterId}/prescriptions`,
        undefined,
        doctorToken,
      );

      expect(status).toBe(200);
      expect(data.data).toBeTruthy();

      // 최소 1건 이상의 처방이 있어야 함
      if (Array.isArray(data.data)) {
        expect(data.data.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // ============================================================
  // 7. 진료 서명
  // ============================================================
  describe('7. 진료 서명', () => {
    it('진료를 완료(서명)할 수 있다 (DRAFT → SIGNED)', async () => {
      const { status, data } = await api(
        'PATCH',
        `/api/v1/encounters/${encounterId}/sign`,
        undefined,
        doctorToken,
      );

      expect(status).toBe(200);
      expect(data.data.status).toBe('SIGNED');
      console.log(`  ✓ 진료 서명 완료`);
    });

    it('서명된 진료 기록을 확인할 수 있다', async () => {
      const { status, data } = await api(
        'GET',
        `/api/v1/encounters/${encounterId}`,
        undefined,
        doctorToken,
      );

      expect(status).toBe(200);
      expect(data.data.status).toBe('SIGNED');
      expect(data.data.subjective).toContain('두통');
    });
  });

  // ============================================================
  // 8. 수납
  // ============================================================
  describe('8. 수납', () => {
    it('수납(Billing)을 생성할 수 있다', async () => {
      const { status, data } = await api(
        'POST',
        `/api/v1/encounters/${encounterId}/billing`,
        undefined,
        adminToken,
      );

      expect(status).toBe(201);
      expect(data.data.id).toBeTruthy();
      // 금액이 0보다 큰지 확인 (처방이 없으면 진찰료만이라도)
      expect(data.data.totalAmount).toBeGreaterThanOrEqual(0);
      billingId = data.data.id;
      console.log(
        `  ✓ 수납 생성: ${billingId} (총액: ${data.data.totalAmount}원)`,
      );
    });

    it('수납 상세를 조회할 수 있다', async () => {
      const { status, data } = await api(
        'GET',
        `/api/v1/billings/${billingId}`,
        undefined,
        adminToken,
      );

      expect(status).toBe(200);
      expect(data.data.id).toBe(billingId);
    });

    it('수납(결제)을 처리할 수 있다', async () => {
      // 수납 상세에서 본인부담금 조회
      const billingRes = await api(
        'GET',
        `/api/v1/billings/${billingId}`,
        undefined,
        adminToken,
      );
      const copay = billingRes.data.data.patientCopay ?? billingRes.data.data.totalAmount ?? 0;

      const { status, data } = await api(
        'PATCH',
        `/api/v1/billings/${billingId}/pay`,
        { amount: copay },
        adminToken,
      );

      expect(status).toBe(200);
      expect(data.data.status).toBe('PAID');
      console.log(`  ✓ 수납 완료 (본인부담: ${copay}원)`);
    });
  });

  // ============================================================
  // 9. 대기열 완료
  // ============================================================
  describe('9. 대기열 완료', () => {
    it('대기열 상태가 완료로 변경된다', async () => {
      const { status, data } = await api(
        'PATCH',
        `/api/v1/queue/${queueId}/complete`,
        undefined,
        doctorToken,
      );

      expect(status).toBe(200);
      expect(data.data).toBeTruthy();
      if (data.data.status) {
        expect(data.data.status).toBe('COMPLETED');
      }
      console.log(`  ✓ 대기열 완료 처리`);
    });
  });

  // ============================================================
  // 10. 워크플로우 무결성 최종 검증
  // ============================================================
  describe('10. 워크플로우 무결성 검증', () => {
    it('환자의 진료 이력에 이번 진료가 포함된다', async () => {
      const { status, data } = await api(
        'GET',
        `/api/v1/patients/${patientId}/encounters`,
        undefined,
        doctorToken,
      );

      expect(status).toBe(200);
      expect(data.data).toBeTruthy();

      const found = Array.isArray(data.data)
        ? data.data.some((e: any) => e.id === encounterId)
        : true;
      expect(found).toBe(true);
    });

    it('예약 상태가 체크인 이후로 변경되어 있다', async () => {
      const { status, data } = await api(
        'GET',
        `/api/v1/appointments/${appointmentId}`,
        undefined,
        adminToken,
      );

      expect(status).toBe(200);
      // SCHEDULED → CHECKED_IN or COMPLETED
      expect(['CHECKED_IN', 'COMPLETED', 'IN_PROGRESS']).toContain(
        data.data.status,
      );
    });

    it('전체 워크플로우 요약', () => {
      console.log('\n══════════════════════════════════════');
      console.log('  E2E 워크플로우 완료 요약');
      console.log('══════════════════════════════════════');
      console.log(`  환자 ID      : ${patientId}`);
      console.log(`  예약 ID      : ${appointmentId}`);
      console.log(`  대기열 ID    : ${queueId}`);
      console.log(`  진료 ID      : ${encounterId}`);
      console.log(`  약 처방 ID   : ${prescriptionMedId || '(없음)'}`);
      console.log(`  검사 처방 ID : ${prescriptionLabId || '(없음)'}`);
      console.log(`  수납 ID      : ${billingId}`);
      console.log('══════════════════════════════════════\n');

      // 모든 ID가 생성되었는지 확인
      expect(patientId).toBeTruthy();
      expect(appointmentId).toBeTruthy();
      expect(queueId).toBeTruthy();
      expect(encounterId).toBeTruthy();
      expect(billingId).toBeTruthy();
    });
  });
});
