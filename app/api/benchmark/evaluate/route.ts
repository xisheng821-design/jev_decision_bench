import { NextResponse } from "next/server";

type CloudProvider = "jev" | "aliyun" | "volcengine" | "tencent";
type TaskType = "choice" | "binary";

interface ModelInput {
  id: string;
  name: string;
  provider: CloudProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface TaskInput {
  type: TaskType;
  instruction: string;
  labels: string[];
}

interface DatasetItemInput {
  id: string;
  input: string;
  expected: string;
  context?: string;
}

interface EvaluateRequest {
  model: ModelInput;
  task: TaskInput;
  item: DatasetItemInput;
}

interface UsageShape {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

const ALLOWED_HOSTS: Record<Exclude<CloudProvider, "jev">, RegExp[]> = {
  aliyun: [/(^|\.)dashscope\.aliyuncs\.com$/i, /(^|\.)maas\.aliyuncs\.com$/i],
  volcengine: [/(^|\.)volces\.com$/i],
  tencent: [
    /(^|\.)hunyuan\.cloud\.tencent\.com$/i,
    /(^|\.)tencentcloudmaas\.com$/i,
    /(^|\.)tencentcloudmaas\.tech$/i,
  ],
};

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} 不能为空`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${field} 过长`);
  return normalized;
}

function normalizeRequest(value: unknown): EvaluateRequest {
  const body = value as Partial<EvaluateRequest>;
  if (!body.model || !body.task || !body.item) throw new Error("评测请求不完整");

  const provider = body.model.provider;
  if (!provider || !["jev", "aliyun", "volcengine", "tencent"].includes(provider)) {
    throw new Error("不支持的模型服务商");
  }
  const type = body.task.type;
  if (type !== "choice" && type !== "binary") throw new Error("不支持的任务类型");

  const labels = Array.isArray(body.task.labels)
    ? body.task.labels.map((label) => text(label, "标签", 160))
    : [];
  if (type === "choice" && (labels.length < 2 || labels.length > 100)) {
    throw new Error("多分类任务需要 2—100 个候选标签");
  }

  const normalized: EvaluateRequest = {
    model: {
      id: text(body.model.id, "模型 ID", 100),
      name: text(body.model.name, "模型名称", 100),
      provider,
      apiKey: text(body.model.apiKey, "API Key", 500),
      baseUrl: provider === "jev" ? "https://api.typesafe.ai/v1/systemone" : text(body.model.baseUrl, "API 地址", 500),
      model: text(body.model.model, "模型或推理节点", 200),
    },
    task: {
      type,
      instruction: text(body.task.instruction, "任务说明", 4000),
      labels: type === "binary" ? ["true", "false"] : [...new Set(labels)],
    },
    item: {
      id: text(body.item.id, "数据 ID", 200),
      input: text(body.item.input, "测试输入", 30000),
      expected: text(body.item.expected, "标准答案", 200),
      context: typeof body.item.context === "string" ? body.item.context.slice(0, 30000) : "",
    },
  };

  if (!normalized.task.labels.includes(normalized.item.expected)) {
    throw new Error(`标准答案“${normalized.item.expected}”不在候选标签中`);
  }

  return normalized;
}

function validateProviderUrl(provider: Exclude<CloudProvider, "jev">, baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("API 地址格式不正确");
  }
  if (url.protocol !== "https:") throw new Error("API 地址必须使用 HTTPS");
  if (!ALLOWED_HOSTS[provider].some((pattern) => pattern.test(url.hostname))) {
    throw new Error("API 地址与所选云服务商不匹配");
  }
  return url;
}

function chatCompletionsUrl(provider: Exclude<CloudProvider, "jev">, baseUrl: string): string {
  const url = validateProviderUrl(provider, baseUrl);
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  if (!normalizedPath.endsWith("/chat/completions")) {
    url.pathname = `${normalizedPath}/chat/completions`.replace(/\/{2,}/g, "/");
  }
  return url.toString();
}

async function providerFetch(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizedUsage(usage?: UsageShape | null) {
  if (!usage) return null;
  return {
    inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
    totalTokens:
      usage.total_tokens ??
      (usage.prompt_tokens ?? usage.input_tokens ?? 0) +
        (usage.completion_tokens ?? usage.output_tokens ?? 0),
  };
}

function stripCodeFence(content: string): string {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseModelAnswer(content: string, task: TaskInput): string {
  const cleaned = stripCodeFence(content);
  let candidate: unknown;
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    candidate = parsed.label ?? parsed.answer ?? parsed.result ?? parsed.category;
  } catch {
    const objectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]) as Record<string, unknown>;
        candidate = parsed.label ?? parsed.answer ?? parsed.result ?? parsed.category;
      } catch {
        candidate = cleaned;
      }
    } else {
      candidate = cleaned;
    }
  }

  if (task.type === "binary") {
    if (typeof candidate === "boolean") return candidate ? "true" : "false";
    const value = String(candidate ?? "").trim().toLowerCase();
    if (["true", "yes", "1", "是", "正确", "符合"].includes(value)) return "true";
    if (["false", "no", "0", "否", "错误", "不符合"].includes(value)) return "false";
    throw new Error("模型没有返回可识别的是/否答案");
  }

  const value = String(candidate ?? "").trim();
  const exact = task.labels.find((label) => label === value);
  if (exact) return exact;
  const insensitive = task.labels.find((label) => label.toLowerCase() === value.toLowerCase());
  if (insensitive) return insensitive;
  const mentioned = task.labels.filter((label) => cleaned.includes(label));
  if (mentioned.length === 1) return mentioned[0];
  throw new Error("模型输出不在候选标签中");
}

