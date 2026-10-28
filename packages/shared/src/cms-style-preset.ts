/**
 * CMS → 공개 홈페이지 **표현(스타일) 정본**.
 *
 * 🔴 왜 필요한가(2026-08-21 실측):
 *   CMS 배너는 `metadata.bgColor` / `textColor` 에 **자유 hex** 를 담고, 홈페이지는 그것을
 *   `style={{ backgroundColor }}` 로 그대로 칠한다. 결과는 **단색 사각형 위 밑줄 링크**다.
 *   운영 배너 3건 모두 `image_url` 이 비어 있어, 사이트 첫 화면이 지금 그 모습이다
 *   (이미지가 있으면 쓰던 정적 사진 5장은 CMS 배너가 있는 한 영영 나오지 않는다).
 *
 *   자유 hex 는 두 가지를 동시에 잃는다 —
 *   ① 편집자가 브랜드와 어울리는 색을 고를 근거가 없다
 *   ② 대비(contrast)를 아무도 보장하지 않는다(연한 배경 + 흰 글자 = 안 읽힘)
 *
 *   그래서 **프리셋**이 정본이다. 프리셋은 배경·글자·강조·그라디언트를 **한 벌로** 정의하므로
 *   편집자는 "색"이 아니라 "분위기"를 고르고, 결과는 항상 대비가 확보된 세련된 화면이 된다.
 *   자유 hex 는 버리지 않는다 — 기존 3건이 그것으로 저장되어 있고, 그것도 사실이기 때문이다.
 */

export interface CmsStylePreset {
  key: string;
  label: string;
  /** 편집기 미리보기용 한 줄 설명 */
  hint: string;
  /** 단색 배경(그라디언트 미지원 환경·이메일 등의 폴백) */
  bg: string;
  /** 본문 글자색 — bg 와의 대비를 확보한 값만 넣는다 */
  text: string;
  /** 버튼·강조 요소 배경 */
  accent: string;
  /** 버튼 글자색 */
  accentText: string;
  /** CSS `background-image` 값 — 세련된 깊이감을 주는 정본 */
  gradient: string;
}

/**
 * 브랜드 팔레트. 🔴 색을 늘릴 때는 **대비를 확인한 것만** 추가한다 —
 * 목록에 있다는 것이 곧 "써도 읽힌다"는 약속이다.
 */
export const CMS_STYLE_PRESETS: CmsStylePreset[] = [
  {
    key: 'BRAND_DEEP', label: '브랜드 딥블루', hint: '기본 — 신뢰감 있는 병원 메인 톤',
    bg: '#0f2a4a', text: '#f8fafc', accent: '#ffffff', accentText: '#0f2a4a',
    gradient: 'linear-gradient(135deg, #0b1f38 0%, #12385f 45%, #1e5a8a 100%)',
  },
  {
    key: 'BRAND_TEAL', label: '청록 그린', hint: '건강·검진·예방 콘텐츠에 어울림',
    bg: '#0b3d3a', text: '#ecfdf5', accent: '#5eead4', accentText: '#04312e',
    gradient: 'linear-gradient(135deg, #062e2b 0%, #0d4a45 50%, #12766c 100%)',
  },
  {
    key: 'WARM_CORAL', label: '웜 코랄', hint: '행사·캠페인처럼 눈에 띄어야 할 때',
    bg: '#7a1f2b', text: '#fff1f2', accent: '#fecdd3', accentText: '#7a1f2b',
    gradient: 'linear-gradient(135deg, #611620 0%, #8f2733 55%, #c2410c 100%)',
  },
  {
    key: 'CALM_SLATE', label: '차분한 슬레이트', hint: '공지·안내처럼 조용해야 할 때',
    bg: '#1f2937', text: '#f1f5f9', accent: '#cbd5e1', accentText: '#1f2937',
    gradient: 'linear-gradient(135deg, #111827 0%, #253044 55%, #3b475c 100%)',
  },
  {
    key: 'LIGHT_MIST', label: '라이트 미스트', hint: '밝은 배경 — 글자는 진한 남색',
    bg: '#eef4fb', text: '#12304f', accent: '#12304f', accentText: '#ffffff',
    gradient: 'linear-gradient(135deg, #f6f9fd 0%, #e6eefb 55%, #d7e6f7 100%)',
  },
];

