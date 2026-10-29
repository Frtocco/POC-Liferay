# Fragment "Registro": wizard de alta de usuarios

Web fragment de Liferay con un wizard de registro de cuatro pasos para la app de streaming. Cada paso valida sus campos y los agrega a un objeto `user`, que se envía tal cual al módulo OSGi de registro (`POST /o/sign-in/v1.0`).

## Contenido

- [Fragment "Registro": wizard de alta de usuarios](#fragment-registro-wizard-de-alta-de-usuarios)
  - [Contenido](#contenido)
  - [Visión general](#visión-general)
  - [Archivos e instalación](#archivos-e-instalación)
  - [Los pasos](#los-pasos)
  - [Configuración](#configuración)
  - [Contenido editable](#contenido-editable)
  - [Cómo está organizado el JavaScript](#cómo-está-organizado-el-javascript)
    - [Qué pasa al tocar "Siguiente"](#qué-pasa-al-tocar-siguiente)
    - [Reglas de validación](#reglas-de-validación)
    - [Checkbox de términos](#checkbox-de-términos)
  - [Respuestas del servidor](#respuestas-del-servidor)
    - [Éxito (`201`)](#éxito-201)
    - [Errores](#errores)
  - [Modos de la página](#modos-de-la-página)
  - [Estilos](#estilos)
  - [Cambios frecuentes](#cambios-frecuentes)
  - [Pruebas](#pruebas)
  - [Problemas conocidos y decisiones](#problemas-conocidos-y-decisiones)

---

## Visión general

```
Paso 1: Email ─▶ Paso 2: Nombre ─▶ Paso 3: Contraseña ─▶ Paso 4: Revisión ─▶ POST ─▶ Pantalla final
   │                  │                   │                      │
   └── emailAddress   └── givenName       └── password           └── acceptTerms
                          familyName
```

El objeto que se arma es exactamente el contrato del backend:

```json
{
  "acceptTerms": true,
  "captchaToken": "test-token",
  "emailAddress": "martina.gonzalez@example.com",
  "familyName": "González",
  "givenName": "Martina",
  "languageId": "es_AR",
  "password": "Str3aming!2026"
}
```

`languageId` sale de `Liferay.ThemeDisplay` y `captchaToken` de la configuración del fragment.

> Las validaciones del navegador son solo de UX. La fuente de verdad es el backend (email duplicado, política de contraseñas, etc.).

## Archivos e instalación

```
streaming/
├── collection.json          Colección "Streaming"
└── registro/
    ├── fragment.json        Metadatos (key: nf-registro)
    ├── index.html           Markup (FreeMarker)
    ├── index.css            Estilos (prefijo nf-signup)
    ├── index.js             Lógica del wizard
    └── configuration.json   Configuración del fragment
```

**Instalar:** Site Builder → Fragments → Importar → `streaming-registro.zip`.

**Actualizar:** volver a importar el ZIP (o pegar los archivos cambiados en el editor del fragment), **publicar** y después **propagar** el cambio a las páginas que ya usan el fragment.

**Ubicación:** en una página propia (por ejemplo `/registro`). El fragment ocupa toda la altura de la pantalla y centra la card.

## Los pasos

| # | `data-step` | Campos | Validación en el navegador | Lo que agrega a `user` |
|---|---|---|---|---|
| 1 | `email` | Email | Obligatorio, formato válido | `emailAddress` (trimeado, en minúsculas) |
| 2 | `name` | Nombre, apellido | Los dos obligatorios | `givenName`, `familyName` (trimeados) |
| 3 | `password` | Contraseña, confirmación | Obligatoria, largo mínimo, las dos iguales | `password` (nunca se trimea; la confirmación no se envía) |
| 4 | `review` | Resumen + checkbox de términos | Términos aceptados | `acceptTerms` |

Navegación:

- **Siguiente** valida el paso actual. Si pasa, guarda los valores y avanza; en el último paso envía la petición (el botón dice "Crear cuenta").
- **Enter** en cualquier input funciona como Siguiente.
- **Atrás** vuelve sin validar.
- **Editar** (en el resumen de revisión) salta directo a ese paso.
- **Mostrar / Ocultar** cambia la visibilidad de la contraseña.
- Al escribir en un campo se limpia su error.

## Configuración

Se define en el panel de configuración del fragment (`configuration.json`).

| Grupo | Campo | Por defecto | Uso |
|---|---|---|---|
| Registro | `registrationEndpoint` | `/o/sign-in/v1.0` | URL del backend (endpoint OSGi o un microservicio a futuro) |
| Registro | `minPasswordLength` | `8` | Solo para el navegador; mantenerlo igual a la política de contraseñas de Liferay |
| Links | `loginURL` | `/c/portal/login` | Links de "Iniciá sesión" |
| Links | `termsURL` | *(vacío)* | Página de términos. Vacío = el texto se muestra sin link |
| Links | `successURL` | *(vacío)* | Botón final cuando la cuenta queda activa, y "Ir al inicio" para usuarios logueados |
| Desarrollo | `captchaTestToken` | *(vacío)* | Se envía como `captchaToken` hasta que exista el CAPTCHA real |
| Desarrollo | `showDebug` | apagado | Muestra el JSON que se va armando (contraseña enmascarada). **Apagar en producción** |

## Contenido editable

| Elemento | Tipo | ID del editable |
|---|---|---|
| Imagen de fondo | Fondo | `fondo` |
| Título / subtítulo del paso 1 | Texto | `paso-email-titulo` / `paso-email-texto` |
| Título / subtítulo del paso 2 | Texto | `paso-nombre-titulo` / `paso-nombre-texto` |
| Título / subtítulo del paso 3 | Texto | `paso-password-titulo` / `paso-password-texto` |
| Título / subtítulo del paso 4 | Texto | `paso-revision-titulo` / `paso-revision-texto` |

Los textos de los botones, los mensajes de error y las pantallas finales están en `index.js` (ver [Cambios frecuentes](#cambios-frecuentes)).

## Cómo está organizado el JavaScript

`index.js` está dividido en diez secciones numeradas. Cada una tiene una sola responsabilidad, y los datos fluyen en un solo sentido:

```
evento (9) ─▶ controlador (8) ─▶ estado (3) ─▶ vista (6)
                    │
                    ├─▶ pasos (5)   validan y devuelven valores
                    └─▶ api (7)     POST al backend
```

| # | Sección | Contiene |
|---|---|---|
| 1 | Constantes | `STEPS`, `FIELD_STEP` (campo → paso), `MESSAGES` (textos de error), `EMAIL_REGEX` |
| 2 | Contexto | `settings` (configuración normalizada), `isEditMode`, `isEditorContext` |
| 3 | Estado | `state.user` (el body de la petición), `state.current` (índice del paso), `state.submitting` |
| 4 | Elementos | `dom` con todas las referencias; helpers `field(name)`, `valueOf(name)`, `errorFor(name)` |
| 5 | Pasos | `stepReaders`: una función por paso que devuelve `{values, errors}` y **no modifica nada** |
| 6 | Vista | `view.*`: todas las funciones que pintan (paso, resumen, debug, errores, alerta, carga, resultado) |
| 7 | API | `api.register(user)`: el único `fetch`; agrega `x-csrf-token` |
| 8 | Controlador | `goTo`, `next`, `back`, `toggleTerms`, `submit`, `onSuccess`, `onError` |
| 9 | Eventos | `bindEvents()`: todos los listeners |
| 10 | Inicio | Decide entre modo edición, aviso de usuario logueado o el wizard normal |

### Qué pasa al tocar "Siguiente"

```js
function next() {
  view.hideAlert();
  view.clearStepErrors();

  const {errors, values} = stepReaders[STEPS[state.current]]();

  if (Object.keys(errors).length) {
    view.showErrors(errors);          // se queda en el paso
    return;
  }

  Object.assign(state.user, values);  // recién acá cambia el objeto

  if (isLastStep()) submit();
  else goTo(state.current + 1);
}
```

### Reglas de validación

Cada regla ocupa una línea. Un valor falso significa "sin error":

```js
name() {
  const givenName = valueOf('givenName').trim();
  const familyName = valueOf('familyName').trim();

  return stepResult({familyName, givenName}, {
    familyName: !familyName && 'REQUIRED',
    givenName: !givenName && 'REQUIRED'
  });
}
```

Los códigos de error son los mismos que los del backend, así que los errores del navegador y los del servidor usan los mismos textos de `MESSAGES`.

### Checkbox de términos

Es un `<button role="checkbox">`, no un `<input type="checkbox">` nativo. Un click en el cuadro o en el texto alterna `state.user.acceptTerms` en el momento (el link en sí no lo alterna). Funciona con el teclado (Espacio / Enter) y los lectores de pantalla lo anuncian como checkbox. El motivo está en [Problemas conocidos](#problemas-conocidos-y-decisiones).

## Respuestas del servidor

### Éxito (`201`)

La pantalla final depende de `nextStep`:

| `nextStep` | Pantalla |
|---|---|
| `VERIFY_EMAIL` | "Revisá tu email": indica a qué dirección se envió el mail |
| `LOGIN` | "¡Listo, {nombre}!" con un botón "Iniciar sesión" (`successURL` o `loginURL`) |
| `WAIT_APPROVAL` | "Cuenta creada": pendiente de aprobación |

Después del éxito, la contraseña se borra de memoria y los inputs se vacían.

### Errores

| Respuesta | Qué hace el fragment |
|---|---|
| `400` con `errors[]` | Vuelve al **primer paso** que tenga un error (usando `FIELD_STEP`) y marca todos los campos |
| `409 EMAIL_ALREADY_REGISTERED` | Vuelve al paso 1, marca el email y muestra una alerta con un link "Iniciá sesión" |
| `403`, `429`, `500` | Alerta naranja con el mensaje de ese código |
| Falla de red | Alerta "No pudimos conectarnos…"; el usuario puede reintentar |

Mientras se envía, el botón muestra un spinner con "Creando cuenta…" y los dos botones quedan deshabilitados.

## Modos de la página

| Contexto | Cómo se detecta | Comportamiento |
|---|---|---|
| Editor de páginas | `layoutMode === 'edit'` | Se muestran los cuatro pasos apilados para editar sus textos; sin interacción |
| Preview del editor de fragments | Corre dentro de un iframe (`window.self !== window.top`) | Wizard normal, aunque haya un admin logueado |
| Modo preview | `layoutMode` distinto de `view` | Wizard normal |
| Página publicada, guest | — | Wizard normal |
| Página publicada, usuario logueado | `Liferay.ThemeDisplay.isSignedIn()` | Mensaje "Ya iniciaste sesión" con un botón "Ir al inicio". **Sin redirección automática** (rompía los editores) |

## Estilos

`index.css` usa la misma paleta que los demás fragments de streaming (login, título destacado, fila de títulos):

| Variable | Valor | Uso |
|---|---|---|
| `--nf-bg` | `#000` | Fondo del fragment |
| `--nf-text` / `--nf-text-secondary` / `--nf-text-muted` | `#fff` / `#b3b3b3` / `#737373` | Niveles de texto |
| `--nf-accent` / `--nf-accent-hover` | `#e50914` / `#c11119` | Botón principal, barra de progreso, checkbox tildado |
| `--nf-error` | `#e87c03` | Errores de campo y alerta |
| `--nf-input-bg` / `--nf-input-border` | grises translúcidos | Inputs |

Notas:

- **Prefijo `nf-signup`** en todas las clases (BEM), para no chocar con Clay ni con el tema.
- **Selectores con doble clase** (`.nf-signup .nf-signup__title`) para pisar los estilos de Clay en links, botones, títulos y anillos de foco.
- La **card está centrada** en los dos ejes con `margin: auto` dentro de un contenedor flex de altura completa. Los pasos altos hacen scroll sin recortarse.
- **Labels flotantes:** el label sube cuando el input tiene foco o un valor (`:placeholder-shown`).
- **Mobile (≤ 740px):** sin sombra ni caja, a ancho completo, como en Netflix.
- Las animaciones solo corren con `prefers-reduced-motion: no-preference`.
- Poné `#000` como fondo de la página en el Master Page, para que el área alrededor del fragment coincida.

## Cambios frecuentes

| Quiero… | Cambio |
|---|---|
| Cambiar el título o subtítulo de un paso | Editarlo en la página (texto editable) |
| Cambiar un mensaje de error | `MESSAGES` en `index.js` (sección 1) |
| Cambiar las pantallas finales | `screens` dentro de `onSuccess` (sección 8) |
| Agregar una regla de validación | La función del paso en `stepReaders` (sección 5), más su mensaje en `MESSAGES` |
| Agregar un paso | Su `<section data-step="...">` en `index.html`, su nombre en `STEPS`, su función en `stepReaders` y sus campos en `FIELD_STEP` |
| Agregar un campo a la petición | Su input en el HTML, leerlo en el `stepReaders` de su paso, agregarlo a `state.user` y al `UserDTO` del backend |
| Apuntar a otro backend | `registrationEndpoint` en la configuración |
| Conectar el CAPTCHA real | Renderizar el widget en el paso 4 y devolver su token desde `getCaptchaToken()` (sección 7) |

## Pruebas

1. Activar **Mostrar el JSON que se va armando** y poner `test-token` en el campo del token de CAPTCHA.
2. Abrir la página publicada **sin sesión iniciada** (lo más fácil es una ventana de incógnito).
3. Recorrer los pasos y verificar que el JSON se completa a medida que se termina cada uno.
4. Casos para revisar:
   - campos vacíos y un email inválido en cada paso,
   - una contraseña corta y una confirmación que no coincide,
   - "Crear cuenta" sin aceptar los términos,
   - registrar el mismo email dos veces → vuelve al paso 1 con la alerta,
   - una contraseña que la política rechaza → vuelve al paso 3,
   - los botones **Editar** y **Atrás**,
   - abrir la página con sesión iniciada → "Ya iniciaste sesión".
5. **Apagar** el panel de debug antes de salir a producción.

## Problemas conocidos y decisiones

| Tema | Qué pasaba | Decisión |
|---|---|---|
| Redirección en el editor | Redirigir a los usuarios logueados también redirigía el preview del editor de fragments (ahí siempre hay un admin logueado) | Se reemplazó por un mensaje; los contextos de edición se ignoran |
| "Siguiente" no hacía nada | El wizard dependía del submit de un `<form>`, que SPA (Senna) o un form contenedor pueden interceptar | Sin `<form>`: un `<div role="form">`, un botón `type="button"` y Enter manejado a mano |
| El checkbox de términos no respondía | Los estilos del tema o de Clay afectan a los checkbox y labels nativos | Se reemplazó por un `<button role="checkbox">`. **Pendiente:** encontrar la regla del tema que lo causaba |
| Link de términos sin URL | Apuntaba a `#` y abría la misma página en otra pestaña | Sin `termsURL` se muestra como texto plano |
| CAPTCHA | El backend todavía no lo verifica | `captchaTestToken` para desarrollo; el widget real es **obligatorio** antes de salir al público |