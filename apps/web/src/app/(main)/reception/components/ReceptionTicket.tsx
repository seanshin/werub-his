'use client';

import { escapeHtml } from '@/lib/escape-html';
import { kdate } from '@/lib/ui-settings';
import { sanctionedPrint, auditNewWindowPrint } from '@/components/print/PrintGuard';

export interface TicketData {
  queueNumber: number;
  departmentName: string;
  roomName?: string | null;
  visitType: string;
  type: string;
  checkedInAt: string;
  patient?: { familyName?: string; givenName?: string; mrn?: string };
  doctor?: { familyName?: string; givenName?: string };
}

/** 접수증·대기표 — 화면 표시 + 인쇄(별도 창). */
export function ReceptionTicket({ ticket, onClose }: { ticket: TicketData; onClose: () => void }) {
  const patientName = `${ticket.patient?.familyName ?? ''}${ticket.patient?.givenName ?? ''}`;
  const doctorName = ticket.doctor ? `${ticket.doctor.familyName ?? ''}${ticket.doctor.givenName ?? ''}` : '-';
  const checkedIn =kdate(ticket.checkedInAt, 'datetimeShort');
  const visit = ticket.visitType === 'INITIAL' ? '초진' : '재진';
  const kind = ticket.type === 'APPOINTMENT' ? '예약' : '현장접수';

  const print = () => {
    auditNewWindowPrint('reception-ticket'); // 🔴 새 창 인쇄 감사(가드 밖)
    const w = window.open('', '_blank', 'width=380,height=560');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>접수증</title>
      <style>
        body{font-family:-apple-system,'Malgun Gothic',sans-serif;padding:24px;margin:0;color:#111}
        .h{text-align:center;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}
        .h .name{font-size:16px;font-weight:700}
        .h .sub{font-size:11px;color:#666;margin-top:2px}
        .num{text-align:center;margin:18px 0}
        .num .lbl{font-size:12px;color:#666}
        .num .v{font-size:52px;font-weight:800;line-height:1.1}
        table{width:100%;font-size:13px;border-collapse:collapse}
        td{padding:6px 2px;border-bottom:1px solid #eee}
        td.k{color:#666;width:34%}
        .foot{margin-top:16px;font-size:11px;color:#888;text-align:center;line-height:1.5}
      </style></head><body>
      <div class="h"><div class="name">위루비병원</div><div class="sub">WERUBYHOSP · 접수증</div></div>
      <div class="num"><div class="lbl">대기번호</div><div class="v">${escapeHtml(String(ticket.queueNumber ?? ''))}</div></div>
      <table>
        <tr><td class="k">환자</td><td>${escapeHtml(patientName)} ${ticket.patient?.mrn ? `(${escapeHtml(ticket.patient.mrn)})` : ''}</td></tr>
        <tr><td class="k">진료과</td><td>${escapeHtml(ticket.departmentName ?? '')}${ticket.roomName ? ` · ${escapeHtml(ticket.roomName)}` : ''}</td></tr>
        <tr><td class="k">담당의</td><td>${escapeHtml(doctorName)}</td></tr>
        <tr><td class="k">구분</td><td>${escapeHtml(kind)} · ${escapeHtml(visit)}</td></tr>
        <tr><td class="k">접수시각</td><td>${escapeHtml(checkedIn)}</td></tr>
      </table>
      <div class="foot">진료실 앞에서 대기해 주세요.<br/>호출 시 진료실로 입실하시기 바랍니다.</div>
      <script>window.onload=function(){window.print();setTimeout(function(){window.close()},300)}</script>
      </body></html>`);
    w.document.close();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-xs p-5" onClick={(e) => e.stopPropagation()}>
        <div className="text-center border-b border-gray-900 pb-2.5 mb-3">
          <p className="font-bold text-gray-900">위루비병원</p>
          <p className="text-[11px] text-gray-500">WERUBYHOSP · 접수증</p>
        </div>
        <div className="text-center my-4">
          <p className="text-xs text-gray-500">대기번호</p>
          <p className="text-5xl font-extrabold text-blue-600">{ticket.queueNumber}</p>
        </div>
        <table className="w-full text-sm">
          <tbody>
            <tr><td className="text-gray-500 py-1.5 w-1/3">환자</td><td className="py-1.5 font-medium">{patientName} <span className="text-xs text-gray-400">{ticket.patient?.mrn}</span></td></tr>
            <tr><td className="text-gray-500 py-1.5">진료과</td><td className="py-1.5">{ticket.departmentName}{ticket.roomName ? ` · ${ticket.roomName}` : ''}</td></tr>
            <tr><td className="text-gray-500 py-1.5">담당의</td><td className="py-1.5">{doctorName}</td></tr>
            <tr><td className="text-gray-500 py-1.5">구분</td><td className="py-1.5">{kind} · {visit}</td></tr>
            <tr><td className="text-gray-500 py-1.5">접수시각</td><td className="py-1.5">{checkedIn}</td></tr>
          </tbody>
        </table>
        <div className="flex gap-2 mt-4">
          <button onClick={print} className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700">인쇄</button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600">닫기</button>
        </div>
      </div>
    </div>
  );
}
