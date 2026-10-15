# Integración prevista con Huawei Watch D3

## Flujo de datos

```text
Huawei Watch D3 → Huawei Health → Health Kit → Mi Día → IndexedDB
```

Mi Día solicitará únicamente lectura de presión arterial y pulso. No debe escribir datos en Huawei Health, diagnosticar ni alterar registros del reloj.

## Requisitos antes de implementarla

1. Comprar y configurar el reloj con la cuenta Huawei de la usuaria.
2. Confirmar que las mediciones del D3 aparecen correctamente en Huawei Health.
3. Crear la aplicación en Huawei AppGallery Connect.
4. Publicar política de privacidad y acuerdo de usuario.
5. Solicitar a Huawei Health Kit los permisos restringidos necesarios:
   - `https://www.huawei.com/healthkit/bloodpressure.read`
   - `https://www.huawei.com/healthkit/heartrate.read`
6. Preparar las pantallas para iniciar sesión con Huawei ID, autorizar y revocar el acceso.
7. Esperar la aprobación de Huawei antes de habilitar el botón “Vincular reloj”.

## Arquitectura recomendada

La ruta preferida es empaquetar la interfaz existente como aplicación Android con Capacitor y crear un plugin nativo pequeño para Huawei Health Kit. Esto permite usar el SDK de Huawei y mantener los datos médicos dentro del teléfono, sin introducir un servidor propio solo para guardar lecturas.

Si Huawei exige usar su API REST para esta cuenta o región, será necesario un backend mínimo para custodiar el secreto y renovar tokens. Ningún secreto debe guardarse dentro del JavaScript público de la PWA.

## Importación

Cada lectura importada deberá conservar:

- identificador original de Huawei para evitar duplicados;
- fecha y hora local de la medición;
- presión sistólica y diastólica;
- pulso cuando esté disponible;
- origen `Huawei Watch D3`;
- fecha de sincronización.

Las importaciones serán idempotentes: sincronizar dos veces no debe duplicar mediciones.

## Privacidad

- Pedir permisos de solo lectura y únicamente para los datos usados.
- Mostrar claramente qué información se importará.
- Permitir desvincular la cuenta y revocar permisos.
- No enviar datos a analítica, publicidad o servicios ajenos.
- Mantener el registro manual como alternativa permanente.
