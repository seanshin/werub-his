/**
 * Hospital RUN — 간호 워크플로우 E2E 테스트
 * 시나리오: CareTeam 조회 → 간호 대기열 → 업무 목록 → 바이탈 측정 → 업무 완료 → 간호 노트 작성/조회
 *
 * Run: cd apps/api && npx vitest run test/e2e/nursing-workflow.spec.ts
 * Env: TEST_API_URL (기본: http://localhost:4000)
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE =
  process.env.TEST_API_URL || process.env.API_URL || 'http://localhost:4000';

// ── Shared state ──
let adminToken = '';
let nurseToken = '';
let doctorToken = '';
let doctorId = '';
let patientId = '';
let queueId = '';
let taskId = '';
let nursingNoteId = '';

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
  '간호 워크플로우 E2E: CareTeam→대기열→바이탈→업무→간호노트',
  () => {
    // ============================================================
    // Setup: 로그인 + 테스트 데이터 준비
    // ============================================================
    beforeAll(async () => {
      // 관리자 로그인
      const adminRes = await api('POST', '/api/v1/auth/login', {
        email: 'admin@hospitalrun.example',
        password: 'staff1234!',
      });
      expect(adminRes.status, '관리자 로그인 실패').toBe(200);
      adminToken = adminRes.data.data.accessToken;

      // 간호사 로그인 (조간호)
      const nurseRes = await api('POST', '/api/v1/auth/login', {
        email: 'cho.ganho@hospitalrun.example',
        password: 'staff1234!',
      });
      expect(nurseRes.status, '간호사 로그인 실패').toBe(200);
      nurseToken = nurseRes.data.data.accessToken;

      // 의사 로그인 (김내과)
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

      // 테스트 환자 등록
      const uniqueSuffix = Date.now().toString().slice(-6);
      const patientRes = await api(
        'POST',
        '/api/v1/patients',
        {
          familyName: '간호테스트',
          givenName: `환자${uniqueSuffix}`,
          dateOfBirth: '1988-11-05',
          gender: 'FEMALE',
          insuranceType: 'NHI',
          phone: '010-8888-0001',
          address: '서울특별시 마포구 월드컵북로 1',
        },
        adminToken,
      );
      expect(patientRes.status).toBe(201);
      patientId = patientRes.data.data.id;

      // 환자 접수 (대기열에 추가)
      const checkInRes = await api(
        'POST',
        '/api/v1/queue/check-in',
        {
          patientId,
          doctorId,
          departmentName: '내과',
          visitType: 'INITIAL',
          reason: '간호 워크플로우 E2E 테스트',
        },
        adminToken,
      );
      expect(checkInRes.status).toBe(201);
      queueId = checkInRes.data.data.id || checkInRes.data.data;

      console.log(`  ✓ Setup 완료 — 환자: ${patientId}, 대기열: ${queueId}`);
    });

    // ============================================================
    // 1. 의료팀(CareTeam) 조회
    // ============================================================
    it('1. 의료팀 조회', async () => {
      // 간호사 본인이 속한 의료팀 조회
      const { status, data } = await api(
        'GET',
        '/api/v1/care-teams/my',
        undefined,
        nurseToken,
      );

      // 의료팀이 없을 수도 있으므로 200만 확인
      expect(status).toBe(200);
      console.log(
        `  ✓ 의료팀 조회 완료 — ${Array.isArray(data.data) ? data.data.length : 0}개 팀`,
      );
    });

    // ============================================================
    // 2. 간호 대기열 조회
    // ============================================================
    it('2. 간호 대기열 조회', async () => {
      // 간호사 전용 대기열 조회
      const { status, data } = await api(
        'GET',
        '/api/v1/nurse-station/queue',
        undefined,
        nurseToken,
      );

      expect(status).toBe(200);
      expect(data.data).toBeTruthy();

      // 대기열에 방금 접수한 환자가 존재하는지 확인
      if (Array.isArray(data.data)) {
        const found = data.data.some(
          (q: any) => q.id === queueId || q.patientId === patientId,
        );
        // 대기열 필터 기준에 따라 없을 수 있으므로 결과만 로깅
        console.log(
          `  ✓ 간호 대기열 조회 — ${data.data.length}건, 테스트 환자 포함: ${found}`,
        );
      } else {
        console.log(`  ✓ 간호 대기열 조회 완료`);
      }
    });

    // ============================================================
    // 3. 간호 업무 목록 조회
    // ============================================================
    it('3. 간호 업무 목록 조회', async () => {
      // 해당 대기열의 간호 업무 목록 조회
      const { status, data } = await api(
        'GET',
        `/api/v1/nurse-station/tasks/${queueId}`,
        undefined,
        nurseToken,
      );

      expect(status).toBe(200);

      // 업무 목록에서 첫 번째 task ID 저장 (완료 처리용)
      if (Array.isArray(data.data) && data.data.length > 0) {
        taskId = data.data[0].id;
        console.log(
          `  ✓ 간호 업무 ${data.data.length}건 조회 — 첫 번째: ${taskId}`,
        );
      } else {
        console.log(`  ✓ 간호 업무 조회 완료 (할당된 업무 없음)`);
      }
    });

    // ============================================================
    // 4. 바이탈 측정
    // ============================================================
    it('4. 바이탈 측정', async () => {
      const { status, data } = await api(
        'POST',
        `/api/v1/nurse-station/vitals/${queueId}`,
        {
          systolicBp: 120,
          diastolicBp: 78,
          heartRate: 72,
          bodyTemperature: 36.5,
          respiratoryRate: 16,
          oxygenSaturation: 99,
          height: 162,
          weight: 55,
        },
        nurseToken,
      );

      expect(status).toBe(200);
      expect(data.data).toBeTruthy();
      console.log(
        `  ✓ 바이탈 측정 완료 — BP ${data.data.systolicBp ?? 120}/${data.data.diastolicBp ?? 78}, SpO2 ${data.data.oxygenSaturation ?? 99}%`,
      );
    });

    // ============================================================
    // 5. 업무 완료 처리
    // ============================================================
    it('5. 업무 완료 처리', async () => {
      if (!taskId) {
        console.log('  ⚠ 할당된 간호 업무가 없어 스킵');
        return;
      }

      const { status, data } = await api(
        'PATCH',
        `/api/v1/nurse-station/tasks/${taskId}/complete`,
        undefined,
        nurseToken,
      );

      expect(status).toBe(200);
      expect(data.data).toBeTruthy();
      console.log(`  ✓ 간호 업무 완료 처리: ${taskId}`);
    });

    // ============================================================
    // 6. 범용 간호 노트 작성 (SBAR 형식)
    // ============================================================
    it('6. 범용 간호 노트 작성', async () => {
      // SBAR 형식으로 간호 노트 작성
      const { status, data } = await api(
        'POST',
        '/api/v1/nursing-notes',
        {
          patientId,
          type: 'GENERAL',
          situation:
            '내과 외래 방문 환자. 두통 주소로 내원. 바이탈 안정적.',
          background:
            '특이 과거력 없음. 현재 복용 약물 없음.',
          assessment:
            '활력징후 정상 범위. 통증 수준 NRS 4/10.',
          recommendation:
            '의사 진료 대기 중. 추가 바이탈 모니터링 불필요.',
        },
        nurseToken,
      );

      expect(status).toBe(201);
      expect(data.data).toBeTruthy();
      nursingNoteId = data.data.id;
      console.log(`  ✓ 간호 노트 작성 완료: ${nursingNoteId}`);
    });

    // ============================================================
    // 7. 간호 노트 조회
    // ============================================================
    it('7. 간호 노트 조회', async () => {
      // 해당 환자의 간호 노트 목록 조회
      const { status, data } = await api(
        'GET',
        `/api/v1/nursing-notes/patient/${patientId}`,
        undefined,
        nurseToken,
      );

      expect(status).toBe(200);
      expect(data.data).toBeTruthy();

      // 방금 작성한 간호 노트가 포함되어 있는지 확인
      if (Array.isArray(data.data)) {
        expect(data.data.length).toBeGreaterThanOrEqual(1);
        const found = data.data.some(
          (n: any) => n.id === nursingNoteId,
        );
        expect(found).toBe(true);
        console.log(
          `  ✓ 간호 노트 조회 완료 — ${data.data.length}건, 작성 노트 포함: ${found}`,
        );
      } else {
        console.log(`  ✓ 간호 노트 조회 완료`);
      }

      // 최종 요약
      console.log('\n══════════════════════════════════════');
      console.log('  간호 워크플로우 E2E 완료 요약');
      console.log('══════════════════════════════════════');
      console.log(`  환자 ID       : ${patientId}`);
      console.log(`  대기열 ID     : ${queueId}`);
      console.log(`  간호 업무 ID  : ${taskId || '(없음)'}`);
      console.log(`  간호 노트 ID  : ${nursingNoteId}`);
      console.log('══════════════════════════════════════\n');
    });
  },
);
