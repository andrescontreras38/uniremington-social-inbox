# Despliegue en producción

Hay dos caminos documentados aquí. **Vercel** es el más rápido de poner en marcha: despliegue automático con cada `git push`, sin servidor propio que mantener. **VPS con systemd** es la alternativa cuando se necesita un proceso persistente propio (por ejemplo, si la sincronización cada 5 minutos importa y no se quiere pagar el plan Pro de Vercel, que es el que permite Cron Jobs más frecuentes que una vez al día).

La base de datos es **PostgreSQL en los dos casos**: SQLite no sirve para Vercel (su sistema de archivos no persiste entre invocaciones) y Prisma no permite un motor distinto por entorno desde un mismo `schema.prisma`, así que se usa Postgres también en desarrollo local. Recomendado: un proyecto gratuito en [Neon](https://neon.tech), con una rama `dev` y otra `prod` bajo el mismo proyecto — así local y producción comparten motor sin instalar Postgres a mano.

---

## Camino A · Vercel (despliegue automático)

### A.1 Requisitos previos

Tres cuentas, todas gratuitas para empezar:

1. **GitHub** — donde vive el código.
2. **[Neon](https://neon.tech)** — la base de datos Postgres.
3. **[Vercel](https://vercel.com)** — donde corre la aplicación.

### A.2 Crear la base de datos

En Neon: *New Project* → nombre `uniremington` → se crea automáticamente una rama `main`. Cree una segunda rama `dev` (*Branches* → *Create branch*, a partir de `main`) para desarrollo local, y deje `main` para producción.

De cada rama, copie la cadena de conexión **pooled** (no la directa): Neon la marca como *Pooled connection* en el panel. Cada invocación serverless de Vercel abre su propia conexión a la base; sin *pooling* se agotan rápido.

### A.3 Subir el código a GitHub

En github.com, cree un repositorio vacío (**privado** — el código trae correos y teléfonos reales del personal de las sedes en `apps/api/prisma/data/campus-contacts.json`, y precios reales de matrícula; no son para un repositorio público). No marque "Initialize with README": el proyecto ya tiene uno.

```bash
git remote add origin https://github.com/<su-usuario>/<su-repo>.git
git branch -M main
git push -u origin main
```

### A.4 Conectar el proyecto en Vercel

*Add New* → *Project* → importe el repositorio de GitHub. Vercel detecta `vercel.json` en la raíz y usa esa configuración: no hay que tocar el *Framework Preset* ni el *Build Command* a mano.

En **Settings → Environment Variables**, cargue (aplican a Production, Preview y Development salvo que se indique lo contrario):

```env
NODE_ENV=production
DATABASE_URL=<cadena pooled de la rama de Neon que corresponda a cada entorno>
ENCRYPTION_KEY=<32 bytes en base64, generada una sola vez>

# Vercel expone la URL del despliegue en esta variable automatica; aqui se
# fija a mano porque WEB_ORIGIN y PUBLIC_API_URL deben ser exactos.
WEB_ORIGIN=https://<su-proyecto>.vercel.app
PUBLIC_API_URL=https://<su-proyecto>.vercel.app

SOCIAL_PROVIDER=mock          # cambie a "meta" cuando tenga las credenciales
AI_ENABLED=false              # cambie a "true" cuando tenga la clave de Anthropic
ANTHROPIC_API_KEY=sk-ant-...  # obligatoria si AI_ENABLED=true

# Obligatorio en Vercel: no hay proceso persistente para el setInterval.
ENABLE_JOBS=false
CRON_SECRET=<genere uno largo y aleatorio; Vercel lo agrega solo a los Cron>

SEED_ADMIN_EMAIL=responsable@uniremington.edu.co
```

`ENABLE_JOBS=false` es obligatorio: sin un proceso que se quede vivo entre peticiones, el `setInterval` de `jobs/scheduler.ts` no tiene dónde correr. `vercel.json` ya trae los dos *Cron Jobs* configurados (`/api/internal/sync` y `/api/internal/retention`) que reemplazan esa sincronización; Vercel les agrega automáticamente el encabezado `Authorization: Bearer <CRON_SECRET>` en cuanto la variable existe en el proyecto — no hay nada más que conectar.

**Límite del plan gratuito:** los *Cron Jobs* del plan Hobby corren como máximo una vez al día. `vercel.json` trae `*/5 * * * *` (cada 5 minutos) para la sincronización, que **exige el plan Pro** (20 USD/mes). Con Hobby, cambie esa línea a `0 */6 * * *` (cada 6 horas) o similar — los comentarios nuevos igual llegan en tiempo real por el *webhook* de Meta; lo que pierde frecuencia es solo la pasada de repaso que detecta lo que el *webhook* no entregó.

Despliegue: *Deploy*. Cada `git push` a `main` desde ahí en adelante despliega solo, incluida la migración de la base (`vercel.json` ejecuta `prisma migrate deploy` como parte del *build*).

### A.5 Primer arranque

Con el proyecto desplegado y `DATABASE_URL` apuntando a la rama de producción:

```bash
DATABASE_URL="<cadena pooled de la rama prod>" npm run db:seed --workspace @uniremington/api
DATABASE_URL="<la misma>" npm run db:seed:programs-2026 --workspace @uniremington/api
DATABASE_URL="<la misma>" npm run db:seed:campus-contacts --workspace @uniremington/api
```

Anote la contraseña que imprime el primer comando; no vuelve a mostrarse. Después siga la sección **6. Primer arranque** más abajo (cargar tokens de página, sincronizar, crear usuarios) — es igual en los dos caminos de despliegue.

### A.6 Webhook de Meta en Vercel

La URL de devolución de llamada es `https://<su-proyecto>.vercel.app/api/webhooks/meta` (o el dominio propio, si conecta uno en Vercel). El resto es igual a la sección **5. Webhook de Meta**.

---

## Camino B · VPS con systemd

## 1. Base de datos

El esquema ya es portable: no usa enums nativos, arreglos ni tipos JSON propios de PostgreSQL, así que corre igual en cualquier Postgres moderno. En el `.env`:

```env
DATABASE_URL="postgresql://usuario:clave@servidor:5432/uniremington?schema=public&sslmode=require"
```

Y aplique las migraciones:

```bash
npm run db:deploy    # migrate deploy, no migrate dev
```

---

## 2. Variables de entorno

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

DATABASE_URL=postgresql://...
ENCRYPTION_KEY=<32 bytes en base64, generada una sola vez>

WEB_ORIGIN=https://bandeja.uniremington.edu.co
PUBLIC_API_URL=https://bandeja.uniremington.edu.co

SOCIAL_PROVIDER=meta
META_APP_ID=...
META_APP_SECRET=...
META_WEBHOOK_VERIFY_TOKEN=<cadena larga y aleatoria>

AI_ENABLED=true
ANTHROPIC_API_KEY=sk-ant-...
# Haiku 4.5 en las dos tareas: es el modelo mas economico y alcanza de sobra
# para clasificar y para redactar tres frases con un reglamento explicito.
# Vea "Costo de operacion" en el README antes de subir a Sonnet u Opus.
AI_MODEL_CLASSIFY=claude-haiku-4-5
AI_MODEL_DRAFT=claude-haiku-4-5

SMTP_HOST=smtp.uniremington.edu.co
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
ALERT_RECIPIENTS=comunicaciones@uniremington.edu.co,admisiones@uniremington.edu.co

DATA_RETENTION_DAYS=730

# Deja los trabajos programados corriendo dentro de este mismo proceso
# (setInterval); es lo correcto en un servidor persistente como este.
ENABLE_JOBS=true
SYNC_INTERVAL_MINUTES=5
```

La configuración se valida al arrancar. **El proceso no inicia** si falta la clave de cifrado, si el proveedor está en `mock`, o si `PUBLIC_API_URL` no es HTTPS. Es deliberado: fallar al iniciar es mejor que arrancar con un secreto vacío.

Guarde `ENCRYPTION_KEY` en el gestor de secretos de la institución. **Si se pierde, los tokens de página cifrados no se pueden recuperar** y habrá que volver a cargarlos.

---

## 3. Compilar y ejecutar

```bash
npm ci
npm run build
npm start
```

`npm run build` genera la API en `apps/api/dist` y la interfaz estática en `apps/web/dist`.

Ejecute la API bajo un supervisor de procesos (systemd, PM2 o un contenedor) que la reinicie si cae. El apagado es ordenado: deja de aceptar conexiones, espera a que terminen las peticiones en curso y cierra la base.

Ejemplo de unidad systemd:

```ini
[Unit]
Description=Bandeja Uniremington
After=network.target postgresql.service

[Service]
Type=simple
User=bandeja
WorkingDirectory=/opt/bandeja/apps/api
EnvironmentFile=/opt/bandeja/apps/api/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/bandeja/apps/api

[Install]
WantedBy=multi-user.target
```

---

## 4. Servidor web

Sirva `apps/web/dist` como estático y haga proxy de `/api` a la API. Ambos deben compartir origen para que la cookie de sesión viaje sin configuración adicional.

```nginx
server {
    listen 443 ssl http2;
    server_name bandeja.uniremington.edu.co;

    ssl_certificate     /etc/ssl/certs/uniremington.crt;
    ssl_certificate_key /etc/ssl/private/uniremington.key;

    root /opt/bandeja/apps/web/dist;
    index index.html;

    # La interfaz es una aplicación de una sola página.
    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name bandeja.uniremington.edu.co;
    return 301 https://$host$request_uri;
}
```

La API corre con `trustProxy` en producción, así que el límite de tasa y la auditoría registran la IP real del cliente.

---

## 5. Webhook de Meta

En la aplicación de Meta, configure el webhook:

- **URL de devolución de llamada:** `https://bandeja.uniremington.edu.co/api/webhooks/meta`
- **Token de verificación:** el valor de `META_WEBHOOK_VERIFY_TOKEN`
- **Campos suscritos:** `comments`, `mentions`, `messages`

Meta hace un `GET` con un reto; la aplicación lo responde solo si el token coincide.

Requisitos del lado de Uniremington:

- Un responsable del lado de la institución.
- Acceso a la página y a la cuenta de Instagram desde el Business Manager. Es el mismo permiso que ya se otorga para pauta: no se comparten contraseñas.
- La cuenta de Instagram en modo profesional, vinculada a la página.
- Media hora del equipo que hoy responde, para definir el tono.
- La decisión de qué cuentas de sede entran en el piloto.

---

## 6. Primer arranque

```bash
SEED_ADMIN_EMAIL=responsable@uniremington.edu.co npm run db:seed
```

Anote la contraseña que imprime; no vuelve a mostrarse. El sistema exige cambiarla en el primer ingreso.

Después, desde la aplicación:

1. **Cuentas** → cargue el token de página de cada cuenta del piloto.
2. **Cuentas** → *Sincronizar* en cada una. Es el momento en que el equipo ve, por primera vez, cuántos comentarios están sin responder.
3. **Usuarios** → cree las cuentas del equipo con el rol que corresponda.
4. Revise el tono institucional cargado por omisión y ajústelo con el equipo.

Elimine las cuatro cuentas de ejemplo que crea el seed (`ig_uniremington_nacional` y demás) una vez cargadas las reales.

---

## 7. Operación

**Trabajos programados.** La API ejecuta la sincronización periódica (cada 5 minutos) y la purga de retención (diaria) dentro de su propio proceso. Si el volumen crece, ponga `ENABLE_JOBS=false` en la API y levante el mismo módulo en un proceso aparte; no hay que tocar nada más.

**Sondas de salud.**

| Ruta | Uso |
| --- | --- |
| `GET /api/health/live` | ¿El proceso está vivo? Para el supervisor. |
| `GET /api/health/ready` | ¿La base responde? Para el balanceador. |

**Respaldos.** Respalde la base de datos a diario y verifique la restauración. Guarde `ENCRYPTION_KEY` aparte del respaldo: un respaldo con la clave dentro no protege nada.

**Logs.** JSON estructurado en producción, con secretos redactados y el texto de los comentarios enmascarado. Envíelos a un agregador con retención propia.

**Rotación de tokens.** Los tokens de página de Meta caducan. La pantalla de cuentas muestra la fecha de vencimiento; renuévelos desde ahí antes de que expiren.

---

## 8. Verificación posterior al despliegue

```bash
# La API responde y la base está conectada
curl https://bandeja.uniremington.edu.co/api/health/ready

# Un webhook sin firma válida se rechaza
curl -X POST https://bandeja.uniremington.edu.co/api/webhooks/meta \
     -H 'content-type: application/json' -d '{}'
# Esperado: 401 INVALID_SIGNATURE

# Las cabeceras de seguridad están presentes
curl -sI https://bandeja.uniremington.edu.co/api/health/live | grep -i strict-transport
```

Y en la aplicación: inicie sesión con un usuario de rol Agente y confirme que **no** aparece el botón de publicar.
