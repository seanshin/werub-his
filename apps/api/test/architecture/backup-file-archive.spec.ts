import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PERIODIC_BACKUP_PATTERN } from '../../src/common/backup-files';
import { BACKUP_STATUS_FILE } from '../../src/sentinel/pipe-registry';
import { probeBackupStatus } from '../../src/sentinel/pipe-sweep';

/**
 * 🔴 **DB 만 복원하면 파일은 돌아오지 않는다** — 정기 백업의 파일 저장소 아카이브 가드 (상용 릴리즈 T10 · 2026-09-13).
 *
 * 실측(`docs/05-reference/record-transfer-inventory.md` §1.2): `backup.sh`·`backup-copy.sh`·`backup-verify.sh` 가 전부
 * `pg_dump` 만 다뤘다. 진료 첨부(`apps/api/storage/encounter-attachments`)·녹음 원음·동의서 첨부는 어느 백업에도 없었다.
 *
 * 이 스펙은 스크립트를 **실제로 돌린다**(가짜 `docker` 가 덤프를 흉내내고, 로컬 gpg·임시 디렉터리만 쓴다 — 운영 서버·DB 없음).
 */
const SCRIPTS = path.join(__dirname, '..', '..', '..', '..', 'infra', 'scripts');
const BACKUP = path.join(SCRIPTS, 'backup.sh');
const COPY = path.join(SCRIPTS, 'backup-copy.sh');
const VERIFY = path.join(SCRIPTS, 'backup-verify.sh');
const LIB = path.join(SCRIPTS, 'lib', 'backup-files.sh');
const HAS_GPG = spawnSync('gpg', ['--version']).status === 0;
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

const code = (src: string) => src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

