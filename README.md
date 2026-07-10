# Aplicación web para informes técnicos

Prototipo funcional de aplicación web para técnicos de campo.

## Funciones incluidas

- Formulario inicial: Cliente, Emplazamiento, Instalación y Número de informe.
- Alta de elementos revisados uno por uno.
- Campo Elemento con sugerencias/autocompletado configurable.
- Campo Elemento por dictado de voz.
- Campo Elemento mediante escritura con lápiz, dedo o ratón en tablet.
- Lectura de escritura manuscrita a texto cuando el navegador/sistema lo permite.
- Ayuda de la lista de elementos: aunque la lectura manuscrita devuelva un texto imperfecto, la aplicación propone las opciones más similares de la lista.
- Campo de corrección visible: el técnico puede elegir una sugerencia o corregir el texto antes de guardarlo.
- Valor numérico.
- Continuidad Sí / No.
- Observaciones con texto libre o dictado de voz.
- Tabla editable de elementos revisados.
- Guardado automático del borrador en el navegador.
- Generación del informe técnico rellenando la plantilla corporativa VOLTIA (`template-voltia.js`).
- Sustitución automática de Cliente, Emplazamiento, Instalación, Nº de informe y fecha.
- Volcado automático de la tabla de elementos revisados en las páginas de la plantilla.
- Descarga en HTML.
- Descarga en Word `.docx` visual, conservando la plantilla corporativa A4 mediante páginas renderizadas como imagen.
- Descarga de PDF fiel a la plantilla mediante páginas renderizadas en alta resolución.
- Diseño responsive para móvil, tablet y ordenador.

## Cómo usarla

1. Abre `index.html` en el navegador.
2. Rellena los datos generales del informe.
3. En Elemento revisado, puedes escribir, dictar o pulsar ✍️.
4. Si usas ✍️, escribe con el lápiz/dedo/ratón y pulsa `Leer escritura` si no se reconoce automáticamente.
5. Elige una opción detectada o corrige el texto en `Texto que se guardará como Elemento`.
6. Pulsa `Usar este texto`.
7. Completa valor, continuidad y observaciones.
8. Pulsa `Añadir elemento`.
9. Pulsa `Generar informe`.
10. La vista previa mostrará la plantilla VOLTIA ya rellenada.
11. Descarga el informe en HTML, Word `.docx` con plantilla o PDF.

## Exportación a Word y PDF

La exportación anterior a Word usaba una reconstrucción nativa del documento. Ese método abría bien en Word, pero podía perder la composición exacta de la plantilla: fondos, posiciones, alturas de tabla, portada y paginación.

La versión actual prioriza la fidelidad visual:

- `Descargar Word con plantilla (.docx)` renderiza cada página A4 de la plantilla y la inserta como imagen de alta resolución dentro de un Word real. Así se conserva el diseño al abrirlo en Word.
- Si por restricciones del navegador no se pudiera renderizar la plantilla, la app intenta como reserva una versión `.docx` editable simplificada.
- `Descargar PDF` usa el mismo renderizado fiel por páginas para mantener portada, colores, cabecera, pie, tablas y paginación.
- `Descargar HTML` conserva la plantilla original completa y sirve como copia visual en navegador.

Nota: el Word fiel mantiene el aspecto de la plantilla, pero las páginas quedan como imagen. Es la forma más estable de evitar que Word reinterprete el HTML/CSS y desplace la maquetación.

## Plantilla VOLTIA

La plantilla enviada se ha incrustado en `template-voltia.js` para que la aplicación funcione sin servidor y pueda abrirse directamente desde `index.html`.

Al generar el informe, la aplicación:

- Rellena los campos de portada: cliente, emplazamiento, instalación, número de informe y fecha.
- Sustituye las filas vacías de “ELEMENTOS REVISADOS” por los elementos añadidos por el técnico.
- Crea más páginas de tabla automáticamente si hay más elementos de los que caben en una página.
- Actualiza el índice y los números de página de conclusiones/anexo.
- Ajusta el texto de conclusiones si hay elementos sin continuidad u observaciones.

