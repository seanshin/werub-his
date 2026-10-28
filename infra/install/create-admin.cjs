'use strict';
/**
 * 설치 직후 관리자 1명 생성 — `infra/install/install.sh` 6단계(2026-09-13 상용 릴리즈 T2-5).
 *
 * 🔴 시드의 공용 비밀번호(`staff1234!`)를 쓰지 않는다 — 판매본 첫 계정의 비밀번호는 설치자가 정한다.
 *    비밀번호는 **환경변수로만** 받는다(명령행 인자는 프로세스 목록·셸 이력에 남는다).
 * 🔴 이미 사용자가 1명이라도 있으면 만들지 않는다 — 빈 DB 설치 전용이다(운영 DB 에 관리자를 몰래 추가하는 경로가 되지 않게).
 *
 * 사용: ADMIN_EMAIL=… ADMIN_PASSWORD=… ADMIN_FAMILY_NAME=… ADMIN_GIVEN_NAME=… node infra/install/create-admin.cjs
 * (apps/api 의 의존성 `@prisma/client`·`bcrypt` 를 쓴다 — apps/api 에서 실행하거나 NODE_PATH 로 잡는다)
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

function need(name) {
  const v = (process.env[name] || '').trim();
  if (!v) {
    console.error(`🔴 ${name} 가 비었습니다 — 관리자 계정을 만들지 않습니다.`);
    process.exit(2);
  }
  return v;
}

async function main() {
  const email = need('ADMIN_EMAIL');
  const password = need('ADMIN_PASSWORD');
  const familyName = need('ADMIN_FAMILY_NAME');
  const givenName = need('ADMIN_GIVEN_NAME');
  if (password.length < 12) {
    console.error('🔴 ADMIN_PASSWORD 는 12자 이상이어야 합니다(첫 관리자 — 원내 비밀번호 정책 설정 전의 최소선).');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.count();
    if (existing > 0) {
      console.error(`🔴 사용자 ${existing}명이 이미 있습니다 — 빈 DB 설치 전용 스크립트라 만들지 않습니다.`);
      process.exit(3);
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const u = await prisma.user.create({
      data: { email, passwordHash, familyName, givenName, role: 'ADMIN' },
      select: { id: true, email: true, role: true },
    });
    console.log(`관리자 생성: ${u.email} (${u.role}) — 첫 로그인 후 비밀번호 정책·MFA 를 설정하세요.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('🔴 관리자 생성 실패:', e && e.message ? e.message : e);
  process.exit(1);
});
