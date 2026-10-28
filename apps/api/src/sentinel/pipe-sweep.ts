import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EVENT_CONSUMED_ELSEWHERE, EVENT_BROADCAST_ONLY, BACKUP_STATUS_FILE } from './pipe-registry';

/**
 * 축 D 프로브들 — **순수 함수**로 둔다(테스트가 실제 반환 모양을 그대로 쓸 수 있게).
 *
 * 🔴 공통 규약: 관측할 수 없으면 `observable: false` 와 사유를 낸다.
 *    "0건"으로 접으면 이 감시자가 잡으려는 결함(근거 없이 안심시킴)을 스스로 저지른다.
 */

export interface ProbeResult {
  /** 관측했는가. false 면 value 를 믿지 않는다 */
  observable: boolean;
  /** 위반 건수(관측했을 때만 의미 있다) */
  value: number;
  /** 사람에게 보여줄 한 줄 — 왜 이 값인지 */
  detail: string;
}

/** 관측 불가를 만드는 유일한 생성자 — 사유 없는 미관측을 만들지 못하게 한다 */
export function unobservable(detail: string): ProbeResult {
  return { observable: false, value: 0, detail };
}

/**
 * 파일 신선도 — 디렉터리에서 가장 최근 파일의 나이를 본다.
 *
 * 🔴 디렉터리가 없거나 비었으면 **위반 0 이 아니라 관측 불가**다.
 *    경로가 틀렸을 때 "백업 정상"이라고 말하는 것이 이 축에서 가장 위험한 거짓말이다.
 */
export function probeFileAge(
  dir: string,
  maxAgeHours: number,
  opts: { pattern?: RegExp; now?: Date } = {},
): ProbeResult {
  const now = opts.now ?? new Date();
  if (!existsSync(dir)) return unobservable(`경로가 없습니다: ${dir} — 백업 상태를 확인하지 못했습니다`);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    return unobservable(`디렉터리를 읽지 못했습니다: ${e instanceof Error ? e.message : e}`);
  }
  const pat = opts.pattern ?? /\.(sql|gz|gpg|tar)$/i;
  const files = names.filter((n) => pat.test(n));
  if (files.length === 0) return unobservable(`대상 파일이 없습니다(${dir}) — 백업이 한 번도 없었는지 경로가 바뀐 것인지 알 수 없습니다`);

  let newest = 0;
  let newestName = '';
  for (const n of files) {
    try {
      const t = statSync(join(dir, n)).mtimeMs;
      if (t > newest) { newest = t; newestName = n; }
    } catch { /* 개별 파일 실패는 건너뛴다 — 전체 판정을 막지 않는다 */ }
  }
  if (!newest) return unobservable(`파일 시각을 읽지 못했습니다(${dir})`);

  const ageMs = now.getTime() - newest;
  const over = ageMs > maxAgeHours * 3_600_000;
  // 🔴 사유 문구의 나이는 **정수 시간**으로 쓴다. 소수 자릿수를 여기서 만들면 수치 표시 정본
  //    (shared NUMERIC_POLICIES)을 우회하는 자리가 되고, 백업 나이는 시간 단위로 충분하다.
  const ageH = Math.floor(ageMs / 3_600_000);
  return {
    observable: true,
    value: over ? 1 : 0,
    detail: over
      ? `가장 최근 파일이 ${ageH}시간 전입니다(기준 ${maxAgeHours}시간) — ${newestName}`
      : `가장 최근 파일 ${ageH}시간 전 — ${newestName}`,
  };
}

export interface CronSnapshot {
  processStartedAt: string;
  jobs: { name: string; schedule: string | null; active: boolean; lastRunAt: string | null; nextRunAt: string | null }[];
  error: string | null;
}

/**
 * 크론 — **등록됐는가 · 돌고 있는가**.
 *
 * 🔴 `lastRunAt` 으로 죽음을 판정하지 않는다. 그 값은 **프로세스 기동 이후**만 반영하고
 *    이 서버는 배포가 잦아 자주 비어 있다. 기동 직후 "전 크론 미실행"이라 경보하면
 *    거짓 경보가 되고, 거짓 경보는 진짜 경보를 죽인다.
 *    판정은 **active=false**(스케줄러가 안 돌림)와 **등록 수 급감**으로 한다.
 */
