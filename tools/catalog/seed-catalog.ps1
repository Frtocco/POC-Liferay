[CmdletBinding()]
param(
	[string]$BaseUrl = "http://localhost:8080",
	[string]$UserName = "test@liferay.com",
	[string]$Password = "",
	[string]$SiteExternalReferenceCode = "netflix-poc",
	[string]$ContentLanguageId = "en_US",
	[long]$SiteId = 0,
	[long]$StructureId = 0,
	[string]$CatalogPath = "",
	[string]$StructureName = "Titulo",
	[switch]$DryRun,
	[switch]$Probe,
	[switch]$SkipImages,
	[switch]$CreateMissingCategories,
	[string]$TmdbApiKey = "",
	[string]$TmdbLanguage = "es-ES",
	[switch]$RefreshTmdbImages
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

trap {
	$lineNumber = $_.InvocationInfo.ScriptLineNumber
	$line = ($_.InvocationInfo.Line -replace "\s+", " ").Trim()

	Write-Error "seed-catalog.ps1 fallo en linea ${lineNumber}: $($_.Exception.Message) :: $line"
	exit 1
}

Add-Type -AssemblyName System.Net.Http

# Configuracion local por desarrollador (no se commitea). Ver .env.example.
# Las variables ya definidas en la sesion tienen prioridad sobre el archivo.
$envFile = Join-Path $PSScriptRoot ".env.local"

if (Test-Path -LiteralPath $envFile) {
	foreach ($envLine in Get-Content -LiteralPath $envFile -Encoding UTF8) {
		$trimmedLine = $envLine.Trim()

		if (-not $trimmedLine -or $trimmedLine.StartsWith("#")) {
			continue
		}

		$separatorIndex = $trimmedLine.IndexOf("=")

		if ($separatorIndex -lt 1) {
			continue
		}

		$envKey = $trimmedLine.Substring(0, $separatorIndex).Trim()
		$envValue = $trimmedLine.Substring($separatorIndex + 1).Trim().Trim('"')

		if ($envValue -and -not [Environment]::GetEnvironmentVariable($envKey)) {
			[Environment]::SetEnvironmentVariable($envKey, $envValue, "Process")
		}
	}
}

if (-not $PSBoundParameters.ContainsKey("BaseUrl") -and $env:LIFERAY_BASE_URL) {
	$BaseUrl = $env:LIFERAY_BASE_URL
}

if (-not $PSBoundParameters.ContainsKey("UserName") -and $env:LIFERAY_USER) {
	$UserName = $env:LIFERAY_USER
}

if (-not $PSBoundParameters.ContainsKey("Password") -and $env:LIFERAY_PASSWORD) {
	$Password = $env:LIFERAY_PASSWORD
}

if (-not $PSBoundParameters.ContainsKey("SiteExternalReferenceCode") -and $env:LIFERAY_SITE_ERC) {
	$SiteExternalReferenceCode = $env:LIFERAY_SITE_ERC
}

if (-not $PSBoundParameters.ContainsKey("ContentLanguageId") -and $env:LIFERAY_CONTENT_LANGUAGE_ID) {
	$ContentLanguageId = $env:LIFERAY_CONTENT_LANGUAGE_ID
}

if ($SiteId -eq 0 -and $env:LIFERAY_SITE_ID) {
	$SiteId = [long]$env:LIFERAY_SITE_ID
}

if ($StructureId -eq 0 -and $env:LIFERAY_STRUCTURE_ID) {
	$StructureId = [long]$env:LIFERAY_STRUCTURE_ID
}

if ([string]::IsNullOrWhiteSpace($TmdbApiKey) -and $env:TMDB_API_KEY) {
	$TmdbApiKey = $env:TMDB_API_KEY
}

# TMDB exige TLS 1.2; PowerShell 5.1 no siempre lo habilita por defecto.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

if ([string]::IsNullOrWhiteSpace($CatalogPath)) {
	$CatalogPath = Join-Path $PSScriptRoot "catalog.json"
}

if ([string]::IsNullOrWhiteSpace($Password)) {
	$securePassword = Read-Host "Password de Liferay para $UserName" -AsSecureString
	$Password = [Net.NetworkCredential]::new("", $securePassword).Password
}

$BaseUrl = $BaseUrl.TrimEnd("/")
$script:AcceptLanguage = $ContentLanguageId.Replace("_", "-")
$script:BasicToken = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${UserName}:${Password}"))
$script:JsonHeaders = @{
	Accept = "application/json"
	"Accept-Language" = $script:AcceptLanguage
	Authorization = "Basic $script:BasicToken"
}

function ConvertTo-NormalizedName {
	param([AllowNull()][string]$Value)

	if ([string]::IsNullOrWhiteSpace($Value)) {
		return ""
	}

	$normalized = (ConvertFrom-MojibakeText -Value $Value).Trim().ToLowerInvariant().Normalize([Text.NormalizationForm]::FormD)

	return ($normalized -replace "\p{Mn}", "")
}

function ConvertFrom-MojibakeText {
	param([AllowNull()][string]$Value)

	if ([string]::IsNullOrWhiteSpace($Value)) {
		return $Value
	}

	if ($Value -notmatch "[ÃÂ]") {
		return $Value
	}

	try {
		$bytes = [Text.Encoding]::GetEncoding(1252).GetBytes($Value)
		$decoded = [Text.Encoding]::UTF8.GetString($bytes)

		if (-not [string]::IsNullOrWhiteSpace($decoded)) {
			return $decoded
		}
	}
	catch {
		return $Value
	}

	return $Value
}

function ConvertTo-ExternalReferenceCodeSegment {
	param([AllowNull()][string]$Value)

	$normalized = ConvertTo-NormalizedName -Value $Value
	$normalized = $normalized -replace "[^a-z0-9]+", "-"
	$normalized = $normalized.Trim("-")

	if ([string]::IsNullOrWhiteSpace($normalized)) {
		return "category"
	}

	return $normalized
}

function Get-ObjectProperty {
	param(
		[AllowNull()]$Object,
		[string]$Name
	)

	if ($null -eq $Object) {
		return $null
	}

	$property = $Object.PSObject.Properties[$Name]

	if ($null -eq $property) {
		return $null
	}

	return $property.Value
}

function Get-FirstObjectProperty {
	param(
		[AllowNull()]$Object,
		[string[]]$Names
	)

	foreach ($name in $Names) {
		$value = Get-ObjectProperty -Object $Object -Name $name

		if ($null -ne $value) {
			return $value
		}
	}

	return $null
}

function Get-RequiredObjectProperty {
	param(
		[AllowNull()]$Object,
		[string[]]$Names,
		[string]$Context
	)

	$value = Get-FirstObjectProperty -Object $Object -Names $Names

	if ($null -ne $value) {
		return $value
	}

	$availableProperties = @()

	if ($null -ne $Object) {
		$availableProperties = $Object.PSObject.Properties.Name
	}

	throw "No se encontro ninguna propiedad ($($Names -join ', ')) en $Context. Propiedades disponibles: $($availableProperties -join ', ')"
}

function ConvertTo-ObjectArray {
	param([AllowNull()]$Value)

	if ($null -eq $Value) {
		return @()
	}

	if ($Value -is [System.Array]) {
		return @($Value | Where-Object { $null -ne $_ })
	}

	return @($Value)
}

function Get-CollectionItems {
	param(
		[AllowNull()]$Response,
		[string[]]$ItemPropertyNames = @("items")
	)

	if ($null -eq $Response) {
		return @()
	}

	foreach ($itemPropertyName in $ItemPropertyNames) {
		$items = Get-ObjectProperty -Object $Response -Name $itemPropertyName

		if ($null -ne $items) {
			return ConvertTo-ObjectArray -Value $items
		}
	}

	if ($Response -is [System.Array]) {
		return ConvertTo-ObjectArray -Value $Response
	}

	return @()
}

function ConvertFrom-LocalizedXmlText {
	param([AllowNull()][string]$Value)

	if ([string]::IsNullOrWhiteSpace($Value)) {
		return ""
	}

	$trimmedValue = $Value.Trim()

	if (-not $trimmedValue.StartsWith("<?xml")) {
		return $Value
	}

	try {
		[xml]$xml = $trimmedValue
		$firstElement = $xml.DocumentElement.ChildNodes | Select-Object -First 1

		if ($null -ne $firstElement -and -not [string]::IsNullOrWhiteSpace($firstElement.InnerText)) {
			return $firstElement.InnerText
		}
	}
	catch {
		return $Value
	}

	return $Value
}

function Get-DisplayText {
	param([AllowNull()]$Value)

	if ($null -eq $Value) {
		return ""
	}

	if ($Value -is [string]) {
		return ConvertFrom-MojibakeText -Value (ConvertFrom-LocalizedXmlText -Value $Value)
	}

	foreach ($name in @("en_US", "en-US", "es_ES", "es-ES", "name", "label", "value")) {
		$propertyValue = Get-ObjectProperty -Object $Value -Name $name

		if ($null -ne $propertyValue -and -not [string]::IsNullOrWhiteSpace([string]$propertyValue)) {
			return ConvertFrom-MojibakeText -Value (ConvertFrom-LocalizedXmlText -Value ([string]$propertyValue))
		}
	}

	return ConvertFrom-MojibakeText -Value (ConvertFrom-LocalizedXmlText -Value ([string]$Value))
}

function Join-ApiPath {
	param([string]$Path)

	if ($Path.StartsWith("http")) {
		return $Path
	}

	return "$BaseUrl$Path"
}

function Invoke-LiferayJson {
	param(
		[ValidateSet("GET", "POST", "PUT", "PATCH", "DELETE")]
		[string]$Method,
		[string]$Path,
		[AllowNull()]$Body = $null,
		[switch]$AllowNotFound
	)

	$uri = Join-ApiPath -Path $Path
	$params = @{
		Headers = $script:JsonHeaders
		Method = $Method
		Uri = $uri
	}

	if ($null -ne $Body) {
		# PowerShell 5.1 manda los strings como ISO-8859-1: se envian bytes UTF-8 explicitos
		$params.ContentType = "application/json; charset=utf-8"
		$params.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 100))
	}

	try {
		return Invoke-RestMethod @params
	}
	catch {
		$response = $_.Exception.Response
		$statusCode = $null
		$responseBody = ""

		if ($_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($_.ErrorDetails.Message)) {
			$responseBody = $_.ErrorDetails.Message
		}

		if ($null -ne $response) {
			$statusCode = [int]$response.StatusCode

			if ([string]::IsNullOrWhiteSpace($responseBody)) {
				$stream = $response.GetResponseStream()

				if ($null -ne $stream) {
					if ($stream.CanSeek) {
						$stream.Position = 0
					}

					$reader = New-Object IO.StreamReader($stream)

					try {
						$responseBody = $reader.ReadToEnd()
					}
					finally {
						$reader.Dispose()
					}
				}
			}
		}

		if ($AllowNotFound -and $statusCode -eq 404) {
			return $null
		}

		throw "HTTP $statusCode $Method $uri failed. $responseBody"
	}
}

