export type MistralChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type MistralChatCompletionsResponse = {
  id?: string;
  choices?: Array<{
    message?: { content?: string };
  }>;
};

const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";

export async function callMistralChatCompletions(params: {
  apiKey: string;
  model?: string;
  messages: MistralChatMessage[];
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const {
    apiKey,
    model = "mistral-small-latest",
    messages,
    maxTokens = 600,
    temperature = 0.4,
  } = params;

  const res = await fetch(`${MISTRAL_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mistral call failed: ${res.status} ${res.statusText} ${text}`);
  }

  const data = (await res.json()) as MistralChatCompletionsResponse;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Mistral response missing content");
  return content;
}