export function probeCronInactive(snap: CronSnapshot | null): ProbeResult {
  if (!snap) return unobservable('API 에 닿지 못해 크론 상태를 확인하지 못했습니다');
  if (snap.error) return unobservable(`API 가 크론 목록을 내지 못했습니다: ${snap.error}`);
  const dead = snap.jobs.filter((j) => !j.active);
  return {
    observable: true,
    value: dead.length,
    detail: dead.length
      ? `중지된 잡: ${dead.slice(0, 8).map((j) => j.name).join(', ')}${dead.length > 8 ? ` 외 ${dead.length - 8}` : ''}`
      : `등록 ${snap.jobs.length}개 전부 활성`,
  };
}

export function probeCronRegistered(snap: CronSnapshot | null, expected: number): ProbeResult {
  if (!snap) return unobservable('API 에 닿지 못해 크론 등록 수를 확인하지 못했습니다');
  if (snap.error) return unobservable(`API 가 크론 목록을 내지 못했습니다: ${snap.error}`);
  const n = snap.jobs.length;
  const missing = Math.max(0, expected - n);
  return {
    observable: true,
    value: missing,
    detail: missing
      ? `등록 ${n}개 — 기대 ${expected}개보다 ${missing}개 적습니다(모듈 등록 누락 의심)`
      : `등록 ${n}개(기대 ${expected}개 이상)`,
  };
}

/**
 * 발행만 되고 받는 곳이 없는 이벤트 — **저장소 소스**에서 뽑는다.
 *
 * 🔴 리스너 0 이 곧 결함은 아니다. `queue.changed` 처럼 SSE 가 `fromEvent` 로 직접 받는 경우가 있다.
 *    그런 항목은 `EVENT_CONSUMED_ELSEWHERE` 에 **사유와 함께** 선언하고, 선언 없이 빼지 않는다.
 */
