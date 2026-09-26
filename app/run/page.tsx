import type { Metadata } from "next";
import RunEvaluationPage from "../benchmark/RunEvaluationPage";

export const metadata: Metadata = {
  title: "数据与评测 · Decision Bench",
  description: "上传测试数据，设置并发并运行多模型评测。",
};

export default function RunPage() {
  return <RunEvaluationPage />;
}
