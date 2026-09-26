import type { Metadata } from "next";
import OverviewPage from "./benchmark/OverviewPage";

export const metadata: Metadata = {
  title: "Decision Bench · 模型评测工作台",
  description: "在本地配置模型、上传数据、运行评测并分析模型差异。",
};

export default function Home() {
  return <OverviewPage />;
}
