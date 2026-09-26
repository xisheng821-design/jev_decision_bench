"use client";

import {
  DatasetItem,
  EvaluationResult,
  ModelConfig,
  TaskType,
  createModelConfig,
} from "./benchmark";

const MODEL_KEY = "decision-bench:model-configs:v2";
const DATABASE_NAME = "decision-bench";
const STORE_NAME = "workspace";
const SESSION_KEY = "active-session-v2";

export interface BenchmarkSession {
  taskType: TaskType;
  instruction: string;
  datasetName: string;
  dataset: DatasetItem[];
  labels: string[];
  concurrency: number;
  results: EvaluationResult[];
  runModels: ModelConfig[];
  generatedAt: string | null;
}

export const DEFAULT_CHOICE_INSTRUCTION =
  "根据输入内容判断它所属的唯一业务类别。只根据消息表达的主要诉求选择标签。";
export const DEFAULT_BINARY_INSTRUCTION =
  "判断输入内容是否符合目标条件。符合时回答是，不符合时回答否。";

export const EMPTY_SESSION: BenchmarkSession = {
  taskType: "choice",
  instruction: DEFAULT_CHOICE_INSTRUCTION,
  datasetName: "",
  dataset: [],
  labels: [],
  concurrency: 20,
  results: [],
  runModels: [],
  generatedAt: null,
};

export function loadModels(): ModelConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = window.localStorage.getItem(MODEL_KEY);
    if (!saved) return [createModelConfig("jev"), createModelConfig("volcengine")];
    const parsed = JSON.parse(saved) as ModelConfig[];
    return Array.isArray(parsed) && parsed.length ? parsed : [createModelConfig("jev"), createModelConfig("volcengine")];
  } catch {
    return [createModelConfig("jev"), createModelConfig("volcengine")];
  }
}

export function saveModels(models: ModelConfig[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MODEL_KEY, JSON.stringify(models));
}

export function clearModels() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(MODEL_KEY);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadSession(): Promise<BenchmarkSession> {
  if (typeof window === "undefined" || !window.indexedDB) return { ...EMPTY_SESSION };
  try {
    const database = await openDatabase();
    const value = await new Promise<BenchmarkSession | undefined>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(SESSION_KEY);
      request.onsuccess = () => resolve(request.result as BenchmarkSession | undefined);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return value ? { ...EMPTY_SESSION, ...value } : { ...EMPTY_SESSION };
  } catch {
    return { ...EMPTY_SESSION };
  }
}

export async function saveSession(session: BenchmarkSession): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(session, SESSION_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
}

export async function clearSession(): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(SESSION_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
}
