export type CloudProvider = "jev" | "aliyun" | "volcengine" | "tencent";
export type TaskType = "choice" | "binary";

export interface ModelConfig {
  id: string;
  name: string;
  provider: CloudProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  inputPrice: number;
  outputPrice: number;
}

export interface DatasetItem {
  id: string;
  input: string;
  expected: string;
  context?: string;
}

export interface EvaluationResult {
  modelId: string;
  itemId: string;
  input: string;
  expected: string;
  prediction: string | null;
  correct: boolean;
  latencyMs: number;
  confidence: number | null;
  inputTokens: number;
  outputTokens: number;
  error: string | null;
  rawOutput?: string;
}

export interface ModelMetrics {
  model: ModelConfig;
  completed: number;
  correct: number;
  accuracy: number;
  macroF1: number;
  errorRate: number;
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  totalCost: number;
  averageConfidence: number | null;
}

export const PROVIDER_META: Record<CloudProvider, {
  name: string;
  short: string;
  description: string;
  color: string;
}> = {
  jev: {
    name: "Jev",
    short: "JV",
    description: "TypeSafe System One",
    color: "mint",
  },
  aliyun: {
    name: "阿里云百炼",
    short: "AL",
    description: "OpenAI 兼容接口",
    color: "orange",
  },
  volcengine: {
    name: "火山方舟",
    short: "VC",
    description: "推理接入点",
    color: "blue",
  },
  tencent: {
    name: "腾讯云 TokenHub",
    short: "TC",
    description: "OpenAI 兼容接口",
    color: "violet",
  },
};

const PRESET_BASE_URLS: Record<CloudProvider, string> = {
  jev: "https://api.typesafe.ai/v1/systemone",
  aliyun: "https://your-workspace-id.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  tencent: "https://tokenhub.tencentcloudmaas.com/v1",
};

const PRESET_MODELS: Record<CloudProvider, string> = {
  jev: "jev-latest",
  aliyun: "",
  volcengine: "",
  tencent: "hy4-preview",
};

let configSequence = 0;

export function createModelConfig(provider: CloudProvider): ModelConfig {
  configSequence += 1;
  const meta = PROVIDER_META[provider];
  return {
    id: `${provider}-${Date.now()}-${configSequence}`,
    name: meta.name,
    provider,
    apiKey: "",
    baseUrl: PRESET_BASE_URLS[provider],
    model: PRESET_MODELS[provider],
    inputPrice: provider === "jev" ? 0.042 : 0,
    outputPrice: 0,
  };
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

const FIELD_ALIASES = {
  id: ["id", "编号", "序号"],
  input: ["input", "text", "query", "content", "message", "输入", "文本", "问题", "消息"],
  expected: ["expected", "label", "answer", "target", "标准答案", "标签", "答案", "分类"],
  context: ["context", "上下文", "背景"],
};

function findColumn(headers: string[], aliases: string[]): number {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  return normalized.findIndex((header) => aliases.includes(header));
}

function primitiveToString(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value.trim() : "";
}

function normalizeItem(item: Record<string, unknown>, index: number): DatasetItem {
  const keys = Object.keys(item);
  const get = (aliases: string[]) => {
    const key = keys.find((candidate) => aliases.includes(candidate.trim().toLowerCase()));
    return key ? item[key] : undefined;
  };
  const input = primitiveToString(get(FIELD_ALIASES.input));
  const expected = primitiveToString(get(FIELD_ALIASES.expected));
  if (!input || !expected) throw new Error(`第 ${index + 1} 条数据缺少 input 或 expected`);
  return {
    id: primitiveToString(get(FIELD_ALIASES.id)) || String(index + 1),
    input,
    expected,
    context: primitiveToString(get(FIELD_ALIASES.context)) || undefined,
  };
}

export function parseDataset(content: string, filename: string): DatasetItem[] {
  const cleanContent = content.replace(/^\uFEFF/, "").trim();
  if (!cleanContent) throw new Error("数据集是空的");
  let items: DatasetItem[];

  if (filename.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(cleanContent) as unknown;
    const array = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown }).data)
        ? (parsed as { data: unknown[] }).data
        : null;
    if (!array) throw new Error("JSON 必须是数组，或包含 data 数组");
    items = array.map((item, index) => {
      if (!item || typeof item !== "object") throw new Error(`第 ${index + 1} 条数据格式不正确`);
      return normalizeItem(item as Record<string, unknown>, index);
    });
  } else {
    const rows = parseCsvRows(cleanContent);
    if (rows.length < 2) throw new Error("CSV 至少需要一行表头和一行数据");
    const headers = rows[0].map((header) => header.trim());
    const inputIndex = findColumn(headers, FIELD_ALIASES.input);
    const expectedIndex = findColumn(headers, FIELD_ALIASES.expected);
    const idIndex = findColumn(headers, FIELD_ALIASES.id);
    const contextIndex = findColumn(headers, FIELD_ALIASES.context);
    if (inputIndex < 0 || expectedIndex < 0) {
      throw new Error("没有找到 input 和 expected 两列");
    }
    items = rows.slice(1).map((row, index) => ({
      id: (idIndex >= 0 ? row[idIndex]?.trim() : "") || String(index + 1),
      input: row[inputIndex]?.trim() ?? "",
      expected: row[expectedIndex]?.trim() ?? "",
      context: contextIndex >= 0 ? row[contextIndex]?.trim() || undefined : undefined,
    }));
    const invalidIndex = items.findIndex((item) => !item.input || !item.expected);
    if (invalidIndex >= 0) throw new Error(`第 ${invalidIndex + 2} 行缺少 input 或 expected`);
  }

  if (!items.length) throw new Error("数据集中没有可评测的数据");
  if (items.length > 10_000) throw new Error("单次最多评测 10,000 条数据");
  const uniqueIds = new Set<string>();
  return items.map((item, index) => {
    let id = item.id;
    if (uniqueIds.has(id)) id = `${id}-${index + 1}`;
    uniqueIds.add(id);
    return { ...item, id };
  });
}

