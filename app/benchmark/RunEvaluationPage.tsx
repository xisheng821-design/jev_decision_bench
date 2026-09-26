"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import BenchmarkShell from "./BenchmarkShell";
import {
  EvaluationResult,
  ModelConfig,
  TaskType,
  inferLabels,
  normalizeBinaryItems,
  parseDataset,
  rotateLabels,
} from "./benchmark";
import {
  BenchmarkSession,
  DEFAULT_BINARY_INSTRUCTION,
  DEFAULT_CHOICE_INSTRUCTION,
  EMPTY_SESSION,
  loadModels,
  loadSession,
  saveSession,
} from "./storage";

interface ApiResult {
  prediction?: string;
  confidence?: number | null;
  latencyMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number } | null;
  rawOutput?: string;
  error?: string;
}

interface ModelProgress {
  completed: number;
  errors: number;
}

function shuffled<T>(items: T[], seedOffset = 0): T[] {
  const output = [...items];
  let seed = 20260925 + seedOffset;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
}

function distributeConcurrency(total: number, modelCount: number): number[] {
  if (!modelCount) return [];
  const effective = Math.max(modelCount, Math.min(200, Math.round(total) || modelCount));
  const base = Math.floor(effective / modelCount);
  const remainder = effective % modelCount;
  return Array.from({ length: modelCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

export default function RunEvaluationPage() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [session, setSession] = useState<BenchmarkSession>({ ...EMPTY_SESSION });
  const [hydrated, setHydrated] = useState(false);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [completedCalls, setCompletedCalls] = useState(0);
  const [modelProgress, setModelProgress] = useState<Record<string, ModelProgress>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void loadSession().then((saved) => {
      if (!active) return;
      setModels(loadModels());
      setSession(saved);
      setHydrated(true);
    });
    return () => { active = false; };
  }, []);

  const validModels = useMemo(() => models.filter((model) =>
    model.name.trim() && model.apiKey.trim() && model.model.trim() && (model.provider === "jev" || model.baseUrl.trim()),
  ), [models]);
  const effectiveLabels = session.taskType === "binary" ? ["true", "false"] : session.labels;
  const callsPlanned = session.dataset.length * validModels.length;
  const concurrencySlots = distributeConcurrency(session.concurrency, validModels.length);
  const effectiveConcurrency = concurrencySlots.reduce((sum, value) => sum + value, 0);
  const progress = callsPlanned ? completedCalls / callsPlanned : 0;

  const persist = (next: BenchmarkSession) => {
    setSession(next);
    void saveSession(next);
  };

  const switchTaskType = (type: TaskType) => {
    if (type === session.taskType || running) return;
    persist({
      ...session,
      taskType: type,
      instruction: type === "choice" ? DEFAULT_CHOICE_INSTRUCTION : DEFAULT_BINARY_INSTRUCTION,
      datasetName: "",
      dataset: [],
      labels: [],
      results: [],
      runModels: [],
      generatedAt: null,
    });
    setDatasetError(null);
  };

  const handleDataset = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setDatasetError(null);
    try {
      if (!/\.(csv|json)$/i.test(file.name)) throw new Error("请选择 CSV 或 JSON 文件");
      let items = parseDataset(await file.text(), file.name);
      if (session.taskType === "binary") items = normalizeBinaryItems(items);
      const labels = session.taskType === "binary" ? ["true", "false"] : inferLabels(items);
      if (labels.length < 2) throw new Error("数据集至少需要两个不同的标准答案");
      if (labels.length > 100) throw new Error("当前版本最多支持 100 个候选标签");
      persist({
        ...session,
        datasetName: file.name,
        dataset: items,
        labels,
        results: [],
        runModels: [],
        generatedAt: null,
      });
    } catch (error) {
      setDatasetError(error instanceof Error ? error.message : "无法读取数据集");
    }
  };

  const setConcurrency = (value: number) => {
    const normalized = Math.min(200, Math.max(validModels.length || 1, Math.round(value) || 1));
    persist({ ...session, concurrency: normalized });
  };

  const validate = () => {
    if (validModels.length < 2) return "请先在模型配置页完成至少两个模型的参数";
    if (!session.dataset.length) return "请先上传测试数据集";
    if (!session.instruction.trim()) return "请填写任务说明";
    if (session.taskType === "choice" && effectiveLabels.length < 2) return "数据集至少需要两个标签";
    return null;
  };

  const runBenchmark = async () => {
    const invalid = validate();
    if (invalid) {
      setRunError(invalid);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setRunError(null);
    setCompletedCalls(0);
    const progressState = Object.fromEntries(validModels.map((model) => [model.id, { completed: 0, errors: 0 }]));
    setModelProgress(progressState);

    const collected: EvaluationResult[] = [];
    let finished = 0;
    const progressUpdateEvery = Math.max(1, Math.floor(callsPlanned / 500));

    const runModel = async (model: ModelConfig, modelIndex: number, workerCount: number) => {
      const jobs = shuffled(session.dataset.map((item, itemIndex) => ({ item, itemIndex })), modelIndex * 97);
      let cursor = 0;
      const worker = async () => {
        while (!controller.signal.aborted) {
          const jobIndex = cursor;
          cursor += 1;
          if (jobIndex >= jobs.length) return;
          const { item, itemIndex } = jobs[jobIndex];
          const localStartedAt = performance.now();
          let result: EvaluationResult;
          try {
            const response = await fetch("/api/benchmark/evaluate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                model,
                task: {
                  type: session.taskType,
                  instruction: session.instruction,
                  labels: session.taskType === "binary" ? ["true", "false"] : rotateLabels(effectiveLabels, itemIndex),
                },
                item,
              }),
            });
            const payload = (await response.json()) as ApiResult;
            if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
            const prediction = payload.prediction ?? null;
            result = {
              modelId: model.id,
              itemId: item.id,
              input: item.input,
              expected: item.expected,
              prediction,
              correct: prediction === item.expected,
              latencyMs: payload.latencyMs ?? Math.round(performance.now() - localStartedAt),
              confidence: payload.confidence ?? null,
              inputTokens: payload.usage?.inputTokens ?? 0,
              outputTokens: payload.usage?.outputTokens ?? 0,
              error: null,
              rawOutput: payload.rawOutput,
            };
          } catch (error) {
            if (controller.signal.aborted) return;
            result = {
              modelId: model.id,
              itemId: item.id,
              input: item.input,
              expected: item.expected,
              prediction: null,
              correct: false,
              latencyMs: Math.round(performance.now() - localStartedAt),
              confidence: null,
              inputTokens: 0,
              outputTokens: 0,
              error: error instanceof Error ? error.message : "请求失败",
            };
          }
          collected.push(result);
          finished += 1;
          progressState[model.id] = {
            completed: progressState[model.id].completed + 1,
            errors: progressState[model.id].errors + (result.error ? 1 : 0),
          };
          if (finished % progressUpdateEvery === 0 || finished === callsPlanned) {
            setCompletedCalls(finished);
            setModelProgress({ ...progressState });
          }
        }
      };
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    };

    try {
      await Promise.all(validModels.map((model, index) => runModel(model, index, concurrencySlots[index])));
      const next = {
        ...session,
        concurrency: effectiveConcurrency,
        results: collected,
        runModels: validModels,
        generatedAt: new Date().toISOString(),
      };
      await saveSession(next);
      setSession(next);
    } finally {
      setRunning(false);
      abortRef.current = null;
      if (controller.signal.aborted) {
        const next = {
          ...session,
          results: collected,
          runModels: validModels,
          generatedAt: collected.length ? new Date().toISOString() : null,
        };
        await saveSession(next);
        setSession(next);
        setRunError(`评测已停止，已保存 ${collected.length.toLocaleString()} 条调用结果`);
      }
    }
  };

  if (!hydrated) {
    return <BenchmarkShell current="run"><div className="db-loading-panel"><i />正在恢复本机评测工作区…</div></BenchmarkShell>;
  }

  return (
    <BenchmarkShell current="run">
      <header className="db-page-heading">
        <div><span>STEP 03 / DATA & EXECUTION</span><h1>上传数据并运行评测</h1><p>支持最多 10,000 条样本和 200 全局并发。请求槽位会均衡分配给所有参评模型。</p></div>
        <div className="db-heading-stat"><strong>{validModels.length}</strong><span>READY MODELS<small>{models.length - validModels.length ? `${models.length - validModels.length} 个配置不完整` : "全部可运行"}</small></span></div>
      </header>

      <section className="db-run-layout">
        <article className="db-control-panel">
          <header><span>01</span><div><small>TASK SCHEMA</small><h2>定义评测任务</h2></div></header>
          <div className="db-segmented">
            <button type="button" className={session.taskType === "choice" ? "active" : ""} onClick={() => switchTaskType("choice")} disabled={running}>多分类</button>
            <button type="button" className={session.taskType === "binary" ? "active" : ""} onClick={() => switchTaskType("binary")} disabled={running}>是 / 否</button>
          </div>
          <label className="db-field db-instruction-field"><span>任务说明</span><textarea rows={6} value={session.instruction} disabled={running} onChange={(event) => persist({ ...session, instruction: event.target.value, results: [], generatedAt: null })} /></label>
          <p className="db-info-note"><i>i</i> 所有模型接收相同的说明；多分类标签会按样本轮换顺序，减少位置偏差。</p>
        </article>

        <article className="db-control-panel db-upload-panel">
          <header><span>02</span><div><small>DATA INGESTION</small><h2>上传标准数据</h2></div></header>
          <input ref={fileInputRef} className="sr-only" type="file" accept=".csv,.json,text/csv,application/json" onChange={handleDataset} disabled={running} />
          <button className={`db-dropzone ${session.dataset.length ? "has-file" : ""}`} type="button" onClick={() => fileInputRef.current?.click()} disabled={running}>
            <span>↑</span><strong>{session.datasetName || "选择 CSV 或 JSON 文件"}</strong>
            <small>{session.dataset.length ? `${session.dataset.length.toLocaleString()} 条样本 · ${effectiveLabels.length} 个标签` : "包含 input 与 expected 字段 · 最多 10,000 条"}</small>
            <em>{session.dataset.length ? "更换数据集" : "浏览本机文件"}</em>
          </button>
          <div className="db-file-meta"><a href={session.taskType === "choice" ? "/samples/customer-routing.csv" : "/samples/human-handoff.csv"} download>下载格式示例</a><span>文件仅在当前浏览器中处理</span></div>
          {datasetError && <p className="db-error-message">{datasetError}</p>}
        </article>
      </section>

      <section className="db-format-guide" aria-labelledby="dataset-format-title">
        <header>
          <div>
            <small>DATA FORMAT GUIDE</small>
            <h2 id="dataset-format-title">上传前，请按这个格式准备数据</h2>
            <p>平台不会处理任意格式。请选择 UTF-8 编码的 CSV 或 JSON，并确保每条数据都包含输入内容和标准答案。</p>
          </div>
          <a href={session.taskType === "choice" ? "/samples/customer-routing.csv" : "/samples/human-handoff.csv"} download>↓ 下载当前任务示例</a>
        </header>

        <div className="db-format-overview">
          <article className="db-format-fields">
            <div className="db-format-card-title"><span>01</span><div><small>FIELD SCHEMA</small><strong>字段要求</strong></div></div>
            <dl>
              <div><dt><code>input</code><b>必填</b></dt><dd>发送给模型的文本、问题或消息。</dd></div>
              <div><dt><code>expected</code><b>必填</b></dt><dd>该样本的唯一标准答案或分类标签。</dd></div>
              <div><dt><code>id</code><em>可选</em></dt><dd>样本编号；省略时平台会自动生成。</dd></div>
              <div><dt><code>context</code><em>可选</em></dt><dd>提供给模型的背景信息或上下文。</dd></div>
            </dl>
            <p><i>自动识别别名</i><span><code>text / query / message</code> 可作为 input，<code>label / answer / target</code> 可作为 expected。</span></p>
          </article>

          <article className="db-format-example">
            <div className="db-format-card-title"><span>02</span><div><small>CSV EXAMPLE</small><strong>CSV 示例</strong></div></div>
            <pre><code>{session.taskType === "binary"
              ? `id,input,expected,context\n1,"这笔订单被重复扣款",是,"同一订单扣款两次"\n2,"怎样修改收货地址",否,""`
              : `id,input,expected,context\n1,"我的订单一直没有发货","物流咨询","已等待三天"\n2,"银行卡被重复扣款","支付问题","同一订单扣款两次"`}</code></pre>
            <p>内容包含逗号或换行时，请使用英文双引号包裹。</p>
          </article>

          <article className="db-format-example">
            <div className="db-format-card-title"><span>03</span><div><small>JSON EXAMPLE</small><strong>JSON 示例</strong></div></div>
            <pre><code>{session.taskType === "binary"
              ? `[{\n  "id": "1",\n  "input": "这笔订单被重复扣款",\n  "expected": true,\n  "context": "同一订单扣款两次"\n}]`
              : `[{\n  "id": "1",\n  "input": "我的订单一直没有发货",\n  "expected": "物流咨询",\n  "context": "已等待三天"\n}]`}</code></pre>
            <p>也支持 <code>{`{ "data": [...] }`}</code> 结构，不支持 JSONL。</p>
          </article>
        </div>

        <div className="db-format-rules">
          <div><span>文件类型</span><strong>CSV / JSON</strong><small>建议 UTF-8 编码</small></div>
          <div><span>数据上限</span><strong>10,000 条</strong><small>每行或每个对象算一条</small></div>
          <div><span>多分类标签</span><strong>2—100 个</strong><small>每条只能有一个标准答案</small></div>
          <div><span>是／否答案</span><strong>true / false</strong><small>也支持 是/否、1/0、yes/no</small></div>
          <p><i>!</i><span>Excel、JSONL、嵌套题目和一个样本包含多个正确答案，目前需要先转换为上述标准格式。</span></p>
        </div>
      </section>

      {session.dataset.length > 0 && (
        <section className="db-data-preview">
          <header><div><small>DATASET PREVIEW</small><h2>{session.datasetName}</h2></div><div className="db-label-cloud">{effectiveLabels.slice(0, 10).map((label) => <span key={label}>{label}</span>)}{effectiveLabels.length > 10 && <span>+{effectiveLabels.length - 10}</span>}</div></header>
          <div className="db-table-scroll"><table><thead><tr><th>ID</th><th>输入内容</th><th>标准答案</th></tr></thead><tbody>{session.dataset.slice(0, 5).map((item) => <tr key={item.id}><td>{item.id}</td><td>{item.input}</td><td><span>{item.expected}</span></td></tr>)}</tbody></table></div>
        </section>
      )}

      <section className="db-execution-panel">
        <div className="db-execution-head">
          <div><small>03 / PARALLEL EXECUTION</small><h2>运行评测</h2><p>全局并发会被均衡拆分到各个模型，每个模型保持独立请求队列。</p></div>
          <label className="db-concurrency-control"><span>全局并发数</span><div><input type="number" min={Math.max(validModels.length, 1)} max="200" value={session.concurrency} disabled={running} onChange={(event) => setConcurrency(Number(event.target.value))} /><small>/ 200</small></div></label>
        </div>
        <div className="db-allocation-grid">
          {validModels.map((model, index) => {
            const state = modelProgress[model.id] ?? { completed: session.results.filter((result) => result.modelId === model.id).length, errors: 0 };
            const percentage = session.dataset.length ? Math.min(100, (state.completed / session.dataset.length) * 100) : 0;
            return <div key={model.id} className="db-allocation-card"><header><span>{model.name}</span><b>{concurrencySlots[index] ?? 0} 并发</b></header><div><i style={{ width: `${percentage}%` }} /></div><footer><span>{state.completed.toLocaleString()} / {session.dataset.length.toLocaleString()}</span><em>{state.errors ? `${state.errors} 个异常` : "队列正常"}</em></footer></div>;
          })}
        </div>
        <div className="db-run-console">
          <div><span>预计请求</span><strong>{callsPlanned.toLocaleString()}</strong><small>{session.dataset.length.toLocaleString()} 样本 × {validModels.length} 模型</small></div>
          <div><span>有效并发</span><strong>{effectiveConcurrency || "—"}</strong><small>{validModels.length ? `平均每模型 ${(effectiveConcurrency / validModels.length).toFixed(1)}` : "等待模型配置"}</small></div>
          <div><span>执行进度</span><strong>{Math.round(progress * 100)}%</strong><small>{completedCalls.toLocaleString()} 次已完成</small></div>
          {running ? <button className="db-stop-button" type="button" onClick={() => abortRef.current?.abort()}>停止评测</button> : <button className="db-run-button" type="button" onClick={runBenchmark}><i>▶</i>开始评测</button>}
        </div>
        <div className="db-global-progress"><i style={{ width: `${progress * 100}%` }} /></div>
        {runError && <p className="db-error-message">{runError}</p>}
        {session.results.length > 0 && !running && <div className="db-report-ready"><span>✓</span><div><strong>评测结果已保存</strong><small>共 {session.results.length.toLocaleString()} 条模型调用结果</small></div><Link href="/leaderboard">查看榜单与 Diff 分析 →</Link></div>}
      </section>
    </BenchmarkShell>
  );
}
