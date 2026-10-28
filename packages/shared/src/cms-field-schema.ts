/**
 * 홈페이지 CMS 필드 정본 — **공개 화면이 무엇을 읽는가**를 한 곳에 적는다.
 *
 * 🔴 왜 필요한가(2026-08-21 실측):
 *   CMS 항목의 `metadata` 는 자유 JSON 이고, 관리 화면 두 곳 모두 **생 JSON textarea** 로만 편집한다.
 *   그래서 편집자는 카테고리마다 어떤 키가 필요한지 알 방법이 없고, 키를 빠뜨려도 아무도 말해주지 않는다.
 *   운영 실측에서 **공개 화면이 읽는데 DB 에 0행인 키**가 여럿 나왔다 —
 *   NEWS `thumbnailUrl` · CENTER `features` · GALLERY `images` · HEALTH_INFO `ageGroup/category/season` ·
 *   CSR `location/thumbnailUrl`. 화면은 그 자리를 조용히 비운 채 그렸다.
 *
 * 이 파일이 정본이면:
 *   · CMS 편집기가 **구조화 폼**을 그린다(자유 JSON 은 '고급'으로 남되 미지의 키를 지우지 않는다)
 *   · 편집기가 **"공개 화면이 읽는데 비어 있다"** 를 그 자리에서 말한다(어디에 나오는지와 함께)
 *   · 공개 화면 렌더 코드와 갈라지면 가드가 실패한다
 *
 * 🔴 여기 없는 키를 저장하는 것은 **금지가 아니다** — 미지의 키는 보존한다(whitelist 함정 회피).
 *    이 표는 "무엇이 필요한가"의 정본이지 "무엇만 허용되는가"의 정본이 아니다.
 */

import { CMS_STYLE_PRESETS } from './cms-style-preset';

export type CmsFieldType =
  | 'text'      // 한 줄 문자열
  | 'textarea'  // 여러 줄 문자열
  | 'url'       // 링크·이미지 경로
  | 'date'      // YYYY-MM-DD
  | 'tel'       // 전화번호
  | 'email'
  | 'number'
  | 'select'    // options 중 하나
  | 'list'      // 문자열 배열(편집기는 쉼표/줄바꿈 입력 → 배열 저장)
  | 'color';    // 색상 — 프리셋 우선(CMS_STYLE_PRESETS)

