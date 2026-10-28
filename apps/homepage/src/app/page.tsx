import { redirect } from 'next/navigation';

// 홈페이지 루트 → /home
export default function RootIndex() {
  redirect('/home');
}
