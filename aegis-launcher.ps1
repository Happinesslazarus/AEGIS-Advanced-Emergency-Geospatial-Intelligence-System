Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

# Force UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ── Custom Drawn Panel (gradient background) ──────────────────────────────────
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

public class GradientPanel : Panel {
    public Color GradientStart { get; set; }
    public Color GradientEnd { get; set; }
    public float GradientAngle { get; set; }

    public GradientPanel() {
        DoubleBuffered = true;
        GradientStart = Color.FromArgb(8, 12, 28);
        GradientEnd = Color.FromArgb(15, 25, 50);
        GradientAngle = 135f;
    }

    protected override void OnPaint(PaintEventArgs e) {
        using (var brush = new LinearGradientBrush(ClientRectangle, GradientStart, GradientEnd, GradientAngle)) {
            e.Graphics.FillRectangle(brush, ClientRectangle);
        }
    }
}

public class GlowLabel : Label {
    public Color GlowColor { get; set; }
    public GlowLabel() {
        GlowColor = Color.FromArgb(56, 189, 248);
        BackColor = Color.Transparent;
    }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        // Glow layers
        for (int i = 3; i >= 1; i--) {
            using (var glowBrush = new SolidBrush(Color.FromArgb(15 * i, GlowColor))) {
                e.Graphics.DrawString(Text, Font, glowBrush, new PointF(-i, -i));
                e.Graphics.DrawString(Text, Font, glowBrush, new PointF(i, i));
            }
        }
        using (var mainBrush = new SolidBrush(ForeColor)) {
            e.Graphics.DrawString(Text, Font, mainBrush, new PointF(0, 0));
        }
    }
}

public class RoundedButton : Button {
    public int Radius { get; set; }
    public Color HoverColor { get; set; }
    private bool hovering = false;

    public RoundedButton() {
        Radius = 12;
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        Cursor = Cursors.Hand;
        DoubleBuffered = true;
        HoverColor = Color.Empty;
    }

    protected override void OnMouseEnter(EventArgs e) { hovering = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovering = false; Invalidate(); base.OnMouseLeave(e); }

    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

        var bgColor = (hovering && HoverColor != Color.Empty) ? HoverColor : BackColor;

        using (var path = new GraphicsPath()) {
            var r = new Rectangle(0, 0, Width - 1, Height - 1);
            int d = Radius * 2;
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();

            using (var brush = new SolidBrush(bgColor)) {
                e.Graphics.FillPath(brush, path);
            }

            Region = new Region(path);
        }

        using (var sf = new StringFormat() { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center }) {
            using (var brush = new SolidBrush(ForeColor)) {
                e.Graphics.DrawString(Text, Font, brush, new RectangleF(0, 0, Width, Height), sf);
            }
        }
    }
}

public class StatusCard : Panel {
    public StatusCard() { DoubleBuffered = true; }
    protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var path = new GraphicsPath()) {
            int d = 16;
            var r = new Rectangle(0, 0, Width - 1, Height - 1);
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            using (var brush = new SolidBrush(Color.FromArgb(12, 20, 42))) {
                e.Graphics.FillPath(brush, path);
            }
            using (var pen = new Pen(Color.FromArgb(25, 40, 70), 1)) {
                e.Graphics.DrawPath(pen, path);
            }
        }
    }
}
"@

$script:serverProcess = $null
$script:clientProcess = $null

# ── Main Form ────────────────────────────────────────────────────────────────
$form = New-Object System.Windows.Forms.Form
$form.Text = "AEGIS"
$form.Size = New-Object System.Drawing.Size(500, 650)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(8, 12, 28)
$form.FormBorderStyle = "FixedSingle"
$form.MaximizeBox = $false

# ── Background gradient ──────────────────────────────────────────────────────
$bg = New-Object GradientPanel
$bg.Dock = "Fill"
$bg.GradientStart = [System.Drawing.Color]::FromArgb(6, 10, 24)
$bg.GradientEnd = [System.Drawing.Color]::FromArgb(12, 22, 48)
$bg.GradientAngle = 160
$form.Controls.Add($bg)

