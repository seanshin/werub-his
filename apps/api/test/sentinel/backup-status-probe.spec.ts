import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeBackupStatus } from '../../src/sentinel/pipe-sweep';
import { PIPE_CHECKS, BACKUP_STATUS_FILE } from '../../src/sentinel/pipe-registry';
import { SentinelService } from '../../src/sentinel/sentinel.service';

/**
 * 축 D — 백업 2차 사본·복원 검증 관측(상용 릴리즈 T10-5).
 *
 * 🔴 상태 파일은 스크립트(`infra/scripts/backup-copy.sh`·`backup-verify.sh`)가 쓴다. 이 스펙의 픽스처는
 *    **스크립트가 실제로 쓴 한 줄**과 같은 키 순서·값 모양이다(`test/architecture/backup-copy-verify.spec.ts` 가
 *    실제 스크립트를 돌려 같은 프로브에 먹인다 — 내가 가정한 모양만 테스트하면 가드가 헛돈다).
 */
const SHA = 'f099d30f7f0118800b82f8073a4ce2db66a7c2b52ecd3af8488d9ad7a26aaee7';
function status(over: Record<string, unknown> = {}) {
  return {
    schema: 1, updatedAt: '2026-09-13T01:10:59Z', backupScope: 'DB_ONLY',
    lastBackupAt: '2026-09-13T01:10:59Z', lastBackupFile: 'hospitalrun_20260913_030000.sql.gz.gpg',
    lastBackupBytes: 200, lastBackupSha256: SHA, lastBackupEncrypted: true,
    copyTarget: 'backup@nas:/vol/his', copyTargetKind: 'REMOTE', copyStatus: 'VERIFIED',
    copyAt: '2026-09-13T01:11:30Z', copySha256: SHA, copySameDeviceAsSource: false,
    copyDetail: '2차 사본 검증 통과(크기·sha256 일치)', secondCopyMissing: false,
    lastRestoreVerifiedAt: '2026-09-10T00:00:00Z', lastRestoreVerifyLevel: 'RESTORE', lastRestoreVerifyStatus: 'PASS',
    lastRestoreVerifyFile: 'hospitalrun_20260910_030000.sql.gz.gpg', lastRestoreVerifyDetail: 'ok',
    ...over,
  };
}
const NOW = new Date('2026-09-13T12:00:00Z');

