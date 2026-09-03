# Seguridad y protección de datos

Este documento describe los controles implementados y cómo el sistema se ajusta a la Ley 1581 de 2012 de protección de datos personales.

---

## 1. Autenticación

| Control | Implementación |
| --- | --- |
| Almacenamiento de contraseñas | scrypt (RFC 7914), N=2^15, r=8, p=1, sal aleatoria de 16 bytes por usuario. Nunca en texto plano ni con hash reversible. |
| Política de contraseñas | Mínimo 12 caracteres, rechazo de contraseñas evidentes. Sigue NIST SP 800-63B: longitud sobre reglas de composición, sin rotación forzada periódica. |
| Sesiones | Token opaco de 32 bytes. La base guarda solo su hash SHA-256; el token en claro vive únicamente en la cookie del navegador. |
| Cookie de sesión | `httpOnly`, `SameSite=Lax`, `Secure` en producción, con expiración explícita. |
| Expiración | Absoluta (12 h por defecto) y por inactividad (120 min). Una pestaña olvidada en un equipo compartido deja de servir. |
| Fuerza bruta | Bloqueo temporal tras 5 intentos fallidos (15 min). El inicio de sesión tiene su propio límite de tasa: 10 intentos por 5 minutos y por IP. |
| Enumeración de usuarios | La respuesta y el tiempo de respuesta son idénticos si el correo no existe o si la contraseña es incorrecta. |
| Revocación | Cambiar la contraseña, cambiar el rol o desactivar una cuenta cierra todas las sesiones abiertas de esa persona. |

**Por qué sesiones y no JWT en `localStorage`:** un token accesible desde JavaScript es robable con un XSS y no se puede revocar antes de que expire. La cookie `httpOnly` no es legible por script y la sesión se corta desde el servidor al instante.

---

## 2. Autorización

Matriz de permisos explícita por rol en `apps/api/src/domain/permissions.ts`. No se deriva por jerarquía: leer la tabla basta para saber quién puede publicar en nombre de la institución, y un permiso nuevo empieza negado para todos.

Cada ruta declara el permiso que exige mediante `requirePermission()`. La interfaz oculta lo que el rol no permite, pero eso es comodidad, no seguridad: **la autorización real se aplica siempre en el servidor**.

Salvaguardas adicionales:

- Nadie puede cambiarse su propio rol ni desactivar su propia cuenta.
- Siempre debe quedar al menos un administrador activo.

---

## 3. Protección contra CSRF

La sesión viaja en cookie, así que hay dos capas:

1. **Verificación de `Origin`** contra el origen autorizado, en toda petición que modifique estado.
2. **Doble envío de token**: una cookie legible por el frontend cuyo valor debe repetirse en el encabezado `x-csrf-token`. Un sitio de terceros puede provocar la petición, pero no puede leer la cookie para copiar el valor.

El webhook de Meta queda excluido: no usa cookies y se autentica por firma HMAC.

---

## 4. Webhook de Meta

- Firma verificada con **HMAC-SHA256 sobre el cuerpo crudo** y comparación en tiempo constante. Reserializar el JSON cambiaría bytes y rompería la firma, así que la ruta registra su propio analizador de contenido que conserva el buffer original.
- Un evento con firma inválida o ausente se descarta **antes de tocar la base de datos**.
- El reto de suscripción (`GET`) compara el token de verificación en tiempo constante.
- **Idempotencia**: cada cuerpo se registra por su hash. Si Meta reintenta la entrega, no se duplica nada.
- Se responde `200` de inmediato y se procesa después: Meta reintenta si la respuesta tarda más de 20 segundos.

---

## 5. Secretos

| Secreto | Tratamiento |
| --- | --- |
| Token de página de Meta | Cifrado en reposo con **AES-256-GCM**, vector de inicialización aleatorio por registro y etiqueta de autenticación. Se descifra solo en el instante de usarlo. |
| Clave maestra | En variable de entorno, 32 bytes en base64. El proceso **no arranca** si falta o es inválida. |
| Clave de la API de Claude | Solo en variable de entorno. |
| Contraseñas | Nunca se almacenan ni se registran. |

