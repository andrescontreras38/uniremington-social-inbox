import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../src/lib/crypto.js';
import { hashPassword } from '../src/lib/password.js';
import { DEFAULT_TONE } from '../src/services/ai/prompts.js';

/**
 * Datos iniciales.
 *
 * Crea el administrador, las cuentas del piloto y el tono institucional por
 * defecto. Es idempotente: correrlo dos veces no duplica nada.
 *
 * La contrasena del administrador se toma de SEED_ADMIN_PASSWORD o se genera
 * al azar y se imprime una sola vez. No hay contrasena por defecto en el
 * codigo: un sistema que se despliega con "admin/admin" ya nace comprometido.
 */

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@uniremington.edu.co';

/** Cuentas del piloto, segun la propuesta: la nacional y las sedes. */
const ACCOUNTS = [
  {
    provider: 'META_INSTAGRAM',
    externalId: 'ig_uniremington_nacional',
    name: 'Uniremington (Instagram nacional)',
    campus: 'NACIONAL',
  },
  {
    provider: 'META_FACEBOOK',
    externalId: 'fb_uniremington_nacional',
    name: 'Uniremington (Facebook nacional)',
    campus: 'NACIONAL',
  },
  {
    provider: 'META_INSTAGRAM',
    externalId: 'ig_uniremington_cali',
    name: 'Uniremington Cali',
    campus: 'CALI',
  },
  {
    provider: 'META_FACEBOOK',
    externalId: 'fb_uniremington_bogota',
    name: 'Uniremington Bogota',
    campus: 'BOGOTA',
  },
] as const;

async function main(): Promise<void> {
  const existingAdmin = await prisma.user.findUnique({
    where: { email: ADMIN_EMAIL },
    select: { id: true },
  });

  if (existingAdmin) {
    console.log(`Administrador ya existente: ${ADMIN_EMAIL}`);
  } else {
    const password = process.env.SEED_ADMIN_PASSWORD || randomBytes(12).toString('base64url');

    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        name: 'Administrador',
        role: 'ADMIN',
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      },
    });

    console.log('\n=====================================================');
    console.log('  Usuario administrador creado');
    console.log(`  Correo:     ${ADMIN_EMAIL}`);
    console.log(`  Contrasena: ${password}`);
    console.log('  Debe cambiarla en el primer ingreso.');
    console.log('=====================================================\n');
  }

  for (const account of ACCOUNTS) {
    await prisma.socialAccount.upsert({
      where: {
        provider_externalId: { provider: account.provider, externalId: account.externalId },
      },
      update: {},
      create: {
        ...account,
        // Token simulado: permite trabajar de inmediato con el proveedor mock.
        // Al conectar Meta de verdad se reemplaza desde la pantalla de cuentas.
        accessTokenCipher: encryptSecret(`mock_token_${account.externalId}`),
      },
    });
  }

  console.log(`Cuentas configuradas: ${ACCOUNTS.length}`);

  const tone = await prisma.toneProfile.findFirst({ where: { isActive: true } });
  if (!tone) {
    await prisma.toneProfile.create({
      data: {
        name: 'Voz institucional Uniremington',
        description: 'Tono base acordado con el equipo. Ajustable desde la aplicacion.',
        content: DEFAULT_TONE,
        isActive: true,
      },
    });
    console.log('Tono institucional cargado');
  }
}

main()
  .catch((error: unknown) => {
    console.error('Fallo la carga inicial:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
