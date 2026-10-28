/**
 * 의료진 일러스트 아바타 (인라인 SVG — 외부 의존 없음)
 * 이름 해시 기반으로 고유한 색상/스타일 생성
 */

interface Props {
  name: string;
  size?: number;
  className?: string;
}

// 이름 → 고유 숫자 해시
function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

const BG_COLORS = [
  ['#dbeafe', '#bfdbfe'], // blue
  ['#d1fae5', '#a7f3d0'], // emerald
  ['#ede9fe', '#ddd6fe'], // violet
  ['#fce7f3', '#fbcfe8'], // pink
  ['#fef3c7', '#fde68a'], // amber
  ['#ccfbf1', '#99f6e4'], // teal
  ['#e0e7ff', '#c7d2fe'], // indigo
  ['#ffe4e6', '#fecdd3'], // rose
];

const SKIN = ['#fde2b8', '#f5d0a9', '#e8c39e', '#d4a574', '#c49066'];
const HAIR = ['#1a1a2e', '#2d1b1b', '#4a2511', '#6b3a2a', '#8b6914', '#3d2914'];
const SHIRT = ['#3b82f6', '#10b981', '#6366f1', '#ec4899', '#f59e0b', '#06b6d4', '#8b5cf6', '#ef4444'];

const HAIR_STYLES = [
  // short
  (x: number, y: number, c: string) => `<ellipse cx="${x}" cy="${y - 4}" rx="22" ry="20" fill="${c}"/>`,
  // medium
  (x: number, y: number, c: string) => `<ellipse cx="${x}" cy="${y - 2}" rx="24" ry="22" fill="${c}"/><ellipse cx="${x - 16}" cy="${y + 12}" rx="8" ry="14" fill="${c}"/><ellipse cx="${x + 16}" cy="${y + 12}" rx="8" ry="14" fill="${c}"/>`,
  // long
  (x: number, y: number, c: string) => `<ellipse cx="${x}" cy="${y - 2}" rx="24" ry="22" fill="${c}"/><rect x="${x - 22}" y="${y}" width="44" height="24" rx="10" fill="${c}"/>`,
  // bun
  (x: number, y: number, c: string) => `<ellipse cx="${x}" cy="${y - 4}" rx="22" ry="20" fill="${c}"/><circle cx="${x}" cy="${y - 24}" r="10" fill="${c}"/>`,
];

export function DoctorAvatar({ name, size = 80, className = '' }: Props) {
  const h = hashName(name);
  const bg = BG_COLORS[h % BG_COLORS.length];
  const skin = SKIN[h % SKIN.length];
  const hair = HAIR[(h >> 3) % HAIR.length];
  const shirt = SHIRT[(h >> 5) % SHIRT.length];
  const hairStyle = HAIR_STYLES[(h >> 7) % HAIR_STYLES.length];
  const hasGlasses = h % 4 === 0;

  const cx = 50, cy = 42;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">
    <defs><linearGradient id="bg${h}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${bg[0]}"/><stop offset="100%" stop-color="${bg[1]}"/></linearGradient></defs>
    <rect width="100" height="100" rx="20" fill="url(#bg${h})"/>
    <g transform="translate(0,8)">
      <!-- 몸 (흰 가운) -->
      <ellipse cx="${cx}" cy="92" rx="32" ry="22" fill="white" stroke="#e5e7eb" stroke-width="1"/>
      <ellipse cx="${cx}" cy="92" rx="28" ry="18" fill="${shirt}" opacity="0.15"/>
      <rect x="${cx - 5}" y="72" width="10" height="8" rx="2" fill="${shirt}" opacity="0.9"/>
      <!-- 목 -->
      <rect x="${cx - 6}" y="56" width="12" height="16" rx="4" fill="${skin}"/>
      <!-- 머리 -->
      ${hairStyle(cx, cy, hair)}
      <ellipse cx="${cx}" cy="${cy + 4}" rx="20" ry="22" fill="${skin}"/>
      <!-- 귀 -->
      <ellipse cx="${cx - 20}" cy="${cy + 6}" rx="4" ry="6" fill="${skin}"/>
      <ellipse cx="${cx + 20}" cy="${cy + 6}" rx="4" ry="6" fill="${skin}"/>
      <!-- 앞머리 -->
      <ellipse cx="${cx}" cy="${cy - 8}" rx="20" ry="12" fill="${hair}"/>
      <!-- 눈 -->
      <ellipse cx="${cx - 7}" cy="${cy + 6}" rx="2.5" ry="3" fill="#1a1a2e"/>
      <ellipse cx="${cx + 7}" cy="${cy + 6}" rx="2.5" ry="3" fill="#1a1a2e"/>
      <circle cx="${cx - 6}" cy="${cy + 5}" r="1" fill="white"/>
      <circle cx="${cx + 8}" cy="${cy + 5}" r="1" fill="white"/>
      <!-- 입 -->
      <path d="M${cx - 4} ${cy + 14} Q${cx} ${cy + 18} ${cx + 4} ${cy + 14}" stroke="#d97706" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <!-- 볼 -->
      <circle cx="${cx - 12}" cy="${cy + 12}" r="4" fill="#fca5a5" opacity="0.3"/>
      <circle cx="${cx + 12}" cy="${cy + 12}" r="4" fill="#fca5a5" opacity="0.3"/>
      ${hasGlasses ? `<circle cx="${cx - 7}" cy="${cy + 6}" r="6" stroke="#374151" stroke-width="1.5" fill="none"/><circle cx="${cx + 7}" cy="${cy + 6}" r="6" stroke="#374151" stroke-width="1.5" fill="none"/><line x1="${cx - 1}" y1="${cy + 5}" x2="${cx + 1}" y2="${cy + 5}" stroke="#374151" stroke-width="1.5"/>` : ''}
    </g>
  </svg>`;

  return (
    <div
      className={`inline-block ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
      aria-label={`${name} 프로필`}
    />
  );
}
