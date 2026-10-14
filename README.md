# POC Netflix en Liferay

Prueba de concepto de un sitio estilo Netflix construido sobre Liferay Portal CE 7.4. El objetivo es replicar los flujos de UI/UX (login, selector de perfiles, home con título destacado y filas de títulos, detalle, "Mi lista"), sin reproductor de video.

---

## Estado actual

| Pieza | Estado |
|---|---|
| Site initializer (crea el sitio Netflix POC) | ✅ Funciona |
| Fragments: Movie Card, Fila de títulos, Título destacado, Header de navegación, Pantalla de login | ✅ Funcionan |
| Content Type **Título**, vocabularios **Géneros** y **Tipo**, títulos de ejemplo | ✅ Viajan en el LAR |
| Páginas Home, Series, Películas, Mi lista, Login, Perfiles y sus master pages | ✅ Viajan en el LAR |
| Campos extra de la cuenta (`plan`, `tarjetaMarca`, `tarjetaUltimos4`) | ✅ Site initializer |
| Object **Perfil** (con API REST) | ✅ JSON exportado, se importa a mano |
| Login nativo con estilo Netflix y redirección a `/perfiles` | ✅ Funciona |
| Selector de perfiles (`/perfiles`) | ⏳ Pendiente: la página existe pero está vacía |
| Registro propio (React + Spring Boot) | ⏳ Pendiente |
| Mi lista, detalle de título, páginas privadas | ⏳ Pendiente |

---

## Qué vive dónde

En Liferay hay tres tipos de cosas, y cada una se comparte de forma distinta. **Cada pieza tiene un solo origen**: si algo viene del LAR, no se crea también desde el site initializer (y al revés), porque chocan.

| Qué | Dónde vive | Cómo se comparte |
|---|---|---|
| Código de los fragments | `client-extensions/netflix-site-initializer/site-initializer/fragments/` | Git + `blade gw deploy` |
| Campos personalizados del usuario | `site-initializer/expando-columns.json` | Git + `blade gw deploy` |
| Propiedades del portal | `configs/local/portal-ext.properties` | Git (Blade lo copia a `bundles/` en `blade server init`) |
| Páginas, master pages, estructura Título, vocabularios, títulos | Base de datos del sitio | **LAR** en `exports/` |
| Object Perfil | Base de datos de la instancia | **JSON** en `exports/objects/` |
| Picklist Avatares, permisos de roles, configuración de la instancia | Base de datos de la instancia | **Pasos manuales** (ver Configuración) |
| Usuarios y perfiles cargados | Base de datos de la instancia | No se comparten: cada uno crea los suyos |

¿Por qué no va todo en el LAR? El LAR exporta **un sitio**. Los usuarios, los Objects de alcance instancia, los roles y la configuración pertenecen a **toda la instancia**, no al sitio, así que no entran.

¿Por qué no va todo en el site initializer? Las páginas se definen con `page-definition.json`, muy trabajosos de escribir y mantener a mano. Lo probamos y trajo problemas, así que las páginas quedaron en el LAR.

---

## Requisitos

| Herramienta | Versión | Notas |
|---|---|---|
| JDK | 21 (probado con Azul Zulu 21) | Configurar `JAVA_HOME` y agregar `%JAVA_HOME%\bin` al PATH |
| Blade CLI | Última disponible | Ver "Installing Blade CLI" en learn.liferay.com |
| Git | Cualquiera reciente | |
| RAM libre | ~4 GB | El servidor arranca con 2.5 GB de heap |

Liferay **no** se instala aparte: Blade lo descarga dentro del proyecto (`bundles/`). La base de datos (Hypersonic) y el buscador (Elasticsearch "sidecar") vienen incluidos.

### ⚠️ Antes de empezar