Ninguna ruta devuelve un token, ni siquiera cifrado. La pantalla de cuentas solo informa si la cuenta está conectada y cuándo vence el token. El registro de auditoría de una rotación de token guarda la fecha de vencimiento, nunca el valor ni su prefijo.

---

## 6. Datos personales (Ley 1581 de 2012)

Los comentarios y mensajes contienen datos de aspirantes y estudiantes. Controles aplicados:

**Detección.** `scanPii()` marca documentos de identidad, teléfonos, correos, datos financieros, datos de salud, direcciones y señalamientos personales. Es deliberadamente conservadora: prefiere marcar de más y enviar a una persona antes que dejar pasar un dato sensible.

**Finalidad limitada.** El texto de un comentario **no se escribe en claro en los logs**. Todo lo que va a un log, a un correo de alerta o al registro de auditoría pasa antes por `maskPii()`.

**Minimización en el canal público.** Antes de publicar una respuesta se vuelve a analizar el texto saliente: si contiene datos personales, la publicación se bloquea y se sugiere continuar por mensaje directo.

**Moderación.** Una cédula o un dato de salud que quedó público en un comentario abierto se oculta desde la misma bandeja, sin abrir Meta y sin discutir quién tiene el acceso.

**Temporalidad.** Purga automática diaria de interacciones cerradas que superan la retención configurada (`DATA_RETENTION_DAYS`, 730 días por defecto). El registro de auditoría y las métricas agregadas sobreviven porque no contienen el texto.

**Trazabilidad.** Toda acción sobre datos personales queda registrada con actor, fecha, IP y agente de usuario.

> Antes de conectar la primera cuenta, el tratamiento debe revisarse con el área jurídica de Uniremington y ajustarse a su política de habeas data.

---

## 7. Capa HTTP

| Control | Configuración |
| --- | --- |
| Cabeceras | Helmet: CSP restrictiva, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, HSTS con precarga en producción. |
| CORS | Un único origen explícito. Sin comodín, porque se envían cookies. |
| Límite de tasa | 300 peticiones por minuto y por IP; más estricto en inicio de sesión, cambio de contraseña, generación de borradores y sincronización. |
| Tamaño de cuerpo | 1 MB. |
| Validación de entrada | Zod en cada ruta. Nada llega a la base sin validar. |
| Inyección SQL | Prisma parametriza toda consulta. No hay concatenación de SQL en el proyecto. |
| Errores | Los detalles internos nunca salen al cliente en producción. Cada respuesta lleva un identificador de petición con el que el equipo técnico encuentra el error completo en los logs. |

---

## 8. Uso de la IA

- El texto del comentario se envía a la API de Anthropic para clasificarlo y redactar el borrador. **La detección de datos personales corre en local**, de forma determinista, antes y con independencia del modelo.
- El modelo tiene prohibido en su instrucción de sistema inventar cifras, fechas, valores de matrícula, becas o plazos, y pedir o repetir datos personales en un comentario público.
- Si el modelo declina una petición, el caso **se escala a una persona**; no se reintenta con otro modelo.
- Si el modelo falla o está deshabilitado, la clasificación de reserva marca el caso como de atención humana. El modo degradado es el modo seguro.
- Ningún borrador se publica solo. Sin excepción.

---

## 9. Pruebas de seguridad

`npm test` cubre, entre otras cosas:

- El invariante de publicación, en nueve escenarios (sin aprobar, aprobado sin aprobador, aprobado sin fecha, rechazado, texto vacío, doble publicación, exceso de longitud).
- Verificación de firma del webhook: válida, con otro secreto, con cuerpo alterado, sin firma, algoritmo incorrecto.
- Cifrado: ida y vuelta, no determinismo del texto cifrado, detección de alteración.
- Contraseñas: verificación, formato inválido, política.
- Permisos por rol.
- Detección y enmascaramiento de datos personales.
- La política de automatización, caso por caso.

---

## 10. Pendientes recomendados

Fuera del alcance de esta entrega, pero convenientes antes de un despliegue amplio:

- Segundo factor de autenticación para los roles Supervisor y Administrador.
- Envío de los logs a un agregador externo con retención propia.
- Revisión periódica de dependencias (`npm audit`) en integración continua.
- Prueba de intrusión sobre el despliegue real.
