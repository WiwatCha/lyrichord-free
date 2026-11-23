; Lyrichord (formerly Lyricord) Windows installer (Inno Setup 6). Built by .github/workflows/desktop.yml after desktop/build.py:
;   ISCC /DAppVersion=<version> /DSrcDir=<bundle folder> /DOutDir=<output folder> desktop\windows\lyricord.iss
; Installs per user (no admin rights needed) into %LOCALAPPDATA%\Programs\Lyrichord (an update of an older Lyricord stays in its folder:
; same AppId).
; Songs analysed and settings live in %LOCALAPPDATA%\Lyrichord (moved from ...\Lyricord by the launcher) and are kept on uninstall / update.

#ifndef AppVersion
  #define AppVersion "dev"
#endif
#ifndef SrcDir
  #define SrcDir "..\..\dist\desktop\Lyrichord"
#endif
#ifndef OutDir
  #define OutDir "..\..\dist\desktop"
#endif
; /DEdition=free: Lyrichord Free (its own AppId, folder and shortcuts: installs beside the full app)
#ifndef Edition
  #define Edition "full"
#endif
#if Edition == "free"
  #define AppTitle "Lyrichord Free"
  #define AppSlug "LyrichordFree"
  #define TheAppId "{{2C7E4B91-58D3-4F0A-A6B2-93E1D5C7F804}"
#else
  #define AppTitle "Lyrichord"
  #define AppSlug "Lyrichord"
  #define TheAppId "{{6F1B9C2E-7A41-4C8B-9E55-1D3A7C0B4E21}"
#endif

[Setup]
AppId={#TheAppId}
AppName={#AppTitle}
AppVersion={#AppVersion}
AppVerName={#AppTitle} {#AppVersion}
AppPublisher=Lyrichord
DefaultDirName={localappdata}\Programs\{#AppSlug}
DefaultGroupName={#AppTitle}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutDir}
OutputBaseFilename={#AppSlug}-Setup-{#AppVersion}
SetupIconFile={#SrcDir}\lyricord.ico
UninstallDisplayIcon={app}\lyricord.ico
Compression=lzma2/normal
SolidCompression=yes
LZMANumBlockThreads=4
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
; the Tk control window does not answer the restart manager: [Code] below stops Lyricord itself
CloseApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[InstallDelete]
; an update replaces the whole program (the user's songs are elsewhere)
Type: filesandordirs; Name: "{app}\python"
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\models"
; shortcuts of the old name (Lyricord, up to r15)
Type: files; Name: "{autoprograms}\Lyricord.lnk"
Type: files; Name: "{autodesktop}\Lyricord.lnk"

[Files]
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppTitle}"; Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\app\launcher.py"""; WorkingDir: "{app}"; IconFilename: "{app}\lyricord.ico"
Name: "{autodesktop}\{#AppTitle}"; Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\app\launcher.py"""; WorkingDir: "{app}"; IconFilename: "{app}\lyricord.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\python\pythonw.exe"; Parameters: """{app}\app\launcher.py"""; WorkingDir: "{app}"; Description: "Start {#AppTitle} now"; Flags: nowait postinstall skipifsilent

[Code]
// Stop a running Lyricord (its bundled pythonw.exe) before files are replaced, on install and on uninstall.
procedure StopLyricord();
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -Command "Get-Process python,pythonw -ErrorAction SilentlyContinue | ' +
    'Where-Object { $_.Path -like ''' + ExpandConstant('{app}') + '\*'' } | Stop-Process -Force"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(800);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopLyricord();
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    StopLyricord();
end;
