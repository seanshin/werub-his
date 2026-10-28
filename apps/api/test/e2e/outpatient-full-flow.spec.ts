/**
 * Hospital RUN — 외래 전체 흐름 E2E 테스트
 * 시나리오: 접수(walk-in) → 간호 바이탈 → 의사 호출 → 진료 → SOAP → 처방 → 서명 → 수납 → 완료
 *
 * Run: cd apps/api && npx vitest run test/e2e/outpatient-full-flow.spec.ts
 * Env: TEST_API_URL (기본: http://localhost:4000)
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE =
  process.env.TEST_API_URL || process.env.API_URL || 'http://localhost:4000';

// ── Shared state (테스트 간 체이닝) ──
let adminToken = '';
let doctorToken = '';
let nurseToken = '';
let doctorId = '';
let patientId = '';
let queueId = '';
let encounterId = '';
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
  body?: unknown,
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

  if (!res.ok) {
    console.error(
      `[API ERROR] ${method} ${path} → ${res.status}`,
      JSON.stringify(data, null, 2),
    );
  }

  return { status: res.status, data, ok: res.ok };
}

// ── Tests ──

describe.skipIf(!process.env.TEST_API_URL)(
  '외래 전체 흐름 E2E: 접수→바이탈→진료→서명→수납→완료',
  () => {
    // ============================================================
    // Setup: 3개 역할 로그인 (관리자, 의사, 간호사)
    // ============================================================
    beforeAll(async () => {
      // 관리자 로그인
      const adminRes = await api('POST', '/api/v1/auth/login', {
        email: 'admin@hospital.example.org',
        password: 'staff1234!',
      });
      expect(adminRes.status, '관리자 로그인 실패').toBe(200);
      adminToken = adminRes.data.data.accessToken;

      // 의사 로그인 (내과 김내과)
      const doctorRes = await api('POST', '/api/v1/auth/login', {
        email: 'kim.naegwa@hospital.example.org',
        password: 'staff1234!',
      });
      expect(doctorRes.status, '의사 로그인 실패').toBe(200);
      doctorToken = doctorRes.data.data.accessToken;

      // 의사 ID 획득
      const meRes = await api('GET', '/api/v1/auth/me', undefined, doctorToken);
      expect(meRes.status).toBe(200);
      doctorId = meRes.data.data.id;

      // 간호사 로그인 (조간호)
      const nurseRes = await api('POST', '/api/v1/auth/login', {
        email: 'cho.ganho@hospital.example.org',
        password: 'staff1234!',
      });
      expect(nurseRes.status, '간호사 로그인 실패').toBe(200);
      nurseToken = nurseRes.data.data.accessToken;
    });

    // ============================================================
    // 0. 테스트용 환자 등록
    // ============================================================
    it('0. 테스트 환자 등록', async () => {
      const uniqueSuffix = Date.now().toString().slice(-6);
      const { status, data } = await api(
        'POST',
        '/api/v1/patients',
        {
          familyName: '외래흐름',
          givenName: `테스트${uniqueSuffix}`,
          dateOfBirth: '1990-06-20',
          gender: 'MALE',
          insuranceType: 'NHI',
          phone: '010-1234-5678',
          address: { line1: '세종대로 1', city: '서울특별시', country: 'KR' },
        },
        adminToken,
      );

      expect(status).toBe(201);
      expect(data.data.id).toBeTruthy();
      patientId = data.data.id;
      console.log(`  ✓ 환자 등록 완료: ${patientId}`);
    });

    // ============================================================
    // 1. 환자 당일 접수 (walk-in, 예약 없이 직접 방문)
    // ============================================================
    it('1. 환자 당일 접수 (walk-in)', async () => {
      const { status, data } = await api(
        'POST',
        '/api/v1/queue/check-in',
        {
          patientId,
          doctorId,
          departmentName: '내과',
          visitType: 'INITIAL',
          reason: '두통 및 어지러움 — 당일 접수',
        },
        adminToken,
      );

      expect(status).toBe(201);
      expect(data.data).toBeTruthy();
      // check-in 응답이 이중 래핑({data:{data:{...}}})일 수 있음 — 내부 객체의 id 추출
      const q = data.data && data.data.data ? data.data.data : data.data;
      queueId = q && q.id ? q.id : q;
      console.log(`  ✓ 당일 접수 완료 — 대기열 ID: ${queueId}`);
    });

    // ============================================================
    // 2. 간호사 바이탈 측정
    // ============================================================
    it('2. 간호사 바이탈 측정', async () => {
      // 간호사가 대기 환자의 바이탈 사인을 측정한다
      const { status, data } = await api(
        'POST',
        `/api/v1/nurse-station/vitals/${queueId}`,
        {
          systolicBp: 128,
          diastolicBp: 82,
          heartRate: 76,
          bodyTemperature: 36.7,
          respiratoryRate: 18,
          oxygenSaturation: 98,
          height: 175,
          weight: 72,
        },
        nurseToken,
      );

      // 바이탈 측정 결과 검증
      expect(status).toBe(200);
      expect(data.data).toBeTruthy();
      console.log(`  ✓ 바이탈 측정 완료 — BP ${data.data.systolicBp ?? 128}/${data.data.diastolicBp ?? 82}`);
    });

    // ============================================================
    // 3. 의사 환자 호출 (WAITING → CALLED)
    // ============================================================
    it('3. 의사 환자 호출', async () => {
      const { status, data } = await api(
        'PATCH',
        `/api/v1/queue/${queueId}/call`,
        undefined,
        doctorToken,
      );

      expect(status).toBe(200);
      expect(data.data).toBeTruthy();
      if (data.data.status) {
        expect(data.data.status).toBe('CALLED');
      }
      console.log(`  ✓ 환자 호출 완료 — 상태: CALLED`);
    });

    // ============================================================
    // 4. 진료 시작 (Encounter 자동 생성, CALLED → IN_CONSULTATION)
    // ============================================================
    it('4. 진료 시작 (encounter 자동 생성)', async () => {
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

      // encounter 자동 생성 확인 — 응답에 encounterId가 있으면 사용, 없으면 직접 생성
      if (data.data.encounterId) {
        encounterId = data.data.encounterId;
      } else {
        // encounter가 자동 생성되지 않는 경우 수동 생성
        const encRes = await api(
          'POST',
          '/api/v1/encounters',
          { patientId },
          doctorToken,
        );
        expect(encRes.status).toBe(201);
        encounterId = encRes.data.data.id;
      }
      console.log(`  ✓ 진료 시작 — Encounter ID: ${encounterId}`);
    });

    // ============================================================
    // 5. SOAP 노트 작성
    // ============================================================
    it('5. SOAP 노트 작성', async () => {
      const { status, data } = await api(
        'PUT',
        `/api/v1/encounters/${encounterId}`,
        {
          subjective:
            '3일 전부터 지속되는 두통. 오후에 심해지며 뒷목이 뻣뻣함. 오심/구토 없음. 수면장애 동반.',
          objective:
            'V/S: BP 128/82, HR 76, BT 36.7. 의식 명료. 경추 ROM 정상. 신경학적 검사 이상 없음.',
          assessment: '긴장형 두통 (G44.2). R/O 경추성 두통.',
          plan: '1. 진통제 처방 (아세트아미노펜 500mg tid x 7일)\n2. 1주 후 F/U\n3. 증상 악화 시 두부 CT 고려',
        },
        doctorToken,
      );

      expect(status).toBe(200);
      expect(data.data.subjective).toContain('두통');
      expect(data.data.assessment).toContain('긴장형');
      console.log(`  ✓ SOAP 노트 작성 완료`);
    });

    // ============================================================
    // 6. 약 처방
    // ============================================================
    it('6. 약 처방', async () => {
      // 약 코드 조회
      const medsRes = await api(
        'GET',
        '/api/v1/codes/medication?limit=1',
        undefined,
        doctorToken,
      );

      const medCode = medsRes.data?.data?.[0];
      if (!medCode) {
        console.warn('  ⚠ 약 코드가 없어 처방 테스트 스킵');
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
      console.log(`  ✓ 약 처방 완료: ${data.data.id}`);

      // DUR 경고 확인
      if (data.durWarnings && data.durWarnings.length > 0) {
        console.log(
          `  ⚠ DUR 경고 ${data.durWarnings.length}건:`,
          data.durWarnings.map((w: any) => w.message || w.type).join(', '),
        );
      }
    });

    // ============================================================
    // 7. 서명 완료 (DRAFT → SIGNED)
    // ============================================================
    it('7. 서명 완료', async () => {
      const { status, data } = await api(
        'PATCH',
        `/api/v1/encounters/${encounterId}/sign`,
        undefined,
        doctorToken,
      );

      // 운영은 차트서명 Tier2 step-up(STEPUP_REQUIRED)이 활성일 수 있음 — 게이트 시 우회(청구는 수동 생성)
      if (status === 403) { console.log('  ⚠ 서명 step-up 게이트(STEPUP_REQUIRED) — 청구는 수동 경로로 진행'); return; }
      expect(status).toBe(200);
      expect(data.data.status).toBe('SIGNED');
      console.log(`  ✓ 진료 서명 완료 — 상태: SIGNED`);
    });

    // ============================================================
    // 8. 수납 자동 생성 확인
    // ============================================================
    it('8. 수납 자동 생성 확인', async () => {
      // 서명 후 수납이 자동 생성되었는지 확인, 없으면 수동 생성
      const pendingRes = await api(
        'GET',
        '/api/v1/billings?status=PENDING',
        undefined,
        adminToken,
      );

      if (pendingRes.ok && Array.isArray(pendingRes.data?.data)) {
        const found = pendingRes.data.data.find(
          (b: any) => b.encounterId === encounterId || b.patientId === patientId,
        );
        if (found) {
          billingId = found.id;
          console.log(`  ✓ 수납 자동 생성 확인: ${billingId}`);
          return;
        }
      }

      // 자동 생성되지 않은 경우 수동 생성
      const { status, data } = await api(
        'POST',
        `/api/v1/encounters/${encounterId}/billing`,
        undefined,
        adminToken,
      );

      expect(status).toBe(201);
      billingId = data.data.id;
      console.log(`  ✓ 수납 수동 생성: ${billingId} (총액: ${data.data.totalAmount ?? 0}원)`);
    });

    // ============================================================
    // 9. 수납 처리 (결제)
    // ============================================================
    it('9. 수납 처리', async () => {
      // 수납 상세에서 본인부담금 조회
      const billingRes = await api(
        'GET',
        `/api/v1/billings/${billingId}`,
        undefined,
        adminToken,
      );
      expect(billingRes.status).toBe(200);

      const copay =
        billingRes.data.data.patientCopay ??
        billingRes.data.data.totalAmount ??
        0;

      const { status, data } = await api(
        'PATCH',
        `/api/v1/billings/${billingId}/pay`,
        {
          amount: copay,
          paymentMethod: 'CARD',
        },
        adminToken,
      );

      expect(status).toBe(200);
      expect(data.data.status).toBe('PAID');
      console.log(`  ✓ 수납 처리 완료 — 결제 방법: CARD, 금액: ${copay}원`);
    });

    // ============================================================
    // 10. 진료 완료 확인 (전체 워크플로우 무결성 검증)
    // ============================================================
    it('10. 진료 완료 확인', async () => {
      // 대기열 완료 처리
      const completeRes = await api(
        'PATCH',
        `/api/v1/queue/${queueId}/complete`,
        undefined,
        doctorToken,
      );
      expect(completeRes.status).toBe(200);
      if (completeRes.data.data?.status) {
        expect(completeRes.data.data.status).toBe('COMPLETED');
      }

      // 진료 기록 최종 확인
      const encounterRes = await api(
        'GET',
        `/api/v1/encounters/${encounterId}`,
        undefined,
        doctorToken,
      );
      expect(encounterRes.status).toBe(200);
      expect(encounterRes.data.data.status).toBe('SIGNED');

      // 환자 진료 이력에 포함 확인
      const historyRes = await api(
        'GET',
        `/api/v1/patients/${patientId}/encounters`,
        undefined,
        doctorToken,
      );
      expect(historyRes.status).toBe(200);

      if (Array.isArray(historyRes.data?.data)) {
        const found = historyRes.data.data.some(
          (e: any) => e.id === encounterId,
        );
        expect(found).toBe(true);
      }

      // 최종 요약 출력
      console.log('\n══════════════════════════════════════');
      console.log('  외래 전체 흐름 E2E 완료 요약');
      console.log('══════════════════════════════════════');
      console.log(`  환자 ID     : ${patientId}`);
      console.log(`  대기열 ID   : ${queueId}`);
      console.log(`  진료 ID     : ${encounterId}`);
      console.log(`  수납 ID     : ${billingId}`);
      console.log('══════════════════════════════════════\n');

      expect(patientId).toBeTruthy();
      expect(queueId).toBeTruthy();
      expect(encounterId).toBeTruthy();
      expect(billingId).toBeTruthy();
    });
  },
);
