import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from '@repo/config';
import { MLDaemon } from '../../ml/daemon/client.ts';
import { nowISO, updateStageDB, emitLog, ffmpeg, readTaskLanguages, translationFilePath } from './utils.ts';

export async function stageDiarization(taskId: string, sessionPath: string, daemon?: MLDaemon) {
    await updateStageDB(taskId, 'diarization', { last_message: 'Diarizing...', progress: 0 });

    const sessionAbs = resolve(REPO_ROOT, sessionPath);
    const vocalsPath = join(sessionAbs, 'media', 'audio_vocals.wav');
    const asrFile = join(sessionAbs, 'metadata', 'asr.json');
    const diarizationFile = join(sessionAbs, 'metadata', 'diarization.json');
    const refsDir = join(sessionAbs, 'segments', 'refs');

    if (!existsSync(vocalsPath)) throw new Error('audio_vocals.wav not found');
    if (!existsSync(asrFile)) throw new Error('asr.json not found — ASR must run first');

    // 跳过重复执行
    if (existsSync(diarizationFile) && existsSync(asrFile)
        && statSync(asrFile).mtimeMs <= statSync(diarizationFile).mtimeMs) {
        emitLog(taskId, '[Diarization] Already done, skipping');
        await updateStageDB(taskId, 'diarization', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'Already diarized' });
        return;
    }

    mkdirSync(refsDir, { recursive: true });

    const asrData = JSON.parse(readFileSync(asrFile, 'utf-8'));
    const utterances = asrData.result?.utterances || [];
    if (!utterances.length) throw new Error('ASR has no utterances');


    // 构造临时参考片段，供 Python 端做说话人聚类
    // 每个 utterance 截一小段音频发给 diarization handler
    const tmpRefsDir = join(sessionAbs, 'tmp', 'diarization_refs');
    if (existsSync(tmpRefsDir)) {
        for (const f of readdirSync(tmpRefsDir)) rmSync(join(tmpRefsDir, f));
    }
    mkdirSync(tmpRefsDir, { recursive: true });

    for (let i = 0; i < utterances.length; i++) {
        const u = utterances[i];
        const idx = String(i + 1).padStart(4, '0');
        const refPath = join(tmpRefsDir, `${idx}.wav`);
        const start = Math.max(0, (u.start_time || 0) / 1000 - 0.3);
        const rawDur = ((u.end_time || 10000) - (u.start_time || 0)) / 1000;
        const duration = Math.max(1.0, Math.min(10, rawDur + 0.6));


        ffmpeg(['-i', vocalsPath, '-ss', String(start), '-t', String(duration), '-ac', '1', '-ar', '16000', refPath], 60_000);
    }

    if (!daemon?.ready) throw new Error('Diarization requires Python daemon (pyannote+ECAPA)');

    emitLog(taskId, '[Diarization] Running pyannote + ECAPA clustering...');
    const result = await daemon.runStage('diarization', taskId, {
        vocals_path: vocalsPath,
        refs_dir: tmpRefsDir,
        utterances,
        session_path: sessionAbs,
        device: 'cuda',
    });

    const r = result as Record<string, any>;
    const speakerLabels: string[] = r.speaker_labels as string[] || [];
    const speakerRefs: Record<string, string> = r.speaker_refs as Record<string, string> || {};

    if (!speakerLabels.length) throw new Error('Diarization returned no speaker labels');

    // 给 utterances 打标签 + 保存说话人参考音频
    for (let i = 0; i < utterances.length; i++) {
        utterances[i].speaker_id = speakerLabels[i] || 'unknown';
    }

    for (const [speakerId, refSegmentIdx] of Object.entries(speakerRefs)) {
        const refPath = join(refsDir, `${speakerId}.wav`);
        const srcIdx = String(Number(refSegmentIdx) + 1).padStart(4, '0');
        const srcPath = join(tmpRefsDir, `${srcIdx}.wav`);
        if (existsSync(srcPath)) {
            writeFileSync(refPath, readFileSync(srcPath));
        }
    }

    // 写入结果
    asrData.result.utterances = utterances;
    asrData.speakers = Object.keys(speakerRefs);
    writeFileSync(diarizationFile, JSON.stringify(asrData, null, 2));

    // 清理临时文件
    //try { for (const f of readdirSync(tmpRefsDir)) rmSync(join(tmpRefsDir, f)); } catch {}

    emitLog(taskId, `[Diarization] Found ${speakerRefs ? Object.keys(speakerRefs).length : 0} speakers: ${Object.keys(speakerRefs || {}).join(', ')}`);
    await updateStageDB(taskId, 'diarization', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: `${Object.keys(speakerRefs || {}).length} speakers` });
}
