# Profile Extrude Template (track / plate)

Verified on NX 10. Builds a 2mm-thick plate whose outline is lines + arcs,
then cuts a slot and a hole. Coordinates: slot centerline = Y0; slot left
circle center = (0,0), right = (118,0); top edge Y=12.

## Track.vb

    Imports System
    Imports NXOpen
    Imports NXOpen.Features

    Module NXJournal
      Sub Main()
        Dim s As Session = Session.GetSession()
        Dim outPath As String = "C:\tmp\track.prt"
        Dim wp As Part = Nothing
        Try
          wp = s.Parts.Work
        Catch
          wp = Nothing
        End Try
        If wp Is Nothing Then wp = s.Parts.NewDisplay(outPath, Part.Units.Millimeters)

        Dim cc As CurveCollection = wp.Curves
        Dim fl As Boolean

        ' --- outline: top line, right R12 arc, bottom tangent, R8 arc, left tangent, R12 fillet ---
        Dim p1 As Line = cc.CreateLine(New Point3d(0,12,0), New Point3d(118,12,0))
        Dim a1 As Arc = cc.CreateArc(New Point3d(118,12,0), New Point3d(130,0,0), New Point3d(120.1163,-11.8120,0), False, fl)
        Dim p2 As Line = cc.CreateLine(New Point3d(120.1163,-11.8120,0), New Point3d(-8.5891,-34.8746,0))
        Dim a2 As Arc = cc.CreateArc(New Point3d(-8.5891,-34.8746,0), New Point3d(-15.6570,-32.6570,0), New Point3d(-17.8149,-25.2891,0), False, fl)
        Dim p3 As Line = cc.CreateLine(New Point3d(-17.8149,-25.2891,0), New Point3d(-11.7223,2.5663,0))
        Dim a3 As Arc = cc.CreateArc(New Point3d(-11.7223,2.5663,0), New Point3d(-8.4853,8.4853,0), New Point3d(0,12,0), False, fl)
        Dim mc() As Curve = {p1, a1, p2, a2, p3, a3}
        Dim body As Body = MakeExtrude(wp, mc, 0.0, 2.0)

        ' --- slot 10 wide, ends concentric with the two R12 ---
        Dim s1 As Line = cc.CreateLine(New Point3d(0,5,0), New Point3d(118,5,0))
        Dim sa1 As Arc = cc.CreateArc(New Point3d(118,5,0), New Point3d(123,0,0), New Point3d(118,-5,0), False, fl)
        Dim s2 As Line = cc.CreateLine(New Point3d(118,-5,0), New Point3d(0,-5,0))
        Dim sa2 As Arc = cc.CreateArc(New Point3d(0,-5,0), New Point3d(-5,0,0), New Point3d(0,5,0), False, fl)
        Dim sc() As Curve = {s1, sa1, s2, sa2}
        body = Subtract(wp, body, MakeExtrude(wp, sc, -1.0, 3.0))

        ' --- dia 10 hole ---
        Dim cb As CylinderBuilder = wp.Features.CreateCylinderBuilder(Nothing)
        cb.Type = CylinderBuilder.Types.AxisDiameterAndHeight
        cb.Diameter.Value = 10.0
        cb.Height.Value = 4.0
        cb.Origin = New Point3d(-10,-27,-1)
        cb.Direction = New Vector3d(0,0,1)
        Dim cf As Feature = cb.CommitFeature()
        cb.Destroy()
        Dim arr() As Body = wp.Bodies.ToArray()
        body = Subtract(wp, body, arr(arr.Length-1))

        Dim st As PartSaveStatus = wp.Save(Part.SaveComponents.True, Part.CloseAfterSave.False)
        st.Dispose()
        s.LogFile.WriteLine("TRACK_DONE_OK")
      End Sub

      Function MakeExtrude(wp As Part, curves() As Curve, z0 As Double, z1 As Double) As Body
        Dim ext As ExtrudeBuilder = wp.Features.CreateExtrudeBuilder(Nothing)
        Dim sec As Section = wp.Sections.CreateSection()
        Dim rule As CurveDumbRule = wp.ScRuleFactory.CreateRuleCurveDumb(curves)
        Dim helpP As New Point3d(0, 0, 0)
        Dim rules() As SelectionIntentRule = {rule}
        sec.AddToSection(rules, curves(0), Nothing, Nothing, helpP, Section.Mode.Create, False)
        ext.Section = sec
        Dim dir As Direction = wp.Directions.CreateDirection(New Point3d(0,0,0), New Vector3d(0,0,1), SmartObject.UpdateOption.WithinModeling)
        ext.Direction = dir
        ext.Limits.StartExtend.TrimType = GeometricUtilities.Extend.ExtendType.Value
        ext.Limits.EndExtend.TrimType = GeometricUtilities.Extend.ExtendType.Value
        ext.Limits.StartExtend.Value.RightHandSide = z0.ToString()
        ext.Limits.EndExtend.Value.RightHandSide = z1.ToString()
        Dim f As Feature = ext.CommitFeature()
        ext.Destroy()
        Dim arr() As Body = wp.Bodies.ToArray()
        Return arr(arr.Length-1)
      End Function

      Function Subtract(wp As Part, target As Body, tool As Body) As Body
        Dim bl As BooleanBuilder = wp.Features.CreateBooleanBuilder(Nothing)
        bl.Operation = Feature.BooleanType.Subtract
        bl.Target = target
        bl.Tool = tool
        Dim bf As Feature = bl.CommitFeature()
        bl.Destroy()
        Dim arr() As Body = wp.Bodies.ToArray()
        Return arr(arr.Length-1)
      End Function

      Function GetUnloadOption(ByVal d As String) As Integer
        Return Session.LibraryUnloadOption.Immediately
      End Function
    End Module

## Run

    $rj  = Join-Path $env:UGII_BASE_DIR 'UGII\run_journal.exe'
    & $rj 'C:\tmp\track.vb' 2>&1 | Out-String
    # expect: Execution was successful.  exit 0

## Key numbers

- Slot: left center (0,0), right center (118,0), width 10.
- Outline top edge Y=12; right R12 center (118,0).
- Hole center (-10,-27), dia 10; R8 boss around it.
- Left fillet R12 center (0,0). Bottom edge = common external tangent R8 & right R12.
- All tangent points above are solved analytically. Reuse identical Point3d values
  between neighbouring curves or the section will not close.