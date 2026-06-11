import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';


import { readTaskLanguages, translationFilePath, ffmpeg, ffprobe, nowISO, updateStageDB } from './utils.ts';

export async function stageMergeAudio(taskId: string, sessionPath: string) {
  sessionPath = resolve(sessionPath);
  const { targetLanguage: dstLangCode } = readTaskLanguages(sessionPath);
  const translationFile = resolve(sessionPath, translationFilePath(sessionPath, dstLangCode));
  const ttsDir = resolve(sessionPath, 'segments', 'tts');
  const tmpDir = join(sessionPath, 'tmp');
  const stretchedDir = join(sessionPath, 'segments', 'stretched');
  const metadataDir = join(sessionPath, 'metadata');

  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(stretchedDir, { recursive: true });
  mkdirSync(metadataDir, { recursive: true });

  const dubbingFile = join(tmpDir, 'audio_dubbing.wav');
  const timingsFile = join(metadataDir, 'timings.json');
  if (existsSync(dubbingFile) && existsSync(timingsFile) && existsSync(translationFile) && statSync(translationFile).mtimeMs <= statSync(dubbingFile).mtimeMs) {
    await updateStageDB(taskId, 'merge_audio', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'Already merged' });
    return;
  }

  const data = JSON.parse(readFileSync(translationFile, 'utf-8'));
  const translation = data.translation;
  const ttsFiles = translation.map((_: any, i: number) => join(ttsDir, `${String(i + 1).padStart(4, '0')}.wav`));

  for (const f of ttsFiles) {
    if (!existsSync(f)) throw new Error(`Missing TTS segment: ${f}`);
  }

  const probe = ffprobe( ['-v', 'error', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', ttsFiles[0]]);
  const sampleRate = parseInt(probe.stdout.toString().trim()) || 48000;

  let curTotal = 0, desTotal = 0;
  for (let i = 0; i < translation.length; i++) {
    const durProbe = ffprobe( ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ttsFiles[i]]);
    const dur = parseFloat(durProbe.stdout.toString().trim()) || 0;
    curTotal += dur;
    desTotal += Math.max(0, (translation[i].end_time - translation[i].start_time) / 1000);
  }
  const baseFactor = curTotal > 0
    ? Math.max(0.8, Math.min(1.2, (desTotal / curTotal) * 0.99))
    : 1.0;

  const segmentInputs: string[] = [];
  let lastEndMs = 0;

  for (let i = 0; i < translation.length; i++) {
    const segment = translation[i];
    const ttsFile = ttsFiles[i];
    const idx = String(i + 1).padStart(4, '0');
    const stretchedFile = join(stretchedDir, `${idx}.wav`);

    const realStartMs = Math.max(segment.start_time, lastEndMs);

    if (realStartMs > lastEndMs) {
      const gapSec = (realStartMs - lastEndMs) / 1000;
      const silenceFile = join(tmpDir, `silence_${i}.wav`);
      if (!existsSync(silenceFile)) {
        ffmpeg(['-f', 'lavfi', '-i', `anullsrc=r=${sampleRate}:cl=mono`, '-t', String(gapSec), silenceFile]);
      }
      segmentInputs.push(silenceFile);
    }

    if (!existsSync(stretchedFile)) {
      const durProbe = ffprobe( ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ttsFile]);
      const currentSec = parseFloat(durProbe.stdout.toString().trim()) || 0;
      const desiredSec = (segment.end_time - realStartMs) / 1000;

      const first = currentSec * baseFactor;
      const localFactor = first > 1e-3 ? Math.max(0.9, Math.min(1.1, desiredSec / first)) : 1.0;
      const speed = baseFactor * localFactor;

      if (speed !== 1.0) {
        ffmpeg(['-i', ttsFile, '-filter:a', `atempo=${speed.toFixed(4)}`, stretchedFile]);
      } else {
        ffmpeg(['-i', ttsFile, '-c', 'copy', stretchedFile]);
      }
    }

    segmentInputs.push(stretchedFile);

    const segProbe = ffprobe( ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', stretchedFile]);
    const adjustedSec = parseFloat(segProbe.stdout.toString().trim()) || 0;
    const realEndMs = Math.max(realStartMs + adjustedSec * 1000, segment.end_time);
    lastEndMs = realEndMs;

    segment.actual_start_time = Math.floor(realStartMs);
    segment.actual_end_time = Math.floor(realEndMs);
  }

  if (segmentInputs.length === 0) throw new Error('No audio segments to merge');

  const concatFile = join(tmpDir, 'concat_list.txt');
  writeFileSync(concatFile, segmentInputs.map(f => `file '${relative(tmpDir, f).replace(/\\/g, '/')}'`).join('\n'));
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', concatFile, '-acodec', 'pcm_s16le', '-ar', String(sampleRate), '-ac', '1', dubbingFile]);

  writeFileSync(timingsFile, JSON.stringify({ translation }, null, 2));
  await updateStageDB(taskId, 'merge_audio', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'Merged' });
}
