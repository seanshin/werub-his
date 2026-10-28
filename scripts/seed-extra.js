/**
 * seed-extra.js — 대규모 시드 데이터 추가 스크립트
 *
 * 실행: node scripts/seed-extra.js
 * 서버 경로: /home/deploy/hospital-run
 *
 * 추가 대상:
 *   1. LabResult 40건 + LabResultItem 200건+
 *   2. ImagingResult 20건+
 *   3. AnesthesiaRecord 10건 + PacuRecord 10건
 *   4. PurchaseOrder 5건 + PurchaseOrderItem
 *   5. InventoryTransaction 20건
 *   6. WaitingQueue 오늘 10건
 *   7. Appointment 오늘 15건
 */

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const p = new PrismaClient();

// ── 유틸 ──

function uuid() {
  return crypto.randomUUID();
}

/** 최근 N일 이내 랜덤 날짜 */
function recentDate(withinDays = 30) {
  const now = Date.now();
  const offset = Math.floor(Math.random() * withinDays * 24 * 60 * 60 * 1000);
  return new Date(now - offset);
}

/** 오늘 HH:MM 기준 Date 생성 */
function todayAt(hour, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** 배열에서 랜덤 선택 */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 숫자 랜덤 (min~max) */
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 값에 랜덤 변동 추가 */
function vary(base, pct = 0.3) {
  const num = parseFloat(base);
  if (isNaN(num)) return base;
  const delta = num * pct * (Math.random() * 2 - 1);
  return (num + delta).toFixed(num >= 100 ? 0 : num >= 1 ? 1 : 2);
}

/** flag 판정 */
function calcFlag(value, normalMin, normalMax) {
  const v = parseFloat(value);
  if (isNaN(v) || normalMin === 0 && normalMax === 0) return 'N';
  if (v < normalMin) return 'L';
  if (v > normalMax) return 'H';
  return 'N';
}

// ── 검사 템플릿 ──

const labTests = [
  {
    name: 'CBC', items: [
      { testName: 'WBC', value: '6200', unit: '/uL', normalMin: 4000, normalMax: 10000 },
      { testName: 'RBC', value: '4.5', unit: 'M/uL', normalMin: 4.0, normalMax: 5.5 },
      { testName: 'Hb', value: '14.2', unit: 'g/dL', normalMin: 13.0, normalMax: 17.0 },
      { testName: 'Hct', value: '42', unit: '%', normalMin: 38, normalMax: 50 },
      { testName: 'PLT', value: '245000', unit: '/uL', normalMin: 150000, normalMax: 400000 },
    ],
  },
  {
    name: 'LFT', items: [
      { testName: 'AST', value: '28', unit: 'U/L', normalMin: 0, normalMax: 40 },
      { testName: 'ALT', value: '32', unit: 'U/L', normalMin: 0, normalMax: 40 },
      { testName: 'ALP', value: '75', unit: 'U/L', normalMin: 40, normalMax: 120 },
      { testName: 'GGT', value: '45', unit: 'U/L', normalMin: 0, normalMax: 60 },
      { testName: 'T.Bil', value: '0.8', unit: 'mg/dL', normalMin: 0.2, normalMax: 1.2 },
    ],
  },
  {
    name: 'BMP', items: [
      { testName: 'Glucose', value: '98', unit: 'mg/dL', normalMin: 70, normalMax: 110 },
      { testName: 'BUN', value: '15', unit: 'mg/dL', normalMin: 7, normalMax: 20 },
      { testName: 'Cr', value: '1.0', unit: 'mg/dL', normalMin: 0.7, normalMax: 1.3 },
      { testName: 'Na', value: '140', unit: 'mEq/L', normalMin: 136, normalMax: 145 },
      { testName: 'K', value: '4.2', unit: 'mEq/L', normalMin: 3.5, normalMax: 5.0 },
      { testName: 'Cl', value: '102', unit: 'mEq/L', normalMin: 98, normalMax: 106 },
    ],
  },
  {
    name: 'Lipid', items: [
      { testName: 'T.Chol', value: '195', unit: 'mg/dL', normalMin: 0, normalMax: 200 },
      { testName: 'TG', value: '150', unit: 'mg/dL', normalMin: 0, normalMax: 150 },
      { testName: 'HDL', value: '55', unit: 'mg/dL', normalMin: 40, normalMax: 999 },
      { testName: 'LDL', value: '120', unit: 'mg/dL', normalMin: 0, normalMax: 130 },
    ],
  },
  {
    name: 'HbA1c', items: [
      { testName: 'HbA1c', value: '5.8', unit: '%', normalMin: 4.0, normalMax: 6.0 },
    ],
  },
  {
    name: 'UA', items: [
      { testName: 'pH', value: '6.0', unit: '', normalMin: 4.5, normalMax: 8.0 },
      { testName: 'Protein', value: 'Negative', unit: '', normalMin: 0, normalMax: 0 },
      { testName: 'Glucose(U)', value: 'Negative', unit: '', normalMin: 0, normalMax: 0 },
      { testName: 'RBC(U)', value: '0-2', unit: '/HPF', normalMin: 0, normalMax: 3 },
      { testName: 'WBC(U)', value: '0-1', unit: '/HPF', normalMin: 0, normalMax: 5 },
    ],
  },
  {
    name: 'TFT', items: [
      { testName: 'TSH', value: '2.5', unit: 'mIU/L', normalMin: 0.4, normalMax: 4.0 },
      { testName: 'Free T4', value: '1.2', unit: 'ng/dL', normalMin: 0.8, normalMax: 1.8 },
      { testName: 'Free T3', value: '3.1', unit: 'pg/mL', normalMin: 2.3, normalMax: 4.2 },
    ],
  },
  {
    name: 'Coag', items: [
      { testName: 'PT', value: '12.5', unit: 'sec', normalMin: 11.0, normalMax: 13.5 },
      { testName: 'aPTT', value: '30', unit: 'sec', normalMin: 25, normalMax: 35 },
      { testName: 'INR', value: '1.0', unit: '', normalMin: 0.8, normalMax: 1.2 },
    ],
  },
];

const imagingTests = [
  { modality: 'CT', bodyPart: 'Chest', finding: '폐야 이상 소견 없음. 종격동 림프절 비대 없음.', impression: 'Normal chest CT' },
  { modality: 'CT', bodyPart: 'Abdomen', finding: '간, 담낭, 췌장 정상. 비장 정상 크기.', impression: 'Unremarkable abdomen CT' },
  { modality: 'MR', bodyPart: 'Brain', finding: '뇌실질 이상 없음. 확산강조영상 정상.', impression: 'Normal brain MRI' },
  { modality: 'XR', bodyPart: 'Chest', finding: '심비대 없음. 폐야 깨끗.', impression: 'Normal chest PA' },
  { modality: 'US', bodyPart: 'Abdomen', finding: '간 표면 매끈. 담석 없음. 신장 정상.', impression: 'Normal abdominal US' },
  { modality: 'XR', bodyPart: 'L-spine', finding: '요추 4-5 추간판 간격 좁아짐 의심.', impression: 'L4-5 disc space narrowing' },
  { modality: 'CT', bodyPart: 'Brain', finding: '급성 뇌출혈 소견 없음. 뇌위축 경도.', impression: 'No acute intracranial hemorrhage' },
  { modality: 'MR', bodyPart: 'Knee', finding: '내측 반월판 후각부 파열 의심.', impression: 'Medial meniscus tear, grade 3' },
  { modality: 'US', bodyPart: 'Thyroid', finding: '우측 갑상선 6mm 결절. 양성 소견.', impression: 'Benign-appearing thyroid nodule, right lobe' },
  { modality: 'XR', bodyPart: 'Hand', finding: '골절 소견 없음. 관절 정상.', impression: 'No fracture, normal hand' },
  { modality: 'CT', bodyPart: 'C-spine', finding: '경추 디스크 돌출 소견 없음.', impression: 'Normal cervical spine CT' },
  { modality: 'MR', bodyPart: 'L-spine', finding: 'L5-S1 추간판 탈출증. 경도 신경근 압박.', impression: 'L5-S1 disc herniation with mild nerve root compression' },
];

const anesthesiaTypes = ['GENERAL', 'SPINAL', 'EPIDURAL', 'LOCAL', 'SEDATION'];
const asaClasses = ['ASA-I', 'ASA-II', 'ASA-III'];
const airwayTypes = ['ETT', 'LMA', 'MASK', null];
const dispositions = ['WARD', 'ICU', 'SAME_DAY_DISCHARGE'];

// ── 메인 ──

async function main() {
  console.log('=== 대규모 시드 데이터 추가 시작 ===\n');

  // 기존 데이터 로드
  const patients = await p.patient.findMany({ take: 30, select: { id: true, mrn: true } });
  const doctors = await p.user.findMany({ where: { role: 'DOCTOR' }, take: 15, select: { id: true, department: true } });
  const nurses = await p.user.findMany({ where: { role: 'NURSE' }, take: 10, select: { id: true } });
  const labTechs = await p.user.findMany({ where: { role: 'LAB_TECH' }, take: 5, select: { id: true } });
  const surgeries = await p.surgery.findMany({ take: 15, select: { id: true, patientId: true, anesthetistId: true } });
  const items = await p.inventoryItem.findMany({ take: 20, select: { id: true, name: true, code: true } });
  const suppliers = await p.inventorySupplier.findMany({ take: 5, select: { id: true, name: true } });
  const admins = await p.user.findMany({ where: { role: 'ADMIN' }, take: 3, select: { id: true } });

  // 기존 orderId 사용 (LAB / IMAGING)
  const labOrders = await p.order.findMany({
    where: { department: 'LAB', labResult: null },
    take: 50,
    select: { id: true, prescription: { select: { encounter: { select: { patientId: true, doctorId: true } } } } },
  });
  const imgOrders = await p.order.findMany({
    where: { department: 'IMAGING', imagingResult: null },
    take: 30,
    select: { id: true, prescription: { select: { encounter: { select: { patientId: true, doctorId: true } } } } },
  });

  console.log(`  patients: ${patients.length}, doctors: ${doctors.length}, nurses: ${nurses.length}, labTechs: ${labTechs.length}`);
  console.log(`  surgeries: ${surgeries.length}, items: ${items.length}, suppliers: ${suppliers.length}`);
  console.log(`  labOrders (unused): ${labOrders.length}, imgOrders (unused): ${imgOrders.length}\n`);

  // 기본 최소 검증
  if (patients.length < 5) throw new Error('환자 데이터가 부족합니다 (최소 5명 필요)');
  if (doctors.length < 1) throw new Error('의사 데이터가 부족합니다');

  // 기술자 fallback — LAB_TECH가 없으면 DOCTOR 사용
  const techPool = labTechs.length > 0 ? labTechs : doctors;

  // ─────────────────────────────────────────────
  // 1. LabResult + LabResultItem
  // ─────────────────────────────────────────────
  try {
    console.log('[1/7] LabResult + LabResultItem 생성...');

    let labCreated = 0;
    let itemCreated = 0;

    // (A) 기존 미사용 LAB 오더에 결과 연결
    for (const order of labOrders) {
      const patientId = order.prescription?.encounter?.patientId;
      if (!patientId) continue;

      const template = pick(labTests);
      const resultId = uuid();
      const collectedAt = recentDate(20);

      await p.labResult.create({
        data: {
          id: resultId,
          orderId: order.id,
          patientId,
          technicianId: pick(techPool).id,
          status: 'COMPLETED',
          collectedAt,
          completedAt: new Date(collectedAt.getTime() + rand(30, 180) * 60000),
          notes: `${template.name} 검사 완료`,
        },
      });

      for (const item of template.items) {
        const val = vary(item.value);
        const flag = calcFlag(val, item.normalMin, item.normalMax);
        await p.labResultItem.create({
          data: {
            id: uuid(),
            labResultId: resultId,
            testName: item.testName,
            value: String(val),
            unit: item.unit,
            normalMin: item.normalMin,
            normalMax: item.normalMax,
            flag,
          },
        });
        itemCreated++;
      }
      labCreated++;
    }

    // (B) 오더가 부족하면 새 encounter+prescription+order 체인 생성
    const remaining = Math.max(0, 40 - labCreated);
    if (remaining > 0) {
      console.log(`  기존 LAB 오더 ${labCreated}건 활용, 추가 ${remaining}건 독립 생성...`);
      for (let i = 0; i < remaining; i++) {
        const patient = pick(patients);
        const doctor = pick(doctors);
        const template = pick(labTests);
        const collectedAt = recentDate(25);

        const enc = await p.encounter.create({
          data: {
            id: uuid(),
            patientId: patient.id,
            doctorId: doctor.id,
            visitType: 'OUTPATIENT',
            subjective: `${template.name} 검사 의뢰`,
            status: 'SIGNED',
            signedAt: collectedAt,
            signedBy: doctor.id,
          },
        });

        const presc = await p.prescription.create({
          data: {
            id: uuid(),
            encounterId: enc.id,
            type: 'LAB',
            dosage: template.name,
            frequency: 'ONCE',
            duration: 1,
            status: 'ACTIVE',
            createdBy: doctor.id,
          },
        });

        const ord = await p.order.create({
          data: {
            id: uuid(),
            prescriptionId: presc.id,
            department: 'LAB',
            status: 'COMPLETED',
            completedAt: new Date(collectedAt.getTime() + rand(60, 240) * 60000),
            priority: 'ROUTINE',
          },
        });

        const resultId = uuid();
        await p.labResult.create({
          data: {
            id: resultId,
            orderId: ord.id,
            patientId: patient.id,
            technicianId: pick(techPool).id,
            status: 'COMPLETED',
            collectedAt,
            completedAt: new Date(collectedAt.getTime() + rand(30, 180) * 60000),
            notes: `${template.name} 검사 완료`,
          },
        });

        for (const item of template.items) {
          const val = vary(item.value);
          const flag = calcFlag(val, item.normalMin, item.normalMax);
          await p.labResultItem.create({
            data: {
              id: uuid(),
              labResultId: resultId,
              testName: item.testName,
              value: String(val),
              unit: item.unit,
              normalMin: item.normalMin,
              normalMax: item.normalMax,
              flag,
            },
          });
          itemCreated++;
        }
        labCreated++;
      }
    }

    console.log(`  => LabResult ${labCreated}건, LabResultItem ${itemCreated}건 생성 완료\n`);
  } catch (e) {
    console.error('[1/7] LabResult 생성 실패:', e.message);
  }

  // ─────────────────────────────────────────────
  // 2. ImagingResult
  // ─────────────────────────────────────────────
  try {
    console.log('[2/7] ImagingResult 생성...');

    let imgCreated = 0;

    // (A) 기존 미사용 IMAGING 오더에 결과 연결
    for (const order of imgOrders) {
      const patientId = order.prescription?.encounter?.patientId;
      if (!patientId) continue;

      const template = pick(imagingTests);
      const acq = recentDate(20);

      await p.imagingResult.create({
        data: {
          id: uuid(),
          orderId: order.id,
          patientId,
          radiologistId: pick(doctors).id,
          modality: template.modality,
          bodyPart: template.bodyPart,
          finding: template.finding,
          impression: template.impression,
          status: 'REPORTED',
          acquiredAt: acq,
          reportedAt: new Date(acq.getTime() + rand(30, 360) * 60000),
        },
      });
      imgCreated++;
    }

    // (B) 부족하면 새로 생성
    const remaining = Math.max(0, 22 - imgCreated);
    if (remaining > 0) {
      console.log(`  기존 IMAGING 오더 ${imgCreated}건 활용, 추가 ${remaining}건 독립 생성...`);
      for (let i = 0; i < remaining; i++) {
        const patient = pick(patients);
        const doctor = pick(doctors);
        const template = pick(imagingTests);
        const acq = recentDate(25);

        const enc = await p.encounter.create({
          data: {
            id: uuid(),
            patientId: patient.id,
            doctorId: doctor.id,
            visitType: 'OUTPATIENT',
            subjective: `${template.modality} ${template.bodyPart} 검사 의뢰`,
            status: 'SIGNED',
            signedAt: acq,
            signedBy: doctor.id,
          },
        });

        const presc = await p.prescription.create({
          data: {
            id: uuid(),
            encounterId: enc.id,
            type: 'IMAGING',
            dosage: `${template.modality} ${template.bodyPart}`,
            frequency: 'ONCE',
            duration: 1,
            status: 'ACTIVE',
            createdBy: doctor.id,
          },
        });

        const ord = await p.order.create({
          data: {
            id: uuid(),
            prescriptionId: presc.id,
            department: 'IMAGING',
            status: 'COMPLETED',
            completedAt: new Date(acq.getTime() + rand(60, 360) * 60000),
            priority: 'ROUTINE',
          },
        });

        await p.imagingResult.create({
          data: {
            id: uuid(),
            orderId: ord.id,
            patientId: patient.id,
            radiologistId: pick(doctors).id,
            modality: template.modality,
            bodyPart: template.bodyPart,
            finding: template.finding,
            impression: template.impression,
            status: 'REPORTED',
            acquiredAt: acq,
            reportedAt: new Date(acq.getTime() + rand(30, 360) * 60000),
          },
        });
        imgCreated++;
      }
    }

    console.log(`  => ImagingResult ${imgCreated}건 생성 완료\n`);
  } catch (e) {
    console.error('[2/7] ImagingResult 생성 실패:', e.message);
  }

  // ─────────────────────────────────────────────
  // 3. AnesthesiaRecord + PacuRecord
  // ─────────────────────────────────────────────
  try {
    console.log('[3/7] AnesthesiaRecord + PacuRecord 생성...');

    // 기존 anesthesiaRecord가 없는 surgery 찾기
    const existingAnesthesia = await p.anesthesiaRecord.findMany({ select: { surgeryId: true } });
    const usedSurgeryIds = new Set(existingAnesthesia.map((a) => a.surgeryId));
    const availSurgeries = surgeries.filter((s) => !usedSurgeryIds.has(s.id));

    let anesCreated = 0;
    let pacuCreated = 0;

    for (const surgery of availSurgeries.slice(0, 12)) {
      const anesthetistId = surgery.anesthetistId || pick(doctors).id;
      const nurseId = nurses.length > 0 ? pick(nurses).id : pick(doctors).id;
      const anesType = pick(anesthesiaTypes);
      const inductionTime = recentDate(30);
      const intubTime = new Date(inductionTime.getTime() + rand(3, 10) * 60000);
      const extubTime = new Date(intubTime.getTime() + rand(60, 240) * 60000);

      await p.anesthesiaRecord.create({
        data: {
          id: uuid(),
          surgeryId: surgery.id,
          anesthetistId,
          asaClass: pick(asaClasses),
          anesthesiaType: anesType,
          airwayType: pick(airwayTypes),
          ettSize: anesType === 'GENERAL' ? `${rand(70, 80) / 10}` : null,
          inductionTime,
          intubationTime: anesType === 'GENERAL' ? intubTime : null,
          extubationTime: anesType === 'GENERAL' ? extubTime : null,
          inductionDrugs: [
            { name: 'Propofol', dose: `${rand(150, 250)}mg`, route: 'IV' },
            { name: 'Fentanyl', dose: `${rand(50, 150)}mcg`, route: 'IV' },
          ],
          maintenanceDrugs: [
            { name: 'Sevoflurane', concentration: `${rand(15, 30) / 10}%` },
          ],
          fluidInput: [
            { type: 'Normal Saline', amount: `${rand(500, 2000)}mL` },
          ],
          ebl: rand(50, 500),
          urineOutput: rand(100, 800),
          vitalSigns: [
            { time: '0min', bp: `${rand(110, 140)}/${rand(60, 85)}`, hr: rand(60, 90), spo2: rand(97, 100) },
            { time: '30min', bp: `${rand(100, 130)}/${rand(55, 80)}`, hr: rand(55, 85), spo2: rand(97, 100) },
            { time: '60min', bp: `${rand(105, 135)}/${rand(58, 82)}`, hr: rand(58, 88), spo2: rand(97, 100) },
          ],
          notes: `${anesType} anesthesia — 합병증 없이 종료`,
        },
      });
      anesCreated++;

      // PACU Record
      const arrivalTime = new Date(extubTime.getTime() + rand(5, 15) * 60000);
      await p.pacuRecord.create({
        data: {
          id: uuid(),
          surgeryId: surgery.id,
          patientId: surgery.patientId,
          arrivalTime,
          dischargeTime: new Date(arrivalTime.getTime() + rand(30, 120) * 60000),
          aldretScore: rand(8, 10),
          painScore: rand(1, 5),
          oxygenTherapy: pick(['Nasal cannula 3L', 'Nasal cannula 2L', 'Room air', null]),
          vitalSigns: [
            { time: 'Arrival', bp: `${rand(110, 140)}/${rand(60, 85)}`, hr: rand(60, 90), spo2: rand(96, 100), temp: (rand(364, 374) / 10).toFixed(1) },
            { time: '15min', bp: `${rand(110, 135)}/${rand(60, 80)}`, hr: rand(62, 88), spo2: rand(97, 100), temp: (rand(364, 374) / 10).toFixed(1) },
            { time: '30min', bp: `${rand(115, 135)}/${rand(65, 80)}`, hr: rand(65, 85), spo2: rand(98, 100), temp: (rand(364, 374) / 10).toFixed(1) },
          ],
          interventions: [
            { type: 'IV Fluid', detail: `Normal Saline ${rand(200, 500)}mL` },
            { type: 'Pain Management', detail: pick(['Ketorolac 30mg IV', 'Paracetamol 1g IV', 'Fentanyl 25mcg IV']) },
          ],
          nurseId,
          disposition: pick(dispositions),
          notes: '회복실 경과 양호. 활력징후 안정.',
        },
      });
      pacuCreated++;
    }

    console.log(`  => AnesthesiaRecord ${anesCreated}건, PacuRecord ${pacuCreated}건 생성 완료\n`);
  } catch (e) {
    console.error('[3/7] Anesthesia/PACU 생성 실패:', e.message);
  }

  // ─────────────────────────────────────────────
  // 4. PurchaseOrder + PurchaseOrderItem
  // ─────────────────────────────────────────────
  try {
    console.log('[4/7] PurchaseOrder 생성...');

    if (suppliers.length === 0) {
      console.log('  => 공급자 데이터 없음. 건너뜀.\n');
    } else if (items.length === 0) {
      console.log('  => 재고품목 데이터 없음. 건너뜀.\n');
    } else {
      const existingPOCount = await p.purchaseOrder.count();
      const creatorId = admins.length > 0 ? pick(admins).id : pick(doctors).id;

      const poStatuses = ['DRAFT', 'SUBMITTED', 'APPROVED', 'ORDERED', 'RECEIVED'];

      for (let i = 0; i < 7; i++) {
        const poId = uuid();
        const orderDate = recentDate(20);
        const supplier = pick(suppliers);
        const status = pick(poStatuses);
        const poItems = [];
        const numItems = rand(2, 5);
        let totalAmount = 0;

        // 품목 선택 (중복 방지)
        const selectedItems = [];
        const pool = [...items];
        for (let j = 0; j < Math.min(numItems, pool.length); j++) {
          const idx = rand(0, pool.length - 1);
          selectedItems.push(pool.splice(idx, 1)[0]);
        }

        for (const item of selectedItems) {
          const qty = rand(10, 200);
          const unitPrice = rand(500, 50000);
          const amount = qty * unitPrice;
          totalAmount += amount;
          poItems.push({
            id: uuid(),
            purchaseOrderId: poId,
            itemId: item.id,
            orderedQty: qty,
            receivedQty: status === 'RECEIVED' ? qty : 0,
            unitPrice,
            amount,
          });
        }

        await p.purchaseOrder.create({
          data: {
            id: poId,
            orderNumber: `PO-${String(existingPOCount + i + 1).padStart(5, '0')}`,
            supplierId: supplier.id,
            status,
            orderDate,
            expectedDate: new Date(orderDate.getTime() + rand(3, 14) * 86400000),
            receivedDate: status === 'RECEIVED' ? new Date(orderDate.getTime() + rand(5, 10) * 86400000) : null,
            totalAmount,
            approvedBy: ['APPROVED', 'ORDERED', 'RECEIVED'].includes(status) ? creatorId : null,
            approvedAt: ['APPROVED', 'ORDERED', 'RECEIVED'].includes(status) ? new Date(orderDate.getTime() + 86400000) : null,
            notes: `발주서 #${existingPOCount + i + 1}`,
            createdBy: creatorId,
            items: { createMany: { data: poItems.map(({ purchaseOrderId, ...rest }) => rest) } },
          },
        });
      }

      console.log(`  => PurchaseOrder 7건 생성 완료\n`);
    }
  } catch (e) {
    console.error('[4/7] PurchaseOrder 생성 실패:', e.message);
  }

  // ─────────────────────────────────────────────
  // 5. InventoryTransaction 추가
  // ─────────────────────────────────────────────
  try {
    console.log('[5/7] InventoryTransaction 생성...');

    if (items.length === 0) {
      console.log('  => 재고품목 없음. 건너뜀.\n');
    } else {
      const performerId = admins.length > 0 ? pick(admins).id : pick(doctors).id;
      const txTypes = ['IN', 'OUT', 'ADJUST', 'RETURN', 'ISSUE'];
      const depts = ['내과', '외과', '정형외과', '신경외과', '약제부', '수술실', '응급실', '소아과'];

      for (let i = 0; i < 25; i++) {
        const item = pick(items);
        const txType = pick(txTypes);
        const qty = txType === 'ADJUST' ? rand(-10, 10) : rand(1, 50);
        const unitCost = rand(1000, 30000);

        await p.inventoryTransaction.create({
          data: {
            id: uuid(),
            itemId: item.id,
            type: txType,
            quantity: qty,
            reason: txType === 'IN' ? '정기 입고' : txType === 'OUT' ? '부서 불출' : txType === 'ADJUST' ? '재고 실사 조정' : txType === 'RETURN' ? '불량 반품' : '부서 청구 불출',
            performedBy: performerId,
            unitCost,
            totalCost: Math.abs(qty) * unitCost,
            referenceNumber: `TX-${Date.now()}-${i}`,
            department: pick(depts),
            createdAt: recentDate(15),
          },
        });
      }

      console.log(`  => InventoryTransaction 25건 생성 완료\n`);
    }
  } catch (e) {
    console.error('[5/7] InventoryTransaction 생성 실패:', e.message);
  }

  // ─────────────────────────────────────────────
  // 6. WaitingQueue 오늘 데이터
  // ─────────────────────────────────────────────
  try {
    console.log('[6/7] WaitingQueue (오늘) 생성...');

    const deptRooms = [
      { dept: '내과', room: '내과 1진료실' },
      { dept: '내과', room: '내과 2진료실' },
      { dept: '외과', room: '외과 1진료실' },
      { dept: '정형외과', room: '정형외과 진료실' },
      { dept: '소아과', room: '소아과 진료실' },
      { dept: '산부인과', room: '산부인과 진료실' },
      { dept: '이비인후과', room: '이비인후과 진료실' },
      { dept: '피부과', room: '피부과 진료실' },
      { dept: '안과', room: '안과 진료실' },
      { dept: '신경과', room: '신경과 진료실' },
    ];
    const visitTypes = ['INITIAL', 'FOLLOW_UP'];
    const waitingStatuses = ['WAITING', 'WAITING', 'WAITING', 'CALLED', 'IN_PROGRESS'];

    for (let i = 0; i < 12; i++) {
      const patient = patients[i % patients.length];
      const doctor = doctors[i % doctors.length];
      const dr = pick(deptRooms);
      const status = pick(waitingStatuses);
      const checkedInAt = todayAt(8 + Math.floor(i / 3), rand(0, 59));

      await p.waitingQueue.create({
        data: {
          id: uuid(),
          patientId: patient.id,
          doctorId: doctor.id,
          departmentName: dr.dept,
          roomName: dr.room,
          queueNumber: 100 + i + 1,
          type: i < 3 ? 'APPOINTMENT' : 'WALK_IN',
          visitType: pick(visitTypes),
          reason: pick(['두통', '복통', '기침', '허리통증', '정기검진', '약 처방', '피부 발진', '어지러움']),
          status,
          calledAt: status !== 'WAITING' ? new Date(checkedInAt.getTime() + rand(5, 30) * 60000) : null,
          startedAt: status === 'IN_PROGRESS' ? new Date(checkedInAt.getTime() + rand(10, 40) * 60000) : null,
          waitingToken: `WT-${Date.now()}-${i}`,
          callCount: status !== 'WAITING' ? rand(1, 2) : 0,
          priorityOrder: i + 1,
          checkedInAt,
        },
      });
    }

    console.log(`  => WaitingQueue 12건 (오늘) 생성 완료\n`);
  } catch (e) {
    console.error('[6/7] WaitingQueue 생성 실패:', e.message);
  }

  // ─────────────────────────────────────────────
  // 7. Appointment 오늘 데이터
  // ─────────────────────────────────────────────
  try {
    console.log('[7/7] Appointment (오늘) 생성...');

    const reasons = [
      '정기 검진', '혈액 검사 결과 상담', '약 처방 연장',
      '두통 상담', '허리 통증 재진', '당뇨 경과 관찰',
      '고혈압 약 조정', '피부 발진 초진', '기침 지속 상담',
      '수술 후 경과 관찰', '예방접종', '건강 상담',
      '관절통 재진', '소화불량 초진', '어지러움 검사',
    ];
    const types = ['INITIAL', 'FOLLOW_UP', 'ROUTINE', 'FOLLOW_UP'];
    const statuses = ['SCHEDULED', 'SCHEDULED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'];
    const creatorId = admins.length > 0 ? pick(admins).id : pick(doctors).id;

    for (let i = 0; i < 15; i++) {
      const patient = patients[(i + 10) % patients.length]; // 다른 환자 set 사용
      const doctor = doctors[i % doctors.length];
      const hour = 9 + Math.floor(i / 3);
      const minute = (i % 3) * 20;
      const scheduledAt = todayAt(hour, minute);
      const status = pick(statuses);

      await p.appointment.create({
        data: {
          id: uuid(),
          patientId: patient.id,
          doctorId: doctor.id,
          scheduledAt,
          duration: pick([15, 20, 30]),
          status,
          type: pick(types),
          reason: reasons[i % reasons.length],
          createdBy: creatorId,
        },
      });
    }

    console.log(`  => Appointment 15건 (오늘) 생성 완료\n`);
  } catch (e) {
    console.error('[7/7] Appointment 생성 실패:', e.message);
  }

  // ── 결과 요약 ──
  const counts = await Promise.all([
    p.labResult.count(),
    p.labResultItem.count(),
    p.imagingResult.count(),
    p.anesthesiaRecord.count(),
    p.pacuRecord.count(),
    p.purchaseOrder.count(),
    p.inventoryTransaction.count(),
    p.waitingQueue.count(),
    p.appointment.count(),
  ]);

  console.log('=== 최종 데이터 현황 ===');
  console.log(`  labResult:            ${counts[0]}`);
  console.log(`  labResultItem:        ${counts[1]}`);
  console.log(`  imagingResult:        ${counts[2]}`);
  console.log(`  anesthesiaRecord:     ${counts[3]}`);
  console.log(`  pacuRecord:           ${counts[4]}`);
  console.log(`  purchaseOrder:        ${counts[5]}`);
  console.log(`  inventoryTransaction: ${counts[6]}`);
  console.log(`  waitingQueue:         ${counts[7]}`);
  console.log(`  appointment:          ${counts[8]}`);
  console.log('\n=== 완료 ===');

  await p.$disconnect();
}

main().catch((e) => {
  console.error('치명적 오류:', e);
  p.$disconnect();
  process.exit(1);
});
