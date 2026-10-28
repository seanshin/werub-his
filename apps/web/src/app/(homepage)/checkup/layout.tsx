import type { Metadata } from 'next';
export const metadata: Metadata = { title: '건강검진', description: '종합건강검진, 국가검진, 기업단체검진 프로그램 안내' };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