# ── Shield icon (drawn with text) ────────────────────────────────────────────
$shield = New-Object System.Windows.Forms.Label
$shield.Text = ">"  # placeholder, we draw it
$shield.BackColor = [System.Drawing.Color]::Transparent
$shield.Size = New-Object System.Drawing.Size(60, 60)
$shield.Location = New-Object System.Drawing.Point(30, 30)
$shield.Add_Paint({
    param($s, $e)
    $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    # Draw a shield shape
    $points = @(
        (New-Object System.Drawing.PointF(30, 2)),
        (New-Object System.Drawing.PointF(56, 12)),
        (New-Object System.Drawing.PointF(56, 32)),
        (New-Object System.Drawing.PointF(30, 55)),
        (New-Object System.Drawing.PointF(4, 32)),
        (New-Object System.Drawing.PointF(4, 12))
    )
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0,0)),
        (New-Object System.Drawing.Point(0,55)),
        [System.Drawing.Color]::FromArgb(56, 189, 248),
        [System.Drawing.Color]::FromArgb(20, 120, 200)
    )
    $e.Graphics.FillPolygon($brush, $points)
    $brush.Dispose()
    # Inner shield
    $inner = @(
        (New-Object System.Drawing.PointF(30, 8)),
        (New-Object System.Drawing.PointF(50, 16)),
        (New-Object System.Drawing.PointF(50, 30)),
        (New-Object System.Drawing.PointF(30, 49)),
        (New-Object System.Drawing.PointF(10, 30)),
        (New-Object System.Drawing.PointF(10, 16))
    )
    $innerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(10, 18, 40))
    $e.Graphics.FillPolygon($innerBrush, $inner)
    $innerBrush.Dispose()
    # Check mark
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(52, 211, 153), 3)
    $e.Graphics.DrawLine($pen, 20, 30, 27, 38)
    $e.Graphics.DrawLine($pen, 27, 38, 40, 20)
    $pen.Dispose()
})
$bg.Controls.Add($shield)

# ── Title ────────────────────────────────────────────────────────────────────
$title = New-Object GlowLabel
$title.Text = "AEGIS"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 38, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(56, 189, 248)
$title.GlowColor = [System.Drawing.Color]::FromArgb(56, 189, 248)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(95, 22)
$bg.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "Advanced Emergency Geospatial Intelligence System"
$subtitle.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(80, 110, 150)
$subtitle.BackColor = [System.Drawing.Color]::Transparent
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(98, 76)
$bg.Controls.Add($subtitle)

# ── Separator line ───────────────────────────────────────────────────────────
$sep = New-Object System.Windows.Forms.Label
$sep.Size = New-Object System.Drawing.Size(440, 1)
$sep.Location = New-Object System.Drawing.Point(30, 108)
$sep.BackColor = [System.Drawing.Color]::FromArgb(25, 40, 70)
$bg.Controls.Add($sep)

# ── Status Card ──────────────────────────────────────────────────────────────
$card = New-Object StatusCard
$card.Size = New-Object System.Drawing.Size(440, 220)
$card.Location = New-Object System.Drawing.Point(30, 125)
$card.BackColor = [System.Drawing.Color]::Transparent
$bg.Controls.Add($card)

$cardTitle = New-Object System.Windows.Forms.Label
$cardTitle.Text = "SYSTEM STATUS"
$cardTitle.Font = New-Object System.Drawing.Font("Segoe UI", 8, [System.Drawing.FontStyle]::Bold)
$cardTitle.ForeColor = [System.Drawing.Color]::FromArgb(60, 85, 120)
$cardTitle.BackColor = [System.Drawing.Color]::Transparent
$cardTitle.AutoSize = $true
$cardTitle.Location = New-Object System.Drawing.Point(20, 15)
$card.Controls.Add($cardTitle)

