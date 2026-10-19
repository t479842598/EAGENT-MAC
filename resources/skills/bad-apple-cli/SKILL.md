---
name: bad-apple-cli
description: Play any video as a synchronized ASCII-art animation with audio directly in a Windows cmd/PowerShell console, using a portable ffmpeg and the built-in csc compiler. No software installation required.
version: 1.0.0
license: MIT
---

# Bad Apple CLI

Render a video as a frame-by-frame ASCII animation inside a Windows console, with audio kept in sync. Produces a double-clickable `.bat` launcher. Nothing is installed into the system (portable ffmpeg in a local `tools` folder, deleted with the folder).

## When to use

- User wants a video (Bad Apple or any clip) played as console ASCII art.
- No ffmpeg / Python is installed and the user forbids installing software.
- Output should be a green, self-contained folder that runs by double-clicking a bat.
- Best for high-contrast / silhouette footage.

Not for: color ANSI block art, frame-perfect sync, or audio-only playback.

## Core approach

1. Portable ffmpeg extracts the video to grayscale rawvideo and the audio to PCM wav.
2. The built-in `csc.exe` compiles a small C# player that maps gray bytes to characters and redraws with a cursor reset; `System.Media.SoundPlayer` plays the wav.
3. A `.bat` launcher sets the code page and window size, then calls the player.

Do NOT try to grab frames with Windows media APIs. All were tested and fail:
- WPF `MediaPlayer` + `RenderTargetBitmap` -> all-black (hardware layer not captured).
- WinRT `MediaComposition` / `MediaClip` -> Duration=0, cannot decode Bilibili-encoded mp4.
- `MediaElement` + `CopyFromScreen` / `PrintWindow` -> still black.

## Workflow

1. Probe the environment: `Get-Command ffmpeg,python,git,winget,curl,tar,node`.
   A `python.exe` under `WindowsApps` is a store stub and is NOT usable.
2. Get a portable ffmpeg (never install). Speed-test mirrors first; `ghfast.top` is usually fastest:
   `https://ghfast.top/https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip`
   Download with curl in the background, logs to separate files. Extract with `tar.exe -xf ffmpeg.zip -C tools\ffmpeg`.
3. Extract frames:
   `ffmpeg.exe -hide_banner -nostdin -y -i "video.mp4" -vf "fps=15,scale=88:33" -pix_fmt gray -f rawvideo frames.gray`
   Frame size = width*height bytes (88*33 = 2904). Frame count = file bytes / 2904.
4. Extract audio:
   `ffmpeg.exe -hide_banner -nostdin -y -i "video.mp4" -vn -ac 1 -ar 22050 -acodec pcm_s16le audio.wav`
   PCM wav is required by SoundPlayer. Mono 22050 Hz is enough.
5. Compile the player with the built-in compiler:
   `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:ba.exe render.cs`
   Player usage: `ba.exe frames.gray [inv] [audio.wav]`.
6. Write `start.bat` (GBK/936) and launch in a new cmd window.

## Sizing rules

- 88x33 characters maps to a cmd of 88 cols x 33 lines.
- Character cells are ~2:1 tall, so height ~ half the width.
- Choose mapping by background brightness, NOT by subject: light background / dark silhouette -> do NOT pass `inv`; dark background / light silhouette -> pass `inv`. Render one frame and eyeball it before committing.
- Character ramp, dark to bright: ` .:-=+*#%@`.

## Audio sync rules

- Audio and video both start at t=0.
- The player paces frames with a `Stopwatch`: target time of frame f = (f+1)*1000/fps, sleep the remainder. Error stays in the tens of ms.
- `SoundPlayer.Play()` is asynchronous and does not block the main loop.
- Do NOT use two processes (ffplay + player): startup lag ruins sync and may pop a window.

## Pitfalls

- Tool output is capped (~4k chars): run downloads / encoding via `Start-Process` in the background, log to files, return immediately.
- `RedirectStandardOutput` and `RedirectStandardError` must not point to the same file.
- `ErrorActionPreference=Stop` treats curl's stderr progress bar as an error; drop it or split streams.
- Paths with spaces must be quoted inside the curl argument string, or curl reports "Bad hostname".
- Write `start.bat` as GBK/936 to match `chcp 936`, avoiding mojibake.

## Files

- `render.cs` - C# player source (grayscale -> chars, SoundPlayer audio).
- `start.bat` - cmd launcher (chcp 936, mode con 88x34, run player).
