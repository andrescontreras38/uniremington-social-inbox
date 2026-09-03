import { describe, expect, it } from 'vitest';
import './setup.js';
import { PolicyViolationError, ConflictError } from '../src/lib/errors.js';
import { assertPublishable } from '../src/services/replies.js';

/**
 * La regla central del sistema: nada se publica sin que una persona lo lea y
 * lo apruebe. Si alguna de estas pruebas empieza a fallar, la promesa que
 * Uniremington le hizo a su equipo dejo de cumplirse.
 */

const aprobada = {
  status: 'APPROVED',
  approvedById: 'usr_supervisora',
  approvedAt: new Date('2026-09-01T10:00:00Z'),
  finalText: 'Con gusto le ampliamos la informacion por mensaje directo.',
  publishedAt: null,
};

describe('invariante de publicacion', () => {
  it('acepta una respuesta aprobada por una persona', () => {
    expect(() => assertPublishable({ ...aprobada })).not.toThrow();
  });

  it('rechaza un borrador que nadie aprobo', () => {
    expect(() =>
      assertPublishable({ ...aprobada, status: 'DRAFT', approvedById: null, approvedAt: null }),
    ).toThrow(PolicyViolationError);
  });

  it('rechaza una respuesta marcada como aprobada pero sin quien la aprobo', () => {
    // Caso de una escritura directa en la base o de una migracion mal hecha.
    expect(() => assertPublishable({ ...aprobada, approvedById: null })).toThrow(
      PolicyViolationError,
    );
  });

  it('rechaza una respuesta aprobada sin marca de tiempo', () => {
    expect(() => assertPublishable({ ...aprobada, approvedAt: null })).toThrow(
      PolicyViolationError,
    );
  });

  it('rechaza una respuesta pendiente de aprobacion', () => {
    expect(() => assertPublishable({ ...aprobada, status: 'PENDING_APPROVAL' })).toThrow(
      PolicyViolationError,
    );
  });

  it('rechaza una respuesta descartada', () => {
    expect(() => assertPublishable({ ...aprobada, status: 'REJECTED' })).toThrow(
      PolicyViolationError,
    );
  });

  it('rechaza texto vacio aunque este aprobado', () => {
    expect(() => assertPublishable({ ...aprobada, finalText: '   ' })).toThrow(
      PolicyViolationError,
    );
  });

  it('rechaza publicar dos veces la misma respuesta', () => {
    expect(() => assertPublishable({ ...aprobada, publishedAt: new Date() })).toThrow(
      ConflictError,
    );
  });

  it('rechaza una respuesta mas larga que el limite de la plataforma', () => {
    expect(() => assertPublishable({ ...aprobada, finalText: 'a'.repeat(2001) })).toThrow(
      PolicyViolationError,
    );
  });
});