function Test-LiferayEndpoint {
	param(
		[string]$Label,
		[string]$Path
	)

	$uri = Join-ApiPath -Path $Path

	try {
		$response = Invoke-WebRequest -Uri $uri -Method GET -Headers $script:JsonHeaders -UseBasicParsing

		return [pscustomobject]@{
			Check = $Label
			Status = [int]$response.StatusCode
			Path = $Path
		}
	}
	catch {
		$statusCode = "ERR"

		if ($_.Exception.Response) {
			$statusCode = [int]$_.Exception.Response.StatusCode
		}

		return [pscustomobject]@{
			Check = $Label
			Status = $statusCode
			Path = $Path
		}
	}
}

function Show-SiteCandidates {
	$siteListPaths = @(
		"/o/headless-admin-site/v1.0/sites?pageSize=200",
		"/o/headless-delivery/v1.0/sites?pageSize=200"
	)

	foreach ($siteListPath in $siteListPaths) {
		try {
			$response = Invoke-LiferayJson -Method GET -Path $siteListPath
			$items = Get-ObjectProperty -Object $response -Name "items"

			if ($null -eq $items -or @($items).Count -eq 0) {
				Write-Host ""
				Write-Host "No se encontraron sitios en $siteListPath."

				continue
			}

			Write-Host ""
			Write-Host "Sitios encontrados via ${siteListPath}:"

			@($items) | ForEach-Object {
				[pscustomobject]@{
					Id = Get-ObjectProperty -Object $_ -Name "id"
					Name = Get-DisplayText (Get-ObjectProperty -Object $_ -Name "name")
					Key = Get-ObjectProperty -Object $_ -Name "key"
					ExternalReferenceCode = Get-ObjectProperty -Object $_ -Name "externalReferenceCode"
					SiteExternalReferenceCode = Get-ObjectProperty -Object $_ -Name "siteExternalReferenceCode"
				}
			} | Format-List
		}
		catch {
			Write-Host ""
			Write-Warning "No se pudo listar sitios desde $siteListPath. Detalle: $_"
		}
	}

	$jsonWsPaths = @(
		"/api/jsonws/group/get-user-sites",
		"/api/jsonws/group/get-user-sites-groups"
	)

	foreach ($jsonWsPath in $jsonWsPaths) {
		try {
			$response = Invoke-LiferayJson -Method GET -Path $jsonWsPath

			if ($null -eq $response -or @($response).Count -eq 0) {
				Write-Host ""
				Write-Host "No se encontraron sitios en $jsonWsPath."

				continue
			}

			Write-Host ""
			Write-Host "Sitios encontrados via ${jsonWsPath}:"

			@($response) | ForEach-Object {
				[pscustomobject]@{
					Id = Get-ObjectProperty -Object $_ -Name "groupId"
					Name = Get-DisplayText (Get-ObjectProperty -Object $_ -Name "name")
					DescriptiveName = Get-DisplayText (Get-ObjectProperty -Object $_ -Name "descriptiveName")
					Key = Get-ObjectProperty -Object $_ -Name "groupKey"
					FriendlyURL = Get-ObjectProperty -Object $_ -Name "friendlyURL"
					ExternalReferenceCode = Get-ObjectProperty -Object $_ -Name "externalReferenceCode"
				}
			} | Format-List
		}
		catch {
			Write-Host ""
			Write-Warning "No se pudo listar sitios desde $jsonWsPath. Detalle: $_"
		}
	}
}

function Get-MimeType {
	param([string]$Path)

	switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
		".jpg" { return "image/jpeg" }
		".jpeg" { return "image/jpeg" }
		".png" { return "image/png" }
		".svg" { return "image/svg+xml" }
		".webp" { return "image/webp" }
		default { return "application/octet-stream" }
	}
}

