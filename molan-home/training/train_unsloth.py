#!/usr/bin/env python3
"""
train_unsloth.py
-----------------------------------------------------------------------------
墨阑 1,279 本真人小说 Qwen2.5-7B LoRA 极速微调脚本 (基于 Unsloth)
- 显存优化: 相比原生 PyTorch 节省 70% 显存，训练提速 2 倍
- 支持硬件: 单卡 RTX 3090 / 4090 (24GB) 或 A10 / T4 (16GB)
- 产出目标: 自动合并 LoRA 权重并一键导出 GGUF (q4_k_m) 用于本机 AMD 8845HS Ollama 推理
-----------------------------------------------------------------------------
"""

import os
import sys
import torch
from datasets import load_dataset
from trl import SFTTrainer
from transformers import TrainingArguments

# 导入 Unsloth
try:
    from unsloth import FastLanguageModel
    from unsloth import is_bfloat16_supported
except ImportError:
    print("[ERROR] 请先安装 unsloth: pip install \"unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git\"")
    sys.exit(1)

# 配置参数
MODEL_NAME = "Qwen/Qwen2.5-7B-Instruct" # 亦可用国内镜像 "modelscope/qwen/Qwen2.5-7B-Instruct"
MAX_SEQ_LENGTH = 2048
DTYPE = None # None 表示自动检测 (bf16 / fp16)
LOAD_IN_4BIT = True # 开启 4-bit 量化训练，仅需 ~7GB 显存！若 24GB 显存可设为 False

DATASET_PATH = "./data/train_sharegpt.jsonl"
OUTPUT_DIR = "./output/qwen2.5-7b-molan-unsloth"

def main():
    print("=" * 70)
    print("【墨阑去AI味小说 LoRA 微调】Unsloth 极速启动")
    print(f"- 基础模型: {MODEL_NAME}")
    print(f"- 上下文截断长度: {MAX_SEQ_LENGTH}")
    print(f"- 4-bit 量化加载: {LOAD_IN_4BIT}")
    print("=" * 70)

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
        r=64,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        lora_alpha=128,
        lora_dropout=0, # Unsloth 优化: dropout=0 最快且无损
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=2026,
        max_seq_length=MAX_SEQ_LENGTH,
    )

    # 3. 加载 ShareGPT 格式数据集
    print(f"正在加载数据集: {DATASET_PATH} ...")
    dataset = load_dataset("json", data_files=DATASET_PATH, split="train")

    def formatting_prompts_func(examples):
        convos = examples["messages"]
        texts = []
        for convo in convos:
            formatted = tokenizer.apply_chat_template(
                convo,
                tokenize=False,
                add_generation_prompt=False
            )
            texts.append(formatted)
        return {"text": texts}

    dataset = dataset.map(formatting_prompts_func, batched=True)

    # 4. 配置训练参数
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=MAX_SEQ_LENGTH,
        dataset_num_proc=2,
        packing=False, # 短样本不强行打包以保留单章自然边界
        args=TrainingArguments(
            per_device_train_batch_size=4,
            gradient_accumulation_steps=4,
            warmup_ratio=0.05,
            num_train_epochs=2.0,
            learning_rate=2e-4,
            fp16=not is_bfloat16_supported(),
            bf16=is_bfloat16_supported(),
            logging_steps=10,
            optim="adamw_8bit",
            weight_decay=0.01,
            lr_scheduler_type="cosine",
            seed=2026,
            output_dir=OUTPUT_DIR,
            save_strategy="steps",
            save_steps=200,
            save_total_limit=2,
        ),
    )

    # 5. 执行微调
    print("开始训练...")
    trainer_stats = trainer.train()
    print("微调完成！训练耗时统计:", trainer_stats)

    # 6. 保存 LoRA 适配器权重
    lora_dir = os.path.join(OUTPUT_DIR, "lora_adapter")
    model.save_pretrained(lora_dir)
    tokenizer.save_pretrained(lora_dir)
    print(f"LoRA 权重已保存至: {lora_dir}")

    # 7. 一键导出 GGUF 格式 (用于本机 Ollama / llama.cpp 推理)
    gguf_dir = os.path.join(OUTPUT_DIR, "gguf")
    print("正在合并权重并转换导出 GGUF (Q4_K_M 量化版本)...")
    try:
        model.save_pretrained_gguf(gguf_dir, tokenizer, quantization_method="q4_k_m")
        print(f"🎉 GGUF 模型已成功导出至: {gguf_dir}")
        print("可直接将 .gguf 文件拷贝回本机使用 Ollama 运行！")
    except Exception as e:
        print(f"[WARN] GGUF 自动转换跳过或需手动处理: {e}")

if __name__ == "__main__":
    main()
