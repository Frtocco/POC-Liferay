<#
  Borra titulos de Liferay por ERC, junto con su poster y fondo.
  Uso:
    .\tools\catalog\remove-titulos.ps1 -Erc titulo-horizonte-rojo, titulo-el-portal
  Toma BaseUrl, usuario, password y SiteId de .env.local (igual que seed-catalog.ps1).
#>
[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string[]]$Erc,
	[string]$BaseUrl = "",
	[string]$UserName = "",
	[long]$SiteId = 0,
	[switch]$KeepDocuments
)

$ErrorActionPreference = "Stop"

$envFile = Join-Path $PSScriptRoot ".env.local"

if (Test-Path -LiteralPath $envFile) {
	foreach ($envLine in Get-Content -LiteralPath $envFile -Encoding UTF8) {
		$trimmedLine = $envLine.Trim()

		if (-not $trimmedLine -or $trimmedLine.StartsWith("#") -or $trimmedLine.IndexOf("=") -lt 1) {
			continue
		}

		$separatorIndex = $trimmedLine.IndexOf("=")
		$envKey = $trimmedLine.Substring(0, $separatorIndex).Trim()
		$envValue = $trimmedLine.Substring($separatorIndex + 1).Trim().Trim('"')

		if ($envValue -and -not [Environment]::GetEnvironmentVariable($envKey)) {
			[Environment]::SetEnvironmentVariable($envKey, $envValue, "Process")
		}
	}
}

if (-not $BaseUrl) { $BaseUrl = if ($env:LIFERAY_BASE_URL) { $env:LIFERAY_BASE_URL } else { "http://localhost:8080" } }
if (-not $UserName) { $UserName = if ($env:LIFERAY_USER) { $env:LIFERAY_USER } else { "test@liferay.com" } }
if ($SiteId -eq 0 -and $env:LIFERAY_SITE_ID) { $SiteId = [long]$env:LIFERAY_SITE_ID }

if ($SiteId -eq 0) {
	throw "Falta el SiteId: pasa -SiteId o definilo en .env.local (LIFERAY_SITE_ID)."
}

$password = $env:LIFERAY_PASSWORD

if (-not $password) {
	$securePassword = Read-Host "Password de Liferay para $UserName" -AsSecureString
	$password = [Net.NetworkCredential]::new("", $securePassword).Password
}

$BaseUrl = $BaseUrl.TrimEnd("/")
$token = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${UserName}:${password}"))
$headers = @{ Authorization = "Basic $token"; Accept = "application/json" }

function Remove-ByErc {
	param(
		[string]$Collection,
		[string]$ItemErc
	)

	$uri = "$BaseUrl/o/headless-delivery/v1.0/sites/$SiteId/$Collection/by-external-reference-code/$([uri]::EscapeDataString($ItemErc))"

	try {
		[void](Invoke-WebRequest -Uri $uri -Method DELETE -Headers $headers -UseBasicParsing)
		Write-Host "  Borrado: $Collection/$ItemErc" -ForegroundColor Green
	}
	catch {
		$status = $null

		if ($_.Exception.Response) {
			$status = [int]$_.Exception.Response.StatusCode
		}

		if ($status -eq 404) {
			Write-Host "  No existe (ya estaba borrado): $Collection/$ItemErc" -ForegroundColor Yellow
		}
		else {
			Write-Warning "  No se pudo borrar $Collection/$ItemErc (HTTP $status): $($_.ErrorDetails.Message)"
		}
	}
}

foreach ($itemErc in $Erc) {
	Write-Host "== $itemErc =="
	Remove-ByErc -Collection "structured-contents" -ItemErc $itemErc

	if (-not $KeepDocuments) {
		Remove-ByErc -Collection "documents" -ItemErc "$itemErc-poster"
		Remove-ByErc -Collection "documents" -ItemErc "$itemErc-fondo"
	}
}