- **No clones el proyecto dentro de OneDrive** (ni en Escritorio o Documentos si están sincronizados). OneDrive bloquea archivos durante los builds. Usá una ruta corta y local, por ejemplo `C:\POC-Netflix\`.
- **No uses `setx PATH ...`**: trunca el PATH a 1024 caracteres y puede romper el sistema. Editalo desde *Variables de entorno* (`sysdm.cpl` → Opciones avanzadas → Variables de entorno).
- Si tenés otro Tomcat o Liferay instalado, **apagalo**: todos usan el puerto 8080.

### Verificar el entorno

```cmd
java --version
blade version
git --version
```

`java --version` tiene que mostrar la versión 21. Si no, revisá con `where java` que `%JAVA_HOME%\bin` esté primero en el PATH.

---

## Preparar el entorno desde cero

Seguí los pasos **en este orden**: cada uno depende del anterior.

### 1. Clonar y descargar el servidor

```cmd
mkdir C:\POC-Netflix
cd C:\POC-Netflix
git clone https://github.com/Frtocco/POC-Liferay.git
cd POC-Liferay
blade server init
```

`blade server init` descarga Liferay Portal CE 7.4 GA132 a `bundles/` y copia ahí el `portal-ext.properties` de `configs/local/`. Se hace una sola vez y tarda varios minutos.

### 2. Levantar el servidor

```cmd
blade server run
```

La terminal queda ocupada con el log. Esperá a ver `Server startup in [XXXXX] milliseconds`. El primer arranque es lento.

### 3. Primer ingreso

1. Abrí `http://localhost:8080/c/portal/login`.
2. Ingresá con `test@liferay.com` / `test` y elegí una contraseña nueva.

### 4. Deployar el site initializer

En **otra terminal**:

```cmd
cd C:\POC-Netflix\POC-Liferay\client-extensions\netflix-site-initializer
blade gw deploy
```

Esperá en el log `STARTED netflixsiteinitializer_7.4.3.132`, sin errores a continuación. Liferay lo procesa **después** de desplegar sus themes por defecto (el último es `speedwell-theme`), así que puede tardar unos minutos en el primer arranque.

Verificá:

- **Panel de control → Sitios**: aparece **Netflix POC**.
- **Panel de control → Campos personalizados → Usuario**: aparecen `plan`, `tarjetaMarca` y `tarjetaUltimos4`.

### 5. Importar el Object Perfil

1. **Panel de control → Picklists → Agregar**: nombre **Avatares**, con estos elementos (la **clave** tiene que ser exacta):

   | Nombre | Clave |
   |---|---|
   | Rojo | `rojo` |
   | Azul | `azul` |
   | Verde | `verde` |
   | Amarillo | `amarillo` |

2. **Panel de control → Objects → Importar**: elegí `exports/objects/Perfil.json`. Verificá que quede **publicado** (estado *Approved*) y con alcance **company**.
3. Verificá la relación con el usuario: en `http://localhost:8080/o/api` → **REST Applications → c/perfils** → POST `/`, el cuerpo tiene que incluir `r_perfiles_userId`. Si no aparece, creala a mano: Object de sistema **User** → **Relaciones → Agregar**, etiqueta **Perfiles**, nombre `perfiles`, tipo **Uno a muchos**, Object **Perfil**.

### 6. Permisos del rol User

**Panel de control → Roles → Roles regulares → User → Definir permisos**, buscá **Perfil** y marcá:

- En la aplicación: **Agregar entrada** (*Add Object Entry*).
- En las entradas: **Ver** (*View*).

No marques **Actualizar** ni **Eliminar** a nivel de rol: le daría a cualquier usuario permiso sobre los perfiles ajenos.

### 7. Configuración de la instancia

Algunas opciones se guardan en la base y **le ganan al `portal-ext.properties`**, así que se configuran desde la UI:

| Opción | Dónde | Valor |
|---|---|---|
| Verificación de email al crear cuenta | Configuración de la instancia → Autenticación de usuarios → General | Desactivada |
| Página de destino (después del login) | Configuración de la instancia → Configuración de la instancia → General → navegación | `/web/netflix-poc/perfiles` |
| URL de inicio | Mismo lugar | `/web/netflix-poc/login` |
| Página al cerrar sesión | Mismo lugar | `/web/netflix-poc/login` |

Y en **Panel de control → Configuración del sistema → Fragments de página**, activá la **propagación automática de cambios de fragments**. Sin esto, al deployar un fragment las páginas siguen mostrando la versión anterior.

### 8. Importar el LAR

1. **Diseño → Fragments** del sitio Netflix POC: **borrá los fragments de la colección Netflix UI** que creó el site initializer. Si no, el LAR choca con ellos al importar (`The Fragment Entry ... could not be imported`).
2. Entrá al sitio → **Publicación → Importar** y subí el LAR más reciente de `exports/`.
3. Volvé a correr `blade gw deploy` del site initializer, para que los fragments queden con la versión del repo aunque el LAR sea un poco más viejo.

### 9. Activar la URL de login propia

Recién ahora que existe la página `/login`, agregá esta línea al final de `bundles\portal-ext.properties` (**no** en `configs/local`) y reiniciá el servidor:

```properties
auth.login.url=/web/netflix-poc/login
```

No va en `configs/local` porque `blade server init` la copiaría a cada instalación nueva antes de que exista el sitio, y el login daría 404. Si te pasa, entrá con el login nativo:

```
http://localhost:8080/web/guest/home?p_p_id=com_liferay_login_web_portlet_LoginPortlet&p_p_state=maximized
```

### 10. Probar

1. Abrí `http://localhost:8080` en una ventana de incógnito: tiene que aparecer el login de Netflix POC.
2. Creá un usuario de prueba (por ahora con el registro nativo, desde `http://localhost:8080/c/portal/login` → **Create Account**).
3. Iniciá sesión: te tiene que llevar a `/perfiles` sin pasar por términos de uso ni pregunta de seguridad.
4. Con el admin, revisá que el usuario nuevo sea miembro de **Netflix POC** (**Panel de control → Usuarios** → el usuario → **Sitios**).

---

## Estructura del proyecto

```
POC-Liferay/
├── client-extensions/
│   └── netflix-site-initializer/
│       ├── client-extension.yaml          # Define el site initializer y su app OAuth
│       └── site-initializer/
│           ├── expando-columns.json       # Campos extra del usuario
│           └── fragments/group/netflix-ui/
│               ├── collection.json        # Colección "Netflix UI"
│               └── fragments/
│                   ├── movie-card/        # Card suelta, editable a mano
│                   ├── title-row/         # Fila de títulos por género
│                   ├── hero-banner/       # Título destacado
│                   ├── netflix-header/    # Header de navegación
│                   └── login-shell/       # Pantalla de login
├── configs/local/portal-ext.properties    # Propiedades del portal
├── exports/
│   ├── netflix-poc_<fecha>_<commit>.lar   # Sitio: páginas, contenido, vocabularios
│   └── objects/Perfil.json                # Object Perfil
├── modules/netflix-profile-service/       # Service Builder inicial: NO se usa (reemplazado por el Object Perfil)
├── gradle.properties                      # Versión de Liferay
└── bundles/                               # Servidor local (NO se versiona)
```

---

## Modelo de datos

### Content Type "Título" (películas y series)

Estructura de contenido web en el sitio Netflix POC. El nombre tiene que ser exactamente **Título**, porque los fragments la buscan así. La **Referencia del campo** (pestaña Avanzado) es el nombre con el que la API devuelve cada campo, y los fragments dependen de ella.

| Campo | Tipo | Referencia | Obligatorio |
|---|---|---|---|
| Sinopsis | Texto, varias líneas | `sinopsis` | Sí |
| Poster | Imagen vertical | `poster` | Sí |
| Fondo | Imagen horizontal 16:9 (1920×1080 o más) | `fondo` | No (si falta, se usa el poster) |
| Año | Numérico | `anio` | Sí |
| Clasificación | Lista: ATP, +13, +16, +18 | `clasificacion` | Sí |
| Dirección | Texto | `direccion` | No |
| Elenco | Texto repetible | `elenco` | No |
| Duración (min) | Numérico | `duracion` | No (películas) |
| Temporadas | Numérico | `temporadas` | No (series) |
| Episodio (grupo repetible) | Temporada, número, nombre, duración | `episodio`, `episodioTemporada`, `episodioNumero`, `episodioNombre`, `episodioDuracion` | No |

El nombre del título no es un campo: se usa el título propio del contenido web.

Género y tipo van como **categorías**: vocabularios **Géneros** (Comedia, Drama, Acción; varios por título) y **Tipo** (Película, Serie; uno por título). Están asociados a Contenido web → Título como obligatorios y con visibilidad **pública** (si son internos, la API no devuelve las categorías y los filtros dejan de funcionar).

### Cuenta

| Dato | Origen |
|---|---|
| Email, contraseña, nombre, apellido | Usuario nativo de Liferay |
| `plan` (Básico, Estándar, Premium) | Campo personalizado de texto |
| `tarjetaMarca`, `tarjetaUltimos4` | Campos personalizados de texto. Solo marca y últimos 4 dígitos, nunca el número completo |

### Object "Perfil"

Alcance instancia (company). API: `/o/c/perfils` (Liferay pluraliza el nombre agregando una "s").

| Campo | Tipo | Nombre en la API |
|---|---|---|
| Nombre | Texto, obligatorio | `nombre` |
| Avatar | Picklist Avatares | `avatar` (se manda `{ "key": "rojo" }`) |
| Infantil | Booleano | `infantil` |
| Dueño | Relación uno a muchos con User | `r_perfiles_userId` |