export function probeUnconsumedEvents(apiSrcDir: string): ProbeResult & { events: string[]; emitted: string[]; consumed: string[] } {
  if (!existsSync(apiSrcDir)) {
    return { ...unobservable(`소스 경로가 없습니다: ${apiSrcDir}`), events: [], emitted: [], consumed: [] };
  }
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) files.push(p);
    }
  };
  try { walk(apiSrcDir); } catch (e) {
    return { ...unobservable(`소스를 훑지 못했습니다: ${e instanceof Error ? e.message : e}`), events: [], emitted: [], consumed: [] };
  }
  if (files.length < 100) {
    // 🔴 추출이 깨지면 "미소비 0건"으로 조용히 통과한다 — 하한을 못박는다
    return { ...unobservable(`소스 파일이 ${files.length}개뿐입니다 — 훑기가 깨졌습니다`), events: [], emitted: [], consumed: [] };
  }

  /**
   * 🔴 **`.emit(` 을 전부 세면 EventEmitter 가 아닌 것까지 센다**(2026-09-03 운영에서 드러남).
   *    검진권이 `this.billing.emit('redeem', ...)` 로 **ERP 자금흐름 아웃박스**를 부르는데
   *    그것을 이벤트 발행으로 세어, 고아 이벤트가 실제보다 **8개 많게** 보고됐다.
   *    감시자가 틀린 수를 말한 것이다.
   *
   *    수신자 이름을 소스에서 유도한다 — `X: EventEmitter2` 로 주입된 이름만 센다.
   *    (하드코딩하면 새 이름이 생겼을 때 조용히 빠진다)
   */
  const emitterNames = new Set<string>();
  for (const f of files) {
    // 🔴 주석을 먼저 걷어낸다 — 이 파일의 설명 주석(`X: EventEmitter2`)이 이름으로 잡혔다
    //    (스캐너가 자기 주석을 데이터로 읽은 자리)
    const src = readFileSync(f, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*EventEmitter2\b/g)) emitterNames.add(m[1]);
  }
  if (emitterNames.size === 0) {
    return { ...unobservable('EventEmitter2 주입 이름을 하나도 찾지 못했습니다 — 추출이 깨졌습니다'), events: [], emitted: [], consumed: [] };
  }
  /**
   * 🔴 (2026-09-16 F2) 종전 정규식은 **앞의 점**을 요구해(`\.eventEmitter.emit`) `this.x.emit` 만 봤다.
   *    P3 가 치료 완료를 순수 함수(`therapy-completion.ts`)로 뽑으면서 발행이 **주입 속성이 아니라 인자**가 됐고
   *    (`eventEmitter?.emit('therapy.session.completed', …)`), 그 순간 이 스캐너에서 **발행이 사라졌다**.
   *    피해: 발행 집합이 73→72 로 적게 잡혔고, 그런 자리에서만 발행되는 이벤트는 소비자가 없어도
   *    "미소비 0"으로 조용히 통과한다(감시자가 못 보는 사각).
   *    수신자는 `this.`·`a.b.` 같은 접두가 있어도, 아예 없어도(인자·지역 변수) 같은 발행이다.
   *    다만 이름은 여전히 `X: EventEmitter2` 로 주입된 것만 센다 — 2026-09-03 의 `this.billing.emit('redeem')`
   *    (ERP 아웃박스) 오검출을 다시 부르지 않기 위해서다.
   */
  const emitRe = new RegExp(
    `(?:^|[^\\w$])(?:[\\w$]+\\.)*(?:${[...emitterNames].join('|')})\\??\\.emit(?:Async)?\\(\\s*'([^']+)'`,
    'g',
  );

  const emitted = new Set<string>();
  const consumed = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // 주석 속 문자열을 세지 않는다
    for (const m of src.matchAll(emitRe)) emitted.add(m[1]);
    for (const m of src.matchAll(/@OnEvent\(\s*'([^']+)'/g)) consumed.add(m[1]);
    // SSE 가 fromEvent 로 직접 받는 경로도 소비로 센다
    for (const m of src.matchAll(/fromEvent\([^,]+,\s*'([^']+)'/g)) consumed.add(m[1]);
  }
  if (emitted.size === 0) {
    return { ...unobservable('발행 이벤트를 하나도 찾지 못했습니다 — 추출이 깨졌습니다'), events: [], emitted: [], consumed: [] };
  }

  // 🔴 선언된 것만 뺀다 — 선언에는 **왜 괜찮은지**(어디에 남는지)가 들어 있고 가드가 그것을 요구한다
  const orphan = [...emitted]
    .filter((e) => !consumed.has(e) && !EVENT_CONSUMED_ELSEWHERE[e] && !EVENT_BROADCAST_ONLY[e])
    .sort();
  return {
    observable: true,
    value: orphan.length,
    detail: orphan.length
      ? `발행 ${emitted.size} · 소비 ${consumed.size} · 받는 곳 없음 ${orphan.length}: ${orphan.slice(0, 6).join(', ')}${orphan.length > 6 ? ' 외' : ''}`
      // 🔴 "전부 소비됨"이라 말하지 않는다 — 선언으로 제외한 것이 몇 개인지 함께 밝힌다
      : `발행 ${emitted.size} · 소비 ${consumed.size} · 미소비 0`
        + `(다른 경로 소비 ${Object.keys(EVENT_CONSUMED_ELSEWHERE).length} · 원장에만 남는 방송 ${Object.keys(EVENT_BROADCAST_ONLY).length} 제외)`,
    events: orphan,
    // 🔴 선언(EVENT_*)이 실재하는 이벤트를 가리키는지 가드가 대조할 수 있게 함께 낸다 —
    //    죽은 선언은 진짜 미배선을 숨긴다
    emitted: [...emitted].sort(),
    // 🔴 반대 방향(구독하는데 발행 0 = 죽은 리스너)을 가드가 볼 수 있게 함께 낸다
    consumed: [...consumed].sort(),
  };
}

/** 공개 사이트 최신성 — API 정본(`homepageLiveFreshness`)의 반환을 그대로 판정한다 */
export function probePublicSite(live: { checked: boolean; fresh: boolean | null; detail: string } | null): ProbeResult {
  if (!live) return unobservable('API 에 닿지 못해 공개 사이트 최신성을 확인하지 못했습니다');
  // 🔴 조회 실패는 '낡음'이 아니다 — 정본이 checked:false 로 그 사실을 준다
  if (!live.checked) return unobservable(live.detail);
  return { observable: true, value: live.fresh ? 0 : 1, detail: live.detail };
}

