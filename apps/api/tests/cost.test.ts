import { describe, expect, it } from 'vitest';
import './setup.js';
import {
  clamp,
  isMentionOnly,
  isPositiveReaction,
  letterCount,
  textFingerprint,
} from '../src/lib/text.js';
import { estimateCost, supportsEffort } from '../src/services/ai/model-capabilities.js';

/**
 * Estas pruebas cuidan el gasto.
 *
 * Cada fallo aqui significa una llamada al modelo que se paga sin necesidad,
 * o un parametro que la API rechazaria con error.
 */

describe('huella de texto', () => {
  it('agrupa las variantes de la misma pregunta', () => {
    const base = textFingerprint('precio');

    expect(textFingerprint('Precio??')).toBe(base);
    expect(textFingerprint('  PRECIO  ')).toBe(base);
    expect(textFingerprint('precio!!!')).toBe(base);
  });

  it('ignora tildes y signos', () => {
    expect(textFingerprint('informacion por favor')).toBe(
      textFingerprint('¿Información, por favor?'),
    );
  });

  it('distingue preguntas distintas', () => {
    expect(textFingerprint('cuanto vale el semestre')).not.toBe(
      textFingerprint('cuando abren inscripciones'),
    );
  });
});

describe('atajos que evitan llamar al modelo', () => {
  it('reconoce una reaccion positiva sin texto', () => {
    expect(isPositiveReaction('❤️')).toBe(true);
    expect(isPositiveReaction('👏👏👏')).toBe(true);
    expect(isPositiveReaction('felicitaciones')).toBe(false);
  });

  it('reconoce una mencion suelta', () => {
    expect(isMentionOnly('@daniela.gomez')).toBe(true);
    expect(isMentionOnly('@daniela.gomez @juan')).toBe(true);
    expect(isMentionOnly('@daniela mira esto')).toBe(false);
  });

  it('cuenta solo letras reales', () => {
    expect(letterCount('!!!???')).toBe(0);
    expect(letterCount('hola')).toBe(4);
    // Las tildes no cuentan como letra adicional.
    expect(letterCount('informacion')).toBe(letterCount('información'));
  });
});

describe('recorte de entrada', () => {
  it('deja intacto un comentario normal', () => {
    const comment = 'Buenas tardes, cuanto vale el semestre de psicologia?';
    expect(clamp(comment, 1200)).toBe(comment);
  });

  it('recorta un texto desmedido', () => {
    const long = 'a'.repeat(5000);
    const result = clamp(long, 1200);

    expect(result.length).toBeLessThanOrEqual(1201);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('capacidades del modelo', () => {
  it('no envia effort a Haiku 4.5, que lo rechaza', () => {
    // Enviarlo devolveria un error 400 y la clasificacion fallaria entera.
    expect(supportsEffort('claude-haiku-4-5')).toBe(false);
    expect(supportsEffort('claude-sonnet-4-5')).toBe(false);
  });

  it('si lo envia a los modelos que lo admiten', () => {
    expect(supportsEffort('claude-opus-5')).toBe(true);
    expect(supportsEffort('claude-sonnet-5')).toBe(true);
    expect(supportsEffort('claude-opus-4-8')).toBe(true);
  });
});

describe('estimacion de costo', () => {
  it('calcula el costo de Haiku 4.5 (1 y 5 USD por millon)', () => {
    // Un millon de tokens de entrada y cien mil de salida.
    expect(estimateCost('claude-haiku-4-5', 1_000_000, 100_000)).toBeCloseTo(1.5, 5);
  });

  it('refleja que Opus 5 cuesta cinco veces mas en entrada', () => {
    const haiku = estimateCost('claude-haiku-4-5', 1_000_000, 0);
    const opus = estimateCost('claude-opus-5', 1_000_000, 0);

    expect(opus / haiku).toBeCloseTo(5, 5);
  });

  it('usa la tarifa mas baja como referencia para un modelo desconocido', () => {
    expect(estimateCost('modelo-futuro', 1_000_000, 0)).toBeCloseTo(1, 5);
  });
});
