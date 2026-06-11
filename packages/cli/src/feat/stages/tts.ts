import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { REPO_ROOT, readEnginesConfig } from '@repo/config';
import type { TTSEngineConfig } from '@repo/config';
import { MLDaemon } from '../../ml/daemon/client.ts';
import { VoxCPMNodeONNX, VoxCPMCloud, VoxCPMPython, writeWav } from '@repo/voxlab';
import { readTaskLanguages, emitLog, nowISO, updateStageDB, pythonBin as getPythonBin } from './utils.ts';

function createTTSBackend(cfg: TTSEngineConfig) {
  if (cfg.runtime === 'cloud') return new VoxCPMCloud();
  if (cfg.runtime === 'pytorch') return new VoxCPMPython();
  const device = cfg.device === 'webgpu' ? 'webgpu' : 'cpu';
  return new VoxCPMNodeONNX({ executionProvider: device });
}

async function runPytorchBatch(
  taskId: string,
  ttsCfg: TTSEngineConfig,
  translationFile: string,
  vocalsDir: string,
  ttsDir: string,
  total: number,
) {
  const scriptPath = join(REPO_ROOT, 'packages', 'voxlab', 'scripts', 'voxcpm_infer_batch.py');
  const modelDir = join(REPO_ROOT, 'data', 'modelscope', 'OpenBMB__VoxCPM2');
  const pythonBin = getPythonBin();
  const voxcpmSrc = join(REPO_ROOT, 'submodule', 'VoxCPM', 'src');

  return new Promise<void>((resolve, reject) => {
    const proc = spawn(pythonBin, [
      scriptPath,
      '--model-dir', modelDir,
      '--translation-file', translationFile,
      '--vocals-dir', vocalsDir,
      '--tts-dir', ttsDir,
      '--device', ttsCfg.device,
    ], {
      env: { ...process.env, PYTHONPATH: voxcpmSrc },
    });

    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        const progressMatch = line.match(/^\[PROGRESS\] (\d+)\/(\d+)$/);
        if (progressMatch) {
          const current = parseInt(progressMatch[1]);
          const ttl = parseInt(progressMatch[2]);
          updateStageDB(taskId, 'tts', { last_message: `Generating ${current}/${ttl}...` });
        } else if (line.startsWith('{')) {
          try {
            const result = JSON.parse(line);
            emitLog(taskId, `[TTS] Batch complete: ${result.generated} generated, ${result.skipped} skipped, ${result.errors} errors in ${result.total_time_s}s`);
            if (result.generate_time_s) {
              emitLog(taskId, `[VoxCPM] Generated in ${result.total_time_s}s | RTF ${result.rtf}`);
            }
          } catch { /* not JSON */ }
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        const errMsg = stderr.slice(-500);
        reject(new Error(`Python batch TTS exit code ${code}: ${errMsg}`));
        return;
      }
      resolve();
    });

    proc.on('error', reject);
  });
}

