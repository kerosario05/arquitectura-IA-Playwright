# Prueba el servicio MDW (Extreme Mediator) y la consulta Lexis Nexis con una persona ficticia.
# Uso (en el servidor MDW o en cualquier equipo que lo alcance):
#   powershell -ExecutionPolicy Bypass -File test-mdw-lexis.ps1 -ClientId "<ClientID de Lexis>"
#   (opcional) -Url http://172.20.18.142:8732/ExtremeMediator/Service  -TimeoutSec 30  -Cedula 00100000000
# No imprime el ClientID. La persona es ficticia: no se consulta a nadie real.
param(
  [Parameter(Mandatory = $true)][string]$ClientId,
  [string]$Url = "http://172.20.18.142:8732/ExtremeMediator/Service",
  [int]$TimeoutSec = 30,
  [string]$Cedula = "00100000000"
)

function Send-Soap([string]$Action, [string]$Body) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-WebRequest -Uri $Url -Method Post -Body $Body -ContentType "text/xml; charset=utf-8" `
      -Headers @{ SOAPAction = $Action } -UseBasicParsing -TimeoutSec $TimeoutSec
    return [pscustomobject]@{ Status = [int]$r.StatusCode; Ms = $sw.ElapsedMilliseconds; Body = $r.Content }
  } catch {
    $resp = $_.Exception.Response
    $text = ""
    if ($resp) { try { $text = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {} }
    $code = if ($resp) { [int]$resp.StatusCode } else { 0 }
    return [pscustomobject]@{ Status = $code; Ms = $sw.ElapsedMilliseconds; Body = $text; Error = $_.Exception.Message }
  }
}

Write-Host "== 1. IsActive (salud del servicio) =="
$ia = Send-Soap "http://tempuri.org/MDS/IsActive" '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/"><soapenv:Header/><soapenv:Body><tem:IsActive/></soapenv:Body></soapenv:Envelope>'
Write-Host ("HTTP {0} en {1} ms" -f $ia.Status, $ia.Ms)
if ($ia.Error) { Write-Host "Error: $($ia.Error)" }
if ($ia.Body) { Write-Host ($ia.Body -replace '\s+', ' ').Substring(0, [Math]::Min(300, $ia.Body.Length)) }

Write-Host ""
Write-Host "== 2. Execute con consulta Lexis (persona ficticia) =="
$day = (Get-Date).ToString("yyyyMMdd")
$headers = [ordered]@{ MsgType = "0"; TranType = "1"; RealDate = $day; BussDate = $day; Company = "1"; Canal = "BPM"; TrnCode = "5000"; SerialTrn = $day }
$data = [ordered]@{ ClientID = $ClientId; ClientReference = $Cedula; FirstName = "PRUEBA"; LastName = "SISTEMA"; Title = ""; IdentificationType = "Cedula"; Genero = "Masculino"; TipoCliente = "Persona Fisica"; Pais = "Republica Dominicana" }
$h = ($headers.GetEnumerator() | ForEach-Object { '<HField name="{0}" Value="{1}" />' -f $_.Key, [Security.SecurityElement]::Escape($_.Value) }) -join ""
$d = ($data.GetEnumerator()    | ForEach-Object { '<DField Type="P" name="{0}" Value="{1}" />' -f $_.Key, [Security.SecurityElement]::Escape($_.Value) }) -join ""
$envelope = '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/"><soapenv:Header/><soapenv:Body><tem:Execute><tem:xmlin><![CDATA[<ExtremeMsg><Header>' + $h + '</Header><Data>' + $d + '</Data></ExtremeMsg>]]></tem:xmlin></tem:Execute></soapenv:Body></soapenv:Envelope>'
$ex = Send-Soap "http://tempuri.org/MDS/Execute" $envelope
Write-Host ("HTTP {0} en {1} ms" -f $ex.Status, $ex.Ms)
if ($ex.Error) { Write-Host "Error: $($ex.Error)" }

if ($ex.Body) {
  try {
    [xml]$soap = $ex.Body
    $inner = $soap.Envelope.Body.ExecuteResponse.ExecuteResult
    [xml]$reply = $inner
    $fields = @($reply.ExtremeMsgReply.Data.DField)
    $ret = $fields | Where-Object { $_.name -eq "RetCode" } | Select-Object -First 1
    $msg = $fields | Where-Object { $_.name -match "RetMsg|Mensaje|Message|Error" } | Select-Object -First 1
    Write-Host ("RetCode = {0}" -f $ret.Value)
    if ($msg) { Write-Host ("{0} = {1}" -f $msg.name, $msg.Value) }
    $ans = $fields | Where-Object { $_.name -eq "Respuesta" } | Select-Object -First 1
    if ($ans) {
      [xml]$res = $ans.Value
      $sr = $res.Respuesta.SearchResults
      Write-Host ("Respuesta: ClientReference coincide = {0}; BlockID presente = {1}; SearchEngineVersion presente = {2}; Records presente = {3}" -f `
        ($sr.ClientReference -eq $Cedula), [bool]$sr.BlockID, [bool]$sr.SearchEngineVersion, ($null -ne $sr.Records))
      if ($null -eq $sr.Records -and $sr.BlockID -and $sr.SearchEngineVersion) { Write-Host "=> RESULTADO: CLEAR (sin coincidencias)" }
      elseif ($sr.Records -and $sr.Records.ResultRecord) { Write-Host "=> RESULTADO: MATCH (hay coincidencias)" }
      else { Write-Host "=> RESULTADO: formato no reconocido por QA Lab" }
    } else { Write-Host "=> Sin campo Respuesta: el servicio contesta pero Lexis no devolvió resultado" }
  } catch {
    Write-Host "No se pudo interpretar la respuesta. Primeros 600 caracteres:"
    Write-Host (($ex.Body -replace '\s+', ' ')).Substring(0, [Math]::Min(600, $ex.Body.Length))
  }
}
