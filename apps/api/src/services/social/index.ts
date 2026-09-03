import { getConfig } from '../../config/env.js';
import { decryptSecret } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { MetaProvider } from './meta-provider.js';
import { MockProvider } from './mock-provider.js';
import type { AccountCredentials, SocialProvider } from './types.js';

export * from './types.js';
export { MetaProvider } from './meta-provider.js';
export { MockProvider } from './mock-provider.js';

let instance: SocialProvider | null = null;

/** Proveedor activo segun SOCIAL_PROVIDER. Se resuelve una sola vez. */
export function getSocialProvider(): SocialProvider {
  instance ??= getConfig().SOCIAL_PROVIDER === 'meta' ? new MetaProvider() : new MockProvider();
  return instance;
}

/** Solo para pruebas: inyecta un proveedor alterno. */
export function setSocialProvider(provider: SocialProvider | null): void {
  instance = provider;
}

interface AccountRecord {
  id: string;
  provider: string;
  externalId: string;
  accessTokenCipher: string | null;
}

/**
 * Descifra el token de una cuenta justo antes de usarlo.
 *
 * El token en claro vive solo dentro de la llamada; no se guarda en memoria
 * compartida ni se devuelve por la API bajo ninguna ruta.
 */
export function resolveCredentials(account: AccountRecord): AccountCredentials {
  if (!account.accessTokenCipher) {
    throw new AppError(`La cuenta ${account.externalId} no tiene token configurado`, {
      statusCode: 409,
      code: 'ACCOUNT_NOT_CONNECTED',
      expose: true,
    });
  }

  return {
    id: account.id,
    provider: account.provider as AccountCredentials['provider'],
    externalId: account.externalId,
    accessToken: decryptSecret(account.accessTokenCipher),
  };
}