export async function stageTts(taskId: string, sessionPath: string, daemon?: MLDaemon) {
  const engines = readEnginesConfig();
  const { targetLanguage: dstLangCode } = readTaskLanguages(sessionPath);
  const translationFile = resolve(REPO_ROOT, sessionPath, 'metadata', `translation.${dstLangCode}.json`);
  const vocalsDir = resolve(REPO_ROOT, sessionPath, 'segments', 'vocals');
  const ttsDir = resolve(REPO_ROOT, sessionPath, 'segments', 'tts');

  if (!existsSync(translationFile)) throw new Error(`${translationFile} not found`);
  mkdirSync(ttsDir, { recursive: true });
  const sessionAbs = resolve(REPO_ROOT, sessionPath);
  const data = JSON.parse(readFileSync(translationFile, 'utf-8'));
  const translation = data.translation;

  const anyTts = readdirSync(ttsDir).find(f => f.endsWith('.wav'));
  if (anyTts && statSync(translationFile).mtimeMs > statSync(join(ttsDir, anyTts)).mtimeMs) {
    for (const f of readdirSync(ttsDir)) rmSync(join(ttsDir, f));

    const dubbingFile = join(sessionAbs, 'tmp', 'audio_dubbing.wav');
    const timingsFile = join(sessionAbs, 'metadata', 'timings.json');
    const finalVideo = join(sessionAbs, 'media', 'video_final.mp4');
    for (const f of [dubbingFile, timingsFile, finalVideo]) { if (existsSync(f)) rmSync(f); }
  }

  const ttsCfg = engines.tts;

  if (ttsCfg.runtime === 'f5tts' && daemon?.ready) {
    emitLog(taskId, `[TTS] Using F5-TTS daemon (device=${ttsCfg.device})`);
    const result = await daemon.runStage('tts', taskId, {
      translation_file: translationFile,
      refs_dir: join(sessionAbs, 'segments', 'refs'),
      tts_dir: ttsDir,
      device: ttsCfg.device,
      engine: 'f5tts',
    }, (current, total) => {
      updateStageDB(taskId, 'tts', { last_message: `Generating ${current}/${total}...` });
    });
    const r = result as Record<string, number>;
    emitLog(taskId, `[TTS] F5-TTS: ${r.generated ?? 0} generated, ${r.skipped ?? 0} skipped, ${r.errors ?? 0} errors`);
    if (r.generate_time_s) emitLog(taskId, `[F5-TTS] Generated in ${r.generate_time_s}s`);
    await updateStageDB(taskId, 'tts', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'F5-TTS done' });
    return;
  }

  if (ttsCfg.runtime === 'f5tts' && daemon?.ready) {
    emitLog(taskId, `[TTS] Using F5-TTS daemon (device=${ttsCfg.device})`);
    const result = await daemon.runStage('tts', taskId, {
      translation_file: translationFile,
      refs_dir: join(sessionAbs, 'segments', 'refs'),
      tts_dir: ttsDir,
      device: ttsCfg.device,
      engine: 'f5tts',
    }, (current, total) => {
      updateStageDB(taskId, 'tts', { last_message: `Generating ${current}/${total}...` });
    });
    const r = result as Record<string, number>;
    emitLog(taskId, `[TTS] F5-TTS: ${r.generated ?? 0} generated, ${r.skipped ?? 0} skipped, ${r.errors ?? 0} errors`);
    if (r.generate_time_s) emitLog(taskId, `[F5-TTS] Generated in ${r.generate_time_s}s`);
    await updateStageDB(taskId, 'tts', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'F5-TTS done' });
    return;
  }


  if (ttsCfg.runtime === 'pytorch') {
    await runPytorchBatch(taskId, ttsCfg, translationFile, vocalsDir, ttsDir, translation.length);
  } else {
    const refsDir = resolve(REPO_ROOT, sessionPath, 'segments', 'refs');
    const speakerRefCache: Record<string, string> = {};
    let globalFallbackRef = '';

    if (existsSync(refsDir)) {
      for (const f of readdirSync(refsDir)) {
        if (f.endsWith('.wav')) {
          const spk = f.replace(/\.wav$/, '');
          const refPath = join(refsDir, f);
          if (statSync(refPath).size > 0) speakerRefCache[spk] = refPath;
        }
      }
    }

    for (let i = 0; i < translation.length; i++) {
      const idx = String(i + 1).padStart(4, '0');
      const refPath = resolve(vocalsDir, `${idx}.wav`);
      if (existsSync(refPath) && statSync(refPath).size > 1200 * 16 * 2) {
        globalFallbackRef = refPath;
        break;
      }
    }

    const voxcpm = createTTSBackend(ttsCfg);
    await voxcpm.load();

    for (let i = 0; i < translation.length; i++) {
      const item = translation[i];
      const idx = String(i + 1).padStart(4, '0');
      const outPath = resolve(ttsDir, `${idx}.wav`);
      if (existsSync(outPath)) continue;

      const text = item.dst || item.zh || '';
      if (!text.trim()) {
        writeFileSync(outPath, Buffer.alloc(44));
        continue;
      }

      const speaker = item.speaker || '';
      let refWav: string | undefined;
      // 1: diarization ref 匹配 speaker
      if (speaker && speaker !== '1' && speaker !== '?' && speakerRefCache[speaker]) {
        refWav = speakerRefCache[speaker];
      }
      // 2: 同序 vocal 片段
      if (!refWav) {
        const vocalRef = resolve(vocalsDir, `${idx}.wav`);
        if (existsSync(vocalRef) && statSync(vocalRef).size > 1200 * 16 * 2) refWav = vocalRef;
      }
      // 3: 任意 speaker ref
      if (!refWav) {
        for (const spk of Object.keys(speakerRefCache)) { refWav = speakerRefCache[spk]; break; }
      }
      // 4: 全局兜底
      if (!refWav) refWav = globalFallbackRef;

      if (!refWav) {
        emitLog(taskId, `[WARN] [TTS] No reference for segment ${idx}, skipping`);
        writeFileSync(outPath, Buffer.alloc(44));
        continue;
      }

      await updateStageDB(taskId, 'tts', { last_message: `Generating ${i + 1}/${translation.length}...` });


      let { samples: audio } = await voxcpm.generate({ text, referenceWavPath: refWav });
      const expectedDur = Math.max(0.5, ((item.end_time || 10000) - (item.start_time || 0)) / 1000);
      const actualDur = audio.length / 48000;
      if (actualDur > expectedDur * 1.5) {
        audio = audio.slice(0, Math.floor(expectedDur * 1.5 * 48000));
      }
      writeWav(audio, outPath, 48000);

    }

    await voxcpm.dispose();
  }


  await updateStageDB(taskId, 'tts', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'TTS done' });
}
