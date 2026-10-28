# Módulo de registro (OSGi): endpoint de alta de usuarios

Backend del wizard de registro de la app de streaming. Expone un endpoint REST público que crea un usuario nuevo de Liferay a partir del JSON que envía el fragment **Registro**.

## Contenido

- [Módulo de registro (OSGi): endpoint de alta de usuarios](#módulo-de-registro-osgi-endpoint-de-alta-de-usuarios)
  - [Contenido](#contenido)
  - [Visión general](#visión-general)
  - [Archivos](#archivos)
  - [Endpoint y contrato](#endpoint-y-contrato)
    - [Petición](#petición)
    - [Éxito: `201 Created`](#éxito-201-created)
    - [Errores](#errores)
  - [Flujo de la petición](#flujo-de-la-petición)
    - [Por qué se valida antes de deserializar](#por-qué-se-valida-antes-de-deserializar)
  - [Clases](#clases)
    - [`CustomSignInApplication`](#customsigninapplication)
      - [Propiedades del componente](#propiedades-del-componente)
      - [`ServiceContext`](#servicecontext)
      - [`addUserWithWorkflow`](#adduserwithworkflow)
    - [`SignInException`](#signinexception)
    - [`UserDTO`](#userdto)
  - [Configuración de Liferay](#configuración-de-liferay)
  - [Pruebas](#pruebas)
    - [Postman / Bruno](#postman--bruno)
    - [OpenAPI](#openapi)
  - [Seguridad y checklist para producción](#seguridad-y-checklist-para-producción)
  - [Decisiones tomadas](#decisiones-tomadas)
  - [Solución de problemas](#solución-de-problemas)

---

## Visión general

```
Fragment "Registro"  ──POST JSON──▶  /o/sign-in/v1.0  ──▶  UserLocalService.addUserWithWorkflow
  (navegador, guest)                 (JAX-RS, OSGi)          (servicio local, sin chequeo de permisos)
```

- El visitante es **anónimo**, así que el endpoint tiene que ser accesible para Guest.
- A Guest **no** se le da ningún permiso nuevo. El endpoint usa **servicios locales**, que no chequean permisos, y acepta solo los campos del contrato.
- Los usuarios nuevos **no reciben un rol explícito**. Todo usuario regular tiene automáticamente el rol implícito **User**, que es todo lo que necesita un espectador. Los roles del staff (administración, contenido) se asignan aparte.

## Archivos

| Archivo | Paquete | Responsabilidad |
|---|---|---|
| `CustomSignInApplication.java` | `com.nttv.rest.application` | Aplicación JAX-RS: recibe la petición, ejecuta el flujo y arma las respuestas |
| `SignInException.java` | `com.nttv.rest.exception` | Error ya expresado en el contrato de la API (status HTTP, código, título y errores por campo) |
| `UserDTO.java` | `com.nttv.dtos` | Body de la petición, deserializado con el `JSONFactory` de Liferay |
| `src/main/resources/META-INF/openapi.yaml` | — | Definición OpenAPI del contrato |

## Endpoint y contrato

```
POST /o/sign-in/v1.0
Content-Type: application/json
x-csrf-token: <Liferay.authToken>
```

### Petición

```json
{
  "givenName": "Martina",
  "familyName": "González",
  "emailAddress": "martina.gonzalez@example.com",
  "password": "Str3aming!2026",
  "languageId": "es_AR",
  "acceptTerms": true,
  "captchaToken": "test-token"
}
```

| Campo | Obligatorio | Reglas |
|---|---|---|
| `givenName` | ✓ | No vacío (se trimea) |
| `familyName` | ✓ | No vacío (se trimea) |
| `emailAddress` | ✓ | Email válido; se trimea y se pasa a minúsculas; tiene que ser único |
| `password` | ✓ | No vacío; **nunca se trimea**; la política de contraseñas de Liferay es el control final |
| `languageId` | ✗ | Locale de Liferay (`es_AR`); si está vacío o es inválido, se usa el idioma por defecto del sitio |
| `acceptTerms` | ✓ | Tiene que ser `true` |
| `captchaToken` | ✗ | Se recibe pero **todavía no se verifica** (ver checklist) |

### Éxito: `201 Created`

```json
{
  "userId": 45678,
  "emailAddress": "martina.gonzalez@example.com",
  "status": "PENDING_VERIFICATION",
  "nextStep": "VERIFY_EMAIL"
}
```

| `status` | `nextStep` | Cuándo |
|---|---|---|
| `ACTIVE` | `LOGIN` | El usuario puede iniciar sesión de inmediato |
| `PENDING_VERIFICATION` | `VERIFY_EMAIL` | Está activado "Require strangers to verify their email address" |
| `PENDING_APPROVAL` | `WAIT_APPROVAL` | Un workflow sobre User dejó la cuenta pendiente |

El fragment usa `nextStep` para decidir qué pantalla final mostrar.

### Errores

Todos los errores tienen el mismo formato:

```json
{
  "status": 400,
  "code": "VALIDATION_ERROR",
  "title": "Some fields are invalid",
  "errors": [
    { "field": "password", "code": "REQUIRED", "message": "Password is required" }
  ]
}
```

| HTTP | `code` | Causa |
|---|---|---|
| 400 | `MALFORMED_JSON` | Body vacío o JSON inválido |
| 400 | `VALIDATION_ERROR` | Uno o más campos inválidos; el detalle está en `errors[]` |
| 403 | `REGISTRATION_DISABLED` | "Allow strangers to create accounts" está desactivado |
| 409 | `EMAIL_ALREADY_REGISTERED` | El email ya tiene una cuenta |
| 500 | `INTERNAL_ERROR` | Error inesperado (queda registrado en el log del servidor) |

Códigos por campo en `errors[].code`:

| Código | Campo | Origen |
|---|---|---|
| `REQUIRED` | cualquiera | Nuestra validación |
| `INVALID_EMAIL` | `emailAddress` | Nuestra validación o `UserEmailAddressException` |
| `PASSWORD_TOO_SHORT` | `password` | `UserPasswordException.MustBeLonger` |
| `PASSWORD_INVALID` | `password` | Cualquier otra `UserPasswordException` (política) |
| `INVALID_NAME` | `givenName` | `ContactNameException` |
| `TERMS_NOT_ACCEPTED` | `acceptTerms` | Nuestra validación |

## Flujo de la petición

`signIn()` solo describe los pasos; cada paso vive en su propio método y lanza `SignInException` cuando falla.

```java
long companyId = _portal.getCompanyId(request);

_checkRegistrationEnabled(companyId);      // 403 si no se permite el registro
JSONObject jsonObject = _parseBody(body);  // 400 MALFORMED_JSON
_validate(jsonObject);                     // 400 VALIDATION_ERROR (todos los campos juntos)
UserDTO userDTO = _toUserDTO(jsonObject);  // deserializar + normalizar
// TODO: verificar el CAPTCHA acá
User user = _addUser(companyId, userDTO, request);

return _toCreatedResponse(companyId, user);  // 201
```

```
petición
  │
  ├─ _checkRegistrationEnabled ── falla ─▶ SignInException 403
  ├─ _parseBody ───────────────── falla ─▶ SignInException 400 MALFORMED_JSON
  ├─ _validate ────────────────── falla ─▶ SignInException 400 VALIDATION_ERROR
  ├─ _toUserDTO
  ├─ _addUser ─────────────────── falla ─▶ PortalException ─▶ _toSignInException ─▶ 409 / 400 / 500
  └─ _toCreatedResponse ─▶ 201
```

El manejo de errores en `signIn()` tiene tres niveles:

```java
catch (SignInException e)  → _toErrorResponse(e)                      // nuestros errores
catch (PortalException e)  → _toErrorResponse(_toSignInException(e))  // errores de Liferay, traducidos
catch (Exception e)        → log + 500                                 // cualquier cosa inesperada
```

### Por qué se valida antes de deserializar

Primero el body se parsea a un `JSONObject` (`_parseBody`) y se valida ahí (`_validate`). Solo un body que pasó la validación se deserializa a `UserDTO` (`_toUserDTO`). Así, un body mal formado o incompleto nunca llega al DTO, y todos los errores de campo se devuelven juntos para que el fragment pueda marcar todos los campos inválidos de una vez.

## Clases

### `CustomSignInApplication`

| Método | Responsabilidad |
|---|---|
| `signIn` | Orquesta el flujo y los tres bloques `catch` |
| `_checkRegistrationEnabled` | Lee `PropsKeys.COMPANY_SECURITY_STRANGERS`; lanza 403 si está desactivado |
| `_parseBody` | JSON vacío o inválido → 400 `MALFORMED_JSON` |
| `_validate` | Junta todos los errores de campo y los lanza juntos |
| `_toUserDTO` | `JSONFactory.looseDeserialize` + trim/minúsculas (la contraseña no se toca) |
| `_addUser` | Llama a `addUserWithWorkflow` con cada argumento posicional como variable con nombre |
| `_createServiceContext` | Arma el `ServiceContext` a partir de la petición (ver más abajo) |
| `_getLocale` | `languageId` → `Locale`, con el idioma del sitio como respaldo |
| `_toCreatedResponse` | Traduce el estado del usuario a `status` / `nextStep` |
| `_toErrorResponse` | Convierte una `SignInException` en el JSON de error |
| `_toSignInException` | Traduce las excepciones de Liferay al contrato |

#### Propiedades del componente

```java
JAX_RS_APPLICATION_BASE + "=/sign-in/v1.0",
JAX_RS_NAME + "=SignIn.Rest",
"auth.verifier.guest.allowed=true",      // Guest puede llamarlo
"liferay.access.control.disable=true",   // saltea las Service Access Policies (solo desarrollo)
"liferay.oauth2=false"                   // no requiere scope de OAuth2
```

El acceso guest se mantiene en producción: un visitante anónimo no tiene token. Lo que cambia en producción es `liferay.access.control.disable` (ver checklist).

#### `ServiceContext`

`addUserWithWorkflow` lo necesita. Los campos importantes:

| Campo | Para qué |
|---|---|
| `portalURL` + `pathMain` | Arman los links de los mails de verificación y bienvenida. Sin ellos, los links quedan rotos |
| `languageId` | Idioma de esos mails |
| `remoteAddr` / `remoteHost` | Información de auditoría |

#### `addUserWithWorkflow`

Cada argumento es una variable local con nombre, para que la llamada se lea fácil:

```java
long[] roleIds = new long[0];  // sin roles: "User" es implícito
boolean sendEmail = true;      // mail de bienvenida / verificación
```

> La firma de `addUserWithWorkflow` y `getGuestUser` (antes `getDefaultUser`) cambia entre versiones de DXP. Si no compila, compará con tu `release.dxp.api`.

### `SignInException`

Una excepción que ya trae la respuesta HTTP: `status`, `code`, `title` y una lista de `FieldError` (`field`, `code`, `message`). Los métodos de fábrica mantienen cada `throw` corto:

```java
throw SignInException.forbidden("REGISTRATION_DISABLED", "Registration disabled");
throw SignInException.validation(fieldErrors);
return SignInException.conflict("EMAIL_ALREADY_REGISTERED", "...");
```

### `UserDTO`

Un bean simple que sigue las convenciones de Liferay (atributos privados con `_`, getters/setters ordenados alfabéticamente). `JSONFactory.looseDeserialize` lo completa a través de los setters. `toString()` enmascara `password` y `captchaToken`, así el DTO se puede loguear sin riesgo.

## Configuración de Liferay

| Dónde | Opción | Valor |
|---|---|---|
| Instance Settings → User Authentication | Allow strangers to create accounts | **Activado** (si no, 403) |
| Instance Settings → User Authentication | Require strangers to verify their email address | Recomendado **activado** |
| Instance Settings → Users → Default User Associations | Roles / sitios que se agregan automáticamente | Verificar que no haya nada extra (nada de "Power User") |
| Control Panel → Roles → User | Permisos del rol implícito | Solo lo que necesita un espectador; nada de edición |
| Contenido de streaming | VIEW para Guest | Quitado, para que solo lo vean usuarios logueados |
| Mail | SMTP configurado | Necesario para los mails de verificación |

## Pruebas

### Postman / Bruno

`POST http://localhost:8080/o/sign-in/v1.0` con el JSON de la petición de arriba.

| Caso | Body | Resultado esperado |
|---|---|---|
| Camino feliz | La petición de ejemplo | `201` |
| Mismo email dos veces | Repetir la petición | `409 EMAIL_ALREADY_REGISTERED` |
| Campos faltantes | Solo `givenName`, `familyName`, `emailAddress`, el resto vacío | `400 VALIDATION_ERROR` con varios `errors` |
| Contraseña débil | `"password": "123"` | `400` con `PASSWORD_TOO_SHORT` o `PASSWORD_INVALID` |
| JSON roto | `{ "givenName": ` | `400 MALFORMED_JSON` |
| Registro desactivado | Desactivar "Allow strangers…" | `403 REGISTRATION_DISABLED` |

### OpenAPI

`openapi.yaml` documenta el contrato y se puede importar en Postman, Bruno o Swagger Editor. Para servirlo desde el módulo, ponelo en `src/main/resources/META-INF/` y agregá un método `GET /openapi.yaml` que lo lea con `StringUtil.read(...)`; puede reemplazar al `printMessage()` de prueba.

Como es una aplicación JAX-RS whiteboard (no REST Builder), **no** aparece en `/o/api`.

## Seguridad y checklist para producción

- [ ] **CAPTCHA.** Implementar `_verifyCaptcha(userDTO, request)` en el `TODO` de `signIn()`, lanzando `SignInException.badRequest("CAPTCHA_FAILED", ...)`. Guardar el secret en `portal-ext.properties`. Para pruebas locales, usar los secrets de prueba de Cloudflare Turnstile (siempre pasa / siempre falla).
- [ ] **Service Access Policy.** Sacar `liferay.access.control.disable=true` y crear una SAP que habilite solo este endpoint para Guest.
- [ ] **Rate limiting** por IP en el proxy o el balanceador.
- [ ] **Verificación de email** activada, para que las cuentas creadas por bots queden inactivas.
- [ ] Evaluar el tema de privacidad del 409: revela si un email tiene cuenta. La alternativa es responder siempre 201 y mandar un mail de "ya tenés una cuenta".

> Sin CAPTCHA, un endpoint público de registro se puede usar para mandar mails de verificación a direcciones arbitrarias, y eso puede hacer que el dominio de mail quede marcado como spam. No lo expongas públicamente hasta tener el CAPTCHA.

## Decisiones tomadas

| Decisión | Motivo |
|---|---|
| Endpoint JAX-RS propio en lugar de darle `ADD_USER` a Guest | Guest no recibe permisos nuevos; solo se aceptan los campos del contrato |
| Servicios locales (`UserLocalService`) | No chequean permisos, bajo nuestra propia validación |
| Sin rol propio, solo el "User" implícito | Los espectadores solo necesitan ver contenido; los demás roles son de administración |
| Validar antes de deserializar | Los bodies mal formados nunca llegan al DTO; todos los errores se devuelven juntos |
| Excepción propia (`SignInException`) | Cada paso lanza un error ya en el formato del contrato |
| CAPTCHA postergado | No hace falta en entornos internos; es **obligatorio** antes de salir al público |

## Solución de problemas

| Síntoma | Causa probable |
|---|---|
| `403` o `401` del propio Liferay (no nuestro JSON) | Faltan las propiedades de guest, o una Service Access Policy lo bloquea |
| `403 REGISTRATION_DISABLED` | "Allow strangers to create accounts" está desactivado |
| Mail de verificación con el link roto | `ServiceContext` sin `portalURL` / `pathMain` |
| Toda contraseña falla con `PASSWORD_INVALID` | La política de contraseñas de la instancia es más estricta de lo esperado |
| Error de compilación en `addUserWithWorkflow` | La firma es distinta en tu versión de DXP |
| No encuentra `javax.ws.rs` / `javax.servlet` | Releases trimestrales con Jakarta EE: cambiar los imports a `jakarta.*` |