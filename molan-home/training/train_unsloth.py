#!/usr/bin/env python3
"""
train_unsloth.py (v2)
-----------------------------------------------------------------------------
墨阑 1,276 本真人小说 Qwen2.5-7B LoRA 微调脚本 (Unsloth v2 · 与 Colab T4 v2 对齐)
- 数据契约: 支持 book-level 0% 泄露隔离的 train_sharegpt.jsonl + val_sharegpt.jsonl
- 训练质量: 启用 train_on_responses_only（仅小说正文算 Loss，屏蔽 system/user 提示词）
- 稳定性:   自动检测最近 checkpoint 断点续训；自适应 T4 fp16 / L4/A100/4090 bf16
- 防 OOM:   完训先保存轻量化 LoRA 适配器，再释放显存/内存并以低内存水位导出 GGUF (q4_k_m)
-----------------------------------------------------------------------------
"""

import gc
import os
import re
import sys
import torch
from datasets import load_dataset
from trl import SFTConfig, SFTTrainer

# 导入 Unsloth
try:
    from unsloth import FastLanguageModel, is_bfloat16_supported
    from unsloth.chat_templates import train_on_responses_only
except ImportError:
    print("[ERROR] 请安装 2026 Unsloth 稳定组合: pip install unsloth transformers==4.57.3 trl==0.22.2 datasets==4.3.0")
    sys.exit(1)

# 配置参数（均支持环境变量覆盖）
MODEL_NAME = os.environ.get("MOLAN_BASE_MODEL", "unsloth/Qwen2.5-7B-Instruct-bnb-4bit")
MAX_SEQ_LENGTH = int(os.environ.get("MOLAN_MAX_SEQ_LENGTH", "2048"))
DTYPE = None  # None 表示自动检测 (bf16 / fp16)
LOAD_IN_4BIT = os.environ.get("MOLAN_LOAD_IN_4BIT", "1") != "0"

TRAIN_DATASET_PATH = os.environ.get("MOLAN_TRAIN_DATA", "./data/lora-training/train_sharegpt.jsonl")
VAL_DATASET_PATH = os.environ.get("MOLAN_VAL_DATA", "./data/lora-training/val_sharegpt.jsonl")
OUTPUT_DIR = os.environ.get("MOLAN_OUTPUT_DIR", "./output/qwen2.5-7b-molan-unsloth")
LORA_R = int(os.environ.get("MOLAN_LORA_R", "32"))
LORA_ALPHA = int(os.environ.get("MOLAN_LORA_ALPHA", "64"))
NUM_EPOCHS = float(os.environ.get("MOLAN_NUM_EPOCHS", "2.0"))
SKIP_GGUF = os.environ.get("MOLAN_SKIP_GGUF", "0") == "1"


def find_latest_checkpoint(output_dir: str):
    if not os.path.isdir(output_dir):
        return None
    checkpoints = []
    for name in os.listdir(output_dir):
        match = re.match(r"^checkpoint-(\d+)$", name)
        full = os.path.join(output_dir, name)
        if match and os.path.isdir(full):
            checkpoints.append((int(match.group(1)), full))
    if not checkpoints:
        return None
    checkpoints.sort(key=lambda item: item[0])
    return checkpoints[-1][1]


