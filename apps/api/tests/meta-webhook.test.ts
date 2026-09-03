import { describe, expect, it } from 'vitest';
import './setup.js';
import { MetaProvider } from '../src/services/social/meta-provider.js';

/**
 * Interpretacion del webhook de Meta.
 *
 * Cubre en particular la deteccion de "esto ya lo respondieron por fuera":
 * para comentarios ya existia (por el campo parent_id), para mensajes
 * directos es nueva. Sin esta deteccion, una conversacion que Clientify (u
 * otra herramienta conectada a la misma pagina) ya respondio seguiria
 * apareciendo como pendiente en esta bandeja.
 */

const provider = new MetaProvider();

function messagingPayload(messaging: unknown[]) {
  return {
    object: 'page',
    entry: [{ id: 'pagina_123', messaging }],
  };
}

describe('MetaProvider.parseWebhook - mensajes directos', () => {
  it('normaliza un mensaje entrante de una persona', () => {
    const payload = messagingPayload([
      {
        sender: { id: 'usuario_1' },
        recipient: { id: 'pagina_123' },
        timestamp: 1_700_000_000_000,
        message: { mid: 'mid.1', text: 'Cuanto vale el semestre?' },
      },
    ]);

    const [result] = provider.parseWebhook(payload);

    expect(result).toMatchObject({
      kind: 'DIRECT_MESSAGE',
      accountExternalId: 'pagina_123',
      authorExternalId: 'usuario_1',
      text: 'Cuanto vale el semestre?',
    });
    expect(result?.fromInstitution).toBeFalsy();
  });

  it('reconoce un eco (la pagina le respondio a alguien) y no lo trata como mensaje entrante', () => {
    // En un eco, Meta invierte sender/recipient: quien "envia" es la pagina.
    const payload = messagingPayload([
      {
        sender: { id: 'pagina_123' },
        recipient: { id: 'usuario_1' },
        timestamp: 1_700_000_100_000,
        message: { mid: 'mid.2', text: 'Con gusto le confirmamos...', is_echo: true },
      },
    ]);

    const [result] = provider.parseWebhook(payload);

    expect(result).toBeDefined();
    expect(result?.kind).toBe('DIRECT_MESSAGE');
    expect(result?.fromInstitution).toBe(true);
    // authorExternalId lleva a la PERSONA (el destinatario del eco), no a la
    // pagina: es contra ese valor que se busca la conversacion pendiente.
    expect(result?.authorExternalId).toBe('usuario_1');
    expect(result?.accountExternalId).toBe('pagina_123');
  });

  it('recupera el id de la app que respondio, cuando Meta lo informa', () => {
    const payload = messagingPayload([
      {
        sender: { id: 'pagina_123' },
        recipient: { id: 'usuario_1' },
        message: { mid: 'mid.3', text: 'Respuesta', is_echo: true, app_id: 555 },
      },
    ]);

    const [result] = provider.parseWebhook(payload);
    expect(result?.answeredByApp).toBe('555');
  });

  it('un eco sin texto se descarta, igual que un mensaje entrante sin texto', () => {
    const payload = messagingPayload([
      { sender: { id: 'pagina_123' }, recipient: { id: 'usuario_1' }, message: { mid: 'mid.4', is_echo: true } },
      { sender: { id: 'usuario_2' }, recipient: { id: 'pagina_123' }, message: { mid: 'mid.5' } },
    ]);

    expect(provider.parseWebhook(payload)).toHaveLength(0);
  });
});
