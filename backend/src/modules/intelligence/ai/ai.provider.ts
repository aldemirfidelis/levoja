import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat, betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';

export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type AiOutcome<T> = { status: 'OK'; value: T; usage: AiUsage } | { status: 'REFUSED'; usage?: AiUsage } | { status: 'ERROR'; error: string; usage?: AiUsage };

export type AiEffort = 'low' | 'medium' | 'high';

/** Ferramenta somente leitura oferecida ao assistente (o escopo — empresa, tenant — fica na closure). */
export interface AiTool<I extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: I;
  run(input: z.infer<I>): Promise<string>;
}

export interface ConverseResult {
  text: string;
  tools: string[];
}

/**
 * Provedor de modelo de linguagem. Os recursos de IA sempre têm um caminho determinístico
 * quando `available` é falso (AI_PROVIDER=none): análise por léxico, rascunho por modelo de
 * texto e indicadores calculados.
 */
export abstract class AiProvider {
  abstract readonly name: 'none' | 'anthropic';
  abstract readonly model: string | null;
  abstract readonly available: boolean;
  abstract structured<T>(request: { system: string; prompt: string; schema: z.ZodType<T>; effort?: AiEffort; maxTokens?: number }): Promise<AiOutcome<T>>;
  abstract converse(request: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    tools: AiTool[];
    effort?: AiEffort;
    maxIterations?: number;
  }): Promise<AiOutcome<ConverseResult>>;
}

export class DisabledAiProvider extends AiProvider {
  readonly name = 'none' as const;
  readonly model = null;
  readonly available = false;

  async structured<T>(): Promise<AiOutcome<T>> {
    return { status: 'ERROR', error: 'IA desativada (AI_PROVIDER=none).' };
  }

  async converse(): Promise<AiOutcome<ConverseResult>> {
    return { status: 'ERROR', error: 'IA desativada (AI_PROVIDER=none).' };
  }
}

/** Beta do fallback no servidor: se o modelo recusar, a própria API refaz a chamada no modelo indicado pela Anthropic. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Claude (Anthropic) pelo SDK oficial. A chave vem só do ambiente (ANTHROPIC_API_KEY). Recusas
 * (`stop_reason: refusal`) viram REFUSED e o recurso usa o caminho determinístico.
 */
export class AnthropicAiProvider extends AiProvider {
  readonly name = 'anthropic' as const;
  readonly available = true;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    timeoutMs: number,
  ) {
    super();
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 });
  }

  async structured<T>(request: { system: string; prompt: string; schema: z.ZodType<T>; effort?: AiEffort; maxTokens?: number }): Promise<AiOutcome<T>> {
    try {
      const response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: request.maxTokens ?? 8000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
        output_config: { format: betaZodOutputFormat(request.schema as never), effort: request.effort ?? 'medium' },
      });
      const usage = { model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
      if (response.stop_reason === 'refusal') return { status: 'REFUSED', usage };
      if (response.stop_reason === 'max_tokens' || response.parsed_output == null) return { status: 'ERROR', error: 'Resposta incompleta do modelo.', usage };
      return { status: 'OK', value: response.parsed_output as T, usage };
    } catch (error) {
      return { status: 'ERROR', error: describeError(error) };
    }
  }

  async converse(request: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    tools: AiTool[];
    effort?: AiEffort;
    maxIterations?: number;
  }): Promise<AiOutcome<ConverseResult>> {
    const used: string[] = [];
    const usage: AiUsage = { model: this.model, inputTokens: 0, outputTokens: 0 };
    try {
      const runner = this.client.beta.messages.toolRunner({
        model: this.model,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: request.effort ?? 'medium' },
        system: request.system,
        messages: request.messages,
        max_iterations: request.maxIterations ?? 6,
        tools: request.tools.map((tool) =>
          betaZodTool({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.input as never,
            run: async (input: unknown) => {
              used.push(tool.name);
              try {
                return await tool.run(input as never);
              } catch (error) {
                return `Erro ao consultar os dados: ${(error as Error).message}`;
              }
            },
          }),
        ),
      });
      let last: Anthropic.Beta.BetaMessage | null = null;
      for await (const message of runner) {
        last = message;
        usage.model = message.model;
        usage.inputTokens += message.usage.input_tokens;
        usage.outputTokens += message.usage.output_tokens;
        // Recusa pode cortar uma chamada de ferramenta no meio: não segue.
        if (message.stop_reason === 'refusal') return { status: 'REFUSED', usage };
      }
      if (!last) return { status: 'ERROR', error: 'Sem resposta do modelo.', usage };
      const text = last.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      if (!text) return { status: 'ERROR', error: last.stop_reason === 'max_tokens' ? 'Resposta longa demais.' : 'O assistente não concluiu a resposta.', usage };
      return { status: 'OK', value: { text, tools: [...new Set(used)] }, usage };
    } catch (error) {
      return { status: 'ERROR', error: describeError(error), usage };
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) return 'Limite de uso do provedor de IA atingido. Tente em instantes.';
  if (error instanceof Anthropic.AuthenticationError) return 'Credencial do provedor de IA inválida.';
  if (error instanceof Anthropic.APIConnectionTimeoutError) return 'O provedor de IA demorou demais para responder.';
  if (error instanceof Anthropic.APIConnectionError) return 'Sem conexão com o provedor de IA.';
  if (error instanceof Anthropic.APIError) return `Provedor de IA indisponível (${error.status ?? 'erro'}).`;
  return (error as Error)?.message ?? 'Falha desconhecida na IA.';
}