function Invoke-LiferayMultipartFile {
	param(
		[ValidateSet("POST", "PUT")]
		[string]$Method,
		[string]$Path,
		[string]$FilePath,
		[string]$UploadFileName = "",
		[string]$ExternalReferenceCode = ""
	)

	$uri = Join-ApiPath -Path $Path
	$client = New-Object System.Net.Http.HttpClient
	$content = New-Object System.Net.Http.MultipartFormDataContent

	try {
		$client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Basic", $script:BasicToken)
		$client.DefaultRequestHeaders.Accept.Add([System.Net.Http.Headers.MediaTypeWithQualityHeaderValue]::Parse("application/json"))
		$client.DefaultRequestHeaders.AcceptLanguage.Add([System.Net.Http.Headers.StringWithQualityHeaderValue]::Parse($script:AcceptLanguage))

		$fileBytes = [IO.File]::ReadAllBytes($FilePath)
		$fileContent = New-Object System.Net.Http.ByteArrayContent(,$fileBytes)
		$fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse((Get-MimeType -Path $FilePath))
		if ([string]::IsNullOrWhiteSpace($UploadFileName)) {
			$UploadFileName = [IO.Path]::GetFileName($FilePath)
		}

		if ([string]::IsNullOrWhiteSpace($ExternalReferenceCode)) {
			$ExternalReferenceCode = [IO.Path]::GetFileNameWithoutExtension($UploadFileName)
		}

		$document = [ordered]@{
			description = $ExternalReferenceCode
			externalReferenceCode = $ExternalReferenceCode
			fileName = $UploadFileName
			title = $UploadFileName
		}
		$documentJson = $document | ConvertTo-Json -Depth 20
		$documentContent = New-Object System.Net.Http.StringContent($documentJson, [Text.Encoding]::UTF8, "application/json")

		$content.Add($documentContent, "document")
		$content.Add($fileContent, "file", $UploadFileName)

		$request = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($Method)), $uri)
		$request.Content = $content

		$response = $client.SendAsync($request).GetAwaiter().GetResult()
		$responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

		if (-not $response.IsSuccessStatusCode) {
			throw "HTTP $([int]$response.StatusCode) $Method $uri failed. $responseBody"
		}

		if ([string]::IsNullOrWhiteSpace($responseBody)) {
			return $null
		}

		return $responseBody | ConvertFrom-Json
	}
	finally {
		$content.Dispose()
		$client.Dispose()
	}
}

function Resolve-SiteId {
	if ($SiteId -gt 0) {
		return $SiteId
	}

	$encodedErc = [uri]::EscapeDataString($SiteExternalReferenceCode)
	$site = Invoke-LiferayJson -Method GET -Path "/o/headless-admin-site/v1.0/sites/$encodedErc" -AllowNotFound

	if ($null -ne $site -and (Get-ObjectProperty -Object $site -Name "id")) {
		return [long](Get-RequiredObjectProperty -Object $site -Names @("id", "siteId", "groupId") -Context "site por ERC")
	}

	$siteListPaths = @(
		"/o/headless-admin-site/v1.0/sites?pageSize=200",
		"/o/headless-delivery/v1.0/sites?pageSize=200"
	)

	foreach ($siteListPath in $siteListPaths) {
		$sites = Invoke-LiferayJson -Method GET -Path $siteListPath -AllowNotFound

		if ($null -eq $sites -or $null -eq (Get-ObjectProperty -Object $sites -Name "items")) {
			continue
		}

		foreach ($candidate in (Get-CollectionItems -Response $sites)) {
			$values = @(
				(Get-ObjectProperty -Object $candidate -Name "externalReferenceCode"),
				(Get-ObjectProperty -Object $candidate -Name "siteExternalReferenceCode"),
				(Get-ObjectProperty -Object $candidate -Name "key"),
				(Get-ObjectProperty -Object $candidate -Name "name")
			)

			foreach ($value in $values) {
				if ((ConvertTo-NormalizedName $value) -eq (ConvertTo-NormalizedName $SiteExternalReferenceCode)) {
					return [long](Get-RequiredObjectProperty -Object $candidate -Names @("id", "siteId", "groupId") -Context "sitio encontrado en $siteListPath")
				}
			}
		}
	}

	$jsonWsPaths = @(
		"/api/jsonws/group/get-user-sites",
		"/api/jsonws/group/get-user-sites-groups"
	)

	foreach ($jsonWsPath in $jsonWsPaths) {
		$sites = Invoke-LiferayJson -Method GET -Path $jsonWsPath -AllowNotFound

		if ($null -eq $sites) {
			continue
		}

		foreach ($candidate in @($sites)) {
			$values = @(
				(Get-ObjectProperty -Object $candidate -Name "externalReferenceCode"),
				(Get-ObjectProperty -Object $candidate -Name "groupKey"),
				(Get-ObjectProperty -Object $candidate -Name "friendlyURL"),
				(Get-DisplayText (Get-ObjectProperty -Object $candidate -Name "name")),
				(Get-DisplayText (Get-ObjectProperty -Object $candidate -Name "descriptiveName"))
			)

			foreach ($value in $values) {
				$normalizedValue = (ConvertTo-NormalizedName $value).TrimStart("/")
				$normalizedSiteErc = (ConvertTo-NormalizedName $SiteExternalReferenceCode).TrimStart("/")

				if ($normalizedValue -eq $normalizedSiteErc) {
					return [long](Get-RequiredObjectProperty -Object $candidate -Names @("groupId", "id", "siteId") -Context "sitio encontrado en $jsonWsPath")
				}
			}
		}
	}

	throw "No se pudo resolver el site '$SiteExternalReferenceCode'. Si tu portal no expone Site APIs, ejecuta con -SiteId <id>."
}

function Get-ContentStructure {
	param([long]$ResolvedSiteId)

	if ($StructureId -gt 0) {
		try {
			return Invoke-LiferayJson -Method GET -Path "/o/headless-delivery/v1.0/content-structures/$StructureId"
		}
		catch {
			if ($DryRun) {
				Write-Warning "DRY RUN: no se pudo leer la estructura $StructureId. Uso la definicion versionada de '$StructureName' solo para simular. Detalle: $_"

				return New-KnownTituloStructure -Id $StructureId
			}

			# Sin fallback: los nombres de campo y los valores del select tienen que salir de la estructura real.
			throw "No se pudo leer la estructura $StructureId. Detalle: $_"
		}
	}

	try {
		$response = Invoke-LiferayJson -Method GET -Path "/o/headless-delivery/v1.0/sites/$ResolvedSiteId/content-structures?pageSize=100"
	}
	catch {
		if ($DryRun) {
			Write-Warning "No se pudieron leer las estructuras del sitio $ResolvedSiteId. Para este DryRun uso la definicion versionada de '$StructureName'. Detalle: $_"

			return New-KnownTituloStructure -Id 0
		}

		throw "No se pudieron leer las estructuras del sitio $ResolvedSiteId. Si el HTTP es 400, usa -StructureId <id> para evitar el listado de estructuras. Si es 404, revisa el SiteId. Si es 403, revisa password/permisos. Detalle: $_"
	}

	foreach ($structure in (Get-CollectionItems -Response $response)) {
		$structureName = Get-DisplayText (Get-ObjectProperty -Object $structure -Name "name")

		if ((ConvertTo-NormalizedName $structureName) -eq (ConvertTo-NormalizedName $StructureName)) {
			return $structure
		}
	}

	if ($DryRun) {
		Write-Warning "No se encontro el Content Type '$StructureName' en el listado del sitio $ResolvedSiteId. Para este DryRun uso la definicion versionada."

		return New-KnownTituloStructure -Id 0
	}

	throw "No se encontro el Content Type '$StructureName' en el sitio $ResolvedSiteId. Si la estructura existe pero la API no la lista, ejecuta con -StructureId <id>."
}

