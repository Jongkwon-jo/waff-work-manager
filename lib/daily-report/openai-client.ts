import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z, ZodType } from "zod";

const envClientCache = new Map<string, OpenAI>();

function makeClient(apiKey: string): OpenAI {
  const cached = envClientCache.get(apiKey);
  if (cached) return cached;
  const client = new OpenAI({ apiKey });
  envClientCache.set(apiKey, client);
  return client;
}

export function getOpenAIClient(explicitKey?: string): OpenAI {
  const apiKey = explicitKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY가 설정되지 않았습니다. WBS Agent 설정에서 본인 API 키를 등록하거나 서버 환경변수로 설정하세요.",
    );
  }
  return makeClient(apiKey);
}

export const defaultDailyReportModel = (): string =>
  process.env.OPENAI_DAILY_REPORT_MODEL || "gpt-4o-mini";

export const orchestratorModel = (): string =>
  process.env.OPENAI_DAILY_REPORT_ORCHESTRATOR_MODEL || defaultDailyReportModel();

export interface CallStructuredOptions<T extends ZodType> {
  model?: string;
  schemaName: string;
  schema: T;
  system: string;
  user: string;
  retries?: number;
  apiKey?: string;
}

export async function callStructured<T extends ZodType>(
  opts: CallStructuredOptions<T>,
): Promise<z.infer<T>> {
  const client = getOpenAIClient(opts.apiKey);
  const model = opts.model ?? defaultDailyReportModel();
  const retries = opts.retries ?? 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const completion = await client.beta.chat.completions.parse({
        model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        response_format: zodResponseFormat(opts.schema, opts.schemaName),
      });
      const parsed = completion.choices[0]?.message?.parsed;
      if (parsed === null || parsed === undefined) {
        throw new Error("OpenAI returned an empty parsed payload");
      }
      return parsed as z.infer<T>;
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Unknown OpenAI structured call failure: ${String(lastError)}`);
}
