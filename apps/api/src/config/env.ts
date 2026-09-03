import { existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * Configuracion de la aplicacion.
 *
 * Regla: el proceso no arranca si falta o es invalida una variable requerida.
 * Fallar al iniciar es preferible a arrancar con una clave de cifrado vacia o
 * con un secreto de webhook por defecto.
 */

/**
 * Carga el archivo .env con el cargador nativo de Node (>= 20.12), sin
 * dependencias externas. Las variables ya presentes en el entorno tienen
 * prioridad: en produccion manda el gestor de secretos, no un archivo.
 */
function loadDotEnv(): void {
  if (process.env.NODE_ENV === 'production') return;

  const path = process.env.ENV_FILE ?? '.env';
  if (!existsSync(path)) return;

  try {
    process.loadEnvFile(path);
  } catch {
    // Node anterior a 20.12 o archivo ilegible: se continua con el entorno.
  }
}

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),

  /** Origen del frontend autorizado para enviar cookies. Sin comodines. */
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  /** URL publica de la API, usada para construir el callback de webhooks. */
  PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),

  /**
   * Clave maestra AES-256-GCM en base64 (32 bytes exactos) usada para cifrar
   * los tokens de pagina de Meta en reposo. Generar con:
   *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   */
  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY es obligatoria'),

  SESSION_COOKIE_NAME: z.string().default('urem_session'),
  CSRF_COOKIE_NAME: z.string().default('urem_csrf'),
  /** Duracion de la sesion en horas. */
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  /** Inactividad maxima antes de exigir nuevo inicio de sesion, en minutos. */
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),

  /** Intentos fallidos antes de bloquear temporalmente la cuenta. */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

  /** Proveedor de redes sociales activo. */
  SOCIAL_PROVIDER: z.enum(['mock', 'meta']).default('mock'),

  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  /** Token compartido para la verificacion GET del webhook de Meta. */
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_GRAPH_VERSION: z.string().default('v21.0'),
  META_GRAPH_BASE_URL: z.string().url().default('https://graph.facebook.com'),

  ANTHROPIC_API_KEY: z.string().optional(),
  AI_ENABLED: booleanish.default('true'),

  /**
   * Modelos por tarea.
   *
   * Ambos apuntan a Claude Haiku 4.5, el modelo mas economico de la familia
   * (1 USD por millon de tokens de entrada, 5 por millon de salida). Las dos
   * tareas de esta bandeja son cortas y muy acotadas: poner tres etiquetas a
   * un comentario, y redactar de dos a cuatro frases siguiendo un reglamento
   * explicito. Ninguna necesita un modelo de razonamiento profundo, y todo
   * borrador pasa igualmente por revision humana antes de publicarse, asi que
   * el riesgo de un texto mediocre esta acotado: la persona lo corrige.
   *
   * Si el equipo nota que los borradores quedan cortos de calidad, el paso
   * intermedio es AI_MODEL_DRAFT=claude-sonnet-5 dejando la clasificacion en
   * Haiku: encarece solo la tarea que lo necesita.
   */
  AI_MODEL_CLASSIFY: z.string().default('claude-haiku-4-5'),
  AI_MODEL_DRAFT: z.string().default('claude-haiku-4-5'),

  /**
   * Esfuerzo de razonamiento. Solo se envia a los modelos que lo aceptan
   * (ver services/ai/model-capabilities.ts); Haiku 4.5 lo rechaza con error.
   */
  AI_CLASSIFY_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),
  AI_DRAFT_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),

  /**
   * Reutilizar la clasificacion de un comentario identico ya visto en los
   * ultimos N dias. En epoca de convocatoria la misma pregunta llega decenas
   * de veces ("precio?", "hay becas?"); volver a pagarla no aporta nada.
   * 0 desactiva la reutilizacion.
   */
  AI_CLASSIFY_REUSE_DAYS: z.coerce.number().int().min(0).max(365).default(30),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_SECURE: booleanish.default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  ALERT_FROM: z.string().default('bandeja@uniremington.edu.co'),
  /** Correos que reciben las alertas, separados por coma. */
  ALERT_RECIPIENTS: z.string().default(''),

  /** Comentarios negativos nuevos que disparan alerta de acumulacion. */
  NEGATIVE_SPIKE_THRESHOLD: z.coerce.number().int().min(2).default(3),
  NEGATIVE_SPIKE_WINDOW_MINUTES: z.coerce.number().int().min(5).default(60),

  /** Retencion de interacciones en dias (Ley 1581 de 2012). 0 = sin purga. */
  DATA_RETENTION_DAYS: z.coerce.number().int().min(0).default(730),

  RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  /** Ejecutar los trabajos programados dentro del proceso de la API. */
  ENABLE_JOBS: booleanish.default('true'),
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(5),
});

const schema = baseSchema.superRefine((env, ctx) => {
  const requireIn = (
    condition: boolean,
    key: keyof z.infer<typeof baseSchema>,
    message: string,
  ) => {
    if (condition && !env[key]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key as string], message });
    }
  };

  const isProd = env.NODE_ENV === 'production';

  requireIn(
    env.SOCIAL_PROVIDER === 'meta',
    'META_APP_SECRET',
    'META_APP_SECRET es obligatorio para verificar la firma del webhook de Meta',
  );
  requireIn(
    env.SOCIAL_PROVIDER === 'meta',
    'META_WEBHOOK_VERIFY_TOKEN',
    'META_WEBHOOK_VERIFY_TOKEN es obligatorio con el proveedor meta',
  );
  requireIn(
    env.SOCIAL_PROVIDER === 'meta',
    'META_APP_ID',
    'META_APP_ID es obligatorio con el proveedor meta',
  );
  requireIn(
    env.AI_ENABLED,
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_API_KEY es obligatoria cuando AI_ENABLED=true',
  );

  if (isProd && env.SOCIAL_PROVIDER === 'mock') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SOCIAL_PROVIDER'],
      message: 'El proveedor mock no puede usarse en produccion',
    });
  }
  if (isProd && !env.PUBLIC_API_URL.startsWith('https://')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['PUBLIC_API_URL'],
      message: 'En produccion la API debe servirse por HTTPS',
    });
  }
});

export type AppConfig = z.infer<typeof baseSchema> & {
  isProduction: boolean;
  isTest: boolean;
  alertRecipients: string[];
};

function load(source?: NodeJS.ProcessEnv): AppConfig {
  if (!source) loadDotEnv();
  const parsed = schema.safeParse(source ?? process.env);

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuracion invalida:\n${detail}`);
  }

  const value = parsed.data;
  return {
    ...value,
    isProduction: value.NODE_ENV === 'production',
    isTest: value.NODE_ENV === 'test',
    alertRecipients: value.ALERT_RECIPIENTS.split(',')
      .map((email) => email.trim())
      .filter(Boolean),
  };
}

let cached: AppConfig | null = null;

/** Configuracion validada. Se memoriza tras la primera lectura. */
export function getConfig(): AppConfig {
  cached ??= load();
  return cached;
}

/** Solo para pruebas: reconstruye la configuracion desde un entorno dado. */
export function loadConfigFrom(source: NodeJS.ProcessEnv): AppConfig {
  return load(source);
}
