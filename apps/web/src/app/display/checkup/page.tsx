'use client';

import { CheckupBoard } from '../_boards/CheckupBoard';

/** 검진 대기 TV — 공개 경로(로그인 불필요·서버 마스킹). 스태프 셸 밖이라 PHI 배너가 함께 뜨지 않는다. */
export default function Page() {
  return <CheckupBoard />;
}
