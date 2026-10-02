# POC Netflix en Liferay

Prueba de concepto de un sitio estilo Netflix construido sobre Liferay Portal. El objetivo es replicar los flujos de UI/UX (home con filas de títulos, detalle, perfiles, búsqueda, "Mi lista"), sin reproductor de video.

Todo el sitio se define como código dentro de un **Site Initializer** (un client extension), así que al deployar el proyecto cada uno obtiene el mismo sitio armado en su Liferay local.

---

## Requisitos

| Herramienta | Versión | Notas |
|---|---|---|
| JDK | 21 (probado con Azul Zulu 21) | Configurar `JAVA_HOME` y agregar `%JAVA_HOME%\bin` al PATH |
| Blade CLI | Última disponible | Ver la guía "Installing Blade CLI" en learn.liferay.com |
| Git | Cualquiera reciente | |
| RAM libre | ~4 GB | El servidor arranca con 2.5 GB de heap |

Liferay **no** hace falta instalarlo aparte: Blade lo descarga dentro del proyecto (carpeta `bundles/`). La base de datos (Hypersonic) también viene incluida.

### ⚠️ Antes de empezar

- **No clones el proyecto dentro de OneDrive** (ni en Escritorio o Documentos si están sincronizados). OneDrive bloquea archivos durante los builds y rompe la instalación de dependencias. Usá una ruta corta y local, por ejemplo `C:\POC-Netflix\`.
- **No uses `setx PATH ...` para editar el PATH.** Trunca el valor a 1024 caracteres y puede romper el PATH del sistema. Editalo siempre desde *Variables de entorno* en Windows (`sysdm.cpl` → Opciones avanzadas → Variables de entorno).
- Si tenés otro Tomcat o Liferay instalado, **apagalo** antes de levantar este: ambos usan el puerto 8080.

### Verificar el entorno

Abrí una terminal nueva y corré:

```cmd
java --version
blade version
git --version
```

`java --version` tiene que mostrar la versión 21. Si muestra Java 8 o da error, revisá que `%JAVA_HOME%\bin` esté en el PATH antes que cualquier otra instalación de Java (`where java` muestra el orden).

---

## Puesta en marcha

### 1. Clonar el repositorio

```cmd
mkdir C:\POC-Netflix
cd C:\POC-Netflix
git clone https://github.com/Frtocco/POC-Liferay.git
cd POC-Liferay
```

### 2. Descargar el servidor de Liferay

```cmd
blade server init
```

Descarga Liferay Portal CE 7.4 GA132 (definido en `gradle.properties`) dentro de `bundles/`. Se hace **una sola vez** y puede tardar varios minutos. La carpeta `bundles/` no se versiona: cada uno tiene la suya.

### 3. Levantar el servidor

```cmd
blade server run
```

Esta terminal queda ocupada mostrando el log. Esperá a ver:

```
Server startup in [XXXXX] milliseconds
```

El primer arranque es lento porque Liferay despliega todos sus módulos y themes por defecto. Los siguientes son más rápidos.

### 4. Ingresar a Liferay

1. Abrí `http://localhost:8080`.
2. Hacé clic en **Sign In** e ingresá:
   - **Email:** `test@liferay.com`
   - **Password:** `test`
3. Aceptá los términos y elegí una contraseña nueva.

### 5. Deployar el sitio del POC

En **otra terminal** (la del paso 3 sigue corriendo):

```cmd
cd C:\POC-Netflix\POC-Liferay\client-extensions\netflix-site-initializer
blade gw deploy
```

Liferay procesa el site initializer **después** de terminar de desplegar sus themes por defecto (el último es `speedwell-theme`). En el log del servidor tiene que aparecer:

```
STARTED netflixsiteinitializer_7.4.3.132
```

sin errores a continuación.

### 6. Verificar

- **Control Panel → Sites**: tiene que aparecer **Netflix POC**.
- Entrá al sitio → **Site Menu → Design → Fragments**: tiene que estar la colección **Netflix UI** con la **Movie Card**.

---

## Estructura del proyecto

