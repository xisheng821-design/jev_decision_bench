"use client";

import Link from "next/link";
import { ReactNode } from "react";

const STEPS = [
  { id: "overview", number: "01", label: "流程概览", href: "/" },
  { id: "models", number: "02", label: "模型配置", href: "/models" },
  { id: "run", number: "03", label: "数据与评测", href: "/run" },
  { id: "leaderboard", number: "04", label: "榜单分析", href: "/leaderboard" },
] as const;

export default function BenchmarkShell({
  current,
  children,
  aside,
}: {
  current: typeof STEPS[number]["id"];
  children: ReactNode;
  aside?: ReactNode;
}) {
  const currentIndex = STEPS.findIndex((step) => step.id === current);
  return (
    <main className="db-app-shell">
      <div className="db-ambient" aria-hidden="true"><i /><i /><i /></div>
      <header className="db-topbar">
        <Link className="db-brand" href="/">
          <span className="db-brand-mark"><i />DB</span>
          <span><strong>Decision Bench</strong><small>LOCAL EVALUATION SYSTEM</small></span>
        </Link>
        <nav className="db-main-nav" aria-label="评测流程">
          {STEPS.map((step, index) => (
            <Link
              key={step.id}
              href={step.href}
              className={`${step.id === current ? "active" : ""} ${index < currentIndex ? "done" : ""}`}
              aria-current={step.id === current ? "page" : undefined}
            >
              <span>{index < currentIndex ? "✓" : step.number}</span>
              {step.label}
            </Link>
          ))}
        </nav>
        <div className="db-local-status"><i />LOCAL ONLY</div>
      </header>
      {aside}
      <div className="db-page-frame">{children}</div>
    </main>
  );
}
