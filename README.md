# luckydraw-web

행사용 럭키드로우 추첨 프로그램입니다.

## macOS 오프라인 앱 만들기

```sh
./build-macos-app.sh
```

빌드가 끝나면 `dist/LuckyDraw.app`을 더블클릭해 실행할 수 있습니다. Windows 버전과 동일한 Chromium 엔진과 동일한 HTML/CSS/JavaScript를 사용하므로 두 운영체제에서 UI가 동일하게 표시됩니다. 엑셀 처리와 축하 효과를 포함한 모든 파일이 앱 안에 들어 있어 실행 시 인터넷 연결이 필요하지 않습니다.

## Windows x64 오프라인 실행 파일 만들기

```sh
./build-windows-exe.sh
```

`dist/windows/LuckyDraw.exe`는 Chromium 런타임과 모든 화면 파일을 포함한 단일 실행 파일입니다. 별도 설치나 인터넷 연결 없이 Windows 10/11 x64에서 실행할 수 있으며 macOS 버전과 같은 UI를 사용합니다.