function New-StatusRow($parent, $y, $label, $icon) {
    $iconLbl = New-Object System.Windows.Forms.Label
    $iconLbl.Text = $icon
    $iconLbl.Font = New-Object System.Drawing.Font("Segoe UI", 16)
    $iconLbl.ForeColor = [System.Drawing.Color]::FromArgb(40, 60, 90)
    $iconLbl.BackColor = [System.Drawing.Color]::Transparent
    $iconLbl.AutoSize = $true
    $iconLbl.Location = New-Object System.Drawing.Point(20, $y)
    $parent.Controls.Add($iconLbl)

    $nameLbl = New-Object System.Windows.Forms.Label
    $nameLbl.Text = $label
    $nameLbl.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 11)
    $nameLbl.ForeColor = [System.Drawing.Color]::FromArgb(160, 180, 210)
    $nameLbl.BackColor = [System.Drawing.Color]::Transparent
    $nameLbl.AutoSize = $true
    $nameLbl.Location = New-Object System.Drawing.Point(52, ($y + 2))
    $parent.Controls.Add($nameLbl)

    $statusLbl = New-Object System.Windows.Forms.Label
    $statusLbl.Text = "Offline"
    $statusLbl.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $statusLbl.ForeColor = [System.Drawing.Color]::FromArgb(80, 95, 120)
    $statusLbl.BackColor = [System.Drawing.Color]::Transparent
    $statusLbl.AutoSize = $false
    $statusLbl.Size = New-Object System.Drawing.Size(120, 22)
    $statusLbl.TextAlign = "MiddleRight"
    $statusLbl.Location = New-Object System.Drawing.Point(300, ($y + 3))
    $parent.Controls.Add($statusLbl)

    $divider = New-Object System.Windows.Forms.Label
    $divider.Size = New-Object System.Drawing.Size(400, 1)
    $divider.Location = New-Object System.Drawing.Point(20, ($y + 38))
    $divider.BackColor = [System.Drawing.Color]::FromArgb(18, 28, 52)
    $parent.Controls.Add($divider)

    return @{ icon = $iconLbl; name = $nameLbl; status = $statusLbl }
}

$srvRow = New-StatusRow $card 45 "Backend Server" "S"
$cliRow = New-StatusRow $card 95 "Frontend App" "F"
$webRow = New-StatusRow $card 145 "Web Browser" "B"

# ── Main status text ─────────────────────────────────────────────────────────
$mainStatus = New-Object System.Windows.Forms.Label
$mainStatus.Text = "Ready to launch"
$mainStatus.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$mainStatus.ForeColor = [System.Drawing.Color]::FromArgb(70, 100, 140)
$mainStatus.BackColor = [System.Drawing.Color]::Transparent
$mainStatus.AutoSize = $false
$mainStatus.Size = New-Object System.Drawing.Size(440, 28)
$mainStatus.TextAlign = "MiddleCenter"
$mainStatus.Location = New-Object System.Drawing.Point(30, 360)
$bg.Controls.Add($mainStatus)

# ── Custom progress bar (drawn) ──────────────────────────────────────────────
$progressPanel = New-Object System.Windows.Forms.Panel
$progressPanel.Size = New-Object System.Drawing.Size(440, 6)
$progressPanel.Location = New-Object System.Drawing.Point(30, 393)
$progressPanel.BackColor = [System.Drawing.Color]::FromArgb(15, 22, 42)
$script:progressValue = 0
$progressPanel.Add_Paint({
    param($s, $e)
    $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    # Background track
    $trackBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(15, 25, 48))
    $e.Graphics.FillRectangle($trackBrush, 0, 0, $s.Width, $s.Height)
    $trackBrush.Dispose()
    # Fill
    if ($script:progressValue -gt 0) {
        $fillWidth = [int]($s.Width * ($script:progressValue / 100.0))
        if ($fillWidth -gt 0) {
            $gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
                (New-Object System.Drawing.Point(0,0)),
                (New-Object System.Drawing.Point($fillWidth,0)),
                [System.Drawing.Color]::FromArgb(56, 189, 248),
                [System.Drawing.Color]::FromArgb(52, 211, 153)
            )
            $e.Graphics.FillRectangle($gradBrush, 0, 0, $fillWidth, $s.Height)
            $gradBrush.Dispose()
        }
    }
})
$bg.Controls.Add($progressPanel)

function Set-Progress($val) {
    $script:progressValue = $val
    $progressPanel.Invalidate()
}

