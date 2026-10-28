#!/usr/bin/env python3
"""
차트 진료 보조 패널 EP 실측 프로브 — 기획서 docs/01-plan/features/chart-ai-assistant-agent.plan.md §1 의 표를 만든 스크립트.
개선 후 같은 입력으로 다시 재서 표를 갱신한다(지연·source·크기).
사용: HIS_BASE=https://his.example.org HIS_EMAIL=... HIS_PASSWORD=... HIS_PATIENT_ID=<uuid> python3 infra/scripts/probe-chart-ai.py
🔴 운영에 실제 AI 호출을 보낸다(감사 원장에 Ai* 행이 남는다) — 시드 환자로만.
"""
import os
import json, sys, time, urllib.request
BASE=os.environ.get('HIS_BASE','https://his.example.org')
def post(path, body, token=None, timeout=150):
    req=urllib.request.Request(BASE+path, data=json.dumps(body).encode(), headers={'Content-Type':'application/json', **({'Authorization':'Bearer '+token} if token else {})}, method='POST')
    t0=time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: raw=r.read().decode(); status=r.status
    except urllib.error.HTTPError as e: raw=e.read().decode(); status=e.code
    except Exception as e: return time.time()-t0, 'ERR', str(e)[:100]
    return time.time()-t0, status, raw
_,_,raw=post('/api/v1/auth/login',{'email':os.environ.get('HIS_EMAIL','admin@hospital.example.org'),'password':os.environ['HIS_PASSWORD']})
tok=json.loads(raw)['data']['accessToken']
PID=os.environ['HIS_PATIENT_ID']
S='3일 전부터 지속되는 흉통과 호흡곤란. 계단 오를 때 악화.'; O='BP 150/95, HR 102, SpO2 94%'
probes=[
 ('realtime-ddx','/api/v1/ai/realtime-ddx',{'patientId':PID,'subjective':S,'objective':O}),
 ('auto-soap','/api/v1/ai/auto-soap',{'patientId':PID,'subjective':S,'objective':O}),
 ('interpret-lab','/api/v1/ai/interpret-lab',{'patientId':PID,'results':[{'testName':'Hb','value':'9.8','unit':'g/dL','flag':'L'},{'testName':'K','value':'5.9','unit':'mmol/L','flag':'H'}]}),
 ('recommend-drugs','/api/v1/ai/recommend-drugs',{'patientId':PID,'diagnosis':'본태성 고혈압'}),
 ('chart-qa','/api/v1/ai/chart-qa',{'encounterId':os.environ.get('HIS_ENCOUNTER_ID',''),'subjective':S,'objective':O,'assessment':'고혈압','plan':'암로디핀 5mg'}),  # encounterId 없으면 400 — 그것도 실측이다
 ('patient-education','/api/v1/ai/patient-education',{'patientId':PID,'diagnosis':'본태성 고혈압','medications':['암로디핀']}),
 ('clinical-qa','/api/v1/ai/clinical-qa',{'question':'고칼륨혈증 5.9 초기 처치는?','patientId':PID}),
 ('knowledge/search','/api/v1/ai/knowledge/search',{'query':'고혈압 1차 약제'}),
 ('reasoning/chain','/api/v1/ai/reasoning/chain',{'symptoms':['흉통','호흡곤란'],'history':O}),
 ('auto-record','/api/v1/ai/auto-record',{'conversation':'환자: 3일 전부터 가슴이 답답하고 계단 오르면 숨이 차요. 의사: 혈압이 150에 95입니다.'}),
]
KEYS=('source','differentials','answer','assessment','plan','interpretation','recommendations','suggestions','issues','explanation','summary','results','steps','grade','score','soap','text','error','reason','reasonCode','message','items','sections','drugs','recommendation')
# 하이브리드 배치 A 브리핑 · 스킬 계측(읽기 EP)
def get(path, token):
    req=urllib.request.Request(BASE+path, headers={'Authorization':'Bearer '+token})
    t0=time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return time.time()-t0, r.status, r.read().decode()
    except urllib.error.HTTPError as e: return time.time()-t0, e.code, e.read().decode()
for name,path in [('brief', f'/api/v1/ai/brief/{PID}'), ('skill-metrics','/api/v1/ai/skill-metrics?days=7'), ('draft-metrics','/api/v1/ai/draft-metrics?days=30')]:
    dt,st,raw=get(path,tok)
    try: d=json.loads(raw).get('data',{})
    except Exception: print(f'{name:18s} {dt:5.1f}s {st} NON-JSON'); continue
    if name=='brief': print(f"{name:18s} {dt:5.1f}s {st} trigger={d.get('trigger')} cached={d.get('cached')} labs={len(d.get('recentLabs',[]))} abn={d.get('abnormalLabCount')} skills={'labInterpretation' if (d.get('skills') or {}).get('labInterpretation') else None} unavailable={d.get('unavailable')}")
    elif name=='skill-metrics': print(f"{name:18s} {dt:5.1f}s {st} skills={[(x['skill'],x['calls'],x['bySource']) for x in d.get('skills',[])]}")
    else:
        t=d.get('total') or {}
        print(f"{name:18s} {dt:5.1f}s {st} applied={t.get('applied')} outcomes={t.get('outcomes')} unchanged={t.get('unchanged')} median={t.get('medianEditDistance')} byType={[(r['resourceType'],r['applied'],r['outcomes'],r['unchanged']) for r in d.get('byResourceType',[])]}")
for name,path,body in probes:
    dt,st,raw=post(path,body,tok)
    try: d=json.loads(raw); x=d.get('data',d)
    except Exception: print(f'{name:18s} {dt:5.1f}s {st} NON-JSON {raw[:100]}'); continue
    if isinstance(x,dict):
        info={k:(len(v) if isinstance(v,(list,str,dict)) else v) for k,v in x.items() if k in KEYS}
        print(f'{name:18s} {dt:5.1f}s {st} keys={list(x.keys())[:9]} sizes={info}')
    else: print(f'{name:18s} {dt:5.1f}s {st} {type(x).__name__} {str(x)[:120]}')
