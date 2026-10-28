/**
 * 전문센터별 의료 일러스트 (인라인 SVG)
 */

interface Props {
  slug: string;
  className?: string;
}

const ILLUSTRATIONS: Record<string, { bg: string; svg: string; label: string }> = {
  'cardiovascular-center': {
    bg: 'from-rose-600 via-red-500 to-pink-500',
    label: '심혈관센터',
    svg: `<!-- 심장 -->
      <circle cx="150" cy="90" r="50" fill="white" opacity="0.08"/>
      <g transform="translate(115, 55)" opacity="0.9">
        <path d="M35 15 C35 5, 50 0, 55 10 C60 0, 75 5, 75 15 C75 35, 55 50, 55 55 C55 50, 35 35, 35 15Z" fill="white" opacity="0.25"/>
        <path d="M45 30 L55 22 L65 35" stroke="white" stroke-width="2.5" fill="none" opacity="0.5" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
      <!-- ECG 라인 -->
      <path d="M20 100 L60 100 L70 80 L80 120 L90 70 L100 110 L110 90 L120 100 L280 100" stroke="white" stroke-width="2" fill="none" opacity="0.2" stroke-linecap="round" stroke-linejoin="round"/>
      <!-- 원형 장식 -->
      <circle cx="250" cy="40" r="20" stroke="white" stroke-width="1" fill="none" opacity="0.1"/>
      <circle cx="250" cy="40" r="12" stroke="white" stroke-width="1" fill="none" opacity="0.1"/>`,
  },
  'cancer-center': {
    bg: 'from-violet-600 via-purple-600 to-indigo-600',
    label: '암센터',
    svg: `<!-- 현미경/세포 -->
      <circle cx="150" cy="75" r="40" stroke="white" stroke-width="1.5" fill="none" opacity="0.15"/>
      <circle cx="150" cy="75" r="25" stroke="white" stroke-width="1" fill="none" opacity="0.12"/>
      <circle cx="140" cy="68" r="8" fill="white" opacity="0.1"/>
      <circle cx="160" cy="80" r="6" fill="white" opacity="0.1"/>
      <circle cx="148" cy="85" r="4" fill="white" opacity="0.08"/>
      <!-- DNA 나선 -->
      <g transform="translate(240, 20)" opacity="0.2">
        <path d="M0 0 C15 10, -5 20, 10 30 C25 40, 5 50, 20 60 C35 70, 15 80, 30 90" stroke="white" stroke-width="2" fill="none"/>
        <path d="M20 0 C5 10, 25 20, 10 30 C-5 40, 15 50, 0 60 C-15 70, 5 80, -10 90" stroke="white" stroke-width="2" fill="none"/>
        <line x1="5" y1="15" x2="15" y2="15" stroke="white" stroke-width="1.5"/>
        <line x1="8" y1="45" x2="12" y2="45" stroke="white" stroke-width="1.5"/>
        <line x1="15" y1="75" x2="20" y2="75" stroke="white" stroke-width="1.5"/>
      </g>
      <!-- 리본 -->
      <g transform="translate(50, 50)" opacity="0.2">
        <path d="M15 0 C15 15, 0 20, 15 35 C30 20, 15 15, 15 0Z" fill="white"/>
        <path d="M15 35 C15 50, 30 55, 15 70 C0 55, 15 50, 15 35Z" fill="white"/>
      </g>`,
  },
  'joint-spine-center': {
    bg: 'from-emerald-600 via-teal-500 to-cyan-500',
    label: '관절·척추센터',
    svg: `<!-- 관절/뼈 -->
      <g transform="translate(120, 30)" opacity="0.2">
        <rect x="15" y="0" width="16" height="80" rx="8" fill="white"/>
        <circle cx="23" cy="0" r="14" fill="white"/>
        <circle cx="23" cy="80" r="14" fill="white"/>
        <!-- 디스크 -->
        <ellipse cx="23" cy="35" rx="20" ry="5" fill="white" opacity="0.5"/>
        <ellipse cx="23" cy="50" rx="20" ry="5" fill="white" opacity="0.5"/>
      </g>
      <!-- 원형 관절 -->
      <circle cx="240" cy="60" r="25" stroke="white" stroke-width="1.5" fill="none" opacity="0.15"/>
      <circle cx="240" cy="60" r="15" stroke="white" stroke-width="1" fill="white" opacity="0.06"/>
      <circle cx="240" cy="60" r="5" fill="white" opacity="0.15"/>
      <!-- 파동 -->
      <path d="M30 105 Q80 85, 130 105 Q180 125, 230 105 Q260 95, 280 105" stroke="white" stroke-width="1.5" fill="none" opacity="0.12"/>`,
  },
  'checkup-center': {
    bg: 'from-blue-600 via-blue-500 to-sky-500',
    label: '건강검진센터',
    svg: `<!-- 체크리스트 -->
      <g transform="translate(110, 25)" opacity="0.2">
        <rect x="0" y="0" width="55" height="75" rx="6" fill="white"/>
        <rect x="8" y="8" width="38" height="4" rx="2" fill="currentColor" opacity="0.3"/>
        <line x1="10" y1="22" x2="15" y2="27" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="15" y1="27" x2="25" y2="17" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        <rect x="30" y="20" width="16" height="3" rx="1.5" fill="currentColor" opacity="0.2"/>
        <line x1="10" y1="38" x2="15" y2="43" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="15" y1="43" x2="25" y2="33" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        <rect x="30" y="36" width="16" height="3" rx="1.5" fill="currentColor" opacity="0.2"/>
        <rect x="8" y="52" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.3"/>
        <rect x="30" y="54" width="16" height="3" rx="1.5" fill="currentColor" opacity="0.2"/>
      </g>
      <!-- 청진기 -->
      <g transform="translate(220, 40)" opacity="0.15">
        <path d="M0 0 C0 30, 20 40, 20 50" stroke="white" stroke-width="3" fill="none"/>
        <circle cx="20" cy="55" r="10" stroke="white" stroke-width="2" fill="white" fill-opacity="0.3"/>
      </g>
      <!-- 하트비트 -->
      <path d="M20 95 L70 95 L80 80 L90 110 L100 75 L110 105 L120 95 L280 95" stroke="white" stroke-width="1.5" fill="none" opacity="0.12"/>`,
  },
  'dialysis-center': {
    bg: 'from-teal-600 via-cyan-600 to-blue-500',
    label: '인공신장센터',
    svg: `<!-- 신장 -->
      <g transform="translate(120, 35)" opacity="0.2">
        <path d="M25 0 C45 0, 50 15, 50 35 C50 55, 45 70, 25 70 C15 70, 10 60, 15 50 C20 40, 20 30, 15 20 C10 10, 15 0, 25 0Z" fill="white"/>
      </g>
      <!-- 물방울 -->
      <g transform="translate(230, 30)" opacity="0.15">
        <path d="M12 0 C12 0, 0 18, 0 24 C0 32, 5 36, 12 36 C19 36, 24 32, 24 24 C24 18, 12 0, 12 0Z" fill="white"/>
      </g>
      <g transform="translate(250, 60)" opacity="0.1">
        <path d="M8 0 C8 0, 0 12, 0 16 C0 22, 4 24, 8 24 C12 24, 16 22, 16 16 C16 12, 8 0, 8 0Z" fill="white"/>
      </g>
      <!-- 순환 화살표 -->
      <circle cx="80" cy="70" r="25" stroke="white" stroke-width="1.5" fill="none" opacity="0.12" stroke-dasharray="8 4"/>`,
  },
  // ── WERUBYHOSP 특성화센터 ──
  'cell-therapy': {
    bg: 'from-emerald-600 via-teal-600 to-cyan-500',
    label: '세포치료',
    svg: `<circle cx="150" cy="60" r="28" stroke="white" stroke-width="1.5" fill="none" opacity="0.2"/>
      <circle cx="150" cy="60" r="15" stroke="white" stroke-width="1" fill="white" fill-opacity="0.1" opacity="0.25"/>
      <circle cx="80" cy="45" r="12" fill="white" fill-opacity="0.1"/><circle cx="220" cy="75" r="10" fill="white" fill-opacity="0.08"/>
      <path d="M130 60 Q150 30 170 60 Q150 90 130 60Z" stroke="white" stroke-width="1" fill="none" opacity="0.15"/>`,
  },
  'genomic-analysis': {
    bg: 'from-indigo-600 via-violet-600 to-purple-500',
    label: '유전자분석',
    svg: `<path d="M120 20 Q150 50 120 80 Q150 110 120 140" stroke="white" stroke-width="2" fill="none" opacity="0.2"/>
      <path d="M180 20 Q150 50 180 80 Q150 110 180 140" stroke="white" stroke-width="2" fill="none" opacity="0.2"/>
      <line x1="130" y1="35" x2="170" y2="35" stroke="white" stroke-width="1" opacity="0.15"/>
      <line x1="130" y1="65" x2="170" y2="65" stroke="white" stroke-width="1" opacity="0.15"/>
      <line x1="130" y1="95" x2="170" y2="95" stroke="white" stroke-width="1" opacity="0.15"/>`,
  },
  'clinical-lab-center': {
    bg: 'from-sky-600 via-blue-600 to-indigo-500',
    label: '진단검사',
    svg: `<rect x="120" y="30" width="60" height="80" rx="4" stroke="white" stroke-width="1.5" fill="none" opacity="0.2"/>
      <line x1="130" y1="50" x2="170" y2="50" stroke="white" stroke-width="1" opacity="0.15"/>
      <line x1="130" y1="65" x2="160" y2="65" stroke="white" stroke-width="1" opacity="0.12"/>
      <circle cx="80" cy="70" r="15" stroke="white" stroke-width="1.5" fill="none" opacity="0.15"/>
      <path d="M75 70 L80 75 L88 65" stroke="white" stroke-width="1.5" fill="none" opacity="0.2"/>`,
  },
  'radiology-center': {
    bg: 'from-slate-600 via-gray-600 to-zinc-500',
    label: '영상의학',
    svg: `<rect x="100" y="25" width="100" height="90" rx="8" stroke="white" stroke-width="1.5" fill="none" opacity="0.2"/>
      <circle cx="150" cy="65" r="20" stroke="white" stroke-width="1" fill="none" opacity="0.15"/>
      <path d="M165 80 L185 100" stroke="white" stroke-width="2" opacity="0.2" stroke-linecap="round"/>`,
  },
  'endoscopy': {
    bg: 'from-rose-600 via-pink-600 to-fuchsia-500',
    label: '내시경',
    svg: `<circle cx="150" cy="55" r="25" stroke="white" stroke-width="1.5" fill="none" opacity="0.2"/>
      <path d="M150 80 Q150 110 130 130" stroke="white" stroke-width="2" fill="none" opacity="0.15"/>
      <circle cx="150" cy="55" r="8" fill="white" fill-opacity="0.1"/>`,
  },
  'diabetes-endocrine': {
    bg: 'from-amber-600 via-orange-600 to-red-500',
    label: '당뇨/내분비',
    svg: `<path d="M130 30 L150 70 L170 30" stroke="white" stroke-width="2" fill="none" opacity="0.2"/>
      <path d="M110 70 L190 70" stroke="white" stroke-width="1" opacity="0.15"/>
      <circle cx="150" cy="95" r="15" stroke="white" stroke-width="1.5" fill="none" opacity="0.15"/>
      <path d="M145 95 h10 M150 90 v10" stroke="white" stroke-width="1.5" opacity="0.2"/>`,
  },
  'neuroscience': {
    bg: 'from-purple-600 via-fuchsia-600 to-pink-500',
    label: '뇌과학',
    svg: `<circle cx="150" cy="55" r="30" stroke="white" stroke-width="1.5" fill="none" opacity="0.2"/>
      <path d="M125 55 Q135 35 150 35 Q165 35 175 55" stroke="white" stroke-width="1" fill="none" opacity="0.15"/>
      <path d="M130 65 Q145 75 150 55 Q155 75 170 65" stroke="white" stroke-width="1" fill="none" opacity="0.12"/>
      <circle cx="150" cy="100" r="5" fill="white" fill-opacity="0.15"/>
      <line x1="150" y1="85" x2="150" y2="95" stroke="white" stroke-width="1" opacity="0.15"/>`,
  },
  'anti-aging': {
    bg: 'from-lime-600 via-emerald-600 to-teal-500',
    label: '항노화',
    svg: `<path d="M150 30 L150 100" stroke="white" stroke-width="1.5" fill="none" opacity="0.15"/>
      <path d="M135 50 Q150 30 165 50" stroke="white" stroke-width="1.5" fill="none" opacity="0.2"/>
      <path d="M130 70 Q150 50 170 70" stroke="white" stroke-width="1.5" fill="none" opacity="0.2"/>
      <path d="M125 90 Q150 70 175 90" stroke="white" stroke-width="1.5" fill="none" opacity="0.2"/>
      <circle cx="150" cy="110" r="8" stroke="white" stroke-width="1" fill="none" opacity="0.12"/>`,
  },
  'health-promotion': {
    bg: 'from-blue-600 via-cyan-600 to-teal-500',
    label: '건강검진(증진)',
    svg: `<rect x="110" y="30" width="80" height="80" rx="6" stroke="white" stroke-width="1.5" fill="none" opacity="0.2"/>
      <path d="M130 55 L145 70 L175 45" stroke="white" stroke-width="2.5" fill="none" opacity="0.25" stroke-linecap="round"/>
      <line x1="130" y1="85" x2="170" y2="85" stroke="white" stroke-width="1" opacity="0.12"/>
      <line x1="130" y1="95" x2="160" y2="95" stroke="white" stroke-width="1" opacity="0.1"/>`,
  },
  'international-care': {
    bg: 'from-sky-600 via-blue-500 to-indigo-500',
    label: '국제진료',
    svg: `<circle cx="150" cy="60" r="30" stroke="white" stroke-width="1.5" fill="none" opacity="0.2"/>
      <ellipse cx="150" cy="60" rx="30" ry="12" stroke="white" stroke-width="1" fill="none" opacity="0.12"/>
      <ellipse cx="150" cy="60" rx="12" ry="30" stroke="white" stroke-width="1" fill="none" opacity="0.12"/>
      <path d="M120 60 h60" stroke="white" stroke-width="0.5" opacity="0.1"/>`,
  },
};

const DEFAULT = {
  bg: 'from-gray-600 via-gray-500 to-slate-500',
  label: '',
  svg: `<circle cx="150" cy="70" r="30" stroke="white" stroke-width="1.5" fill="none" opacity="0.15"/>
    <path d="M150 55 v30 M135 70 h30" stroke="white" stroke-width="2" opacity="0.2" stroke-linecap="round"/>`,
};

export function CenterIllustration({ slug, className = '' }: Props) {
  const ill = ILLUSTRATIONS[slug] ?? DEFAULT;

  return (
    <div className={`relative w-full h-full bg-gradient-to-br ${ill.bg} overflow-hidden ${className}`}>
      <svg
        viewBox="0 0 300 130"
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        {/* 배경 원형 장식 */}
        <circle cx="280" cy="20" r="60" fill="white" opacity="0.04"/>
        <circle cx="30" cy="110" r="40" fill="white" opacity="0.04"/>
        <g dangerouslySetInnerHTML={{ __html: ill.svg }} />
      </svg>
    </div>
  );
}
