# Mi Día — Vida Saludable

PWA privada y offline para organizar medicamentos, alimentación, hidratación y registros de presión arterial.

## Abrir localmente

La aplicación está en `dist/` y no necesita compilación:

```bash
python3 -m http.server 4173 --directory dist
```

Luego abre `http://localhost:4173` en el navegador. Para instalarla en Android debe servirse mediante HTTPS (o `localhost` durante desarrollo).

## Despliegue full-stack en Cloudflare

La aplicación completa se publica como un solo Worker:

- `dist/` contiene la PWA y los recursos offline.
- `cloudflare/worker.js` atiende `/api/chat` y sirve los recursos mediante el binding `ASSETS`.
- `wrangler.jsonc` une ambas partes bajo el mismo dominio.
- `DEEPSEEK_API_KEY` se configura como secreto del Worker y nunca se incluye en el repositorio.

El despliegue se realiza con `wrangler deploy`. El chatbot usa el mismo origen que la
PWA, por lo que no requiere exponer credenciales ni configurar CORS.

## Datos y privacidad

- Los registros se guardan en IndexedDB, solamente en el dispositivo.
- El service worker nunca almacena en cache las respuestas de `/api/`.
- No hay cuentas, analítica, publicidad, telemetría ni envío de datos médicos.
- Configuración → Copia de seguridad permite exportar e importar JSON.
- El historial conserva una fotografía de los medicamentos y la meta de agua de cada día.

## Funciones incluidas

La aplicación tiene seis secciones: **Hoy**, **Súper**, **Recetas**, **Notas**,
**Salud** y **Compañera**. Los ajustes están en el engranaje de la barra superior.

### Hoy
- Accesos rápidos para agua, presión, una nota o decidir qué cocinar.
- Tomas del día agrupadas por mañana, tarde y noche.
- Recordatorios que no son medicamentos: citas, caminar, medir la presión.
- Hidratación, alimentación según la pauta, carbohidrato diario y plan de comidas.
- Nota del día y navegación a días anteriores para completar lo que faltó.

### Medicamentos
- Varias tomas por día y por medicamento, con pautas rápidas (1, 2, 3, 4 veces al día o solo de noche).
- Cada toma tiene identificador propio (`medicamento|fecha|hora`), así el historial sobrevive a recargas y a cambios de pauta.
- Registro de dosis indicada, cantidad realmente tomada, unidad, hora y nota.
- Una toma puede marcarse como omitida a propósito, que es distinto de no haberla registrado.
- Recurrencia diaria o cada N días, incluida Vitamina D cada 15 días.
- Existencias opcionales que se descuentan al registrar y avisan cuando quedan 7 días o menos.

### Avisos
Se entregan en tres capas, y ninguna es una alarma garantizada del sistema:

1. La aplicación revisa cada 20 segundos mientras está abierta.
2. El service worker mantiene temporizadores mientras siga vivo tras cerrarla.
3. Al volver a abrirla se revisan las tomas atrasadas.

Las notificaciones traen botones «La tomó», «Posponer 10 min» y «Omitir». Lo que se
responde con la aplicación cerrada se guarda en una bandeja (`outbox`) y se aplica al
abrirla: el service worker nunca marca una toma por su cuenta. Hay campana sintetizada,
vibración y contador en el icono. Los recordatorios generales usan el mismo motor.

### Súper
- **Lista** agrupada por pasillo del supermercado, con barra de avance y marcado de comprados.
- **En casa**: despensa con lo que hay y lo que se acabó. Alimenta al recetario.
- Catálogo cerrado de la pauta, más productos propios que quedan marcados como agregados por la familia.
- «Lo de siempre» para volver a poner en la lista con un toque los productos habituales.
- Compartir la lista por WhatsApp o portapapeles, ya ordenada por pasillo.
- Guardar de una vez en la despensa todo lo que se marcó como comprado.

