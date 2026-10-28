import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { PERIODIC_BACKUP_PATTERN, isPeriodicEncryptedBackup } from '../../src/common/backup-files';

/**
 * 🔴 **배포 백업도 암호화한다** (2026-09-11 · 정본 `docs/05-reference/production-operations.md` §7.2).
 *
 * 실측: 정기 백업(`backup.sh`)은 `.gpg` 로 남는데 `deploy.sh backup_db` 의 `pre-deploy_*.sql.gz` 는
 * 암호화 분기가 없어 **환자 DB 전량이 평문으로 7일치** 남았다(서버 3개·권한 0664 — 같은 그룹이면 읽힘).
 *
 * 그리고 두 스크립트가 만드는 파일 이름은 **판정기와의 계약**이다 — go-live `security.dbBackup`·감시자
 * `pipe.backup` 은 이름으로 정기 백업을 가려낸다. 스크립트 쪽 이름이 바뀌면 판정기는 조용히 0 을 보거나
 * 배포 백업을 정기 백업으로 센다. 그래서 스크립트 원문을 정본 패턴과 기계 대조한다.
 */
const SCRIPTS = path.join(__dirname, '..', '..', '..', '..', 'infra', 'scripts');
const deploy = fs.readFileSync(path.join(SCRIPTS, 'deploy.sh'), 'utf8');
const backup = fs.readFileSync(path.join(SCRIPTS, 'backup.sh'), 'utf8');

/** 함수 본문만 — 주석 줄은 뺀다(이 파일의 주석이 함정을 **설명**하므로 주석을 명령으로 읽으면 가드가 다른 이유로 통과한다) */
function body(src: string, fn: string): string {
  const start = src.indexOf(`${fn}() {`);
  expect(start, `${fn}() 를 찾지 못했다 — 검사가 헛돈다`).toBeGreaterThan(-1);
  const end = src.indexOf('\n}\n', start);
  return src
    .slice(start, end)
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
}

describe('🔴 배포 백업 — 평문으로 남기지 않는다', () => {
  const b = body(deploy, 'backup_db');

  it('대조군 — backup_db 본문을 실제로 읽었다', () => {
    expect(b).toMatch(/pg_dump/);
    expect(b).toMatch(/pre-deploy_/);
  });

  it('암호화한다(정기 백업과 같은 방식 — 대칭 AES256·같은 패스프레이즈 파일)', () => {
    expect(b, '배포 백업 암호화가 사라졌다 — 평문 7일치가 다시 남는다').toMatch(/gpg --batch --yes --symmetric --cipher-algo AES256/);
    // 🔴 (2026-09-13 T3-5) 경로가 설정 변수로 빠졌다 — 본문은 변수를 쓰고, 그 **기본값**이 정기 백업의 경로와 같아야 한다
    //    (문자열이 본문에서 사라진 것을 "갈라지지 않았다"로 읽으면 가드가 헛돈다 — 기본값을 따로 대조한다).
    expect(b).toMatch(/PASSPHRASE_FILE=\$\{HIS_BACKUP_PASSPHRASE_FILE\}/);
    const def = /HIS_BACKUP_PASSPHRASE_FILE="\$\{HIS_BACKUP_PASSPHRASE_FILE:-([^}]+)\}"/.exec(deploy);
    expect(def, '배포 백업 패스프레이즈 기본값 정의를 찾지 못했다 — 검사가 헛돈다').toBeTruthy();
    expect(def![1]).toBe('/home/deploy/.backup-passphrase');
    expect(backup, '정기 백업과 패스프레이즈 파일이 갈라졌다').toMatch(/\/home\/deploy\/\.backup-passphrase/);
  });

  it('🔴 암호문을 열어 검사를 통과해야만 평문을 지운다(열 수 없는 암호문은 백업이 아니다)', () => {
    const verifyAt = b.search(/--decrypt[^\n]*\n?[^\n]*grep -c 'CREATE TABLE'|--decrypt.*CREATE TABLE/);
    const rmPlainAt = b.search(/rm -f \\\$\{BACKUP_FILE\}\s*$/m);
    expect(verifyAt, '복호화 검증이 없다 — 암호화 명령의 성공만으로 평문을 지운다').toBeGreaterThan(-1);
    expect(rmPlainAt, '평문 삭제를 찾지 못했다 — 검사가 헛돈다').toBeGreaterThan(-1);
    expect(rmPlainAt, '복호화 검증보다 먼저 평문을 지운다').toBeGreaterThan(verifyAt);
  });

  it('🔴 무결성 검사(CREATE TABLE)는 평문에서 먼저 한다 — 빈 백업을 암호화해 "완료"라 하지 않는다', () => {
    const integrityAt = b.search(/gunzip -c \\\$\{BACKUP_FILE\}[^\n]*grep -c 'CREATE TABLE'/);
    const encryptAt = b.search(/--symmetric/);
    expect(integrityAt).toBeGreaterThan(-1);
    expect(encryptAt).toBeGreaterThan(integrityAt);
  });

  it('🔴 암호화 못 하면 조용히 넘어가지 않는다 — 평문이 남는다고 말한다', () => {
    expect(b).toMatch(/암호화 생략\(평문 배포 백업이 남는다\)/);
    expect(b).toMatch(/복호화 검증 실패/);
    expect(b, '완료 로그가 암호화 여부를 말하지 않는다').toMatch(/백업 완료: .*ENC_STATE/);
  });

  it('새 파일은 소유자만 읽는다(umask 077 — 종전 0664)', () => {
    expect(b).toMatch(/umask 077/);
  });

  it('7일 보존 삭제가 암호문까지 덮는다(평문만 지우면 .gpg 가 무한히 쌓인다)', () => {
    expect(b).toMatch(/find [^\n]*-name 'pre-deploy_\*\.sql\.gz\*' -mtime \+7 -delete/);
  });

  it('복원 안내가 암호문을 전제한다', () => {
    expect(body(deploy, 'deploy_schema')).toMatch(/pre-deploy_<TS>\.sql\.gz\.gpg/);
  });
});

