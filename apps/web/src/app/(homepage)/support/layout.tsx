import type { Metadata } from 'next';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';
export const metadata: Metadata = { title: '고객 참여', description: `FAQ, 고객의 소리, ${AI_ORIGIN_TEXT} 상담 안내` };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
