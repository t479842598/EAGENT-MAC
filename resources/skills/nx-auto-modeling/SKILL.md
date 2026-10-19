---
name: nx-auto-modeling
description: Automate Siemens NX (UG) solid modeling on Windows via NX Open VB journals run with run_journal.exe. Build primitives (block, cylinder), cut holes and slots via boolean subtract, extrude 2D curve profiles, save .prt, and open results.
version: 1.1.0
license: MIT
---

# NX Auto Modeling

Drive Siemens NX from the command line: write an NX Open VB journal, run it with
run_journal.exe, get a saved .prt. No GUI clicking needed for the model itself.

## When to use
- Build a solid from a drawing / dimension list.
- Primitives (block, cylinder), holes, slots via boolean subtract.
- Extrude a 2D profile (lines + arcs) into a plate-like part.
- Batch-generate or regenerate .prt files.

## Step 1 - Locate NX
Read env vars: UGII_BASE_DIR, UGII_ROOT_DIR. Then:

    $base = [Environment]::GetEnvironmentVariable('UGII_BASE_DIR')   # e.g. D:\_EXE\ug10
    $ugraf = Join-Path $base 'UGII\ugraf.exe'                        # GUI launcher
    $rj    = Join-Path $base 'UGII\run_journal.exe'                  # headless runner

## Step 2 - Write a VB journal
Save a .vb file. Run it:

    & 'D:\_EXE\ug10\UGII\run_journal.exe' 'C:\...\build.vb' 2>&1 | Out-String

Success prints "Execution was successful." + exit 0. Compile errors list "Line N:...".
Runtime errors show a stack trace (often a Null object or missing selection).

## Step 3 - Deliver
Copy the .prt to the working dir. NX LOCKS an open .prt; to overwrite, first
Stop-Process -Name ugraf -Force, wait, then copy.

Open with file association: Start-Process $prt (do NOT pass the file as an arg to
ugraf.exe - it stays on the welcome page).

## Workflow A - Primitives + holes
- Block: BlockFeatureBuilder.Types.OriginAndEdgeLengths + SetOriginAndLengths(pt,"L","W","H")
- Cylinder: CylinderBuilder.Types.AxisDiameterAndHeight (NOT DiameterAndHeight)
- Size: builder.Diameter.Value = 5.0 / Height.Value = 7.0 (Expression.Value, NOT SetFormula)
- Get body: workPart.Bodies.ToArray()(0) after commit. Feature.GetBodies() does NOT exist.
- Boolean: BooleanBuilder, Operation = Feature.BooleanType.Subtract, Target=Body, Tool=Body
- Through-hole: cylinder height MUST exceed thickness AND origin start outside the body.
  E.g. part z=0..5 -> origin z=-1, height=7.

## Workflow B - Extrude a 2D profile
Use for plate-like parts whose outline is lines + arcs (e.g. a track/lever).

1. Draw curves in the XY plane with workPart.Curves:
   - Line:  cc.CreateLine(New Point3d(x1,y1,0), New Point3d(x2,y2,0))
   - Arc:   cc.CreateArc(New Point3d(cx,cy,0), matrix, radius, startAng, endAng)  ' angle form
            or cc.CreateArc(p1, pOn, p2, False, flipped)                          ' 3-point form
2. Build the Section from dumb curves:
   Dim sec As Section = wp.Sections.CreateSection()
   Dim rule = wp.ScRuleFactory.CreateRuleCurveDumb(curvesArray)
   sec.AddToSection(New SelectionIntentRule(){rule}, curvesArray(0), Nothing, Nothing, helpPt, Section.Mode.Create, False)
