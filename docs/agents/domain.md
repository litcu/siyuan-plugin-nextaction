# 领域文档

工程技能探索代码库时，应按照本文件使用仓库的领域文档。

## 开始探索前读取

- 根目录的 **`CONTEXT.md`**；或者
- 如果根目录存在 **`CONTEXT-MAP.md`**，由它指向各上下文的 `CONTEXT.md`，读取与当前主题有关的文件。
- **`docs/adr/`**：读取涉及当前工作区域的 ADR。多上下文仓库还应检查 `src/<context>/docs/adr/` 中限定于对应上下文的决策。

如果这些文件不存在，**直接继续，不作提示**。不要报告缺失，也不要预先建议创建。`/domain-modeling` 技能（可通过 `/grill-with-docs` 和 `/improve-codebase-architecture` 使用）会在术语或决策真正明确后按需创建这些文件。

## 文件结构

本仓库采用单上下文布局：

```text
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库以根目录存在 `CONTEXT-MAP.md` 为标志：

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 上下文专属决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用术语表中的词汇

当输出内容需要命名领域概念时——例如 Issue 标题、重构提案、假设或测试名称——使用 `CONTEXT.md` 中定义的术语。不要改用术语表明确排除的同义词。

如果术语表尚未包含所需概念，这通常意味着正在使用项目未采用的语言，应重新考虑；也可能意味着领域模型存在真实缺口，应将其记录下来，供 `/domain-modeling` 处理。

## 标明与 ADR 的冲突

如果输出与现有 ADR 冲突，应明确指出，而不是静默覆盖：

> 与 ADR-0007（事件溯源订单）冲突，但值得重新讨论，因为……
