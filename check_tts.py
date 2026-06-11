import wave, os, json, sys
sys.stdout.reconfigure(encoding='utf-8')

tts_dir = 'F:/YouDub/workfolder/local/mq6psh0301/segments/tts'
files = sorted(os.listdir(tts_dir))
durations = []
for f in files:
    p = os.path.join(tts_dir, f)
    with wave.open(p, 'rb') as wf:
        dur = wf.getnframes() / wf.getframerate()
        durations.append(dur)

with open('F:/YouDub/workfolder/local/mq6psh0301/metadata/translation.vi.json', encoding='utf-8') as f:
    items = json.load(f)['translation']

print('Seg | TTS_dur | Expected_ms | Diff_s | Text')
for i in range(min(15, len(items))):
    tts_dur = durations[i] if i < len(durations) else 0
    exp_ms = items[i]['end_time'] - items[i]['start_time']
    exp_s = exp_ms / 1000
    diff = tts_dur - exp_s
    text = (items[i].get('dst') or items[i].get('src',''))[:50]
    print(f'{i+1:3d} | {tts_dur:6.1f}s | {exp_ms:4d}ms ({exp_s:.1f}s) | {diff:+6.1f}s | {text}')

# Also check if there are any very long segments
long = [(i, d) for i, d in enumerate(durations) if d > 10]
if long:
    print(f'\nLong segments (>10s): {len(long)}')
    for i, d in long[:5]:
        text = (items[i].get('dst') or items[i].get('src',''))[:50] if i < len(items) else 'N/A'
        print(f'  Seg {i+1}: {d:.1f}s | {text}')