```
POC-Liferay/
├── client-extensions/
│   └── netflix-site-initializer/       # Definición del sitio como código
│       ├── client-extension.yaml       # Configuración del site initializer
│       └── site-initializer/
│           └── fragments/group/netflix-ui/
│               ├── collection.json     # Colección "Netflix UI"
│               └── fragments/
│                   └── movie-card/     # Un fragment = una carpeta
│                       ├── fragment.json
│                       ├── index.html
│                       ├── index.css
│                       └── index.js
├── modules/
│   └── netflix-profile-service/        # Service Builder (Profile, FavoriteEntry) — en desarrollo
├── gradle.properties                   # Versión de Liferay del proyecto
└── bundles/                            # Servidor local (NO se versiona)
```

---

## Flujo de trabajo diario

1. **Terminal 1:** `blade server run` y dejarlo corriendo.
2. Editar los archivos en VS Code.
3. **Terminal 2:** `blade gw deploy` desde la carpeta del proyecto que cambiaste. No hace falta reiniciar el servidor: Liferay toma los cambios en caliente.
4. Refrescar el navegador.

Para deployar todo el workspace de una vez, corré `blade gw deploy` desde la raíz del proyecto.

### Reglas del equipo

- **La fuente de verdad es el repositorio.** No edites los fragments ni la configuración del sitio desde la UI de Liferay: el próximo deploy puede pisar esos cambios, y tus compañeros no los van a tener.
- **Nuevo fragment:** creá una carpeta dentro de `site-initializer/fragments/group/netflix-ui/fragments/` con sus cuatro archivos (`fragment.json`, `index.html`, `index.css`, `index.js`), usando `movie-card` como referencia.
- **Guardá los archivos en UTF-8.** Si usás Notepad, elegí "Todos los archivos (\*.\*)" al guardar para que no se agregue `.txt` al nombre.
- **Antes de cada commit**, revisá con `git status` que no aparezca nada de `bundles/`, `build/` ni `dist/`.

---

## Problemas frecuentes

### `Address already in use: bind` al levantar el servidor

Hay otro proceso usando el puerto 8080 (otro Liferay, o una instancia anterior que quedó colgada).

```cmd
netstat -ano | findstr :8080
taskkill /PID <número-de-PID> /F
```

Después volvé a correr `blade server run`.

### El sitio "Netflix POC" no aparece después del deploy

1. Esperá a que el log muestre `STARTED netflixsiteinitializer...`. Antes de eso el sitio no existe todavía.
2. Revisá que el contenido haya entrado en el paquete:
   ```cmd
   tar -tf bundles\osgi\client-extensions\netflix-site-initializer.zip
   ```
   Tienen que aparecer las rutas `site-initializer/fragments/...` y `site-initializer/site-initializer.zip`.
3. Si en el log aparece `NullPointerException ... "binaryFile" is null`, la carpeta `site-initializer/` está vacía o los archivos quedaron en otra ruta. Verificalo con `dir /s /b client-extensions\netflix-site-initializer\site-initializer`.

### `EPERM: operation not permitted` durante el build

El proyecto está dentro de una carpeta sincronizada por OneDrive. Movelo a una ruta local (por ejemplo `C:\POC-Netflix\`), borrá las carpetas `node_modules` y volvé a deployar.

### `java --version` muestra otra versión o `where` / `hostname` no se reconocen

El PATH está mal configurado o truncado. Revisalo desde *Variables de entorno* (no con `setx`) y confirmá que estén `C:\Windows\System32`, `C:\Windows` y `%JAVA_HOME%\bin`. Después de cambiarlo, abrí una terminal **nueva**.

### `blade` funciona en cmd pero no en Git Bash

Abrí una ventana nueva de Git Bash después de modificar el PATH. Si sigue sin funcionar, probá con `blade.cmd`.

---

## Próximos pasos del POC

- Content Type **"Título"** (películas y series) dentro del site initializer.
- Fragment de **fila horizontal** con scroll que agrupe Movie Cards.
- Página **Home** armada con esos fragments.
- Entidades **Profile** y **FavoriteEntry** ("Mi lista") con Service Builder.
