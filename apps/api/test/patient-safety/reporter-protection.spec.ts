import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NotFoundException, BadRequestException, ValidationPipe } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  INCIDENT_TYPES,
  incidentTypeLabel,
  normalizeIncidentType,
  foldTypeCounts,
  rawTypeAliases,
} from '@hospital-run/shared';
import { PatientSafetyService } from '../../src/modules/patient-safety/patient-safety.service';
import {
  SAFETY_INCIDENT_PUBLIC_SELECT,
  SAFETY_INCIDENT_INTERNAL_SELECT,
  stripReporter,
} from '../../src/modules/patient-safety/patient-safety.select';
import { UpsertRcaDto } from '../../src/modules/patient-safety/dto/rca.dto';
import { Permission, ROLE_PERMISSIONS } from '../../src/modules/auth/rbac/permission.types';
import { uncatalogedPermissions } from '../../src/modules/auth/rbac/permission-catalog';
import { PHI_READ_PATTERNS, deriveResourceType } from '../../src/modules/audit/audit-routes';

const UUID = '8f14e45f-ceea-467a-9b3a-1a1b2c3d4e5f';
const isPhiRead = (path: string) => PHI_READ_PATTERNS.some((p) => p.test(path));

/**
 * 환자안전사고 **보고자 보호** 가드 — 환자안전법 §14(누구나 보고)·§16(비밀 유지)·
 * §17(불이익 조치 2년↓ 징역 / 보고자 정보 누설 3년↓ 징역).
 *
 * 🔴 이 파일의 모든 단언은 **결함을 되돌리면 실패해야** 한다(가드 헛돈 사례 누적 15건 이상).
 *    재주입 검증 결과는 보고서에 기록한다.
 */
