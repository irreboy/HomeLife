# Publicar Mi Día en Android

La aplicación web vive en `dist/` y no se compila. Capacitor la envuelve en una
aplicación Android para obtener lo que el navegador no da:

- **alarmas exactas** con la aplicación cerrada (los avisos web no lo garantizan);
- acceso a **Health Connect** para leer lo que mide el reloj;
- instalación desde Google Play, con actualizaciones automáticas.

Nada de esto requiere instalar Android Studio ni el SDK: **todo se compila en
GitHub Actions**.

---

## Paso 1 · Fijar el identificador (solo una vez, y es para siempre)

En `capacitor.config.json`:

```json
"appId": "io.github.irreboy.midia"
```

Google Play **no permite cambiarlo nunca** después de la primera publicación.
Si quieres otro, cámbialo ahora.

## Paso 2 · Crear el proyecto Android

En GitHub → pestaña **Actions** → «Crear proyecto Android (una vez)» → **Run workflow**.

Genera la carpeta `android/` y la deja commiteada. Solo se ejecuta una vez.

## Paso 3 · Crear la clave de firma

Google Play identifica la aplicación por su firma. **Si se pierde esta clave no
se puede volver a actualizar la app**: guárdala como guardas una contraseña
importante.

Necesitas `keytool`, que viene con Java. Si no lo tienes:

```bash
sudo apt install -y default-jdk-headless
```

Después:

```bash
keytool -genkey -v \
  -keystore mi-dia.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias mi-dia
```

Te pedirá una contraseña y algunos datos. Guarda el archivo `mi-dia.jks`
**fuera del repositorio** (está en `.gitignore`, pero mejor en tu gestor de
contraseñas o en un respaldo cifrado).

## Paso 4 · Cargar la clave en GitHub

Convierte la clave a texto:

```bash
base64 -w0 mi-dia.jks
```

En GitHub → **Settings → Secrets and variables → Actions → New repository secret**,
crea estos cuatro:

| Secreto | Contenido |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | el texto que imprimió el comando anterior |
| `ANDROID_KEYSTORE_PASSWORD` | la contraseña del almacén |
| `ANDROID_KEY_ALIAS` | `mi-dia` |
| `ANDROID_KEY_PASSWORD` | la contraseña de la clave |

Sin estos secretos el flujo compila igual, pero sin firmar: sirve para probar,
no para publicar.

## Paso 5 · Compilar

Actions → «Compilar Android» → **Run workflow**.

Deja dos archivos en los artefactos de la ejecución:

- `mi-dia-1.0.0.aab` → **esto es lo que se sube a Google Play**
- `mi-dia-1.0.0.apk` → para instalar directo en un teléfono y probar

## Paso 6 · Google Play

1. Crear la cuenta de desarrollador en
   [Play Console](https://play.google.com/console) — **US$25, pago único y de
   por vida**, con apps ilimitadas. Piden cédula para verificar identidad.
2. **Crear app** → nombre «Mi Día», español, gratuita.
3. Subir el `.aab` a **Prueba interna**.
4. Agregar el correo de tu mamá como probadora y enviarle el enlace de
   invitación. Desde ahí instala como cualquier otra aplicación y recibe
   actualizaciones solas.

La **prueba interna no pasa por la regla de 12 probadores durante 14 días**;
esa regla aplica solo si algún día quieres la ficha pública en producción.

Hay que completar igualmente el contenido obligatorio: política de privacidad,
clasificación de contenido y el formulario de seguridad de datos. Como la
aplicación no envía datos de salud a ningún servidor, ese formulario es corto y
honesto: lo único que sale del teléfono son los mensajes que la usuaria escribe
en la pestaña Compañera.

## Paso 7 · Actualizar

Cada ejecución del flujo sube el `versionCode` sola (usa el número de
ejecución). Compilas, subes el `.aab` nuevo a la prueba interna y Play lo
distribuye.

Para generar además una Release con APK descargable, marca la casilla
«Crear además una Release con la APK», o publica una etiqueta:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

---

## El backend del chat

La pestaña Compañera llama a `/api/chat`. En la aplicación Android ese camino
debe apuntar al Worker publicado, no al propio teléfono. Antes de la primera
compilación hay que desplegar el Worker y fijar su dominio:

```bash
npx wrangler login
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler deploy
```

El resto de la aplicación —medicamentos, compras, recetas, notas, presión—
funciona sin conexión y sin servidor.
