# nx-auto-modeling

Build Siemens NX parts **from the command line** using NX Open VB journals.
No GUI clicking for the model itself - write a small VB script, run it, get a `.prt`.

Think of it as a **toolbox of reusable modeling "bricks"**. Assemble bricks to make a
part; add new bricks as you meet new shapes.

## What it can do
- Primitives: block, cylinder (and any curve profile) extruded into a solid
- Cut holes / slots / pockets via boolean subtract
- Combine: unite, subtract, intersect
- Save `.prt`, then open it in NX

## What it cannot do (be honest)
- **Not** "drop in a drawing, get a model". Drawings vary too much; no tool does that.
- Free-form surfaces (car bodies, turbine blades) - doable in NX, but slower than by hand.
- Best fit: **rule-based parts** - plates, disks, blocks, flanges, brackets, most
  coursework parts with clear dimensions and standard features.

## Requirements
- Siemens NX installed (developed & verified on **NX 10**)
- Env var `UGII_BASE_DIR` pointing at the NX install (e.g. `D:\_EXE\ug10`)
- Windows PowerShell

## Quick start
1. Locate NX (auto, via `UGII_BASE_DIR`).
2. Write/edit a VB journal, or use a template in `templates/`.
3. Run it:

       powershell -ExecutionPolicy Bypass -File .\run.ps1 -Journal .\templates\NxKit.vb -Out .\part.prt

4. Open the `.prt` in NX (double-click, or `Start-Process .\part.prt`).

## Layout
- `templates/NxKit.vb` - core brick functions (MakeBlock, MakeCylinder, MakeExtrude, Bool) + example Main
- `templates/` - ready-to-run part examples
- `snippets/` - single-feature fragments to copy into your journal
- `docs/` - NX Open API notes and pitfalls (version-specific)
- `references/` - worked examples (block+holes, profile extrude)

## Writing a journal
See `SKILL.md` for the full workflow and `docs/api-notes.md` for the correct NX Open
member names (several differ from intuition - verify by reflection before guessing).

## License
MIT. See `LICENSE` and `NOTICE`.