# ── Launch Button ─────────────────────────────────────────────────────────────
$launchBtn = New-Object RoundedButton
$launchBtn.Text = "Launch AEGIS"
$launchBtn.Font = New-Object System.Drawing.Font("Segoe UI", 15, [System.Drawing.FontStyle]::Bold)
$launchBtn.Size = New-Object System.Drawing.Size(440, 60)
$launchBtn.Location = New-Object System.Drawing.Point(30, 415)
$launchBtn.BackColor = [System.Drawing.Color]::FromArgb(56, 189, 248)
$launchBtn.ForeColor = [System.Drawing.Color]::FromArgb(5, 10, 25)
$launchBtn.HoverColor = [System.Drawing.Color]::FromArgb(70, 210, 255)
$launchBtn.Radius = 14
$bg.Controls.Add($launchBtn)

# ── Stop Button ──────────────────────────────────────────────────────────────
$stopBtn = New-Object RoundedButton
$stopBtn.Text = "Stop"
$stopBtn.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 11)
$stopBtn.Size = New-Object System.Drawing.Size(440, 44)
$stopBtn.Location = New-Object System.Drawing.Point(30, 485)
$stopBtn.BackColor = [System.Drawing.Color]::FromArgb(15, 22, 42)
$stopBtn.ForeColor = [System.Drawing.Color]::FromArgb(70, 90, 120)
$stopBtn.HoverColor = [System.Drawing.Color]::FromArgb(60, 20, 20)
$stopBtn.Radius = 12
$stopBtn.Enabled = $false
$bg.Controls.Add($stopBtn)

# ── Footer ───────────────────────────────────────────────────────────────────
$footer = New-Object System.Windows.Forms.Label
$footer.Text = "Emergency Management Platform"
$footer.Font = New-Object System.Drawing.Font("Segoe UI", 8)
$footer.ForeColor = [System.Drawing.Color]::FromArgb(35, 50, 75)
$footer.BackColor = [System.Drawing.Color]::Transparent
$footer.AutoSize = $false
$footer.Size = New-Object System.Drawing.Size(440, 20)
$footer.TextAlign = "MiddleCenter"
$footer.Location = New-Object System.Drawing.Point(30, 545)
$bg.Controls.Add($footer)

# ── Helpers ───────────────────────────────────────────────────────────────────
function Set-RowState($row, $state) {
    switch ($state) {
        "offline" {
            $row.icon.ForeColor = [System.Drawing.Color]::FromArgb(40, 60, 90)
            $row.status.Text = "Offline"
            $row.status.ForeColor = [System.Drawing.Color]::FromArgb(80, 95, 120)
        }
        "starting" {
            $row.icon.ForeColor = [System.Drawing.Color]::FromArgb(250, 200, 50)
            $row.status.Text = "Starting..."
            $row.status.ForeColor = [System.Drawing.Color]::FromArgb(250, 200, 50)
        }
        "online" {
            $row.icon.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
            $row.status.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
        }
    }
}

function Test-Port($port) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", $port)
        $tcp.Close()
        return $true
    } catch { return $false }
}

function Wait-ForPort($port, $maxWait) {
    $elapsed = 0
    while ($elapsed -lt $maxWait) {
        if (Test-Port $port) { return $true }
        Start-Sleep -Milliseconds 500
        [System.Windows.Forms.Application]::DoEvents()
        $elapsed += 500
    }
    return $false
}

