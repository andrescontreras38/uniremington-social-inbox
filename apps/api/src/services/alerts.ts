import nodemailer, { type Transporter } from 'nodemailer';
import { getConfig } from '../config/env.js';
import type { AlertSeverity, AlertType } from '../domain/enums.js';
import { logger } from '../lib/logger.js';
import { safeExcerpt } from '../lib/pii.js';
import { prisma } from '../lib/prisma.js';

/**
 * Alertas por correo.
 *
 * Dos disparadores, tal como se acordo:
 *  - Un caso urgente entra a la bandeja.
 *  - Se acumulan comentarios negativos nuevos en una ventana corta.
 *
 * El correo lleva el contexto minimo y el enlace a la bandeja; el texto del
 * comentario va enmascarado, porque un buzon de correo no es el lugar para la
 * cedula de un aspirante.
 */

let transporter: Transporter | null = null;
let transportChecked = false;

function getTransporter(): Transporter | null {
  if (transportChecked) return transporter;
  transportChecked = true;

  const config = getConfig();
  if (!config.SMTP_HOST || !config.SMTP_PORT) {
    logger.warn('SMTP no configurado: las alertas quedaran solo en la bandeja de alertas');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth:
      config.SMTP_USER && config.SMTP_PASSWORD
        ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
        : undefined,
  });

  return transporter;
}

export interface CreateAlertInput {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  interactionId?: string | null;
  accountId?: string | null;
  notify?: boolean;
}

export async function createAlert(input: CreateAlertInput): Promise<void> {
  const alert = await prisma.alert.create({
    data: {
      type: input.type,
      severity: input.severity,
      title: input.title,
      message: safeExcerpt(input.message, 1000),
      interactionId: input.interactionId ?? null,
      accountId: input.accountId ?? null,
    },
  });

  if (input.notify === false) return;
  await sendAlertEmail(alert.id, input);
}

async function sendAlertEmail(alertId: string, input: CreateAlertInput): Promise<void> {
  const config = getConfig();
  const transport = getTransporter();

  if (!transport || config.alertRecipients.length === 0) return;

  const subject = `[Bandeja Uniremington] ${input.severity === 'CRITICAL' ? 'URGENTE' : 'Aviso'}: ${input.title}`;
  const inboxUrl = input.interactionId
    ? `${config.WEB_ORIGIN}/bandeja/${input.interactionId}`
    : `${config.WEB_ORIGIN}/bandeja`;

  const body = [
    input.message,
    '',
    `Abrir en la bandeja: ${inboxUrl}`,
    '',
    'Este mensaje fue generado automaticamente. El texto del comentario aparece enmascarado por proteccion de datos personales (Ley 1581 de 2012).',
  ].join('\n');

  try {
    await transport.sendMail({
      from: config.ALERT_FROM,
      to: config.alertRecipients,
      subject,
      text: safeExcerpt(body, 4000),
    });

    await prisma.alert.update({ where: { id: alertId }, data: { notifiedAt: new Date() } });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), alertId },
      'No se pudo enviar la alerta por correo',
    );
  }
}

/**
 * Revisa si hay una acumulacion de comentarios negativos en la ventana
 * configurada y, de haberla, emite una sola alerta por ventana.
 */
export async function checkNegativeSpike(accountId: string): Promise<void> {
  const config = getConfig();
  const windowStart = new Date(Date.now() - config.NEGATIVE_SPIKE_WINDOW_MINUTES * 60 * 1000);

  const [negativeCount, recentAlert] = await Promise.all([
    prisma.interaction.count({
      where: {
        accountId,
        sentiment: 'NEGATIVE',
        createdAt: { gte: windowStart },
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
    }),
    prisma.alert.findFirst({
      where: { type: 'NEGATIVE_SPIKE', accountId, createdAt: { gte: windowStart } },
      select: { id: true },
    }),
  ]);

  if (negativeCount < config.NEGATIVE_SPIKE_THRESHOLD || recentAlert) return;

  const account = await prisma.socialAccount.findUnique({
    where: { id: accountId },
    select: { name: true },
  });

  await createAlert({
    type: 'NEGATIVE_SPIKE',
    severity: 'CRITICAL',
    title: `Acumulacion de comentarios negativos en ${account?.name ?? 'una cuenta'}`,
    message: `Se registraron ${negativeCount} comentarios negativos sin resolver en los ultimos ${config.NEGATIVE_SPIKE_WINDOW_MINUTES} minutos.`,
    accountId,
  });
}

/** Solo para pruebas: descarta el transporte memorizado. */
export function resetAlertTransport(): void {
  transporter = null;
  transportChecked = false;
}