def main():
    use_bf16 = is_bfloat16_supported()
    print("=" * 70)
    print("【墨阑去AI味小说 LoRA 微调 v2】Unsloth 启动")
    print(f"- 基础模型: {MODEL_NAME}")
    print(f"- 上下文截断长度: {MAX_SEQ_LENGTH} | LoRA r={LORA_R}, alpha={LORA_ALPHA}")
    print(f"- 量化/精度: 4-bit={LOAD_IN_4BIT} | {'bf16' if use_bf16 else 'fp16'}")
    print(f"- 训练集: {TRAIN_DATASET_PATH}")
    print(f"- 验证集: {VAL_DATASET_PATH if os.path.exists(VAL_DATASET_PATH) else '(未提供，跳过 eval)'}")
    print("=" * 70)

    if not os.path.exists(TRAIN_DATASET_PATH):
        fallback = "./data/train_sharegpt.jsonl"
        if os.path.exists(fallback):
            train_path = fallback
        else:
            print(f"[ERROR] 未找到训练数据文件: {TRAIN_DATASET_PATH}")
            sys.exit(1)
    else:
        train_path = TRAIN_DATASET_PATH

    # 1. 加载模型与分词器
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=MODEL_NAME,
        max_seq_length=MAX_SEQ_LENGTH,
        dtype=DTYPE,
        load_in_4bit=LOAD_IN_4BIT,
    )

    # 2. 配置 LoRA 适配层 (覆盖所有注意力与前馈投影矩阵)
    model = FastLanguageModel.get_peft_model(
        model,
        r=LORA_R,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        lora_alpha=LORA_ALPHA,
        lora_dropout=0,  # Unsloth 优化: dropout=0 最快且无损
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=2026,
        max_seq_length=MAX_SEQ_LENGTH,
    )

    # 3. 加载 ShareGPT 格式训练/验证集并套用 ChatML 模板
    def formatting_prompts_func(examples):
        convos = examples["messages"]
        texts = [
            tokenizer.apply_chat_template(convo, tokenize=False, add_generation_prompt=False)
            for convo in convos
        ]
        return {"text": texts}

    train_dataset = load_dataset("json", data_files=train_path, split="train")
    train_dataset = train_dataset.map(formatting_prompts_func, batched=True)

    val_dataset = None
    if os.path.exists(VAL_DATASET_PATH):
        val_dataset = load_dataset("json", data_files=VAL_DATASET_PATH, split="train")
        val_dataset = val_dataset.map(formatting_prompts_func, batched=True)

    # 4. 配置 SFTConfig + 仅正文计算 Loss（train_on_responses_only）
    sft_args = SFTConfig(
        dataset_text_field="text",
        max_seq_length=MAX_SEQ_LENGTH,
        dataset_num_proc=2,
        packing=False,  # 保留单章自然边界，避免跨书上下文拼接串味
        per_device_train_batch_size=2,
        gradient_accumulation_steps=8,
        warmup_ratio=0.05,
        num_train_epochs=NUM_EPOCHS,
        learning_rate=2e-4,
        fp16=not use_bf16,
        bf16=use_bf16,
        logging_steps=10,
        eval_strategy="steps" if val_dataset is not None else "no",
        eval_steps=50 if val_dataset is not None else None,
        optim="adamw_8bit",
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        seed=2026,
        output_dir=OUTPUT_DIR,
        save_strategy="steps",
        save_steps=100,
        save_total_limit=2,
        report_to="none",
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        args=sft_args,
    )
    trainer = train_on_responses_only(
        trainer,
        instruction_part="<|im_start|>user\n",
        response_part="<|im_start|>assistant\n",
    )

    # 5. 支持自动断点续训
    latest_ckpt = find_latest_checkpoint(OUTPUT_DIR)
    if latest_ckpt:
        print(f"检测到历史断点，将自动恢复训练: {latest_ckpt}")
    print("开始训练...")
    trainer_stats = trainer.train(resume_from_checkpoint=latest_ckpt)
    print("微调完成！训练耗时统计:", trainer_stats)

    # 6. 优先保存轻量化 LoRA 适配器权重（~150MB）
    lora_dir = os.path.join(OUTPUT_DIR, "lora_adapter")
    model.save_pretrained(lora_dir)
    tokenizer.save_pretrained(lora_dir)
    print(f"LoRA 权重已保存至: {lora_dir}")

    # 7. 释放训练器与数据集内存后再导出 GGUF，降低 16GB/低 RAM 机器 OOM 风险
    if SKIP_GGUF:
        print("已设置 MOLAN_SKIP_GGUF=1，跳过 GGUF 导出。")
        return

    del trainer, train_dataset, val_dataset
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    gguf_dir = os.path.join(OUTPUT_DIR, "gguf")
    print("正在合并权重并导出 GGUF (Q4_K_M 量化版本，低内存安全模式)...")
    try:
        model.save_pretrained_gguf(
            gguf_dir,
            tokenizer,
            quantization_method="q4_k_m",
            maximum_memory_usage=0.4,
        )
        print(f"🎉 GGUF 模型已成功导出至: {gguf_dir}")
        print("可直接将 .gguf 文件拷贝回本机使用 Ollama 运行！")
    except Exception as e:
        print(f"[WARN] GGUF 自动转换失败（已保留完整 LoRA 适配器于 {lora_dir}）: {e}")


if __name__ == "__main__":
    main()
