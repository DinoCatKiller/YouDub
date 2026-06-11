import warnings; warnings.filterwarnings('ignore')
import sys, os, json, time, wave, numpy as np
import torch, torchaudio
from pathlib import Path
from pyannote.audio.pipelines import SpeakerDiarization
from speechbrain.inference import SpeakerRecognition
from sklearn.cluster import AgglomerativeClustering

# Step 1: simulate what TS does — cut refs from vocals using ffmpeg-like logic
print("Step 1: creating test refs...")
session = "F:/YouDub/workfolder/local/mq616w1c03"
vocals_path = f"{session}/media/audio_vocals.wav"
asr_file = f"{session}/metadata/asr.json"
refs_dir = Path(f"{session}/tmp/diarization_test_refs")
refs_dir.mkdir(parents=True, exist_ok=True)

with open(asr_file, encoding='utf-8') as f:
    asr = json.load(f)

utterances = asr["result"]["utterances"]
print(f"   {len(utterances)} utterances")

for i, u in enumerate(utterances[:20]):  # first 20 for test
    idx = f"{i+1:04d}"
    out = refs_dir / f"{idx}.wav"
    if out.exists():
        continue
    start = max(0, u.get("start_time", 0) / 1000 - 0.3)
    dur = max(1.0, min(10, (u.get("end_time", 10000) - u.get("start_time", 0)) / 1000 + 0.6))
    # Use torchaudio to cut instead of ffmpeg for testing
    wav, sr = torchaudio.load(vocals_path)
    start_sample = int(start * sr)
    n_samples = int(dur * sr)
    clip = wav[:, start_sample:start_sample + n_samples]
    # Resample to 16kHz mono
    clip = torchaudio.functional.resample(clip, sr, 16000)
    if clip.shape[0] > 1:
        clip = clip.mean(dim=0, keepdim=True)
    torchaudio.save(str(out), clip, 16000)
    print(f"   saved {idx}.wav: {clip.shape[1]} samples ({clip.shape[1]/16000:.1f}s)")

print("Step 2: load pyannote...")
model_dir = "F:/YouDub/data/modelscope/pyannote/speaker-diarization-community-1"
pipeline = SpeakerDiarization(
    segmentation=f"{model_dir}/segmentation",
    embedding=f"{model_dir}/embedding",
    plda=f"{model_dir}/plda",
    clustering="VBxClustering",
).to(torch.device("cpu"))
print("   OK")

print("Step 3: run pyannote...")
wav, sr = torchaudio.load(vocals_path)
result = pipeline({"waveform": wav, "sample_rate": sr})
turns = list(result.speaker_diarization.itertracks(yield_label=True))
print(f"   {len(turns)} turns")

print("Step 4: ECAPA embeddings...")
spkrec = SpeakerRecognition.from_hparams(
    source="F:/YouDub/data/modelscope/speechbrain",
    savedir="F:/YouDub/data/modelscope/speechbrain",
    run_opts={"device": "cpu"},
)

def load_wav(path):
    with wave.open(str(path), "rb") as wf:
        nch = wf.getnchannels(); sw = wf.getsampwidth(); n = wf.getnframes()
        data = wf.readframes(n)
    if sw == 2:
        arr = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768
    elif sw == 4:
        arr = np.frombuffer(data, dtype=np.int32).astype(np.float32) / 2147483648
    else:
        arr = np.frombuffer(data, dtype=np.uint8).astype(np.float32) / 128 - 1
    if nch > 1:
        arr = arr.reshape(-1, nch).mean(axis=1)
    return arr.reshape(1, -1)

embs = []
valid = []
for i in range(20):
    ref = refs_dir / f"{i+1:04d}.wav"
    if ref.exists() and ref.stat().st_size > 800:
        samples = load_wav(str(ref))
        if samples.shape[1] < 3200:
            continue
        print(f"   {i+1:04d}.wav: shape={samples.shape}", end='')
        wave_t = torch.from_numpy(samples).float()
        emb = spkrec.encode_batch(wave_t)
        print(f' -> OK {emb.shape}')
        embs.append(emb.squeeze().detach().cpu().numpy())
        valid.append(i)

print(f"\n   {len(embs)} embeddings extracted")

if len(embs) >= 2:
    print("Step 5: clustering...")
    clustering = AgglomerativeClustering(
        n_clusters=None, distance_threshold=0.7,
        metric="cosine", linkage="average"
    )
    labels = clustering.fit_predict(np.array(embs))
    speakers = [chr(65 + l) for l in labels]
    print(f"   speakers: {set(speakers)}")

print("\nALL DONE")
