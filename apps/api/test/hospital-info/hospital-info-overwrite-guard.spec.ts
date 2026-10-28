import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { HospitalInfoService, emptiedKeys, hasText, mergeMetadata } from '../../src/modules/hospital-info/hospital-info.service';

/**
 * W9 가드 — **목록 응답으로 상세를 덮어쓸 수 없다**.
 *
 * 원 결함(W8 /admin/forms 와 동형): 편집 화면이 본문/구조화 데이터를 빈 값으로 되돌려 PUT 하면
 * 서버가 그대로 저장해 공개 콘텐츠가 사라졌다. CMS 편집기의 '고급: 구조화 데이터' 는 JSON 파싱
 * 실패를 `{}` 로 삼켜 그 PUT 을 **오타 한 글자로** 만들어냈다.
 * 서버 방어가 정본이다 — 화면만 고치면 스크립트·구버전 FE 가 같은 PUT 을 그대로 한다.
 */
describe('HospitalInfoService — 목록/빈값 덮어쓰기 방어', () => {
  let prisma: any;
  let svc: HospitalInfoService;

  const existing = {
    id: 'c-1',
    category: 'NEWS',
    slug: 'notice-1',
    title: '공지',
    content: '<p>본문이 있는 공지입니다</p>',
    metadata: { subType: 'NOTICE', author: '홍보팀' },
    tags: ['공지'],
    imageUrl: null,
    sortOrder: 0,
    isPinned: false,
  };

  beforeEach(() => {
    prisma = {
      hospitalInfoContent: {
        findUnique: vi.fn().mockResolvedValue({ ...existing }),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...existing, ...data })),
      },
      hospitalInfoAudit: { create: vi.fn() },
    };
    svc = new HospitalInfoService(prisma, { get: () => undefined } as any);
  });

  it('본문을 빈 문자열로 덮어쓰려 하면 400 — DB 는 손대지 않는다', async () => {
    await expect(svc.update('c-1', { content: '' }, 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.hospitalInfoContent.update).not.toHaveBeenCalled();
  });

  it('리치텍스트 빈 껍데기(<p></p>·&nbsp;)도 본문 소거로 본다', async () => {
    await expect(svc.update('c-1', { content: '<p>&nbsp;</p>' }, 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.hospitalInfoContent.update).not.toHaveBeenCalled();
  });

  it('구조화 데이터를 통째로 `{}` 로 보내도 기존 키는 살아남는다 (FE 의 JSON 파싱 실패 → {} 경로)', async () => {
    await svc.update('c-1', { metadata: {} }, 'u-1');
    const data = prisma.hospitalInfoContent.update.mock.calls[0][0].data;
    expect(data.metadata).toEqual({ subType: 'NOTICE', author: '홍보팀' });
  });

  it('🔴 병합만으론 못 막는 것 — 키를 보내되 값이 빈 컨테이너면 400 (W8 `fields: []` 와 동형)', async () => {
    await expect(svc.update('c-1', { metadata: { subType: '' } }, 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.hospitalInfoContent.update).not.toHaveBeenCalled();
  });

  it('빈 배열/빈 객체로 기존 값을 덮어쓰는 것도 막는다', async () => {
    prisma.hospitalInfoContent.findUnique.mockResolvedValue({ ...existing, metadata: { fields: [{ q: '문항1' }], detail: { a: 1 } } });
    await expect(svc.update('c-1', { metadata: { fields: [] } }, 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update('c-1', { metadata: { detail: {} } }, 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.hospitalInfoContent.update).not.toHaveBeenCalled();
  });

  it('원래 비어 있던 키를 빈 값으로 보내는 것은 막지 않는다(오탐 방지)', async () => {
    prisma.hospitalInfoContent.findUnique.mockResolvedValue({ ...existing, metadata: { subType: '' } });
    await expect(svc.update('c-1', { metadata: { subType: '' } }, 'u-1')).resolves.toBeTruthy();
  });

  it('구조화 데이터는 **최상위 키 병합** — 보내지 않은 키(공개 화면이 읽는 subType)가 살아남는다', async () => {
    await svc.update('c-1', { metadata: { author: '기획팀' } }, 'u-1');
    const data = prisma.hospitalInfoContent.update.mock.calls[0][0].data;
    expect(data.metadata).toEqual({ subType: 'NOTICE', author: '기획팀' });
  });

  it('키를 지우려면 null 로 명시한다 — 빈 컨테이너를 남기지 않는다', async () => {
    await svc.update('c-1', { metadata: { author: null } }, 'u-1');
    const data = prisma.hospitalInfoContent.update.mock.calls[0][0].data;
    expect(data.metadata).toEqual({ subType: 'NOTICE' });
    expect('author' in (data.metadata as object)).toBe(false);
  });

  it('본문이 원래 비어 있던 콘텐츠는 빈 본문 저장을 막지 않는다(오탐 방지)', async () => {
    prisma.hospitalInfoContent.findUnique.mockResolvedValue({ ...existing, content: '', metadata: {} });
    await expect(svc.update('c-1', { content: '', metadata: {} }, 'u-1')).resolves.toBeTruthy();
  });

  it('구조화 데이터가 원래 없던 콘텐츠에 새 키를 넣는 것은 통과한다', async () => {
    prisma.hospitalInfoContent.findUnique.mockResolvedValue({ ...existing, metadata: null });
    await svc.update('c-1', { metadata: { subType: 'PRESS' } }, 'u-1');
    expect(prisma.hospitalInfoContent.update.mock.calls[0][0].data.metadata).toEqual({ subType: 'PRESS' });
  });

  it('정상 수정은 그대로 통과한다', async () => {
    await svc.update('c-1', { title: '수정된 공지', content: '<p>새 본문</p>' }, 'u-1');
    const data = prisma.hospitalInfoContent.update.mock.calls[0][0].data;
    expect(data.title).toBe('수정된 공지');
    expect(data.content).toBe('<p>새 본문</p>');
  });

  // ── 역검증: 결함을 재주입하면 위 가드가 실제로 깨지는가 ──
  describe('역검증 — 결함 재주입', () => {
    it('전체 치환(병합 없음)을 흉내내면 subType 이 사라진다 = 가드가 잡는 그 사고', () => {
      const naive = (_old: Record<string, unknown>, incoming: Record<string, unknown>) => incoming;
      expect(naive(existing.metadata, {})).toEqual({});
      // 정본은 같은 입력을 거부 대상으로 만든다(빈 병합 결과 → 서비스가 400)
      expect(mergeMetadata(existing.metadata, {})).toEqual(existing.metadata);
    });

    it('빈 컨테이너 검사를 빼면 `fields: []` 가 그대로 덮인다 = 그림자 결함', () => {
      const old = { fields: [{ q: '문항1' }] };
      expect(mergeMetadata(old, { fields: [] })).toEqual({ fields: [] }); // 병합만 하면 통과해버린다
      expect(emptiedKeys(old, { fields: [] })).toEqual(['fields']);       // 정본: 잡아낸다
    });

    it('hasText 가 태그를 벗기지 않으면 <p></p> 를 "본문 있음"으로 오판한다', () => {
      const naive = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
      expect(naive('<p></p>')).toBe(true);   // 재주입된 결함: 소거를 통과시킨다
      expect(hasText('<p></p>')).toBe(false); // 정본: 막는다
    });
  });
});
