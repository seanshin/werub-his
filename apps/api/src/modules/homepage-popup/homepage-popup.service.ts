import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/** 팝업 스타일 필드 — 관리 화면(스타일 탭·라이브 미리보기)이 실제로 편집하는 값 */
type PopupStyle = {
  bgColor?: string; textColor?: string; buttonText?: string; buttonColor?: string;
  clipartId?: string; clipartPosition?: string; overlayOpacity?: number;
  borderRadius?: number; fontSize?: string; templateId?: string;
};

/** 빈 문자열은 "미지정"이지 값이 아니다 — 색상/폰트 컬럼에 '' 를 박지 않는다 */
const orNull = <T>(v: T | '' | undefined): T | null => (v === undefined || v === '' ? null : (v as T));

function parseDate(label: string, raw: unknown): Date {
  const d = new Date(String(raw ?? ''));
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label}가 올바르지 않습니다`);
  return d;
}

@Injectable()
export class HomepagePopupService {
  constructor(private readonly prisma: PrismaService) {}

  /** 관리자: 전체 목록 */
  async findAll() {
    return this.prisma.homepagePopup.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: { creator: { select: { familyName: true, givenName: true } } },
    });
  }

  /** 공개: 현재 활성 팝업 (기간 내 + isActive) */
  async findActive(page?: string) {
    const now = new Date();
    const popups = await this.prisma.homepagePopup.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { sortOrder: 'asc' },
    });
    // targetPages 필터
    if (page) {
      return popups.filter(p => p.targetPages.includes('*') || p.targetPages.includes(page));
    }
    return popups;
  }

  /**
   * 생성
   *
   * 🔴 W9 실결함: 이 화이트리스트에 **스타일 필드가 통째로 빠져 있었다**. 관리 화면(/admin/homepage/popups)은
   * 템플릿·배경색·글자색·버튼색·클립아트·폰트크기를 라이브 미리보기까지 보여주며 편집시키는데,
   * 생성 요청이 오면 서버가 그 값들을 **전부 버리고** "팝업이 생성되었습니다" 를 돌려줬다.
   * (update() 는 `{...data}` 라 통과 — 첫 저장만 사라지는 create/update 비대칭.)
   * 화면이 편집시키는 것은 저장한다.
   */
  async create(data: {
    title: string; type: string; content?: string;
    imageUrl?: string; linkUrl?: string; linkText?: string;
    targetPages?: string[]; startDate: string; endDate: string;
    hideToday?: boolean; sortOrder?: number;
  } & PopupStyle, userId: string) {
    // 🔴 빈 날짜('')는 Invalid Date 로 Prisma 500 이 되어 화면엔 이유 없는 '저장에 실패했습니다' 만 떴다.
    const startDate = parseDate('시작일', data.startDate);
    const endDate = parseDate('종료일', data.endDate);
    if (endDate < startDate) throw new BadRequestException('종료일이 시작일보다 빠릅니다');

    return this.prisma.homepagePopup.create({
      data: {
        title: data.title,
        type: data.type,
        content: data.content,
        imageUrl: data.imageUrl,
        linkUrl: data.linkUrl,
        // 🔴 공개 렌더러(PopupRenderer)는 linkText 를 읽는데 관리 화면은 buttonText 만 입력받았다 →
        // 관리자가 적은 버튼 문구가 공개 화면에 영영 안 나오고 '자세히 보기' 폴백만 보였다.
        linkText: orNull(data.linkText ?? data.buttonText),
        targetPages: data.targetPages ?? ['*'],
        startDate,
        endDate,
        hideToday: data.hideToday ?? true,
        sortOrder: data.sortOrder ?? 0,
        ...this.styleData(data),
        createdBy: userId,
      },
    });
  }

  /** 수정 — 스타일 필드도 create 와 같은 규칙으로 정규화(둘이 갈라지면 화면이 갈라진다) */
  async update(id: string, data: Partial<{
    title: string; type: string; content: string;
    imageUrl: string; linkUrl: string; linkText: string;
    targetPages: string[]; startDate: string; endDate: string;
    isActive: boolean; hideToday: boolean; sortOrder: number;
  } & PopupStyle>) {
    const {
      bgColor, textColor, buttonText, buttonColor, clipartId, clipartPosition,
      overlayOpacity, borderRadius, fontSize, templateId, startDate, endDate, linkText,
      ...rest
    } = data;
    const updateData: Record<string, unknown> = { ...rest };
    if (startDate !== undefined) updateData.startDate = parseDate('시작일', startDate);
    if (endDate !== undefined) updateData.endDate = parseDate('종료일', endDate);
    if (updateData.startDate && updateData.endDate && (updateData.endDate as Date) < (updateData.startDate as Date)) {
      throw new BadRequestException('종료일이 시작일보다 빠릅니다');
    }
    Object.assign(updateData, this.styleData({
      bgColor, textColor, buttonText, buttonColor, clipartId, clipartPosition,
      overlayOpacity, borderRadius, fontSize, templateId,
    }));
    if (linkText !== undefined) updateData.linkText = orNull(linkText);
    else if (buttonText !== undefined) updateData.linkText = orNull(buttonText);
    return this.prisma.homepagePopup.update({ where: { id }, data: updateData });
  }

  /** 스타일 필드 → Prisma data (미지정 키는 생략해 기존 값을 지우지 않는다) */
  private styleData(s: PopupStyle): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (s.bgColor !== undefined) out.bgColor = orNull(s.bgColor);
    if (s.textColor !== undefined) out.textColor = orNull(s.textColor);
    if (s.buttonText !== undefined) out.buttonText = orNull(s.buttonText);
    if (s.buttonColor !== undefined) out.buttonColor = orNull(s.buttonColor);
    if (s.clipartId !== undefined) out.clipartId = orNull(s.clipartId);
    if (s.clipartPosition !== undefined) out.clipartPosition = orNull(s.clipartPosition);
    if (s.overlayOpacity !== undefined) out.overlayOpacity = s.overlayOpacity === null ? null : Number(s.overlayOpacity);
    if (s.borderRadius !== undefined) out.borderRadius = s.borderRadius === null ? null : Number(s.borderRadius);
    if (s.fontSize !== undefined) out.fontSize = orNull(s.fontSize);
    if (s.templateId !== undefined) out.templateId = orNull(s.templateId);
    return out;
  }

  /** 삭제 */
  async remove(id: string) {
    return this.prisma.homepagePopup.delete({ where: { id } });
  }

  /** 활성/비활성 토글 */
  async toggleActive(id: string) {
    const popup = await this.prisma.homepagePopup.findUnique({ where: { id } });
    if (!popup) return null;
    return this.prisma.homepagePopup.update({
      where: { id },
      data: { isActive: !popup.isActive },
    });
  }

  /** 팝업 복제 */
  async clone(id: string, userId: string) {
    const original = await this.prisma.homepagePopup.findUnique({ where: { id } });
    if (!original) return null;

    const { id: _id, createdAt: _ca, updatedAt: _ua, createdBy: _cb, ...data } = original;
    return this.prisma.homepagePopup.create({
      data: {
        ...data,
        title: `${original.title} (복사본)`,
        isActive: false,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 86400000),
        createdBy: userId,
      },
    });
  }

  /** 템플릿 목록 (하드코딩 — 빠른 구현) */
  getTemplates() {
    return [
      { id: 'notice-general', name: '일반 공지', category: '공지', type: 'MODAL', thumbnail: '/clipart/ui/megaphone.svg',
        defaults: { bgColor: '#FFFFFF', textColor: '#111827', buttonText: '자세히 보기', buttonColor: '#2563EB', clipartId: 'megaphone', fontSize: 'md' } },
      { id: 'notice-urgent', name: '긴급 공지', category: '공지', type: 'STRIP', thumbnail: '/clipart/ui/alert.svg',
        defaults: { bgColor: '#FEF2F2', textColor: '#991B1B', buttonText: '확인', buttonColor: '#DC2626', clipartId: 'alert', fontSize: 'md' } },
      { id: 'event-checkup', name: '건강검진 이벤트', category: '이벤트', type: 'MODAL', thumbnail: '/clipart/medical/stethoscope.svg',
        defaults: { bgColor: '#EFF6FF', textColor: '#1E40AF', buttonText: '검진 예약', buttonColor: '#2563EB', clipartId: 'stethoscope', fontSize: 'md' } },
      { id: 'notice-closed', name: '휴진 안내', category: '안내', type: 'MODAL', thumbnail: '/clipart/hospital/hospital-building.svg',
        defaults: { bgColor: '#FFF7ED', textColor: '#9A3412', buttonText: '일정 확인', buttonColor: '#EA580C', clipartId: 'hospital-building', fontSize: 'md' } },
      { id: 'doctor-new', name: '신규 의료진 소개', category: '안내', type: 'MODAL', thumbnail: '/clipart/people/doctor.svg',
        defaults: { bgColor: '#F0FDF4', textColor: '#166534', buttonText: '진료 예약', buttonColor: '#16A34A', clipartId: 'doctor', fontSize: 'md' } },
      { id: 'facility-info', name: '시설/장비 안내', category: '안내', type: 'PAGE_BANNER', thumbnail: '/clipart/medical/microscope.svg',
        defaults: { bgColor: '#EEF2FF', textColor: '#3730A3', buttonText: '둘러보기', buttonColor: '#4F46E5', clipartId: 'microscope', fontSize: 'lg' } },
      { id: 'health-seasonal', name: '계절 건강 정보', category: '건강', type: 'FLOATING', thumbnail: '/clipart/nature/leaf.svg',
        defaults: { bgColor: '#ECFDF5', textColor: '#065F46', buttonText: '건강정보 보기', buttonColor: '#059669', clipartId: 'leaf', fontSize: 'sm' } },
    ];
  }

  /** 클립아트 인덱스 */
  getCliparts() {
    return {
      categories: [
        { id: 'medical', name: '의료', icons: [
          { id: 'stethoscope', name: '청진기', path: '/clipart/medical/stethoscope.svg' },
          { id: 'syringe', name: '주사기', path: '/clipart/medical/syringe.svg' },
          { id: 'pill', name: '알약', path: '/clipart/medical/pill.svg' },
          { id: 'heart', name: '심장', path: '/clipart/medical/heart.svg' },
          { id: 'ambulance', name: '구급차', path: '/clipart/medical/ambulance.svg' },
          { id: 'thermometer', name: '체온계', path: '/clipart/medical/thermometer.svg' },
          { id: 'microscope', name: '현미경', path: '/clipart/medical/microscope.svg' },
          { id: 'bp-monitor', name: '혈압계', path: '/clipart/medical/bp-monitor.svg' },
          { id: 'medical-chart', name: '의료차트', path: '/clipart/medical/medical-chart.svg' },
          { id: 'dna', name: 'DNA', path: '/clipart/medical/dna.svg' },
        ]},
        { id: 'hospital', name: '병원', icons: [
          { id: 'hospital-building', name: '병원건물', path: '/clipart/hospital/hospital-building.svg' },
          { id: 'hospital-room', name: '병실', path: '/clipart/hospital/hospital-room.svg' },
          { id: 'operating-room', name: '수술실', path: '/clipart/hospital/operating-room.svg' },
          { id: 'reception', name: '접수대', path: '/clipart/hospital/reception.svg' },
          { id: 'hospital-bed', name: '병원침대', path: '/clipart/hospital/hospital-bed.svg' },
          { id: 'medical-device', name: '의료기기', path: '/clipart/hospital/medical-device.svg' },
        ]},
        { id: 'people', name: '사람', icons: [
          { id: 'doctor', name: '의사', path: '/clipart/people/doctor.svg' },
          { id: 'nurse', name: '간호사', path: '/clipart/people/nurse.svg' },
          { id: 'patient', name: '환자', path: '/clipart/people/patient.svg' },
          { id: 'family', name: '가족', path: '/clipart/people/family.svg' },
          { id: 'elderly', name: '노인', path: '/clipart/people/elderly.svg' },
          { id: 'child', name: '어린이', path: '/clipart/people/child.svg' },
        ]},
        { id: 'nature', name: '자연/건강', icons: [
          { id: 'leaf', name: '나뭇잎', path: '/clipart/nature/leaf.svg' },
          { id: 'sun', name: '태양', path: '/clipart/nature/sun.svg' },
          { id: 'heart-pulse', name: '하트', path: '/clipart/nature/heart-pulse.svg' },
          { id: 'star', name: '별', path: '/clipart/nature/star.svg' },
        ]},
        { id: 'ui', name: 'UI', icons: [
          { id: 'checkmark', name: '체크마크', path: '/clipart/ui/checkmark.svg' },
          { id: 'calendar', name: '달력', path: '/clipart/ui/calendar.svg' },
          { id: 'clock', name: '시계', path: '/clipart/ui/clock.svg' },
          { id: 'megaphone', name: '메가폰', path: '/clipart/ui/megaphone.svg' },
          { id: 'alert', name: '경고', path: '/clipart/ui/alert.svg' },
          { id: 'phone', name: '전화기', path: '/clipart/ui/phone.svg' },
        ]},
      ],
      total: 32,
    };
  }
}
