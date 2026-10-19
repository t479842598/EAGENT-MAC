# NX Open API Notes (verified on NX 10)

Member names often differ from intuition. Verify by reflection before guessing:

    $asm=[Reflection.Assembly]::LoadFrom("$env:UGII_BASE_DIR\UGII\managed\NXOpen.dll")
    $asm.GetTypes() | ? { $_.FullName -eq 'NXOpen.Features.ExtrudeBuilder' } |
      % { $_.GetProperties() | % { $_.Name + ' : ' + $_.PropertyType.Name } }

## Entry point
- Session.GetSession()
- theSession.Parts.Work  (open part)  |  theSession.Parts.NewDisplay(path, Part.Units.Millimeters)
- Last body after a commit: workPart.Bodies.ToArray()(n-1)
  (Feature.GetBodies() does NOT exist on NX10)

## Primitives
| Feature | Builder | Key calls |
|---|---|---|
| Block | `wp.Features.CreateBlockFeatureBuilder(Nothing)` | `.Type = ...OriginAndEdgeLengths` ; `.SetOriginAndLengths(pt,"L","W","H")` |
| Cylinder | `wp.Features.CreateCylinderBuilder(Nothing)` | `.Type = ...AxisDiameterAndHeight` ; `.Diameter.Value` ; `.Height.Value` ; `.Origin` ; `.Direction` |
| Extrude | `wp.Features.CreateExtrudeBuilder(Nothing)` | see below |

Sizes are `Expression` objects: set `.Value` (a double), NOT `.SetFormula`.

## Section from dumb curves (for extrude)
    Dim sec As Section = wp.Sections.CreateSection()
    Dim rule As CurveDumbRule = wp.ScRuleFactory.CreateRuleCurveDumb(curves)
    Dim rules() As SelectionIntentRule = {rule}
    sec.AddToSection(rules, curves(0), Nothing, Nothing, helpPt, Section.Mode.Create, False)

## Extrude limits (GOTCHA)
`Extend.Value` is READ-ONLY. Set the type then the right-hand-side string:
    ext.Limits.StartExtend.TrimType = GeometricUtilities.Extend.ExtendType.Value
    ext.Limits.StartExtend.Value.RightHandSide = "0"
    ext.Limits.EndExtend.Value.RightHandSide   = "2"

## Extrude direction (GOTCHA)
No direction -> NXException "No axis selected".
    ext.Direction = wp.Directions.CreateDirection(New Point3d(0,0,0), New Vector3d(0,0,1), SmartObject.UpdateOption.WithinModeling)

## Curves
- Line: `wp.Curves.CreateLine(New Point3d(x1,y1,0), New Point3d(x2,y2,0))`
- Arc (3-point): `wp.Curves.CreateArc(p1, pOn, p2, alternateSolution, ByRef flipped)`
- Arc (center/angle): `wp.Curves.CreateArc(center, matrix, radius, startAngle, endAngle)`

## Boolean
    Dim b As BooleanBuilder = wp.Features.CreateBooleanBuilder(Nothing)
    b.Operation = Feature.BooleanType.Subtract   ' or Unite / Intersect
    b.Target = targetBody
    b.Tool   = toolBody
    Dim f As Feature = b.CommitFeature()
`Tool` is deprecated (works) - modern path is `ToolBodyCollector`.

## Feature builders seen (not yet wrapped)
- Fillet: `Features.EdgeBlendBuilder` (edges via ScCollector)
- Chamfer: `Features.ChamferBuilder` (`.FirstOffset`, `.SecondOffsetExp`, `.Angle`)
- Pattern: `Features.PatternFeatureBuilder` (`.PatternService`, `.FeatureList`)

## Misc
- Always `CommitFeature()` then `Destroy()` the builder.
- `GetUnloadOption` returns `Session.LibraryUnloadOption.Immediately`.
- `run_journal.exe <journal.vb>` prints "Execution was successful." on success.
## ===== Verified additions (real journal runs, NX10) =====