describe('환자안전사고 — 보고자 보호(환자안전법 §14·§16·§17)', () => {
  /* ─────────────────────────────────────────────────────────────────
     ① 보고자 신원이 응답으로 새어 나가지 않는다
     ───────────────────────────────────────────────────────────────── */
  describe('① 보고자 신원(reporterId)은 응답에 실리지 않는다', () => {
    it('공개 select 에 reporterId 가 없다', () => {
      expect(Object.keys(SAFETY_INCIDENT_PUBLIC_SELECT)).not.toContain('reporterId');
    });

    it('내부 select 만 reporterId 를 갖는다(서버 비교 전용)', () => {
      expect(Object.keys(SAFETY_INCIDENT_INTERNAL_SELECT)).toContain('reporterId');
    });

    it('stripReporter 는 ID 를 지우고 "내 보고인가"만 남긴다', () => {
      const out = stripReporter({ id: 'i1', reporterId: 'u-me' } as any, 'u-me');
      expect(out).not.toHaveProperty('reporterId');
      expect(out.reportedByMe).toBe(true);
      expect(stripReporter({ id: 'i1', reporterId: 'u-other' } as any, 'u-me').reportedByMe).toBe(false);
      // 🔴 로그인하지 않은 컨텍스트에서 undefined 끼리 맞아떨어져 '내 보고'가 되지 않는다
      expect(stripReporter({ id: 'i1', reporterId: undefined } as any, undefined).reportedByMe).toBe(false);
    });

    it('소스에 select 없는 safetyIncident 조회가 남아 있지 않다', () => {
      const src = readFileSync(
        join(__dirname, '../../src/modules/patient-safety/patient-safety.service.ts'),
        'utf8',
      );
      // findMany/findUnique/create/update 는 전부 select 를 동반해야 한다
      const calls = src.match(/this\.prisma\.safetyIncident\.(findMany|findUnique|create|update)\(\{[\s\S]*?\n\s{4}\}\)/g) ?? [];
      const withoutSelect = calls.filter((c) => !c.includes('select:'));
      expect(withoutSelect).toEqual([]);
    });
  });

  /* ─────────────────────────────────────────────────────────────────
     ③ 열람 범위 — 전담인력이 아니면 본인 보고 건만
     ───────────────────────────────────────────────────────────────── */
  describe('③ 열람 범위 — 권한이 없으면 본인 보고 건만', () => {
    let svc: PatientSafetyService;
    let prisma: any;

    beforeEach(() => {
      prisma = {
        safetyIncident: {
          findMany: vi.fn(async () => [
            { id: 'i1', type: 'FALL', severity: 'MINOR', status: 'REPORTED', reporterId: 'u-me' },
          ]),
          findUnique: vi.fn(async () => ({ id: 'i1', type: 'FALL', reporterId: 'u-other' })),
          create: vi.fn(async ({ data }: any) => ({ id: 'i1', ...data })),
          update: vi.fn(async () => ({ id: 'i1' })),
        },
        rcaReport: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn(), findMany: vi.fn(async () => []) },
        $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
      };
      svc = new PatientSafetyService(prisma as any, { emit: vi.fn() } as any);
    });

    it('전담인력이 아니면 where.reporterId 로 본인 건만 조회한다', async () => {
      await svc.getIncidents({}, { userId: 'u-me', canReviewAll: false });
      const arg = prisma.safetyIncident.findMany.mock.calls.at(-1)[0];
      expect(arg.where.reporterId).toBe('u-me');
    });

    it('전담인력은 전건을 조회한다(본인 필터가 걸리지 않는다)', async () => {
      await svc.getIncidents({}, { userId: 'u-rev', canReviewAll: true });
      const arg = prisma.safetyIncident.findMany.mock.calls.at(-1)[0];
      expect(arg.where.reporterId).toBeUndefined();
    });

    it('목록 응답에 reporterId 키가 없다', async () => {
      const rows: any[] = await svc.getIncidents({}, { userId: 'u-me', canReviewAll: true });
      expect(rows[0]).not.toHaveProperty('reporterId');
      expect(rows[0].reportedByMe).toBe(true);
    });

    it('상세 — 전담인력이 아니면 남의 보고는 404(존재도 알리지 않는다)', async () => {
      await expect(svc.getIncidentById('i1', { userId: 'u-me', canReviewAll: false }))
        .rejects.toBeInstanceOf(NotFoundException);
    });

    it('상세 — 본인 보고는 볼 수 있고, 그래도 reporterId 는 나가지 않는다', async () => {
      prisma.safetyIncident.findUnique.mockResolvedValueOnce({ id: 'i1', type: 'FALL', reporterId: 'u-me' });
      const row: any = await svc.getIncidentById('i1', { userId: 'u-me', canReviewAll: false });
      expect(row).not.toHaveProperty('reporterId');
      expect(row.reportedByMe).toBe(true);
    });
  });

  /* ─────────────────────────────────────────────────────────────────
     ③ 권한 축 — 보고는 넓게, 열람은 좁게
     ───────────────────────────────────────────────────────────────── */
  describe('③ 보고 권한과 열람 권한은 다른 축이다', () => {
    const has = (r: UserRole, p: Permission) => ROLE_PERMISSIONS[r]?.has(p) ?? false;

    it('자기 직군 사고를 다루는 직군이 보고할 수 있다 — 약사·검사기사(운영 실측 투약오류 12·검체라벨 10)', () => {
      expect(has(UserRole.PHARMACIST, Permission.SAFETY_INCIDENT_REPORT)).toBe(true);
      expect(has(UserRole.LAB_TECH, Permission.SAFETY_INCIDENT_REPORT)).toBe(true);
    });

    it('보고는 READ(외부 연동 서비스계정) 를 제외한 전 직군이 할 수 있다', () => {
      const roles = Object.values(UserRole) as UserRole[];
      const canReport = roles.filter((r) => has(r, Permission.SAFETY_INCIDENT_REPORT));
      expect(canReport).toHaveLength(roles.length - 1);
      expect(has(UserRole.READ, Permission.SAFETY_INCIDENT_REPORT)).toBe(false);
    });

    it('전건 열람은 보고보다 좁다 — 보고할 수 있다고 남의 보고를 읽지 않는다', () => {
      const roles = Object.values(UserRole) as UserRole[];
      const canReport = roles.filter((r) => has(r, Permission.SAFETY_INCIDENT_REPORT));
      const canReview = roles.filter((r) => has(r, Permission.SAFETY_INCIDENT_REVIEW));
      expect(canReview.length).toBeLessThan(canReport.length);
      // 약사·검사기사·원무·CRM 은 보고만 — 동료의 보고 내용을 전건 열람하지 않는다
      for (const r of [UserRole.PHARMACIST, UserRole.LAB_TECH, UserRole.RECEPTIONIST, UserRole.CRM_MANAGER, UserRole.EXECUTIVE]) {
        expect(has(r, Permission.SAFETY_INCIDENT_REVIEW)).toBe(false);
      }
    });

    it('권한 카탈로그에 등재돼 있다(관리 화면이 "설명 없음"으로 띄우지 않게)', () => {
      expect(uncatalogedPermissions([Permission.SAFETY_INCIDENT_REPORT, Permission.SAFETY_INCIDENT_REVIEW])).toEqual([]);
    });

    it('컨트롤러의 보고 역할 목록이 권한 매트릭스와 같은 집합이다(nav·API·권한이 갈라지지 않게)', () => {
      const src = readFileSync(
        join(__dirname, '../../src/modules/patient-safety/patient-safety.controller.ts'),
        'utf8',
      );
      const block = src.match(/const REPORTING_ROLES = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
      const declared = new Set([...block.matchAll(/UserRole\.(\w+)/g)].map((m) => m[1]));
      const fromMatrix = new Set(
        (Object.values(UserRole) as UserRole[]).filter((r) => ROLE_PERMISSIONS[r]?.has(Permission.SAFETY_INCIDENT_REPORT)),
      );
      expect([...declared].sort()).toEqual([...fromMatrix].sort());
    });
  });

  /* ─────────────────────────────────────────────────────────────────
     ② 열람 감사
     ───────────────────────────────────────────────────────────────── */
  describe('② 사고 열람이 감사된다', () => {
    it('목록·상세·RCA 열람은 PHI 열람으로 기록된다(마약류와 같은 층)', () => {
      expect(isPhiRead('/api/v1/safety/incidents')).toBe(true);
      expect(isPhiRead(`/api/v1/safety/incidents/${UUID}`)).toBe(true);
      expect(isPhiRead(`/api/v1/safety/incidents/${UUID}/rca`)).toBe(true);
      expect(isPhiRead('/api/v1/safety/rca')).toBe(true);
    });

    it('환자·보고자를 지목하지 않는 집계는 기록하지 않는다(거짓 감사로 진짜 감사를 묻지 않는다)', () => {
      expect(isPhiRead('/api/v1/safety/incidents/stats')).toBe(false);
      expect(isPhiRead('/api/v1/safety/ipsg-summary')).toBe(false);
      expect(isPhiRead('/api/v1/safety/ews/high-risk')).toBe(false);
      expect(isPhiRead('/api/v1/safety/restraints/active')).toBe(false);
    });

    it('감사 리소스명이 SafetyIncident 로 귀속된다(같은 prefix 의 보호대·EWS 와 섞이지 않게)', () => {
      expect(deriveResourceType('/api/v1/safety/incidents')).toBe('SafetyIncident');
      expect(deriveResourceType('/api/v1/safety/rca')).toBe('SafetyIncident');
      expect(deriveResourceType('/api/v1/safety/restraints')).toBe('Safety');
    });
  });

  /* ─────────────────────────────────────────────────────────────────
     ④ RCA 입력 — 검증이 실제로 실행된다
     ───────────────────────────────────────────────────────────────── */
  describe('④ RCA 입력 DTO — 검증이 실행되고 whitelist 가 화면 입력을 지우지 않는다', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
    const meta = { type: 'body' as const, metatype: UpsertRcaDto };

    it('화면이 보내는 키가 whitelist 에 살아남는다(FE↔DTO 기계 대조)', async () => {
      const body = {
        findings: '근본원인',
        contributingFactors: ['인수인계 정보 누락', '업무 부하'],
        actionPlan: [{ action: '체크리스트 개정', owner: '간호부', due: '30일' }],
        status: 'IN_PROGRESS',
      };
      const out: any = await pipe.transform(body, meta);
      expect(out.findings).toBe('근본원인');
      expect(out.contributingFactors).toEqual(['인수인계 정보 누락', '업무 부하']);
      expect(out.actionPlan[0]).toMatchObject({ action: '체크리스트 개정', owner: '간호부', due: '30일' });
      expect(out.status).toBe('IN_PROGRESS');
    });

    it('승인은 이 EP 로 할 수 없다 — 승인자 없는 승인이 만들어지지 않게', async () => {
      await expect(pipe.transform({ status: 'APPROVED' }, meta)).rejects.toThrow();
    });

    it('기여요인은 문자열 배열만 받는다(형식 오염 차단)', async () => {
      await expect(pipe.transform({ contributingFactors: [{ x: 1 }] }, meta)).rejects.toThrow();
    });

    it('개선계획 항목은 action 이 있어야 한다', async () => {
      await expect(pipe.transform({ actionPlan: [{ owner: '간호부' }] }, meta)).rejects.toThrow();
    });
  });

  describe('④ 승인된 RCA 는 수정되지 않는다', () => {
    it('APPROVED 상태에서 updateRca 는 400', async () => {
      const prisma: any = {
        rcaReport: { findUnique: vi.fn(async () => ({ incidentId: 'i1', status: 'APPROVED' })), update: vi.fn() },
      };
      const svc = new PatientSafetyService(prisma, { emit: vi.fn() } as any);
      await expect(svc.updateRca('i1', { findings: 'x' })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.rcaReport.update).not.toHaveBeenCalled();
    });
  });

  /* ─────────────────────────────────────────────────────────────────
     ⑤ 사고 유형 정본
     ───────────────────────────────────────────────────────────────── */
  describe('⑤ 사고 유형 정본 — 저장값이 조회에서 사라지지 않는다', () => {
    /** 2026-08-18 운영 DB 실측(safety_incidents 75건 groupBy type) */
    const OPERATIONAL = {
      FALL: 12, MEDICATION_ERROR: 12, EQUIPMENT: 10, DOCUMENTATION: 10,
      PATIENT_ID: 10, SPECIMEN_LABEL: 10, PRESSURE_ULCER: 10, NEEDLE_STICK: 1,
    };

    it('운영에 저장된 8개 유형이 전부 정본으로 접힌다(종전 40/75=53% 가 드롭다운 밖이었다)', () => {
      for (const t of Object.keys(OPERATIONAL)) {
        expect(normalizeIncidentType(t), `${t} 가 정본에 없다`).not.toBeNull();
      }
    });

    it('저장값 전부가 필터 드롭다운(정본 유형)으로 도달 가능하다', () => {
      const reachable = new Set(INCIDENT_TYPES.flatMap((t) => rawTypeAliases(t).map((a) => a.toUpperCase())));
      for (const t of Object.keys(OPERATIONAL)) expect(reachable.has(t)).toBe(true);
    });

    it('구 화면 어휘도 같은 정본으로 접힌다(MEDICATION·IDENTIFICATION·PRESSURE_INJURY)', () => {
      expect(normalizeIncidentType('MEDICATION')).toBe('MEDICATION_ERROR');
      expect(normalizeIncidentType('IDENTIFICATION')).toBe('PATIENT_ID');
      expect(normalizeIncidentType('PRESSURE_INJURY')).toBe('PRESSURE_ULCER');
    });

    it('🔴 모르는 유형은 OTHER 로 접지 않는다 — 분류되지 않은 것이 분류된 척하지 않게', () => {
      expect(normalizeIncidentType('BOGUS_TYPE')).toBeNull();
      expect(normalizeIncidentType('')).toBeNull();
      expect(incidentTypeLabel('BOGUS_TYPE')).toBe('BOGUS_TYPE'); // 원본을 보여준다
    });

    it('집계는 미등재 저장값을 버리지 않는다(자르면 잘랐다고 말한다)', () => {
      const folded = foldTypeCounts([
        { type: 'MEDICATION', count: 2 },
        { type: 'MEDICATION_ERROR', count: 3 },
        { type: 'BOGUS', count: 1 },
      ]);
      expect(folded.find((f) => f.type === 'MEDICATION_ERROR')?.count).toBe(5);
      const unknown = folded.find((f) => f.type === null);
      expect(unknown?.count).toBe(1);
      expect(unknown?.label).toBe('BOGUS');
      expect(folded.reduce((a, f) => a + f.count, 0)).toBe(6);
    });

    it('🔴 시드가 만드는 어휘가 정본과 갈라지면 여기서 잡는다(seeds 는 수정 범위 밖 — 가드로 알린다)', async () => {
      const seed = await import('../../prisma/seeds/clinical-volume-safety');
      const seedTypes = (seed.INCIDENT_TYPES as ReadonlyArray<{ type: string }>).map((r) => r.type);
      const unknown = seedTypes.filter((t) => normalizeIncidentType(t) === null);
      expect(unknown, `시드 유형이 shared 정본에 없다: ${unknown.join(', ')}`).toEqual([]);
    });

    it('화면이 로컬 유형 라벨표를 다시 만들지 않았다(규약: 로컬 Record 재정의 금지)', () => {
      const page = readFileSync(
        join(__dirname, '../../../web/src/app/(main)/safety/page.tsx'),
        'utf8',
      );
      expect(page).not.toMatch(/const TYPE_LABEL\s*:/);
      expect(page).toContain('incidentTypeLabel');
    });
  });
});