describe('백업 상태 파일 — 없거나 깨지면 관측 불가(0 이 아니다)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bkst-')); });
  const put = (o: unknown) => writeFileSync(join(dir, BACKUP_STATUS_FILE), typeof o === 'string' ? o : JSON.stringify(o));

  it('🔴 상태 파일이 없으면 세 항목 모두 관측 불가', () => {
    for (const k of ['secondCopy', 'restoreVerify', 'filesArchive'] as const) {
      const r = probeBackupStatus(dir, k, { now: NOW });
      expect(r.observable, `${k}: 파일이 없는데 관측했다고 말한다`).toBe(false);
      expect(r.detail).toMatch(/상태 파일\(backup-status\.json\)이 없습니다/);
    }
  });

  it('🔴 깨진 JSON·배열도 관측 불가', () => {
    put('{"schema":1,');
    expect(probeBackupStatus(dir, 'secondCopy').observable).toBe(false);
    put('[]');
    expect(probeBackupStatus(dir, 'restoreVerify').observable).toBe(false);
  });

  it('대조군 — 다른 장치에 검증된 최신 사본이면 위반 0', () => {
    put(status());
    const r = probeBackupStatus(dir, 'secondCopy', { now: NOW });
    expect(r).toMatchObject({ observable: true, value: 0 });
    expect(r.detail).toMatch(/DB 뿐/);
  });

  it.each([
    ['미설정', { copyStatus: 'NOT_CONFIGURED', copySha256: null, copySameDeviceAsSource: null }, /같은 장치에 있습니다\(사본 대상 미설정\)/],
    ['평문 거부', { copyStatus: 'REFUSED_PLAINTEXT', copySha256: null }, /암호화되지 않아/],
    ['복사 실패', { copyStatus: 'FAILED', copyDetail: 'sha256 불일치' }, /검증 실패\(sha256 불일치\)/],
    ['같은 장치', { copySameDeviceAsSource: true }, /같은 장치/],
    ['장치 모름', { copySameDeviceAsSource: null }, /같은 장치/],
    ['지난 백업의 사본', { copySha256: 'deadbeef' }, /최신 백업의 것이 아닙니다/],
    ['모르는 상태', { copyStatus: 'UNKNOWN' }, /모릅니다/],
  ])('🔴 %s → "2차 사본 없음" 위반 1', (_n, over, re) => {
    put(status(over));
    const r = probeBackupStatus(dir, 'secondCopy', { now: NOW });
    expect(r.observable).toBe(true);
    expect(r.value).toBe(1);
    expect(r.detail).toMatch(/2차 사본 없음/);
    expect(r.detail).toMatch(re);
  });

  it('copyStatus 키가 없으면 관측 불가(없음을 "사본 없음"으로 단정하지도 않는다)', () => {
    const s = status();
    delete (s as Record<string, unknown>).copyStatus;
    put(s);
    expect(probeBackupStatus(dir, 'secondCopy').observable).toBe(false);
  });

  it('대조군 — 한 달 안에 복원 검증 통과면 위반 0', () => {
    put(status());
    expect(probeBackupStatus(dir, 'restoreVerify', { now: NOW, maxAgeHours: 744 })).toMatchObject({ observable: true, value: 0 });
  });

  it('🔴 복원 검증 기록 없음 → 위반 1("열어 본 적 없음")', () => {
    put(status({ lastRestoreVerifiedAt: null, lastRestoreVerifyStatus: null, lastRestoreVerifyLevel: null }));
    const r = probeBackupStatus(dir, 'restoreVerify', { now: NOW });
    expect(r).toMatchObject({ observable: true, value: 1 });
    expect(r.detail).toMatch(/복원 검증 기록 없음/);
  });

  it('🔴 최근 시도가 실패면 지난 통과 시각이 있어도 위반 1', () => {
    put(status({ lastRestoreVerifyStatus: 'FAIL', lastRestoreVerifyDetail: 'CREATE TABLE 0개' }));
    const r = probeBackupStatus(dir, 'restoreVerify', { now: NOW });
    expect(r.value).toBe(1);
    expect(r.detail).toMatch(/실패/);
  });

  it('🔴 한 달이 지난 검증은 위반 1 · 무결성 수준은 "실제 복원 아님"이라 밝힌다', () => {
    put(status({ lastRestoreVerifiedAt: '2026-07-01T00:00:00Z', lastRestoreVerifyLevel: 'INTEGRITY' }));
    const r = probeBackupStatus(dir, 'restoreVerify', { now: NOW, maxAgeHours: 744 });
    expect(r.value).toBe(1);
    expect(r.detail).toMatch(/실제 복원 아님/);
  });
});

