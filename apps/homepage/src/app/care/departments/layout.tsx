import type { Metadata } from 'next';
export const metadata: Metadata = { title: '진료과 소개', description: '위루비병원 22개 전문 진료과를 소개합니다' };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
