"""
Pipeline daemon — keeps ML models (Whisper, VoxCPM, Demucs) loaded across video tasks.

Protocol (JSON lines on stdin/stdout):

  TS ──stdin──→ daemon:  {"action":"run_stage","stage":"asr","task_id":"...","params":{...}}
  daemon ──stdout──→ TS: {"type":"progress","stage":"asr","current":1,"total":10}
                          {"type":"complete","stage":"asr","output":{...}}
                          {"type":"error","stage":"asr","message":"..."}

Commands:
  run_stage  — execute a pipeline stage (asr | tts | separate)
  shutdown   — graceful exit

On startup, daemon sends {"type":"ready"} then enters stdin read loop.
Models are lazy-loaded on first use and cached as module-level singletons.

Usage (spawned by TS):
  PYTHONPATH=submodule/VoxCPM/src:$PYTHONPATH \\
    .venv/bin/python packages/cli/scripts/pipeline_daemon.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import traceback
import wave
sys.path.insert(0, "F:/YouDub/packages/cli/scripts")
from pathlib import Path
import sys



# Windows: ensure stdin/stdout use binary mode so JSON lines protocol
# (newline-delimited) is not corrupted by \n → \r\n translation.
if sys.platform == "win32":
    import msvcrt  # noqa: PLC0415
    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)   # type: ignore[attr-defined]
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)  # type: ignore[attr-defined]

# ---------------------------------------------------------------------------
# Model singletons
# ---------------------------------------------------------------------------

_WHISPER: "whisper.Whisper | None" = None
_VOXCPM: "VoxCPM | None" = None


def _load_whisper(device: str) -> None:
    global _WHISPER
    if _WHISPER is not None:
        return
    import whisper

    _WHISPER = whisper.load_model(
        os.getenv("WHISPER_MODEL", "large-v3-turbo"),
        device=device,
        download_root=os.getenv("WHISPER_DOWNLOAD_ROOT") or None,
    )


def _load_voxcpm(model_dir: str, device: str) -> None:
    global _VOXCPM
    if _VOXCPM is not None:
        return
    from voxcpm import VoxCPM

    _VOXCPM = VoxCPM.from_pretrained(model_dir, load_denoiser=False, device=device)


def _load_demucs(device: str):
    demucs_path = _demucs_source_path()
    sys.path.insert(0, str(demucs_path))
    from demucs.api import Separator

    return Separator

# ---------------------------------------------------------------------------
# Stage handlers
# ---------------------------------------------------------------------------

def _to_ms(seconds: float) -> int:
    return int(round(float(seconds) * 1000))


def _convert_words(words: list) -> list:
    return [
        {"text": w.get("word", ""), "start_time": _to_ms(w.get("start", 0.0)), "end_time": _to_ms(w.get("end", 0.0))}
        for w in words or []
    ]


def _convert_segments(segments: list) -> list:
    return [
        {"text": seg.get("text", "").strip(), "start_time": _to_ms(seg.get("start", 0.0)),
         "end_time": _to_ms(seg.get("end", 0.0)), "words": _convert_words(seg.get("words", []))}
        for seg in segments
    ]


def _write_wav(wav, path: str, sample_rate: int = 48000) -> None:
    import numpy as np

    wav_int16 = np.clip(wav * 32767, -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(wav_int16.tobytes())


def _write_empty_wav(path: str) -> None:
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(48000)
        wf.writeframes(b"")

def _write_wav_f5(wav, path: str, sample_rate: int) -> None:
    import numpy as np
    wav_int16 = np.clip(wav * 32767, -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(wav_int16.tobytes())


def handle_f5tts(params: dict, task_id: str) -> dict:
    from f5_tts.api import F5TTS

    translation_file = Path(params["translation_file"])
    refs_dir = Path(params["refs_dir"])
    tts_dir = Path(params["tts_dir"])
    device = params.get("device", "cuda")
    nfe_step = int(params.get("nfe_step", 16))

    tts_dir.mkdir(parents=True, exist_ok=True)

    f5tts = F5TTS(
        model="F5TTS_v1_Base",
        ckpt_file="F:/YouDub/data/modelscope/f5-tts/model_inference_fp16.pt",
        vocab_file="F:/YouDub/data/modelscope/f5-tts/vocab_2567.txt",
        vocoder_local_path="F:/YouDub/data/modelscope/vocos",
        device="cuda",
        use_ema=False,
    )





    data = json.loads(translation_file.read_text(encoding="utf-8"))
    items = data["translation"]
    total = len(items)

    generated = skipped = errors = 0
    gen_time = 0.0

    for index, item in enumerate(items, start=1):
        idx = f"{index:04d}"
        out_path = tts_dir / f"{idx}.wav"

        if out_path.exists():
            skipped += 1
            _emit_progress("tts", task_id, index, total)
            continue

        text = item.get("dst") or item.get("zh", "")
        if not text.strip():
            _write_empty_wav(str(out_path))
            skipped += 1
            _emit_progress("tts", task_id, index, total)
            continue

        speaker = item.get("speaker", "1")
        ref_wav = refs_dir / f"{speaker}.wav"
        if not ref_wav.exists():
            ref_wav = None
            for f in sorted(refs_dir.glob("*.wav")):
                ref_wav = f
                break
        if not ref_wav:
            _write_empty_wav(str(out_path))
            errors += 1
            _emit_progress("tts", task_id, index, total)
            continue

        t1 = time.perf_counter()
        try:
            wav, sr, _ = f5tts.infer(
                ref_file=str(ref_wav),
                ref_text="",
                text = re.sub(r'^\d+\.\s*\[.+\]\s*', '', text.strip()),
                gen_text=text,
                nfe_step=nfe_step,
            )
            _write_wav_f5(wav, str(out_path), sr)
            gen_time += time.perf_counter() - t1
            generated += 1
        except Exception as e:
            errors += 1
            sys.stdout.write(f"[F5-TTS] Segment {idx} failed: {e}\n")
            sys.stdout.flush()
            _write_empty_wav(str(out_path))


    _emit_progress("tts", task_id, index, total)

    return {
        "generated": generated,
        "skipped": skipped,
        "errors": errors,
        "generate_time_s": round(gen_time, 3),
    }



def _write_wav_f5(wav, path: str, sample_rate: int) -> None:
    import numpy as np
    wav_int16 = np.clip(wav * 32767, -32768, 32767).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(wav_int16.tobytes())




def _demucs_source_path() -> Path:
    repo_root = Path(__file__).resolve().parents[3]
    demucs_path = repo_root / "submodule" / "demucs"
    if (demucs_path / "demucs" / "api.py").exists():
        return demucs_path
    raise RuntimeError("Demucs submodule not found; run: git submodule update --init --recursive")


def _demucs_progress(info: dict, shifts: int) -> int:
    models = max(1, int(info.get("models") or 1))
    model_index = max(0, int(info.get("model_idx_in_bag") or 0))
    shift_index = max(0, int(info.get("shift_idx") or 0))
    audio_length = max(0, int(info.get("audio_length") or 0))
    segment_offset = max(0, int(info.get("segment_offset") or 0))
    segment_ratio = min(segment_offset / audio_length, 1) if audio_length else 0
    total_units = max(1, models * shifts)
    completed_units = model_index * shifts + shift_index + segment_ratio
    return max(0, min(99, int(completed_units / total_units * 100)))

def _load_wav_as_tensor(path: str):
    import wave
    import numpy as np
    with wave.open(path, "rb") as wf:
        nch = wf.getnchannels()
        sw = wf.getsampwidth()
        n = wf.getnframes()
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


def handle_diarization(params: dict, task_id: str) -> dict:
    import torch
    import numpy as np

    refs_dir = Path(params["refs_dir"])
    utterances = params["utterances"]
    device = params.get("device", "cuda")

    _emit_progress("diarization", task_id, 0, 100)

    # 1. pyannote diarization
    hf_token = os.getenv("HF_TOKEN")
    pipeline = Pipeline.from_pretrained(
        "F:/YouDub/data/modelscope/pyannote/speaker-diarization-community-1"
    ).to(torch.device(device))



    diarization = pipeline(params["vocals_path"])
    _emit_progress("diarization", task_id, 30, 100)

    # 2. speechbrain ECAPA 声纹
    from speechbrain.inference import SpeakerRecognition
    spkrec = SpeakerRecognition.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        savedir="data/modelscope/speechbrain",
        run_opts={"device": device},
    )

    all_embeddings = []
    valid_indices = []
    for i, u in enumerate(utterances):
        ref_wav = refs_dir / f"{i+1:04d}.wav"
        if ref_wav.exists() and ref_wav.stat().st_size > 800:
            try:
                samples = _load_wav_as_tensor(str(ref_wav))
                if samples.shape[1] < 3200:
                    continue
                wave = torch.from_numpy(samples).float()
                emb = spkrec.encode_batch(wave)
                all_embeddings.append(emb.squeeze().detach().cpu().numpy())
                valid_indices.append(i)
            except Exception as e:
                sys.stderr.write(f"[DIARIZATION DEBUG] ref {ref_wav}: shape={samples.shape if 'samples' in dir() else 'N/A'}, error={e}\n")
                sys.stderr.flush()



    _emit_progress("diarization", task_id, 70, 100)

    # 3. 聚类
    from sklearn.cluster import AgglomerativeClustering

    n_speakers = max(1, min(8, len(all_embeddings) // 3))
    if len(all_embeddings) >= n_speakers and n_speakers > 1:
        clustering = AgglomerativeClustering(
            n_clusters=n_speakers, metric="cosine", linkage="average"
        )
        cluster_labels = clustering.fit_predict(np.array(all_embeddings))
    else:
        cluster_labels = np.zeros(len(all_embeddings), dtype=int)

    speaker_names = [chr(65 + l) for l in cluster_labels]

    # 用 pyannote 对齐结果填补空白
    turn_list = list(diarization.itertracks(yield_label=True))

    def get_speaker_at(mid_sec: float) -> str:
        for seg, spk in turn_list:
            if seg.start <= mid_sec <= seg.end:
                return spk
        return "unknown"

    final_labels = ["unknown"] * len(utterances)
    for vi, utt_idx in enumerate(valid_indices):
        final_labels[utt_idx] = speaker_names[vi]

    for i in range(len(final_labels)):
        if final_labels[i] == "unknown":
            mid = (utterances[i].get("start_time", 0) + utterances[i].get("end_time", 0)) / 2 / 1000
            py_speaker = get_speaker_at(mid)
            final_labels[i] = f"py_{py_speaker}" if py_speaker != "unknown" else "A"

    _emit_progress("diarization", task_id, 90, 100)

    # 4. 每个说话人选最优参考音频
    speaker_segments: dict[str, list[tuple[int, float]]] = {}
    for i, spk in enumerate(final_labels):
        if i in valid_indices:
            start = utterances[i].get("start_time", 0)
            end = utterances[i].get("end_time", 0)
            dur = (end - start) / 1000
            speaker_segments.setdefault(spk, []).append((i, dur))

    speaker_refs = {}
    for spk, segs in speaker_segments.items():
        best_idx, _ = max(segs, key=lambda x: x[1])
        speaker_refs[spk] = best_idx

    _emit_progress("diarization", task_id, 100, 100)

    return {
        "speaker_labels": final_labels,
        "speaker_refs": speaker_refs,
        "n_speakers": len(speaker_refs),
    }


# ---------------------------------------------------------------------------
# ASR (Whisper)
# ---------------------------------------------------------------------------

def handle_asr(params: dict) -> dict:
    from pydub import AudioSegment

    vocals_path = params["vocals_path"]
    session_path = params["session_path"]
    raw_language = params.get("language", "auto")
    language = None if raw_language == "auto" else raw_language
    device = params.get("device", "cpu")

    t0 = time.perf_counter()
    _load_whisper(device)
    load_time = time.perf_counter() - t0

    t1 = time.perf_counter()
    result = _WHISPER.transcribe(vocals_path, language=language, word_timestamps=False, verbose=False)
    process_time = time.perf_counter() - t1

    utterances = _convert_segments(result.get("segments", []))
    if not utterances:
        raise RuntimeError("Whisper did not return any segments.")

    duration_ms = len(AudioSegment.from_file(vocals_path))
    audio_duration_s = duration_ms / 1000.0
    payload = {
        "audio_info": {"duration": duration_ms},
        "result": {
            "text": (result.get("text") or "").strip(),
            "utterances": utterances,
        },
    }

    metadata_dir = Path(session_path) / "metadata"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    output_file = metadata_dir / "asr.json"
    output_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    detected = result.get("language", "")
    return {
        "asr_file": str(output_file),
        "detected_language": detected,
        "load_time_s": round(load_time, 3),
        "process_time_s": round(process_time, 3),
        "audio_duration_s": round(audio_duration_s, 3),
        "rtf": round(process_time / audio_duration_s, 3) if audio_duration_s > 0 else 0,
    }


def handle_diarization(params: dict, task_id: str) -> dict:
    import torch
    import torchaudio
    import numpy as np
    from pyannote.audio.pipelines import SpeakerDiarization
    from speechbrain.inference import SpeakerRecognition
    from sklearn.cluster import AgglomerativeClustering

    refs_dir = Path(params["refs_dir"])
    utterances = params["utterances"]
    device = params.get("device", "cpu")

    _emit_progress("diarization", task_id, 0, 100)

    # --- pyannote 全局分割 ---
    model_dir = "F:/YouDub/data/modelscope/pyannote/speaker-diarization-community-1"
    pipeline = SpeakerDiarization(
        segmentation=f"{model_dir}/segmentation",
        embedding=f"{model_dir}/embedding",
        plda=f"{model_dir}/plda",
        clustering="VBxClustering",
    ).to(torch.device(device))

    waveform, sample_rate = torchaudio.load(params["vocals_path"])
    result = pipeline({"waveform": waveform, "sample_rate": sample_rate})
    turn_list = list(result.speaker_diarization.itertracks(yield_label=True))

    # 释放 pyannote 模型
    del pipeline
    torch.cuda.empty_cache()

    # --- ECAPA 声纹提取 ---
    spkrec = SpeakerRecognition.from_hparams(
        source="F:/YouDub/data/modelscope/speechbrain",
        savedir="F:/YouDub/data/modelscope/speechbrain",
        run_opts={"device": device},
    )

    all_embeddings = []
    valid_indices = []
    for i, u in enumerate(utterances):
        ref_wav = refs_dir / f"{i+1:04d}.wav"
        if ref_wav.exists() and ref_wav.stat().st_size > 800:
            wave = torch.from_numpy(
                _load_wav_as_tensor(str(ref_wav))
            ).float()
            emb = spkrec.encode_batch(wave)  # 不加 .unsqueeze(0)
            all_embeddings.append(emb.squeeze().detach().cpu().numpy())
            valid_indices.append(i)

    _emit_progress("diarization", task_id, 60, 100)

    # --- 层次聚类（自动判人数） ---
    clustering = AgglomerativeClustering(
        n_clusters=None,
        distance_threshold=0.7,
        metric="cosine",
        linkage="average"
    )
    cluster_labels = clustering.fit_predict(np.array(all_embeddings))

    # 映射成 A, B, C, D, E...
    speaker_names = [chr(65 + l) for l in cluster_labels]
    final_labels = ["unknown"] * len(utterances)
    for vi, utt_idx in enumerate(valid_indices):
        final_labels[utt_idx] = speaker_names[vi]

    # 用 pyannote 回填 unknown
    for i in range(len(final_labels)):
        if final_labels[i] == "unknown":
            mid = (utterances[i].get("start_time", 0) + utterances[i].get("end_time", 0)) / 2 / 1000
            best_spk = "A"
            best_overlap = 0.0
            for seg, _, spk in turn_list:
                overlap = max(0, min(mid/1000 if mid > 1 else mid, seg.end) - max(mid/1000 if mid > 1 else mid, seg.start))
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_spk = str(spk)
            final_labels[i] = best_spk

    # --- 每个说话人选最优参考 ---
    speaker_segments: dict[str, list[tuple[int, float]]] = {}
    for i, spk in enumerate(final_labels):
        if i in valid_indices:
            start = utterances[i].get("start_time", 0)
            end = utterances[i].get("end_time", 0)
            dur = (end - start) / 1000
            speaker_segments.setdefault(spk, []).append((i, dur))

    speaker_refs = {}
    for spk, segs in speaker_segments.items():
        best_idx, _ = max(segs, key=lambda x: x[1])
        speaker_refs[spk] = best_idx

    _emit_progress("diarization", task_id, 100, 100)

    return {
        "speaker_labels": final_labels,
        "speaker_refs": speaker_refs,
        "n_speakers": len(speaker_refs),
    }





# ---------------------------------------------------------------------------
# TTS (VoxCPM)
# ---------------------------------------------------------------------------
def handle_tts(params: dict, task_id: str) -> dict:
    translation_file = Path(params["translation_file"])
    vocals_dir = Path(params["vocals_dir"])
    tts_dir = Path(params["tts_dir"])
    model_dir = params["model_dir"]
    device = params.get("device", "cpu")
    cfg_value = float(params.get("cfg_value", 2.0))
    timesteps = int(params.get("inference_timesteps", 10))

    tts_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    _load_voxcpm(model_dir, device)
    load_time = time.perf_counter() - t0

    data = json.loads(translation_file.read_text(encoding="utf-8"))
    items = data["translation"]
    total = len(items)
    if total == 0:
        return {"generated": 0, "skipped": 0, "errors": 0, "generate_time_s": 0, "load_time_s": round(load_time, 3)}

    min_bytes = 1200 * 16 * 2
    fallback = ""
    for f in sorted(vocals_dir.glob("*.wav")):
        if f.stat().st_size >= min_bytes:
            fallback = str(f)
            break

    generated = skipped = errors = 0
    gen_time = 0.0

    for index, item in enumerate(items, start=1):
        idx = f"{index:04d}"
        out_path = tts_dir / f"{idx}.wav"

        if out_path.exists():
            skipped += 1
            _emit_progress("tts", task_id, index, total)
            continue

        text = item.get("dst") or item.get("zh", "")
        if not text.strip():
            _write_empty_wav(str(out_path))
            skipped += 1
            _emit_progress("tts", task_id, index, total)
            continue

        ref_path = vocals_dir / f"{idx}.wav"
        if not ref_path.exists() or ref_path.stat().st_size < min_bytes:
            ref_path = Path(fallback) if fallback else None
        if ref_path is None or not ref_path.exists():
            _write_empty_wav(str(out_path))
            skipped += 1
            _emit_progress("tts", task_id, index, total)
            continue

        t1 = time.perf_counter()
        try:
            wav = _VOXCPM.generate(
                text=text,
                reference_wav_path=str(ref_path),
                cfg_value=cfg_value,
                inference_timesteps=timesteps,
            )
            _write_wav(wav, str(out_path), 48000)
            gen_time += time.perf_counter() - t1
            generated += 1
        except Exception as e:
            errors += 1
            sys.stderr.write(f"[ERROR] Segment {idx} failed: {e}\n")
            sys.stderr.flush()
            _write_empty_wav(str(out_path))

        _emit_progress("tts", task_id, index, total)

    total_time = time.perf_counter() - t0
    return {
        "generated": generated,
        "skipped": skipped,
        "errors": errors,
        "generate_time_s": round(gen_time, 3),
        "load_time_s": round(load_time, 3),
        "total_time_s": round(total_time, 3),
    }

def handle_f5tts(params: dict, task_id: str) -> dict:
    from f5_tts.api import F5TTS

    translation_file = Path(params["translation_file"])
    refs_dir = Path(params["refs_dir"])
    tts_dir = Path(params["tts_dir"])
    device = params.get("device", "cuda")
    nfe_step = int(params.get("nfe_step", 16))

    tts_dir.mkdir(parents=True, exist_ok=True)

    f5tts = F5TTS(device=device)

    data = json.loads(translation_file.read_text(encoding="utf-8"))
    items = data["translation"]
    total = len(items)

    generated = skipped = errors = 0
    gen_time = 0.0

    for index, item in enumerate(items, start=1):
        idx = f"{index:04d}"
        out_path = tts_dir / f"{idx}.wav"

        if out_path.exists():
            skipped += 1
            _emit_progress("tts", task_id, index, total)
            continue

        text = item.get("dst") or item.get("zh", "")
        if not text.strip():
            _write_empty_wav(str(out_path))
            skipped += 1
            _emit_progress("tts", task_id, index, total)
            continue

        speaker = item.get("speaker", "1")
        ref_wav = refs_dir / f"{speaker}.wav"
        if not ref_wav.exists():
            # 找任意一个存在的 ref
            ref_wav = None
            for f in sorted(refs_dir.glob("*.wav")):
                ref_wav = f
                break
        if not ref_wav:
            _write_empty_wav(str(out_path))
            errors += 1
            _emit_progress("tts", task_id, index, total)
            continue

        t1 = time.perf_counter()
        try:
            desired_dur = (item.get("end_time", 10000) - item.get("start_time", 0)) / 1000
            wav, sr, _ = f5tts.infer(
                ref_file=str(ref_wav),
                ref_text="",
                gen_text=text,
                nfe_step=nfe_step,
                fix_duration=desired_dur,
            )
            _write_wav_f5(wav, str(out_path), sr)
            gen_time += time.perf_counter() - t1
            generated += 1



        except Exception as e:
            errors += 1
            import traceback
            err_log = Path(params["tts_dir"]).parent.parent / "metadata" / "f5tts_errors.log"
            with open(err_log, "a") as f:
                f.write(f"[Segment {idx}] {e}\n{traceback.format_exc()}\n")
            _write_empty_wav(str(out_path))


    _emit_progress("tts", task_id, index, total)

    return {
        "generated": generated,
        "skipped": skipped,
        "errors": errors,
        "generate_time_s": round(gen_time, 3),
    }



# ---------------------------------------------------------------------------
# Separate (Demucs)
# ---------------------------------------------------------------------------

def handle_separate(params: dict, task_id: str) -> dict:
    from pydub import AudioSegment

    video_path = params["video_path"]
    session_path = params["session_path"]
    device = params.get("device", "cpu")

    t0 = time.perf_counter()
    Separator = _load_demucs(device)

    media_dir = Path(session_path) / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    vocals_file = media_dir / "audio_vocals.wav"
    bgm_file = media_dir / "audio_bgm.wav"

    shifts = 3

    def report_progress(info: dict) -> None:
        progress = _demucs_progress(info, shifts)
        _emit_progress("separate", task_id, progress, 100)

    separator = Separator(
        model="htdemucs_ft",
        device=device,
        progress=True,
        shifts=shifts,
        callback=report_progress,
    )
    load_time = time.perf_counter() - t0

    t1 = time.perf_counter()
    _, separated = separator.separate_audio_file(video_path)
    process_time = time.perf_counter() - t1

    audio_duration_s = len(AudioSegment.from_file(video_path)) / 1000.0

    vocals = separated["vocals"]
    bgm = None
    for stem, source in separated.items():
        if stem == "vocals":
            continue
        bgm = source if bgm is None else bgm + source

    from demucs.api import save_audio

    save_audio(vocals, str(vocals_file), samplerate=separator.samplerate)
    save_audio(bgm, str(bgm_file), samplerate=separator.samplerate)

    return {
        "vocals_file": str(vocals_file),
        "bgm_file": str(bgm_file),
        "load_time_s": round(load_time, 3),
        "process_time_s": round(process_time, 3),
        "audio_duration_s": round(audio_duration_s, 3),
        "rtf": round(process_time / audio_duration_s, 3) if audio_duration_s > 0 else 0,
    }


# ---------------------------------------------------------------------------
# IO helpers
# ---------------------------------------------------------------------------

def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _emit_progress(stage: str, task_id: str, current: int, total: int) -> None:
    _emit({"type": "progress", "stage": stage, "task_id": task_id, "current": current, "total": total})


def _emit_complete(stage: str, task_id: str, output: dict) -> None:
    _emit({"type": "complete", "stage": stage, "task_id": task_id, "output": output})


def _emit_error(stage: str, task_id: str, message: str) -> None:
    _emit({"type": "error", "stage": stage, "task_id": task_id, "message": message})


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    _emit({"type": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            sys.stderr.write(f"Invalid JSON from stdin: {line}\n")
            sys.stderr.flush()
            continue

        action = cmd.get("action", "")
        if action == "shutdown":
            break

        if action == "run_stage":
            stage = cmd.get("stage", "")
            task_id = cmd.get("task_id", "")
            params = cmd.get("params", {})
            try:
                if stage == "asr":
                    output = handle_asr(params)
                elif stage == "tts":
                    engine = params.get("engine", "voxcpm")
                    if engine == "f5tts":
                        output = handle_f5tts(params, task_id)
                    else:
                        output = handle_tts(params, task_id)

                elif stage == "diarization":
                    output = handle_diarization(params, task_id)
                elif stage == "separate":
                    output = handle_separate(params, task_id)
                else:
                    _emit_error(stage, task_id, f"Unknown stage: {stage}")
                    continue
                _emit_complete(stage, task_id, output)
            except Exception as e:
                tb = traceback.format_exc()
                sys.stderr.write(f"[{stage}] {tb}\n")
                sys.stderr.flush()
                _emit_error(stage, task_id, str(e))
        else:
            sys.stderr.write(f"Unknown action: {action}\n")
            sys.stderr.flush()

    _emit({"type": "shutdown"})


if __name__ == "__main__":
    main()
