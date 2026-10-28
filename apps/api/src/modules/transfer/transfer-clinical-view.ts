/**
 * 전원 기록 임상 섹션(진단·투약·알레르기)의 **읽기 정본** — 2026-09-15 P11.
 *
 * 🔴 `transfer_records.diagnoses/medications/allergies` 는 쓰는 곳마다 모양이 달랐다.
 *
 *   | 쓰는 곳                         | 진단                                   | 투약                                          | 알레르기               |
 *   |---------------------------------|----------------------------------------|-----------------------------------------------|------------------------|
 *   | 송신 스냅샷 `create()`          | EncounterDiagnosis 행 + `diagnosisCode` | Prescription 행(+`medicationCode` 09-15~)     | Allergy 행(`allergen`) |
 *   | 수신 FHIR `importClinicalData()` | `{code, system, text}`                 | `{text, dosage, status}`                      | `{name, severity}`     |
 *
 *   그런데 **읽는 곳**(전원 상세 화면 · FHIR 번들 생성)은 둘 다 아닌 `{code, name}` 을 가정했다 —
 *   송신 건은 진단 칩이 빈 칸, 수신 건은 코드만, 번들의 Condition/MedicationRequest `text` 는 빈 문자열이었다.
 *
 * 저장 모양은 **바꾸지 않는다**(일어난 사실 소급 금지 — 기존 행 변환 없음). 읽는 쪽이 이 한 곳을 지난다.
 *   - 알려진 모양을 모두 읽는다(송신 행·수신 정규화·과거 `{code,name}`).
 *   - 이름을 어디에서도 찾지 못하면 `null` — 화면은 "원문 없음"을 말하고 **지어내지 않는다**(코드를 이름 자리에 넣지 않는다).
 *   - 섹션 `null`(조회 실패·미보존) 과 `[]`(없음) 을 접지 않는다.
 */

export interface TransferDiagnosisView {
  code: string | null;
  system: string | null;
  nameKo: string | null;
  nameEn: string | null;
}

export interface TransferMedicationView {
  code: string | null;
  nameKo: string | null;
  nameEn: string | null;
  ingredient: string | null;
  dosage: string | null;
  frequency: string | null;
  status: string | null;
}

export interface TransferAllergyView {
  name: string | null;
  severity: string | null;
}

/** 섹션 `null` = 미상(조회 실패·미보존) · `[]` = 없음 */
export interface TransferClinicalView {
  diagnoses: TransferDiagnosisView[] | null;
  medications: TransferMedicationView[] | null;
  allergies: TransferAllergyView[] | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
/** 비어 있지 않은 문자열만 — 공백은 없는 것이다 */
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function toDiagnosisView(raw: unknown): TransferDiagnosisView {
  const r = isObj(raw) ? raw : {};
  const dc = isObj(r.diagnosisCode) ? r.diagnosisCode : {};
  return {
    code: str(dc.code) ?? str(r.code),
    system: str(dc.codeSystem) ?? str(r.system),
    // 송신 행 nameKo → 수신 text → 과거 name
    nameKo: str(dc.nameKo) ?? str(r.text) ?? str(r.name),
    nameEn: str(dc.nameEn),
  };
}

export function toMedicationView(raw: unknown): TransferMedicationView {
  const r = isObj(raw) ? raw : {};
  const mc = isObj(r.medicationCode) ? r.medicationCode : {};
  return {
    code: str(mc.code),
    nameKo: str(mc.nameKo) ?? str(r.text) ?? str(r.name),
    nameEn: str(mc.nameEn),
    ingredient: str(mc.ingredient),
    dosage: str(r.dosage),
    frequency: str(r.frequency),
    status: str(r.status),
  };
}

export function toAllergyView(raw: unknown): TransferAllergyView {
  const r = isObj(raw) ? raw : {};
  return {
    name: str(r.allergen) ?? str(r.name),
    // 수신 건은 criticality 원문(high/low) · 송신 행은 원내 중증도 — 번역해 판정하지 않고 원문 그대로
    severity: str(r.severity) ?? str(r.criticality),
  };
}

/**
 * 송신 스냅샷은 Prescription 을 **유형 구분 없이** 담았다(LAB·IMAGING 오더도 섞인다).
 * 유형이 명시돼 있고 MEDICATION 이 아니면 투약이 아니다 — 유형이 없는 모양(수신·과거)은 그대로 둔다.
 */
function isMedicationRow(raw: unknown): boolean {
  return !(isObj(raw) && typeof raw.type === 'string' && raw.type !== 'MEDICATION');
}

export function toTransferClinicalView(record: {
  diagnoses?: unknown;
  medications?: unknown;
  allergies?: unknown;
}): TransferClinicalView {
  return {
    diagnoses: Array.isArray(record.diagnoses) ? record.diagnoses.map(toDiagnosisView) : null,
    medications: Array.isArray(record.medications)
      ? record.medications.filter(isMedicationRow).map(toMedicationView)
      : null,
    allergies: Array.isArray(record.allergies) ? record.allergies.map(toAllergyView) : null,
  };
}
