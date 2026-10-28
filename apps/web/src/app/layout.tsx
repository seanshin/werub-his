import type { Metadata } from 'next';
import { Providers } from '@/components/layout/Providers';
import { PrintGuard } from '@/components/print/PrintGuard';
import './globals.css';

export const metadata: Metadata = {
  title: '위루비병원',
  description: '한국형 Enterprise 병원 정보 시스템',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <Providers>{children}</Providers>
        {/* 인쇄 기본 차단 — 지정 인쇄(/print/*·sanctionedPrint)만 허용 */}
        <PrintGuard />
      </body>
    </html>
  );
}
