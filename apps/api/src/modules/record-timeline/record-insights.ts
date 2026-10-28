/**
 * 의미찾기 — 시간순 목록을 **의미 단위로 재배치**하는 순수 로직.
 *
 * 시계열은 "언제 무엇이 있었나"에 답하지만, 진료 중 실제 질문은 대개 다르다:
 *   "지금 확인해야 할 게 있나" · "진단이 어떻게 바뀌었나" · "약이 언제 어떻게 달라졌나"
 *   "이 수치가 좋아지고 있나" · "마무리 안 된 게 있나" · "이번 입원에서 무슨 일이 있었나"
 * 각 질문에 답하는 묶음을 만들고, **왜 묶였는지**를 한 문장으로 함께 낸다.
 *
 * 원칙:
 *  - 없는 정보를 만들지 않는다(추정·예측 금지). 근거는 전부 기록에서 뽑은 값이다.
 *  - 묶을 근거가 부족하면 **그 묶음을 만들지 않는다**(빈 카드를 남기지 않음).
 *  - 판단은 의료진이 한다 — 여기서는 '무엇을 함께 봐야 하는가'까지만.
 *
 * 🔴 표시 문장(2026-09-15 I3): `*Msg`(키+값 · shared `ServerMessage`)가 정본이고 `label`·`detail`·`note`·`title`·`hint` 는
 *    그 한국어 파생이다(`renderServerMessageKo` — 템플릿 조립이 아니다). 화면 `<ServerText>` 가 카탈로그로 조립한다.
 *    ATTENTION 항목의 `label`·`detail` 은 이슈 정본(record-issues — 임상 안전 문구·AI 요약 재료 겸용)을 그대로 옮기므로 `*Msg` 가 없다.
 */
import { serverMsg, renderServerMessageKo, type ServerMessage } from '@hospital-run/shared';

export interface InsightItemRef {
  type: string;
  id: string;
  at: string;
  label: string;          // 화면 표시용 한 줄(labelMsg 의 한국어 파생 — 없으면 원문)
  detail?: string;        // 보조 설명(값·변화 등)
  labelMsg?: ServerMessage;
  detailMsg?: ServerMessage;
  level?: 'ALERT' | 'WARN' | 'NONE';
}

export interface InsightGroup {
  key: 'ATTENTION' | 'DIAGNOSIS' | 'MEDICATION' | 'TREND' | 'PENDING' | 'EPISODE';
  title: string;
  titleMsg: ServerMessage;
  /** 왜 이 묶음인가(고정 문구) */
  hint: string;
  hintMsg: ServerMessage;
  /** 이 환자 데이터에서 실제로 무엇이 근거였는지(동적) */
  note?: string;
  noteMsg?: ServerMessage;
  level: 'ALERT' | 'INFO';
  items: InsightItemRef[];
}

export interface RawItem {
  type: string;
  id: string;
  at: string | Date;
  title?: string | null;
  status?: string | null;
  code?: string | null;
  rxType?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  duration?: number | null;
  verifiedAt?: string | Date | null;
  reportedAt?: string | Date | null;
  admissionId?: string | null;
  subType?: string | null;
  diagnoses?: { code?: string | null; name?: string | null }[];
  results?: { name: string; value: string; unit?: string; flag?: string | null }[];
}

export interface IssueLike {
  level: 'CRITICAL' | 'WARN' | 'INFO';
  at: string;
  category: string;
  label: string;
  value?: string;
  why: string;
  source?: { type: string; id: string };
}

const ko = renderServerMessageKo;
/** 묶음 머리 — 제목·힌트·근거 문장을 정본 메시지에서 파생 */
const head = (titleMsg: ServerMessage, hintMsg: ServerMessage, noteMsg: ServerMessage) => ({
  title: ko(titleMsg), titleMsg, hint: ko(hintMsg), hintMsg, note: ko(noteMsg), noteMsg,
});
/** 항목 문장 — label/detail 은 메시지의 한국어 파생 */
const text = (labelMsg: ServerMessage, detailMsg?: ServerMessage) => ({
  label: ko(labelMsg), labelMsg,
  ...(detailMsg ? { detail: ko(detailMsg), detailMsg } : {}),
});
/** 기록 제목이 없을 때의 낱말 — 값이 아니라 조각 키로 옮긴다 */
const orWord = (v: string | null | undefined, word: string) => (v ? v : { k: word });

