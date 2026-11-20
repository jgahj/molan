#!/bin/bash
# =============================================================================
# run_autodl.sh: AutoDL / 算力云 1-Click LoRA Training & GGUF Export Script
# 墨阑 1,279 本真人小说微调自动化脚本
# =============================================================================
set -e

echo "=================================================================="
echo "🚀 [AutoDL] 墨阑小说去AI味 LoRA 微调环境自动装配与训练流程启动"
echo "=================================================================="

WORKSPACE_DIR="/root/autodl-tmp"
mkdir -p "$WORKSPACE_DIR"
cd "$WORKSPACE_DIR"

# 1. 检查 Python 与 CUDA
python3 --version
nvidia-smi

# 2. 安装 ModelScope 与 LLaMA-Factory (国内高速镜像)
echo "[1/5] 安装依赖与 LLaMA-Factory..."
pip install --upgrade pip -i https://pypi.tuna.tsinghua.edu.cn/simple
pip install modelscope "transformers>=4.45.0" "accelerate>=0.34.0" "peft>=0.12.0" "trl>=0.9.6" -i https://pypi.tuna.tsinghua.edu.cn/simple

if [ ! -d "LLaMA-Factory" ]; then
    git clone --depth 1 https://gitee.com/hiyouga/LLaMA-Factory.git LLaMA-Factory
fi
cd LLaMA-Factory
pip install -e ".[torch,metrics,deepspeed]" -i https://pypi.tuna.tsinghua.edu.cn/simple

# 3. 高速下载 Qwen2.5-7B-Instruct 基础模型 (ModelScope 约 100MB/s)
echo "[2/5] 从 ModelScope 高速拉取 Qwen2.5-7B-Instruct..."
python3 -c "
from modelscope import snapshot_download
model_dir = snapshot_download('Qwen/Qwen2.5-7B-Instruct', cache_dir='/root/autodl-tmp/models')
print('模型下载完成，存储路径:', model_dir)
"
BASE_MODEL_DIR="/root/autodl-tmp/models/Qwen/Qwen2.5-7B-Instruct"

# 4. 同步数据集到 LLaMA-Factory/data 目录
echo "[3/5] 装配 1,279 本真人小说微调数据集..."
mkdir -p data
# 拷贝外部上传的数据集文件
if [ -d "/root/lora-training" ]; then
    cp -r /root/lora-training/* data/
elif [ -d "$WORKSPACE_DIR/lora-training" ]; then
    cp -r "$WORKSPACE_DIR/lora-training/*" data/
fi

# 确保 dataset_info.json 包含墨阑配置
cat << 'EOF' > data/dataset_info.json
{
  "molan_de_ai_alpaca": {
    "file_name": "train_alpaca.json",
    "formatting": "alpaca",
    "columns": {
      "prompt": "instruction",
      "query": "input",
      "response": "output"
    }
  },
  "molan_de_ai_sharegpt": {
    "file_name": "train_sharegpt.jsonl",
    "formatting": "sharegpt",
    "columns": {
      "messages": "messages"
    },
    "tags": {
      "role_tag": "role",
      "content_tag": "content",
      "user_tag": "user",
      "assistant_tag": "assistant",
      "system_tag": "system"
    }
  }
}
EOF

# 5. 生成本次训练配置文件
echo "[4/5] 生成训练配置文件..."
cat << EOF > molan_train.yaml
### Model arguments
model_name_or_path: $BASE_MODEL_DIR
trust_remote_code: true

### Method arguments
stage: sft
do_train: true
finetuning_type: lora
lora_target: all
lora_rank: 64
lora_alpha: 128
lora_dropout: 0.05

### Dataset arguments
dataset: molan_de_ai_alpaca
dataset_dir: data
template: qwen
cutoff_len: 2048
max_samples: 100000
overwrite_cache: true
preprocessing_num_workers: 4

### Output arguments
output_dir: /root/autodl-tmp/output/qwen2.5-7b-molan-lora
logging_steps: 10
save_steps: 200
save_total_limit: 2
plot_loss: true
overwrite_output_dir: true

### Training hyperparameters
per_device_train_batch_size: 4
gradient_accumulation_steps: 4
learning_rate: 0.0002
num_train_epochs: 2.0
lr_scheduler_type: cosine
warmup_ratio: 0.05
bf16: true
flash_attn: fa2
EOF

# 6. 开始训练
echo "[5/5] 开始微调 (预计耗时 ~45 分钟，费用约 1.5~2 元)..."
llamafactory-cli train molan_train.yaml

echo "=================================================================="
echo "🎉 微调顺利完成！正在自动合并 LoRA 权重..."
echo "=================================================================="

# 合并 LoRA 权重为完整模型
cat << EOF > merge_export.yaml
model_name_or_path: $BASE_MODEL_DIR
adapter_name_or_path: /root/autodl-tmp/output/qwen2.5-7b-molan-lora
template: qwen
finetuning_type: lora
export_dir: /root/autodl-tmp/output/qwen2.5-7b-molan-merged
export_size: 2
export_device: cpu
export_legacy_format: false
EOF

llamafactory-cli export merge_export.yaml
echo "✅ 权重合并完成，完整模型位于: /root/autodl-tmp/output/qwen2.5-7b-molan-merged"

# 导出 GGUF (用于本机 Ollama / llama.cpp 极速运行)
echo "正在编译并导出 GGUF (Q4_K_M)..."
if command -v llama-quantize &> /dev/null; then
    python3 /root/autodl-tmp/LLaMA-Factory/src/llamafactory/extras/export_gguf.py \
      --model_name_or_path /root/autodl-tmp/output/qwen2.5-7b-molan-merged \
      --output_dir /root/autodl-tmp/output/gguf
fi

echo "=================================================================="
echo "🎉 全流程完毕！可直接下载模型文件回本地电脑运行。"
echo "=================================================================="
