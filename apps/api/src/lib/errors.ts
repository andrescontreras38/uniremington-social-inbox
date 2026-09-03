/**
 * Errores de aplicacion.
 *
 * El manejador global (src/plugins/error-handler.ts) traduce estas clases a
 * respuestas HTTP. Los detalles internos nunca se envian al cliente en
 * produccion: se registran con el id de la peticion.
 */

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  /** Verdadero cuando el mensaje es seguro de mostrar al usuario final. */
  readonly expose: boolean;

  constructor(
    message: string,
    options: { statusCode?: number; code?: string; details?: unknown; expose?: boolean } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.details = options.details;
    this.expose = options.expose ?? this.statusCode < 500;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Datos invalidos', details?: unknown) {
    super(message, { statusCode: 400, code: 'VALIDATION_ERROR', details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Credenciales invalidas o sesion expirada') {
    super(message, { statusCode: 401, code: 'UNAUTHORIZED' });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No tiene permisos para esta accion') {
    super(message, { statusCode: 403, code: 'FORBIDDEN' });
  }
}

export class NotFoundError extends AppError {
  constructor(entity = 'Recurso') {
    super(`${entity} no encontrado`, { statusCode: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'La operacion entra en conflicto con el estado actual') {
    super(message, { statusCode: 409, code: 'CONFLICT' });
  }
}

/**
 * Se lanza cuando una operacion viola una regla de negocio irrenunciable,
 * por ejemplo intentar publicar una respuesta que ninguna persona aprobo.
 */
export class PolicyViolationError extends AppError {
  constructor(message: string) {
    super(message, { statusCode: 422, code: 'POLICY_VIOLATION' });
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, details?: unknown) {
    super(`Fallo al comunicarse con ${service}: ${message}`, {
      statusCode: 502,
      code: 'EXTERNAL_SERVICE_ERROR',
      details,
      expose: false,
    });
  }
}
