import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PERIODIC_BACKUP_PATTERN } from '../../src/common/backup-files';
import { BACKUP_STATUS_FILE } from '../../src/sentinel/pipe-registry';
import { probeBackupStatus } from '../../src/sentinel/pipe-sweep';

/**
 * 🔴 **백업은 아카이브가 아니다** — 2차 사본·복원 검증 스크립트 가드 (상용 릴리즈 T10-5 · 2026-09-13).
 *
 * 실측: 정기 백업 `.gpg` 가 DB 와 **같은 디스크**·네트워크 연결 장치에 있고 30일 뒤 지워진다.
 * 복원이 되는지 남기는 경로도 없었다. 이 스펙은 스크립트를 **실제로 돌린다**(문자열만 보면 주석이 대신 통과한다).
 *
 * 🔴 운영 서버에서 돌리지 않는다 — 임시 디렉터리·가짜 패스프레이즈·로컬 gpg 만 쓴다.
 */
const SCRIPTS = path.join(__dirname, '..', '..', '..', '..', 'infra', 'scripts');
const COPY = path.join(SCRIPTS, 'backup-copy.sh');
const VERIFY = path.join(SCRIPTS, 'backup-verify.sh');
const BACKUP = path.join(SCRIPTS, 'backup.sh');
const HAS_GPG = spawnSync('gpg', ['--version']).status === 0;
const NAME = 'hospitalrun_20260913_030000.sql.gz';

/** 주석 줄을 뺀 본문 — 주석이 문자열 검사를 대신 통과시키지 않게 */
const code = (src: string) => src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

