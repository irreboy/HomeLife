# Relojes, pulseras y Health Connect

## Qué mide realmente un reloj

Antes de planificar una integración conviene separar lo que los relojes miden
de lo que se les atribuye:

| Dato | Relojes comunes | Observación |
| --- | --- | --- |
| Frecuencia cardíaca | Sí | Sensor óptico, fiable en reposo |
| SpO2 | Sí | Orientativo, no grado clínico |
| Sueño y pasos | Sí | Útiles como contexto |
| **Presión arterial** | **No** | Requiere brazalete inflable |
| ECG | Solo algunos | Modelos específicos certificados |

La mayoría de los relojes de consumo —incluidas las gamas de Xiaomi, Redmi y
Amazfit— **no miden presión arterial**. Los pocos que sí lo hacen llevan un
brazalete inflable real en la correa, como la serie Huawei Watch D.

Esto importa porque la presión arterial es justamente el dato central de la
sección Salud. Mientras no haya un reloj con brazalete, **se ingresa a mano
desde el tensiómetro**, y la aplicación está diseñada para eso.

## El camino: Health Connect

Health Connect es el almacén de salud de Android. Las aplicaciones de los
fabricantes escriben ahí, y las aplicaciones de terceros leen con autorización.

```text
Reloj  →  App del fabricante  →  Health Connect  →  Mi Día
          (Mi Fitness, Zepp,      (permisos por       (lectura)
           Huawei Health)          tipo de dato)
```

Lo que se puede leer por esta vía: **pulso, pasos, sueño y calorías**. Es el
contexto que acompaña a los registros propios, no un reemplazo de ellos.

Mi Día también puede **escribir** la presión arterial hacia Health Connect,
para que quede centralizada junto al resto.

### Requisitos

1. La aplicación **Android**: Health Connect no existe para la versión web.
2. El plugin de Capacitor correspondiente, con los permisos declarados en el
   manifiesto:
   - `android.permission.health.READ_HEART_RATE`
   - `android.permission.health.READ_STEPS`
   - `android.permission.health.READ_SLEEP`
   - `android.permission.health.WRITE_BLOOD_PRESSURE`
3. En el teléfono: activar el envío a Health Connect desde la aplicación del
   fabricante (en Mi Fitness, Ajustes → Health Connect).
4. Conceder los permisos en Mi Día, que se piden de a uno y se pueden revocar.

### Límites que se respetan

- Solo lectura de lo necesario, nada más.
- Mostrar con claridad qué se importará antes de pedir nada.
- Permitir desvincular y revocar en cualquier momento.
- Conservar el origen de cada dato y evitar duplicados al sincronizar.
- Mantener el registro manual como alternativa permanente.
- No enviar nada a analítica, publicidad ni servicios ajenos.
- No interpretar los valores: la aplicación registra y promedia, nunca
  clasifica ni diagnostica.

## Si algún día hay un reloj con brazalete

La serie Huawei Watch D mide presión de verdad. Su integración, sin embargo,
no pasa por Health Connect sino por Huawei Health Kit, que exige registrar la
aplicación en AppGallery Connect, publicar política de privacidad y esperar
aprobación de permisos restringidos:

- `https://www.huawei.com/healthkit/bloodpressure.read`
- `https://www.huawei.com/healthkit/heartrate.read`

Es un camino bastante más largo que Health Connect y solo vale la pena si el
reloj con brazalete llega a comprarse.