function New-KnownField {
	param(
		[string]$Name,
		[string]$Label,
		[object[]]$Options = @(),
		[object[]]$NestedFields = @()
	)

	$field = [ordered]@{
		name = $Name
		fieldReference = $Name
		label = [pscustomobject]@{
			en_US = $Label
		}
	}

	if (@($Options).Count -gt 0) {
		$field.options = @($Options)
	}

	if (@($NestedFields).Count -gt 0) {
		$field.nestedContentStructureFields = @($NestedFields)
	}

	return [pscustomobject]$field
}

function New-SelectOption {
	param(
		[string]$Label,
		[string]$Value
	)

	return [pscustomobject]@{
		label = [pscustomobject]@{
			en_US = $Label
		}
		reference = $Value
		value = $Value
	}
}

# Solo para -DryRun sin acceso a Liferay. Los valores reales salen siempre de la estructura en vivo.
function New-KnownTituloStructure {
	param([long]$Id)

	$episodioFields = @(
		(New-KnownField -Name "episodioTemporada" -Label "Temporada"),
		(New-KnownField -Name "episodioNumero" -Label "Numero"),
		(New-KnownField -Name "episodioNombre" -Label "Nombre de Episodio"),
		(New-KnownField -Name "episodioDuracion" -Label "Duracion")
	)

	$clasificacionOptions = @(
		(New-SelectOption -Label "ATP" -Value "ATP"),
		(New-SelectOption -Label "+13" -Value "Mas13"),
		(New-SelectOption -Label "+16" -Value "Mas16"),
		(New-SelectOption -Label "+18" -Value "Mas18")
	)

	return [pscustomobject]@{
		id = $Id
		name = $StructureName
		contentStructureFields = @(
			(New-KnownField -Name "sinopsis" -Label "Sinopsis"),
			(New-KnownField -Name "poster" -Label "Poster"),
			(New-KnownField -Name "fondo" -Label "Imagen de fondo"),
			(New-KnownField -Name "anio" -Label "Anio"),
			(New-KnownField -Name "clasificacion" -Label "Clasificacion" -Options $clasificacionOptions),
			(New-KnownField -Name "elenco" -Label "Elenco"),
			(New-KnownField -Name "temporadas" -Label "Temporadas"),
			(New-KnownField -Name "episodio" -Label "Episodio" -NestedFields $episodioFields)
		)
	}
}

function Get-FlatFields {
	param([AllowNull()]$Fields)

	$result = @()

	foreach ($field in @($Fields)) {
		if ($null -eq $field) {
			continue
		}

		$result += $field

		$nested = Get-ObjectProperty -Object $field -Name "nestedContentStructureFields"

		if ($null -ne $nested) {
			$result += Get-FlatFields -Fields $nested
		}
	}

	return $result
}

# Busca por name, fieldReference o label normalizado. Asi funciona aunque el campo se llame
# Select05014083 o CopyOfsinopsis, siempre que el label sea el esperado.
function Find-Field {
	param(
		[object[]]$Fields,
		[string[]]$Candidates
	)

	$normalizedCandidates = $Candidates | ForEach-Object { ConvertTo-NormalizedName $_ }

	foreach ($field in $Fields) {
		$values = @(
			(Get-ObjectProperty -Object $field -Name "name"),
			(Get-ObjectProperty -Object $field -Name "fieldReference"),
			(Get-DisplayText (Get-ObjectProperty -Object $field -Name "label"))
		)

		foreach ($value in $values) {
			if ($normalizedCandidates -contains (ConvertTo-NormalizedName $value)) {
				return $field
			}
		}
	}

	$available = ($Fields | ForEach-Object { "$(Get-ObjectProperty -Object $_ -Name 'name') ('$(Get-DisplayText (Get-ObjectProperty -Object $_ -Name 'label'))')" }) -join ", "

	throw "No se encontro el campo: $($Candidates -join ', '). Campos de la estructura: $available"
}

function Resolve-SelectOptionValue {
	param(
		[object]$Field,
		[string]$Label
	)

	$options = Get-ObjectProperty -Object $Field -Name "options"

	foreach ($option in @($options)) {
		$optionLabel = Get-DisplayText (Get-ObjectProperty -Object $option -Name "label")
		$optionValue = Get-ObjectProperty -Object $option -Name "value"

		if (-not $optionValue) {
			$optionValue = Get-ObjectProperty -Object $option -Name "reference"
		}

		if (-not $optionValue) {
			$optionValue = Get-ObjectProperty -Object $option -Name "name"
		}

		if ((ConvertTo-NormalizedName $optionLabel) -eq (ConvertTo-NormalizedName $Label)) {
			return [string]$optionValue
		}
	}

	$fieldName = Get-DisplayText (Get-FirstObjectProperty -Object $Field -Names @("name", "fieldReference", "label"))
	$availableOptions = (@($options) | ForEach-Object { Get-DisplayText (Get-ObjectProperty -Object $_ -Name "label") }) -join ", "

	throw "No se encontro la opcion '$Label' en el campo '$fieldName'. Opciones: $availableOptions"
}

function Get-TaxonomyCategoryMap {
	param(
		[long]$ResolvedSiteId,
		[string[]]$VocabularyNames
	)

	$vocabularies = Invoke-LiferayJson -Method GET -Path "/o/headless-admin-taxonomy/v1.0/sites/$ResolvedSiteId/taxonomy-vocabularies?pageSize=100"
	$vocabulary = $null
	$normalizedNames = $VocabularyNames | ForEach-Object { ConvertTo-NormalizedName $_ }

	$vocabularyItems = Get-CollectionItems -Response $vocabularies

	foreach ($candidate in $vocabularyItems) {
		$name = Get-DisplayText (Get-ObjectProperty -Object $candidate -Name "name")

		if ($normalizedNames -contains (ConvertTo-NormalizedName $name)) {
			$vocabulary = $candidate
			break
		}
	}

	if ($null -eq $vocabulary) {
		if ($DryRun) {
			Write-Warning "DRY RUN: no se encontro el vocabulario '$($VocabularyNames -join '/')'. Las categorias se simularan con ID 0."

			return @{}
		}

		throw "No se encontro el vocabulario: $($VocabularyNames -join ', ')"
	}

	$vocabularyId = Get-FirstObjectProperty `
		-Object $vocabulary `
		-Names @("id", "taxonomyVocabularyId", "vocabularyId")

	if ($null -eq $vocabularyId) {
		if ($DryRun) {
			Write-Warning "DRY RUN: el vocabulario '$($VocabularyNames -join '/')' no trajo ID. Las categorias se simularan con ID 0."

			return @{}
		}

		[void](Get-RequiredObjectProperty `
			-Object $vocabulary `
			-Names @("id", "taxonomyVocabularyId", "vocabularyId") `
			-Context "vocabulario $($VocabularyNames -join '/')")
	}

	$categories = Invoke-LiferayJson -Method GET -Path "/o/headless-admin-taxonomy/v1.0/taxonomy-vocabularies/$vocabularyId/taxonomy-categories?pageSize=200"
	$map = @{}

	function Add-CategoryToMap {
		param([object]$Category)

		if ($null -eq $Category) {
			return
		}

		$name = Get-DisplayText (Get-ObjectProperty -Object $Category -Name "name")
		$categoryId = Get-FirstObjectProperty `
			-Object $Category `
			-Names @("id", "taxonomyCategoryId", "categoryId")

		if ($null -eq $categoryId) {
			if ($DryRun) {
				Write-Warning "DRY RUN: se ignora una categoria sin ID dentro de '$($VocabularyNames -join '/')'."

				return
			}

			[void](Get-RequiredObjectProperty `
				-Object $Category `
				-Names @("id", "taxonomyCategoryId", "categoryId") `
				-Context "categoria $name")
		}

		$key = ConvertTo-NormalizedName $name

		$availableNames = @()

		if ($map.ContainsKey("__availableNames")) {
			$availableNames = @($map["__availableNames"])
		}

		$availableNames += "$name ($categoryId)"
		$map["__availableNames"] = $availableNames

		if ($map.ContainsKey($key)) {
			$duplicateKeys = @()
			$duplicateDetails = @()

			if ($map.ContainsKey("__duplicateKeys")) {
				$duplicateKeys = @($map["__duplicateKeys"])
			}

			if ($map.ContainsKey("__duplicateDetails")) {
				$duplicateDetails = @($map["__duplicateDetails"])
			}

			$duplicateKeys += $key
			$duplicateDetails += "${name}: $($map[$key]), $categoryId"
			$map["__duplicateKeys"] = $duplicateKeys
			$map["__duplicateDetails"] = $duplicateDetails

			return
		}

		$map[$key] = [long]$categoryId

		$children = Get-ObjectProperty -Object $Category -Name "taxonomyCategories"

		foreach ($child in (ConvertTo-ObjectArray -Value $children)) {
			Add-CategoryToMap -Category $child
		}
	}

	$categoryItems = Get-CollectionItems `
		-Response $categories `
		-ItemPropertyNames @("items", "taxonomyCategories")

	foreach ($category in $categoryItems) {
		Add-CategoryToMap -Category $category
	}

	if ($map.Count -eq 0 -and $DryRun) {
		Write-Warning "DRY RUN: no se pudieron leer categorias para '$($VocabularyNames -join '/')'. Se simularan con ID 0."
	}

	$map["__vocabularyId"] = [long]$vocabularyId

	return $map
}

