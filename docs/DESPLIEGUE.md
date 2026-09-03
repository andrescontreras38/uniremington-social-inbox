# Despliegue en producción

Cinco días hábiles desde que Uniremington concede el acceso, según el cronograma de la propuesta. Ninguno de estos pasos exige tocar el sitio web ni cambiar de plataforma de publicación.

---

## 1. Pasar a PostgreSQL

SQLite sirve para desarrollo. En producción, PostgreSQL.

En `apps/api/prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

El esquema ya es portable: no usa enums nativos, arreglos ni tipos JSON propios de PostgreSQL. En el `.env`:

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
AI_MODEL=claude-opus-5

SMTP_HOST=smtp.uniremington.edu.co
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
ALERT_RECIPIENTS=comunicaciones@uniremington.edu.co,admisiones@uniremington.edu.co

DATA_RETENTION_DAYS=730
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