export interface CmsFieldDef {
  key: string;
  label: string;
  type: CmsFieldType;
  /** 🔴 공개 화면에서 이 값이 무엇이 되는가 — 편집자가 읽는 문장. 비면 안 된다. */
  usedFor: string;
  /**
   * true = **없으면 공개 화면이 제 모습을 내지 못한다**(빈 자리·폴백으로 그려진다).
   * 저장을 막는 뜻이 아니다 — 막으면 아무 값이나 채워 넣어 거짓 데이터가 된다(v4.5.0 교훈).
   * 편집기는 경고만 하고 저장은 허용한다.
   */
  requiredForDisplay?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

/** 대표 이미지(`imageUrl`)가 그 카테고리 공개 화면에서 갖는 역할. */
export type CmsImageRole = 'REQUIRED' | 'OPTIONAL' | 'UNUSED';

export interface CmsCategoryDef {
  category: string;
  label: string;
  icon: string;
  /** 이 카테고리 항목이 실제로 나오는 공개 경로(실측). 비면 "어디에도 안 나온다"는 뜻이다. */
  publicPaths: string[];
  imageRole: CmsImageRole;
  /** 이미지가 없을 때 공개 화면이 무엇으로 대체하는가 — 편집자가 결과를 예상할 수 있어야 한다. */
  imageFallbackNote?: string;
  /** 전용 관리 화면(있으면 그것이 편집 정본). 없으면 `/admin/hospital-info?category=` 로 편집한다. */
  adminHref?: string;
  fields: CmsFieldDef[];
}

const SUBTYPE = (options: { value: string; label: string }[], usedFor: string): CmsFieldDef => ({
  key: 'subType', label: '유형', type: 'select', options, usedFor, requiredForDisplay: true,
});

export const CMS_CATEGORIES: CmsCategoryDef[] = [
  {
    category: 'DEPARTMENT', label: '진료과', icon: '🩺',
    publicPaths: ['/care/departments', '/care/departments/<slug>'],
    imageRole: 'OPTIONAL', imageFallbackNote: '이미지가 없으면 진료과 카드가 아이콘+색상 카드로 그려집니다.',
    adminHref: '/admin/homepage/departments',
    fields: [
      { key: 'departmentName', label: '진료과 정식명', type: 'text', requiredForDisplay: true,
        usedFor: '상세 페이지에서 **소속 의료진을 찾는 열쇠**입니다 — 비면 의료진 목록이 비어 나옵니다.', placeholder: '예: 순환기내과' },
      { key: 'location', label: '위치', type: 'text', usedFor: '상세 페이지 안내 영역에 표시됩니다.', placeholder: '예: 본관 3층' },
      { key: 'phone', label: '대표 전화', type: 'tel', usedFor: '상세 페이지 연락처 버튼이 됩니다.' },
      { key: 'specialties', label: '전문 분야', type: 'list', requiredForDisplay: true,
        usedFor: '진료과 카드와 상세 상단의 태그로 표시됩니다.' },
      { key: 'diseases', label: '주요 질환', type: 'list', usedFor: '상세 페이지 "주요 질환" 목록입니다.' },
      { key: 'procedures', label: '주요 시술·수술', type: 'list', usedFor: '상세 페이지 "주요 시술" 목록입니다.' },
      { key: 'tests', label: '주요 검사', type: 'list', usedFor: '상세 페이지 "주요 검사" 목록입니다.' },
      { key: 'equipment', label: '보유 장비', type: 'list', usedFor: '상세 페이지 "보유 장비" 목록입니다.' },
      { key: 'highlights', label: '강점', type: 'list', usedFor: '상세 페이지 상단 강조 문구입니다.' },
      { key: 'schedule', label: '진료 시간', type: 'textarea', usedFor: '상세 페이지 진료시간 안내입니다.' },
    ],
  },
  {
    category: 'CENTER', label: '전문센터', icon: '❤️',
    publicPaths: ['/care/centers', '/care/centers/<slug>'],
    imageRole: 'OPTIONAL', imageFallbackNote: '이미지가 없으면 센터 카드가 브랜드 그라디언트로 그려집니다.',
    adminHref: '/admin/homepage/centers',
    fields: [
      { key: 'departments', label: '참여 진료과', type: 'list', requiredForDisplay: true,
        usedFor: '센터 카드·상세에 참여 진료과 태그로 표시됩니다.' },
      { key: 'features', label: '센터 특징', type: 'list',
        usedFor: '센터 상세의 특징 목록입니다. 🔴 운영 5건 모두 비어 있어 그 영역이 나오지 않습니다.' },
      { key: 'location', label: '위치', type: 'text', usedFor: '센터 카드 하단 위치 표기입니다.' },
      { key: 'phone', label: '대표 전화', type: 'tel', usedFor: '센터 연락처입니다.' },
    ],
  },
  {
    category: 'NEWS', label: '뉴스/소식', icon: '📰',
    publicPaths: ['/news', '/news/<slug>'],
    imageRole: 'OPTIONAL', imageFallbackNote: '대표 이미지가 없으면 목록에서 텍스트 카드로 그려집니다.',
    adminHref: '/admin/homepage/news',
    fields: [
      SUBTYPE(
        [{ value: 'NOTICE', label: '공지사항' }, { value: 'PRESS', label: '언론보도' }, { value: 'EVENT', label: '행사/이벤트' }, { value: 'AWARD', label: '수상/인증' }],
        '뉴스 목록의 **유형 필터**에 쓰입니다 — 비면 어떤 필터에도 걸리지 않습니다.',
      ),
      { key: 'author', label: '작성자·부서', type: 'text', usedFor: '기사 하단 출처 표기입니다.' },
      { key: 'importance', label: '중요도', type: 'select',
        options: [{ value: 'HIGH', label: '높음' }, { value: 'NORMAL', label: '보통' }],
        usedFor: '목록 상단 강조 여부를 정합니다.' },
      { key: 'sourceUrl', label: '원문 링크', type: 'url', usedFor: '언론보도의 원문으로 나가는 링크입니다.' },
      { key: 'thumbnailUrl', label: '목록 썸네일', type: 'url',
        usedFor: '목록 카드의 썸네일입니다. 🔴 운영 10건 모두 비어 있습니다 — 대표 이미지로 대체되지 않습니다.' },
    ],
  },
  {
    category: 'HEALTH_INFO', label: '건강정보', icon: '💚',
    publicPaths: ['/health-info', '/health-info/<slug>'],
    imageRole: 'OPTIONAL', imageFallbackNote: '이미지가 없으면 카드가 제목+요약만으로 그려집니다.',
    adminHref: '/admin/homepage/health-info',
    fields: [
      { key: 'category', label: '분류', type: 'text', usedFor: '건강정보 목록의 분류 필터입니다. 🔴 운영 10건 모두 비어 있습니다.' },
      { key: 'ageGroup', label: '대상 연령', type: 'text', usedFor: '연령대 필터입니다. 🔴 운영 10건 모두 비어 있습니다.' },
      { key: 'season', label: '계절', type: 'text', usedFor: '계절 필터입니다. 🔴 운영 10건 모두 비어 있습니다.' },
      { key: 'source', label: '출처', type: 'text', requiredForDisplay: true, usedFor: '본문 하단 출처 표기입니다(의학 정보의 근거).' },
    ],
  },
  {
    category: 'HEALTH_VIDEO', label: '건강TV', icon: '🎬',
    publicPaths: ['/home (건강TV 섹션)'],
    imageRole: 'REQUIRED',
    imageFallbackNote: '🔴 대표 이미지가 썸네일입니다 — 운영 6건 모두 비어 있어 재생 플레이스홀더로 그려집니다.',
    adminHref: '/admin/homepage/health-tv',
    fields: [
      { key: 'videoUrl', label: '영상 주소(임베드)', type: 'url', requiredForDisplay: true,
        usedFor: '재생되는 영상입니다 — 비면 카드를 눌러도 아무 일도 일어나지 않습니다.', placeholder: 'https://www.youtube.com/embed/…' },
      { key: 'duration', label: '재생 시간', type: 'text', usedFor: '썸네일 위 재생시간 배지입니다.', placeholder: '예: 5:32' },
      { key: 'doctor', label: '출연 의료진', type: 'text', usedFor: '카드 하단 출연자 표기입니다.' },
      SUBTYPE(
        [{ value: 'EDUCATION', label: '건강교육' }, { value: 'GUIDE', label: '이용안내' }, { value: 'SPECIAL', label: '특성화' }],
        '건강TV 섹션의 유형 구분입니다.',
      ),
    ],
  },
  {
    category: 'GALLERY', label: '갤러리', icon: '📸',
    publicPaths: ['/about/gallery'],
    imageRole: 'REQUIRED', imageFallbackNote: '대표 이미지가 없으면 회색 사진 자리표시로 그려집니다.',
    adminHref: '/admin/homepage/gallery',
    fields: [
      SUBTYPE(
        [{ value: 'FACILITY', label: '시설' }, { value: 'EVENT', label: '행사' }, { value: 'AWARD', label: '수상' }],
        '갤러리 상단 유형 필터입니다.',
      ),
      { key: 'date', label: '촬영·행사일', type: 'date', usedFor: '사진 아래 날짜 표기입니다.' },
      { key: 'images', label: '추가 사진', type: 'list',
        usedFor: '한 항목에 여러 장을 담을 때 씁니다(대표 이미지 외 +N 배지). 🔴 운영 31건 모두 비어 있습니다 — 현재는 항목당 1장입니다.' },
    ],
  },
  {
    category: 'CSR', label: '사회공헌', icon: '🤝',
    publicPaths: ['/about/csr'],
    imageRole: 'OPTIONAL', imageFallbackNote: '이미지가 없으면 활동 카드가 텍스트만으로 그려집니다.',
    adminHref: '/admin/homepage/csr',
    fields: [
      SUBTYPE(
        [{ value: 'MEDICAL', label: '의료봉사' }, { value: 'DONATION', label: '기부/후원' }, { value: 'EDUCATION', label: '교육' }, { value: 'ENVIRONMENT', label: '환경' }],
        '사회공헌 목록의 유형 필터입니다.',
      ),
      { key: 'date', label: '활동일', type: 'date', requiredForDisplay: true, usedFor: '활동 카드의 날짜입니다.' },
      { key: 'participants', label: '참여 인원', type: 'text', usedFor: '활동 카드의 참여 규모 표기입니다.' },
      { key: 'location', label: '활동 장소', type: 'text', usedFor: '활동 카드의 장소 표기입니다. 🔴 운영 8건 모두 비어 있습니다.' },
      { key: 'thumbnailUrl', label: '목록 썸네일', type: 'url', usedFor: '목록 카드 썸네일입니다. 🔴 운영 8건 모두 비어 있습니다.' },
    ],
  },
  {
    category: 'RECRUIT', label: '채용', icon: '👤',
    publicPaths: ['/news/recruit'],
    imageRole: 'UNUSED', imageFallbackNote: '채용 공고는 이미지를 쓰지 않습니다.',
    adminHref: '/admin/homepage/recruit',
    fields: [
      { key: 'position', label: '모집 직위', type: 'text', requiredForDisplay: true, usedFor: '공고 카드의 제목 옆 직위 표기입니다.' },
      { key: 'department', label: '모집 부서', type: 'text', requiredForDisplay: true, usedFor: '공고 카드의 부서 표기입니다.' },
      { key: 'employmentType', label: '고용 형태', type: 'select',
        options: [{ value: 'FULL_TIME', label: '정규직' }, { value: 'CONTRACT', label: '계약직' }, { value: 'PART_TIME', label: '시간제' }, { value: 'INTERN', label: '인턴' }],
        usedFor: '공고 카드의 고용형태 배지입니다.' },
      { key: 'status', label: '모집 상태', type: 'select',
        options: [{ value: 'OPEN', label: '모집중' }, { value: 'CLOSED', label: '마감' }],
        requiredForDisplay: true, usedFor: '🔴 **모집중/마감 배지**입니다 — 비면 마감된 공고가 모집중처럼 보일 수 있습니다.' },
      { key: 'deadline', label: '접수 마감일', type: 'date', requiredForDisplay: true, usedFor: '공고의 마감일 표기입니다.' },
      { key: 'requirements', label: '자격 요건', type: 'list', usedFor: '공고 상세의 자격요건 목록입니다.' },
      { key: 'benefits', label: '복리후생', type: 'list', usedFor: '공고 상세의 복리후생 목록입니다.' },
      { key: 'contactEmail', label: '문의 이메일', type: 'email', usedFor: '지원·문의 연락처입니다.' },
    ],
  },
  {
    category: 'BANNER', label: '배너', icon: '🖼️',
    publicPaths: ['/home (히어로 슬라이더 · 띠배너)'],
    imageRole: 'REQUIRED',
    imageFallbackNote: '🔴 이미지가 없으면 히어로가 **배경색 위 텍스트**로 그려집니다 — 운영 3건 모두 이미지가 없어 지금 그 상태입니다.',
    adminHref: '/admin/homepage/banners',
    fields: [
      SUBTYPE(
        [{ value: 'HERO', label: '히어로(메인 대형)' }, { value: 'STRIP', label: '띠배너(상단 얇은 줄)' }],
        '🔴 배너가 **어디에 나오는지**를 정합니다 — 비면 어느 자리에도 나오지 않습니다.',
      ),
      { key: 'stylePreset', label: '색상 프리셋', type: 'select',
        options: CMS_STYLE_PRESETS.map((p) => ({ value: p.key, label: `${p.label} — ${p.hint}` })),
        usedFor: '이미지가 없을 때 쓰는 배경 디자인입니다. 프리셋은 브랜드 팔레트와 그라디언트를 **한 벌로** 적용해 대비가 보장됩니다.' },
      { key: 'bgColor', label: '배경색(직접 지정)', type: 'color',
        usedFor: '프리셋을 쓰지 않을 때의 배경색입니다. 프리셋이 있으면 프리셋이 우선합니다.' },
      { key: 'textColor', label: '글자색(직접 지정)', type: 'color', usedFor: '프리셋을 쓰지 않을 때의 글자색입니다.' },
      { key: 'linkUrl', label: '연결 링크', type: 'url', requiredForDisplay: true, usedFor: '배너를 눌렀을 때 이동할 주소입니다.' },
      { key: 'linkText', label: '버튼 문구', type: 'text', requiredForDisplay: true, usedFor: '배너의 버튼에 적히는 문구입니다.' },
      { key: 'displayOrder', label: '노출 순서', type: 'number', usedFor: '히어로 슬라이드 순서입니다(작을수록 먼저).' },
    ],
  },
  {
    category: 'GENERAL', label: '일반안내', icon: '🏥',
    publicPaths: ['/about', '/about/directions'],
    imageRole: 'OPTIONAL',
    fields: [
      { key: 'pageType', label: '페이지 구분', type: 'text', usedFor: '내부 분류용입니다 — 공개 화면은 읽지 않습니다.' },
      { key: 'contactInfo', label: '연락처 정보', type: 'textarea', usedFor: '오시는 길 페이지의 연락처 블록입니다.' },
      { key: 'mapCoords', label: '지도 좌표', type: 'text', usedFor: '오시는 길 지도의 중심 좌표입니다.', placeholder: '예: 33.2541,126.5601' },
    ],
  },
  {
    category: 'CHECKUP_INFO', label: '건강검진', icon: '🧪',
    publicPaths: ['/checkup', '/checkup/<slug>'],
    imageRole: 'OPTIONAL',
    fields: [
      { key: 'programName', label: '프로그램명', type: 'text', usedFor: '검진 프로그램 카드의 이름입니다.' },
      { key: 'price', label: '가격', type: 'text', usedFor: '검진 프로그램의 가격 표기입니다.' },
      { key: 'duration', label: '소요 시간', type: 'text', usedFor: '검진 소요시간 표기입니다.' },
      { key: 'targetAge', label: '권장 연령', type: 'text', usedFor: '권장 대상 연령 표기입니다.' },
      { key: 'items', label: '검사 항목', type: 'list', usedFor: '프로그램 포함 항목 목록입니다.' },
      { key: 'subType', label: '유형', type: 'text', usedFor: '검진 유형 구분입니다.' },
    ],
  },
  {
    category: 'FACILITY', label: '시설', icon: '🏢',
    publicPaths: ['/about (시설 안내)'],
    imageRole: 'OPTIONAL',
    fields: [
      { key: 'floor', label: '층', type: 'text', usedFor: '시설 안내의 층 표기입니다.' },
      { key: 'sections', label: '구역 목록', type: 'list', usedFor: '해당 층의 구역 목록입니다.' },
    ],
  },
  {
    category: 'NON_COVERED', label: '비급여', icon: '💰',
    publicPaths: ['/care/non-covered'],
    imageRole: 'UNUSED',
    adminHref: '/admin/non-covered',
    fields: [
      { key: 'items', label: '항목 목록', type: 'list', usedFor: '비급여 항목·가격 목록입니다.' },
      { key: 'lastUpdated', label: '최종 고지일', type: 'date', requiredForDisplay: true, usedFor: '법정 고지 항목입니다 — 마지막 갱신일을 표시합니다.' },
      { key: 'updateReason', label: '변경 사유', type: 'text', usedFor: '가격 변경 사유 표기입니다.' },
      { key: 'subType', label: '분류', type: 'text', usedFor: '비급여 분류 구분입니다.' },
    ],
  },
  {
    category: 'VOC', label: '고객의소리', icon: '💬',
    publicPaths: ['/support'],
    imageRole: 'UNUSED',
    fields: [
      { key: 'subType', label: '분류', type: 'text', usedFor: '고객의소리 접수 경로 구분입니다.' },
      { key: 'contactPhone', label: '접수 전화', type: 'tel', usedFor: '안내되는 접수 전화번호입니다.' },
      { key: 'responseTime', label: '회신 소요', type: 'text', usedFor: '회신까지 걸리는 기간 안내입니다.' },
    ],
  },
  { category: 'FAQ', label: 'FAQ', icon: '❓', publicPaths: ['/support (자주 묻는 질문)'], imageRole: 'UNUSED', fields: [] },
  { category: 'PARKING', label: '주차', icon: '🅿️', publicPaths: ['/about/directions'], imageRole: 'OPTIONAL', fields: [] },
  { category: 'DINING', label: '식당/카페', icon: '🍽️', publicPaths: ['/about'], imageRole: 'OPTIONAL', fields: [] },
  { category: 'FUNERAL', label: '장례식장', icon: '🕊️', publicPaths: ['/about'], imageRole: 'OPTIONAL', fields: [] },
];

export const CMS_CATEGORY_BY_KEY: Record<string, CmsCategoryDef> =
  Object.fromEntries(CMS_CATEGORIES.map((c) => [c.category, c]));

export const cmsCategoryDef = (category: string): CmsCategoryDef | undefined => CMS_CATEGORY_BY_KEY[category];

/** 값이 "비어 있다"의 정본 — 빈 문자열·빈 배열·빈 객체는 비어 있는 것으로 본다(0 과 false 는 값이다). */
export function cmsValueIsEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

export interface CmsGap {
  key: string;
  label: string;
  usedFor: string;
  /** 'FIELD' = metadata 키 · 'IMAGE' = 대표 이미지 */
  kind: 'FIELD' | 'IMAGE';
}

/**
 * 공개 화면이 읽는데 **비어 있는** 것을 센다.
 * 🔴 이것은 저장을 막는 검증이 아니다 — 편집자에게 결과를 미리 말해주는 것이다.
 *    필수로 강제하면 아무 값이나 채워 넣어 거짓 데이터가 된다(v4.5.0 laterality 교훈).
 */
export function cmsDisplayGaps(
  category: string,
  item: { metadata?: Record<string, unknown> | null; imageUrl?: string | null },
): CmsGap[] {
  const def = cmsCategoryDef(category);
  if (!def) return [];
  const meta = item.metadata ?? {};
  const gaps: CmsGap[] = def.fields
    .filter((f) => f.requiredForDisplay && cmsValueIsEmpty(meta[f.key]))
    .map((f) => ({ key: f.key, label: f.label, usedFor: f.usedFor, kind: 'FIELD' as const }));
  if (def.imageRole === 'REQUIRED' && cmsValueIsEmpty(item.imageUrl)) {
    gaps.unshift({
      key: 'imageUrl', label: '대표 이미지', kind: 'IMAGE',
      usedFor: def.imageFallbackNote ?? '이 카테고리는 대표 이미지가 화면의 주된 요소입니다.',
    });
  }
  return gaps;
}

/** 정본에 없는 키(자유 확장) — 편집기는 이것을 **지우지 않고** 고급 영역에서 보존한다. */
export function cmsUnknownKeys(category: string, metadata: Record<string, unknown> | null | undefined): string[] {
  const def = cmsCategoryDef(category);
  const known = new Set((def?.fields ?? []).map((f) => f.key));
  return Object.keys(metadata ?? {}).filter((k) => !known.has(k));
}
