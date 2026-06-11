import * as os from 'node:os';
import { execSync } from 'node:child_process';
import * as ort from 'onnxruntime-node';

const GFX_ARCH_MAP: Record<string, string> = {
  gfx1010: 'RDNA 1', gfx1011: 'RDNA 1', gfx1012: 'RDNA 1',
  gfx1030: 'RDNA 2', gfx1031: 'RDNA 2', gfx1032: 'RDNA 2',
  gfx1034: 'RDNA 2', gfx1035: 'RDNA 2', gfx1036: 'RDNA 2',
  gfx1100: 'RDNA 3', gfx1101: 'RDNA 3', gfx1102: 'RDNA 3',
  gfx1103: 'RDNA 3',
  gfx1150: 'RDNA 3.5', gfx1151: 'RDNA 3.5',
  gfx1200: 'RDNA 4', gfx1201: 'RDNA 4',
};

export interface OrtBackend {
  name: string;
  bundled: boolean;
}

export interface GpuInfo {
  name: string;
  architecture?: string;
  driverVersion: string;
  temperature: number;
  vramPercent: number;
  gpuPercent: number;
  gfxVersion?: string;
  hsaOverrideGfx?: string;
}

export interface DeviceInfo {
  platform: {
    os: string;
    arch: string;
    release: string;
    hostname: string;
    runtime: string;
    runtimeVersion: string;
  };
  cpu: {
    model: string;
    cores: number;
    speedMHz: number;
  };
  memory: {
    total: string;
    free: string;
    processHeapUsed: string;
  };
  gpu: GpuInfo[];
  ort: {
    version: string;
    backends: OrtBackend[];
  };
}

function fmtBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function run(cmd: string, timeout = 3000): string {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout }).trim();
  } catch {
    return '';
  }
}

function getGpuInfo(): GpuInfo[] {
  const gpus: GpuInfo[] = [];

  const smi = run('rocm-smi 2>/dev/null');
  if (!smi) {
    gpus.push({ name: 'Not detected', architecture: undefined, driverVersion: '', temperature: 0, vramPercent: 0, gpuPercent: 0 });
    return gpus;
  }

  const driverVer = (run('rocm-smi --showdriverversion 2>/dev/null').match(/Driver version:\s*(.+)/i)?.[1] ?? '').trim();

  for (const line of smi.split('\n')) {
    if (!/^\d+\s+/.test(line)) continue;

    const tempM = line.match(/([\d.]+)°C/);
    const pctMatches = [...line.matchAll(/(\d+)%/g)];
    const parts = line.trim().split(/\s+/);

    const id = parts[0];
    const temp = tempM ? parseFloat(tempM[1]) : 0;
    const vramPct = pctMatches.length >= 2 ? parseInt(pctMatches[pctMatches.length - 2][1]) : 0;
    const gpuPct = pctMatches.length >= 1 ? parseInt(pctMatches[pctMatches.length - 1][1]) : 0;

    let gpuName = `GPU ${id}`;
    let gfxVer = '';
    const pn = run('rocm-smi --showproductname 2>/dev/null');
    const pm = pn.match(new RegExp(`GPU\\[${id}\\]\\s*:\\s*Card Series:\\s*(.+)`, 'i'));
    if (pm) gpuName = pm[1].trim();
    const gfxM = pn.match(/GFX Version:\s*(.+)/i);
    if (gfxM) gfxVer = gfxM[1].trim();

    gpus.push({
      name: gpuName,
      architecture: GFX_ARCH_MAP[gfxVer] ?? undefined,
      driverVersion: driverVer,
      temperature: temp,
      vramPercent: vramPct,
      gpuPercent: gpuPct,
      gfxVersion: gfxVer,
      hsaOverrideGfx: process.env.HSA_OVERRIDE_GFX_VERSION,
    });
  }

  if (gpus.length === 0) {
    const fallbackPn = run('rocm-smi --showproductname 2>/dev/null');
    const fallbackM = fallbackPn.match(/Card Series:\s*(.+)/i);
    gpus.push({ name: fallbackM?.[1]?.trim() ?? 'Unknown', architecture: undefined, driverVersion: driverVer, temperature: 0, vramPercent: 0, gpuPercent: 0 });
  }

  return gpus;
}

export async function getDeviceInfo(): Promise<DeviceInfo> {
  const cpus = os.cpus();
  const backends: OrtBackend[] = (ort.listSupportedBackends?.() ?? []).map(
    (b: { name: string; bundled: boolean }) => ({ name: b.name, bundled: b.bundled })
  );

  return {
    platform: {
      os: process.platform,
      arch: process.arch,
      release: os.release(),
      hostname: os.hostname(),
      runtime: 'bun',
      runtimeVersion: (Bun as any)?.version ?? process.version,
    },
    cpu: {
      model: cpus[0]?.model ?? 'unknown',
      cores: cpus.length,
      speedMHz: cpus[0]?.speed ?? 0,
    },
    memory: {
      total: fmtBytes(os.totalmem()),
      free: fmtBytes(os.freemem()),
      processHeapUsed: fmtBytes(process.memoryUsage().heapUsed),
    },
    gpu: getGpuInfo(),
    ort: {
      version: ort.env.versions?.common ?? 'unknown',
      backends,
    },
  };
}
