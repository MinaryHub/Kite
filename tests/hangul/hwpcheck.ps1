param([string[]]$Files, [string]$OutDir)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$hwp = New-Object -ComObject HWPFrame.HwpObject
try { $null = $hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule') } catch {}
try { $hwp.XHwpWindows.Item(0).Visible = $false } catch {}
foreach ($f in $Files) {
  $ok = $false
  try { $ok = $hwp.Open($f, '', 'forceopen:true;suspendpassword:true;versionwarning:false') } catch { "OPEN-EXC $f : $($_.Exception.Message)" }
  if ($ok) {
    $pages = $hwp.PageCount
    $text = ''
    try { $text = $hwp.GetTextFile('TEXT', '') } catch {}
    $pdf = Join-Path $OutDir ([IO.Path]::GetFileName($f) + '.pdf')
    $saved = $false
    try { $saved = $hwp.SaveAs($pdf, 'PDF', '') } catch {}
    "OK  $([IO.Path]::GetFileName($f)) pages=$pages textlen=$($text.Length) pdf=$saved"
    "    text: " + ($text -replace '\s+', ' ').Substring(0, [Math]::Min(160, ($text -replace '\s+', ' ').Length))
  } else { "FAIL $([IO.Path]::GetFileName($f))" }
  try { $null = $hwp.Clear(1) } catch {}
}
try { $hwp.Quit() } catch {}