export function repoApiSrc(repoRoot: string): string {
  return resolve(repoRoot, 'apps/api/src');
}

/**
 * 백업 상태 파일(`backup-status.json` — `infra/scripts/backup-copy.sh`·`backup-verify.sh` 가 쓴다)로
 * **2차 사본**과 **복원 검증 기록**, **파일 저장소 아카이브**(`filesArchiveStatus` — `lib/backup-files.sh` meta 를 사본 스크립트가 옮긴다)를 본다(상용 릴리즈 T10-5).
 *
 * 🔴 상태 파일이 없거나 읽지 못하면 **관측 불가**다 — "사본 문제 0건"이 아니다.
 *    사본 스크립트가 한 번도 돌지 않은 서버에서 초록을 그리면, 이 항목이 잡으려는 바로 그 상태를 가린다.
 * 🔴 사본은 **검증 통과 + 다른 장치 + 최신 백업과 같은 sha256** 일 때만 위반 0 이다.
 *    같은 장치의 사본·지난 백업의 사본·모르는 상태는 전부 "2차 사본 없음"으로 센다.
 */
export function probeBackupStatus(
  dir: string,
  kind: 'secondCopy' | 'restoreVerify' | 'filesArchive',
  opts: { now?: Date; maxAgeHours?: number } = {},
): ProbeResult {
  const file = join(dir, BACKUP_STATUS_FILE);
  if (!existsSync(file)) {
    return unobservable('백업 상태 파일(backup-status.json)이 없습니다 — 사본·복원 검증 스크립트가 돈 적이 없거나 경로가 다릅니다. 확인하지 못했습니다');
  }
  let st: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('객체가 아닙니다');
    st = parsed as Record<string, unknown>;
  } catch (e) {
    return unobservable(`백업 상태 파일을 읽지 못했습니다: ${e instanceof Error ? e.message : e}`);
  }
  const str = (k: string): string | null => (typeof st[k] === 'string' ? (st[k] as string) : null);
  const scope = str('backupScope') === 'DB_ONLY' ? ' · 백업 범위는 DB 뿐입니다(업로드 파일 미포함)' : '';

  if (kind === 'filesArchive') {
    // 🔴 이중 경보를 만들지 않는다 — 파일 **사본** 실패(`filesCopyStatus` FAILED)는 backup-copy.sh 가 `copyStatus` FAILED 로 올려
    //    `secondCopy` 가 이미 세고, 파일 **검증** 실패(`lastFilesVerifyStatus` FAIL)는 backup-verify.sh 가 `lastRestoreVerifyStatus` FAIL 로
    //    올려 `restoreVerify` 가 이미 센다. 남는 사각지대는 "아카이브를 만들지 못했다/평문이라 만들지 않았다" 하나다 —
    //    그때 DB 사본은 VERIFIED(초록)이고 복원 검증은 월 1회라, 파일이 백업에서 빠진 사실을 매일 말하는 항목이 없었다.
    //    (검증이 도는 날 `restoreVerify` 도 같은 원인으로 위반이 된다 — 매일 신호가 필요한 쪽을 택했고 겹침은 그날뿐이다.)
    const fa = str('filesArchiveStatus');
    if (fa == null) {
      return unobservable('백업 상태 파일에 파일 아카이브 상태(filesArchiveStatus)가 없습니다 — 파일 단계 이전의 사본 스크립트이거나 서버 스크립트가 동기화되지 않았습니다. 확인하지 못했습니다');
    }
    if (fa === 'ARCHIVED') {
      const n = typeof st.filesArchiveFileCount === 'number' ? st.filesArchiveFileCount : null;
      if (n == null) return unobservable('파일 아카이브는 생성됐다고 기록됐지만 파일 수(filesArchiveFileCount)가 없습니다 — 확인하지 못했습니다');
      return { observable: true, value: 0, detail: `파일 저장소가 최신 백업과 같은 시각의 암호화 아카이브에 담겼습니다(파일 ${n}개 · 생성 직후 목록 수 대조 통과)` };
    }
    // 🔴 경로가 없는 것은 "파일 백업 정상"이 아니라 담을 것이 없다는 사실이다 — 초록으로 그리지 않는다
    if (fa === 'NO_PATHS') return unobservable('파일 저장소 경로가 서버에 없어 아카이브에 담은 파일이 없습니다 — 백업 범위 밖이지 정상 판정이 아닙니다');
    if (fa === 'NOT_RUN') return unobservable('최신 백업의 파일 아카이브 기록(meta)이 없습니다 — 파일 단계가 돌지 않았거나 그 이전 백업입니다. 확인하지 못했습니다');
    if (fa === 'FAILED' || fa === 'NOT_ENCRYPTED') {
      const why = fa === 'FAILED' ? '아카이브 생성 실패' : '패스프레이즈가 없어 평문으로 만들지 않음';
      return { observable: true, value: 1, detail: `파일 저장소가 최신 백업에 없습니다(${why} · ${str('filesArchiveDetail') ?? '사유 미기록'})` };
    }
    return { observable: true, value: 1, detail: '파일 저장소가 최신 백업에 있다고 말할 수 없습니다 — 알 수 없는 파일 아카이브 상태(filesArchiveStatus)입니다' };
  }

  if (kind === 'secondCopy') {
    const status = str('copyStatus');
    if (status == null) return unobservable('백업 상태 파일에 사본 상태(copyStatus)가 없습니다 — 확인하지 못했습니다');
    const backupSha = str('lastBackupSha256');
    const copySha = str('copySha256');
    if (status === 'VERIFIED' && st.copySameDeviceAsSource === false && backupSha && copySha === backupSha) {
      return { observable: true, value: 0, detail: `2차 사본 검증 통과(${str('copyAt') ?? '시각 미상'} · 크기·sha256 일치)${scope}` };
    }
    let why: string;
    if (status === 'NOT_CONFIGURED') why = '2차 사본 없음 — 백업이 원본과 같은 장치에 있습니다(사본 대상 미설정)';
    else if (status === 'REFUSED_PLAINTEXT') why = '2차 사본 없음 — 최신 백업이 암호화되지 않아 복사하지 않았습니다';
    else if (status === 'FAILED') why = `2차 사본 없음 — 복사 또는 검증 실패(${str('copyDetail') ?? '사유 미기록'})`;
    else if (status === 'VERIFIED' && st.copySameDeviceAsSource !== false) why = '2차 사본 없음 — 사본이 원본과 같은 장치에 있습니다(또는 장치를 확인하지 못했습니다)';
    else if (status === 'VERIFIED') why = '2차 사본 없음 — 검증된 사본이 최신 백업의 것이 아닙니다(sha256 불일치)';
    else why = '2차 사본 없음 — 사본 상태를 모릅니다(알 수 없는 copyStatus)';
    return { observable: true, value: 1, detail: `${why}${scope}` };
  }

  // restoreVerify — 🔴 실패한 시도는 이전 통과 시각보다 우선한다(지난달 통과가 오늘 실패를 가리지 않게)
  const at = str('lastRestoreVerifiedAt');
  const vStatus = str('lastRestoreVerifyStatus');
  const level = str('lastRestoreVerifyLevel');
  if (vStatus === 'FAIL') {
    return { observable: true, value: 1, detail: `최근 복원 검증이 실패했습니다(${str('lastRestoreVerifyFile') ?? '파일 미상'} · ${str('lastRestoreVerifyDetail') ?? '사유 미기록'})` };
  }
  if (!at) return { observable: true, value: 1, detail: '복원 검증 기록 없음 — 백업을 열어 본 적이 없습니다' };
  const t = Date.parse(at);
  if (Number.isNaN(t)) return unobservable('복원 검증 시각(lastRestoreVerifiedAt)을 읽지 못했습니다');
  const maxAgeHours = opts.maxAgeHours ?? 24 * 31;
  const ageH = Math.floor(((opts.now ?? new Date()).getTime() - t) / 3_600_000);
  const lv = level === 'RESTORE' ? '실제 복원' : level === 'INTEGRITY' ? '무결성까지(실제 복원 아님)' : '수준 미기록';
  if (ageH > maxAgeHours) {
    return { observable: true, value: 1, detail: `마지막 복원 검증이 ${ageH}시간 전입니다(기준 ${maxAgeHours}시간 · ${lv})` };
  }
  return { observable: true, value: 0, detail: `복원 검증 ${ageH}시간 전 통과(${lv})` };
}

