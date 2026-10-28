import type { Metadata } from 'next';
export const metadata: Metadata = { title: '병원 소식', description: '위루비병원 공지사항, 언론보도, 행사, 채용 안내' };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
