# Arquitectura familiar, recetas e IA

## Objetivo

Evolucionar la PWA local a una herramienta familiar sin convertirla en un sistema de
diagnóstico. La paciente conserva el control de sus datos; los cuidadores acceden sólo
con autorización y cada cambio queda identificado.

## Etapa 1 — PWA local (actual)

- IndexedDB, funcionamiento offline y respaldo JSON.
- Registro explícito de dosis tomada, hora, cantidad y nota.
- Varias tomas diarias por medicamento, con identificador estable por toma.
- Agua y otros líquidos separados.
- Compras con cantidades y unidades.
- Recetas curadas dentro de la aplicación.
- Avisos en tres capas (página abierta, service worker, revisión al reabrir) con
  acciones «tomada / posponer / omitir» y bandeja `outbox` que la página aplica.
- Métricas de cumplimiento, tendencias de presión e informe imprimible para la consulta.
- Recordatorios generales (citas, caminar, medir la presión) sobre el mismo motor de avisos.
- Despensa, compra por pasillos y productos propios fuera de la pauta.
- Recetario que se cruza con la despensa, escala porciones y pasa lo que falta a la compra.
- Notas tipificadas; las preguntas y síntomas viajan al informe de la consulta.
- Tamaño de texto, contraste y tema claro/oscuro ajustables.

### Lo que sigue faltando en esta etapa

- Alarmas garantizadas con la aplicación cerrada (requiere empaquetado Android).
- Sincronización entre cuidadores (requiere backend y autenticación).
- Importación desde Health Connect.

## Etapa 2 — Sincronización familiar

Una alternativa razonable es Cloudflare Workers + D1, siempre detrás de autenticación.
El navegador nunca debe recibir claves de OpenAI, Huawei ni proveedores de recetas.

Entidades mínimas:

- `households`: grupo familiar.
- `members`: paciente, cuidador o administrador.
- `daily_records`: resumen diario por paciente y zona horaria.
- `medication_intakes`: dosis programada, dosis registrada, unidad, hora y autor.
- `hydration_entries`: agua u otro líquido, mililitros equivalentes y hora.
- `blood_pressure_readings`: cifras, pulso, hora, origen y procedencia manual/importada.
- `shopping_items`: producto, cantidad, unidad, estado y autor.
- `audit_events`: quién creó, modificó o eliminó un dato sensible.

La app debe seguir escribiendo primero en local y sincronizar mediante una cola con
identificadores únicos. Los conflictos no se resuelven sobrescribiendo a ciegas: una
toma de medicamento o lectura de presión conserva su historial y autor.

## Recetas externas

El recetario local es la base y funciona sin conexión. Una API externa solo tendría
sentido para ampliarlo, y bajo las condiciones de abajo.


El proveedor se consulta exclusivamente desde el backend. Las respuestas se filtran
contra la pauta editable y se presentan como “ideas de receta”, nunca como una
recomendación médica.

- **Recipe API**: candidato para producción por sus ingredientes estructurados,
  cantidades y filtros. Requiere evaluar licencia, precio y disponibilidad regional.
- **TheMealDB**: útil para prototipos, pero su búsqueda gratuita es limitada y una
  receta devuelta no implica compatibilidad con la pauta.

El recetario local continúa disponible offline si la API falla.

## Acompañante con IA

El chat se implementa en el backend usando la Responses API de OpenAI. Su alcance es:

- explicar cómo usar la app;
- resumir registros que la propia usuaria elija compartir;
- proponer ideas organizativas con ingredientes permitidos;
- ayudar a preparar preguntas para el médico.

No puede diagnosticar, interpretar ECG o presión, alterar dosis, confirmar interacciones
ni decidir si una persona debe tomar o suspender un medicamento. Ante síntomas o dudas
clínicas deriva a un profesional o servicio de urgencia según corresponda.

Controles necesarios:

- clave API guardada como secreto del servidor;
- consentimiento explícito antes de enviar datos de salud;
- mínima información necesaria y opción de no conservar conversaciones (`store: false`);
- moderación de entradas y salidas;
- respuestas ancladas en la pauta vigente y claramente rotuladas;
- herramientas de escritura desactivadas por defecto: el chat no marca una toma ni
  cambia una receta médica sin confirmación visible;
- registro de auditoría y botón para borrar conversaciones.

## Alarmas confiables

Las notificaciones web no equivalen a una alarma nativa garantizada. Para recordatorios
que deban sonar con la PWA cerrada conviene empaquetar la interfaz con Capacitor o crear
una app Android pequeña que programe alarmas locales. Las alarmas son apoyo: no deben
registrar automáticamente que una dosis fue tomada.

## Relojes y Health Connect

La integración requiere registrar la aplicación, obtener aprobación para los permisos
de salud y consentimiento explícito. Los registros importados deben conservar
origen, hora y deduplicación. Mientras eso no exista, se mantiene el ingreso manual sin
simular una sincronización.