Perfiles de un usuario (el valor va **entre comillas**; sin comillas da `Incompatible types`):

```
/o/c/perfils?filter=r_perfiles_userId eq '<id del usuario>'
```

Con los permisos de la opción elegida, cualquier usuario logueado puede **leer** los perfiles de otras cuentas por la API (no modificarlos). Por eso el selector **siempre** tiene que filtrar por el usuario actual. Para un proyecto real, el acceso pasaría por un microservicio.

---

## Fragments

Todos están en la colección **Netflix UI**. Cada uno tiene un `configuration.json` que define su panel de configuración en el editor (equivalente al `_cq_dialog` de AEM).

| Fragment | Qué hace | Configuración |
|---|---|---|
| **Movie Card** | Card de una película, editable a mano | Poster y título editables |
| **Fila de títulos** | Fila horizontal con flechas, con los títulos de un género en orden aleatorio | Texto de la fila, género, películas / series / ambas |
| **Título destacado** | Título al 90% del alto de la pantalla con fondo, nombre y sinopsis. "Más información" abre un modal con los datos completos | Título fijo (vacío = al azar), género, tipo |
| **Header de navegación** | Fondo negro, logo y links a Home, Series, Películas, Mi lista. En móvil, menú "Explorar" | Ruta base del sitio, texto y ruta de cada sección |
| **Pantalla de login** | Marco del login con fondo, logo, caja central y link a registro. Tiene una zona donde se suelta el widget nativo **Iniciar sesión**. Si el usuario ya tiene sesión, lo manda a `/perfiles` | Título, textos y URL de registro, URL de perfiles |

**Fila de títulos** y **Título destacado** leen los títulos con la API headless:

1. `/o/headless-delivery/v1.0/sites/{siteId}/content-structures` → buscan la estructura "Título".
2. `/o/headless-delivery/v1.0/content-structures/{id}/structured-contents` → traen los contenidos.
3. Filtran por las categorías y leen los campos por su referencia (`poster`, `fondo`, `sinopsis`…).

### Páginas

| Página | URL | Master | Contenido |
|---|---|---|---|
| Login | `/login` | Netflix Login (sin header) | Pantalla de login + widget Iniciar sesión. Pública. Header y footer del tema desactivados |
| Perfiles | `/perfiles` | — | Vacía, pendiente del selector |
| Home | `/home` | Netflix Master (con header) | Título destacado + Filas de títulos |
| Series | `/series` | Netflix Master | Igual que Home, filtrado a series |
| Películas | `/peliculas` | Netflix Master | Igual que Home, filtrado a películas |
| Mi lista | `/mi-lista` | Netflix Master | Pendiente |

---

## Flujo de trabajo diario

1. **Terminal 1:** `blade server run` y dejarlo corriendo.
2. Editar los archivos en VS Code.
3. **Terminal 2:** `blade gw deploy` desde la carpeta del proyecto que cambiaste. No hace falta reiniciar: Liferay toma los cambios en caliente.
4. Refrescar el navegador.

Para probar como visitante, usá una **ventana de incógnito**. Para ver lo publicado, abrí la URL de la página; la vista previa del editor muestra también lo que todavía no publicaste.

### Reglas del equipo

**Fragments**

- **La fuente de verdad del código es el repo.** No edites fragments desde la UI: el próximo deploy pisa esos cambios.
- **Nuevo fragment:** una carpeta en `site-initializer/fragments/group/netflix-ui/fragments/` con `fragment.json`, `index.html`, `index.css`, `index.js` y, si tiene opciones, `configuration.json`.
- **FreeMarker va con corchetes:** `[#assign]`, `[#list]`, `[#if]`. Con ángulos (`<#assign>`) el fragment queda con el aviso "FreeMarker syntax is invalid".
- **Archivos en UTF-8.** Si usás Notepad, guardá con "Todos los archivos (\*.\*)" para que no se agregue `.txt`.

**LAR**

- **Antes de exportar**, deployá la última versión de los fragments y propagá los cambios, para que el LAR lleve las mismas versiones que el repo.
- **Nombralo con fecha y commit**: `netflix-poc_2026-10-13_a1b2c3d.lar`, y guardalo en `exports/`.
- **Un cambio de fragment que se commitea va con un LAR nuevo en el mismo commit.**
- **Una sola persona genera el LAR.** Si dos exportan en paralelo, el último pisa al otro.

