import warnings; warnings.filterwarnings('ignore')
import torch, wave, numpy as np
from speechbrain.inference import SpeakerRecognition

spkrec = SpeakerRecognition.from_hparams(
    source='F:/YouDub/data/modelscope/speechbrain',
    savedir='F:/YouDub/data/modelscope/speechbrain',
    run_opts={'device': 'cpu'},
)

import glob
files = sorted(glob.glob('F:/YouDub/workfolder/local/mq616w1c03/segments/vocals/*.wav'))[:5]
for p in files:
    with wave.open(p, 'rb') as wf:
        nch = wf.getnchannels()
        sw = wf.getsampwidth()
        n = wf.getnframes()
        data = wf.readframes(n)
    if sw == 2:
        arr = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768
    else:
        arr = np.frombuffer(data, dtype=np.uint8).astype(np.float32) / 128 - 1
    if nch > 1:
        arr = arr.reshape(-1, nch).mean(axis=1)
    arr = arr.reshape(1, -1)
    name = p.split('\\')[-1]
    print(f'{name}: shape={arr.shape}, dur={n/44100:.2f}s')
    wave_t = torch.from_numpy(arr).float()
    emb = spkrec.encode_batch(wave_t)
    print(f'  OK {emb.shape}')