# ── Launch Click ──────────────────────────────────────────────────────────────
$launchBtn.Add_Click({
    $launchBtn.Enabled = $false
    $launchBtn.Text = "Starting..."
    $launchBtn.BackColor = [System.Drawing.Color]::FromArgb(30, 80, 120)

    # ── Start Server ──
    $mainStatus.Text = "Starting backend server..."
    $mainStatus.ForeColor = [System.Drawing.Color]::FromArgb(56, 189, 248)
    Set-Progress 10
    Set-RowState $srvRow "starting"
    $form.Refresh()

    $script:serverProcess = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c set PORT=3001 && npx tsx src\index.ts" `
        -WorkingDirectory "e:\aegis-v6-fullstack\aegis-v6\server" `
        -WindowStyle Hidden -PassThru

    # Wait for server to respond
    $mainStatus.Text = "Waiting for server on port 3001..."
    $form.Refresh()
    Set-Progress 25

    if (Wait-ForPort 3001 15000) {
        Set-RowState $srvRow "online"
        $srvRow.status.Text = "Online :3001"
        Set-Progress 45
    } else {
        Set-RowState $srvRow "online"
        $srvRow.status.Text = "Port 3001"
        Set-Progress 45
    }
    $form.Refresh()

    # ── Start Client ──
    $mainStatus.Text = "Starting frontend..."
    Set-RowState $cliRow "starting"
    Set-Progress 55
    $form.Refresh()

    $script:clientProcess = Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c npx vite --host 0.0.0.0 --port 5173" `
        -WorkingDirectory "e:\aegis-v6-fullstack\aegis-v6\client" `
        -WindowStyle Hidden -PassThru

    # Wait for client to respond
    $mainStatus.Text = "Waiting for frontend on port 5173..."
    Set-Progress 70
    $form.Refresh()

    if (Wait-ForPort 5173 20000) {
        Set-RowState $cliRow "online"
        $cliRow.status.Text = "Online :5173"
        Set-Progress 90
    } else {
        $cliRow.status.Text = "Check port"
        $cliRow.status.ForeColor = [System.Drawing.Color]::FromArgb(250, 200, 50)
        Set-Progress 90
    }
    $form.Refresh()

    # ── Open Browser ──
    $mainStatus.Text = "Opening browser..."
    Set-Progress 95
    $form.Refresh()
    $chromePaths = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
    )
    $chrome = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($chrome) {
        Start-Process $chrome "http://localhost:5173"
    } else {
        Start-Process "http://localhost:5173"
    }
    Start-Sleep -Milliseconds 500

    Set-RowState $webRow "online"
    $webRow.status.Text = "Opened"
    Set-Progress 100

    $mainStatus.Text = "AEGIS is running!"
    $mainStatus.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)

    $launchBtn.Text = "AEGIS is Running"
    $launchBtn.BackColor = [System.Drawing.Color]::FromArgb(15, 60, 50)
    $launchBtn.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)

    $stopBtn.Enabled = $true
    $stopBtn.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
    $stopBtn.BackColor = [System.Drawing.Color]::FromArgb(35, 15, 15)

    $form.Refresh()
})

# ── Stop Click ────────────────────────────────────────────────────────────────
$stopBtn.Add_Click({
    $mainStatus.Text = "Stopping..."
    $mainStatus.ForeColor = [System.Drawing.Color]::FromArgb(248, 113, 113)
    $form.Refresh()

    try {
        if ($script:serverProcess -and !$script:serverProcess.HasExited) {
            taskkill /F /T /PID $script:serverProcess.Id 2>$null
        }
        if ($script:clientProcess -and !$script:clientProcess.HasExited) {
            taskkill /F /T /PID $script:clientProcess.Id 2>$null
        }
    } catch {}

    Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        try { $_.MainModule.FileName -like "*aegis*" } catch { $false }
    } | Stop-Process -Force -ErrorAction SilentlyContinue

    Set-Progress 0
    Set-RowState $srvRow "offline"
    Set-RowState $cliRow "offline"
    Set-RowState $webRow "offline"

    $mainStatus.Text = "Stopped"
    $mainStatus.ForeColor = [System.Drawing.Color]::FromArgb(70, 100, 140)

    $launchBtn.Enabled = $true
    $launchBtn.Text = "Launch AEGIS"
    $launchBtn.BackColor = [System.Drawing.Color]::FromArgb(56, 189, 248)
    $launchBtn.ForeColor = [System.Drawing.Color]::FromArgb(5, 10, 25)

    $stopBtn.Enabled = $false
    $stopBtn.ForeColor = [System.Drawing.Color]::FromArgb(70, 90, 120)
    $stopBtn.BackColor = [System.Drawing.Color]::FromArgb(15, 22, 42)

    $form.Refresh()
})

# ── Close -> cleanup ──────────────────────────────────────────────────────────
$form.Add_FormClosing({
    try {
        if ($script:serverProcess -and !$script:serverProcess.HasExited) {
            taskkill /F /T /PID $script:serverProcess.Id 2>$null
        }
        if ($script:clientProcess -and !$script:clientProcess.HasExited) {
            taskkill /F /T /PID $script:clientProcess.Id 2>$null
        }
    } catch {}
})

[void]$form.ShowDialog()