**Cambios de instancia** (Objects, picklists, permisos, configuración): si cambiás algo de esto, exportá el Object de nuevo o actualizá los pasos 5 a 7 de este README.

**Antes de cada commit**, revisá con `git status` que no aparezca nada de `bundles/`, `build/` ni `dist/`.

---

## Problemas frecuentes

### `Address already in use: bind` al levantar el servidor

Otro proceso usa el puerto 8080 (otro Liferay, o una instancia anterior colgada).

```cmd
netstat -ano | findstr :8080
taskkill /PID <número-de-PID> /F
```

`jps -l` lista los procesos Java; un Tomcat aparece como `org.apache.catalina.startup.Bootstrap`.

### El sitio "Netflix POC" no aparece después del deploy

1. Confirmá que levantaste el Tomcat del proyecto: en el log, `CATALINA_BASE` tiene que ser `...\POC-Liferay\bundles\tomcat`.
2. Esperá a que el log muestre `STARTED netflixsiteinitializer...`.
3. Revisá que el contenido haya entrado en el paquete:
   ```cmd
   tar -tf bundles\osgi\client-extensions\netflix-site-initializer.zip
   ```
   Tienen que aparecer `site-initializer/fragments/...` y `site-initializer/site-initializer.zip`.
4. Si el log muestra `NullPointerException ... "binaryFile" is null`, la carpeta `site-initializer/` está vacía o los archivos quedaron en otra ruta.

### Deployé un fragment y la página sigue igual

Los cambios no se propagan solos a las páginas donde ya está el fragment. Activá la propagación automática (paso 7) o, en **Diseño → Fragments** → el fragment → **Usos** → **Propagar**.

### Error al importar el LAR: `The Fragment Entry ... could not be imported`

Hay fragments duplicados: los creó el site initializer y el LAR trae los suyos. Borrá los fragments de la colección Netflix UI antes de importar (paso 8).

### La API devuelve vacío o "no existe" desde la barra del navegador

Al abrir una URL `/o/...` directamente, la API te atiende como **usuario anónimo**, porque falta el token CSRF. Probá desde el API Explorer (`http://localhost:8080/o/api`), que manda el token automáticamente.

### Al crear una cuenta pide un código de email

La verificación de email está activada en la configuración de la instancia. Desactivala (paso 7). No hay servidor de correo en local, así que el código nunca llega.

### El Sign In muestra un 404 y no se puede iniciar sesión

`auth.login.url` apunta a `/web/netflix-poc/login`, pero esa página todavía no existe (instancia nueva sin el LAR importado). Entrá con el login nativo (URL del paso 9), terminá la preparación y recién después activá la propiedad. Si no funciona, comentá la línea en `bundles\portal-ext.properties` y reiniciá.

### Después del login no va a `/perfiles`

- Si entraste por la ventana emergente de "Sign In", Liferay te devuelve a la página donde estabas. La página de destino solo se usa cuando el login no indica a dónde volver (por ejemplo, desde `/login` o `/c/portal/login`).
- Si igual no funciona, configurá la página de destino desde la UI (paso 7): el valor guardado en la instancia le gana al `portal-ext.properties`.

### `EPERM: operation not permitted` durante el build

El proyecto está en una carpeta sincronizada por OneDrive. Movelo a una ruta local, borrá `node_modules` y volvé a deployar.

### `java --version` muestra otra versión o `where` / `hostname` no se reconocen

El PATH está mal configurado o truncado. Revisalo desde *Variables de entorno* y confirmá que estén `C:\Windows\System32`, `C:\Windows` y `%JAVA_HOME%\bin`. Después, abrí una terminal **nueva**.

---

## Próximos pasos

- **Selector de perfiles** en `/perfiles`: lista los perfiles del usuario (`r_perfiles_userId`), guarda el perfil activo en `sessionStorage` y lleva a `/home`.
- **Registro propio** en `/registro`: custom element en React + microservicio Spring Boot que crea el usuario, sus campos (`plan`, tarjeta) y un perfil inicial.
- **Páginas privadas:** quitar la vista al rol Guest en todas las páginas salvo Login y Registro.
- **Mi lista:** Object con perfil + título, y su página.
- **Detalle de título:** display page template y link desde las cards.
- **Opcional:** mover el acceso a perfiles al microservicio (más seguro), y las funciones comunes de los fragments a un client extension global JS.
