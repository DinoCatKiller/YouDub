import warnings; warnings.filterwarnings('ignore')
import torch

print("CUDA available:", torch.cuda.is_available())
if torch.cuda.is_available():
    print("CUDA device:", torch.cuda.get_device_name(0))

    # Test 1: basic padding on CUDA
    print("\n1. Basic CUDA padding test...")
    try:
        x = torch.randn(1, 16000, device='cuda')
        y = torch.nn.functional.pad(x, (0, 100))
        print("   OK", y.shape)
    except Exception as e:
        print("   FAIL:", e)

    # Test 2: ECAPA on CUDA
    print("\n2. ECAPA on CUDA...")
    try:
        from speechbrain.inference import SpeakerRecognition
        spkrec = SpeakerRecognition.from_hparams(
            source="F:/YouDub/data/modelscope/speechbrain",
            savedir="F:/YouDub/data/modelscope/speechbrain",
            run_opts={"device": "cuda"},
        )
        x = torch.randn(1, 16000, device='cuda')
        emb = spkrec.encode_batch(x)
        print("   OK", emb.shape)
    except Exception as e:
        print("   FAIL:", e)
        import traceback
        traceback.print_exc()
else:
    print("CUDA not available")