Para cambiar la plantilla en el futuro, sustituye el contenido de `template-voltia.js` por la nueva plantilla HTML siguiendo el mismo formato:

```js
window.VOLTIA_REPORT_TEMPLATE = `...HTML de la plantilla...`;
```

## Compatibilidad del dictado por voz

El dictado utiliza `SpeechRecognition` y solicita/verifica primero el permiso de micrófono con `navigator.mediaDevices.getUserMedia` cuando el navegador lo permite. Funciona especialmente bien en Chrome y Edge.

Requisitos prácticos:

- Servir la aplicación desde `https://` o desde `http://localhost` durante pruebas.
- Permitir el micrófono en el candado/ajustes del sitio del navegador.
- No tener el micrófono ocupado por otra aplicación.

Si el permiso está bloqueado, la interfaz desactiva el botón de dictado o muestra un aviso específico para corregirlo.

## Lectura de escritura manuscrita

La aplicación usa un enfoque progresivo:

1. Primero intenta usar el reconocimiento manuscrito nativo del navegador mediante `navigator.createHandwritingRecognizer`. Este método trabaja con los trazos reales del lápiz/dedo/ratón, no solo con una imagen final, y por eso suele ser más preciso cuando está disponible.
2. Si el navegador devuelve texto, la aplicación lo cruza con la lista `SUGERENCIAS_ELEMENTOS` y muestra las coincidencias más probables.
3. Si no hay lector manuscrito nativo, al pulsar `Leer escritura` la app intenta OCR en navegador con Tesseract.js cargado desde CDN. Este respaldo funciona mejor con letra grande, separada y tipo imprenta; no es tan fiable con cursiva o letra muy irregular.
4. Si hay un OCR/IA propio, se puede configurar `window.INFORMES_CONFIG.handwritingOcrEndpoint` antes de cargar `app.js`. Ese endpoint tiene prioridad sobre Tesseract.js.
5. Si ningún lector devuelve un resultado fiable, el técnico puede corregir manualmente el campo `Texto que se guardará como Elemento`; la imagen del trazo queda guardada como evidencia visual.

Configuración incluida por defecto en `index.html`:

```html
<script>
  window.INFORMES_CONFIG = {
    enableTesseractFallback: true,
    tesseractCdn: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
    handwritingOcrEndpoint: ''
  };
</script>
```

Notas prácticas:

- Para la mejor transcripción, escribe grande, horizontal y con letras separadas.
- El OCR en navegador requiere conexión la primera vez para descargar Tesseract.js y sus datos de idioma.
- Para lectura manuscrita robusta en todos los dispositivos, lo recomendable en producción es conectar un OCR/IA especializado mediante `handwritingOcrEndpoint`.

Ejemplo de configuración de endpoint OCR externo:

```html
<script>
  window.INFORMES_CONFIG = {
    handwritingOcrEndpoint: 'https://tu-servidor.com/api/leer-escritura'
  };
</script>
<script src="template-voltia.js"></script>
<script src="app.js"></script>
```

El endpoint debe aceptar JSON con esta forma:

```json
{
  "imageDataUrl": "data:image/png;base64,...",
  "language": "es",
  "suggestions": ["Cuadro general de baja tensión", "Interruptor diferencial"]
}
```

Y devolver una respuesta similar a:

```json
{
  "text": "cuadro general baja tension",
  "candidates": [
    { "text": "Cuadro general de baja tensión", "score": 0.94 },
    { "text": "Cuadro secundario", "score": 0.51 }
  ]
}
```

## Personalización de la lista de elementos sugeridos

Edita el archivo `app.js` y modifica el array `SUGERENCIAS_ELEMENTOS`:

```js
const SUGERENCIAS_ELEMENTOS = [
  'Cuadro general de baja tensión',
  'Interruptor diferencial',
  'Toma de tierra'
];
```

## Producción

Este prototipo es estático y guarda el borrador en el navegador. Para entorno real de empresa se recomienda añadir:

