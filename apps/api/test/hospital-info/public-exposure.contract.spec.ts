/**
 * 공개 홈페이지 API 노출 계약 (W9 · 화면 실사용 점검)
 *
 * 공개 화면은 무인증이라 서버가 거른 것만이 안전의 전부다. 이 스펙은 "무엇이 나가면 안 되는가"를 고정한다.
 *
 * 🔴 원 결함(운영 실측 2026-08-14, https://his.example.org):
 *   1. `GET /api/v1/public/doctors/:userId` 가 `isPublic:false` 프로필을 그대로 돌려줬다.
 *      비공개 2건(건강검진센터 의사·영상의학과 판독의)이 무인증으로 열렸고, 응답에 직원 이메일
 *      (ck.doctor@hospital.example.org / ws.reading@hospital.example.org)까지 실려 있었다.
 *   2. `GET /api/v1/public/departments/:slug` 가 관리자용 findBySlug 를 써서 발행 상태를 보지 않았다
 *      (DRAFT/ARCHIVED/휴지통 문서도 슬러그만 알면 공개로 열림).
 *   3. 공개 목록(findPublic/searchPublic/findByTags)이 status·deletedAt 을 보지 않았다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HospitalInfoService } from '../../src/modules/hospital-info/hospital-info.service';

type AnyRec = Record<string, any>;

function makePrisma() {
  return {
    hospitalInfoContent: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: 'c-1', category: 'DEPARTMENT', slug: 'internal-medicine', title: '내과', metadata: {} }),
      findUnique: vi.fn().mockResolvedValue({ id: 'c-1', category: 'DEPARTMENT', slug: 'internal-medicine', title: '내과', metadata: {} }),
    },
    doctorProfile: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: 'dp-1', userId: 'u-1', user: { id: 'u-1', familyName: '김', givenName: '의사' } }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
  } as AnyRec;
}

describe('공개 API 노출 계약 — hospital-info', () => {
  let p: AnyRec;
  let svc: HospitalInfoService;

  beforeEach(() => {
    p = makePrisma();
    svc = new HospitalInfoService(p as any, { get: () => undefined } as any);
  });

  // ── 1. 미발행 콘텐츠 유출 ──

  it('findPublic 은 발행(PUBLISHED)·활성·미삭제만 조회한다', async () => {
    await svc.findPublic('NEWS');
    const where = p.hospitalInfoContent.findMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect(where.status).toBe('PUBLISHED');   // 🔴 없으면 DRAFT/ARCHIVED 가 공개로 샌다
    expect(where.deletedAt).toBeNull();       // 🔴 없으면 휴지통 글이 공개로 샌다
    expect(where.category).toBe('NEWS');
  });

  it('searchPublic 도 같은 공개 조건을 쓴다 (검색이 우회로가 되면 안 된다)', async () => {
    await svc.searchPublic('주차');
    const where = p.hospitalInfoContent.findMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect(where.status).toBe('PUBLISHED');
    expect(where.deletedAt).toBeNull();
  });

  it('findByTags(AI 도우미)도 같은 공개 조건을 쓴다', async () => {
    await svc.findByTags(['주차']);
    const where = p.hospitalInfoContent.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('PUBLISHED');
    expect(where.deletedAt).toBeNull();
  });

  it('findPublicBySlug 는 발행 조건을 걸고 조회한다 (슬러그 직접 접근이 우회로가 되면 안 된다)', async () => {
    await svc.findPublicBySlug('DEPARTMENT', 'internal-medicine');
    const args = p.hospitalInfoContent.findFirst.mock.calls[0][0];
    expect(args.where.status).toBe('PUBLISHED');
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.isActive).toBe(true);
    expect(args.where.category).toBe('DEPARTMENT');
    expect(args.where.slug).toBe('internal-medicine');
  });

  it('findPublicBySlug 는 미발행이면 404 를 던진다 (존재 여부도 흘리지 않는다)', async () => {
    p.hospitalInfoContent.findFirst.mockResolvedValue(null);
    await expect(svc.findPublicBySlug('DEPARTMENT', 'draft-dept')).rejects.toThrow();
  });

  // ── 2. 의료진 프로필 PHI/직원정보 노출 ──

  it('공개 의료진 목록은 isPublic·재직자만, 이메일 필드를 select 하지 않는다', async () => {
    await svc.getPublicDoctorProfiles();
    const args = p.doctorProfile.findMany.mock.calls[0][0];
    expect(args.where.isPublic).toBe(true);
    expect(args.where.user).toEqual({ isActive: true }); // 🔴 없으면 퇴직자가 홈페이지에 남는다
    expect(args.select.user.select.email).toBeUndefined();
    expect(args.include).toBeUndefined(); // include 를 쓰면 user 전 컬럼이 딸려 나온다
  });

  it('공개 의료진 상세는 isPublic·재직 필터를 걸고 이메일을 내보내지 않는다', async () => {
    await svc.getPublicDoctorProfile('u-1');
    const args = p.doctorProfile.findFirst.mock.calls[0][0];
    expect(args.where.isPublic).toBe(true);
    expect(args.where.userId).toBe('u-1');
    expect(args.where.user).toEqual({ isActive: true });
    // 🔴 원 결함: user.email 이 select 에 있어 무인증 응답에 직원 이메일이 실려 나갔다
    expect(args.select.user.select.email).toBeUndefined();
    expect(Object.keys(args.select.user.select)).toEqual(
      expect.arrayContaining(['id', 'familyName', 'givenName', 'department', 'specialty']),
    );
  });

  it('공개 의료진 상세는 비공개 프로필이면 404 (isPublic=false 를 조용히 돌려주지 않는다)', async () => {
    p.doctorProfile.findFirst.mockResolvedValue(null);
    await expect(svc.getPublicDoctorProfile('u-hidden')).rejects.toThrow();
  });

  // ── 3. 공개 응답에 환자정보가 섞일 자리가 없는지 (PHI 0 계약) ──

  it('공개 조회 메서드는 환자 관련 테이블을 건드리지 않는다', async () => {
    // prisma mock 에 patient 계열이 아예 없으므로, 접근하면 TypeError 로 터진다.
    await svc.findPublic('NEWS');
    await svc.searchPublic('안내');
    await svc.getPublicDoctorProfiles();
    expect(p.patient).toBeUndefined();
  });
});
