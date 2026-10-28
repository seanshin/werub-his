import type { MetadataRoute } from 'next';

// PWA 설치(홈화면 아이콘·전체화면) — 간호사 타블렛/핸드헬드가 직원 기기에 별도 앱 없이 상주.
// 데이터 오프라인 캐시는 FR-08(범위 밖) — 앱셸/설치성만.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'WeRU.B HIS',
    short_name: 'WeRU.B',
    description: '위루비병원 정보시스템 — 간호 타블렛/핸드헬드 포함',
    start_url: '/tablet/nursing',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f9fafb',
    theme_color: '#4f46e5',
    // 아이콘 PNG(192/512·maskable)는 디자인 에셋 follow-up. iOS는 apple-touch-icon/홈추가로 설치 가능.
    icons: [],
  };
}