- Control de usuarios.
- Base de datos centralizada.
- Numeración automática de informes.
- Plantillas corporativas en PDF/DOCX.
- Firma digital del técnico y del cliente.
- Copias de seguridad.
- OCR/IA externo si se necesita lectura manuscrita robusta en todos los navegadores.

## Actualización de plantilla VOLTIA

La plantilla integrada se ha ajustado para reproducir el diseño indicado:

- Portada con franja superior verde oscuro, logotipo centrado, bloque inferior verde claro y datos con líneas horizontales.
- Cabecera en páginas interiores con logotipo VOLTIA a la izquierda, tabla de Cliente / Emplazamiento / Instalación a la derecha, número de informe y fecha corta.
- Pie de página en páginas interiores con `Rev.00`, numeración `Página X de Y` y `voltia.es`.
- Pie de portada oscuro con `voltia.es`.

Estos cambios se aplican a la vista previa HTML, a la descarga PDF y a la descarga Word fiel, que mantiene la plantilla insertando cada página como imagen de alta resolución.

## Corrección de exportación fiel

Esta versión no depende de la conversión HTML de Word ni de la opción de “gráficos de fondo” del navegador para conservar la plantilla.

- **PDF fiel**: cada página A4 de la plantilla se renderiza como imagen de alta resolución y se inserta en un PDF generado por la propia aplicación.
- **Word fiel**: cada página A4 se inserta como imagen de alta resolución dentro de un `.docx` con tamaño A4 y márgenes a cero.

Con este enfoque se conserva la portada, la cabecera, el pie, colores, posiciones y tablas. El Word resultante mantiene el aspecto de la plantilla; el contenido queda como imagen para evitar que Word modifique el diseño al abrir el archivo.

## Cambios aplicados en esta revisión

- Se rediseñó la pantalla principal con una cabecera corporativa, bloque hero oscuro, acentos verde oliva y navegación por pasos, manteniendo el flujo sencillo para técnicos de campo.
- Se ajustaron textos y jerarquía visual para que la app parezca una herramienta profesional de VOLTIA y no una maqueta genérica.
- Se cambió la descarga de Word para generar primero un `.docx` visual fiel a la plantilla, evitando que Word recomponga el diseño y pierda formato.
- Se mantiene una reserva automática: si el renderizado visual fallara por restricciones del navegador, la aplicación intentará generar una versión `.docx` editable simplificada.
- Se reforzó la generación XML de Word eliminando caracteres de control no válidos y asignando identificadores únicos a las imágenes embebidas.


## Cambios aplicados para permisos de audio y pintura

- Se añadió comprobación previa del contexto seguro (`HTTPS`/`localhost`) antes de iniciar el dictado.
- Se añadió petición explícita de permiso de micrófono con `getUserMedia` y liberación inmediata del stream tras validar el permiso.
- Se añadieron mensajes diferenciados para permiso denegado, micrófono inexistente, micrófono ocupado, contexto inseguro, fallo de red y ausencia de voz.
- Se evita lanzar dos dictados simultáneos y se restaura el estado visual de los botones al finalizar.
- Se añadió una política declarativa `Permissions-Policy` para `microphone=(self)`; en producción conviene enviarla también como cabecera HTTP.
- Se corrigió el error de recursión que impedía abrir/cerrar correctamente el cuadro de escritura con lápiz.
- Se reforzó la pintura/escritura con captura de puntero, soporte correcto para lápiz (`pen` → `stylus`), ratón y dedo, y se guarda una miniatura del trazo manuscrito junto al elemento.
- Se añadió transcripción progresiva: lector manuscrito nativo cuando el navegador lo soporta, OCR externo configurable y OCR en navegador con Tesseract.js como respaldo.
- Cuando ningún lector automático devuelve un resultado fiable, la opción de pintura sigue siendo utilizable como entrada asistida: se pinta el trazo, se elige o escribe el texto y se guarda la evidencia visual.
# VOLTIA
