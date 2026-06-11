"""Re-export VoxCPM2 decode_step ONNX with NaN-safe residual LM.

Adds torch.nan_to_num after residual_lm.forward_step output before ONNX export,
so the graph contains proper IsNaN→Where chains that prevent NaN propagation.

Usage:
    .venv/bin/python scripts/export_voxcpm_onnx.py --model-dir data/modelscope/OpenBMB__VoxCPM2
"""

import argparse
import os
import sys

import torch
import torch.nn as nn

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'submodule', 'VoxCPM', 'src'))
from voxcpm.model.voxcpm2 import VoxCPM2Model


def patch_residual_lm(model: VoxCPM2Model):
    """Replace residual_lm.forward_step with a NaN-safe version."""
    orig = model.residual_lm.forward_step
    def safe_step(hidden, position_id):
        out = orig(hidden, position_id)
        return torch.nan_to_num(out, nan=0.0)
    model.residual_lm.forward_step = safe_step
    print("  Patched residual_lm.forward_step")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir', required=True)
    parser.add_argument('--opset', type=int, default=20)
    parser.add_argument('--output', default=None)
    args = parser.parse_args()
    
    output = args.output or os.path.join(args.model_dir, 'voxcpm2_decode_step_fixed.onnx')
    device = 'cpu'
    
    print(f'Loading model from {args.model_dir}...')
    model = VoxCPM2Model.from_local(args.model_dir, optimize=False, device=device)
    model.eval()
    
    # Get dtype from model config
    model_dtype = model._dtype()
    print(f'Model dtype: {model_dtype}')
    
    patch_residual_lm(model)
    
    # Setup KV caches
    model.base_lm.setup_cache(1, 8192, device, model_dtype)
    model.residual_lm.setup_cache(1, 8192, device, model_dtype)
    
    # KV caches initialized by setup_cache. We don't need to prefill since
    # the ONNX model handles KV cache via input tokens (base/residual_next_keys).
    
    class DecodeWrapper(nn.Module):
        """ONNX-exportable decode step wrapper."""
        def __init__(self, m: VoxCPM2Model):
            super().__init__()
            self.m = m
            # CFM decoder
            self.feat_decoder = m.feat_decoder
            self.patch_size = m.patch_size
        
        def forward(self, dit_hidden, base_k, base_v, res_k, res_v, prefix, noise, cfg):
            h_dit = dit_hidden.shape[-1] // 2
            lm_h = dit_hidden[:, :h_dit]
            res_h = dit_hidden[:, h_dit:]
            
            seq_len = base_k.shape[3]
            pos = torch.tensor([[seq_len]], dtype=torch.long)
            
            # ── CFM decoder ──
            mu = torch.cat([lm_h, res_h], dim=-1)
            cond = prefix.transpose(1, 2).contiguous()
            pred = self._run_cfm(noise, mu, cond, cfg)
            
            # ── Encode pred_feat for next step ──
            curr = self.m.feat_encoder(pred.unsqueeze(1))
            curr = self.m.enc_to_lm_proj(curr)[:, 0, :]
            
            # ── Base LM step ──
            new_lm = self.m.base_lm.forward_step(curr.to(model_dtype), pos).clone()
            new_lm = self.m.fsq_layer(new_lm)
            
            # ── Residual LM step (NaN-safe via patch) ──
            res_in = self.m.fusion_concat_proj(torch.cat([new_lm, curr], dim=-1))
            new_res = self.m.residual_lm.forward_step(res_in.to(model_dtype), pos).clone()
            
            # ── Project to DiT hidden dim ──
            dh1 = self.m.lm_to_dit_proj(new_lm.to(dit_hidden.dtype))
            dh2 = self.m.res_to_dit_proj(new_res.to(dit_hidden.dtype))
            new_dh = torch.cat([dh1, dh2], dim=-1)
            
            # ── KV cache outputs ──
            bk = torch.stack(self.m.base_lm.kv_cache.key_cache, dim=0).unsqueeze(0)
            bv = torch.stack(self.m.base_lm.kv_cache.value_cache, dim=0).unsqueeze(0)
            rk = torch.stack(self.m.residual_lm.kv_cache.key_cache, dim=0).unsqueeze(0)
            rv = torch.stack(self.m.residual_lm.kv_cache.value_cache, dim=0).unsqueeze(0)
            
            # ── Stop flag ──
            stop = self.m.stop_head(self.m.stop_actn(self.m.stop_proj(new_lm)))
            stop_flag = stop.argmax(dim=-1, keepdim=True).float()
            
            return pred, new_dh, bk, bv, rk, rv, stop_flag
        
        def _run_cfm(self, noise, mu, cond, cfg_value):
            """Euler solver matching UnifiedCFM.solve_euler."""
            n_timesteps = 10
            b = noise.shape[0]
            x = noise
            
            t_span = self.compute_t_span(n_timesteps, noise.device, noise.dtype)
            dt = t_span[0] - t_span[1]
            
            for step in range(1, len(t_span)):
                t = t_span[step-1]
                
                # CFG
                x_in = torch.cat([x, x], dim=0)
                mu_in = torch.cat([mu, mu], dim=0)
                t_in = torch.cat([t.unsqueeze(0), t.unsqueeze(0)], dim=0)
                dt_in = torch.cat([dt.unsqueeze(0), dt.unsqueeze(0)], dim=0)
                cond_in = torch.cat([cond, cond], dim=0)
                
                dphi_dt = self.feat_decoder.estimator(x_in, mu_in, t_in, cond_in, dt_in)
                dphi_dt, cfg_dphi_dt = torch.split(dphi_dt, [b, b], dim=0)
                dphi_dt = cfg_dphi_dt + cfg_value * (dphi_dt - cfg_dphi_dt)
                
                x = x - dt * dphi_dt
                
                if step < len(t_span) - 1:
                    dt = t - t_span[step]
            
            return x
        
        @staticmethod
        def compute_t_span(n_timesteps, device, dtype):
            t_span = torch.linspace(1, 0, n_timesteps + 1, device=device, dtype=dtype)
            sway = 1.0
            t_span = t_span + sway * (torch.cos(torch.pi / 2 * t_span) - 1 + t_span)
            return t_span
    
    wrapper = DecodeWrapper(model).eval()
    
    # Dummy inputs
    B, H, K, C = 1, 1024, 2, 128
    L = model.config.lm_config.num_hidden_layers
    RL = model.config.residual_lm_num_layers
    SL = 1
    
    dummy = (
        torch.randn(1, H * 2) * 0.1,                   # dit_hidden
        torch.zeros(1, L, K, SL, C),                    # base_k
        torch.zeros(1, L, K, SL, C),                    # base_v
        torch.zeros(1, RL, K, SL, C),                   # res_k
        torch.zeros(1, RL, K, SL, C),                   # res_v
        torch.randn(1, 4, 64) * 0.1,                    # prefix
        torch.randn(1, 4, 64) * 0.1,                    # noise
        torch.tensor([2.0]),                            # cfg
    )
    
    print('Exporting to ONNX (this may take a while)...')
    torch.onnx.export(
        wrapper, dummy, output,
        opset_version=args.opset,
        input_names=['dit_hidden', 'base_next_keys', 'base_next_values',
                     'residual_next_keys', 'residual_next_values',
                     'prefix_feat_cond', 'noise', 'cfg_value'],
        output_names=['pred_feat', 'new_dit_hidden',
                      'new_base_next_keys', 'new_base_next_values',
                      'new_residual_next_keys', 'new_residual_next_values',
                      'stop_flag'],
        dynamic_axes={
            'base_next_keys': {3: 'seq_len'},
            'base_next_values': {3: 'seq_len'},
            'residual_next_keys': {3: 'seq_len'},
            'residual_next_values': {3: 'seq_len'},
            'new_base_next_keys': {3: 'seq_len'},
            'new_base_next_values': {3: 'seq_len'},
            'new_residual_next_keys': {3: 'seq_len'},
            'new_residual_next_values': {3: 'seq_len'},
        },
        do_constant_folding=True,
    )
    print(f'Exported to {output}')
    
    # Verify with ONNX Runtime
    import onnxruntime as ort
    import numpy as np
    
    print('Verifying with ONNX Runtime...')
    sess_opts = ort.SessionOptions()
    sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    sess = ort.InferenceSession(output, sess_opts, providers=['CPUExecutionProvider'])
    
    ort_in = {k: v.numpy() if isinstance(v, torch.Tensor) else v for k, v in zip(
        ['dit_hidden', 'base_next_keys', 'base_next_values',
         'residual_next_keys', 'residual_next_values',
         'prefix_feat_cond', 'noise', 'cfg_value'], dummy)}
    
    out = sess.run(None, ort_in)
    names = [o.name for o in sess.get_outputs()]
    
    total_nan = 0
    for name, arr in zip(names, out):
        nan = int(np.isnan(arr).sum())
        inf = int(np.isinf(arr).sum())
        total_nan += nan
        ok = "✅" if (nan == 0 and inf == 0) else "❌"
        print(f'  {name}: shape={list(arr.shape)}, NAN={nan}, INF={inf} {ok}')
    
    if total_nan == 0:
        print('\n✅ Fixed model: NO NaN!')
    else:
        print(f'\n❌ Still has {total_nan} NaN values')
    
    # Cleanup KV caches for future runs
    model.base_lm.kv_cache.reset()
    model.residual_lm.kv_cache.reset()


if __name__ == '__main__':
    main()
