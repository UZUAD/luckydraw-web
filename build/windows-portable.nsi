Unicode true
SilentInstall silent
SilentUnInstall silent
AutoCloseWindow true
WindowIcon off
ShowInstDetails nevershow
RequestExecutionLevel user
Name "LuckyDraw"
OutFile "${OUTPUT_FILE}"
SetCompressor /SOLID lzma

Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\LuckyDraw"
  File /r "${APP_SOURCE}/*.*"
  ExecWait '"$PLUGINSDIR\LuckyDraw\LuckyDraw.exe"'
SectionEnd
