/**
 * Capacidades por modelo.
 *
 * No todos los modelos aceptan los mismos parametros. Enviar `effort` a un
 * modelo que no lo admite no es una degradacion silenciosa: la API responde
 * con error 400 y la clasificacion falla. Por eso el parametro se envia solo
 * cuando el modelo configurado lo soporta.
 */

/** Prefijos de modelos que aceptan output_config.effort. */
const EFFORT_CAPABLE_PREFIXES = [
  'claude-fable-5',
  'claude-mythos-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-opus-4-5',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
];

export function supportsEffort(model: string): boolean {
  return EFFORT_CAPABLE_PREFIXES.some((prefix) => model.startsWith(prefix));
}

/**
 * Precios publicados por millon de tokens, en dolares.
 *
 * Se usan solo para estimar el consumo en el tablero. Es una referencia para
 * que el equipo vea lo que cuesta operar la bandeja, no una factura: la cifra
 * real la emite Anthropic.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
};

const DEFAULT_PRICING = { input: 1, output: 5 };

/** Costo estimado en dolares de un consumo dado. */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model] ?? DEFAULT_PRICING;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