async function evaluateWithJev(body: EvaluateRequest) {
  const questionKey = "prediction";
  const questions = body.task.type === "choice"
    ? {
        [questionKey]: {
          type: "choice",
          instructions: body.task.instruction,
          criteria: Object.fromEntries(
            body.task.labels.map((label, index) => [
              `option_${index + 1}`,
              `Select this option when the correct label is exactly: ${label}`,
            ]),
          ),
        },
      }
    : {
        [questionKey]: {
          type: "noul",
          instructions: `${body.task.instruction}\nReturn yes only when the statement should be classified as true.`,
        },
      };

  const startedAt = performance.now();
  const response = await providerFetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${body.model.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: body.model.model,
      state: {
        input: body.item.input,
        ...(body.item.context ? { context: body.item.context } : {}),
      },
      questions,
    }),
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  const payload = (await response.json()) as {
    answers?: Record<string, { choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number }>;
    choices?: Record<string, { choice?: string; confidence?: number; probabilities?: Record<string, number> }>;
    nouls?: Record<string, { noul?: number }>;
    usage?: UsageShape;
    detail?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(payload.detail || payload.message || `Jev 请求失败（${response.status}）`);
  }

  if (body.task.type === "binary") {
    const answer = payload.answers?.[questionKey] ?? payload.nouls?.[questionKey];
    const probability = answer?.noul;
    if (typeof probability !== "number") throw new Error("Jev 没有返回 Noul 概率");
    return {
      prediction: probability >= 0.5 ? "true" : "false",
      confidence: probability >= 0.5 ? probability : 1 - probability,
      latencyMs,
      usage: normalizedUsage(payload.usage),
    };
  }

  const answer = payload.answers?.[questionKey] ?? payload.choices?.[questionKey];
  const choice = answer?.choice;
  const match = /^option_(\d+)$/.exec(choice ?? "");
  const index = match ? Number(match[1]) - 1 : -1;
  if (index < 0 || index >= body.task.labels.length) throw new Error("Jev 返回了未知选项");
  return {
    prediction: body.task.labels[index],
    confidence: answer?.confidence ?? answer?.probabilities?.[choice ?? ""] ?? null,
    latencyMs,
    usage: normalizedUsage(payload.usage),
  };
}

async function evaluateWithCompatibleModel(body: EvaluateRequest) {
  if (body.model.provider === "jev") throw new Error("模型类型不匹配");
  const endpoint = chatCompletionsUrl(body.model.provider, body.model.baseUrl);
  const outputRule = body.task.type === "binary"
    ? '只返回 JSON：{"answer":true} 或 {"answer":false}。'
    : `只返回 JSON：{"label":"候选标签原文"}。label 必须严格取自候选标签。`;

  const requestBody: Record<string, unknown> = {
    model: body.model.model,
    messages: [
      {
        role: "system",
        content: [
          "你是一个用于可复现评测的分类器。",
          "不要解释答案，不要输出 Markdown。",
          outputRule,
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          instruction: body.task.instruction,
          input: body.item.input,
          ...(body.item.context ? { context: body.item.context } : {}),
          ...(body.task.type === "choice" ? { labels: body.task.labels } : {}),
        }),
      },
    ],
    temperature: 0,
    max_tokens: 96,
    stream: false,
  };

  if (body.model.provider === "volcengine") requestBody.thinking = { type: "disabled" };
  if (body.model.provider === "aliyun") requestBody.enable_thinking = false;

  const startedAt = performance.now();
  const response = await providerFetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${body.model.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    usage?: UsageShape;
    error?: { message?: string };
    message?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || payload.message || `模型请求失败（${response.status}）`);
  }

  const rawContent = payload.choices?.[0]?.message?.content;
  const content = typeof rawContent === "string"
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map((part) => part.text ?? "").join("")
      : "";
  if (!content) throw new Error("模型返回了空结果");

  return {
    prediction: parseModelAnswer(content, body.task),
    confidence: null,
    latencyMs,
    usage: normalizedUsage(payload.usage),
    rawOutput: content.slice(0, 500),
  };
}

export async function POST(request: Request) {
  try {
    const body = normalizeRequest(await request.json());
    const result = body.model.provider === "jev"
      ? await evaluateWithJev(body)
      : await evaluateWithCompatibleModel(body);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.name === "AbortError" ? "请求超时" : error.message
      : "评测请求失败";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
