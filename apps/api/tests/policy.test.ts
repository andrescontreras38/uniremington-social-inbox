import { describe, expect, it } from 'vitest';
import './setup.js';
import { evaluatePolicy } from '../src/domain/policy.js';
import { scanPii } from '../src/lib/pii.js';

/**
 * La politica de automatizacion es el acuerdo con Uniremington puesto en
 * codigo. Estas pruebas existen para que un cambio futuro no lo afloje sin
 * que alguien lo note.
 */

describe('politica de automatizacion', () => {
  it('permite borrador asistido en una pregunta de admision sin datos personales', () => {
    const text = 'Buenas tardes, cuanto vale el semestre de psicologia?';
    const decision = evaluatePolicy({
      topic: 'ENROLLMENT_INTENT',
      sentiment: 'NEUTRAL',
      urgency: 'MEDIUM',
      piiFlags: scanPii(text).flags,
      text,
    });

    expect(decision.requiresHuman).toBe(false);
    expect(decision.allowAssistedDraft).toBe(true);
  });

  it('permite borrador asistido en una felicitacion', () => {
    const text = 'Felicitaciones a todos los graduandos, excelente universidad';
    const decision = evaluatePolicy({
      topic: 'PRAISE',
      sentiment: 'POSITIVE',
      urgency: 'LOW',
      piiFlags: scanPii(text).flags,
      text,
    });

    expect(decision.allowAssistedDraft).toBe(true);
  });

  it('manda a una persona cualquier queja formal, sin excepcion', () => {
    const text = 'Solicite mi certificado hace un mes y no me lo entregan';
    const decision = evaluatePolicy({
      topic: 'COMPLAINT',
      sentiment: 'NEGATIVE',
      urgency: 'MEDIUM',
      piiFlags: [],
      text,
    });

    expect(decision.requiresHuman).toBe(true);
    expect(decision.allowAssistedDraft).toBe(false);
    expect(decision.reasons.join(' ')).toContain('queja');
  });

  it('manda a una persona un comentario con numero de cedula', () => {
    const text = 'Mi cedula es 1035478921 y necesito que revisen mi homologacion';
    const flags = scanPii(text).flags;

    expect(flags).toContain('DOCUMENT_ID');

    const decision = evaluatePolicy({
      topic: 'QUESTION',
      sentiment: 'NEUTRAL',
      urgency: 'MEDIUM',
      piiFlags: flags,
      text,
    });

    expect(decision.allowAssistedDraft).toBe(false);
  });

  it('manda a una persona un caso con dato de salud', () => {
    const text = 'Tengo una incapacidad medica y necesito aplazar el semestre';
    const flags = scanPii(text).flags;

    expect(flags).toContain('HEALTH');
    expect(
      evaluatePolicy({
        topic: 'QUESTION',
        sentiment: 'NEUTRAL',
        urgency: 'MEDIUM',
        piiFlags: flags,
        text,
      }).allowAssistedDraft,
    ).toBe(false);
  });

  it('manda a una persona todo lo marcado como critico', () => {
    const decision = evaluatePolicy({
      topic: 'QUESTION',
      sentiment: 'NEUTRAL',
      urgency: 'CRITICAL',
      piiFlags: [],
      text: 'Voy a denunciar esto publicamente',
    });

    expect(decision.requiresHuman).toBe(true);
  });

  it('manda a una persona una consulta que exige el expediente del estudiante', () => {
    const text = 'No me aparece la nota de estadistica en la plataforma';
    const decision = evaluatePolicy({
      topic: 'SUPPORT',
      sentiment: 'NEUTRAL',
      urgency: 'MEDIUM',
      piiFlags: scanPii(text).flags,
      text,
    });

    expect(decision.requiresHuman).toBe(true);
    expect(decision.reasons.join(' ')).toContain('expediente');
  });
});