const iso = (v: string | Date) => (typeof v === 'string' ? v : v.toISOString());
const day = (v: string | Date) => iso(v).slice(0, 10);
const asc = (a: RawItem, b: RawItem) => new Date(a.at).getTime() - new Date(b.at).getTime();
const num = (v: string) => {
  const cleaned = String(v).replace(/[^0-9.\-]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};
/** 약품 동일성 — 코드 우선, 없으면 상품명(성분·규격 괄호 제거) */
const drugKey = (i: RawItem) => (i.code || (i.title ?? '').replace(/[(_].*$/, '').trim() || i.id).toUpperCase();

/** ① 확인 필요 — 이슈(위급·이상치)를 원본 기록에 붙여 모은다 */
function attentionGroup(issues: IssueLike[]): InsightGroup | null {
  const picked = issues.filter((i) => i.level === 'CRITICAL' || i.level === 'WARN');
  if (!picked.length) return null;
  const critical = picked.filter((i) => i.level === 'CRITICAL').length;
  return {
    key: 'ATTENTION',
    ...head(
      { k: '확인 필요' },
      { k: '위급 역치 도달·참고범위 이탈·미확인 위급값을 한곳에 모았습니다.' },
      critical ? serverMsg('위급 {건수}건 포함', { 건수: critical }) : serverMsg('주의 {건수}건', { 건수: picked.length }),
    ),
    level: critical ? 'ALERT' : 'INFO',
    items: picked.map((i) => ({
      type: i.source?.type ?? i.category,
      id: i.source?.id ?? `${i.category}-${i.at}-${i.label}`,
      at: i.at,
      label: `${i.label}${i.value ? ` ${i.value}` : ''}`,
      detail: i.why,
      level: i.level === 'CRITICAL' ? 'ALERT' : 'WARN',
    })),
  };
}

/** ② 진단 경과 — 진단별 최초/최근 등장과 등장 횟수(진단이 언제 붙었고 계속 따라오는가) */
function diagnosisGroup(items: RawItem[]): InsightGroup | null {
  const seen = new Map<string, { name: string; first: string; last: string; n: number; encId: string }>();
  for (const it of items.slice().sort(asc)) {
    if (it.type !== 'ENCOUNTER' || !it.diagnoses?.length) continue;
    for (const d of it.diagnoses) {
      const key = (d.code ?? d.name ?? '').trim();
      if (!key) continue;
      const cur = seen.get(key);
      const label = `${d.name ?? ''}${d.code ? `(${d.code})` : ''}`.trim();
      if (!cur) seen.set(key, { name: label, first: iso(it.at), last: iso(it.at), n: 1, encId: it.id });
      else { cur.last = iso(it.at); cur.n += 1; }
    }
  }
  if (!seen.size) return null;
  const rows = [...seen.values()].sort((a, b) => new Date(a.first).getTime() - new Date(b.first).getTime());
  return {
    key: 'DIAGNOSIS',
    ...head(
      { k: '진단 경과' },
      { k: '진단이 처음 붙은 시점과 이후 반복 여부 — 새로 생긴 문제와 계속 따라다니는 문제를 가릅니다.' },
      serverMsg('{진단수}개 진단 · 최초 {날짜}', { 진단수: rows.length, 날짜: day(rows[0].first) }),
    ),
    level: 'INFO',
    items: rows.map((r) => ({
      type: 'ENCOUNTER',
      id: r.encId,
      at: r.first,
      // 진단명은 기록 값(코드 마스터 표기) — 문장이 아니다
      label: r.name,
      ...(() => {
        const detailMsg = r.n > 1
          ? serverMsg('최초 {최초} · 최근 {최근} · {횟수}회 기재', { 최초: day(r.first), 최근: day(r.last), 횟수: r.n })
          : serverMsg('{날짜} 1회 기재', { 날짜: day(r.first) });
        return { detail: ko(detailMsg), detailMsg };
      })(),
      level: 'NONE',
    })),
  };
}

/** ③ 약물 변화 — 시작·용량 변경·중단(마지막 처방 이후 재처방 없음)만 뽑는다(반복 처방은 소음) */
function medicationGroup(items: RawItem[], now: Date): InsightGroup | null {
  const meds = items.filter((i) => i.type === 'PRESCRIPTION' && (i.rxType === 'MEDICATION' || !i.rxType)).sort(asc);
  if (!meds.length) return null;
  const byDrug = new Map<string, RawItem[]>();
  for (const m of meds) {
    const k = drugKey(m);
    byDrug.set(k, [...(byDrug.get(k) ?? []), m]);
  }
  const out: InsightItemRef[] = [];
  for (const [, list] of byDrug) {
    const name = orWord((list[0].title ?? '').replace(/[(_].*$/, '').trim(), '약품');
    out.push({
      type: 'PRESCRIPTION', id: list[0].id, at: iso(list[0].at),
      // detail 은 날짜·용량 값뿐이라 번역할 문장이 없다
      ...text(serverMsg('{약품} 시작', { 약품: name })), detail: [day(list[0].at), list[0].dosage].filter(Boolean).join(' · '), level: 'NONE',
    });
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1], cur = list[i];
      if ((cur.dosage ?? '') !== (prev.dosage ?? '') && cur.dosage) {
        out.push({
          type: 'PRESCRIPTION', id: cur.id, at: iso(cur.at),
          ...text(
            serverMsg('{약품} 용량 변경', { 약품: name }),
            serverMsg('{from} → {to} ({date})', { from: orWord(prev.dosage, '기재 없음'), to: cur.dosage, date: day(cur.at) }),
          ),
          level: 'WARN',
        });
      }
    }
    // 중단 판정 — 마지막 처방의 투약기간이 끝난 뒤 재처방이 없다(기간 미기재는 판정하지 않는다)
    const last = list[list.length - 1];
    if (last.duration && last.status !== 'CANCELLED') {
      const end = new Date(new Date(last.at).getTime() + last.duration * 86400000);
      if (end.getTime() < now.getTime()) {
        out.push({
          type: 'PRESCRIPTION', id: last.id, at: end.toISOString(),
          ...text(
            serverMsg('{약품} 투약기간 종료', { 약품: name }),
            serverMsg('{처방일} 처방 {일수}일분 · {종료일} 이후 재처방 없음', { 처방일: day(last.at), 일수: last.duration, 종료일: day(end) }),
          ),
          level: 'WARN',
        });
      }
    }
  }
  if (!out.length) return null;
  out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return {
    key: 'MEDICATION',
    ...head(
      { k: '약물 변화' },
      { k: '시작·용량 변경·투약기간 종료만 남겼습니다 — 같은 약의 반복 처방은 변화가 아닙니다.' },
      serverMsg('약품 {종수}종 · 변화 {건수}건', { 종수: byDrug.size, 건수: out.length }),
    ),
    level: 'INFO',
    items: out,
  };
}

/** ④ 수치 추세 — 같은 검사 3회 이상일 때만 방향을 말한다(2점으로는 추세가 아니다) */
function trendGroup(items: RawItem[]): InsightGroup | null {
  const series = new Map<string, { at: string; v: number; unit?: string; id: string }[]>();
  for (const it of items.slice().sort(asc)) {
    if (it.type !== 'LAB') continue;
    for (const r of it.results ?? []) {
      const v = num(r.value);
      if (v === null) continue;
      const k = r.name.trim().toUpperCase();
      series.set(k, [...(series.get(k) ?? []), { at: iso(it.at), v, unit: r.unit, id: it.id }]);
    }
  }
  const out: InsightItemRef[] = [];
  for (const [name, pts] of series) {
    if (pts.length < 3) continue;
    const first = pts[0], last = pts[pts.length - 1];
    const delta = Math.round((last.v - first.v) * 100) / 100;
    const pct = first.v !== 0 ? Math.abs(delta / first.v) : 0;
    // 임계 10% — 실데이터에서 Creatinine 0.9→1.0(11%)처럼 작은 분석물의 미세 변동이
    // '상승'으로 불리면 잡음이 된다. 방향을 말하려면 그만한 크기가 있어야 한다.
    const dir = pct < 0.10 ? 'FLAT' : delta > 0 ? 'UP' : 'DOWN';
    const labelMsg = dir === 'FLAT' ? serverMsg('{검사} 유지', { 검사: name })
      : dir === 'UP' ? serverMsg('{검사} 상승', { 검사: name }) : serverMsg('{검사} 하락', { 검사: name });
    const series = { 처음: first.v, 처음일: day(first.at), 최근: last.v, 최근일: day(last.at), 단위: last.unit ? ` ${last.unit}` : '' };
    out.push({
      type: 'LAB', id: last.id, at: last.at,
      ...text(labelMsg, dir === 'FLAT'
        ? serverMsg('{횟수}회 · {처음} ({처음일}) → {최근} ({최근일}){단위}', { 횟수: pts.length, ...series })
        : serverMsg('{횟수}회 · {처음} ({처음일}) → {최근} ({최근일}){단위} · {변화}', { 횟수: pts.length, ...series, 변화: `${delta > 0 ? '+' : ''}${delta}` })),
      level: 'NONE',
    });
  }
  if (!out.length) return null;
  return {
    key: 'TREND',
    ...head(
      { k: '수치 추세' },
      { k: '같은 검사가 3회 이상 있을 때만 방향을 표시합니다(2회는 추세로 보지 않습니다).' },
      serverMsg('{항목수}개 항목', { 항목수: out.length }),
    ),
    level: 'INFO',
    items: out.sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** ⑤ 마무리 안 된 것 — 미서명 기록·미확정 검사·미판독 영상 */
function pendingGroup(items: RawItem[]): InsightGroup | null {
  const out: InsightItemRef[] = [];
  for (const it of items) {
    if (it.status === 'DRAFT') {
      out.push({ type: it.type, id: it.id, at: iso(it.at), ...text(serverMsg('{제목} 미서명', { 제목: orWord(it.title, '기록') }), serverMsg('{날짜} 작성 · 서명 전', { 날짜: day(it.at) })), level: 'WARN' });
    } else if (it.type === 'LAB' && !it.verifiedAt) {
      out.push({ type: it.type, id: it.id, at: iso(it.at), ...text(serverMsg('{제목} 확정 전', { 제목: orWord(it.title, '검사') }), serverMsg('{날짜} 접수 · 결과 확정(검증) 전', { 날짜: day(it.at) })), level: 'WARN' });
    } else if (it.type === 'IMAGING' && !it.reportedAt) {
      out.push({ type: it.type, id: it.id, at: iso(it.at), ...text(serverMsg('{제목} 판독 전', { 제목: orWord(it.title, '영상') }), serverMsg('{날짜} 촬영 · 판독보고 전', { 날짜: day(it.at) })), level: 'WARN' });
    }
  }
  if (!out.length) return null;
  out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return {
    key: 'PENDING',
    ...head(
      { k: '마무리 안 된 것' },
      { k: '서명·확정·판독이 남은 기록입니다 — 폐루프가 열려 있으면 후속 조치가 지연됩니다.' },
      serverMsg('{건수}건', { 건수: out.length }),
    ),
    level: out.length ? 'ALERT' : 'INFO',
    items: out,
  };
}

/** ⑥ 입원·수술 에피소드 — 사건 하나에 그 기간의 기록 수를 붙인다 */
function episodeGroup(items: RawItem[]): InsightGroup | null {
  const admissions = items.filter((i) => i.type === 'ADMISSION').sort(asc);
  const surgeries = items.filter((i) => i.type === 'SURGERY').sort(asc);
  if (!admissions.length && !surgeries.length) return null;
  const out: InsightItemRef[] = [];
  // 입원은 입원/퇴원 2점으로 오므로 admissionId 로 묶어 한 줄로
  const byAdm = new Map<string, RawItem[]>();
  for (const a of admissions) byAdm.set(a.admissionId ?? a.id, [...(byAdm.get(a.admissionId ?? a.id) ?? []), a]);
  for (const [admId, pts] of byAdm) {
    const inAt = pts.find((p) => p.subType !== 'DISCHARGE') ?? pts[0];
    const outAt = pts.find((p) => p.subType === 'DISCHARGE');
    const within = items.filter((i) => i.admissionId === admId && i.type !== 'ADMISSION').length;
    out.push({
      type: 'ADMISSION', id: inAt.id, at: iso(inAt.at),
      ...text(
        outAt ? { k: '입원 에피소드' } : { k: '재원 중' },
        outAt
          ? (within ? serverMsg('{입원일} ~ {퇴원일} · 기간 내 기록 {건수}건', { 입원일: day(inAt.at), 퇴원일: day(outAt.at), 건수: within })
            : serverMsg('{from} ~ {to}', { from: day(inAt.at), to: day(outAt.at) }))
          : (within ? serverMsg('{입원일} ~ (재원) · 기간 내 기록 {건수}건', { 입원일: day(inAt.at), 건수: within })
            : serverMsg('{입원일} ~ (재원)', { 입원일: day(inAt.at) })),
      ),
      level: 'NONE',
    });
  }
  for (const s of surgeries) {
    out.push({ type: 'SURGERY', id: s.id, at: iso(s.at), ...(s.title ? { label: s.title } : text({ k: '수술' })), detail: day(s.at), level: 'NONE' });
  }
  out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return {
    key: 'EPISODE',
    ...head(
      { k: '입원·수술 에피소드' },
      { k: '사건 단위로 묶었습니다 — 그 기간에 무슨 기록이 얼마나 쌓였는지 함께 봅니다.' },
      serverMsg('{건수}건', { 건수: out.length }),
    ),
    level: 'INFO',
    items: out,
  };
}

/**
 * 의미 묶음 생성 — 근거가 없는 묶음은 만들지 않는다(빈 카드 금지).
 * 순서는 임상 우선순위: 확인 필요 → 마무리 안 된 것 → 진단 → 약물 → 추세 → 에피소드.
 */
export function buildInsights(items: RawItem[], issues: IssueLike[] = [], now: Date = new Date()): InsightGroup[] {
  const groups = [
    attentionGroup(issues),
    pendingGroup(items),
    diagnosisGroup(items),
    medicationGroup(items, now),
    trendGroup(items),
    episodeGroup(items),
  ];
  return groups.filter((g): g is InsightGroup => !!g);
}
