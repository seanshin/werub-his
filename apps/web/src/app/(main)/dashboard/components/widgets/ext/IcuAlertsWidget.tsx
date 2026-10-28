'use client';
import RowListWidget, { asArray } from './RowListWidget';
import { RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { T, Tf } from '@/components/ui/i18n-text';

/**
 * ICU NEWS2 경보 — icu/alerts/news2 {patientName, bedNumber, news2Score, riskLevel, missing}
 *
 * 🔴 `news2Score` 는 **null 일 수 있다**(관측 부족 = 산출 불가). 종전 `?? 0` 은 그것을 "0점"이라
 *    말했다 — 0점은 "가장 안정적"이라는 뜻이라 정반대의 사실이 된다.
 *    산출 불가는 점수 대신 '산출 불가'로 적고, 무엇이 없어서 못 냈는지는 서버가 `missing` 으로 준다.
 */
export default function IcuAlertsWidget() {
  return <RowListWidget widgetId="icu-alerts" endpoint="/api/v1/icu/alerts/news2" empty="NEWS2 경보 없음" pick={(d) =>
    asArray(d).map((it: any) => ({
      key: it.admissionId,
      label: it.patientName != null
        ? `${it.bedNumber ?? ''} ${it.patientName}`.trim()
        : <>{it.bedNumber ? `${it.bedNumber} ` : ''}<T k="환자" /></>,
      // 미관측 항목명(`missing`)은 서버가 주는 코드값이라 번역하지 않고 그대로 끼운다.
      // 맨 문구는 어휘 정본 `RATIO_UNAVAILABLE`(='산출 불가') 을 쓴다 — 화면이 손으로 적지 않는다(clinical-ux-rules 동결).
      right: it.news2Score == null
        ? (Array.isArray(it.missing) && it.missing.length
          ? <Tf k="산출 불가 ({항목} 미관측)" params={{ 항목: it.missing.join('·') }} />
          : <T k={RATIO_UNAVAILABLE} />)
        : <Tf k="{점수}점" params={{ 점수: it.news2Score }} />,
      tone: (it.riskLevel === 'HIGH' ? 'rose' : it.riskLevel === 'UNSCORABLE' ? 'gray' : 'amber') as 'rose' | 'amber' | 'gray',
    }))
  } />;
}
