[Setup]
AppName=Veracity IBKR Connector
AppVersion=1.0.0
DefaultDirName={pf}\Veracity
DefaultGroupName=Veracity
OutputBaseFilename=VeracitySetup
Compression=lzma
SolidCompression=yes
OutputDir=dist

[Files]
Source: "..\tray-app\dist\win-unpacked\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs
Source: "..\connector\veracity-ibkr-connector.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Veracity IBKR Connector"; Filename: "{app}\Veracity IBKR Connector.exe"

[Run]
Filename: "{app}\Veracity IBKR Connector.exe"; Description: "Launch Veracity IBKR Connector"; Flags: nowait postinstall skipifsilent

[Tasks]
Name: "autorun"; Description: "Start Veracity IBKR Connector at logon"; GroupDescription: "Additional tasks"; Flags: unchecked

[Run]
Filename: "schtasks"; Parameters: "/Create /TN \"Veracity IBKR Connector\" /TR \"{app}\Veracity IBKR Connector.exe\" /SC ONLOGON /RL LIMITED /F"; Flags: runhidden; Tasks: autorun
Filename: "schtasks"; Parameters: "/Delete /TN \"Veracity IBKR Connector\" /F"; Flags: runhidden; Tasks: !autorun
