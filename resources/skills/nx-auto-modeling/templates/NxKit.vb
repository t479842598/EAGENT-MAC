Imports System
Imports NXOpen
Imports NXOpen.Features

Module NxKit

  ' ===== 通用积木函数 (NX10 验证) =====

  Function LastBody(wp As Part) As Body
    Dim a() As Body = wp.Bodies.ToArray()
    Return a(a.Length - 1)
  End Function

  ' 长方体: 角点(x,y,z) + 长L + 宽W + 高H
  Function MakeBlock(wp As Part, x As Double, y As Double, z As Double, L As Double, W As Double, H As Double) As Body
    Dim b As BlockFeatureBuilder = wp.Features.CreateBlockFeatureBuilder(Nothing)
    b.Type = BlockFeatureBuilder.Types.OriginAndEdgeLengths
    b.SetOriginAndLengths(New Point3d(x, y, z), L.ToString(), W.ToString(), H.ToString())
    Dim f As Feature = b.CommitFeature()
    b.Destroy()
    Return LastBody(wp)
  End Function

  ' 圆柱: 中心(cx,cy,cz) 直径dia 高h 轴向+Z
  Function MakeCylinder(wp As Part, cx As Double, cy As Double, cz As Double, dia As Double, h As Double) As Body
    Dim c As CylinderBuilder = wp.Features.CreateCylinderBuilder(Nothing)
    c.Type = CylinderBuilder.Types.AxisDiameterAndHeight
    c.Diameter.Value = dia
    c.Height.Value = h
    c.Origin = New Point3d(cx, cy, cz)
    c.Direction = New Vector3d(0, 0, 1)
    Dim f As Feature = c.CommitFeature()
    c.Destroy()
    Return LastBody(wp)
  End Function

  ' 曲线拉伸成体: 沿+Z 从z0到z1
  Function MakeExtrude(wp As Part, curves() As Curve, z0 As Double, z1 As Double) As Body
    Dim e As ExtrudeBuilder = wp.Features.CreateExtrudeBuilder(Nothing)
    Dim s As Section = wp.Sections.CreateSection()
    Dim r As CurveDumbRule = wp.ScRuleFactory.CreateRuleCurveDumb(curves)
    Dim hp As New Point3d(0, 0, 0)
    Dim rules() As SelectionIntentRule = {r}
    s.AddToSection(rules, curves(0), Nothing, Nothing, hp, Section.Mode.Create, False)
    e.Section = s
    e.Direction = wp.Directions.CreateDirection(New Point3d(0,0,0), New Vector3d(0,0,1), SmartObject.UpdateOption.WithinModeling)
    e.Limits.StartExtend.TrimType = GeometricUtilities.Extend.ExtendType.Value
    e.Limits.EndExtend.TrimType = GeometricUtilities.Extend.ExtendType.Value
    e.Limits.StartExtend.Value.RightHandSide = z0.ToString()
    e.Limits.EndExtend.Value.RightHandSide = z1.ToString()
    Dim f As Feature = e.CommitFeature()
    e.Destroy()
    Return LastBody(wp)
  End Function

  ' 布尔: op=Subtract/Unite/Intersect
  Function Bool(wp As Part, op As Feature.BooleanType, target As Body, tool As Body) As Body
    Dim b As BooleanBuilder = wp.Features.CreateBooleanBuilder(Nothing)
    b.Operation = op
    b.Target = target
    b.Tool = tool
    Dim f As Feature = b.CommitFeature()
    b.Destroy()
    Return LastBody(wp)
  End Function

  ' ===== 在这里写零件 (示例: 88x27.5x5 块 + 两 ?5 通孔) =====
  Sub Main()
    Dim s As Session = Session.GetSession()
    Dim outPath As String = "C:\Users\MICROS~1\AppData\Local\Temp\temp_36503\part.prt"
    Dim wp As Part = s.Parts.NewDisplay(outPath, Part.Units.Millimeters)

    Dim body As Body = MakeBlock(wp, -44, -13.75, 0, 88, 27.5, 5)
    body = Bool(wp, Feature.BooleanType.Subtract, body, MakeCylinder(wp, -27, 3.25, -1, 5, 7))
    body = Bool(wp, Feature.BooleanType.Subtract, body, MakeCylinder(wp, 27, 3.25, -1, 5, 7))

    Dim st As PartSaveStatus = wp.Save(Part.SaveComponents.True, Part.CloseAfterSave.False)
    st.Dispose()
    s.LogFile.WriteLine("DONE_OK")
  End Sub

  Function GetUnloadOption(ByVal d As String) As Integer
    Return Session.LibraryUnloadOption.Immediately
  End Function

End Module