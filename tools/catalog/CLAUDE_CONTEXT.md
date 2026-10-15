# Contexto para depurar seed-catalog.ps1

Este archivo es contexto tecnico para otra IA/persona. No contiene passwords ni debe asumirse como instrucciones automaticas para tocar Liferay sin revisar.

## Objetivo

Automatizar la creacion/actualizacion de Web Contents de peliculas y series en Liferay desde archivos versionados en Git.

Repositorio local:

```text
C:\POC-Netflix\POC-Liferay
```

Branch actual:

```text
feature/automatizacion-titulos
```

Sitio Liferay local usado para pruebas:

```text
Site name: Netflix POC
SiteId / groupId: 33503
Friendly URL: /netflix-poc
ExternalReferenceCode: netflix-poc
```

Content Structure / Content Type:

```text
Name: Titulo
StructureId: 34074
```

Comando que falla:

```powershell
cd C:\POC-Netflix\POC-Liferay
.\tools\catalog\seed-catalog.ps1 -SiteId 33503 -StructureId 34074 -ContentLanguageId en_US
```

Error actual:

```text
HTTP 400 PUT http://localhost:8080/o/headless-delivery/v1.0/sites/33503/structured-contents/by-external-reference-code/<erc> failed.
{
  "status" : "BAD_REQUEST",
  "title" : "No value defined for field name",
  "type" : "DDMFormValuesValidationException.RequiredValue"
}
```

El error aparece para ambos items:

```text
titulo-horizonte-rojo
titulo-el-portal
```

## Archivos relevantes

Script principal:

```text
tools/catalog/seed-catalog.ps1
```

Catalogo de prueba:

```text
tools/catalog/catalog.json
```

Imagenes:

```text
tools/catalog/images/horizonte-rojo/poster.png
tools/catalog/images/horizonte-rojo/fondo.png
tools/catalog/images/el-portal/poster.png
tools/catalog/images/el-portal/fondo.png
```

Payloads fallidos generados por el script:

```text
tools/catalog/last-failed-payload-titulo-horizonte-rojo.json
tools/catalog/last-failed-payload-titulo-el-portal.json
```

Estructura versionada:

```text
client-extensions/netflix-site-initializer/site-initializer/ddm-structures/group/titulo.xml
```

Taxonomias versionadas:

```text
client-extensions/netflix-site-initializer/site-initializer/taxonomy-vocabularies/group/
```

Bootstrap OSGi agregado para asegurar estructura/taxonomias/permisos:

```text
modules/netflix-catalog-bootstrap/
```

README del flujo:

```text
tools/catalog/README.md
```

Script de biseccion/debug agregado al repo:

```text
tools/catalog/debug-titulo.ps1
```

Version actual: v6 del diagnostico.

Uso recomendado:

```powershell
cd C:\POC-Netflix\POC-Liferay
.\tools\catalog\debug-titulo.ps1
```

Para contrastar contra la estructura que tiene contenidos existentes, correr:

```powershell
.\tools\catalog\debug-titulo.ps1 -StructureId 33666
```

Este script escribe los archivos de diagnostico en `tools/catalog/`:

```text
debug-structure.json
debug-reference-content.json
debug-payload-*.json
debug-response-*.json
debug-errors.txt
```

La v2 agrego:

```text
- Lectura del cuerpo real del error en PowerShell 5.1.
- Seccion 1b: idioma del sitio, idioma de company y accesibilidad de documentos de imagen.
- Seccion 1c: listado de Web Contents del sitio con su contentStructureId.
- Variante G: imagenes solo con id.
- Variante H: payload base con Accept-Language es-ES.
- Variante I: payload base sin header Accept-Language.
```

La v3 agrega:

```text
- Variantes J/K: renombran el campo clasificacion al nombre real del select en la estructura viva y mapean la opcion por label.
- Variante L: clon limpio del contenido manual.
- Caso observado: la estructura 33666 tiene un select con nombre interno tipo Select05014083 y opciones internas tipo Option16420715.
```

La v4 agrega:

```text
- Listado recursivo de nestedContentStructureFields para ver required internos del fieldset episodio.
- Muestra nestedContentFields del contenido de referencia.
- Variante M: clon limpio recursivo incluyendo nestedContentFields.
- Variante N: payload con fieldset/episodio de relleno y todos los campos internos completos.
- Guarda respuestas crudas de errores en debug-errors.txt.
```

La v5 agrega:

