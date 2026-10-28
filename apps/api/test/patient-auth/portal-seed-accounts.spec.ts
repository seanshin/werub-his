/**
 * 🔴 (2026-09-14 G12 실측) 환자 포털 시드 계정(생년월일·공용 비밀번호)이 서비스 본문에 있어 nest build 산출물(dist)에 남았다.
 *    컨트롤러는 REAL 에서 403 이지만 **문자열은 번들에 있었다**(숨긴 것과 없는 것은 다르다).
 * 지키는 것:
 *  ① patient-auth 모듈 소스(주석 제외)에 시드 생년월일·공용 비밀번호 리터럴이 없다 — 데이터는 prisma/seeds JSON
 *  ② 로더가 실제 파일을 읽는다(대조군 — 빈 목록이면 ①은 "시드를 지운 것"과 구분이 안 된다)
 *  ③ 파일이 없거나 모양이 틀리면 빈 목록으로 조용히 성공하지 않고 실패한다
 *  ④ seedTestAccounts 가 로더의 데이터·비밀번호를 쓴다
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadPortalSeedAccounts, PORTAL_SEED_ACCOUNTS_FILE } from '../../src/modules/patient-auth/portal-seed-accounts';
import { PatientAuthService } from '../../src/modules/patient-auth/patient-auth.service';

const MODULE_DIR = path.resolve(__dirname, '../../src/modules/patient-auth');

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

describe('환자 포털 시드 계정 — 산출물 밖', () => {
  it('① patient-auth 모듈 소스에 시드 생년월일·공용 비밀번호 리터럴이 없다', () => {
    const seed = JSON.parse(fs.readFileSync(PORTAL_SEED_ACCOUNTS_FILE, 'utf8'));
    const needles: string[] = [seed.password, ...seed.patients.map((p: { dob: string }) => p.dob)];
    const hits: string[] = [];
    for (const f of walk(MODULE_DIR)) {
      const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const n of needles) if (src.includes(n)) hits.push(`${path.relative(MODULE_DIR, f)}: ${n}`);
    }
    expect(hits).toEqual([]);
  });

  it('② 로더가 실제 시드 파일을 읽는다(대조군)', () => {
    const s = loadPortalSeedAccounts();
    expect(s.patients.length).toBeGreaterThanOrEqual(5);
    expect(s.password.length).toBeGreaterThan(0);
    expect(PORTAL_SEED_ACCOUNTS_FILE).toMatch(/apps[\\/]api[\\/]prisma[\\/]seeds[\\/]patient-portal-test-accounts\.json$/);
  });

  it('③ 파일 없음·모양 틀림은 실패다(빈 목록으로 성공하지 않는다)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
    expect(() => loadPortalSeedAccounts(path.join(tmp, 'none.json'))).toThrow(/not readable/);
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ password: 'x', patients: [] }));
    expect(() => loadPortalSeedAccounts(bad)).toThrow(/malformed/);
    fs.writeFileSync(bad, JSON.stringify({ password: 'x', patients: [{ name: 'a', phone: '1', dob: '2', mrn: '3', gender: 'X' }] }));
    expect(() => loadPortalSeedAccounts(bad)).toThrow(/invalid patient/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('④ seedTestAccounts 가 시드 파일의 환자·비밀번호를 쓴다', async () => {
    const seed = loadPortalSeedAccounts();
    const svc = Object.create(PatientAuthService.prototype) as PatientAuthService;
    (svc as any).BCRYPT_ROUNDS = 4;
    (svc as any).prisma = {
      patientAccount: { findUnique: vi.fn().mockResolvedValue({ id: 'exists' }), create: vi.fn() },
    };
    const r = await svc.seedTestAccounts();
    expect(r.password).toBe(seed.password);
    expect(r.created).toHaveLength(seed.patients.length);
    expect((svc as any).prisma.patientAccount.findUnique).toHaveBeenCalledWith({ where: { phone: seed.patients[0].phone } });
  });
});
