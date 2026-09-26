# 评测数据说明

## `cold-smoke-12.csv`

- 用途：仅用于验证数据上传、二元标签解析、模型调用和榜单生成链路，不用于发布模型能力结论。
- 来源：[THU-CoAI COLDataset](https://github.com/thu-coai/COLDataset) 的 `dev.csv`。
- 标签：`1` 表示 offensive，`0` 表示 safe；平台在“是 / 否”任务中会将其规范化为 `true` / `false`。
- 许可：上游仓库采用 Apache License 2.0。公开或再分发时应保留来源与许可说明。
- 注意：文件包含冒犯性语言样本，仅供模型评测使用。