describe('🔴 백업 파일 이름 = 판정기와의 계약', () => {
  it('정기 백업 스크립트가 만드는 이름이 정본 패턴에 맞는다', () => {
    expect(backup).toMatch(/DATE=\$\(date \+%Y%m%d_%H%M%S\)/);
    expect(backup).toMatch(/BACKUP_FILE="\$\{BACKUP_DIR\}\/hospitalrun_\$\{DATE\}\.sql\.gz"/);
    expect(backup).toMatch(/ENCRYPTED_FILE="\$\{BACKUP_FILE\}\.gpg"/);
    expect(isPeriodicEncryptedBackup('hospitalrun_20260911_030001.sql.gz.gpg')).toBe(true);
  });

  it('🔴 배포 백업 이름은 정본 패턴에 걸리지 않는다 — 평문이든 암호문이든', () => {
    const b = body(deploy, 'backup_db');
    expect(b).toMatch(/DATE=\\\$\(date \+%Y%m%d_%H%M%S\)/);
    expect(b).toMatch(/BACKUP_FILE=\\\$\{BACKUP_DIR\}\/pre-deploy_\\\$\{DATE\}\.sql\.gz/);
    for (const n of ['pre-deploy_20260911_082624.sql.gz', 'pre-deploy_20260911_082624.sql.gz.gpg']) {
      expect(PERIODIC_BACKUP_PATTERN.test(n), `${n} 이 정기 백업으로 세어진다`).toBe(false);
      expect(isPeriodicEncryptedBackup(n)).toBe(false);
    }
  });

  it('평문 정기 백업은 "정기"이지만 "암호화"는 아니다(감시자는 생존만·go-live 는 암호화까지)', () => {
    expect(PERIODIC_BACKUP_PATTERN.test('hospitalrun_20260911_030001.sql.gz')).toBe(true);
    expect(isPeriodicEncryptedBackup('hospitalrun_20260911_030001.sql.gz')).toBe(false);
  });
});
