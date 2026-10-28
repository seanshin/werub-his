import type { Metadata } from 'next';
export const metadata: Metadata = { title: '입원·이용 안내', description: '입원, 면회, 주차, 편의시설 안내' };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
