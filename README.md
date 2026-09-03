# Bandeja Uniremington

Una sola bandeja, con inteligencia artificial, para todo lo que llega por Instagram y Facebook a la Corporación Universitaria Remington: escucha, clasifica, redacta y deja la última palabra en el equipo.

Implementa la propuesta de servicio de btodigital del 25 de agosto de 2026.

---

## La regla que no se negocia

**Nada se publica sin que una persona de Uniremington lo lea y lo apruebe.**

Es un invariante del sistema, no una casilla de configuración. Se aplica en el servidor, contra el estado leído de la base de datos y no contra lo que envíe el cliente, en [`assertPublishable()`](apps/api/src/services/replies.ts). Nueve pruebas automatizadas lo custodian; si alguna falla, la promesa dejó de cumplirse.

Además, la política acordada excluye por completo de la respuesta asistida:

| Va con respuesta asistida (IA redacta, persona aprueba) | Siempre pasa a una persona |
| --- | --- |
| Preguntas de horarios, costos, sedes y fechas | Reclamos y quejas formales, sin excepción |
| Agradecimientos, felicitaciones y comentarios de grado | Cualquier caso con dato personal, financiero o de salud |
| Solicitudes que se resuelven con un enlace | Señalamientos, conflictos y todo lo que huela a crisis |
| Dudas simples sobre un programa o una modalidad | Consultas académicas que exigen el expediente del estudiante |

Codificada en [`apps/api/src/domain/policy.ts`](apps/api/src/domain/policy.ts).

---

## Qué hace

- **Bandeja unificada.** La cuenta nacional y las de sede (Medellín, Cali, Bogotá, Pereira, Cartago) en una sola cola, sin entrar cuenta por cuenta ni pedir contraseñas prestadas.
- **Clasificación automática.** Sentimiento, tema (interés de matrícula, pregunta, queja, soporte, elogio, spam) y marca de urgencia sobre cada interacción.
- **Respuesta asistida.** Borrador redactado con el texto de la publicación a la que responde y el tono institucional. Ajustable: más corto, más formal, más cercano.
- **Aprobación humana.** Obligatoria, registrada y auditada.
- **Moderación.** Ocultar un comentario desde la misma bandeja, sin abrir Meta.
- **Reparto del trabajo.** Asignación por persona, filtro de "los míos", acciones en lote.
- **Alertas por correo.** Casos urgentes y acumulación de comentarios negativos.
- **Tablero.** Volumen, sentimiento, temas, respondidos, pendientes y tiempo promedio de respuesta, por persona y por cuenta.
- **Detección de respuestas externas.** Si el equipo respondió desde Meta, deja de mostrarse como pendiente.

---

## Puesta en marcha

Requiere Node.js 20.12 o superior.

```bash
npm install
cp apps/api/.env.example apps/api/.env
```

Edite `apps/api/.env` y genere una clave de cifrado propia:

```bash
openssl rand -base64 32     # pegue el resultado en ENCRYPTION_KEY
```

Después:

```bash
npm run db:migrate          # crea el esquema
npm run db:seed             # administrador, cuentas de ejemplo y tono institucional
npm run dev                 # API en :3000, interfaz en :5173
```

La contraseña del administrador se imprime **una sola vez** al ejecutar el seed. No hay credenciales por defecto en el código.

Abra <http://localhost:5173>, entre y sincronice una cuenta desde **Cuentas** para ver la bandeja poblada con comentarios de ejemplo.

### Habilitar la IA

```env
AI_ENABLED=true
ANTHROPIC_API_KEY=sk-ant-...
```

Con `AI_ENABLED=false` el sistema funciona igual, pero toda interacción entra marcada como "la atiende una persona" y no se ofrece borrador asistido. Es el modo seguro por omisión.

---

## Costo de operación

El sistema está afinado para gastar lo mínimo que la función admite. **Claude Haiku 4.5** en las dos tareas (1 USD por millón de tokens de entrada, 5 por millón de salida): clasificar un comentario y redactar tres frases con un reglamento explícito no necesita un modelo de razonamiento profundo, y todo borrador pasa por revisión humana, así que el riesgo de un texto mediocre está acotado.

Encima del modelo barato hay cuatro medidas que reducen el número de llamadas y su tamaño:

| Medida | Efecto |
| --- | --- |
| **Reglas locales primero** | Un corazón, una mención suelta o un comentario sin letras se clasifican sin llamar al modelo. |
| **Reutilización por huella de texto** | "precio?", "Precio??" y "PRECIO" comparten huella. La segunda vez y las siguientes no se pagan. Ventana configurable en `AI_CLASSIFY_REUSE_DAYS`. |
| **Prompts cortos y entrada recortada** | El texto del sistema viaja en cada petición: está escrito para ser breve sin perder lo que discrimina. Comentario limitado a 1200 caracteres y publicación a 400. |
| **Techo de salida bajo** | 200 tokens para clasificar (un JSON de cinco campos), 400 para redactar (dos a cuatro frases). Una respuesta no puede desbordarse y encarecer la petición. |

