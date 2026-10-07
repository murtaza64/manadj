; manaDJ Windows installer (cross-platform #317). Built by
; scripts/release/build_windows.py, which passes the /D defines below.
;
; Per-user install (no admin prompt): %LOCALAPPDATA%\Programs\manaDJ.
; User data lives in %APPDATA%\manaDJ (the shell's data root) and is NOT
; removed on uninstall — same contract as deleting the macOS .app.

#ifndef AppVersion
  #error AppVersion must be defined (/DAppVersion=...)
#endif

[Setup]
AppId={{6D0B8C2E-5A1F-4E0B-9B7A-6D616E61646A}
AppName=manaDJ
AppVersion={#AppVersion}
AppVerName=manaDJ {#AppVersion}
VersionInfoVersion={#AppVersionNumeric}
AppPublisher=manaDJ
AppPublisherURL=https://github.com/murtaza64/manadj
AppSupportURL=https://github.com/murtaza64/manadj/issues
DefaultDirName={localappdata}\Programs\manaDJ
DefaultGroupName=manaDJ
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBase}
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\manaDJ.exe
Compression=lzma2/max
SolidCompression=yes
LZMANumBlockThreads=4
WizardStyle=modern
; The runtime is large; keep the installer under Inno's 2.1 GB single-file
; limit without disk spanning (fails loudly if exceeded).
DiskSpanning=no

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; An upgrade replaces the bundled runtime wholesale (stale packages must not linger).
Type: filesandordirs; Name: "{app}\resources"

[Icons]
Name: "{group}\manaDJ"; Filename: "{app}\manaDJ.exe"
Name: "{group}\Uninstall manaDJ"; Filename: "{uninstallexe}"
Name: "{userdesktop}\manaDJ"; Filename: "{app}\manaDJ.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\manaDJ.exe"; Description: "{cm:LaunchProgram,manaDJ}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Python bytecode written at runtime inside the install dir.
Type: filesandordirs; Name: "{app}\resources"
