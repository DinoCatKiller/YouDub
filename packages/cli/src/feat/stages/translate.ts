import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '@repo/config';
import { readEnginesConfig } from '../config/engines.ts';
import { readTaskLanguages, translationFilePath, emitLog, nowISO, updateStageDB, LANG_NAMES } from './utils.ts';

export async function stageTranslate(taskId: string, sessionPath: string) {
  const metadataDir = join(sessionPath, 'metadata');

  // 从 stages.translate.targetLang 覆盖目标语言
  const localInfoPath = join(metadataDir, 'local_info.json');
  try {
    const info = JSON.parse(readFileSync(localInfoPath, 'utf-8'));
    const stageLang = info.stages?.translate?.targetLang;
    if (stageLang) { info.target_language = stageLang; writeFileSync(localInfoPath, JSON.stringify(info, null, 2)); }
  } catch { /* ignore */ }

  const diarizationFile = join(metadataDir, 'diarization.json');
  const diarizationFixedFile = join(metadataDir, 'diarization_fixed.json');
  const { asrLanguage: srcLangCode, targetLanguage: dstLangCode } = readTaskLanguages(sessionPath);
  const translationFile = translationFilePath(sessionPath, dstLangCode);
  const srcLangName = LANG_NAMES[srcLangCode] || srcLangCode;
  const dstLangName = LANG_NAMES[dstLangCode] || dstLangCode;

  // 如果已经翻译过了跳过
  if (existsSync(translationFile) && existsSync(diarizationFile) && statSync(diarizationFile).mtimeMs <= statSync(translationFile).mtimeMs) {
    await updateStageDB(taskId, 'translate', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'Already translated' });
    return;
  }

  if (!existsSync(diarizationFile)) throw new Error('diarization.json not found — diarization must run first');

  const diarData = JSON.parse(readFileSync(diarizationFile, 'utf-8'));
  const fullText: string = diarData.result?.text || '';
  const utterances: any[] = diarData.result?.utterances || [];
  if (!utterances.length) throw new Error('diarization has no utterances');

  // 视频元信息
  let meta: any = {};
  try { meta = JSON.parse(readFileSync(join(metadataDir, 'ytdlp_info.json'), 'utf-8')); } catch { /* ignore */ }
  const metaView = {
    title: (meta.title || '').trim().slice(0, 500) || '(unknown)',
    uploader: (meta.uploader || '').trim().slice(0, 200) || '(unknown)',
    description: (meta.description || '').trim().slice(0, 500) || '(none)',
  };

  const enginesCfg = readEnginesConfig();
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  const api = { baseUrl: enginesCfg.translate.apiBase, apiKey, model: enginesCfg.translate.model };

  async function callJson(system: string, user: string, maxTokens = 1024): Promise<any> {
    const resp = await fetch(api.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
      body: JSON.stringify({ model: api.model, max_tokens: maxTokens, messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ], temperature: 0.2 }),
    });
    if (!resp.ok) throw new Error(`OpenAI API ${resp.status}: ${await resp.text()}`);
    const json = await resp.json();
    const raw = json.choices?.[0]?.message?.content || '{}';
    try { return JSON.parse(raw); } catch {
      const m = raw.match(/\{.*\}/s);
      if (m) return JSON.parse(m[0]);
      throw new Error(`Failed to parse JSON from LLM: ${raw.slice(0, 300)}`);
    }
  }

  // ========== 第一步：已修过就跳过 ==========
  if (existsSync(diarizationFixedFile) && existsSync(diarizationFile) && statSync(diarizationFile).mtimeMs <= statSync(diarizationFixedFile).mtimeMs) {
    emitLog(taskId, '[Translate] diarization_fixed.json already exists, using it');
  } else {
    // ========== 请求 1：文本修正 ==========
    const correctSystem = '你是中文文本校对员。结合上下文修正低级同音错字、语序混乱、无意义组合。不确定的保持原样。严格输出 JSON。';
    const correctUser = `# 视频信息
标题：${metaView.title}
作者：${metaView.uploader}
描述：${metaView.description}

# 转录语言：${srcLangName}

# 转录文本
${fullText.slice(0, 15000)}

# 任务
结合上下文逻辑，修正同音错字、语序混乱、无意义组合。只改确有把握的，不确定不碰，不要润色。
每条修改单独列出。一个 JSON 对象只改一处。按文本出现顺序排列。

# 输出 JSON（严格遵守）
{
  "changes": [
    {"old": "拉屎", "new": "落实", "reason": "结合上下文，此处应是落实而非拉屎"},
    {"old": "换一", "new": "万一", "reason": "结合上下文，后文出现人名夜白，换一应为万一"}
  ]
}`;

    try {
      const correctResult = await callJson(correctSystem, correctUser, 8192);
      const changes = (correctResult.changes || []) as Array<{ old: string; new: string; reason: string }>;

      if (changes.length > 0) {
        let searchIdx = 0;
        for (const ch of changes) {
          for (let i = searchIdx; i < utterances.length; i++) {
            if (utterances[i].text && utterances[i].text.includes(ch.old)) {
              utterances[i].text = utterances[i].text.replace(ch.old, ch.new);
              searchIdx = i + 1;
              break;
            }
          }
        }
        emitLog(taskId, `[Translate] Text corrected: ${changes.length} change(s)`);
        for (const ch of changes) emitLog(taskId, `  "${ch.old}" → "${ch.new}" (${ch.reason})`);
      }
    } catch (e: any) {
      emitLog(taskId, `[WARN] [Translate] Text correction failed: ${e.message}, using original`);
    }

    // 保存 diarization_fixed.json
    diarData.result.utterances = utterances;
    writeFileSync(diarizationFixedFile, JSON.stringify(diarData, null, 2));
    emitLog(taskId, '[Translate] Saved diarization_fixed.json');
  }

  // ========== 请求 2：翻译 ==========
  const fixedData = JSON.parse(readFileSync(diarizationFixedFile, 'utf-8'));
  const fixedUtterances: any[] = fixedData.result?.utterances || [];

  const translateSystem = `你是一个专业的${dstLangName}翻译助手。逐句翻译${srcLangName}→${dstLangName}。

# 规则
1) 忠实原意，口语保持口语感。不增删信息。
2) 逐句对齐。一句译文对一句原文。
3) 输出 JSON：{"dst": ["译文1", "译文2", ...]}`;

  const batchText = fixedUtterances.map((u: any, i: number) =>
      `${i + 1}. [${u.speaker_id || '?'}] ${(u.text || '').trim()}`
  ).join('\n');

  let dsts: string[] = [];
  try {
    const translateResult = await callJson(translateSystem, batchText, 8192);
    if (Array.isArray(translateResult.dst)) {
      dsts = translateResult.dst.map((d: any) => String(d ?? '').trim()).slice(0, fixedUtterances.length);
      while (dsts.length < fixedUtterances.length) dsts.push(fixedUtterances[dsts.length]?.text || '');
    }
  } catch (e: any) {
    emitLog(taskId, `[WARN] [Translate] Translation failed: ${e.message}, using source`);
    dsts = fixedUtterances.map((u: any) => u.text || '');
  }

  // ========== 写入 translation.vi.json ==========
  const translation = fixedUtterances.map((u: any, idx: number) => ({
    src: u.text || '',
    dst: (dsts[idx] || '').replace(/^\d+\.\s*\[.+\]\s*/, '').trim(),
    src_lang: srcLangCode,
    dst_lang: dstLangCode,
    start_time: u.start_time,
    end_time: u.end_time,
    speaker: u.speaker_id || '?',
  }));

  writeFileSync(translationFile, JSON.stringify({ translation }, null, 2));
  await updateStageDB(taskId, 'translate', { status: 'succeeded', completed_at: nowISO(), progress: 100, last_message: 'Translated' });
}