## Session / Part
- New part: `s.Parts.NewDisplay(path, Part.Units.Millimeters)`.
  GOTCHA: fails with `NXException: File already exists` if the .prt is there.
  Delete the target file first, or use a fresh name.
- Open existing: `s.Parts.OpenDisplay(path, ByRef loadStatus As PartLoadStatus)`.
  The out `loadStatus` arg is REQUIRED (no 1-arg overload).
- Part name: `.Name` / `.Leaf` / `.FullPath` (NOT `LeafName`).

## Edge endpoints (how to read them)
- `edge.GetVertices(ByRef p0 As Point3d, ByRef p1 As Point3d)` -> two out Point3d.
- There is NO `Edge.StartPoint` / `Edge.EndPoint`, NO `NXOpen.Vertex` to cast.
- `Point3d` is a VALUE type: `p0 IsNot Nothing` will NOT compile. Compare coords.
- Pick vertical edges of a block (for corner fillets):
    Dim p0,p1 As Point3d
    ed.GetVertices(p0,p1)
    If Math.Abs(p0.X-p1.X)<0.001 And Math.Abs(p0.Y-p1.Y)<0.001 And Math.Abs(p0.Z-p1.Z)>1 Then ...

## Sphere (e.g. ball ends)
    Dim sb As SphereBuilder = wp.Features.CreateSphereBuilder(Nothing)
    sb.Type = SphereBuilder.Types.CenterPointAndDiameter
    sb.CenterPoint = wp.Points.CreatePoint(New Point3d(cx,cy,cz))   ' needs a Point object
    sb.Diameter.Value = 12
    Dim f As Feature = sb.CommitFeature() : sb.Destroy()
- Flat a ball to length L: INTERSECT with a block of height L (works cleanly).

## Cylinder direction (free axis)
`CylinderBuilder.Direction` accepts ANY Vector3d, so side/cross holes need no datum:
    cross hole along X: Origin=(-12,0,z), Direction=New Vector3d(1,0,0), Height>length

## READ dimensions out of ANY existing .prt (reverse-engineering)
This is the reliable way to recover a model's true sizes (STEP export does NOT work):
1. Expressions (every dimension):
     For Each e As Expression In wp.Expressions.ToArray()
       ' e.Name, e.Equation, e.Value, e.RightHandSide, e.Units
2. Features (build order):
     For Each f In wp.Features.ToArray()   ' f.FeatureType, f.Name
   GOTCHA: `f.Location` throws "Feature has no origin" for some features - guard it.
3. Sketches (2D outlines):
     For Each sk In wp.Sketches.ToArray()
       Dim g() As NXObject = sk.GetAllGeometry()
       ' TryCast to Line -> .StartPoint/.EndPoint ; to Arc -> .CenterPoint/.Radius/.StartAngle/.EndAngle
- Sketch: `.AttachPlane`, `.Origin`. Angles are radians.

## ScRuleFactory extras
- `CreateRuleCurveDumb(Curve[])`, `CreateRuleCurveDumbFromPoints(Point[])`,
  `CreateRuleEdgeDumb(Edge[])`.
- Sketch outline -> extrude uses `CreateRuleCurveDumb`.

## Reflection helper (locate any member)
    $asm=[Reflection.Assembly]::LoadFrom("$env:UGII_BASE_DIR\UGII\managed\NXOpen.dll")
    $asm.GetTypes() | ? { $_.FullName -eq 'NXOpen.Face' } | % { $_.GetProperties() | % { $_.Name } }
Confirmed by this method:
- `Face.SolidFaceType : FaceType` enum = Rubber,Planar,Cylindrical,Conical,Spherical,...
- `Arc : Conic`; Arc.Radius/.CenterPoint/.StartAngle/.EndAngle are Doubles/Point3d.
- `Part.Expressions : ExpressionCollection` ; `.ToArray()`.

## Boolean gotcha
`BooleanBuilder.Tool` setter is deprecated (still works). NX prefers `ToolBodyCollector`.
For simple subtract just keep using `.Tool`; output stays clean.