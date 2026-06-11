#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$PWD"

echo "=== LocalDub 环境安装 ==="
echo "项目根: $REPO_ROOT"
echo ""

# ── 检测前置 ──────────────────────────────────────
check_cmd() { command -v "$1" &>/dev/null; }

MISSING=""
check_cmd bun   || MISSING="$MISSING bun"
check_cmd ffmpeg || MISSING="$MISSING ffmpeg"
check_cmd python3 || MISSING="$MISSING python3"

if [ -n "$MISSING" ]; then
  echo "[ERROR] 缺少以下命令，请先安装:$MISSING"
  exit 1
fi
echo "[OK] bun / ffmpeg / python3 均已安装"

# ── GPU 检测 ──────────────────────────────────────
GPU_MODE=cpu
if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
  GPU_MODE=cuda
elif command -v rocm-smi &>/dev/null && rocm-smi &>/dev/null; then
  GPU_MODE=rocm
elif [ -f /opt/rocm/bin/rocm-smi ]; then
  GPU_MODE=rocm
fi
echo "[GPU] 检测到: $GPU_MODE"
echo ""

# ── 可选: 用户选择 pip 索引 ──────────────────────
TORCH_INDEX=""
case "$GPU_MODE" in
  cpu)
    TORCH_INDEX="--index-url https://download.pytorch.org/whl/cpu"
    ;;
  rocm)
    echo "[INFO] ROCm 用户: 如需 PyTorch, pip 会自动匹配 ROCm 版本"
    ;;
esac

# ── .env ──────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo "[INIT] 已创建 .env（请按需编辑）"
else
  echo "[SKIP] .env 已存在"
fi

# ── Python venv ──────────────────────────────────
if [ ! -d .venv ]; then
  echo "[PY] 创建虚拟环境..."
  python3 -m venv .venv
fi
source .venv/bin/activate
echo "[PY] 虚拟环境: $(which python)"

echo "[PY] 升级 pip..."
pip install --quiet --upgrade pip

echo "[PY] 安装依赖..."
if [ -n "$TORCH_INDEX" ]; then
  pip install torch torchvision --quiet $TORCH_INDEX
fi
pip install -r requirements.txt --quiet

echo "[PY] 完成"

# ── JS 依赖 ──────────────────────────────────────
if [ ! -d node_modules ]; then
  echo "[JS] bun install..."
  bun install
else
  echo "[JS] node_modules 已存在，bun install --frozen-lockfile 跳过"
fi

# ── DB ────────────────────────────────────────────
mkdir -p data
cd packages/cli
echo "[DB] 初始化 SQLite..."
bun run db:push 2>/dev/null || echo "[WARN] db:push 失败（可能是 drizzle-kit 未安装）"
cd "$REPO_ROOT"

echo ""
echo "=== 安装完成 ==="
echo ""
echo "使用方式:"
echo "  编辑 .env 中的 API key 和配置"
echo "  编辑 packages/cli/config.json 中的 video 链接"
echo "  运行: cd packages/cli && bun run run-task.ts"
echo ""
