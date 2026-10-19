# Journal Template

Verified on NX 10. Builds an 88 x 27.5 x 5 block with two through-holes
(diameter 5.0, at X = +/-27, Y = 3.25), then saves.

## build_model.vb

    Imports System
    Imports NXOpen
    Imports NXOpen.Features

    Module NXJournal
        Sub Main()
            Dim theSession As Session = Session.GetSession()
            Dim outPath As String = "C:\path\to\part.prt"

            Dim workPart As Part = Nothing
            Try
                workPart = theSession.Parts.Work
            Catch
                workPart = Nothing
            End Try
            If workPart Is Nothing Then
                workPart = theSession.Parts.NewDisplay(outPath, Part.Units.Millimeters)
            End If

            Dim nullFeat As Feature = Nothing

            ' --- Block 88 x 27.5 x 5, centered on XY, bottom at z=0 ---
            Dim blkBld As BlockFeatureBuilder = workPart.Features.CreateBlockFeatureBuilder(nullFeat)
            blkBld.Type = BlockFeatureBuilder.Types.OriginAndEdgeLengths
            blkBld.SetOriginAndLengths(New Point3d(-44.0, -13.75, 0.0), "88", "27.5", "5")
            Dim blkFeat As Feature = blkBld.CommitFeature()
            blkBld.Destroy()

            Dim targetBody As Body = workPart.Bodies.ToArray()(0)

            ' --- Two through-holes: dia 5.0, X = +/-27, Y = 3.25 ---
            Dim xs(1) As Double
            xs(0) = -27.0
            xs(1) = 27.0

            Dim i As Integer
            For i = 0 To 1
                Dim cylBld As CylinderBuilder = workPart.Features.CreateCylinderBuilder(nullFeat)
                cylBld.Type = CylinderBuilder.Types.AxisDiameterAndHeight
                cylBld.Diameter.Value = 5.0
                cylBld.Height.Value = 7.0                       ' > thickness => through
                cylBld.Origin = New Point3d(xs(i), 3.25, -1.0)  ' start below body
                cylBld.Direction = New Vector3d(0.0, 0.0, 1.0)
                Dim cylFeat As Feature = cylBld.CommitFeature()
                cylBld.Destroy()

                ' newest body that is not the target = the cylinder tool
                Dim toolBody As Body = Nothing
                Dim b As Body
                For Each b In workPart.Bodies.ToArray()
                    If b.Tag <> targetBody.Tag Then toolBody = b
                Next

                Dim boolBld As BooleanBuilder = workPart.Features.CreateBooleanBuilder(nullFeat)
                boolBld.Operation = Feature.BooleanType.Subtract
                boolBld.Target = targetBody
                boolBld.Tool = toolBody
                Dim boolFeat As Feature = boolBld.CommitFeature()
                boolBld.Destroy()
            Next

            Dim st As PartSaveStatus = workPart.Save(Part.SaveComponents.True, Part.CloseAfterSave.False)
            st.Dispose()
            theSession.LogFile.WriteLine("MODEL_DONE_OK")
        End Sub

        Function GetUnloadOption(ByVal dummy As String) As Integer
            Return Session.LibraryUnloadOption.Immediately
        End Function
    End Module

## runner.ps1

    $rj  = Join-Path $env:UGII_BASE_DIR 'UGII\run_journal.exe'
    $vb  = "$env:TEMP\build_model.vb"
    $prt = "$env:TEMP\part.prt"
    if (Test-Path $prt) { Remove-Item $prt -Force }

    $out = & $rj $vb 2>&1 | Out-String
    Write-Output $out
    Write-Output ("EXIT: " + $LASTEXITCODE)
    if (Test-Path $prt) { Write-Output ("PRT_OK: " + (Get-Item $prt).Length) }
    else { Write-Output "PRT_MISSING" }

## Notes

- Do NOT use Start-Sleep longer than ~5s in one tool call; it can time out.
- To confirm drilled geometry, check the feature tree in the GUI, or rotate to the
  bottom view; dimensions verify better than eyeballing the isometric.