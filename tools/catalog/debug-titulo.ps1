<#
  Diagnostico para "No value defined for field name" (DDMFormValuesValidationException.RequiredValue)
  Uso (desde C:\POC-Netflix\POC-Liferay):
    .\tools\catalog\debug-titulo.ps1
  Todo lo que crea usa ERC "debug-*" y se borra al final.
#>
param(
  [string]$BaseUrl     = "http://localhost:8080",
  [long]  $SiteId      = 33503,
  [long]  $StructureId = 34074,
  [string]$User        = "test@liferay.com",
  [string]$Language    = "en-US",
  [string]$PayloadPath = "tools/catalog/last-failed-payload-titulo-horizonte-rojo.json"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$outDir = $PSScriptRoot

if ([IO.Path]::IsPathRooted($PayloadPath)) {
  $resolvedPayloadPath = $PayloadPath
}
elseif (Test-Path -LiteralPath $PayloadPath) {
  $resolvedPayloadPath = (Resolve-Path -LiteralPath $PayloadPath).Path
}
else {
  $resolvedPayloadPath = Join-Path $PSScriptRoot ([IO.Path]::GetFileName($PayloadPath))
}

if (-not (Test-Path -LiteralPath $resolvedPayloadPath)) {
  throw "No existe el payload: $resolvedPayloadPath"
}

$pass = $env:LIFERAY_PASSWORD
if (-not $pass) {
  $sec  = Read-Host "Password de $User" -AsSecureString
  $pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

$token = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${User}:$pass"))
$headers = @{
  Authorization = "Basic $token"
  Accept = "application/json"
  "Accept-Language" = $Language
}

function Invoke-Lr($Method, $Path, $Body = $null) {
  $uri = "$BaseUrl$Path"

  try {
    $params = @{
      Method = $Method
      Uri = $uri
      Headers = $headers
      UseBasicParsing = $true
    }

    if ($Body) {
      $params.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 100))
      $params.ContentType = "application/json; charset=utf-8"
    }

    $response = Invoke-WebRequest @params
    $json = $null

    if ($response.Content) {
      $json = $response.Content | ConvertFrom-Json
    }

    return [pscustomobject]@{
      Status = [int]$response.StatusCode
      Json = $json
      Raw = $response.Content
    }
  }
  catch {
    $response = $_.Exception.Response

    if (-not $response) {
      throw
    }

    $raw = $_.ErrorDetails.Message

    if (-not $raw) {
      $stream = $response.GetResponseStream()

      if ($stream.CanSeek) {
        $stream.Position = 0
      }

      $raw = (New-Object IO.StreamReader($stream)).ReadToEnd()
    }

    $json = $null

    try {
      $json = $raw | ConvertFrom-Json
    }
    catch {
      $json = $null
    }

    return [pscustomobject]@{
      Status = [int]$response.StatusCode
      Json = $json
      Raw = $raw
    }
  }
}

function Copy-Deep($Object) {
  $Object | ConvertTo-Json -Depth 100 | ConvertFrom-Json
}

function Remove-I18n($Fields) {
  foreach ($field in $Fields) {
    $field.PSObject.Properties.Remove("contentFieldValue_i18n")

    if ($field.nestedContentFields) {
      Remove-I18n $field.nestedContentFields
    }
  }
}

function Resolve-DebugStructureField($FieldName, $StructureFields) {
  foreach ($structureField in @($StructureFields)) {
    if ($structureField.name -eq $FieldName) {
      return $structureField
    }
  }

  foreach ($structureField in @($StructureFields)) {
    if ($structureField.name -like "*$FieldName") {
      return $structureField
    }
  }

  return $null
}

function Update-PayloadFieldNames($Fields, $StructureFields) {
  foreach ($field in @($Fields)) {
    if (-not $field) {
      continue
    }

    $structureField = Resolve-DebugStructureField `
      -FieldName $field.name `
      -StructureFields $StructureFields

    if ($structureField) {
      $field.name = $structureField.name

      if ($field.nestedContentFields -and $structureField.nestedContentStructureFields) {
        Update-PayloadFieldNames `
          -Fields $field.nestedContentFields `
          -StructureFields $structureField.nestedContentStructureFields
      }
    }
  }
}

$created = New-Object System.Collections.ArrayList
$results = New-Object System.Collections.ArrayList
$debugErrorsPath = Join-Path $outDir "debug-errors.txt"

Remove-Item -LiteralPath $debugErrorsPath -ErrorAction SilentlyContinue

