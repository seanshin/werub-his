import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InternalServerErrorException } from '@nestjs/common';

/**
 * 환자 포털 시드 계정 로더 — 데이터 정본은 `apps/api/prisma/seeds/patient-portal-test-accounts.json`.
 *
 * 🔴 (2026-09-14 G12 실측) 시드 생년월일·공용 비밀번호를 서비스 본문에 두면 `nest build` 산출물(dist)에 남아
 *    REAL 산출물 검사(G12)가 FAIL 했다 — 컨트롤러가 REAL 에서 403 으로 막아도 **문자열은 번들에 있다**
 *    (숨긴 것과 없는 것은 다르다). 그래서 데이터는 src 밖(prisma 시드 영역)에 두고 호출 시점에 읽는다.
 * 경로: `src/modules/patient-auth` 와 `dist/modules/patient-auth` 모두 3단계 위가 `apps/api` — cwd 에 기대지 않는다.
 * 파일이 없거나 모양이 틀리면 **빈 목록으로 조용히 성공하지 않고** 실패한다(시드 0건을 "완료"로 말하지 않는다).
 */
export interface PortalSeedPatient { name: string; phone: string; dob: string; gender: 'MALE' | 'FEMALE'; mrn: string }
export interface PortalSeedAccounts { password: string; patients: PortalSeedPatient[] }

export const PORTAL_SEED_ACCOUNTS_FILE = join(__dirname, '..', '..', '..', 'prisma', 'seeds', 'patient-portal-test-accounts.json');

export function loadPortalSeedAccounts(file: string = PORTAL_SEED_ACCOUNTS_FILE): PortalSeedAccounts {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    throw new InternalServerErrorException(`Portal seed accounts file not readable: ${(e as Error).message}`);
  }
  const parsed = JSON.parse(raw) as Partial<PortalSeedAccounts>;
  if (typeof parsed.password !== 'string' || !parsed.password || !Array.isArray(parsed.patients) || parsed.patients.length === 0) {
    throw new InternalServerErrorException('Portal seed accounts file is malformed (password/patients)');
  }
  for (const p of parsed.patients) {
    if (!p || typeof p.phone !== 'string' || typeof p.dob !== 'string' || typeof p.mrn !== 'string'
      || typeof p.name !== 'string' || (p.gender !== 'MALE' && p.gender !== 'FEMALE')) {
      throw new InternalServerErrorException('Portal seed accounts file has an invalid patient entry');
    }
  }
  return parsed as PortalSeedAccounts;
}