let tmp: string;
let env: NodeJS.ProcessEnv;
function run(script: string, args: string[] = [], extra: NodeJS.ProcessEnv = {}) {
  const r = spawnSync('bash', [script, ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const bk = (n: string) => path.join(tmp, 'bk', n);
const readStatus = () => JSON.parse(fs.readFileSync(bk(BACKUP_STATUS_FILE), 'utf8')) as Record<string, unknown>;

function makeEncrypted(sql: string) {
  fs.writeFileSync(bk(NAME), gzipSync(sql));
  const r = spawnSync('gpg', ['--batch', '--yes', '--symmetric', '--cipher-algo', 'AES256',
    '--passphrase-file', path.join(tmp, 'pp'), '--output', bk(`${NAME}.gpg`), bk(NAME)], { env, encoding: 'utf8' });
  expect(r.status, `픽스처 암호화 실패 — 검사가 헛돈다: ${r.stderr}`).toBe(0);
  fs.rmSync(bk(NAME));
}

beforeEach(() => {
  // gpg-agent 소켓 경로 길이 제한 때문에 짧은 임시 경로를 쓴다
  tmp = fs.mkdtempSync(path.join(os.platform() === 'win32' ? os.tmpdir() : '/tmp', 'a4bk-'));
  fs.mkdirSync(path.join(tmp, 'bk'));
  fs.mkdirSync(path.join(tmp, 'copy'));
  fs.mkdirSync(path.join(tmp, 'g'), { mode: 0o700 });
  fs.writeFileSync(path.join(tmp, 'pp'), 'test-passphrase\n', { mode: 0o600 });
  env = {
    PATH: process.env.PATH, HOME: tmp, GNUPGHOME: path.join(tmp, 'g'),
    DEPLOY_ENV_FILE: path.join(tmp, 'none.env'),
    HIS_BACKUP_DIR: path.join(tmp, 'bk'), HIS_BACKUP_PASSPHRASE_FILE: path.join(tmp, 'pp'),
  };
});
afterEach(() => {
  spawnSync('gpgconf', ['--kill', 'gpg-agent'], { env });
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('구문·계약', () => {
  it('세 스크립트가 bash -n 을 통과한다', () => {
    for (const s of [BACKUP, COPY, VERIFY]) {
      const r = spawnSync('bash', ['-n', s], { encoding: 'utf8' });
      expect(r.status, `${path.basename(s)}: ${r.stderr}`).toBe(0);
    }
  });

  it('🔴 두 스크립트의 정기 백업 이름 규칙이 정본 패턴과 같다(갈라지면 사본이 엉뚱한 파일을 본다)', () => {
    for (const s of [COPY, VERIFY]) {
      const m = /PERIODIC_RE='([^']+)'/.exec(fs.readFileSync(s, 'utf8'));
      expect(m, `${path.basename(s)} 패턴 정의를 찾지 못했다 — 검사가 헛돈다`).toBeTruthy();
      const re = new RegExp(m![1]);
      for (const n of [NAME, `${NAME}.gpg`, 'pre-deploy_20260913_030000.sql.gz.gpg', 'hospitalrun_2026.sql.gz', 'backup-status.json']) {
        expect(re.test(n), `${path.basename(s)}: ${n}`).toBe(PERIODIC_BACKUP_PATTERN.test(n));
      }
    }
  });

  it('상태 파일 이름이 감시자 등록부와 같다', () => {
    for (const s of [COPY, VERIFY]) {
      expect(code(fs.readFileSync(s, 'utf8'))).toContain(`STATUS_FILE="\${BACKUP_DIR}/${BACKUP_STATUS_FILE}"`);
    }
  });

  it('정기 백업이 사본 단계를 부른다 · 기본 삭제는 종전 그대로 · 사본 조건 삭제는 옵트인', () => {
    const b = code(fs.readFileSync(BACKUP, 'utf8'));
    expect(b).toMatch(/bash "\$\{SCRIPT_DIR\}\/backup-copy\.sh"/);
    expect(b).toMatch(/if \[ "\$\{HIS_BACKUP_PRUNE_REQUIRES_COPY:-0\}" = "1" \]; then/);
    expect(b).toMatch(/else\n\s*find "\$\{BACKUP_DIR\}" -name "hospitalrun_\*\.sql\.gz\*" -mtime \+\$\{RETENTION_DAYS\} -delete/);
  });
});

describe.skipIf(!HAS_GPG)('backup-copy.sh — 실제 실행(로컬 gpg)', () => {
  it('🔴 대상 미설정은 실패가 아니지만 **매번** "2차 사본 없음"을 로그·상태 파일에 남긴다', () => {
    makeEncrypted('CREATE TABLE public.patients (id int);\n');
    const r = run(COPY);
    expect(r.code).toBe(0);
    expect(r.out).toContain('2차 사본 없음(백업이 원본과 같은 장치에 있다)');
    const st = readStatus();
    expect(st).toMatchObject({ copyStatus: 'NOT_CONFIGURED', secondCopyMissing: true, lastBackupEncrypted: true, backupScope: 'DB_ONLY' });
    // 감시자가 같은 파일을 읽어 위반으로 센다
    expect(probeBackupStatus(path.join(tmp, 'bk'), 'secondCopy')).toMatchObject({ observable: true, value: 1 });
  });

  it('🔴 평문(.sql.gz)은 복사하지 않는다 — exit 2·사본 0', () => {
    fs.writeFileSync(bk(NAME), gzipSync('CREATE TABLE x (id int);\n'));
    const r = run(COPY, [], { HIS_BACKUP_COPY_TARGET: path.join(tmp, 'copy') });
    expect(r.code).toBe(2);
    expect(fs.readdirSync(path.join(tmp, 'copy'))).toEqual([]);
    expect(readStatus()).toMatchObject({ copyStatus: 'REFUSED_PLAINTEXT', secondCopyMissing: true, lastBackupEncrypted: false });
  });

  it('🔴 이름만 .gpg 로 바꾼 gzip 평문도 복사하지 않는다(이름이 아니라 내용을 본다)', () => {
    fs.writeFileSync(bk(`${NAME}.gpg`), gzipSync('CREATE TABLE x (id int);\n'));
    const r = run(COPY, [], { HIS_BACKUP_COPY_TARGET: path.join(tmp, 'copy') });
    expect(r.code).toBe(2);
    expect(fs.readdirSync(path.join(tmp, 'copy'))).toEqual([]);
  });

  it('로컬 사본은 sha256 까지 검증하지만 **같은 장치**면 여전히 "2차 사본 없음"', () => {
    makeEncrypted('CREATE TABLE public.patients (id int);\n');
    const r = run(COPY, [], { HIS_BACKUP_COPY_TARGET: path.join(tmp, 'copy') });
    expect(r.code).toBe(0);
    expect(fs.readdirSync(path.join(tmp, 'copy'))).toEqual([`${NAME}.gpg`]);
    const st = readStatus();
    expect(st).toMatchObject({ copyStatus: 'VERIFIED', copySameDeviceAsSource: true, secondCopyMissing: true, copyTargetKind: 'LOCAL' });
    expect(st.copySha256).toBe(st.lastBackupSha256);
    expect(fs.readFileSync(bk('copy-manifest.tsv'), 'utf8')).toContain(`${NAME}.gpg\t${st.lastBackupSha256}\t`);
    expect(probeBackupStatus(path.join(tmp, 'bk'), 'secondCopy').detail).toMatch(/같은 장치/);
  });

  it('대상 디렉터리가 없으면 FAILED(exit 1) — 조용히 성공으로 적지 않는다', () => {
    makeEncrypted('CREATE TABLE public.patients (id int);\n');
    const r = run(COPY, [], { HIS_BACKUP_COPY_TARGET: path.join(tmp, 'nowhere') });
    expect(r.code).toBe(1);
    expect(readStatus()).toMatchObject({ copyStatus: 'FAILED', secondCopyMissing: true });
  });
});

describe('backup-verify.sh — 복원 대상 안전장치(스크립트 함수 직접 호출)', () => {
  const guard = (url: string, extra: NodeJS.ProcessEnv = {}) =>
    spawnSync('bash', ['-c', `source "${VERIFY}"; is_scratch_db_url "$1"`, '_', url], { env: { PATH: process.env.PATH, ...extra }, encoding: 'utf8' });

  it.each([
    'postgresql://hospital:secret@localhost:5432/hospitalrun',
    'postgresql://hospital:secret@localhost:5432/hospitalrun?schema=public',
    'postgresql://u@h/openpacs',
    'postgresql://u@h/postgres',
    'postgresql://u@h/template1',
    'postgresql://u@h/mydb',
    'postgresql://u@h:5432',
    'postgresql://u@restore-host:5432',
    'postgresql://u@verify-host:5432/hospitalrun',
  ])('🔴 거부: %s', (url) => {
    expect(guard(url).status).toBe(1);
  });

  it('🔴 이름이 허용이어도 현재 DATABASE_URL 과 같으면 거부', () => {
    const url = 'postgresql://u@h:5432/his_restore_verify';
    expect(guard(url, { DATABASE_URL: `${url}?schema=public` }).status).toBe(1);
  });

  it.each(['postgresql://u@localhost:55432/his_restore_verify', 'postgresql://u@h/scratch1?sslmode=disable'])('대조군 — 허용: %s', (url) => {
    expect(guard(url).status).toBe(0);
  });

  it('🔴 거부되면 복원하지 않고 exit 3 — 상태 파일에도 "검증됨"을 남기지 않는다', () => {
    fs.writeFileSync(bk(NAME), gzipSync('CREATE TABLE x (id int);\n'));
    const r = run(VERIFY, ['--restore-db', 'postgresql://hospital:secret@localhost:5432/hospitalrun']);
    expect(r.code).toBe(3);
    expect(fs.existsSync(bk(BACKUP_STATUS_FILE))).toBe(false);
  });
});

describe.skipIf(!HAS_GPG)('backup-verify.sh — 무결성(기본: 복원 없음)', () => {
  it('암호문을 열어 CREATE TABLE 을 세고 lastRestoreVerifiedAt 을 남긴다 — 사본 필드는 보존', () => {
    makeEncrypted('CREATE TABLE public.patients (id int);\nCREATE TABLE public.encounters (id int);\n');
    run(COPY);
    const r = run(VERIFY);
    expect(r.code, r.out).toBe(0);
    const st = readStatus();
    expect(st).toMatchObject({ lastRestoreVerifyStatus: 'PASS', lastRestoreVerifyLevel: 'INTEGRITY', copyStatus: 'NOT_CONFIGURED' });
    expect(typeof st.lastRestoreVerifiedAt).toBe('string');
    expect(probeBackupStatus(path.join(tmp, 'bk'), 'restoreVerify')).toMatchObject({ observable: true, value: 0 });
  });

  it('🔴 열 수 없는 백업은 FAIL · 통과 시각을 새로 찍지 않는다 · 감시자가 위반으로 센다', () => {
    fs.writeFileSync(bk(`${NAME}.gpg`), Buffer.from([0x8c, 0x0d, 0x04, 0x09, 0x03, 0x02]));
    const r = run(VERIFY);
    expect(r.code).toBe(1);
    const st = readStatus();
    expect(st).toMatchObject({ lastRestoreVerifyStatus: 'FAIL', lastRestoreVerifiedAt: null, copyStatus: 'UNKNOWN', secondCopyMissing: true });
    expect(probeBackupStatus(path.join(tmp, 'bk'), 'restoreVerify').value).toBe(1);
  });
});