function Add-TaxonomyCategory {
	param(
		[hashtable]$Map,
		[string]$Name
	)

	$vocabularyId = $null

	if ($Map.ContainsKey("__vocabularyId")) {
		$vocabularyId = $Map["__vocabularyId"]
	}

	if ($null -eq $vocabularyId) {
		throw "No se puede crear la categoria '$Name' porque no se conoce el ID del vocabulario."
	}

	$body = [ordered]@{
		externalReferenceCode = "catalog-category-$vocabularyId-$(ConvertTo-ExternalReferenceCodeSegment -Value $Name)"
		name = $Name
	}

	$category = Invoke-LiferayJson `
		-Method POST `
		-Path "/o/headless-admin-taxonomy/v1.0/taxonomy-vocabularies/$vocabularyId/taxonomy-categories" `
		-Body $body

	$categoryId = Get-RequiredObjectProperty `
		-Object $category `
		-Names @("id", "taxonomyCategoryId", "categoryId") `
		-Context "categoria creada $Name"

	$key = ConvertTo-NormalizedName $Name
	$Map[$key] = [long]$categoryId

	Write-Host "Categoria creada: $Name ($categoryId)"

	return [long]$categoryId
}

function Resolve-CategoryId {
	param(
		[hashtable]$Map,
		[string]$Name
	)

	$key = ConvertTo-NormalizedName $Name

	if ($Map.ContainsKey("__duplicateKeys") -and (@($Map["__duplicateKeys"]) -contains $key)) {
		$details = @($Map["__duplicateDetails"]) -join "; "

		throw "Hay categorias duplicadas para '$Name'. Limpia o renombra el duplicado antes de sembrar catalogo. Duplicados: $details"
	}

	if (-not $Map.ContainsKey($key)) {
		if ($DryRun) {
			Write-Warning "DRY RUN: no se encontro la categoria '$Name'. Uso ID 0 para simular el payload."

			return 0
		}

		if ($CreateMissingCategories) {
			return Add-TaxonomyCategory -Map $Map -Name $Name
		}

		$availableNames = ""

		if ($Map.ContainsKey("__availableNames")) {
			$availableNames = @($Map["__availableNames"]) -join ", "
		}

		throw "No se encontro la categoria '$Name'. No se crean categorias automaticamente. Categorias disponibles: $availableNames"
	}

	return $Map[$key]
}

# Formato validado contra Liferay (variantes J/N del debug):
#   - solo contentFieldValue, sin contentFieldValue_i18n
#   - el idioma lo define el header Accept-Language
function New-ContentField {
	param(
		[string]$Name,
		[object]$ContentFieldValue
	)

	return [ordered]@{
		name = $Name
		contentFieldValue = $ContentFieldValue
	}
}

function New-DataField {
	param(
		[string]$Name,
		[AllowNull()]$Value
	)

	return New-ContentField `
		-Name $Name `
		-ContentFieldValue ([ordered]@{
			data = [string]$Value
		})
}

# El select se manda con data = valor interno de la opcion (ej. "Option16420715"), no el label ni un array JSON.
function New-SelectField {
	param(
		[string]$Name,
		[string]$OptionValue
	)

	return New-ContentField `
		-Name $Name `
		-ContentFieldValue ([ordered]@{
			data = $OptionValue
		})
}

function New-ImageField {
	param(
		[string]$Name,
		[AllowNull()]$Document
	)

	$image = [ordered]@{}

	if ($null -ne $Document -and (Get-ObjectProperty -Object $Document -Name "id")) {
		$image.id = [long](Get-RequiredObjectProperty -Object $Document -Names @("id", "documentId", "fileEntryId") -Context "documento $Name")

		$description = Get-DisplayText (Get-FirstObjectProperty -Object $Document -Names @("description", "title", "fileName", "externalReferenceCode"))

		if ([string]::IsNullOrWhiteSpace($description)) {
			$description = $Name
		}

		$image.description = $description
	}
	else {
		if (-not $DryRun) {
			throw "No se obtuvo ID para la imagen del campo '$Name'."
		}

		$image.id = 0
		$image.description = $Name
	}

	return New-ContentField `
		-Name $Name `
		-ContentFieldValue ([ordered]@{
			image = $image
		})
}

function Resolve-CatalogPath {
	param([string]$Path)

	if ([IO.Path]::IsPathRooted($Path)) {
		return $Path
	}

	return Join-Path $PSScriptRoot $Path
}

function Test-IntegerValue {
	param([AllowNull()]$Value)

	if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
		return $false
	}

	$parsed = 0L

	return [long]::TryParse([string]$Value, [ref]$parsed)
}

