/**
 * DB 백업 파일 이름 정본 — 백업 디렉터리 하나에 **성격이 다른 두 백업**이 같이 산다.
 *
 *  - 정기 백업 `hospitalrun_<YYYYmmdd>_<HHMMSS>.sql.gz[.gpg]` — `infra/scripts/backup.sh` · 매일 03:00 · 30일
 *  - 배포 백업 `pre-deploy_<YYYYmmdd>_<HHMMSS>.sql.gz[.gpg]` — `infra/scripts/deploy.sh backup_db` · 배포 때만 · 7일
 *
 * 🔴 **배포 백업은 정기 백업이 아니다.** 판정기가 확장자만 보면 "정기 크론이 죽어도 배포만 하면 통과"한다 —
 *    감시자(`pipe.backup`)가 이 모양으로 한 번 거짓 안심을 말했고(v4.14.0), 배포 백업이 `.gpg` 로 바뀌면서
 *    go-live `security.dbBackup`(`.gpg` 면 아무거나 셌다)이 같은 자리에 섰다(2026-09-11).
 *    그래서 이름 패턴을 판정기마다 적지 않고 여기 하나에 둔다.
 */
export const PERIODIC_BACKUP_PATTERN = /^hospitalrun_\d{8}_\d{6}\.sql\.gz(\.gpg)?$/;

/** 정기 백업이면서 암호화된 것 — go-live BR-2(백업 암호화) 판정은 이것만 센다 */
export function isPeriodicEncryptedBackup(name: string): boolean {
  return PERIODIC_BACKUP_PATTERN.test(name) && name.endsWith('.gpg');
}
