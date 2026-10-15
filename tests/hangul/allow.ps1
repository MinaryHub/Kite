# 자동화로 띄운 한글 인스턴스의 '파일 접근 허용' 창에서 '모두 허용'을 누른다 (최대 3분)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$end = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $end) {
  foreach ($p in Get-Process Hwp -ErrorAction SilentlyContinue) {
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
    foreach ($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
      if ($w.Current.ClassName -ne 'MessageBoxImpl') { continue }
      foreach ($b in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))) {
        if ($b.Current.Name -like '*ALT+N*') {
          try { ($b.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke(); "clicked: " + $b.Current.Name } catch {}
          break
        }
      }
    }
  }
  Start-Sleep -Milliseconds 400
}
