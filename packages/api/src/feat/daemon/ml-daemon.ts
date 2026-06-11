import { MLDaemon } from '@repo/cli/src/ml/daemon/client.ts';

let instance: MLDaemon | null = null;

export function getMLDaemon(): MLDaemon | null {
  return instance;
}

export async function startMLDaemon(): Promise<MLDaemon> {
  if (instance) return instance;
  instance = new MLDaemon();
  await instance.start();
  return instance;
}
