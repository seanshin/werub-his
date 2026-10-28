import type { Metadata } from 'next';
export const metadata: Metadata = { title: '건강정보', description: '질환별 건강 상식, 예방법, 생활 가이드' };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
