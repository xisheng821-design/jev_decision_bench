"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import BenchmarkShell from "./BenchmarkShell";
import { EvaluationResult, ModelConfig, calculateMetrics } from "./benchmark";
import { BenchmarkSession, EMPTY_SESSION, loadSession } from "./storage";

type DiffFilter = "all" | "disagreement" | "failure";

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatLatency(value: number) {
  if (!value) return "—";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function formatCost(value: number) {
  if (!value) return "$0.0000";
  if (value < 0.0001) return "< $0.0001";
  return `$${value.toFixed(4)}`;
}

function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, rows: string[][]) {
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

interface DiffRow {
  itemId: string;
  input: string;
  expected: string;
  results: Map<string, EvaluationResult>;
  disagreement: boolean;
  failure: boolean;
  unanimousCorrect: boolean;
  anyCorrect: boolean;
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-").replace(/^-|-$/g, "") || "benchmark";
}

export default function LeaderboardPage() {
  const [session, setSession] = useState<BenchmarkSession>({ ...EMPTY_SESSION });
  const [hydrated, setHydrated] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<DiffFilter>("disagreement");

  useEffect(() => {
    let active = true;
    void loadSession().then((saved) => {
      if (!active) return;
      setSession(saved);
      setSelectedIds(saved.runModels.map((model) => model.id));
      setHydrated(true);
    });
    return () => { active = false; };
  }, []);

  const labels = useMemo(
    () => session.taskType === "binary" ? ["true", "false"] : session.labels,
    [session.labels, session.taskType],
  );
  const metrics = useMemo(
    () => calculateMetrics(session.runModels, session.results, labels),
    [labels, session.results, session.runModels],
  );
  const selectedModels = useMemo(
    () => session.runModels.filter((model) => selectedIds.includes(model.id)),
    [selectedIds, session.runModels],
  );
  const resultMap = useMemo(() => {
    const map = new Map<string, EvaluationResult>();
    for (const result of session.results) map.set(`${result.modelId}:${result.itemId}`, result);
    return map;
  }, [session.results]);
  const diffRows = useMemo<DiffRow[]>(() => session.dataset.map((item) => {
    const results = new Map<string, EvaluationResult>();
    selectedModels.forEach((model) => {
      const result = resultMap.get(`${model.id}:${item.id}`);
      if (result) results.set(model.id, result);
    });
    const values = [...results.values()];
    const predictions = new Set(values.map((result) => result.error ? `ERROR:${result.error}` : result.prediction ?? "NULL"));
    return {
      itemId: item.id,
      input: item.input,
      expected: item.expected,
      results,
      disagreement: values.length >= 2 && predictions.size > 1,
      failure: values.some((result) => !result.correct || Boolean(result.error)),
      unanimousCorrect: values.length === selectedModels.length && values.every((result) => result.correct),
      anyCorrect: values.some((result) => result.correct),
    };
  }), [resultMap, selectedModels, session.dataset]);

  const filteredRows = useMemo(() => {
    const rows = diffRows.filter((row) =>
      filter === "all" ? true : filter === "disagreement" ? row.disagreement : row.failure,
    );
    return rows.sort((left, right) => Number(right.disagreement) - Number(left.disagreement) || Number(right.failure) - Number(left.failure));
  }, [diffRows, filter]);
  const disagreementCount = diffRows.filter((row) => row.disagreement).length;
  const unanimousCorrectCount = diffRows.filter((row) => row.unanimousCorrect).length;
  const anyCorrectCount = diffRows.filter((row) => row.anyCorrect).length;

  const toggleModel = (id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.length <= 2 ? current : current.filter((value) => value !== id);
      return [...current, id];
    });
  };

  const exportDiff = () => {
    const header = ["id", "input", "expected"];
    selectedModels.forEach((model) => {
      header.push(`${model.name}_prediction`, `${model.name}_correct`, `${model.name}_latency_ms`, `${model.name}_raw_output`, `${model.name}_error`);
    });
    const body = filteredRows.map((row) => {
      const cells = [row.itemId, row.input, row.expected];
      selectedModels.forEach((model) => {
        const result = row.results.get(model.id);
        cells.push(result?.prediction ?? "", result ? String(result.correct) : "", result ? String(result.latencyMs) : "", result?.rawOutput ?? "", result?.error ?? "");
      });
      return cells;
    });
    downloadCsv(`${safeName(session.datasetName)}-${filter}-diff.csv`, [header, ...body]);
  };

  if (!hydrated) return <BenchmarkShell current="leaderboard"><div className="db-loading-panel"><i />正在载入本机评测报告…</div></BenchmarkShell>;

  if (!session.results.length || !session.runModels.length) {
    return (
      <BenchmarkShell current="leaderboard">
        <section className="db-empty-report"><span>∅</span><small>NO REPORT FOUND</small><h1>还没有可以分析的评测结果</h1><p>完成模型配置并运行一次评测后，这里会生成榜单和逐样本 Diff。</p><Link className="db-primary-button" href="/run">前往运行评测 <b>→</b></Link></section>
      </BenchmarkShell>
    );
  }

  const bestAccuracy = metrics[0]?.accuracy ?? 0;
  const fastest = [...metrics].sort((a, b) => a.p50Latency - b.p50Latency)[0];

  return (
    <BenchmarkShell current="leaderboard">
      <header className="db-page-heading db-report-heading">
        <div><span>STEP 04 / RESULT INTELLIGENCE</span><h1>榜单与差异分析</h1><p>{session.datasetName} · {session.dataset.length.toLocaleString()} 条样本 · {session.runModels.length} 个模型</p></div>
        <div className="db-report-time"><span>REPORT GENERATED</span><strong>{session.generatedAt ? new Date(session.generatedAt).toLocaleString("zh-CN") : "—"}</strong></div>
      </header>

      <section className="db-report-kpis">
        <div><span>最高准确率</span><strong>{formatPercent(bestAccuracy)}</strong><small>{metrics[0]?.model.name}</small></div>
        <div><span>最快 P50</span><strong>{formatLatency(fastest?.p50Latency ?? 0)}</strong><small>{fastest?.model.name}</small></div>
        <div><span>模型分歧样本</span><strong>{disagreementCount.toLocaleString()}</strong><small>{formatPercent(diffRows.length ? disagreementCount / diffRows.length : 0)} OF DATASET</small></div>
        <div><span>至少一个模型答对</span><strong>{anyCorrectCount.toLocaleString()}</strong><small>{formatPercent(diffRows.length ? anyCorrectCount / diffRows.length : 0)} COVERAGE</small></div>
      </section>

      <section className="db-ranking-section">
        <header className="db-section-title inline"><div><span>LEADERBOARD</span><h2>综合榜单</h2></div><p>准确率优先；同分时依次比较错误率、P95 延迟和估算成本。</p></header>
        <div className="db-rank-grid">
          {metrics.map((metric, index) => (
            <article className={`db-rank-card rank-${index + 1}`} key={metric.model.id}>
              <header><span>#{index + 1}</span><div><strong>{metric.model.name}</strong><small>{metric.model.provider.toUpperCase()}</small></div></header>
              <div className="db-rank-score"><strong>{formatPercent(metric.accuracy)}</strong><span>ACCURACY</span></div>
              <div className="db-score-bar"><i style={{ width: `${metric.accuracy * 100}%` }} /></div>
              <dl>
                <div><dt>正确</dt><dd>{metric.correct} / {metric.completed}</dd></div>
                <div><dt>Macro-F1</dt><dd>{formatPercent(metric.macroF1)}</dd></div>
                <div><dt>P50</dt><dd>{formatLatency(metric.p50Latency)}</dd></div>
                <div><dt>P95</dt><dd>{formatLatency(metric.p95Latency)}</dd></div>
                <div><dt>错误率</dt><dd>{formatPercent(metric.errorRate)}</dd></div>
                <div><dt>估算成本</dt><dd>{formatCost(metric.totalCost)}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="db-diff-section">
        <header className="db-diff-heading">
          <div><span>MODEL DIFF</span><h2>逐样本输出对比</h2><p>选择至少两个模型并排比较。页面最多展示 100 条，CSV 会导出当前筛选条件下的全部结果。</p></div>
          <button type="button" onClick={exportDiff}>↓ 导出 CSV</button>
        </header>
        <div className="db-diff-toolbar">
          <div className="db-model-selector"><span>对比模型</span>{session.runModels.map((model) => <label key={model.id} className={selectedIds.includes(model.id) ? "selected" : ""}><input type="checkbox" checked={selectedIds.includes(model.id)} onChange={() => toggleModel(model.id)} /><i />{model.name}</label>)}</div>
          <div className="db-filter-tabs">
            <button type="button" className={filter === "disagreement" ? "active" : ""} onClick={() => setFilter("disagreement")}>只看分歧 <span>{disagreementCount}</span></button>
            <button type="button" className={filter === "failure" ? "active" : ""} onClick={() => setFilter("failure")}>至少一个错误 <span>{diffRows.filter((row) => row.failure).length}</span></button>
            <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部 <span>{diffRows.length}</span></button>
          </div>
        </div>
        <div className="db-analysis-strip">
          <div><span>完全一致且正确</span><strong>{unanimousCorrectCount.toLocaleString()}</strong></div>
          <div><span>存在模型分歧</span><strong>{disagreementCount.toLocaleString()}</strong></div>
          <div><span>当前筛选结果</span><strong>{filteredRows.length.toLocaleString()}</strong></div>
          <p>正在展示前 <b>{Math.min(100, filteredRows.length)}</b> 条</p>
        </div>

        {filteredRows.length ? (
          <div className="db-diff-list">
            {filteredRows.slice(0, 100).map((row, index) => (
              <article key={row.itemId} className="db-diff-row">
                <header><span>{String(index + 1).padStart(3, "0")}</span><div><small>ID {row.itemId}</small><p>{row.input}</p></div><b>标准答案：{row.expected}</b></header>
                <div className="db-output-grid" style={{ gridTemplateColumns: `repeat(${selectedModels.length}, minmax(220px, 1fr))` }}>
                  {selectedModels.map((model: ModelConfig) => {
                    const result = row.results.get(model.id);
                    return <div key={model.id} className={!result || !result.correct ? "is-wrong" : "is-correct"}><header><span>{model.name}</span><small>{result ? formatLatency(result.latencyMs) : "无结果"}</small></header><strong>{result?.prediction ?? "—"}</strong>{result?.rawOutput && result.rawOutput !== result.prediction && <p>{result.rawOutput}</p>}<footer>{result?.error ? <em>{result.error}</em> : result?.correct ? <span>✓ 正确</span> : <em>× 与标准答案不同</em>}</footer></div>;
                  })}
                </div>
              </article>
            ))}
          </div>
        ) : <div className="db-no-diff"><span>✓</span><strong>当前筛选条件下没有样本</strong><p>可以切换到“全部”查看模型的完整输出。</p></div>}
      </section>

      <footer className="db-page-actions"><Link className="db-ghost-button" href="/run">← 返回评测页</Link><Link className="db-primary-button" href="/models">调整模型配置 <span>→</span></Link></footer>
    </BenchmarkShell>
  );
}
