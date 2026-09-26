"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import BenchmarkShell from "./BenchmarkShell";
import { CloudProvider, ModelConfig, PROVIDER_META, createModelConfig } from "./benchmark";
import { clearModels, loadModels, saveModels } from "./storage";

function ModelEditor({
  model,
  index,
  removable,
  onChange,
  onRemove,
}: {
  model: ModelConfig;
  index: number;
  removable: boolean;
  onChange: (next: ModelConfig) => void;
  onRemove: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const meta = PROVIDER_META[model.provider];
  const update = <Key extends keyof ModelConfig>(key: Key, value: ModelConfig[Key]) => {
    onChange({ ...model, [key]: value });
  };

  return (
    <article className={`db-model-card provider-${meta.color}`}>
      <header>
        <div className="db-model-index"><span>{String(index + 1).padStart(2, "0")}</span><i /></div>
        <div className="db-provider-title"><b>{meta.short}</b><span><strong>{meta.name}</strong><small>{meta.description}</small></span></div>
        {removable && <button className="db-icon-button" type="button" onClick={onRemove} aria-label={`删除 ${model.name}`}>×</button>}
      </header>
      <div className="db-form-grid">
        <label className="db-field">
          <span>榜单显示名称</span>
          <input value={model.name} onChange={(event) => update("name", event.target.value)} placeholder="例如 DeepSeek V4.1 Flash" />
        </label>
        <label className="db-field">
          <span>{model.provider === "volcengine" ? "推理接入点 ID" : "模型名称"}</span>
          <input value={model.model} onChange={(event) => update("model", event.target.value)} placeholder={model.provider === "volcengine" ? "ep-xxxxxxxx" : "模型或版本名称"} />
        </label>
        {model.provider !== "jev" && (
          <label className="db-field db-field-wide">
            <span>OpenAI 兼容 Base URL</span>
            <input value={model.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} spellCheck={false} />
          </label>
        )}
        <label className="db-field db-field-wide">
          <span>API Key</span>
          <div className="db-secret-input">
            <input type={showKey ? "text" : "password"} value={model.apiKey} onChange={(event) => update("apiKey", event.target.value)} autoComplete="off" placeholder="保存在当前浏览器中" />
            <button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? "隐藏" : "显示"}</button>
          </div>
        </label>
      </div>
      <details className="db-price-panel">
        <summary>成本参数（可选）<span>填写后计算本次调用成本</span></summary>
        <div>
          <label className="db-field"><span>输入 / 百万 Token（美元）</span><input type="number" min="0" step="0.001" value={model.inputPrice} onChange={(event) => update("inputPrice", Number(event.target.value) || 0)} /></label>
          <label className="db-field"><span>输出 / 百万 Token（美元）</span><input type="number" min="0" step="0.001" value={model.outputPrice} onChange={(event) => update("outputPrice", Number(event.target.value) || 0)} /></label>
        </div>
      </details>
    </article>
  );
}

export default function ModelConfigPage() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setModels(loadModels());
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated || !models.length) return;
    saveModels(models);
  }, [hydrated, models]);

  const validCount = useMemo(() => models.filter((model) =>
    model.name.trim() && model.apiKey.trim() && model.model.trim() && (model.provider === "jev" || model.baseUrl.trim()),
  ).length, [models]);

  const updateModel = (id: string, next: ModelConfig) => {
    setModels((current) => current.map((model) => model.id === id ? next : model));
  };

  const addModel = (provider: CloudProvider) => {
    if (models.length >= 8) return;
    setModels((current) => [...current, createModelConfig(provider)]);
  };

  const resetModels = () => {
    if (!window.confirm("确定删除当前浏览器中保存的全部模型配置吗？")) return;
    clearModels();
    setModels([createModelConfig("jev"), createModelConfig("volcengine")]);
  };

  return (
    <BenchmarkShell current="models">
      <header className="db-page-heading">
        <div><span>STEP 02 / MODEL MATRIX</span><h1>连接参评模型</h1><p>每个配置都会自动保存在当前浏览器。除非主动删除，刷新或关闭页面后仍然保留。</p></div>
        <div className="db-save-indicator"><i /><span><b>自动保存已开启</b><small>{hydrated ? "配置变更会即时保存" : "正在读取本机配置"}</small></span></div>
      </header>

      <section className="db-model-summary">
        <div><span>配置数量</span><strong>{models.length}</strong><small>最多 8 个模型</small></div>
        <div><span>可运行</span><strong>{validCount}</strong><small>参数填写完整</small></div>
        <p><i>!</i> API Key 会保存在当前浏览器的本地存储中，不会写入项目文件或导出报告。请勿在公共电脑上使用此功能。</p>
      </section>

      <section className="db-model-list">
        {models.map((model, index) => (
          <ModelEditor
            key={model.id}
            model={model}
            index={index}
            removable={models.length > 2}
            onChange={(next) => updateModel(model.id, next)}
            onRemove={() => setModels((current) => current.filter((item) => item.id !== model.id))}
          />
        ))}
      </section>

      <section className="db-add-model-panel">
        <div><span>ADD ENDPOINT</span><h2>继续添加模型</h2><p>同一家服务商可以添加多个推理节点。</p></div>
        <div>
          {(["jev", "aliyun", "volcengine", "tencent"] as CloudProvider[]).map((provider) => (
            <button key={provider} type="button" onClick={() => addModel(provider)} disabled={models.length >= 8}>
              <b>{PROVIDER_META[provider].short}</b><span>{PROVIDER_META[provider].name}<small>添加配置</small></span><i>＋</i>
            </button>
          ))}
        </div>
      </section>

      <footer className="db-page-actions">
        <button className="db-danger-link" type="button" onClick={resetModels}>清除全部本机配置</button>
        <Link className="db-primary-button" href="/run">下一步：上传数据 <span>→</span></Link>
      </footer>
    </BenchmarkShell>
  );
}