### Recetas
- Recetario offline construido solo con alimentos de la pauta.
- Buscador por nombre, ingrediente o etiqueta, y filtros por comida o favoritas.
- **Puedo cocinar ahora**: cruza la receta con la despensa y muestra qué falta.
- Porciones ajustables: las cantidades se recalculan.
- «Agregar lo que falta a la compra» pasa los ingredientes ausentes a la lista, con la receta de origen.
- Planificar una receta para un día y comida; aparece en Hoy.

### Notas
- Notas por tipo: nota, pregunta para el médico, síntoma o indicación recibida.
- Buscador, filtros y notas fijadas arriba.
- Las preguntas y los síntomas se incluyen en el informe de la consulta.

### Salud
- Cumplimiento a 7, 30 o 90 días, racha de días completos y detalle por medicamento.
- Histograma de a qué hora se registran las tomas y agua por día.
- Gráfico SVG de presión y pulso: lecturas individuales hasta 6 semanas; promedios diarios con banda mínimo–máximo en períodos largos.
- Promedios, rangos y promedios por tramo del día.
- **Informe para la consulta**: documento imprimible (el navegador lo guarda como PDF) con lecturas, promedios, pauta vigente, cumplimiento, preguntas anotadas y observaciones. Exportación a CSV de presión y de tomas.
- Calendario mensual; al tocar un día se abre para completarlo.

La aplicación **no clasifica ni interpreta** la presión arterial: muestra lo registrado y
sus promedios, y deja la lectura clínica al profesional tratante.

### Accesibilidad y apariencia
- Cuatro tamaños de texto (hasta 1,5×) y modo de más contraste.
- Tema claro, oscuro o automático según el sistema.
- Objetivos de toque de 48 px, pensados para manos poco firmes.
- Se respeta `prefers-reduced-motion`.

### Otros
- Compañera conectada a DeepSeek mediante un endpoint protegido del Worker; la conversación se conserva en el dispositivo y puede borrarse.
- Aviso cuando no hay copia de seguridad reciente (más de 14 días) e indicación del espacio usado.
- Atajos del icono instalado: agua, presión, lista de compras y nota.
- Sección preparada para una futura vinculación autorizada con Huawei Health y Huawei Watch D3.
- PWA instalable y funcionamiento offline completo, recetario incluido.

La aplicación registra indicaciones; no diagnostica, interpreta resultados ni modifica tratamientos.

## Estructura del código

`dist/` se sirve tal cual, sin compilación, con módulos ES nativos:

| Archivo | Responsabilidad |
| --- | --- |
| `app.js` | Estado, vistas y eventos |
| `catalog.js` | Alimentos de la pauta, pasillos y unidades |
| `recipes.js` | Recetario, escalado de porciones y cruce con la despensa |
| `schedule.js` | Horarios, expansión de tomas y existencias |
| `stats.js` | Cumplimiento, rachas y series de presión |
| `report.js` | Gráfico SVG, informe imprimible y CSV |
| `db.js` | IndexedDB y copia de seguridad |
| `service-worker.js` | Cache offline y avisos en segundo plano |

## Actualizar la versión publicada

`dist/service-worker.js` precarga los archivos listados en `CORE`. Al cambiar cualquiera
de ellos hay que subir `VERSION` en ese archivo: eso crea un cache nuevo, descarta el
anterior y la página se recarga sola cuando el service worker toma el control. Si se
agrega un archivo nuevo a `dist/`, hay que añadirlo también a `CORE`.

## Próxima etapa: familia, recetas e IA

La propuesta técnica y los límites de seguridad están en
[`docs/ARQUITECTURA-FAMILIAR-IA.md`](docs/ARQUITECTURA-FAMILIAR-IA.md). La V1 no incluye
un chatbot remoto ni sincronización familiar: ambas funciones requieren un backend,
autenticación y secretos que nunca deben quedar dentro del JavaScript del navegador.
