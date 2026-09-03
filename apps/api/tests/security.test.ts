import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import './setup.js';
import { can, permissionsOf } from '../src/domain/permissions.js';
import { decryptSecret, encryptSecret, safeCompare } from '../src/lib/crypto.js';
import { hashPassword, passwordSchema, verifyPassword } from '../src/lib/password.js';
import { maskPii, scanPii } from '../src/lib/pii.js';
import { MetaProvider } from '../src/services/social/meta-provider.js';

describe('cifrado de secretos', () => {
  it('descifra lo que cifro', () => {
    const token = 'EAAG_token_de_pagina_de_meta_muy_largo';
    expect(decryptSecret(encryptSecret(token))).toBe(token);
  });

  it('produce un texto cifrado distinto cada vez', () => {
    // Vector de inicializacion aleatorio: dos cuentas con el mismo token no
    // deben tener el mismo registro en la base.
    expect(encryptSecret('mismo-token')).not.toBe(encryptSecret('mismo-token'));
  });

  it('falla si el texto cifrado fue alterado', () => {
    const payload = encryptSecret('token');
    const parts = payload.split('.');
    const tampered = [parts[0], parts[1], Buffer.from('otra cosa').toString('base64')].join('.');

    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('compara en tiempo constante sin filtrar la longitud', () => {
    expect(safeCompare('abc', 'abc')).toBe(true);
    expect(safeCompare('abc', 'abd')).toBe(false);
    expect(safeCompare('abc', 'texto mucho mas largo')).toBe(false);
  });
});

describe('contrasenas', () => {
  it('verifica la contrasena correcta y rechaza la incorrecta', async () => {
    const hash = await hashPassword('una-contrasena-larga-2026');

    expect(hash).not.toContain('una-contrasena-larga-2026');
    await expect(verifyPassword('una-contrasena-larga-2026', hash)).resolves.toBe(true);
    await expect(verifyPassword('otra-cosa-cualquiera', hash)).resolves.toBe(false);
  });

  it('rechaza un hash con formato invalido en lugar de lanzar', async () => {
    await expect(verifyPassword('x', 'formato-invalido')).resolves.toBe(false);
  });

  it('exige longitud minima y rechaza contrasenas evidentes', () => {
    expect(passwordSchema.safeParse('corta').success).toBe(false);
    expect(passwordSchema.safeParse('uniremington').success).toBe(false);
    expect(passwordSchema.safeParse('aaaaaaaaaaaaaa').success).toBe(false);
    expect(passwordSchema.safeParse('bandeja-uniremington-2026').success).toBe(true);
  });
});

describe('permisos por rol', () => {
  it('solo supervisores y administradores pueden publicar', () => {
    expect(can('VIEWER', 'reply:publish')).toBe(false);
    expect(can('AGENT', 'reply:publish')).toBe(false);
    expect(can('SUPERVISOR', 'reply:publish')).toBe(true);
    expect(can('ADMIN', 'reply:publish')).toBe(true);
  });

  it('un agente redacta pero no aprueba', () => {
    expect(can('AGENT', 'reply:draft')).toBe(true);
    expect(can('AGENT', 'reply:approve')).toBe(false);
  });

  it('un observador solo lee', () => {
    const permissions = permissionsOf('VIEWER');
    expect(permissions.every((permission) => permission.endsWith(':read'))).toBe(true);
  });

  it('solo el administrador gestiona usuarios y cuentas', () => {
    expect(can('SUPERVISOR', 'users:write')).toBe(false);
    expect(can('SUPERVISOR', 'accounts:write')).toBe(false);
    expect(can('ADMIN', 'users:write')).toBe(true);
  });
});

describe('firma del webhook de Meta', () => {
  const provider = new MetaProvider();
  const body = Buffer.from(JSON.stringify({ object: 'instagram', entry: [] }));

  it('acepta una firma valida', () => {
    const signature =
      'sha256=' + createHmac('sha256', 'secreto-de-prueba').update(body).digest('hex');
    expect(provider.verifyWebhookSignature(body, signature)).toBe(true);
  });

  it('rechaza una firma calculada con otro secreto', () => {
    const signature = 'sha256=' + createHmac('sha256', 'otro-secreto').update(body).digest('hex');
    expect(provider.verifyWebhookSignature(body, signature)).toBe(false);
  });

  it('rechaza un cuerpo alterado', () => {
    const signature =
      'sha256=' + createHmac('sha256', 'secreto-de-prueba').update(body).digest('hex');
    expect(provider.verifyWebhookSignature(Buffer.from('{"object":"otro"}'), signature)).toBe(
      false,
    );
  });

  it('rechaza la ausencia de firma', () => {
    expect(provider.verifyWebhookSignature(body, undefined)).toBe(false);
    expect(provider.verifyWebhookSignature(body, 'sha1=abc')).toBe(false);
  });

  it('responde el reto solo con el token correcto', () => {
    expect(
      provider.verifyWebhookChallenge({
        mode: 'subscribe',
        token: 'token-de-prueba',
        challenge: '12345',
      }),
    ).toBe('12345');

    expect(
      provider.verifyWebhookChallenge({
        mode: 'subscribe',
        token: 'token-incorrecto',
        challenge: '12345',
      }),
    ).toBeNull();
  });
});

describe('datos personales', () => {
  it('detecta cedula, telefono y correo', () => {
    expect(scanPii('mi cedula es 1035478921').flags).toContain('DOCUMENT_ID');
    expect(scanPii('escribame al 3001234567').flags).toContain('PHONE');
    expect(scanPii('mi correo es aspirante@gmail.com').flags).toContain('EMAIL');
  });

  it('no marca un comentario limpio', () => {
    const scan = scanPii('Buenas tardes, hay cupos para ingenieria en la sede de Cali?');
    expect(scan.requiresHuman).toBe(false);
    expect(scan.flags).toHaveLength(0);
  });

  it('enmascara el dato antes de que llegue al log', () => {
    const masked = maskPii('mi cedula 1035478921 y mi correo daniela@gmail.com');

    expect(masked).not.toContain('1035478921');
    expect(masked).not.toContain('daniela@gmail.com');
    expect(masked).toContain('@gmail.com');
  });
});
