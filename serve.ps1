param(
  [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$rootPath = (Resolve-Path $PSScriptRoot).Path.TrimEnd('\') + '\'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")

$contentTypes = @{
  ".avif" = "image/avif"
  ".css" = "text/css; charset=utf-8"
  ".gif" = "image/gif"
  ".html" = "text/html; charset=utf-8"
  ".ico" = "image/x-icon"
  ".jpeg" = "image/jpeg"
  ".jpg" = "image/jpeg"
  ".js" = "text/javascript; charset=utf-8"
  ".png" = "image/png"
  ".svg" = "image/svg+xml"
  ".webp" = "image/webp"
  ".woff" = "font/woff"
  ".woff2" = "font/woff2"
}

$listener.Start()
Write-Output "Storefront preview running at http://127.0.0.1:$Port/"
Write-Output "Firebase requests use the configured live project. Press Ctrl+C to stop."

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $response = $context.Response
    try {
      if ($context.Request.HttpMethod -notin @("GET", "HEAD")) {
        $response.StatusCode = 405
        $response.Close()
        continue
      }

      $relativePath = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/')).Replace('/', '\')
      if (-not $relativePath) { $relativePath = "index.html" }
      $firstSegment = ($relativePath -split '\\')[0].ToLowerInvariant()
      $fileName = [IO.Path]::GetFileName($relativePath)
      $filePath = [IO.Path]::GetFullPath((Join-Path $rootPath $relativePath))
      $isBlocked = (
        -not $filePath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase) -or
        $firstSegment -in @("api", "database", "firebase", "functions", "scripts", "node_modules") -or
        $fileName.StartsWith(".") -or
        [IO.Path]::GetExtension($filePath).ToLowerInvariant() -eq ".php"
      )

      if ($isBlocked -or -not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
        $response.StatusCode = 404
        $response.Close()
        continue
      }

      $extension = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
      if ($contentTypes.ContainsKey($extension)) {
        $response.ContentType = $contentTypes[$extension]
      } else {
        $response.ContentType = "application/octet-stream"
      }
      $response.Headers.Add("X-Content-Type-Options", "nosniff")
      $bytes = [IO.File]::ReadAllBytes($filePath)
      $response.ContentLength64 = $bytes.Length
      if ($context.Request.HttpMethod -ne "HEAD") {
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
      }
      $response.Close()
    } catch {
      $response.StatusCode = 500
      $response.Close()
      Write-Warning "Could not serve a local storefront request: $($_.Exception.Message)"
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
