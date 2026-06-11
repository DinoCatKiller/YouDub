import warnings; warnings.filterwarnings('ignore')
import torch, torchaudio, sys
from pyannote.audio.pipelines import SpeakerDiarization

print("CUDA:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("Device:", torch.cuda.get_device_name(0))

model_dir = 'F:/YouDub/data/modelscope/pyannote/speaker-diarization-community-1'
print("Loading...")
sys.stdout.flush()
pipeline = SpeakerDiarization(
    segmentation=f'{model_dir}/segmentation',
    embedding=f'{model_dir}/embedding',
    plda=f'{model_dir}/plda',
    clustering='VBxClustering',
).to(torch.device('cuda'))
print("Pipeline loaded")
sys.stdout.flush()

wav, sr = torchaudio.load('F:/YouDub/workfolder/local/mq616w1c03/media/audio_vocals.wav')
print(f"Audio: {wav.shape}, {sr}Hz")
sys.stdout.flush()

print("Running...")
sys.stdout.flush()
result = pipeline({'waveform': wav, 'sample_rate': sr})
print(f"Result: {type(result).__name__}")
turns = list(result.speaker_diarization.itertracks(yield_label=True))
print(f"Turns: {len(turns)}")
print("DONE")
