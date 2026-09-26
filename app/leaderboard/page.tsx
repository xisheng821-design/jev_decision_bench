import type { Metadata } from "next";
import LeaderboardPage from "../benchmark/LeaderboardPage";

export const metadata: Metadata = {
  title: "榜单分析 · Decision Bench",
  description: "查看模型榜单、逐样本差异和可导出的评测结果。",
};

export default function LeaderboardRoute() {
  return <LeaderboardPage />;
}
