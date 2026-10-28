import type { Metadata } from 'next';
export const metadata: Metadata = { title: '의료진 소개', description: '위루비병원 전문 의료진을 소개합니다' };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