/**
 * 대외 발신 outbox — **적재가 멈췄는가**(idle)와 **나가지 못한 것이 쌓였는가**(stuck).
 *
 * 🔴 (2026-09-16 E4 실측) 운영 outbox 는 2026-08-02 이후 6주간 0행인데 그 사이 청구 73·조제 86건이 생겼다.
 *    `erp.webhookEnabled=true`·활성 웹훅 2개였는데도 그렇다. `enqueue()` 가 실패를 `logger.warn` 하나로
 *    삼키기 때문에, **발신이 죽은 것인지 보낼 것이 없던 것인지 구분할 방법이 없었다.**
 *
 * 🔴 **발신 0 은 그 자체로 위반이 아니다** — 보낼 일이 없는 날도 있다. 그래서
 *    ① 발신 설정이 꺼져 있으면 위반이 아니라 **관측 불가**(끈 것을 죽었다고 말하지 않는다)
 *    ② 켜져 있고 오래 조용하면 AMBER 로 "구분이 필요하다"고만 말한다(원인을 단정하지 않는다).
 */
export interface OutboxSnapshot {
  /** 발신이 켜져 있는가(ERP 수신부 설정 또는 활성 웹훅 구독) */
  enabled: boolean;
  /** 마지막 적재 시각 — 한 행도 없으면 null */
  lastEnqueuedAt: Date | null;
  failed: number;
  /** nextAttemptAt 이 지났는데 아직 PENDING 인 행 */
  overduePending: number;
}

