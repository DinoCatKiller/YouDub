import warnings; warnings.filterwarnings('ignore')
import traceback

print("1. imports...")
import torch
import torchaudio
from pyannote.audio.pipelines import SpeakerDiarization
from speechbrain.inference import SpeakerRecognition
from sklearn.cluster import AgglomerativeClustering
import numpy as np
from pathlib import Path
print("   OK")

device = "cpu"
vocals_path = "F:/YouDub/workfolder/local/mq616w1c03/media/audio_vocals.wav"
model_dir = "F:/YouDub/data/modelscope/pyannote/speaker-diarization-community-1"

print("2. loading pyannote pipeline...")
try:
    pipeline = SpeakerDiarization(
        segmentation=f"{model_dir}/segmentation",
        embedding=f"{model_dir}/embedding",
        plda=f"{model_dir}/plda",
        clustering="VBxClustering",
    ).to(torch.device(device))
    print("   OK")
except Exception as e:
    print(f"   FAIL: {e}")
    traceback.print_exc()
    exit(1)

print("3. loading audio...")
waveform, sample_rate = torchaudio.load(vocals_path)
print(f"   shape={waveform.shape}, sr={sample_rate}")

print("4. running pipeline...")
try:
    result = pipeline({"waveform": waveform, "sample_rate": sample_rate})
    print(f"   OK, type={type(result).__name__}")
except Exception as e:
    print(f"   FAIL: {e}")
    traceback.print_exc()
    exit(1)

print("5. itertracks...")
turn_list = list(result.speaker_diarization.itertracks(yield_label=True))
print(f"   {len(turn_list)} turns")

print("6. loading ECAPA...")
try:
    spkrec = SpeakerRecognition.from_hparams(
        source="F:/YouDub/data/modelscope/speechbrain",
        savedir="F:/YouDub/data/modelscope/speechbrain",
        run_opts={"device": device},
    )
    print("   OK")
except Exception as e:
    print(f"   FAIL: {e}")
    exit(1)

print("7. testing ECAPA on a short sample...")
test_wav = torch.randn(1, 16000)
try:
    emb = spkrec.encode_batch(test_wav)
    print(f"   OK {emb.shape}")
except Exception as e:
    print(f"   FAIL: {e}")
    traceback.print_exc()

print("\nDONE - all steps passed")