# Validacion local de obligatorios. Reemplaza al "Required" de la estructura,
# que en este Liferay rompe el alta via Headless.
function Test-CatalogItem {
	param(
		[object]$Item,
		[int]$Index
	)

	$errors = @()
	$erc = [string](Get-ObjectProperty -Object $Item -Name "erc")
	$label = if ([string]::IsNullOrWhiteSpace($erc)) { "item #$Index" } else { $erc }

	foreach ($name in @("erc", "titulo", "tipo", "sinopsis", "clasificacion")) {
		if ([string]::IsNullOrWhiteSpace([string](Get-ObjectProperty -Object $Item -Name $name))) {
			$errors += "${label}: falta '$name'"
		}
	}

	if (-not (Test-IntegerValue (Get-ObjectProperty -Object $Item -Name "anio"))) {
		$errors += "${label}: 'anio' falta o no es un numero entero"
	}

	# Los items con "tmdb" bajan sus imagenes de TMDB; el resto usa archivos locales.
	if (-not $SkipImages -and $null -eq (Get-ObjectProperty -Object $Item -Name "tmdb")) {
		foreach ($name in @("poster", "fondo")) {
			$relativePath = [string](Get-ObjectProperty -Object $Item -Name $name)

			if ([string]::IsNullOrWhiteSpace($relativePath)) {
				$errors += "${label}: falta '$name'"
			}
			elseif (-not (Test-Path -LiteralPath (Resolve-CatalogPath -Path $relativePath))) {
				$errors += "${label}: no existe la imagen '$relativePath'"
			}
		}
	}

	$tipo = ConvertTo-NormalizedName ([string](Get-ObjectProperty -Object $Item -Name "tipo"))

	if (-not [string]::IsNullOrWhiteSpace($tipo) -and @("pelicula", "serie") -notcontains $tipo) {
		$errors += "${label}: 'tipo' debe ser Pelicula o Serie"
	}

	if ($tipo -eq "serie") {
		$temporadas = Get-ObjectProperty -Object $Item -Name "temporadas"

		if ($null -ne $temporadas -and -not (Test-IntegerValue $temporadas)) {
			$errors += "${label}: 'temporadas' no es un numero entero"
		}

		$episodeIndex = 0

		foreach ($episodio in (ConvertTo-ObjectArray -Value (Get-ObjectProperty -Object $Item -Name "episodios"))) {
			$episodeIndex++

			foreach ($name in @("temporada", "numero", "duracion")) {
				$value = Get-ObjectProperty -Object $episodio -Name $name

				if ($null -ne $value -and -not (Test-IntegerValue $value)) {
					$errors += "${label}: episodio $episodeIndex, '$name' no es un numero entero"
				}
			}
		}
	}

	return $errors
}