export function probeOutboxIdle(
  snap: OutboxSnapshot | null,
  maxAgeHours: number,
  now: Date = new Date(),
): ProbeResult & { ageHours?: number; lastEnqueuedAt?: Date | null } {
  if (!snap) return unobservable('DB 에 닿지 못해 대외 발신 적재 상태를 확인하지 못했습니다');
  if (!snap.enabled) return unobservable('대외 발신이 꺼져 있습니다(수신부·구독 없음) — 적재가 없는 것이 정상입니다');
  if (!snap.lastEnqueuedAt) {
    return { observable: true, value: 1, detail: '대외 발신 적재 기록이 한 건도 없습니다(발신은 켜져 있습니다)', lastEnqueuedAt: snap.lastEnqueuedAt };
  }
  const ageH = Math.floor((now.getTime() - snap.lastEnqueuedAt.getTime()) / 3_600_000);
  if (ageH > maxAgeHours) {
    // 🔴 문장을 만들지 않는다 — 숫자는 `ageHours`·`value` 로 내려보내고 화면이 조립한다
    //    (서버 조립 한국어는 화면 언어를 바꿔도 한국어로 남는다 · server-composed-display-text 기준선)
    return {
      observable: true,
      value: 1,
      detail: '마지막 적재가 기준보다 오래됐습니다 — 보낼 것이 없었는지 enqueue 가 실패했는지 확인이 필요합니다',
      ageHours: ageH,
      lastEnqueuedAt: snap.lastEnqueuedAt,
    };
  }
  return { observable: true, value: 0, detail: '최근 적재 있음', ageHours: ageH, lastEnqueuedAt: snap.lastEnqueuedAt };
}

export function probeOutboxStuck(snap: OutboxSnapshot | null): ProbeResult & { failed?: number; overduePending?: number } {
  if (!snap) return unobservable('DB 에 닿지 못해 대외 발신 적체를 확인하지 못했습니다');
  const total = snap.failed + snap.overduePending;
  if (total === 0) return { observable: true, value: 0, detail: '나가지 못한 발신 없음', failed: 0, overduePending: 0 };
  return {
    observable: true,
    value: total,
    // 🔴 둘을 합쳐 한 이름으로 부르지 않는다 — FAILED 는 사람이 눌러야 나가고, 지연 PENDING 은 디스패처 쪽 문제다.
    //    수는 필드로 내려보낸다(서버가 한국어 문장을 조립하지 않는다).
    detail: '나가지 못한 대외 발신이 있습니다(최종 실패 · 재시도 기한 경과 대기)',
    failed: snap.failed,
    overduePending: snap.overduePending,
  };
}
