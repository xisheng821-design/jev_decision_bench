import type { Metadata } from "next";
import ModelConfigPage from "../benchmark/ModelConfigPage";

export const metadata: Metadata = {
  title: "模型配置 · Decision Bench",
  description: "配置并保存参加评测的模型推理接口。",
};

export default function ModelsPage() {
  return <ModelConfigPage />;
}
