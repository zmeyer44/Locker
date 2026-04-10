import { createGateway } from "ai";

export const gateway = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY,
});

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
