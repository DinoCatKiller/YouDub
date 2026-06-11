export interface TTSEngineConfig {
  runtime: 'ort' | 'pytorch' | 'cloud';
  device: 'cpu' | 'cuda' | 'mps' | 'webgpu';
}

export interface ASREngineConfig {
  runtime: 'faster-whisper' | 'pytorch';
  device: 'cpu' | 'cuda' | 'mps';
}

export interface TranslateEngineConfig {
  apiBase: string;
  model: string;
}

export interface SeparateEngineConfig {
  runtime: 'ort' | 'pytorch';
  device: 'cpu' | 'cuda' | 'mps' | 'webgpu';
}

export interface EnginesConfig {
  tts: TTSEngineConfig;
  asr: ASREngineConfig;
  translate: TranslateEngineConfig;
  separate: SeparateEngineConfig;
}
