import type { Role } from './enums.js';

/**
 * Matriz de permisos por rol.
 *
 * Se declara de forma explicita en lugar de derivarse por jerarquia: leer la
 * tabla debe bastar para saber quien puede publicar en nombre de la
 * institucion. Un permiso nuevo empieza negado para todos los roles.
 */
export const PERMISSIONS = [
  'inbox:read',
  'inbox:assign',
  'inbox:archive',
  'inbox:moderate', // ocultar o mostrar un comentario en Meta
  'reply:draft', // pedir un borrador a la IA o escribirlo a mano
  'reply:approve', // aprobar el texto final
  'reply:publish', // publicarlo en Meta
  'accounts:read',
  'accounts:write',
  'tone:read',
  'tone:write',
  'templates:read',
  'templates:write',
  'users:read',
  'users:write',
  'analytics:read',
  'alerts:read',
  'alerts:write',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  VIEWER: [
    'inbox:read',
    'accounts:read',
    'tone:read',
    'templates:read',
    'analytics:read',
    'alerts:read',
  ],

  AGENT: [
    'inbox:read',
    'inbox:assign',
    'inbox:archive',
    'reply:draft',
    'accounts:read',
    'tone:read',
    'templates:read',
    'analytics:read',
    'alerts:read',
  ],

  SUPERVISOR: [
    'inbox:read',
    'inbox:assign',
    'inbox:archive',
    'inbox:moderate',
    'reply:draft',
    'reply:approve',
    'reply:publish',
    'accounts:read',
    'tone:read',
    'tone:write',
    'templates:read',
    'templates:write',
    'users:read',
    'analytics:read',
    'alerts:read',
    'alerts:write',
    'audit:read',
  ],

  ADMIN: [...PERMISSIONS],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsOf(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