```text
- Remapeo automatico de nombres cuando una estructura copiada cambia nombres internos, por ejemplo sinopsis -> CopyOfsinopsis.
- El remapeo se aplica antes de cada variante y tambien recorre nestedContentFields si corresponden.
```

La v6 agrega:

```text
- Cuando una variante da 200 OK, imprime lo que Liferay guardo campo por campo.
- Marca valores vacios con <== VACIO para detectar que requerido se pierde.
- Guarda la respuesta completa de variantes exitosas en debug-response-<variante>.json.
```

## Estado git resumido

Estos paths estan sin trackear actualmente en la branch:

```text
?? client-extensions/netflix-site-initializer/site-initializer/ddm-structures/
?? client-extensions/netflix-site-initializer/site-initializer/taxonomy-vocabularies/
?? modules/netflix-catalog-bootstrap/
?? tools/
```

## Estructura Titulo esperada

La estructura `Titulo` esta versionada con `defaultLanguageId: en_US`.

Campos top-level:

```text
sinopsis
  type: text
  dataType: string
  localizable: true
  required: true

poster
  type: image
  dataType: image
  localizable: true
  required: true
  requiredDescription: true

fondo
  type: image
  dataType: image
  localizable: true
  required: true

anio
  type: numeric
  dataType: integer
  localizable: true
  required: true

clasificacion
  type: select
  dataType: string
  localizable: true
  required: true
  options:
    ATP -> ATP
    +13 -> Mas13
    +16 -> Mas16
    +18 -> Mas18
  predefinedValue: []

elenco
  type: text
  dataType: string
  localizable: true
  repeatable: true
  required: false

temporadas
  type: numeric
  dataType: integer
  localizable: true
  required: false

episodio
  type: fieldset
  dataType: string
  localizable: false
  repeatable: true
  required: false
```

Nested fields de `episodio`:

```text
episodioTemporada
episodioNumero
episodioNombre
episodioDuracion
```

Todos los nested fields son `required: false`.

## Catalogo actual

`tools/catalog/catalog.json` contiene dos items:

```json
[
  {
    "erc": "titulo-horizonte-rojo",
    "titulo": "Horizonte Rojo",
    "tipo": "Pelicula",
    "generos": ["Ciencia Ficcion", "Drama", "Aventura"],
    "sinopsis": "Una piloto de carga acepta una mision cerca de Marte y descubre una transmision que puede cambiar el futuro de la colonia.",
    "anio": 2026,
    "clasificacion": "+13",
    "elenco": ["Sofia Marquez", "Ivan Torres", "Nadia Lemos"],
    "poster": "images/horizonte-rojo/poster.png",
    "fondo": "images/horizonte-rojo/fondo.png"
  },
  {
    "erc": "titulo-el-portal",
    "titulo": "El Portal",
    "tipo": "Serie",
    "generos": ["Ciencia Ficcion", "Drama"],
    "sinopsis": "Una cientifica descubre una senal imposible y abre una investigacion que conecta ciudades, recuerdos y universos paralelos.",
    "anio": 2026,
    "clasificacion": "+16",
    "elenco": ["Laura Vega", "Mateo Ruiz", "Clara Sosa"],
    "poster": "images/el-portal/poster.png",
    "fondo": "images/el-portal/fondo.png",
    "temporadas": 1,
    "episodios": [
      {"temporada": 1, "numero": 1, "nombre": "La senal", "duracion": 48},
      {"temporada": 1, "numero": 2, "nombre": "Materia oscura", "duracion": 52}
    ]
  }
]
```

## APIs y descubrimientos previos

Probe de autenticacion con password correcta dio 200 para:

```text
/o/headless-admin-user/v1.0/my-user-account
/o/headless-delivery/v1.0/openapi.json
/o/headless-admin-site/v1.0/openapi.json
/o/headless-admin-taxonomy/v1.0/openapi.json
```

El site no se resolvia por:

```text
/o/headless-admin-site/v1.0/sites/netflix-poc -> 404
```

Pero se encontro via JSONWS:

```text
Id                    : 33503
Name                  : Netflix POC
DescriptiveName       : Netflix POC
Key                   : Netflix POC
FriendlyURL           : /netflix-poc
ExternalReferenceCode : netflix-poc
```

El endpoint de listado de estructuras por site falla en este entorno:

```text
GET /o/headless-delivery/v1.0/sites/33503/content-structures?pageSize=100 -> HTTP 400
```

Por eso se usa `-StructureId 34074`. El script intenta:

```text
GET /o/headless-delivery/v1.0/content-structures/34074
```

Si eso falla, usa una definicion local conocida para poder armar el payload.

## Taxonomias

El script resuelve categorias via:

```text
/o/headless-admin-taxonomy/v1.0/sites/33503/taxonomy-vocabularies?pageSize=100
/o/headless-admin-taxonomy/v1.0/taxonomy-vocabularies/<id>/taxonomy-categories?pageSize=200
```

Categorias disponibles detectadas en un momento:

```text
Drama (33679)
Ciencia Ficcion / Ciencia Ficcion con tilde mojibake (33686)
Comedia (33899)
Accion (33902)
Terror (33908)
Musical (33911)
Romance (33914)
Aventura (33917)
Animacion (33920)
```

Tipos detectados/usados:

```text
Pelicula -> 33683
Serie -> 33905
```

Importante: se decidio no crear categorias automaticamente salvo que se pase explicitamente `-CreateMissingCategories`, porque una corrida anterior creo una categoria duplicada `Ciencia Ficcion`.

## Cambios ya hechos en el script

1. Agregado `-Probe`.
2. Agregado soporte para `-SiteId`.
3. Agregado soporte para `-StructureId`.
4. Agregado fallback a estructura versionada si el endpoint de estructuras falla.
5. Agregado `-CreateMissingCategories`, pero por defecto NO crea categorias.
6. Normalizacion de nombres para comparar sin mayusculas, tildes y mojibake.
7. Upload de documentos corregido a multipart con partes:

```text
document
file
```

8. Upload de documentos usa nombre unico basado en ERC para evitar conflictos como `poster.png`.
9. Si falla un item, se guarda payload en:

```text
tools/catalog/last-failed-payload-<erc>.json
```

10. Agregado `-ContentLanguageId en_US`.
11. Agregado header:

```text
Accept-Language: en-US
```

12. Los fields localizables ahora mandan tambien:

```json
"contentFieldValue_i18n": {
  "en_US": { ... }
}
```

13. `clasificacion` se cambio a formato select DDM probable:

```json
"data": "[\"Mas13\"]",
"value": "Mas13"
```

14. Para peliculas ya no se manda `episodio`.
15. Para series el fieldset `episodio` ya no manda `data: ""`; usa el nombre del episodio.

## Errores anteriores ya resueltos o descartados

Error por categoria no encontrada:

```text
No se encontro la categoria 'Ciencia Ficcion'
```

Se resolvio normalizando nombres/tildes/mojibake. No se crean categorias por defecto.

Error por documento:

```text
Document not found in body
```

Se resolvio usando multipart con parte `document`.

Error por conflicto de filename:

```text
A document already exists with title poster.png
```

Se resolvio usando filename unico basado en ERC.

Error por campo `name`:

```text
Unable to get content field value for "name" for content structure 34074
```

Se comprobo que NO existe un campo `name` en la estructura. El campo `title` del Web Content se manda como propiedad top-level, no como content field.

Nota importante sobre el mensaje actual:

El error:

```text
No value defined for field name
```

es enganoso. En Liferay esa excepcion puede no mostrar el nombre real del campo requerido faltante. No necesariamente significa que falte un campo llamado `name`.

## Payload actual fallido: Horizonte Rojo

Path:

```text
tools/catalog/last-failed-payload-titulo-horizonte-rojo.json
```

Contenido actual:

```json
{
  "externalReferenceCode": "titulo-horizonte-rojo",
  "title": "Horizonte Rojo",
  "contentStructureId": 34074,
  "taxonomyCategoryIds": [33683, 33686, 33679, 33917],
  "contentFields": [
    {
      "name": "sinopsis",
      "contentFieldValue": {
        "data": "Una piloto de carga acepta una mision cerca de Marte y descubre una transmision que puede cambiar el futuro de la colonia."
      },
      "contentFieldValue_i18n": {
        "en_US": {
          "data": "Una piloto de carga acepta una mision cerca de Marte y descubre una transmision que puede cambiar el futuro de la colonia."
        }
      }
    },
    {
      "name": "poster",
      "contentFieldValue": {
        "image": {
          "id": 34150,
          "description": "titulo-horizonte-rojo-poster"
        }
      },
      "contentFieldValue_i18n": {
        "en_US": {
          "image": {
            "id": 34150,
            "description": "titulo-horizonte-rojo-poster"
          }
        }
      }
    },
    {
      "name": "fondo",
      "contentFieldValue": {
        "image": {
          "id": 34162,
          "description": "titulo-horizonte-rojo-fondo"
        }
      },
      "contentFieldValue_i18n": {
        "en_US": {
          "image": {
            "id": 34162,
            "description": "titulo-horizonte-rojo-fondo"
          }
        }
      }
    },
    {
      "name": "anio",
      "contentFieldValue": {
        "data": "2026"
      },
      "contentFieldValue_i18n": {
        "en_US": {
          "data": "2026"
        }
      }
    },
    {
      "name": "clasificacion",
      "contentFieldValue": {
        "data": "[\"Mas13\"]",
        "value": "Mas13"
      },
      "contentFieldValue_i18n": {
        "en_US": {
          "data": "[\"Mas13\"]",
          "value": "Mas13"
        }
      }
    },
    {
      "name": "elenco",
      "contentFieldValue": {
        "data": "Sofia Marquez"
      },
      "contentFieldValue_i18n": {
        "en_US": {
          "data": "Sofia Marquez"
        }
      }
    },
    {
      "name": "elenco",
      "contentFieldValue": {
        "data": "Ivan Torres"
      },
      "contentFieldValue_i18n": {
        "en_US": {
          "data": "Ivan Torres"
        }
      }
    },
    {
      "name": "elenco",
      "contentFieldValue": {
        "data": "Nadia Lemos"
      },
      "contentFieldValue_i18n": {
        "en_US": {
          "data": "Nadia Lemos"
        }
      }
    }
  ]
}
```

## Payload actual fallido: El Portal

Path:

```text
tools/catalog/last-failed-payload-titulo-el-portal.json
```

Resumen completo de contenido relevante:

```json
{
  "externalReferenceCode": "titulo-el-portal",
  "title": "El Portal",
  "contentStructureId": 34074,
  "taxonomyCategoryIds": [33905, 33686, 33679],
  "contentFields": [
    {
      "name": "sinopsis",
      "contentFieldValue": {
        "data": "Una cientifica descubre una senal imposible y abre una investigacion que conecta ciudades, recuerdos y universos paralelos."
      },
      "contentFieldValue_i18n": {
        "en_US": {
          "data": "Una cientifica descubre una senal imposible y abre una investigacion que conecta ciudades, recuerdos y universos paralelos."
        }
      }
    },
    {
      "name": "poster",
      "contentFieldValue": {
        "image": {
          "id": 34174,
          "description": "titulo-el-portal-poster"
        }
      },
      "contentFieldValue_i18n": {
        "en_US": {
          "image": {
            "id": 34174,
            "description": "titulo-el-portal-poster"
          }
        }
      }
    },
    {
      "name": "fondo",
      "contentFieldValue": {
        "image": {
          "id": 34186,
          "description": "titulo-el-portal-fondo"
        }
      },
      "contentFieldValue_i18n": {
        "en_US": {
          "image": {
            "id": 34186,
            "description": "titulo-el-portal-fondo"
          }
        }
      }
    },
    {
      "name": "anio",
      "contentFieldValue": {
        "data": "2026"
      },
      "contentFieldValue_i18n": {
        "en_US": {
          "data": "2026"
        }
      }
    },
    {
      "name": "clasificacion",
      "contentFieldValue": {
        "data": "[\"Mas16\"]",
        "value": "Mas16"
      },
      "contentFieldValue_i18n": {
        "en_US": {
          "data": "[\"Mas16\"]",
          "value": "Mas16"
        }
      }
    },
    {
      "name": "elenco",
      "contentFieldValue": {"data": "Laura Vega"},
      "contentFieldValue_i18n": {"en_US": {"data": "Laura Vega"}}
    },
    {
      "name": "elenco",
      "contentFieldValue": {"data": "Mateo Ruiz"},
      "contentFieldValue_i18n": {"en_US": {"data": "Mateo Ruiz"}}
    },
    {
      "name": "elenco",
      "contentFieldValue": {"data": "Clara Sosa"},
      "contentFieldValue_i18n": {"en_US": {"data": "Clara Sosa"}}
    },
    {
      "name": "temporadas",
      "contentFieldValue": {"data": "1"},
      "contentFieldValue_i18n": {"en_US": {"data": "1"}}
    },
    {
      "name": "episodio",
      "contentFieldValue": {"data": "La senal"},
      "nestedContentFields": [
        {
          "name": "episodioTemporada",
          "contentFieldValue": {"data": "1"},
          "contentFieldValue_i18n": {"en_US": {"data": "1"}}
        },
        {
          "name": "episodioNumero",
          "contentFieldValue": {"data": "1"},
          "contentFieldValue_i18n": {"en_US": {"data": "1"}}
        },
        {
          "name": "episodioNombre",
          "contentFieldValue": {"data": "La senal"},
          "contentFieldValue_i18n": {"en_US": {"data": "La senal"}}
        },
        {
          "name": "episodioDuracion",
          "contentFieldValue": {"data": "48"},
          "contentFieldValue_i18n": {"en_US": {"data": "48"}}
        }
      ]
    },
    {
      "name": "episodio",
      "contentFieldValue": {"data": "Materia oscura"},
      "nestedContentFields": [
        {
          "name": "episodioTemporada",
          "contentFieldValue": {"data": "1"},
          "contentFieldValue_i18n": {"en_US": {"data": "1"}}
        },
        {
          "name": "episodioNumero",
          "contentFieldValue": {"data": "2"},
          "contentFieldValue_i18n": {"en_US": {"data": "2"}}
        },
        {
          "name": "episodioNombre",
          "contentFieldValue": {"data": "Materia oscura"},
          "contentFieldValue_i18n": {"en_US": {"data": "Materia oscura"}}
        },
        {
          "name": "episodioDuracion",
          "contentFieldValue": {"data": "52"},
          "contentFieldValue_i18n": {"en_US": {"data": "52"}}
        }
      ]
    }
  ]
}
```