let tmp: string;
let env: NodeJS.ProcessEnv;
const bk = (n = '') => path.join(tmp, 'bk', n);
const app = (...p: string[]) => path.join(tmp, 'app', ...p);
function run(script: string, args: string[] = [], extra: NodeJS.ProcessEnv = {}) {
  const r = spawnSync('bash', [script, ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const readStatus = () => JSON.parse(fs.readFileSync(bk(BACKUP_STATUS_FILE), 'utf8')) as Record<string, unknown>;
const listBk = () => fs.readdirSync(bk()).sort();
const onlyOne = (re: RegExp) => {
  const hits = listBk().filter((n) => re.test(n));
  expect(hits, `기대한 파일이 정확히 1개가 아니다 — 검사가 헛돈다: ${listBk().join(', ')}`).toHaveLength(1);
  return hits[0];
};
const readMeta = () => Object.fromEntries(
  fs.readFileSync(bk(onlyOne(/^hospitalrun-files_\d{8}_\d{6}\.meta$/)), 'utf8').trim().split('\n').map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1)];
  }),
) as Record<string, string>;
const put = (rel: string, body = 'x') => { fs.mkdirSync(path.dirname(app(rel)), { recursive: true }); fs.writeFileSync(app(rel), body); };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.platform() === 'win32' ? os.tmpdir() : '/tmp', 'bkfa-'));
  for (const d of ['bk', 'copy', 'bin', 'app']) fs.mkdirSync(path.join(tmp, d));
  fs.mkdirSync(path.join(tmp, 'g'), { mode: 0o700 });
  fs.writeFileSync(path.join(tmp, 'pp'), 'test-passphrase\n', { mode: 0o600 });
  // 가짜 docker — `docker exec … pg_dump` 자리에 덤프 두 줄을 낸다
  fs.writeFileSync(path.join(tmp, 'bin', 'docker'), "#!/bin/bash\nprintf 'CREATE TABLE public.patients (id int);\\nCREATE TABLE public.encounters (id int);\\n'\n", { mode: 0o755 });
  env = {
    PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`, HOME: tmp, GNUPGHOME: path.join(tmp, 'g'),
    DEPLOY_ENV_FILE: path.join(tmp, 'none.env'),
    HIS_APP_ROOT: app(), HIS_BACKUP_DIR: bk(), HIS_BACKUP_PASSPHRASE_FILE: path.join(tmp, 'pp'),
  };
});
afterEach(() => {
  spawnSync('gpgconf', ['--kill', 'gpg-agent'], { env });
  spawnSync('chmod', ['-R', 'u+rwX', tmp]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('구문·계약', () => {
  it('공용 함수 파일이 bash -n 을 통과하고, 세 스크립트가 **같은** 파일을 source 한다(짝 규칙이 갈라지지 않게)', () => {
    expect(spawnSync('bash', ['-n', LIB], { encoding: 'utf8' }).status).toBe(0);
    for (const s of [BACKUP, COPY, VERIFY]) {
      expect(code(fs.readFileSync(s, 'utf8')), path.basename(s)).toContain('source "${SCRIPT_DIR}/lib/backup-files.sh"');
    }
  });

  it('🔴 파일 아카이브 이름은 정기 백업 정본 패턴에 걸리지 않는다(걸리면 감시자·go-live 가 DB 백업으로 센다)', () => {
    const r = spawnSync('bash', ['-c', `source "${LIB}"; basename "$(files_archive_path /x 20260913_030000)"; basename "$(files_meta_path /x 20260913_030000)"; files_ts_of /x/hospitalrun_20260913_030000.sql.gz.gpg; echo; files_ts_of /x/pre-deploy_20260913_030000.sql.gz.gpg; echo "|"`], { encoding: 'utf8' });
    const [archive, meta, ts, deployTs] = r.stdout.split('\n');
    expect(archive).toBe('hospitalrun-files_20260913_030000.tar.gz.gpg');
    expect(meta).toBe('hospitalrun-files_20260913_030000.meta');
    expect(PERIODIC_BACKUP_PATTERN.test(archive)).toBe(false);
    expect(ts).toBe('20260913_030000');
    expect(deployTs).toBe('|'); // 배포 백업은 짝을 찾지 않는다
  });

  it('대상 경로가 API cwd(apps/api) 기준 uploads·storage 를 담는다 — 코드의 저장 경로와 대조', () => {
    const lib = code(fs.readFileSync(LIB, 'utf8'));
    expect(lib).toMatch(/BACKUP_FILE_PATHS=\(apps\/api\/uploads apps\/api\/storage uploads\)/);
    const src = path.join(__dirname, '..', '..', 'src', 'modules');
    expect(fs.readFileSync(path.join(src, 'encounter', 'encounter.service.ts'), 'utf8')).toContain("join(process.cwd(), 'storage', 'encounter-attachments'");
    expect(fs.readFileSync(path.join(src, 'scribe', 'scribe.service.ts'), 'utf8')).toContain("join(process.cwd(), 'storage', 'scribe'");
  });
});

// 🔴 gpg·tar 실실행 — 단독 2~3초·전체 스위트 부하에서 4.7초 실측(기본 5초에 걸려 병합 트리 전체 실행에서 3건 시간초과)
describe.skipIf(!HAS_GPG)('backup.sh — 파일 아카이브 실제 실행', { timeout: 30_000 }, () => {
  it('🔴 uploads·storage 를 같은 시각 짝으로 암호화해 담는다 · 빈 디렉터리는 파일 수에 넣지 않는다 · 범위 DB+FILES', () => {
    put('apps/api/uploads/patients/p1/photo.png');
    put('apps/api/uploads/voc/a.pdf');
    put('apps/api/storage/encounter-attachments/e1/att-1.png');
    fs.mkdirSync(app('apps/api/storage/scribe'), { recursive: true });
    const r = run(BACKUP);
    expect(r.code, r.out).toBe(0);
    const db = onlyOne(PERIODIC_BACKUP_PATTERN);
    const archive = onlyOne(/^hospitalrun-files_\d{8}_\d{6}\.tar\.gz\.gpg$/);
    expect(archive.slice('hospitalrun-files_'.length, -'.tar.gz.gpg'.length)).toBe(db.slice('hospitalrun_'.length, -'.sql.gz.gpg'.length));
    // 🔴 암호문이다 — gzip 매직(1f8b)이면 평문 환자 파일이 백업 디렉터리에 퍼진 것
    expect(fs.readFileSync(bk(archive)).subarray(0, 2).toString('hex')).not.toBe('1f8b');
    expect(readMeta()).toMatchObject({ status: 'ARCHIVED', fileCount: '3', included: 'apps/api/uploads,apps/api/storage', missing: 'uploads' });
    expect(listBk().some((n) => n.endsWith('.partial') || n.endsWith('.tar-err'))).toBe(false);
    const st = readStatus();
    expect(st).toMatchObject({ backupScope: 'DB+FILES', filesArchiveStatus: 'ARCHIVED', filesArchiveFileCount: 3, filesArchiveFile: archive, filesCopyStatus: 'NOT_CONFIGURED' });
    expect(probeBackupStatus(bk(), 'secondCopy').detail).not.toMatch(/DB 뿐/);
    // 감시자 파일 축 — 스크립트가 실제로 쓴 상태 파일을 그대로 먹인다(내가 가정한 모양이 아니다)
    const fa = probeBackupStatus(bk(), 'filesArchive');
    expect(fa).toMatchObject({ observable: true, value: 0 });
    expect(fa.detail).toContain('파일 3개');
  });

  it('🔴 경로는 있는데 파일 0개 = ARCHIVED·fileCount 0 · 경로가 하나도 없음 = NO_PATHS·범위 DB_ONLY (둘을 같은 모양으로 그리지 않는다)', () => {
    fs.mkdirSync(app('apps/api/uploads'), { recursive: true });
    expect(run(BACKUP).code).toBe(0);
    expect(readMeta()).toMatchObject({ status: 'ARCHIVED', fileCount: '0' });

    fs.rmSync(bk(), { recursive: true }); fs.mkdirSync(bk());
    fs.rmSync(app('apps'), { recursive: true });
    const r = run(BACKUP);
    expect(r.code, r.out).toBe(0);
    expect(readMeta()).toMatchObject({ status: 'NO_PATHS', fileCount: '' });
    expect(listBk().some((n) => n.endsWith('.tar.gz.gpg'))).toBe(false);
    expect(readStatus()).toMatchObject({ backupScope: 'DB_ONLY', filesArchiveStatus: 'NO_PATHS', filesArchiveFileCount: null });
    expect(probeBackupStatus(bk(), 'secondCopy').detail).toMatch(/DB 뿐/);
    // 🔴 경로 없음은 초록이 아니다 — 관측 불가
    expect(probeBackupStatus(bk(), 'filesArchive').observable).toBe(false);
  });

  it('🔴 패스프레이즈가 없으면 평문 아카이브를 만들지 않는다 — NOT_ENCRYPTED 로 기록', () => {
    put('apps/api/storage/encounter-attachments/e1/att-1.png', 'patient-image');
    const r = run(BACKUP, [], { HIS_BACKUP_PASSPHRASE_FILE: path.join(tmp, 'nope') });
    expect(r.out).toContain('평문으로는 만들지 않는다');
    expect(readMeta()).toMatchObject({ status: 'NOT_ENCRYPTED', fileCount: '1' });
    expect(listBk().filter((n) => n.startsWith('hospitalrun-files_') && !n.endsWith('.meta'))).toEqual([]);
    expect(probeBackupStatus(bk(), 'filesArchive')).toMatchObject({ observable: true, value: 1 });
  });

  it.skipIf(IS_ROOT)('🔴 tar 실패는 실패다 — FAILED·exit 1·부분 파일 없음·범위 DB_ONLY (DB 덤프가 남았다고 성공으로 끝내지 않는다)', () => {
    put('apps/api/uploads/voc/a.pdf');
    put('apps/api/storage/encounter-attachments/e1/locked.png', 'secret');
    fs.chmodSync(app('apps/api/storage/encounter-attachments/e1/locked.png'), 0o000);
    const r = run(BACKUP);
    expect(r.code, r.out).toBe(1);
    const meta = readMeta();
    expect(meta.status).toBe('FAILED');
    expect(meta.detail).toMatch(/tar [1-9]/);
    expect(listBk().some((n) => /\.tar\.gz\.gpg(\.partial)?$|\.tar-err$/.test(n))).toBe(false);
    onlyOne(PERIODIC_BACKUP_PATTERN); // DB 백업 자체는 남는다
    expect(readStatus()).toMatchObject({ backupScope: 'DB_ONLY', filesArchiveStatus: 'FAILED' });
    // 🔴 DB 사본·백업 파일은 초록이어도 파일 축은 위반이다 — 이 항목이 없으면 매일 말하는 곳이 없었다
    const fa = probeBackupStatus(bk(), 'filesArchive');
    expect(fa).toMatchObject({ observable: true, value: 1 });
    expect(fa.detail).toContain('아카이브 생성 실패');
  });
});

describe.skipIf(!HAS_GPG)('backup-copy.sh · backup-verify.sh — 짝 아카이브', { timeout: 30_000 }, () => {
  function backupWithFiles() {
    put('apps/api/uploads/consent/c.pdf');
    put('apps/api/storage/scribe/e1/scribe-1.webm');
    const r = run(BACKUP);
    expect(r.code, r.out).toBe(0);
    return onlyOne(/^hospitalrun-files_\d{8}_\d{6}\.tar\.gz\.gpg$/);
  }

  it('사본 대상이 있으면 DB 백업과 파일 아카이브를 **둘 다** 복사·sha256 검증하고 manifest 에 둘 다 남긴다', () => {
    const archive = backupWithFiles();
    const r = run(COPY, [], { HIS_BACKUP_COPY_TARGET: path.join(tmp, 'copy') });
    expect(r.code, r.out).toBe(0);
    expect(fs.readdirSync(path.join(tmp, 'copy')).sort()).toEqual([onlyOne(PERIODIC_BACKUP_PATTERN), archive].sort());
    const manifest = fs.readFileSync(bk('copy-manifest.tsv'), 'utf8');
    expect(manifest).toContain(`${archive}\t${readMeta().sha256}\t`);
    expect(readStatus()).toMatchObject({ copyStatus: 'VERIFIED', filesCopyStatus: 'VERIFIED' });
  });

  it('🔴 짝 아카이브가 사라졌으면 DB 사본이 통과해도 copyStatus FAILED·exit 1 (DB 만 복사하고 "통과"라 말하지 않는다)', () => {
    const archive = backupWithFiles();
    fs.rmSync(bk(archive));
    const r = run(COPY, [], { HIS_BACKUP_COPY_TARGET: path.join(tmp, 'copy') });
    expect(r.code, r.out).toBe(1);
    expect(readStatus()).toMatchObject({ copyStatus: 'FAILED', filesCopyStatus: 'FAILED', secondCopyMissing: true });
    expect(probeBackupStatus(bk(), 'secondCopy').value).toBe(1);
  });

  it('verify 가 아카이브를 열어 목록 수 = 기록 수를 대조한다(대조군 PASS)', () => {
    backupWithFiles();
    const r = run(VERIFY);
    expect(r.code, r.out).toBe(0);
    expect(readStatus()).toMatchObject({ lastRestoreVerifyStatus: 'PASS', lastFilesVerifyStatus: 'PASS', filesArchiveStatus: 'ARCHIVED' });
  });

  it('🔴 아카이브 변조(sha256 불일치) → 전체 FAIL·exit 1·감시자 restoreVerify 위반', () => {
    const archive = backupWithFiles();
    const buf = fs.readFileSync(bk(archive));
    buf[buf.length - 5] ^= 0xff;
    fs.writeFileSync(bk(archive), buf);
    const r = run(VERIFY);
    expect(r.code, r.out).toBe(1);
    expect(readStatus()).toMatchObject({ lastRestoreVerifyStatus: 'FAIL', lastFilesVerifyStatus: 'FAIL' });
    expect(probeBackupStatus(bk(), 'restoreVerify').value).toBe(1);
  });

  it('🔴 기록된 파일 수와 아카이브 목록 수가 다르면 FAIL — sha256 이 맞아도 목록을 센다', () => {
    backupWithFiles();
    const metaName = onlyOne(/\.meta$/);
    const meta = fs.readFileSync(bk(metaName), 'utf8');
    const injected = meta.replace(/^fileCount=2$/m, 'fileCount=5');
    expect(injected, '주입이 무동작 — 검사가 헛돈다').not.toBe(meta);
    fs.writeFileSync(bk(metaName), injected);
    const r = run(VERIFY);
    expect(r.code, r.out).toBe(1);
    expect(String(readStatus().lastFilesVerifyDetail)).toMatch(/목록 2개 ≠ 기록된 원본 5개/);
  });

  it('파일 단계 이전 백업(짝 기록 없음)은 DB 판정을 유지하되 "파일은 백업에 없다"를 남긴다', () => {
    backupWithFiles();
    fs.rmSync(bk(onlyOne(/\.meta$/)));
    const r = run(VERIFY);
    expect(r.code, r.out).toBe(0);
    const st = readStatus();
    expect(st).toMatchObject({ lastRestoreVerifyStatus: 'PASS', lastFilesVerifyStatus: 'NOT_RUN' });
    expect(String(st.lastFilesVerifyDetail)).toMatch(/파일은 백업에 없습니다/);
  });
});