3. Extrude:
   Dim ext = wp.Features.CreateExtrudeBuilder(Nothing)
   ext.Section = sec
   ext.Direction = wp.Directions.CreateDirection(New Point3d(0,0,0), New Vector3d(0,0,1), SmartObject.UpdateOption.WithinModeling)
   ext.Limits.StartExtend.TrimType = GeometricUtilities.Extend.ExtendType.Value
   ext.Limits.EndExtend.TrimType   = GeometricUtilities.Extend.ExtendType.Value
   ext.Limits.StartExtend.Value.RightHandSide = "0"   ' Value is READONLY; set RightHandSide
   ext.Limits.EndExtend.Value.RightHandSide   = "2"
   Dim f = ext.CommitFeature() : ext.Destroy()

## Geometry - tangency math (critical)
Profiles rarely have explicit tangent points. Compute them ANALYTICALLY, never by eye:
- External tangent between two circles (r1 at C1, r2 at C2):
  angle = atan2(C2-C1); inner = asin((r2-r1)/d)
  T1 = C1 + r1 * (cos(angle +/- inner), sin(angle +/- inner))
  T2 = C2 + r2 * (same direction)
- A fillet arc of radius R with center O runs between two tangent lines/arcs; solve
  the tangent points from the adjacent circle centers.
- Verify: every arc's start/end point must be shared exactly with the neighbour's.
  Tiny mismatches (0.1mm) break the section - reuse identical Point3d values.

## Threaded holes
2xM6-7H = two M6 internal-thread holes. Model the tap drill (dia 5.0 for M6). True
helical threads need HolePackageBuilder + thread tables.

## Verify API names (don't guess)
Reflect the managed dll:

    $asm=[Reflection.Assembly]::LoadFrom('D:\_EXE\ug10\UGII\managed\NXOpen.dll')
    $asm.GetTypes() | ? { $_.FullName -eq 'NXOpen.Features.ExtrudeBuilder' } |
      % { $_.GetProperties() | % { $_.Name + ' : ' + $_.PropertyType.Name } }

## Pitfalls
- Extend.Value is READ-ONLY -> set .RightHandSide (a string) instead.
- Extrude with no Direction -> NXException "No axis selected".
- Old API Feature.GetBodies() does not exist -> use workPart.Bodies.
- BooleanBuilder.Tool (Body) is deprecated but works; ToolBodyCollector is the new way.
- run_journal spawns a NEW NX process; it cannot act on an already-open GUI part.
  To reframe the user's open view, use GUI keys (Ctrl+F) instead.
- Temp dir rotates between sessions; write scripts to the CURRENT temp dir.
- Avoid Start-Sleep > ~5s in one tool call (may time out).
- Always CommitFeature() then Destroy() the builder. GetUnloadOption = Immediately.
## Before you start
- Read `docs/pitfalls.md` first. It lists API dead-ends (thread holes, STEP export,
  self-intersecting sketch extrudes) with the workarounds that actually worked.
- Read `docs/api-notes.md` for verified member names (Edge.GetVertices, SphereBuilder,
  Part.Expressions, ...). Several differ from intuition.

## Workflow C - reverse-engineer an existing .prt
When the user hands you a "standard"/reference part and you must match its sizes:
1. Open it read-only and dump ALL dimensions:
     For Each e As Expression In wp.Expressions.ToArray()   ' Name / Equation / Value
2. Dump the feature tree:
     For Each f In wp.Features.ToArray()                    ' f.FeatureType, f.Name
   (guard `f.Location` - it throws for some features)
3. If it was sketch-based, dump the outlines:
     For Each sk In wp.Sketches.ToArray()
       sk.GetAllGeometry()  ' Line: StartPoint/EndPoint ; Arc: CenterPoint/Radius/angles
4. Rebuild with primitives + booleans when possible (see pitfalls #3).
   Do NOT try to export STEP to read geometry - it does not write a file (pitfalls #2).

## Deliver
- Copy the final .prt into the user's working dir.
- NX LOCKS an open .prt; to overwrite, first Stop-Process -Name ugraf -Force, wait, then copy.
- Open with file association: Start-Process $prt (do NOT pass the file as an arg to ugraf.exe).