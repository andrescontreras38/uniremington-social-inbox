import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

/**
 * Cliente de la API de Claude.
 *
 * La clave se resuelve desde el entorno; nunca se escribe en el codigo ni se
 * devuelve por ninguna ruta de la API.
 */

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  const config = getConfig();

  if (!config.AI_ENABLED) {
    throw new AppError('La asistencia con IA esta deshabilitada (AI_ENABLED=false)', {
      statusCode: 503,
      code: 'AI_DISABLED',
      expose: true,
    });
  }

  client ??= new Anthropic({
    apiKey: config.ANTHROPIC_API_KEY,
    maxRetries: 2,
    timeout: 60_000,
  });

  return client;
}

/** Solo para pruebas: inyecta un cliente simulado. */
export function setAnthropic(instance: Anthropic | null): void {
  client = instance;
}

export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Motivo por el que el modelo declino responder.
 *
 * En este sistema una negativa del modelo no se reintenta con otro modelo:
 * se escala a una persona. Es la conducta correcta para una bandeja donde
 * ninguna respuesta sale sin aprobacion humana, y evita que un caso delicado
 * termine contestado por un modelo de reserva.
 */
export class AiRefusalError extends AppError {
  constructor(readonly category: string | null) {
    super('El modelo declino generar la respuesta; el caso pasa a revision humana', {
      statusCode: 422,
      code: 'AI_REFUSAL',
      expose: true,
    });
  }
}