function Put-Document {
	param(
		[long]$ResolvedSiteId,
		[string]$ExternalReferenceCode,
		[string]$FilePath
	)

	if (-not (Test-Path -LiteralPath $FilePath)) {
		throw "No existe la imagen: $FilePath"
	}

	if ($DryRun) {
		Write-Host "DRY RUN document: $ExternalReferenceCode <- $FilePath"

		return [pscustomobject]@{
			id = 0
			externalReferenceCode = $ExternalReferenceCode
			title = [IO.Path]::GetFileNameWithoutExtension($FilePath)
		}
	}

	$encodedErc = [uri]::EscapeDataString($ExternalReferenceCode)
	$uploadFileName = "$ExternalReferenceCode$([IO.Path]::GetExtension($FilePath))"

	return Invoke-LiferayMultipartFile `
		-Method PUT `
		-Path "/o/headless-delivery/v1.0/sites/$ResolvedSiteId/documents/by-external-reference-code/$encodedErc" `
		-FilePath $FilePath `
		-UploadFileName $uploadFileName `
		-ExternalReferenceCode $ExternalReferenceCode
}

function Invoke-Tmdb {
	param(
		[string]$Path,
		[hashtable]$Query = @{}
	)

	$headers = @{ Accept = "application/json" }
	$pairs = @()

	# Acepta la API key v3 (corta) o el "API Read Access Token" v4 (empieza con eyJ).
	if ($TmdbApiKey.StartsWith("eyJ")) {
		$headers.Authorization = "Bearer $TmdbApiKey"
	}
	else {
		$pairs += "api_key=$([uri]::EscapeDataString($TmdbApiKey))"
	}

	foreach ($key in $Query.Keys) {
		$value = $Query[$key]

		if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string]$value)) {
			$pairs += "$key=$([uri]::EscapeDataString([string]$value))"
		}
	}

	$uri = "https://api.themoviedb.org/3$Path"

	if ($pairs.Count -gt 0) {
		$uri += "?" + ($pairs -join "&")
	}

	try {
		return Invoke-RestMethod -Uri $uri -Headers $headers -Method GET
	}
	catch {
		# No se incluye la URI para no imprimir la API key.
		throw "TMDB fallo en ${Path}: $($_.Exception.Message)"
	}
}

# Devuelve las rutas locales de poster y fondo para un item con "tmdb", o $null si no usa TMDB.
# Las imagenes quedan en images\_tmdb\<erc>\ como cache (no commitear: tienen derechos de autor).
function Resolve-TmdbImages {
	param([object]$Item)

	$tmdb = Get-ObjectProperty -Object $Item -Name "tmdb"

	if ($null -eq $tmdb) {
		return $null
	}

	$erc = [string](Get-ObjectProperty -Object $Item -Name "erc")
	$cacheDir = Join-Path $PSScriptRoot "images\_tmdb\$erc"
	$posterFile = Join-Path $cacheDir "poster.jpg"
	$fondoFile = Join-Path $cacheDir "fondo.jpg"

	if (-not $RefreshTmdbImages -and (Test-Path -LiteralPath $posterFile) -and (Test-Path -LiteralPath $fondoFile)) {
		Write-Host "TMDB: uso imagenes en cache ($cacheDir)"

		return [pscustomobject]@{ Poster = $posterFile; Fondo = $fondoFile }
	}

	$mediaType = "movie"

	if ((ConvertTo-NormalizedName ([string](Get-ObjectProperty -Object $Item -Name "tipo"))) -eq "serie") {
		$mediaType = "tv"
	}

	$tmdbId = Get-ObjectProperty -Object $tmdb -Name "id"

	if (-not $tmdbId) {
		$query = [string](Get-ObjectProperty -Object $tmdb -Name "busqueda")

		if ([string]::IsNullOrWhiteSpace($query)) {
			$query = [string](Get-ObjectProperty -Object $Item -Name "titulo")
		}

		$year = Get-ObjectProperty -Object $tmdb -Name "anio"
		$yearParam = "year"

		if ($mediaType -eq "tv") {
			$yearParam = "first_air_date_year"
		}

		$search = Invoke-Tmdb -Path "/search/$mediaType" -Query @{ query = $query; $yearParam = $year; language = $TmdbLanguage }
		$results = @(Get-CollectionItems -Response $search -ItemPropertyNames @("results"))

		if ($results.Count -eq 0) {
			throw "TMDB no encontro '$query' ($mediaType, $year). Agrega tmdb.id en el catalogo."
		}

		$tmdbId = Get-ObjectProperty -Object $results[0] -Name "id"
	}

	$details = Invoke-Tmdb -Path "/$mediaType/$tmdbId" -Query @{ language = $TmdbLanguage }
	$tmdbName = Get-FirstObjectProperty -Object $details -Names @("title", "name")
	$tmdbDate = Get-FirstObjectProperty -Object $details -Names @("release_date", "first_air_date")

	# Se imprime el match para poder verificar que TMDB eligio el titulo correcto.
	Write-Host "TMDB: $tmdbName ($tmdbDate) -> https://www.themoviedb.org/$mediaType/$tmdbId"

	$posterPath = Get-ObjectProperty -Object $details -Name "poster_path"
	$backdropPath = Get-ObjectProperty -Object $details -Name "backdrop_path"

	if (-not $posterPath) {
		throw "TMDB no tiene poster para '$tmdbName' ($tmdbId)."
	}

	if (-not $backdropPath) {
		throw "TMDB no tiene imagen de fondo para '$tmdbName' ($tmdbId)."
	}

	New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
	Invoke-WebRequest -Uri "https://image.tmdb.org/t/p/w780$posterPath" -OutFile $posterFile -UseBasicParsing
	Invoke-WebRequest -Uri "https://image.tmdb.org/t/p/w1280$backdropPath" -OutFile $fondoFile -UseBasicParsing

	return [pscustomobject]@{ Poster = $posterFile; Fondo = $fondoFile }
}

function Get-FieldName {
	param(
		[object]$Field,
		[string]$Context
	)

	return [string](Get-RequiredObjectProperty -Object $Field -Names @("name") -Context $Context)
}

function New-StructuredContentPayload {
	param(
		[object]$Item,
		[object]$Fields,
		[object]$PosterDocument,
		[object]$FondoDocument,
		[long[]]$TaxonomyCategoryIds,
		[string]$ClassificationOption
	)

	$contentFields = @()

	$contentFields += New-DataField -Name (Get-FieldName $Fields.Sinopsis "campo Sinopsis") -Value (Get-ObjectProperty -Object $Item -Name "sinopsis")
	$contentFields += New-ImageField -Name (Get-FieldName $Fields.Poster "campo Poster") -Document $PosterDocument
	$contentFields += New-ImageField -Name (Get-FieldName $Fields.Fondo "campo Fondo") -Document $FondoDocument
	$contentFields += New-DataField -Name (Get-FieldName $Fields.Anio "campo Anio") -Value (Get-ObjectProperty -Object $Item -Name "anio")
	$contentFields += New-SelectField -Name (Get-FieldName $Fields.Clasificacion "campo Clasificacion") -OptionValue $ClassificationOption

	foreach ($actor in (ConvertTo-ObjectArray -Value (Get-ObjectProperty -Object $Item -Name "elenco"))) {
		if (-not [string]::IsNullOrWhiteSpace([string]$actor)) {
			$contentFields += New-DataField -Name (Get-FieldName $Fields.Elenco "campo Elenco") -Value $actor
		}
	}

	if ((ConvertTo-NormalizedName (Get-ObjectProperty -Object $Item -Name "tipo")) -eq "serie") {
		$temporadas = Get-ObjectProperty -Object $Item -Name "temporadas"

		if ($null -ne $temporadas) {
			$contentFields += New-DataField -Name (Get-FieldName $Fields.Temporadas "campo Temporadas") -Value $temporadas
		}

		$episodeFieldMap = [ordered]@{
			temporada = $Fields.EpisodioTemporada
			numero = $Fields.EpisodioNumero
			nombre = $Fields.EpisodioNombre
			duracion = $Fields.EpisodioDuracion
		}

		foreach ($episodio in (ConvertTo-ObjectArray -Value (Get-ObjectProperty -Object $Item -Name "episodios"))) {
			$nestedFields = @()

			foreach ($key in $episodeFieldMap.Keys) {
				$value = Get-ObjectProperty -Object $episodio -Name $key

				if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) {
					continue
				}

				$nestedFields += New-DataField -Name (Get-FieldName $episodeFieldMap[$key] "campo episodio.$key") -Value $value
			}

			if ($nestedFields.Count -eq 0) {
				continue
			}

			# El fieldset NO lleva contentFieldValue: solo nestedContentFields.
			$contentFields += [ordered]@{
				name = Get-FieldName $Fields.Episodio "campo Episodio"
				nestedContentFields = @($nestedFields)
			}
		}
	}

	return [ordered]@{
		externalReferenceCode = [string](Get-ObjectProperty -Object $Item -Name "erc")
		title = [string](Get-ObjectProperty -Object $Item -Name "titulo")
		contentStructureId = [long]$Fields.StructureId
		taxonomyCategoryIds = @($TaxonomyCategoryIds)
		contentFields = @($contentFields)
	}
}

function Put-StructuredContent {
	param(
		[long]$ResolvedSiteId,
		[object]$Item,
		[object]$Payload
	)

	$itemErc = Get-RequiredObjectProperty -Object $Item -Names @("erc") -Context "item de catalogo"
	$itemTitle = Get-RequiredObjectProperty -Object $Item -Names @("titulo") -Context "item $itemErc"
	$encodedErc = [uri]::EscapeDataString($itemErc)
	$path = "/o/headless-delivery/v1.0/sites/$ResolvedSiteId/structured-contents/by-external-reference-code/$encodedErc"

	if ($DryRun) {
		Write-Host "DRY RUN structured-content: $itemErc <- $itemTitle"
		Write-Host (($Payload | ConvertTo-Json -Depth 100))

		return [pscustomobject]@{
			id = 0
			externalReferenceCode = $itemErc
			title = $itemTitle
		}
	}

	return Invoke-LiferayJson -Method PUT -Path $path -Body $Payload
}

$catalogFullPath = Resolve-CatalogPath -Path $CatalogPath

if (-not (Test-Path -LiteralPath $catalogFullPath)) {
	throw "No existe el catalogo: $catalogFullPath"
}

if ($Probe) {
	$checks = @()
	$authCheck = Test-LiferayEndpoint -Label "Headless user/auth" -Path "/o/headless-admin-user/v1.0/my-user-account"
	$checks += $authCheck
	$checks += Test-LiferayEndpoint -Label "Headless delivery OpenAPI" -Path "/o/headless-delivery/v1.0/openapi.json"
	$checks += Test-LiferayEndpoint -Label "Headless admin site OpenAPI" -Path "/o/headless-admin-site/v1.0/openapi.json"
	$checks += Test-LiferayEndpoint -Label "Headless taxonomy OpenAPI" -Path "/o/headless-admin-taxonomy/v1.0/openapi.json"

	if ($SiteId -gt 0) {
		$checks += Test-LiferayEndpoint -Label "Content structures for SiteId $SiteId" -Path "/o/headless-delivery/v1.0/sites/$SiteId/content-structures?pageSize=1"
		$checks += Test-LiferayEndpoint -Label "Structured contents for SiteId $SiteId" -Path "/o/headless-delivery/v1.0/sites/$SiteId/structured-contents?pageSize=1"
		$checks += Test-LiferayEndpoint -Label "Taxonomy vocabularies for SiteId $SiteId" -Path "/o/headless-admin-taxonomy/v1.0/sites/$SiteId/taxonomy-vocabularies?pageSize=1"
	}
	else {
		$encodedErc = [uri]::EscapeDataString($SiteExternalReferenceCode)
		$checks += Test-LiferayEndpoint -Label "Site by ERC $SiteExternalReferenceCode" -Path "/o/headless-admin-site/v1.0/sites/$encodedErc"
	}

	$checks | Format-Table -Auto

	if ([string]$authCheck.Status -ne "200") {
		Write-Host ""
		Write-Warning "La autenticacion fallo. Revisa -UserName y password antes de diagnosticar SiteId o catalogo."
		exit 1
	}

	Show-SiteCandidates
	exit 0
}

# UTF-8 explicito: en PowerShell 5.1, sin BOM se leeria como ANSI y las tildes llegarian rotas.
# Se asigna primero y despues se envuelve: en PS 5.1, @(... | ConvertFrom-Json) deja el array entero como un unico item.
$catalogJson = Get-Content -Raw -Encoding UTF8 -LiteralPath $catalogFullPath | ConvertFrom-Json
$catalog = @($catalogJson)

# Validar todo el catalogo antes de tocar Liferay.
$validationErrors = @()
$itemIndex = 0

foreach ($item in $catalog) {
	$itemIndex++
	$validationErrors += @(Test-CatalogItem -Item $item -Index $itemIndex)
}

$duplicateErcs = @($catalog | ForEach-Object { [string](Get-ObjectProperty -Object $_ -Name "erc") } | Where-Object { $_ } | Group-Object | Where-Object { $_.Count -gt 1 } | ForEach-Object { $_.Name })

foreach ($duplicateErc in $duplicateErcs) {
	$validationErrors += "ERC duplicado en el catalogo: $duplicateErc"
}

$tmdbItemCount = @($catalog | Where-Object { $null -ne (Get-ObjectProperty -Object $_ -Name "tmdb") }).Count

if ($tmdbItemCount -gt 0 -and -not $SkipImages -and [string]::IsNullOrWhiteSpace($TmdbApiKey)) {
	$validationErrors += "Hay $tmdbItemCount item(s) con 'tmdb' pero falta la API key: pasa -TmdbApiKey o define la variable de entorno TMDB_API_KEY."
}

if ($validationErrors.Count -gt 0) {
	Write-Host "El catalogo tiene errores; no se envio nada a Liferay:" -ForegroundColor Red
	$validationErrors | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
	exit 1
}

$resolvedSiteId = Resolve-SiteId
$structure = Get-ContentStructure -ResolvedSiteId $resolvedSiteId
$structureFields = Get-RequiredObjectProperty -Object $structure -Names @("contentStructureFields") -Context "estructura $StructureName"
$flatFields = Get-FlatFields -Fields $structureFields

$requiredFieldNames = @($flatFields | Where-Object { (Get-ObjectProperty -Object $_ -Name "required") -eq $true } | ForEach-Object { Get-ObjectProperty -Object $_ -Name "name" })

if ($requiredFieldNames.Count -gt 0) {
	Write-Warning ("La estructura tiene campos marcados como Required ({0}). En este Liferay eso hace fallar el alta via Headless con 'No value defined for field name'. Desmarca Required en la estructura: el script ya valida los obligatorios." -f ($requiredFieldNames -join ", "))
}

$fields = [ordered]@{
	StructureId = [long](Get-RequiredObjectProperty -Object $structure -Names @("id", "contentStructureId", "structureId") -Context "estructura $StructureName")
	Sinopsis = Find-Field -Fields $flatFields -Candidates @("sinopsis", "Sinopsis")
	Poster = Find-Field -Fields $flatFields -Candidates @("poster", "Poster")
	Fondo = Find-Field -Fields $flatFields -Candidates @("fondo", "Imagen de fondo")
	Anio = Find-Field -Fields $flatFields -Candidates @("anio", "Ano", "Año")
	Clasificacion = Find-Field -Fields $flatFields -Candidates @("clasificacion", "Clasificacion")
	Elenco = Find-Field -Fields $flatFields -Candidates @("elenco", "Elenco")
	Temporadas = Find-Field -Fields $flatFields -Candidates @("temporadas", "Temporadas")
	Episodio = Find-Field -Fields $flatFields -Candidates @("episodio", "Episodio")
	EpisodioTemporada = Find-Field -Fields $flatFields -Candidates @("episodioTemporada", "Temporada")
	EpisodioNumero = Find-Field -Fields $flatFields -Candidates @("episodioNumero", "Numero", "Número")
	EpisodioNombre = Find-Field -Fields $flatFields -Candidates @("episodioNombre", "Nombre de Episodio")
	EpisodioDuracion = Find-Field -Fields $flatFields -Candidates @("episodioDuracion", "Duracion")
}

$genreMap = Get-TaxonomyCategoryMap -ResolvedSiteId $resolvedSiteId -VocabularyNames @("generos", "Géneros")
$typeMap = Get-TaxonomyCategoryMap -ResolvedSiteId $resolvedSiteId -VocabularyNames @("tipo", "Tipo")

$createdOrUpdated = 0
$failed = 0
$failures = @()

if ($DryRun) {
	Write-Host "DRY RUN activo: no se van a crear ni actualizar Web Contents."
	Write-Host ""
}

Write-Host "Site ID: $resolvedSiteId"
Write-Host "Content Type: $(Get-DisplayText (Get-ObjectProperty -Object $structure -Name "name")) ($($fields.StructureId))"
Write-Host "Campo clasificacion: $(Get-ObjectProperty -Object $fields.Clasificacion -Name 'name')"
Write-Host "Items: $($catalog.Count)"

foreach ($item in $catalog) {
	$payload = $null

	try {
		$itemErc = Get-ObjectProperty -Object $item -Name "erc"
		$itemTitle = Get-ObjectProperty -Object $item -Name "titulo"

		Write-Host ""
		Write-Host "== $itemTitle [$itemErc] =="

		$categoryIds = @()
		$categoryIds += Resolve-CategoryId -Map $typeMap -Name (Get-ObjectProperty -Object $item -Name "tipo")

		foreach ($genre in (ConvertTo-ObjectArray -Value (Get-ObjectProperty -Object $item -Name "generos"))) {
			$categoryIds += Resolve-CategoryId -Map $genreMap -Name $genre
		}

		$classificationOption = Resolve-SelectOptionValue -Field $fields.Clasificacion -Label (Get-ObjectProperty -Object $item -Name "clasificacion")

		$posterDocument = $null
		$fondoDocument = $null

		if (-not $SkipImages) {
			$tmdbImages = Resolve-TmdbImages -Item $item

			if ($null -ne $tmdbImages) {
				$posterPath = $tmdbImages.Poster
				$fondoPath = $tmdbImages.Fondo
			}
			else {
				$posterPath = Resolve-CatalogPath -Path (Get-ObjectProperty -Object $item -Name "poster")
				$fondoPath = Resolve-CatalogPath -Path (Get-ObjectProperty -Object $item -Name "fondo")
			}

			$posterDocument = Put-Document -ResolvedSiteId $resolvedSiteId -ExternalReferenceCode "$itemErc-poster" -FilePath $posterPath
			$fondoDocument = Put-Document -ResolvedSiteId $resolvedSiteId -ExternalReferenceCode "$itemErc-fondo" -FilePath $fondoPath
		}

		$payload = New-StructuredContentPayload `
			-Item $item `
			-Fields $fields `
			-PosterDocument $posterDocument `
			-FondoDocument $fondoDocument `
			-TaxonomyCategoryIds ([long[]]$categoryIds) `
			-ClassificationOption $classificationOption

		$result = Put-StructuredContent -ResolvedSiteId $resolvedSiteId -Item $item -Payload $payload

		Write-Host "OK: $(Get-ObjectProperty -Object $result -Name "title") (id $(Get-ObjectProperty -Object $result -Name "id"))"
		$createdOrUpdated++
	}
	catch {
		$failed++
		$itemErcForError = Get-ObjectProperty -Object $item -Name "erc"

		if ($null -ne $payload) {
			$failedPayloadPath = Join-Path $PSScriptRoot "last-failed-payload-$itemErcForError.json"
			$payload | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $failedPayloadPath -Encoding UTF8

			Write-Warning "Payload fallido guardado en $failedPayloadPath"
		}

		Write-Warning "Fallo '$itemErcForError': $_"
		$failures += [pscustomobject]@{ Erc = $itemErcForError; Titulo = (Get-ObjectProperty -Object $item -Name "titulo"); Error = "$_" }
	}
}

Write-Host ""
Write-Host "Resumen: $createdOrUpdated creados/actualizados, $failed fallidos."

# Los fallidos se repiten al final (y se guardan en un archivo) para no tener que buscarlos en toda la salida.
if ($failures.Count -gt 0) {
	$failuresPath = Join-Path $PSScriptRoot "last-run-errors.txt"
	$failureLines = $failures | ForEach-Object { "- $($_.Titulo) [$($_.Erc)]`r`n  $($_.Error)`r`n" }
	$failureLines | Set-Content -LiteralPath $failuresPath -Encoding UTF8

	Write-Host ""
	Write-Host "Titulos que fallaron:" -ForegroundColor Red
	$failureLines | ForEach-Object { Write-Host $_ -ForegroundColor Red }
	Write-Host "Detalle guardado en $failuresPath" -ForegroundColor Red
}

if ($failed -gt 0) {
	exit 1
}
