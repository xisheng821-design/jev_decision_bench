"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BenchmarkShell from "./BenchmarkShell";
import { loadModels, loadSession } from "./storage";

export default function OverviewPage() {
  const [status, setStatus] = useState({ models: 0, rows: 0, hasReport: false });

  useEffect(() => {
    let active = true;
    void loadSession().then((session) => {
      if (!active) return;
      setStatus({
        models: loadModels().length,
        rows: session.dataset.length,
        hasReport: session.results.length > 0,
      });
    });
    return () => { active = false; };
  }, []);

  return (
    <BenchmarkShell current="overview">
      <section className="db-home-hero">
        <div className="db-hero-copy">
          <span className="db-kicker"><i /> MODEL EVALUATION PIPELINE / V2.0</span>
          <h1>用同一组数据，<br /><em>看清每个模型的边界。</em></h1>
          <p>连接自己的推理接口，上传带标准答案的数据集。系统会并行完成调用、评分、延迟统计和逐样本差异分析。</p>
          <div className="db-hero-actions">
            <Link className="db-primary-button" href="/models">开始配置模型 <span>→</span></Link>
            {status.hasReport && <Link className="db-ghost-button" href="/leaderboard">查看上次报告</Link>}
          </div>
        </div>
        <div className="db-signal-panel" aria-label="评测工作流概览">
          <div className="db-orbit orbit-one" />
          <div className="db-orbit orbit-two" />
          <div className="db-core"><span>DB</span><small>EVAL CORE</small></div>
          <div className="db-signal-node node-a"><i />INPUT<small>DATASET</small></div>
          <div className="db-signal-node node-b"><i />MODEL<small>ENDPOINTS</small></div>
          <div className="db-signal-node node-c"><i />DIFF<small>ANALYSIS</small></div>
          <div className="db-signal-metric"><span>10K</span><small>MAX ROWS</small></div>
          <div className="db-signal-metric second"><span>200</span><small>CONCURRENCY</small></div>
        </div>
      </section>

      <section className="db-status-rail">
        <div><span>已保存模型</span><strong>{status.models || "—"}</strong><small>LOCAL CONFIGS</small></div>
        <div><span>当前数据集</span><strong>{status.rows ? status.rows.toLocaleString() : "—"}</strong><small>DATA ROWS</small></div>
        <div><span>评测报告</span><strong>{status.hasReport ? "READY" : "EMPTY"}</strong><small>LAST SESSION</small></div>
        <p><i /> 所有配置与结果只保存在当前浏览器；模型请求由本机直接发起。</p>
      </section>

      <section className="db-home-section">
        <header className="db-section-title">
          <span>WORKFLOW</span>
          <h2>四步完成一次可复现评测</h2>
          <p>每一步独立成页，配置会自动保存，刷新后可以继续。</p>
        </header>
        <div className="db-flow-grid">
          <Link href="/models" className="db-flow-card accent-cyan">
            <span>01</span><i>MODEL MATRIX</i><h3>连接模型</h3>
            <p>配置 Jev、阿里云、火山方舟或腾讯云接口，模型参数自动保存在本机。</p>
            <em>CONFIGURE →</em>
          </Link>
          <Link href="/run" className="db-flow-card accent-violet">
            <span>02</span><i>DATA INGRESS</i><h3>上传数据</h3>
            <p>支持 CSV 与 JSON，最多 10,000 条样本，自动识别标签与任务类型。</p>
            <em>UPLOAD →</em>
          </Link>
          <Link href="/run" className="db-flow-card accent-blue">
            <span>03</span><i>PARALLEL RUN</i><h3>并行评测</h3>
            <p>自定义全局并发，按模型均衡分配请求槽位，实时观察进度与异常。</p>
            <em>EXECUTE →</em>
          </Link>
          <Link href="/leaderboard" className="db-flow-card accent-green">
            <span>04</span><i>RESULT INTELLIGENCE</i><h3>榜单与 Diff</h3>
            <p>比较准确率、延迟和成本，并逐条查看多个模型之间的答案分歧。</p>
            <em>ANALYZE →</em>
          </Link>
        </div>
      </section>
    </BenchmarkShell>
  );
}
