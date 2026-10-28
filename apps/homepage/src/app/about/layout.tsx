import type { Metadata } from 'next';
export const metadata: Metadata = { title: '병원 소개', description: '위루비병원 인사말, 연혁, 조직도, 시설 안내' };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
