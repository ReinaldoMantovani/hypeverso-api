# Remove as tarefas de inicialização automática do Hypeverso.
foreach ($name in 'Hypeverso IA', 'Hypeverso CMS') {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Host "Removida: $name"
  }
}