export function normalizeBinaryItems(items: DatasetItem[]): DatasetItem[] {
  return items.map((item, index) => {
    const value = item.expected.trim().toLowerCase();
    if (["true", "yes", "1", "是", "正确", "符合"].includes(value)) {
      return { ...item, expected: "true" };
    }
    if (["false", "no", "0", "否", "错误", "不符合"].includes(value)) {
      return { ...item, expected: "false" };
    }
    throw new Error(`第 ${index + 1} 条数据的答案不是可识别的是/否值`);
  });
}

export function inferLabels(items: DatasetItem[]): string[] {
  return [...new Set(items.map((item) => item.expected))];
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index];
}

function macroF1(results: EvaluationResult[], labels: string[]): number {
  if (!labels.length) return 0;
  const scores = labels.map((label) => {
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    for (const result of results) {
      if (result.expected === label && result.prediction === label) truePositive += 1;
      else if (result.expected !== label && result.prediction === label) falsePositive += 1;
      else if (result.expected === label && result.prediction !== label) falseNegative += 1;
    }
    const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 0;
    const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 0;
    return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  });
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

export function calculateMetrics(
  models: ModelConfig[],
  results: EvaluationResult[],
  labels: string[],
): ModelMetrics[] {
  return models.map((model) => {
    const modelResults = results.filter((result) => result.modelId === model.id);
    const successfulLatencies = modelResults
      .filter((result) => !result.error)
      .map((result) => result.latencyMs);
    const confidenceValues = modelResults
      .map((result) => result.confidence)
      .filter((value): value is number => typeof value === "number");
    const totalInputTokens = modelResults.reduce((sum, result) => sum + result.inputTokens, 0);
    const totalOutputTokens = modelResults.reduce((sum, result) => sum + result.outputTokens, 0);
    const correct = modelResults.filter((result) => result.correct).length;
    return {
      model,
      completed: modelResults.length,
      correct,
      accuracy: modelResults.length ? correct / modelResults.length : 0,
      macroF1: macroF1(modelResults, labels),
      errorRate: modelResults.length
        ? modelResults.filter((result) => result.error).length / modelResults.length
        : 0,
      averageLatency: successfulLatencies.length
        ? successfulLatencies.reduce((sum, value) => sum + value, 0) / successfulLatencies.length
        : 0,
      p50Latency: percentile(successfulLatencies, 0.5),
      p95Latency: percentile(successfulLatencies, 0.95),
      totalCost:
        (totalInputTokens * model.inputPrice + totalOutputTokens * model.outputPrice) / 1_000_000,
      averageConfidence: confidenceValues.length
        ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
        : null,
    };
  }).sort((left, right) =>
    right.accuracy - left.accuracy ||
    left.errorRate - right.errorRate ||
    left.p95Latency - right.p95Latency ||
    left.totalCost - right.totalCost,
  );
}

export function rotateLabels(labels: string[], offset: number): string[] {
  if (!labels.length) return labels;
  const normalizedOffset = offset % labels.length;
  return [...labels.slice(normalizedOffset), ...labels.slice(0, normalizedOffset)];
}