La detección de datos personales y la política de atención corren **siempre en local**: son deterministas, no cuestan nada y no dependen del modelo.

El tablero muestra el consumo real: costo estimado, porcentaje de clasificaciones resueltas sin costo y tokens del periodo. Si los borradores quedan cortos de calidad, el paso intermedio es subir **solo** la redacción:

```env
AI_MODEL_DRAFT=claude-sonnet-5     # la clasificación sigue en Haiku
```

### Conectar Meta de verdad

```env
SOCIAL_PROVIDER=meta
META_APP_ID=...
META_APP_SECRET=...
META_WEBHOOK_VERIFY_TOKEN=...      # cadena larga y aleatoria de su elección
PUBLIC_API_URL=https://bandeja.uniremington.edu.co
```

Registre el webhook en la app de Meta apuntando a `POST {PUBLIC_API_URL}/api/webhooks/meta`, suscrito a `comments`, `mentions` y `messages`. Luego cargue el token de página de cada cuenta desde la pantalla **Cuentas**.

La cuenta de Instagram debe estar en modo profesional y vinculada a la página de Facebook. Los mensajes directos exigen además activar "Permitir acceso a los mensajes"; los comentarios no dependen de eso.

---

## Arquitectura

```
apps/
├─ api/                         Fastify 5 + TypeScript + Prisma
│  ├─ prisma/schema.prisma      Esquema portable SQLite / PostgreSQL
│  └─ src/
│     ├─ config/env.ts          Configuración validada con Zod; no arranca si falta algo
│     ├─ domain/                Enumeraciones, permisos por rol y política de automatización
│     ├─ lib/                   Cifrado, contraseñas, detección de datos personales, errores
│     ├─ plugins/               Seguridad HTTP, autenticación, CSRF, manejo de errores
│     ├─ routes/                Rutas HTTP, una por área
│     ├─ services/
│     │  ├─ ai/                 Clasificador y redactor (SDK de Anthropic)
│     │  ├─ social/             Interfaz SocialProvider + Meta Graph API + proveedor simulado
│     │  ├─ replies.ts          Ciclo de vida de la respuesta y el invariante de publicación
│     │  ├─ ingestion.ts        Ingesta idempotente
│     │  └─ audit.ts            Registro de auditoría
│     └─ jobs/                  Sincronización periódica y purga de retención
└─ web/                         React 18 + Vite + TanStack Query
```

### Decisiones que conviene conocer

**Capa de proveedores.** Toda la aplicación habla con la interfaz [`SocialProvider`](apps/api/src/services/social/types.ts), nunca con la Graph API directamente. Eso permite desarrollar y demostrar sin credenciales (`SOCIAL_PROVIDER=mock`), cambiar de versión de la Graph API en un solo archivo, y añadir otra red más adelante sin tocar la lógica de negocio.

**Base de datos portable.** El esquema evita enums nativos, arreglos y tipos JSON propios de PostgreSQL. Corre en SQLite para desarrollo y en PostgreSQL en producción cambiando el `provider` en `schema.prisma`. Las enumeraciones se validan en la aplicación con Zod, única fuente de verdad.

**Sesiones opacas en cookie, no JWT en localStorage.** La cookie es `httpOnly`, así que un XSS no puede leerla; la sesión se revoca al instante desde el servidor; no hay token de larga vida circulando por el navegador. El costo es una consulta por petición, irrelevante en una bandeja de trabajo interna.

**scrypt para contraseñas.** Sin binarios nativos que compilar en Windows ni en el servidor de la universidad, y con coste de memoria (N=2^15, ~64 MB por verificación), resistente a GPU.

**El modelo declina, no se reintenta con otro.** Si Claude rechaza una petición, el caso se escala a una persona en lugar de enrutarlo a un modelo de reserva. En una bandeja donde ninguna respuesta sale sin aprobación humana, escalar es la conducta correcta; un modelo de reserva contestando un caso delicado, no.

---

## Roles

| Rol | Puede |
| --- | --- |
| **Observador** | Consultar bandeja, cuentas, tablero y alertas |
| **Agente** | Lo anterior, más asignar, archivar y redactar borradores |
| **Supervisor** | Lo anterior, más aprobar, publicar, moderar, editar el tono y ver auditoría |
| **Administrador** | Todo, incluidas cuentas y usuarios |

Matriz explícita en [`apps/api/src/domain/permissions.ts`](apps/api/src/domain/permissions.ts). Un permiso nuevo empieza negado para todos los roles.

---

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | API y frontend en paralelo |
| `npm test` | Pruebas de la API |
| `npm run typecheck` | Verificación de tipos de ambos paquetes |
| `npm run build` | Compilación de producción |
| `npm run db:migrate` | Aplica migraciones |
| `npm run db:seed` | Carga inicial |
| `npm run db:studio` | Explorador visual de la base |

---

## Documentación adicional

- [Seguridad y protección de datos](docs/SEGURIDAD.md) — controles implementados y cumplimiento de la Ley 1581 de 2012
- [Despliegue en producción](docs/DESPLIEGUE.md) — PostgreSQL, HTTPS, proceso y respaldos
