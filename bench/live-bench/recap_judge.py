import json, re, time, os
from concurrent.futures import ThreadPoolExecutor, as_completed
import urllib.request

API = 'https://api.deepseek.com/v1/chat/completions'
KEY = json.load(open(os.path.expanduser('~/.pi/agent/auth.json')))['deepseek']['key']
MODEL = 'deepseek-v4-flash'

triples = json.load(open('/tmp/recap_triples.json'))
CKPT = '/tmp/recap_judge.json'
results = json.load(open(CKPT)) if os.path.exists(CKPT) else {}

def prompt(t):
    return f"""당신은 코딩 에이전트의 tool 결과 요약(recap) 품질 평가자.

[기준] 절대적 정보량이 아니라 **이후 에이전트가 작업에 실제로 필요로 한 정보**가 보존되었는지.

[TOOL 원본 결과]
{json.dumps(t['orig'][:6000], ensure_ascii=False)}

[에이전트 후속 행동 — 이 결과 받고 직후에 한 것]
{json.dumps(t['followup'][:1500], ensure_ascii=False)}

[분신이 만든 recap]
{json.dumps(t['recap'], ensure_ascii=False)}

[평가]
1. <후속 행동>을 보고 에이전트가 이 결과에서 실제로 의존한 정보 단위를 1~5개 식별. (후속 행동과 무관한 원본 정보는 제외 — task-relevant만.)
2. 각 단위가 <recap>에 보존되었는지: preserved(충분) / partial(불완전) / lost(누락).
3. JSON만 출력:
{{"units":[{{"info":"...","status":"preserved|partial|lost"}}]}}"""

def call(t):
    body = json.dumps({'model': MODEL, 'messages': [{'role': 'user', 'content': prompt(t)}],
                       'max_tokens': 6000, 'temperature': 0}).encode()
    req = urllib.request.Request(API, data=body, headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                c = json.loads(r.read())['choices'][0]['message'].get('content', '')
                m = re.search(r'\{.*\}', c, re.S)
                return json.loads(m.group(0)) if m else {'units': [], 'raw': c[:150]}
        except Exception as e:
            time.sleep(3 * (attempt + 1))
    return {'units': [], 'err': str(e)[:80]}

todo = [t for t in triples if t['tcid'] not in results]
print(f'평가 대상: {len(triples)}개 | 이미 완료: {len(results)} | 남은: {len(todo)}')
with ThreadPoolExecutor(max_workers=8) as ex:
    futs = {ex.submit(call, t): t['tcid'] for t in todo}
    for i, fu in enumerate(as_completed(futs), 1):
        results[futs[fu]] = fu.result()
        if i % 10 == 0:
            json.dump(results, open(CKPT, 'w'), ensure_ascii=False)
            print(f'  {i}/{len(todo)} 완료, checkpoint 저장')
json.dump(results, open(CKPT, 'w'), ensure_ascii=False)

# 집계 — task-grounded recall
def bucket(n): return '소' if n < 1000 else ('중' if n < 5000 else '대')
preserved = partial = lost = total = 0
by = {'소': [0, 0], '중': [0, 0], '대': [0, 0]}
lost_examples = []
for t in triples:
    r = results.get(t['tcid'], {})
    units = r.get('units', [])
    if not units:
        continue
    b = bucket(t['olen'])
    for u in units:
        s = u.get('status', 'lost')
        total += 1
        by[b][1] += 1
        if s == 'preserved':
            preserved += 1; by[b][0] += 1
        elif s == 'partial':
            partial += 1; by[b][0] += 0.5
        else:
            lost += 1
            if len(lost_examples) < 8:
                lost_examples.append({'info': u.get('info', ''), 'tool': t['tool'], 'olen': t['olen'], 'recap': t['recap'][:120]})

print('\n========== TASK-GROUNDED RECALL ==========')
print(f'총 정보 단위: {total} | preserved={preserved} partial={partial} lost={lost}')
print(f'의미 보전율(recall): {(preserved + 0.5*partial)/total*100:.1f}%  (preserved=1.0, partial=0.5)')
print(f'  - 완전 보존(preserved): {preserved/total*100:.1f}%')
print(f'  - 부분(partial):        {partial/total*100:.1f}%')
print(f'  - 누락(lost):           {lost/total*100:.1f}%')
print('\n== 크기별 보전율 (preserved+0.5partial) ==')
for b in ['소', '중', '대']:
    if by[b][1]:
        print(f'  {b}: {by[b][0]/by[b][1]*100:.1f}% ({by[b][0]:.1f}/{by[b][1]})')
print('\n== LOST 사례 (정보 손실) ==')
for e in lost_examples:
    print(f'  [{e["tool"]}/{e["olen"]}자] {e["info"][:70]}')
    print(f'     recap: {e["recap"]}')