## Hipotesis abiertas para Claude

1. Comparar contra un Web Content creado manualmente:
   - Obtener por Headless un contenido existente de estructura `Titulo`.
   - Revisar exactamente como Liferay devuelve `poster`, `fondo`, `clasificacion`, `anio` y localizaciones.
   - Endpoint probable:

```text
GET /o/headless-delivery/v1.0/content-structures/34074/structured-contents?pageSize=100
```

2. Validar si Headless espera `contentFieldValue_i18n` o solo `contentFieldValue`, y si el locale debe ser `en-US` o `en_US` en el map.

3. Validar formato real del select:
   - Puede ser `"data": "[\"Mas13\"]"`.
   - Puede ser `"data": "Mas13"`.
   - Puede requerir solo `contentFieldValue.data`, no `value`.

4. Validar formato real de imagen:
   - Actualmente se manda:

```json
{
  "contentFieldValue": {
    "image": {
      "id": 34150,
      "description": "titulo-horizonte-rojo-poster"
    }
  }
}
```

   - Puede requerir un objeto de documento mas completo, o `contentFieldValue.document` en vez de `image`, segun version.

5. Validar `requiredDescription: true` en `poster`.
   - Se manda `description`, pero tal vez Liferay requiere descripcion i18n o algun campo interno del image JSON.

6. Validar si `PUT by-external-reference-code` para crear nuevo contenido se comporta distinto a `POST /sites/{siteId}/structured-contents`.
   - Probar primero con `POST` manual minimo podria aislar si el problema es del endpoint PUT/upsert.

7. Validar si los nombres de campo reales de la estructura en Liferay difieren de la estructura versionada local.
   - El script hace fallback local si no puede leer estructura, asi que podria estar usando nombres correctos por suerte, pero conviene confirmar con `GET /content-structures/34074`.

8. Validar si la estructura tiene otro campo requerido invisible/no versionado en Liferay local.
   - Importante porque hay contenido creado a mano funcionando.

## Recomendacion de siguiente debugging

La forma mas rapida de salir del ciclo de prueba/error:

1. Crear o usar un Web Content `Titulo` hecho manualmente que funcione.
2. Obtenerlo via Headless:

```powershell
$base = "http://localhost:8080"
$pair = "test@liferay.com:<PASSWORD>"
$token = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pair))
$headers = @{ Authorization = "Basic $token"; Accept = "application/json" }
Invoke-RestMethod -Headers $headers -Uri "$base/o/headless-delivery/v1.0/content-structures/34074/structured-contents?pageSize=100" | ConvertTo-Json -Depth 100
```

3. Copiar un item real devuelto y comparar `contentFields` contra `last-failed-payload-*.json`.
4. Ajustar el serializer del script para imitar exactamente el formato que devuelve Liferay.

## Nota de seguridad

No guardar passwords reales en este archivo ni commitear credenciales. El script puede pedir password interactiva o leer `LIFERAY_PASSWORD` local.
