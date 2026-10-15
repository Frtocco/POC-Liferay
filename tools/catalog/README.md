# Catalog seed

Este directorio permite cargar peliculas y series como Web Content estructurado en Liferay desde archivos versionados en Git.

## Requisitos

- Liferay corriendo, normalmente en `http://localhost:8080`.
- Sitio `Netflix POC` deployado.
- Content Type `Titulo` existente en el sitio.
- Vocabularios `generos` y `tipo` existentes con las categorias usadas en `catalog.json`.
- Usuario con permisos para Documents and Media, Web Content y categorias.

> Nota: el nombre real de la estructura puede tener tilde (`Titulo` / `Titulo` con tilde). El script compara sin mayusculas ni tildes.

El modelo `Titulo` y las taxonomias estan versionados en el site initializer:

```text
client-extensions/netflix-site-initializer/site-initializer/ddm-structures/group/titulo.xml
client-extensions/netflix-site-initializer/site-initializer/taxonomy-vocabularies/group/
```

Antes de sembrar catalogo, deploya el site initializer:

```powershell
cd C:\POC-Netflix\POC-Liferay\client-extensions\netflix-site-initializer
blade gw deploy
```

Despues verifica en Liferay que existan:

- **Content & Data -> Web Content -> Structures -> Titulo**
- **Categorization -> Categories -> generos / tipo**

Si el sitio ya existia antes de agregar esos archivos, el site initializer puede no aplicar el modelo nuevo. En ese caso deploya el bootstrap OSGi:

```powershell
cd C:\POC-Netflix\POC-Liferay
blade gw :modules:netflix-catalog-bootstrap:deploy
```

El bootstrap es idempotente: crea `Titulo`, `generos` y `tipo` solo si faltan.

## Probar sin crear contenido

Primero valida credenciales, APIs y Site ID:

```powershell
cd C:\POC-Netflix\POC-Liferay
.\tools\catalog\seed-catalog.ps1 -Probe
```

El probe tambien lista sitios cuando la API lo permite. Copia el `Id` del sitio `Netflix POC` y usalo con `-SiteId`.

En el entorno local actual se detecto:

```text
Netflix POC -> SiteId 33503
```

Si la API no lista sitios, entra a una pagina del sitio `Netflix POC`, abre la consola del navegador y ejecuta:

```javascript
Liferay.ThemeDisplay.getScopeGroupId()
```

Ese valor es el `SiteId` para este script.

Si conoces el Site ID local:

```powershell
.\tools\catalog\seed-catalog.ps1 -SiteId 12345 -Probe
```

No uses el Site ID del `.lar` de otro entorno como valor definitivo. En cada Liferay local puede ser distinto.

```powershell
cd C:\POC-Netflix\POC-Liferay
.\tools\catalog\seed-catalog.ps1 -DryRun
```

En algunos bundles locales de Liferay, el endpoint que lista estructuras puede devolver `HTTP 400` aunque el sitio y la autenticacion esten bien. Para `-DryRun`, el script usa automaticamente la definicion versionada de `Titulo` y no depende de ese listado.

`-DryRun` solo arma y muestra el payload: no crea Web Content, no sube imagenes y no modifica Liferay.

Si no pasas `-Password` ni definis `LIFERAY_PASSWORD`, el script te pide la password en la consola de forma oculta.

Tambien podes pasarla explicitamente, aunque queda en el historial de la terminal:

```powershell
.\tools\catalog\seed-catalog.ps1 -Password "tu-password" -DryRun
```

Si devuelve `HTTP 403`, revisa usuario/password y permisos del usuario sobre el sitio. El usuario necesita poder leer estructuras/categorias y crear documentos/Web Content.

Si devuelve `HTTP 400` leyendo `content-structures`, usa `-StructureId <id>` para evitar ese listado. El bootstrap OSGi deja el ID en el log con un mensaje como `Content structure Titulo already exists with ID 12345`.

Si devuelve `HTTP 404` leyendo `content-structures`, casi siempre el `SiteId` no existe en ese Liferay. Buscalo en **Site Menu -> Configuration -> Site Settings -> Site Configuration**.

Tambien podes pasar el `siteId` directamente si la resolucion por ERC no funciona en tu entorno:

```powershell
.\tools\catalog\seed-catalog.ps1 -SiteId 32295 -Password "tu-password" -DryRun
```

## Cargar o actualizar catalogo

```powershell
.\tools\catalog\seed-catalog.ps1 -Password "tu-password"
```

Si tu entorno devuelve `HTTP 400` al listar estructuras, pasa el ID de `Titulo` directamente:

```powershell
.\tools\catalog\seed-catalog.ps1 -SiteId 33503 -StructureId 12345 -Password "tu-password"
```

Para el entorno local donde `Netflix POC` es `33503` y `Titulo` es `34074`:

```powershell
.\tools\catalog\seed-catalog.ps1 -SiteId 33503 -StructureId 34074 -ContentLanguageId en_US
```

El script usa `erc` para que cada item sea idempotente. Si corres el comando varias veces, actualiza los mismos Web Content en vez de duplicarlos.

La estructura `Titulo` esta versionada con `en_US` como idioma default. Por eso el script manda `Accept-Language: en-US` y valores `contentFieldValue_i18n.en_US`; si tu estructura local usa otro idioma default, pasalo con `-ContentLanguageId`.

Si Liferay rechaza un item, el script guarda el payload enviado en `tools/catalog/last-failed-payload-<erc>.json` para poder comparar el JSON real contra un Web Content creado a mano.

Si una categoria del catalogo no existe, por ejemplo `Ciencia Ficcion`, el script se detiene y muestra las categorias disponibles. Solo crea categorias faltantes si se pasa explicitamente `-CreateMissingCategories`.

```powershell
.\tools\catalog\seed-catalog.ps1 -SiteId 33503 -StructureId 34074 -CreateMissingCategories
```

## Agregar titulos

1. Crear una carpeta dentro de `images/`.
2. Agregar `poster.png` y `fondo.png` o cambiar los paths en `catalog.json`.
3. Agregar un objeto nuevo con:
   - `erc`: clave estable, por ejemplo `titulo-mi-pelicula`.
   - `tipo`: `Pelicula` o `Serie`.
   - `generos`: nombres de categorias existentes.
   - `episodios`: solo para series.
4. Ejecutar de nuevo `seed-catalog.ps1`.

## Variables de entorno opcionales

```powershell
$env:LIFERAY_BASE_URL = "http://localhost:8080"
$env:LIFERAY_USER = "test@liferay.com"
$env:LIFERAY_PASSWORD = "test"
$env:LIFERAY_SITE_ERC = "netflix-poc"
$env:LIFERAY_STRUCTURE_ID = "12345"
$env:LIFERAY_CONTENT_LANGUAGE_ID = "en_US"
```
