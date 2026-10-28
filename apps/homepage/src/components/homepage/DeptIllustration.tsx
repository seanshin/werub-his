/**
 * 진료과별 의료 일러스트 — 세련된 라인아트 스타일
 */

interface Props {
  slug: string;
  size?: number;
  className?: string;
}

const DEPT: Record<string, { bg: string; icon: string }> = {
  'internal-medicine': {
    bg: 'from-slate-500/80 to-slate-700/80',
    icon: `<!-- 심장 + ECG -->
      <path d="M37 22 C37 16 30 12 26 18 C22 12 15 16 15 22 C15 34 37 44 37 44 C37 44 59 34 59 22 C59 16 52 12 48 18 C44 12 37 16 37 22Z" stroke="white" stroke-width="2.5" fill="white" fill-opacity="0.15"/>
      <path d="M8 52 L20 52 L24 42 L30 60 L35 38 L40 56 L44 48 L48 52 L66 52" stroke="white" stroke-width="2" fill="none" opacity="0.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  surgery: {
    bg: 'from-stone-500/80 to-stone-700/80',
    icon: `<!-- 메스 -->
      <path d="M22 50 L42 18" stroke="white" stroke-width="3" stroke-linecap="round" opacity="0.8"/>
      <path d="M42 18 L48 12 C50 10 54 12 52 14 L46 20 Z" fill="white" opacity="0.7"/>
      <path d="M20 52 C18 54 20 56 22 54" stroke="white" stroke-width="2" fill="white" fill-opacity="0.3"/>
      <!-- 가위 -->
      <circle cx="54" cy="42" r="7" stroke="white" stroke-width="1.5" fill="none" opacity="0.3"/>
      <circle cx="54" cy="56" r="7" stroke="white" stroke-width="1.5" fill="none" opacity="0.3"/>
      <path d="M48 45 L60 53 M48 53 L60 45" stroke="white" stroke-width="1.5" opacity="0.3"/>`,
  },
  orthopedics: {
    bg: 'from-blue-400/80 to-blue-600/80',
    icon: `<!-- 뼈 -->
      <ellipse cx="29" cy="18" rx="8" ry="6" fill="white" opacity="0.5"/>
      <ellipse cx="29" cy="50" rx="8" ry="6" fill="white" opacity="0.5"/>
      <rect x="25" y="22" width="8" height="24" rx="4" fill="white" opacity="0.5"/>
      <!-- 관절 -->
      <circle cx="50" cy="34" r="12" stroke="white" stroke-width="2" fill="none" opacity="0.4"/>
      <circle cx="50" cy="34" r="5" fill="white" opacity="0.3"/>
      <path d="M42 22 L50 28 M50 40 L42 46 M58 22 L50 28 M50 40 L58 46" stroke="white" stroke-width="1.5" opacity="0.3" stroke-linecap="round"/>`,
  },
  pediatrics: {
    bg: 'from-sky-400/80 to-sky-600/80',
    icon: `<!-- 아기 얼굴 -->
      <circle cx="37" cy="30" r="18" fill="white" opacity="0.2" stroke="white" stroke-width="2" />
      <circle cx="31" cy="28" r="2.5" fill="white" opacity="0.7"/>
      <circle cx="43" cy="28" r="2.5" fill="white" opacity="0.7"/>
      <path d="M33 36 Q37 40 41 36" stroke="white" stroke-width="2" fill="none" opacity="0.6" stroke-linecap="round"/>
      <!-- 별 -->
      <path d="M56 14 L58 18 L62 18 L59 21 L60 25 L56 22 L52 25 L53 21 L50 18 L54 18Z" fill="white" opacity="0.35"/>
      <circle cx="16" cy="50" r="3" fill="white" opacity="0.2"/>`,
  },
  obgyn: {
    bg: 'from-rose-400/80 to-rose-600/80',
    icon: `<!-- 임산부 실루엣 -->
      <circle cx="37" cy="16" r="7" fill="white" opacity="0.5"/>
      <path d="M30 25 Q28 38 32 50 L42 50 Q46 38 44 25 Z" fill="white" opacity="0.3"/>
      <ellipse cx="37" cy="40" rx="8" ry="7" fill="white" opacity="0.15"/>
      <!-- 하트 -->
      <path d="M55 20 C55 17 52 15 50 18 C48 15 45 17 45 20 C45 25 50 28 50 28 C50 28 55 25 55 20Z" fill="white" opacity="0.4"/>`,
  },
  'emergency-medicine': {
    bg: 'from-red-400/80 to-red-600/80',
    icon: `<!-- 응급 십자 -->
      <rect x="29" y="14" width="16" height="40" rx="4" fill="white" opacity="0.5"/>
      <rect x="17" y="26" width="40" height="16" rx="4" fill="white" opacity="0.5"/>
      <!-- 번개 -->
      <path d="M56 12 L50 28 L56 28 L48 46" stroke="white" stroke-width="2.5" fill="none" opacity="0.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  ophthalmology: {
    bg: 'from-teal-400/80 to-teal-600/80',
    icon: `<!-- 눈 -->
      <path d="M12 34 Q37 10 62 34 Q37 58 12 34Z" stroke="white" stroke-width="2.5" fill="white" fill-opacity="0.1"/>
      <circle cx="37" cy="34" r="10" stroke="white" stroke-width="2" fill="white" fill-opacity="0.2"/>
      <circle cx="37" cy="34" r="4" fill="white" opacity="0.6"/>
      <circle cx="35" cy="32" r="1.5" fill="white" opacity="0.9"/>`,
  },
  ent: {
    bg: 'from-emerald-400/80 to-emerald-600/80',
    icon: `<!-- 귀 -->
      <path d="M30 18 C18 18 14 30 18 40 C20 46 26 50 30 48 C32 47 32 44 30 42 C26 38 24 34 26 28 C28 22 34 20 36 24" stroke="white" stroke-width="2.5" fill="none" opacity="0.6" stroke-linecap="round"/>
      <!-- 음파 -->
      <path d="M46 26 C50 30 50 38 46 42" stroke="white" stroke-width="2" fill="none" opacity="0.35" stroke-linecap="round"/>
      <path d="M52 22 C58 28 58 40 52 46" stroke="white" stroke-width="2" fill="none" opacity="0.25" stroke-linecap="round"/>
      <path d="M58 18 C66 26 66 42 58 50" stroke="white" stroke-width="2" fill="none" opacity="0.15" stroke-linecap="round"/>`,
  },
  dermatology: {
    bg: 'from-violet-400/80 to-violet-600/80',
    icon: `<!-- 피부 단면 -->
      <path d="M14 36 Q24 28 37 36 Q50 44 60 36" stroke="white" stroke-width="2" fill="none" opacity="0.5"/>
      <path d="M14 44 Q24 36 37 44 Q50 52 60 44" stroke="white" stroke-width="2" fill="none" opacity="0.35"/>
      <path d="M14 52 Q24 44 37 52 Q50 60 60 52" stroke="white" stroke-width="1.5" fill="none" opacity="0.2"/>
      <!-- 돋보기 -->
      <circle cx="28" cy="22" r="8" stroke="white" stroke-width="2" fill="white" fill-opacity="0.15"/>
      <path d="M34 28 L40 34" stroke="white" stroke-width="2.5" stroke-linecap="round" opacity="0.5"/>`,
  },
  psychiatry: {
    bg: 'from-indigo-400/80 to-indigo-600/80',
    icon: `<!-- 뇌 -->
      <path d="M37 14 C28 14 22 20 22 28 C22 36 26 40 30 42 L30 52" stroke="white" stroke-width="2" fill="none" opacity="0.5" stroke-linecap="round"/>
      <path d="M37 14 C46 14 52 20 52 28 C52 36 48 40 44 42 L44 52" stroke="white" stroke-width="2" fill="none" opacity="0.5" stroke-linecap="round"/>
      <path d="M37 14 L37 52" stroke="white" stroke-width="1.5" opacity="0.3"/>
      <path d="M26 24 Q31 28 26 32" stroke="white" stroke-width="1.5" fill="none" opacity="0.35"/>
      <path d="M48 24 Q43 28 48 32" stroke="white" stroke-width="1.5" fill="none" opacity="0.35"/>
      <!-- 연결 -->
      <circle cx="30" cy="52" r="3" fill="white" opacity="0.3"/>
      <circle cx="44" cy="52" r="3" fill="white" opacity="0.3"/>`,
  },
  rehabilitation: {
    bg: 'from-green-400/80 to-green-600/80',
    icon: `<!-- 달리는 사람 -->
      <circle cx="37" cy="14" r="6" fill="white" opacity="0.5"/>
      <path d="M37 20 L37 36" stroke="white" stroke-width="2.5" stroke-linecap="round" opacity="0.5"/>
      <path d="M28 26 L37 30 L46 24" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.5"/>
      <path d="M37 36 L28 50" stroke="white" stroke-width="2.5" stroke-linecap="round" opacity="0.5"/>
      <path d="M37 36 L48 48" stroke="white" stroke-width="2.5" stroke-linecap="round" opacity="0.5"/>
      <!-- 화살표 위 -->
      <path d="M56 40 L56 16 L50 22 M56 16 L62 22" stroke="white" stroke-width="2" fill="none" opacity="0.35" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  radiology: {
    bg: 'from-sky-400/80 to-sky-600/80',
    icon: `<!-- X-ray 필름 -->
      <rect x="18" y="10" width="38" height="48" rx="4" stroke="white" stroke-width="2" fill="white" fill-opacity="0.1"/>
      <rect x="22" y="14" width="30" height="6" rx="2" fill="white" opacity="0.2"/>
      <!-- 갈비뼈 -->
      <path d="M26 28 Q37 24 48 28" stroke="white" stroke-width="1.5" fill="none" opacity="0.4"/>
      <path d="M26 34 Q37 30 48 34" stroke="white" stroke-width="1.5" fill="none" opacity="0.35"/>
      <path d="M26 40 Q37 36 48 40" stroke="white" stroke-width="1.5" fill="none" opacity="0.3"/>
      <!-- 척추 -->
      <rect x="35" y="24" width="4" height="24" rx="2" fill="white" opacity="0.25"/>`,
  },
  dental: {
    bg: 'from-blue-400/80 to-blue-600/80',
    icon: `<!-- 치아 -->
      <path d="M28 16 Q28 8 34 10 Q37 6 40 10 Q46 8 46 16 Q48 26 42 38 Q40 42 37 42 Q34 42 32 38 Q26 26 28 16Z" fill="white" opacity="0.45" stroke="white" stroke-width="2"/>
      <!-- 반짝임 -->
      <path d="M54 18 L56 14 L58 18 L62 20 L58 22 L56 26 L54 22 L50 20Z" fill="white" opacity="0.3"/>
      <circle cx="18" cy="44" r="2" fill="white" opacity="0.2"/>`,
  },
  urology: {
    bg: 'from-amber-400/80 to-amber-600/80',
    icon: `<!-- 신장 -->
      <path d="M32 14 C44 14 48 22 48 34 C48 46 44 54 32 54 C26 54 22 48 26 42 C30 36 30 32 26 26 C22 20 26 14 32 14Z" fill="white" opacity="0.4" stroke="white" stroke-width="2"/>
      <!-- 두 번째 신장 -->
      <path d="M52 24 C58 24 60 28 60 34 C60 40 58 44 52 44 C49 44 47 42 49 38 C51 34 51 32 49 30 C47 28 49 24 52 24Z" fill="white" opacity="0.2" stroke="white" stroke-width="1.5"/>`,
  },
  neurosurgery: {
    bg: 'from-purple-400/80 to-purple-600/80',
    icon: `<!-- 뇌 + 수술 -->
      <circle cx="34" cy="30" r="16" stroke="white" stroke-width="2" fill="white" fill-opacity="0.15"/>
      <path d="M24 24 Q30 30 24 36" stroke="white" stroke-width="1.5" fill="none" opacity="0.4"/>
      <path d="M30 20 Q36 26 30 32" stroke="white" stroke-width="1.5" fill="none" opacity="0.35"/>
      <path d="M38 18 Q42 24 38 30 Q42 36 38 42" stroke="white" stroke-width="1.5" fill="none" opacity="0.3"/>
      <!-- 수술 도구 -->
      <path d="M52 16 L56 48" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.4"/>
      <circle cx="52" cy="14" r="3" fill="white" opacity="0.35"/>`,
  },
  'family-medicine': {
    bg: 'from-teal-500 to-emerald-600',
    icon: `<!-- 가족 -->
      <circle cx="24" cy="20" r="7" fill="white" opacity="0.4"/>
      <path d="M16 36 Q24 30 32 36 L32 52 L16 52Z" fill="white" opacity="0.25"/>
      <circle cx="50" cy="22" r="6" fill="white" opacity="0.35"/>
      <path d="M43 36 Q50 31 57 36 L57 52 L43 52Z" fill="white" opacity="0.2"/>
      <circle cx="37" cy="26" r="5" fill="white" opacity="0.3"/>
      <path d="M31 38 Q37 34 43 38 L43 52 L31 52Z" fill="white" opacity="0.15"/>`,
  },
  anesthesiology: {
    bg: 'from-gray-400/80 to-gray-600/80',
    icon: `<!-- 마취 마스크 -->
      <path d="M24 24 Q24 14 37 14 Q50 14 50 24 L50 36 Q50 44 37 44 Q24 44 24 36Z" stroke="white" stroke-width="2" fill="white" fill-opacity="0.15"/>
      <ellipse cx="37" cy="34" rx="10" ry="6" stroke="white" stroke-width="1.5" fill="none" opacity="0.3"/>
      <!-- 호스 -->
      <path d="M37 44 L37 56 Q37 60 42 60 L56 60" stroke="white" stroke-width="2" fill="none" opacity="0.4" stroke-linecap="round"/>`,
  },
  'plastic-surgery': {
    bg: 'from-violet-400/80 to-violet-600/80',
    icon: `<!-- 얼굴 윤곽 -->
      <path d="M37 12 C48 12 54 22 54 32 C54 44 48 54 37 54 C26 54 20 44 20 32 C20 22 26 12 37 12Z" stroke="white" stroke-width="2" fill="none" opacity="0.4"/>
      <path d="M30 30 L32 32 M42 30 L44 32" stroke="white" stroke-width="2" opacity="0.5" stroke-linecap="round"/>
      <path d="M32 40 Q37 44 42 40" stroke="white" stroke-width="1.5" fill="none" opacity="0.4" stroke-linecap="round"/>
      <!-- 반짝 -->
      <path d="M56 16 L58 12 L60 16 L64 18 L60 20 L58 24 L56 20 L52 18Z" fill="white" opacity="0.3"/>`,
  },
  'thoracic-surgery': {
    bg: 'from-rose-400/80 to-rose-600/80',
    icon: `<!-- 폐 -->
      <path d="M37 16 L37 52" stroke="white" stroke-width="2" opacity="0.3"/>
      <path d="M37 20 C32 20 18 24 18 38 C18 48 26 52 32 52 L37 52" fill="white" opacity="0.3" stroke="white" stroke-width="2"/>
      <path d="M37 20 C42 20 56 24 56 38 C56 48 48 52 42 52 L37 52" fill="white" opacity="0.3" stroke="white" stroke-width="2"/>
      <!-- 기관지 -->
      <path d="M37 20 L30 30 M37 24 L44 34" stroke="white" stroke-width="1.5" opacity="0.25"/>`,
  },
  pathology: {
    bg: 'from-indigo-400/80 to-indigo-600/80',
    icon: `<!-- 현미경 -->
      <circle cx="32" cy="22" r="10" stroke="white" stroke-width="2" fill="white" fill-opacity="0.15"/>
      <circle cx="32" cy="22" r="4" fill="white" opacity="0.3"/>
      <path d="M32 32 L32 46 L24 54 M32 46 L40 54" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.4"/>
      <!-- 세포 -->
      <circle cx="54" cy="18" r="5" stroke="white" stroke-width="1.5" fill="none" opacity="0.3"/>
      <circle cx="54" cy="18" r="2" fill="white" opacity="0.25"/>
      <circle cx="56" cy="34" r="3" stroke="white" stroke-width="1" fill="none" opacity="0.2"/>`,
  },
  'laboratory-medicine': {
    bg: 'from-blue-500 to-cyan-600',
    icon: `<!-- 시험관 -->
      <rect x="28" y="10" width="12" height="30" rx="2" stroke="white" stroke-width="2" fill="none" opacity="0.4"/>
      <rect x="28" y="28" width="12" height="12" rx="2" fill="white" opacity="0.25"/>
      <path d="M26 10 L42 10" stroke="white" stroke-width="2" opacity="0.4" stroke-linecap="round"/>
      <!-- 플라스크 -->
      <path d="M50 14 L50 30 L42 48 L58 48 L50 30" stroke="white" stroke-width="2" fill="white" fill-opacity="0.1"/>
      <rect x="44" y="38" width="12" height="10" rx="1" fill="white" opacity="0.2"/>`,
  },
  'radiation-oncology': {
    bg: 'from-amber-500 to-red-600',
    icon: `<!-- 방사선 타겟 -->
      <circle cx="37" cy="34" r="16" stroke="white" stroke-width="2" fill="none" opacity="0.3"/>
      <circle cx="37" cy="34" r="8" stroke="white" stroke-width="2" fill="none" opacity="0.35"/>
      <circle cx="37" cy="34" r="2" fill="white" opacity="0.5"/>
      <!-- 십자선 -->
      <path d="M37 14 L37 54 M17 34 L57 34" stroke="white" stroke-width="1.5" opacity="0.25"/>
      <!-- 방사선 -->
      <path d="M20 17 L28 25 M54 17 L46 25 M20 51 L28 43 M54 51 L46 43" stroke="white" stroke-width="1.5" opacity="0.2" stroke-linecap="round"/>`,
  },
};

const DEFAULT_DEPT = {
  bg: 'from-gray-500 to-slate-600',
  icon: `<rect x="29" y="20" width="16" height="28" rx="4" fill="white" opacity="0.4"/><rect x="21" y="28" width="32" height="12" rx="4" fill="white" opacity="0.4"/>`,
};

export function DeptIllustration({ slug, size = 48, className = '' }: Props) {
  const data = DEPT[slug] ?? DEFAULT_DEPT;

  return (
    <div
      className={`inline-flex items-center justify-center bg-gradient-to-br ${data.bg} ${className}`}
      style={{ width: '100%', height: '100%' }}
      role="img"
      aria-hidden="true"
    >
      <svg viewBox="0 0 74 68" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        {/* 미묘한 배경 원 */}
        <circle cx="58" cy="12" r="20" fill="white" opacity="0.05"/>
        <circle cx="10" cy="56" r="16" fill="white" opacity="0.04"/>
        <g dangerouslySetInnerHTML={{ __html: data.icon }} />
      </svg>
    </div>
  );
}
