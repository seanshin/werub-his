import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { HomepagePopupService } from '../../src/modules/homepage-popup/homepage-popup.service';

/**
 * W9 가드 — 관리 화면이 편집시키는 값은 저장된다.
 *
 * 원 결함: create() 화이트리스트에 스타일 필드가 통째로 빠져 있어, 관리자가 템플릿·색·클립아트·
 * 폰트크기를 라이브 미리보기까지 보며 만든 팝업이 저장 시 **전부 기본값으로 버려졌다**.
 * update() 는 `{...data}` 라 통과했기 때문에 "새로 만들면 사라지고, 다시 저장하면 남는" 비대칭이었다.
 * 그리고 공개 렌더러는 linkText 를 읽는데 화면은 buttonText 만 입력받아 버튼 문구가 영영 안 나갔다.
 */
describe('HomepagePopupService — 스타일 저장/버튼문구 계약', () => {
  let prisma: any;
  let svc: HomepagePopupService;

  beforeEach(() => {
    prisma = {
      homepagePopup: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'p-1', ...data })),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'p-1', ...data })),
        findUnique: vi.fn(),
      },
    };
    svc = new HomepagePopupService(prisma);
  });

  const base = { title: '휴진 안내', type: 'MODAL', startDate: '2026-08-01', endDate: '2026-08-31' };

  it('생성 시 스타일 필드가 DB 로 내려간다', async () => {
    await svc.create({
      ...base,
      bgColor: '#FFF7ED', textColor: '#9A3412', buttonColor: '#EA580C', buttonText: '일정 확인',
      clipartId: 'hospital-building', clipartPosition: 'top',
      overlayOpacity: 20, borderRadius: 24, fontSize: 'lg', templateId: 'notice-closed',
    } as any, 'u-1');

    const data = prisma.homepagePopup.create.mock.calls[0][0].data;
    expect(data.bgColor).toBe('#FFF7ED');
    expect(data.textColor).toBe('#9A3412');
    expect(data.buttonColor).toBe('#EA580C');
    expect(data.buttonText).toBe('일정 확인');
    expect(data.clipartId).toBe('hospital-building');
    expect(data.clipartPosition).toBe('top');
    expect(data.overlayOpacity).toBe(20);
    expect(data.borderRadius).toBe(24);
    expect(data.fontSize).toBe('lg');
    expect(data.templateId).toBe('notice-closed');
  });

  it('공개 렌더러가 읽는 linkText 를 buttonText 로 채운다 (화면 문구가 공개 화면에 나가야 한다)', async () => {
    await svc.create({ ...base, buttonText: '검진 예약' } as any, 'u-1');
    expect(prisma.homepagePopup.create.mock.calls[0][0].data.linkText).toBe('검진 예약');
  });

  it('수정도 같은 규칙 — buttonText 를 바꾸면 linkText 가 따라간다(정본이 갈라지지 않는다)', async () => {
    await svc.update('p-1', { buttonText: '자세히' } as any);
    const data = prisma.homepagePopup.update.mock.calls[0][0].data;
    expect(data.buttonText).toBe('자세히');
    expect(data.linkText).toBe('자세히');
  });

  it('수정에서 보내지 않은 스타일 키는 건드리지 않는다(빈 값으로 지우지 않는다)', async () => {
    await svc.update('p-1', { title: '제목만 변경' } as any);
    const data = prisma.homepagePopup.update.mock.calls[0][0].data;
    expect('bgColor' in data).toBe(false);
    expect('clipartId' in data).toBe(false);
  });

  it('빈 문자열 스타일은 null 로 정규화한다(색상 컬럼에 "" 를 박지 않는다)', async () => {
    await svc.create({ ...base, clipartId: '', bgColor: '' } as any, 'u-1');
    const data = prisma.homepagePopup.create.mock.calls[0][0].data;
    expect(data.clipartId).toBeNull();
    expect(data.bgColor).toBeNull();
  });

  it('빈/잘못된 날짜는 400 — Invalid Date 를 DB 까지 보내지 않는다', async () => {
    await expect(svc.create({ ...base, startDate: '' } as any, 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create({ ...base, endDate: 'not-a-date' } as any, 'u-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.homepagePopup.create).not.toHaveBeenCalled();
  });

  it('종료일이 시작일보다 빠르면 400 — 만들자마자 만료된 팝업을 허용하지 않는다', async () => {
    await expect(svc.create({ ...base, startDate: '2026-08-31', endDate: '2026-08-01' } as any, 'u-1'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  // ── 역검증: 원 결함(화이트리스트 누락)을 재주입하면 위 단언이 실제로 깨지는가 ──
  it('역검증 — 스타일을 뺀 옛 create 를 흉내내면 첫 단언이 실패한다', async () => {
    const legacyCreate = (d: any) => ({
      title: d.title, type: d.type, content: d.content, imageUrl: d.imageUrl,
      linkUrl: d.linkUrl, linkText: d.linkText, targetPages: d.targetPages ?? ['*'],
      startDate: new Date(d.startDate), endDate: new Date(d.endDate),
      hideToday: true, sortOrder: 0,
    });
    const legacy = legacyCreate({ ...base, bgColor: '#FFF7ED', buttonText: '일정 확인' });
    expect((legacy as Record<string, unknown>).bgColor).toBeUndefined(); // 결함 재현
    expect((legacy as Record<string, unknown>).linkText).toBeUndefined(); // 버튼 문구도 유실
  });
});
