Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
Name "Canvas Sidekick (Rust candidate)"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!ifdef PORTABLE
OutFile "${OUTPUT}\Canvas-Sidekick-Rust-${VERSION}-portable.exe"
SilentInstall silent
Section
 InitPluginsDir
 SetOutPath "$PLUGINSDIR\sidekick"
 File "${BINARIES}\canvas-sidekick.exe"
 File "${BINARIES}\canvas-sidekick-auth.exe"
 SetOutPath "$PLUGINSDIR\sidekick\migration"
 File "${ROOT}\tools\legacy-export.cjs"
 SetOutPath "$PLUGINSDIR\sidekick\licenses"
 File /r "${NOTICES}\*"
 System::Call 'kernel32::SetEnvironmentVariableW(w "CANVAS_SIDEKICK_PORTABLE_EXECUTABLE", w "$EXEPATH") i.r0'
 ${GetParameters} $0
 ExecWait '"$PLUGINSDIR\sidekick\canvas-sidekick.exe" $0' $1
 SetErrorLevel $1
SectionEnd
!else
OutFile "${OUTPUT}\Canvas-Sidekick-Rust-${VERSION}-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\CanvasSidekickRust"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section
 SetOutPath "$INSTDIR"
 File "${BINARIES}\canvas-sidekick.exe"
 File "${BINARIES}\canvas-sidekick-auth.exe"
 SetOutPath "$INSTDIR\migration"
 File "${ROOT}\tools\legacy-export.cjs"
 SetOutPath "$INSTDIR\licenses"
 File /r "${NOTICES}\*"
 SetOutPath "$INSTDIR"
 WriteUninstaller "$INSTDIR\uninstall.exe"
 CreateShortcut "$SMPROGRAMS\Canvas Sidekick (Rust candidate).lnk" "$INSTDIR\canvas-sidekick.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CanvasSidekickRust" "DisplayName" "Canvas Sidekick (Rust candidate)"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CanvasSidekickRust" "DisplayVersion" "${VERSION}"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CanvasSidekickRust" "UninstallString" '$"$INSTDIR\uninstall.exe$"'
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CanvasSidekickRust" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CanvasSidekickRust" "NoRepair" 1
SectionEnd
Section "Uninstall"
 ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Canvas Sidekick"
 StrCmp $0 '$"$INSTDIR\canvas-sidekick.exe$"' 0 +2
 DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Canvas Sidekick"
 Delete "$SMPROGRAMS\Canvas Sidekick (Rust candidate).lnk"
 Delete "$INSTDIR\canvas-sidekick.exe"
 Delete "$INSTDIR\canvas-sidekick-auth.exe"
 Delete "$INSTDIR\migration\legacy-export.cjs"
 RMDir "$INSTDIR\migration"
 RMDir /r "$INSTDIR\licenses"
 Delete "$INSTDIR\uninstall.exe"
 RMDir "$INSTDIR"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CanvasSidekickRust"
 ; Keep both application profiles and protected credentials.
SectionEnd
!endif
