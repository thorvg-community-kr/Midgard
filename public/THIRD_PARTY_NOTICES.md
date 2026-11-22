# Midgard — licenses and third-party notices

Midgard's project license is [GNU GPL version 3](LICENSE.txt). The complete project license remains unchanged from the source repository. The components and assets below retain their own notices.

## Rendering

[ThorVG WebCanvas](https://github.com/thorvg/thorvg.web), package `@thorvg/webcanvas` version 1.1.3, supplies the vector rendering engine. Copyright © 2023–2026 ThorVG Project. It is distributed under the [MIT license](licenses/ThorVG-WebCanvas-1.1.3.txt), copied verbatim from the installed package. The build also includes that notice alongside the WebAssembly rendering module.

Midgard applies a version- and checksum-verified compatibility patch from `scripts/patch-webcanvas.mjs` during asset preparation. It gives owned JavaScript paint wrappers one native reference for their lifetime, instead of adding another reference on every scene attachment, clip or mask change. The WebAssembly engine is unchanged. Ownership regression tests cover repeated reordering beyond the native reference counter's range.

The opening Powered by ThorVG animation is supplied separately. See its [source and provenance notice](assets/branding/NOTICE.md).

## Fonts

The interface is written in **Alegreya Sans** (Medium and ExtraBold), and its titles, the title lettering and the combat numbers in **Cinzel**. The Cinzel title face takes its ten figures from **Alegreya** Bold, because Cinzel draws 1 like the letter I. All three are licensed under the SIL Open Font License, Version 1.1: see the [Alegreya Sans notice](licenses/AlegreyaSans-OFL.txt), the [Alegreya notice](licenses/Alegreya-OFL.txt) and the [Cinzel notice](licenses/Cinzel-OFL.txt). The shipped files are subsets: the Latin characters the game writes, lining tabular figures, and pair kerning flattened into a `kern` table.

Korean text uses **Noto Sans KR** and **Noto Sans KR Bold**, and Korean titles **Noto Serif KR** ExtraBold, under the same license: see the [Noto Sans KR notice](assets/native-fonts/NotoSansKR.LICENSE) and the [Noto Serif KR notice](licenses/NotoSerifKR-OFL.txt).

**DejaVu Sans** and **DejaVu Sans Bold** remain in `assets/native-fonts/` for the creative tools' labels and for any character the faces above cannot write. The fonts retain the Bitstream Vera font license; DejaVu changes are in the public domain. See the [complete font notice](assets/native-fonts/DejaVuSans.LICENSE) and the [DejaVu project](https://dejavu-fonts.github.io/).

## Lua extension interpreter

The optional original HUD scripting extension uses **Lua 5.4.8**, compiled to WebAssembly. The game logic and interpreter bridge are TypeScript. Copyright © 1994–2025 Lua.org, PUC-Rio. Lua is distributed under its [MIT license](licenses/Lua-5.4.8.txt). See [Lua's license and copyright](https://www.lua.org/license.html).

## Original sound and artwork

Music, environmental sounds, effects and generated voice banks retain the [original audio provenance and licensing notice](assets/audio/NOTICE.md). That notice identifies the Loach procedural packs, the CC0 dedication for the Nature of Greoni pack and generated cat call, and the Qwen3-TTS voice-generation provenance. These sounds are shipped as original Ogg assets and/or PCM decoded from those assets; no speech model runs in the game.

Building, character, wildlife and world vector artwork is carried over from the original game source under the project license. Midgard's display name does not change those assets' provenance or licensing. The opening saga painting (`assets/saga/midgard.jpg`) is original artwork made for this project and is distributed under the project license.