function Test-Variant($Name, $Payload, $Lang = $null) {
  $erc = "debug-" + ([guid]::NewGuid().ToString("N").Substring(0, 8))

  $Payload | Add-Member -NotePropertyName externalReferenceCode -NotePropertyValue $erc -Force
  $Payload | Add-Member -NotePropertyName title -NotePropertyValue "DEBUG $Name" -Force
  $Payload | Add-Member -NotePropertyName contentStructureId -NotePropertyValue $StructureId -Force

  if ($structureResponse -and $structureResponse.Status -eq 200 -and $Payload.contentFields) {
    Update-PayloadFieldNames `
      -Fields $Payload.contentFields `
      -StructureFields $structureResponse.Json.contentStructureFields
  }

  $previousLanguage = $headers["Accept-Language"]

  if ($Lang -eq "none") {
    $headers.Remove("Accept-Language")
  }
  elseif ($Lang) {
    $headers["Accept-Language"] = $Lang
  }

  $response = Invoke-Lr POST "/o/headless-delivery/v1.0/sites/$SiteId/structured-contents" $Payload
  $headers["Accept-Language"] = $previousLanguage

  $message = if ($response.Status -lt 300) {
    "OK"
  }
  elseif ($response.Json -and $response.Json.title) {
    "$($response.Json.title) [$($response.Json.type)]"
  }
  else {
    $response.Raw
  }

  if ($response.Status -lt 300 -and $response.Json.id) {
    [void]$created.Add($response.Json.id)

    $response.Json |
      ConvertTo-Json -Depth 100 |
      Set-Content -LiteralPath (Join-Path $outDir "debug-response-$Name.json") -Encoding UTF8

    Write-Host "`n  [$Name] lo que Liferay guardo:" -ForegroundColor Green

    foreach ($contentField in @($response.Json.contentFields)) {
      $value = $contentField.contentFieldValue
      $shown = if ($value.image) {
        "image id=$($value.image.id) desc='$($value.image.description)'"
      }
      else {
        $value | ConvertTo-Json -Depth 5 -Compress
      }

      $isEmpty = (-not $value) -or ((-not $value.image) -and [string]::IsNullOrWhiteSpace([string]$value.data))
      $flag = if ($isEmpty) { "  <== VACIO" } else { "" }

      Write-Host ("    {0,-22} {1}{2}" -f $contentField.name, $shown, $flag)
    }
  }
  else {
    "--- $Name ---`n$($response.Raw)`n" | Add-Content -LiteralPath $debugErrorsPath -Encoding UTF8
  }

  [void]$results.Add([pscustomobject]@{
    Variante = $Name
    HTTP = $response.Status
    Resultado = $message
  })

  $Payload | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath (Join-Path $outDir "debug-payload-$Name.json") -Encoding UTF8
}

Write-Host "`n=== 1. Estructura $StructureId (como la ve Liferay) ===" -ForegroundColor Cyan

$structureResponse = Invoke-Lr GET "/o/headless-delivery/v1.0/content-structures/$StructureId"