export const CMS_STYLE_PRESET_BY_KEY: Record<string, CmsStylePreset> =
  Object.fromEntries(CMS_STYLE_PRESETS.map((p) => [p.key, p]));

export const CMS_STYLE_PRESET_DEFAULT = CMS_STYLE_PRESETS[0];

/** 해석된 표현 값 — 화면은 이것만 읽는다(색을 직접 조립하지 않는다). */
export interface CmsResolvedStyle {
  bg: string;
  text: string;
  accent: string;
  accentText: string;
  gradient: string;
  /** 어디서 왔는가 — 'PRESET' | 'CUSTOM'(직접 지정 hex) | 'DEFAULT'(아무것도 지정 안 함) */
  source: 'PRESET' | 'CUSTOM' | 'DEFAULT';
  presetKey?: string;
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * metadata → 표현 값.
 * 우선순위: 프리셋 > 직접 지정 hex > 기본 프리셋.
 * 🔴 직접 지정에서도 **그라디언트를 만들어 준다** — 단색 사각형으로 그리지 않는다.
 *    (색 하나만 아는 상황에서 우아하게 보이려면 같은 색의 명도 차로 깊이를 준다.)
 */
export function cmsResolveStyle(metadata: Record<string, unknown> | null | undefined): CmsResolvedStyle {
  const meta = metadata ?? {};
  const presetKey = typeof meta.stylePreset === 'string' ? meta.stylePreset : undefined;
  const preset = presetKey ? CMS_STYLE_PRESET_BY_KEY[presetKey] : undefined;
  if (preset) {
    return { bg: preset.bg, text: preset.text, accent: preset.accent, accentText: preset.accentText, gradient: preset.gradient, source: 'PRESET', presetKey: preset.key };
  }

  const bgRaw = typeof meta.bgColor === 'string' && HEX.test(meta.bgColor.trim()) ? meta.bgColor.trim() : undefined;
  const textRaw = typeof meta.textColor === 'string' && HEX.test(meta.textColor.trim()) ? meta.textColor.trim() : undefined;
  if (bgRaw) {
    const text = textRaw ?? (cmsIsLight(bgRaw) ? '#111827' : '#ffffff');
    return {
      bg: bgRaw,
      text,
      accent: cmsIsLight(bgRaw) ? '#111827' : '#ffffff',
      accentText: cmsIsLight(bgRaw) ? '#ffffff' : bgRaw,
      // 같은 색을 어둡게/밝게 흔들어 그라디언트를 만든다 — 단색보다 깊이가 생긴다
      gradient: `linear-gradient(135deg, ${cmsShade(bgRaw, -0.22)} 0%, ${bgRaw} 55%, ${cmsShade(bgRaw, 0.16)} 100%)`,
      source: 'CUSTOM',
    };
  }

  const d = CMS_STYLE_PRESET_DEFAULT;
  return { bg: d.bg, text: d.text, accent: d.accent, accentText: d.accentText, gradient: d.gradient, source: 'DEFAULT', presetKey: d.key };
}

/** 상대 휘도로 밝은 색인지 판정(글자색 자동 결정용). */
export function cmsIsLight(hex: string): boolean {
  const { r, g, b } = cmsHexToRgb(hex);
  // WCAG 상대 휘도 근사
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6;
}

/** `amount` 만큼 밝게(+)/어둡게(-). -1~1. */
export function cmsShade(hex: string, amount: number): string {
  const { r, g, b } = cmsHexToRgb(hex);
  const mix = (c: number) => {
    const target = amount >= 0 ? 255 : 0;
    const t = Math.abs(amount);
    return Math.round(c + (target - c) * t);
  };
  const to2 = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${to2(mix(r))}${to2(mix(g))}${to2(mix(b))}`;
}

export function cmsHexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
