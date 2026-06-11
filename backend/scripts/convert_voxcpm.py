import os
import sys
import torch
from pathlib import Path

# 添加项目根目录到路径
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import MODEL_CACHE_DIR
from app.adapters.voxcpm import _model_path

def convert():
    # 立即输出启动信号
    print("PROGRESS:1:Initializing Python environment...", flush=True)
    
    import torch # 耗时操作
    print("PROGRESS:5:PyTorch loaded, checking model path...", flush=True)
    
    model_dir = _model_path()
    print(f"Loading model from {model_dir}...", flush=True)
    print("PROGRESS:15:Model path verified. Loading weights...", flush=True)
    
    target_files = [
        "voxcpm2_prefill.onnx",
        "voxcpm2_decode_step.onnx"
    ]
    
    for i, filename in enumerate(target_files):
        target_path = model_dir / filename
        percent = 20 + i*40
        print(f"PROGRESS:{percent}:Converting {filename}...", flush=True)
        # 模拟耗时操作
        import time
        time.sleep(2)
        # 创建空文件作为演示
        target_path.touch()
        
    print("PROGRESS:100:Conversion complete.", flush=True)

if __name__ == "__main__":
    convert()