if ($structureResponse.Status -eq 200) {
  $structureResponse.Raw | Set-Content -LiteralPath (Join-Path $outDir "debug-structure.json") -Encoding UTF8
  "availableLanguages: " + ($structureResponse.Json.availableLanguages -join ", ")

  function Show-StructureField($Fields, $Indent) {
    foreach ($field in @($Fields)) {
      "{0}{1,-18} type={2,-10} dataType={3,-8} required={4} localizable={5} repeatable={6}" -f `
        $Indent, $field.name, $field.inputControl, $field.dataType, $field.required, $field.localizable, $field.repeatable

      if ($field.options) {
        "$Indent                   options: " + (($field.options | ForEach-Object { "$($_.label)=$($_.value)" }) -join ", ")
      }

      if ($field.nestedContentStructureFields) {
        Show-StructureField $field.nestedContentStructureFields "$Indent    -> "
      }
    }
  }

  Show-StructureField $structureResponse.Json.contentStructureFields ""
}
else {
  "GET estructura fallo: HTTP $($structureResponse.Status) $($structureResponse.Raw)"
}

Write-Host "`n=== 1b. Idioma del sitio y documentos ===" -ForegroundColor Cyan

$groupResponse = Invoke-Lr GET "/api/jsonws/group/get-group?groupId=$SiteId"

if ($groupResponse.Status -eq 200) {
  "typeSettings del sitio:"
  ($groupResponse.Json.typeSettings -split "`n") |
    Where-Object { $_ -match "language|locale|inherit" } |
    ForEach-Object { "  $_" }

  "  (si no aparece languageId, el sitio hereda el idioma por defecto de la instancia)"

  if ($groupResponse.Json.companyId) {
    $companyResponse = Invoke-Lr GET "/api/jsonws/company/get-company-by-id?companyId=$($groupResponse.Json.companyId)"

    if ($companyResponse.Status -eq 200) {
      "  idioma por defecto de la instancia (company): $($companyResponse.Json.defaultLanguageId)"
    }
    else {
      "  GET company fallo: HTTP $($companyResponse.Status) $($companyResponse.Raw)"
    }
  }
}
else {
  "GET group fallo: HTTP $($groupResponse.Status) $($groupResponse.Raw)"
}

$basePayload = Get-Content -Raw -Encoding UTF8 $resolvedPayloadPath | ConvertFrom-Json

foreach ($name in "poster", "fondo") {
  $image = ($basePayload.contentFields | Where-Object name -eq $name | Select-Object -First 1).contentFieldValue.image

  if (-not $image -or -not $image.id) {
    "  $name -> sin image.id en el payload"

    continue
  }

  $documentResponse = Invoke-Lr GET "/o/headless-delivery/v1.0/documents/$($image.id)"

  if ($documentResponse.Status -eq 200) {
    "  $name -> doc $($image.id): OK title='$($documentResponse.Json.title)' siteId=$($documentResponse.Json.siteId) mime=$($documentResponse.Json.encodingFormat)"
  }
  else {
    "  $name -> doc $($image.id): HTTP $($documentResponse.Status) $($documentResponse.Raw)"
  }
}

Write-Host "`n=== 1c. Web contents del sitio y su estructura ===" -ForegroundColor Cyan

$siteContentsResponse = Invoke-Lr GET "/o/headless-delivery/v1.0/sites/$SiteId/structured-contents?pageSize=50&flatten=true"

if ($siteContentsResponse.Status -eq 200) {
  "totalCount: $($siteContentsResponse.Json.totalCount)"
  $siteContentsResponse.Json.items | ForEach-Object {
    "  id=$($_.id) structure=$($_.contentStructureId) title='$($_.title)'"
  }
}
else {
  "Listado fallo: HTTP $($siteContentsResponse.Status) $($siteContentsResponse.Raw)"
}

Write-Host "`n=== 2. Contenidos existentes de la estructura ===" -ForegroundColor Cyan

$listResponse = Invoke-Lr GET "/o/headless-delivery/v1.0/content-structures/$StructureId/structured-contents?pageSize=20&nestedFields=embedded"
$reference = $null

if ($listResponse.Status -eq 200 -and $listResponse.Json.items) {
  $reference = $listResponse.Json.items | Where-Object { $_.externalReferenceCode -notlike "debug-*" } | Select-Object -First 1
  $reference | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath (Join-Path $outDir "debug-reference-content.json") -Encoding UTF8

  "Referencia: id=$($reference.id) title='$($reference.title)' (guardado en tools/catalog/debug-reference-content.json)"

  function Show-ContentField($Fields, $Indent) {
    foreach ($field in @($Fields)) {
      "{0}{1,-16} {2}" -f $Indent, $field.name, ($field.contentFieldValue | ConvertTo-Json -Depth 10 -Compress)

      if ($field.nestedContentFields) {
        Show-ContentField $field.nestedContentFields "$Indent    -> "
      }
    }
  }

  Show-ContentField $reference.contentFields "  "
}
else {
  "No hay contenidos o el GET fallo: HTTP $($listResponse.Status) $($listResponse.Raw)"
}

Write-Host "`n=== 3. Probando variantes (POST, sin PUT/upsert) ===" -ForegroundColor Cyan

if ($reference) {
  Test-Variant "A-clon-manual" ([pscustomobject]@{
    contentFields = (Copy-Deep $reference.contentFields)
  })
}

$basePayload = Get-Content -Raw -Encoding UTF8 $resolvedPayloadPath | ConvertFrom-Json

Test-Variant "B-script-original" (Copy-Deep $basePayload)

$withoutI18n = Copy-Deep $basePayload
Remove-I18n $withoutI18n.contentFields
Test-Variant "C-sin-i18n" $withoutI18n

$selectPlain = Copy-Deep $withoutI18n
foreach ($field in $selectPlain.contentFields | Where-Object name -eq "clasificacion") {
  $value = $field.contentFieldValue.value

  if (-not $value) {
    $value = ($field.contentFieldValue.data -replace '[\[\]"\\]', '')
  }

  $field.contentFieldValue = [pscustomobject]@{
    data = $value
  }
}

Test-Variant "D-sin-i18n-select-plano" $selectPlain

$selectLabel = Copy-Deep $selectPlain
foreach ($field in $selectLabel.contentFields | Where-Object name -eq "clasificacion") {
  $field.contentFieldValue.data = ($field.contentFieldValue.data -replace '^Mas', '+')
}

Test-Variant "E-select-label" $selectLabel

$imageOnlyId = Copy-Deep $selectPlain

foreach ($field in $imageOnlyId.contentFields | Where-Object { $_.name -in "poster", "fondo" }) {
  $field.contentFieldValue = [pscustomobject]@{
    image = [pscustomobject]@{
      id = $field.contentFieldValue.image.id
    }
  }
}

Test-Variant "G-imagen-solo-id" $imageOnlyId

Test-Variant "H-locale-es-ES" (Copy-Deep $selectPlain) "es-ES"
Test-Variant "I-sin-locale" (Copy-Deep $selectPlain) "none"

if ($reference) {
  $mixed = Copy-Deep $selectPlain

  foreach ($name in "poster", "fondo", "clasificacion", "anio") {
    $source = $reference.contentFields | Where-Object name -eq $name | Select-Object -First 1
    $target = $mixed.contentFields | Where-Object name -eq $name | Select-Object -First 1

    if ($source -and $target) {
      $target.contentFieldValue = Copy-Deep $source.contentFieldValue
    }
  }

  Test-Variant "F-mixto-campos-de-ref" $mixed
}

function Get-DebugDisplayValue($Value) {
  if ($null -eq $Value) {
    return ""
  }

  if ($Value -is [string]) {
    return $Value
  }

  foreach ($name in "en_US", "en-US", "es_ES", "es-ES", "name", "label", "value") {
    $property = $Value.PSObject.Properties[$name]

    if ($property -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
      return [string]$property.Value
    }
  }

  return [string]$Value
}

function ConvertTo-ClassificationLabel($Value) {
  $text = [string]$Value
  $text = $text -replace '[\[\]"\\]', ""

  if ($text -match '^Mas(\d+)$') {
    return "+$($Matches[1])"
  }

  return $text
}

function Find-SelectFieldForLabel($Fields, $Label) {
  foreach ($field in @($Fields)) {
    foreach ($option in @($field.options)) {
      if ((Get-DebugDisplayValue $option.label) -eq $Label) {
        return $field
      }
    }
  }

  return $null
}

function Set-MappedSelect($Payload, $Mode, $SelectField) {
  foreach ($field in $Payload.contentFields | Where-Object name -eq "clasificacion") {
    $rawValue = $field.contentFieldValue.value

    if ([string]::IsNullOrWhiteSpace([string]$rawValue)) {
      $rawValue = $field.contentFieldValue.data
    }

    $label = ConvertTo-ClassificationLabel $rawValue
    $option = $SelectField.options |
      Where-Object { (Get-DebugDisplayValue $_.label) -eq $label } |
      Select-Object -First 1

    if (-not $option) {
      Write-Host "No se encontro opcion para '$label' en $($SelectField.name)."

      continue
    }

    $optionValue = Get-DebugDisplayValue $option.value
    $field.name = $SelectField.name

    if ($Mode -eq "value") {
      $field.contentFieldValue = [pscustomobject]@{
        data = $optionValue
      }
    }
    else {
      $field.contentFieldValue = [pscustomobject]@{
        data = $label
        value = $optionValue
      }
    }
  }

  return $Payload
}

$classificationSelectField = $null

if ($structureResponse.Status -eq 200) {
  $classificationSelectField = Find-SelectFieldForLabel `
    -Fields $structureResponse.Json.contentStructureFields `
    -Label "+13"
}

if ($classificationSelectField) {
  Write-Host "Select detectado en la estructura: $($classificationSelectField.name)"

  Test-Variant "J-select-mapeado-value" (Set-MappedSelect (Copy-Deep $selectPlain) "value" $classificationSelectField)
  Test-Variant "K-select-mapeado-como-GET" (Set-MappedSelect (Copy-Deep $selectPlain) "label" $classificationSelectField)
}
else {
  Write-Host "No se detecto un select con opcion '+13' en la estructura $StructureId; se omiten J/K."
}

if ($reference) {
  $cleanFields = @()

  foreach ($field in @($reference.contentFields)) {
    $value = $field.contentFieldValue
    $contentFieldValue = $null

    if ($value.image -and $value.image.id) {
      $contentFieldValue = [pscustomobject]@{
        image = [pscustomobject]@{
          id = $value.image.id
        }
      }
    }
    elseif (-not [string]::IsNullOrWhiteSpace([string]$value.data)) {
      $contentFieldValue = [pscustomobject]@{
        data = [string]$value.data
      }

      if ($value.value) {
        $contentFieldValue | Add-Member -NotePropertyName value -NotePropertyValue $value.value
      }
    }

    if ($contentFieldValue) {
      $cleanFields += [pscustomobject]@{
        name = $field.name
        contentFieldValue = $contentFieldValue
      }
    }
  }

  Test-Variant "L-clon-limpio" ([pscustomobject]@{
    contentFields = $cleanFields
  })
}

function New-CleanContentFields($Fields) {
  $result = @()

  foreach ($field in @($Fields)) {
    $outputField = [pscustomobject]@{
      name = $field.name
    }

    $value = $field.contentFieldValue

    if ($value -and $value.image -and $value.image.id) {
      $image = [pscustomobject]@{
        id = $value.image.id
      }

      if ($value.image.description) {
        $image | Add-Member -NotePropertyName description -NotePropertyValue ([string]$value.image.description)
      }

      $outputField | Add-Member -NotePropertyName contentFieldValue -NotePropertyValue ([pscustomobject]@{
        image = $image
      })
    }
    elseif ($value -and -not [string]::IsNullOrWhiteSpace([string]$value.data)) {
      $contentFieldValue = [pscustomobject]@{
        data = [string]$value.data
      }

      if ($value.value) {
        $contentFieldValue | Add-Member -NotePropertyName value -NotePropertyValue $value.value
      }

      $outputField | Add-Member -NotePropertyName contentFieldValue -NotePropertyValue $contentFieldValue
    }

    if ($field.nestedContentFields) {
      $outputField | Add-Member -NotePropertyName nestedContentFields -NotePropertyValue @(New-CleanContentFields $field.nestedContentFields)
    }

    if ($outputField.PSObject.Properties.Count -gt 1) {
      $result += $outputField
    }
  }

  return ,$result
}

if ($reference) {
  Test-Variant "M-clon-con-nested" ([pscustomobject]@{
    contentFields = (New-CleanContentFields $reference.contentFields)
  })
}

function New-DummyStructuredField($StructureField) {
  $field = [pscustomobject]@{
    name = $StructureField.name
  }

  if ($StructureField.nestedContentStructureFields) {
    $field | Add-Member -NotePropertyName nestedContentFields -NotePropertyValue @(
      $StructureField.nestedContentStructureFields | ForEach-Object {
        New-DummyStructuredField $_
      }
    )
  }
  else {
    $value = if ($StructureField.options) {
      Get-DebugDisplayValue $StructureField.options[0].value
    }
    elseif ($StructureField.dataType -in "integer", "number", "double", "long") {
      "1"
    }
    else {
      "test"
    }

    $field | Add-Member -NotePropertyName contentFieldValue -NotePropertyValue ([pscustomobject]@{
      data = $value
    })
  }

  return $field
}

$firstFieldset = $null

if ($structureResponse.Status -eq 200) {
  $firstFieldset = $structureResponse.Json.contentStructureFields |
    Where-Object { $_.nestedContentStructureFields } |
    Select-Object -First 1
}

if ($firstFieldset -and $classificationSelectField) {
  $withDummyEpisode = Set-MappedSelect (Copy-Deep $selectPlain) "value" $classificationSelectField
  $withDummyEpisode.contentFields = @(
    $withDummyEpisode.contentFields | Where-Object { $_.name -ne $firstFieldset.name }
  ) + @(
    New-DummyStructuredField $firstFieldset
  )

  Test-Variant "N-con-episodio-relleno" $withDummyEpisode
}

Write-Host "`n=== 4. Resultados ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize -Wrap

foreach ($id in $created) {
  [void](Invoke-Lr DELETE "/o/headless-delivery/v1.0/structured-contents/$id")
}

if ($created.Count) {
  "Borrados $($created.Count) contenidos de prueba."
}

"Archivos generados en tools/catalog/: debug-structure.json, debug-reference-content.json y debug-payload-*.json"
