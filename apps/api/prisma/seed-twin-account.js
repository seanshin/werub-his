require('./seed-mode-guard').assertSeedAllowed(__filename, 'DEMO'); // 🔴 가상 병원 데모·기관 특정 데이터 — REAL 에서 중단(상용 릴리즈 T2-3)
// 디지털 트윈 연동용 읽기전용 서비스계정 생성 (멱등 upsert).
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const prisma = new PrismaClient();

const EMAIL = 'twin-svc@hospitalrun.example';

// 강한 임의 비밀번호(영대소문/숫자/기호, base64url 32바이트 + 기호)
function genPassword() {
  const raw = crypto.randomBytes(24).toString('base64').replace(/[+/=]/g, '');
  return `Tw!${raw}9z`; // 대/소/숫자/기호 보장
}

async function main() {
  const password = genPassword();
  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, role: 'READ', isActive: true, passwordChangedAt: now },
    create: {
      email: EMAIL,
      passwordHash,
      role: 'READ',
      familyName: '서비스',
      givenName: '디지털트윈',
      isActive: true,
      passwordChangedAt: now, // 최초 로그인 비번변경 강제 회피
    },
    select: { id: true, email: true, role: true, isActive: true, passwordChangedAt: true },
  });

  console.log('ACCOUNT_EMAIL=' + user.email);
  console.log('ACCOUNT_PASSWORD=' + password);
  console.log('ROLE=' + user.role + ' ACTIVE=' + user.isActive + ' PWCHANGED=' + !!user.passwordChangedAt);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
