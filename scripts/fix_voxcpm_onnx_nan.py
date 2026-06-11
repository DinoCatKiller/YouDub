"""Surgical ONNX graph fix: add dynamic NaN clamping at residual LM outputs.

Adds IsNaN → Where chains after new_dit_hidden and new_residual_next_*
outputs, using Shape + Expand to handle dynamic seq_len dimension.

Usage:
    .venv/bin/python scripts/fix_voxcpm_onnx_nan.py \
        --input data/modelscope/OpenBMB__VoxCPM2/voxcpm2_decode_step.onnx \
        --output data/modelscope/OpenBMB__VoxCPM2/voxcpm2_decode_step_fixed.onnx
"""

import argparse
import numpy as np
import onnx
from onnx import helper, TensorProto, numpy_helper, shape_inference


def make_nan_fixer(model: onnx.ModelProto, output_name: str) -> list:
    """Add IsNaN → Where chain for a given output tensor.
    Returns [isnan_node, where_node]. Uses Expand to create dynamic zero tensor.
    """
    graph = model.graph
    
    # Find tensor type info
    orig_type = None
    for v in list(graph.value_info) + list(graph.output):
        if v.name == output_name:
            orig_type = v.type
            break
    
    if orig_type is None:
        print(f"  WARNING: no type info for {output_name}, using float32 default")
        elem_type = TensorProto.FLOAT
    else:
        elem_type = orig_type.tensor_type.elem_type
    
    dtype_name = {1: 'float32', 10: 'float16'}.get(elem_type, f'type_{elem_type}')
    
    # Names for new tensors
    zero_name = f'{output_name}_zero_scalar'
    shape_name = f'{output_name}_shape'
    zeros_like_name = f'{output_name}_zeros_like'
    isnan_name = f'{output_name}_isnan'
    fixed_name = f'{output_name}_nan_fixed'
    
    # Scalar zero constant (will be expanded to match output shape)
    zero_init = numpy_helper.from_array(
        np.array(0.0, dtype=np.float32 if elem_type == TensorProto.FLOAT else np.float16),
        zero_name
    )
    graph.initializer.append(zero_init)
    
    # Shape of the output tensor (dynamic dims handled correctly)
    shape_node = helper.make_node('Shape', inputs=[output_name], outputs=[shape_name], name=f'{output_name}_shape')
    
    # Expand zero scalar to output shape
    expand_node = helper.make_node(
        'Expand', inputs=[zero_name, shape_name], outputs=[zeros_like_name],
        name=f'{output_name}_expand'
    )
    
    # IsNaN
    isnan_node = helper.make_node(
        'IsNaN', inputs=[output_name], outputs=[isnan_name],
        name=isnan_name
    )
    
    # Where: Where(isnan, zeros_like, x)
    where_node = helper.make_node(
        'Where', inputs=[isnan_name, zeros_like_name, output_name],
        outputs=[fixed_name],
        name=f'{output_name}_where'
    )
    
    return [shape_node, expand_node, isnan_node, where_node], fixed_name


def update_graph_outputs(graph, output_name, new_output_name):
    """Replace an output tensor name in all consumers and the graph output list."""
    # Update consumer nodes
    for node in graph.node:
        for i, inp in enumerate(node.input):
            if inp == output_name:
                node.input[i] = new_output_name
    
    # Update graph outputs
    for out in graph.output:
        if out.name == output_name:
            out.name = new_output_name
            break


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    
    print(f'Loading {args.input}...')
    model = onnx.load(args.input)
    graph = model.graph
    
    graph = model.graph
    
    # Tensors to fix
    fix_targets = ['new_dit_hidden', 'new_residual_next_keys', 'new_residual_next_values']
    
    all_new_nodes = []
    replacements = []
    
    for target in fix_targets:
        print(f'Fixing {target}...')
        nodes, new_name = make_nan_fixer(model, target)
        all_new_nodes.extend(nodes)
        replacements.append((target, new_name))
    
    # Add new nodes and update outputs
    for node in all_new_nodes:
        graph.node.append(node)
    
    for old_name, new_name in replacements:
        update_graph_outputs(graph, old_name, new_name)
    
    print(f'Added {len(all_new_nodes)} new nodes')
    
    # Save
    print(f'Saving to {args.output}...')
    onnx.save(model, args.output)
    print('Done.')


if __name__ == '__main__':
    main()