describe('파일 저장소 아카이브(pipe.backup.filesArchive) — 판정표', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bkfa-')); });
  const put = (o: unknown) => writeFileSync(join(dir, BACKUP_STATUS_FILE), JSON.stringify(o));
  // 필드 모양은 backup-copy.sh write_status 가 쓰는 그대로(filesArchiveFileCount 는 정수 또는 null)
  const fa = (over: Record<string, unknown>) => status({
    filesArchiveStatus: 'ARCHIVED', filesArchiveFile: 'hospitalrun-files_20260913_030000.tar.gz.gpg', filesArchiveFileCount: 6,
    filesArchiveSha256: SHA, filesArchivePathsMissing: 'uploads', filesArchiveDetail: null,
    filesCopyStatus: 'VERIFIED', filesCopyDetail: null, lastFilesVerifyStatus: 'PASS', lastFilesVerifyDetail: null, ...over,
  });

  it('대조군 — ARCHIVED 는 위반 0 · 파일 수를 밝힌다', () => {
    put(fa({}));
    const r = probeBackupStatus(dir, 'filesArchive');
    expect(r).toMatchObject({ observable: true, value: 0 });
    expect(r.detail).toContain('파일 6개');
  });

  it('🔴 ARCHIVED·파일 0개도 정상(경로는 있는데 비었다 — NO_PATHS 와 다른 사실)', () => {
    put(fa({ filesArchiveFileCount: 0 }));
    expect(probeBackupStatus(dir, 'filesArchive')).toMatchObject({ observable: true, value: 0 });
  });

  it('🔴 FAILED·NOT_ENCRYPTED 는 위반 1 — DB 사본(copyStatus VERIFIED)이 초록이어도', () => {
    put(fa({ filesArchiveStatus: 'FAILED', filesArchiveFileCount: null, filesArchiveDetail: 'tar 1 · gpg 0 Permission denied', filesCopyStatus: 'NOT_APPLICABLE' }));
    const f = probeBackupStatus(dir, 'filesArchive');
    expect(f).toMatchObject({ observable: true, value: 1 });
    expect(f.detail).toContain('Permission denied');
    expect(probeBackupStatus(dir, 'secondCopy').value).toBe(0); // 이 사각지대 때문에 항목을 만들었다
    put(fa({ filesArchiveStatus: 'NOT_ENCRYPTED', filesCopyStatus: 'NOT_APPLICABLE' }));
    expect(probeBackupStatus(dir, 'filesArchive')).toMatchObject({ observable: true, value: 1 });
  });

  it('🔴 NO_PATHS·NOT_RUN·필드 부재·ARCHIVED 인데 파일 수 없음 = 관측 불가(초록이 아니다)', () => {
    for (const over of [{ filesArchiveStatus: 'NO_PATHS', filesArchiveFileCount: null }, { filesArchiveStatus: 'NOT_RUN', filesArchiveFileCount: null }, { filesArchiveFileCount: null }]) {
      put(fa(over));
      const r = probeBackupStatus(dir, 'filesArchive');
      expect(r.observable, JSON.stringify(over)).toBe(false);
    }
    put(status()); // 파일 단계 이전 사본 스크립트 — filesArchive* 키 자체가 없다
    expect(probeBackupStatus(dir, 'filesArchive').observable).toBe(false);
  });

  it('알 수 없는 상태값은 위반 1(백업에 파일이 있다고 말하지 않는다)', () => {
    put(fa({ filesArchiveStatus: 'WHATEVER' }));
    expect(probeBackupStatus(dir, 'filesArchive')).toMatchObject({ observable: true, value: 1 });
  });

  it('🔴 이중 경보 없음 — 파일 사본·파일 검증 실패는 기존 두 항목이 센다(스크립트가 copyStatus·lastRestoreVerifyStatus 로 올린다)', () => {
    put(fa({ filesCopyStatus: 'FAILED', copyStatus: 'FAILED', lastFilesVerifyStatus: 'FAIL', lastRestoreVerifyStatus: 'FAIL' }));
    expect(probeBackupStatus(dir, 'filesArchive').value).toBe(0);
    expect(probeBackupStatus(dir, 'secondCopy', { now: NOW }).value).toBe(1);
    expect(probeBackupStatus(dir, 'restoreVerify', { now: NOW }).value).toBe(1);
  });
});

describe('등록부·스윕 배선 — 새 항목이 "프로브 미구현"으로 떨어지지 않는다', () => {
  it('세 항목이 등록돼 있고 백업 디렉터리를 정기 백업 항목과 같이 본다', () => {
    const backup = PIPE_CHECKS.find((c) => c.key === 'pipe.backup')!;
    for (const k of ['pipe.backup.secondCopy', 'pipe.backup.restoreVerify', 'pipe.backup.filesArchive']) {
      const c = PIPE_CHECKS.find((x) => x.key === k);
      expect(c, `${k} 미등록`).toBeTruthy();
      expect(c!.target).toBe(backup.target);
    }
  });

  it('스윕이 새 항목을 자기 프로브로 판정한다(기본 분기 "구현되지 않았습니다"가 아니다)', async () => {
    const findings = new Map<string, Record<string, unknown>>();
    const prisma = {
      sentinelRun: { create: async () => ({ id: 'r1' }), update: async () => ({}) },
      sentinelFinding: {
        findUnique: async ({ where }: { where: { axis_checkKey: { axis: string; checkKey: string } } }) =>
          findings.get(where.axis_checkKey.checkKey) ?? null,
        upsert: async ({ where, create, update }: { where: { axis_checkKey: { checkKey: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          const cur = findings.get(where.axis_checkKey.checkKey);
          findings.set(where.axis_checkKey.checkKey, cur ? { ...cur, ...update } : { ...create });
          return {};
        },
        findMany: async () => [...findings.values()],
      },
    };
    await new SentinelService(prisma as never).sweepPipe(join(process.cwd(), '..', '..'), {
      cron: null, publicSite: null, expectedCrons: 1,
    });
    for (const k of ['pipe.backup.secondCopy', 'pipe.backup.restoreVerify', 'pipe.backup.filesArchive']) {
      const row = findings.get(k)!;
      expect(row, `${k} 원장 없음`).toBeTruthy();
      expect(String(row.detail)).not.toMatch(/구현되지 않았습니다/);
      // 로컬엔 운영 백업 디렉터리가 없다 — 관측 불가여야 하고 해결됨이 아니어야 한다
      expect(row.unobservable).toBe(true);
      expect(row.resolvedAt).toBeNull();
    }
  });
});
