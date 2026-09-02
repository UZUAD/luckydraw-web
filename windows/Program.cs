using System.Diagnostics;
using System.ComponentModel;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO.Compression;
using System.Xml.Linq;

namespace LuckyDraw.Windows;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new SetupForm());
    }
}

internal sealed class SetupForm : Form
{
    private readonly Color Brand = Color.FromArgb(31, 111, 255);
    private readonly Color TextMain = Color.FromArgb(18, 24, 38);
    private readonly Color TextSub = Color.FromArgb(93, 103, 120);

    private readonly Button excelTab = new();
    private readonly Button rangeTab = new();
    private readonly Panel excelPanel = new();
    private readonly Panel rangePanel = new();
    private readonly Label selectedFileLabel = new();
    private readonly TextBox startInput = new();
    private readonly TextBox endInput = new();
    private readonly TextBox excludeInput = new();
    private readonly Label rangePreview = new();
    private readonly Label guideLabel = new();
    private readonly Button submitButton = new();

    private string? selectedExcelPath;
    private bool rangeMode;

    public SetupForm()
    {
        Text = "럭키드로우";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1180, 780);
        MinimumSize = new Size(980, 680);
        BackColor = Color.FromArgb(244, 247, 251);
        Font = new Font("Malgun Gothic", 9F);
        AutoScaleMode = AutoScaleMode.Dpi;

        Controls.Add(BuildPage());
        SetMode(false);
    }

    private Control BuildPage()
    {
        var page = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(30),
            RowCount = 2,
            ColumnCount = 1,
            BackColor = Color.Transparent
        };
        page.RowStyles.Add(new RowStyle(SizeType.Absolute, 126));
        page.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var hero = CreateCard(new Padding(28, 22, 28, 20));
        hero.Margin = new Padding(0, 0, 0, 18);
        hero.Controls.Add(new Label
        {
            Text = "행사 추첨 운영을 위한 참가자 등록 페이지",
            Dock = DockStyle.Top,
            Height = 38,
            Font = new Font("Malgun Gothic", 17F, FontStyle.Bold),
            ForeColor = TextMain
        });
        hero.Controls.Add(new Label
        {
            Text = "엑셀 파일 또는 번호 범위로 참가자를 등록하고, 제외 번호를 반영한 뒤 추첨을 시작합니다.",
            Dock = DockStyle.Bottom,
            Height = 38,
            Font = new Font("Malgun Gothic", 10F),
            ForeColor = TextSub
        });
        page.Controls.Add(hero, 0, 0);

        var content = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 1,
            BackColor = Color.Transparent
        };
        content.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 46));
        content.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 54));

        var rules = BuildRulesCard();
        rules.Margin = new Padding(0, 0, 10, 0);
        var form = BuildFormCard();
        form.Margin = new Padding(10, 0, 0, 0);
        content.Controls.Add(rules, 0, 0);
        content.Controls.Add(form, 1, 0);
        page.Controls.Add(content, 0, 1);
        return page;
    }

    private Panel BuildRulesCard()
    {
        var card = CreateCard(new Padding(24));
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 2,
            ColumnCount = 1,
            BackColor = Color.Transparent
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.Controls.Add(TitleLabel("등록 규칙"), 0, 0);

        var rules = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            AutoScroll = true,
            BackColor = Color.Transparent,
            Padding = new Padding(0, 2, 6, 0)
        };
        string[] items =
        {
            "1. 엑셀 데이터 위치\r\nA1은 헤더, 실제 참가자 데이터는 A2부터 시작합니다.",
            "2. 번호 컬럼 이름\r\nno, 번호, number, 연번, participantNo 중 하나를 사용합니다.",
            "3. 참가자 번호 형식\r\n0~99999의 정수를 자동으로 5자리 번호로 맞춥니다.",
            "4. 첫 번째 시트 사용\r\n첫 번째 시트를 읽으며 빈 값과 숫자가 아닌 값은 제외됩니다.",
            "5. 번호 범위 입력\r\n시작 번호와 끝 번호를 포함한 전체 범위를 자동 생성합니다.",
            "6. 추첨 제외 번호\r\n쉼표로 구분한 제외 번호는 두 등록 방식에 동일하게 반영됩니다."
        };
        foreach (var item in items)
        {
            rules.Controls.Add(new Label
            {
                Text = item,
                AutoSize = false,
                Width = 430,
                Height = 68,
                Padding = new Padding(14, 10, 14, 8),
                Margin = new Padding(0, 0, 0, 8),
                BackColor = Color.FromArgb(248, 250, 253),
                ForeColor = TextSub,
                Font = new Font("Malgun Gothic", 9F)
            });
        }
        layout.Controls.Add(rules, 0, 1);
        card.Controls.Add(layout);
        return card;
    }

    private Panel BuildFormCard()
    {
        var card = CreateCard(new Padding(24));
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 9,
            ColumnCount = 1,
            BackColor = Color.Transparent
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 56));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 176));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        layout.Controls.Add(TitleLabel("참가자 번호 등록"), 0, 0);
        layout.Controls.Add(new Label
        {
            Text = "엑셀 업로드 또는 번호 범위 입력 방식을 선택하세요.",
            Dock = DockStyle.Fill,
            ForeColor = TextSub,
            Font = new Font("Malgun Gothic", 9F)
        }, 0, 1);

        var tabs = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1, Padding = new Padding(4) };
        tabs.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        tabs.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        ConfigureTab(excelTab, "엑셀 업로드");
        ConfigureTab(rangeTab, "번호 범위 입력");
        excelTab.Click += (_, _) => SetMode(false);
        rangeTab.Click += (_, _) => SetMode(true);
        tabs.Controls.Add(excelTab, 0, 0);
        tabs.Controls.Add(rangeTab, 1, 0);
        layout.Controls.Add(tabs, 0, 2);

        var host = new Panel { Dock = DockStyle.Fill, Padding = new Padding(0, 10, 0, 8), BackColor = Color.Transparent };
        BuildExcelPanel();
        BuildRangePanel();
        host.Controls.Add(excelPanel);
        host.Controls.Add(rangePanel);
        layout.Controls.Add(host, 0, 3);

        layout.Controls.Add(new Label
        {
            Text = "추첨 제외 번호",
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(38, 50, 71),
            Font = new Font("Malgun Gothic", 9F, FontStyle.Bold),
            TextAlign = ContentAlignment.BottomLeft
        }, 0, 4);
        ConfigureTextBox(excludeInput, "예: 00012, 00105, 02345");
        layout.Controls.Add(excludeInput, 0, 5);

        guideLabel.Dock = DockStyle.Fill;
        guideLabel.ForeColor = TextSub;
        guideLabel.TextAlign = ContentAlignment.MiddleLeft;
        guideLabel.Font = new Font("Malgun Gothic", 8.5F);
        layout.Controls.Add(guideLabel, 0, 6);

        submitButton.Dock = DockStyle.Fill;
        submitButton.FlatStyle = FlatStyle.Flat;
        submitButton.FlatAppearance.BorderSize = 0;
        submitButton.BackColor = Color.FromArgb(111, 184, 255);
        submitButton.ForeColor = Color.White;
        submitButton.Font = new Font("Malgun Gothic", 10F, FontStyle.Bold);
        submitButton.Cursor = Cursors.Hand;
        submitButton.Click += (_, _) => Submit();
        layout.Controls.Add(submitButton, 0, 7);

        layout.Controls.Add(new Label
        {
            Text = "참가자 번호는 이 컴퓨터 안에서만 처리되며 외부로 전송되지 않습니다.",
            Dock = DockStyle.Fill,
            Padding = new Padding(12, 14, 12, 0),
            BackColor = Color.FromArgb(232, 248, 241),
            ForeColor = Color.FromArgb(40, 114, 87),
            Font = new Font("Malgun Gothic", 8.5F)
        }, 0, 8);

        card.Controls.Add(layout);
        return card;
    }

    private void BuildExcelPanel()
    {
        excelPanel.Dock = DockStyle.Fill;
        excelPanel.BackColor = Color.Transparent;
        var info = new Label
        {
            Text = "첫 번째 시트의 참가자 번호를 불러옵니다.",
            Dock = DockStyle.Top,
            Height = 46,
            Padding = new Padding(12),
            BackColor = Color.FromArgb(248, 250, 253),
            ForeColor = TextSub
        };
        var choose = new Button
        {
            Text = "파일 선택",
            Location = new Point(0, 62),
            Size = new Size(112, 42),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(238, 244, 255),
            ForeColor = Color.FromArgb(53, 80, 125),
            Font = new Font("Malgun Gothic", 9F, FontStyle.Bold),
            Cursor = Cursors.Hand
        };
        choose.FlatAppearance.BorderColor = Color.FromArgb(220, 231, 250);
        choose.Click += (_, _) => SelectExcelFile();
        selectedFileLabel.Text = "선택된 파일이 없습니다.";
        selectedFileLabel.Location = new Point(0, 114);
        selectedFileLabel.AutoEllipsis = true;
        selectedFileLabel.Size = new Size(500, 30);
        selectedFileLabel.ForeColor = TextSub;
        excelPanel.Controls.Add(info);
        excelPanel.Controls.Add(choose);
        excelPanel.Controls.Add(selectedFileLabel);
    }

    private void BuildRangePanel()
    {
        rangePanel.Dock = DockStyle.Fill;
        rangePanel.BackColor = Color.Transparent;
        var info = new Label
        {
            Text = "시작 번호와 끝 번호를 포함한 모든 번호를 생성합니다.",
            Dock = DockStyle.Top,
            Height = 42,
            Padding = new Padding(12),
            BackColor = Color.FromArgb(248, 250, 253),
            ForeColor = TextSub
        };
        var startLabel = FieldLabel("시작 번호", 0, 50);
        var endLabel = FieldLabel("끝 번호", 260, 50);
        ConfigureTextBox(startInput, "예: 1");
        ConfigureTextBox(endInput, "예: 500");
        startInput.Dock = DockStyle.None;
        endInput.Dock = DockStyle.None;
        startInput.SetBounds(0, 75, 235, 40);
        endInput.SetBounds(260, 75, 235, 40);
        startInput.TextChanged += (_, _) => UpdateRangePreview();
        endInput.TextChanged += (_, _) => UpdateRangePreview();
        rangePreview.SetBounds(0, 125, 500, 34);
        rangePreview.Padding = new Padding(10, 8, 10, 0);
        rangePreview.BackColor = Color.FromArgb(235, 242, 255);
        rangePreview.ForeColor = Color.FromArgb(53, 80, 125);
        rangePreview.Text = "시작 번호와 끝 번호를 입력해주세요.";
        rangePanel.Controls.Add(info);
        rangePanel.Controls.Add(startLabel);
        rangePanel.Controls.Add(endLabel);
        rangePanel.Controls.Add(startInput);
        rangePanel.Controls.Add(endInput);
        rangePanel.Controls.Add(rangePreview);
    }

    private void SetMode(bool useRange)
    {
        rangeMode = useRange;
        excelPanel.Visible = !useRange;
        rangePanel.Visible = useRange;
        if (useRange) rangePanel.BringToFront(); else excelPanel.BringToFront();
        SetTabState(excelTab, !useRange);
        SetTabState(rangeTab, useRange);
        submitButton.Text = useRange
            ? "번호 범위 등록하고 추첨 화면으로 이동"
            : "엑셀 업로드하고 추첨 화면으로 이동";
        guideLabel.Text = useRange
            ? "● 시작·끝 번호 포함    ● 자동 5자리 보정    ● 제외 번호 반영"
            : "● 첫 번째 시트 사용    ● 자동 5자리 보정    ● 빈 값 자동 제외";
    }

    private void SelectExcelFile()
    {
        using var dialog = new OpenFileDialog
        {
            Title = "럭키드로우 참가자 엑셀 파일 선택",
            Filter = "Excel 통합 문서 (*.xlsx)|*.xlsx",
            CheckFileExists = true,
            Multiselect = false
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        selectedExcelPath = dialog.FileName;
        selectedFileLabel.Text = Path.GetFileName(dialog.FileName);
        submitButton.BackColor = Brand;
    }

    private void Submit()
    {
        try
        {
            var excluded = ParseExcludedNumbers(excludeInput.Text);
            List<string> numbers;

            if (rangeMode)
            {
                if (!TryReadRange(out var start, out var end, out var error))
                {
                    ShowInfo(error!);
                    return;
                }
                numbers = Enumerable.Range(start, end - start + 1)
                    .Select(value => value.ToString("D5", CultureInfo.InvariantCulture))
                    .Where(number => !excluded.Contains(number))
                    .ToList();
            }
            else
            {
                if (string.IsNullOrWhiteSpace(selectedExcelPath))
                {
                    ShowInfo("엑셀 파일을 선택해주세요.");
                    return;
                }
                numbers = XlsxReader.ReadNumbers(selectedExcelPath)
                    .Where(number => !excluded.Contains(number))
                    .ToList();
            }

            if (numbers.Count == 0)
            {
                ShowInfo("제외 처리 후 남은 참가자가 없습니다.");
                return;
            }

            MessageBox.Show(this, $"{numbers.Count:N0}명의 참가자를 저장했습니다!", "저장 완료", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Hide();
            using var draw = new DrawForm(numbers);
            draw.ShowDialog();
            Close();
        }
        catch (InvalidDataException ex)
        {
            ShowInfo(ex.Message);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "파일을 처리하지 못했습니다.\r\n" + ex.Message, "오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void UpdateRangePreview()
    {
        if (!TryReadRange(out var start, out var end, out _))
        {
            rangePreview.Text = "0부터 99999 사이에서 올바른 범위를 입력해주세요.";
            submitButton.BackColor = Color.FromArgb(111, 184, 255);
            return;
        }
        rangePreview.Text = $"{start:D5}부터 {end:D5}까지 총 {end - start + 1:N0}개 번호가 등록됩니다.";
        submitButton.BackColor = Brand;
    }

    private bool TryReadRange(out int start, out int end, out string? error)
    {
        start = 0;
        end = 0;
        error = null;
        if (!int.TryParse(startInput.Text.Trim(), out start) || !int.TryParse(endInput.Text.Trim(), out end))
        {
            error = "시작 번호와 끝 번호를 모두 입력해주세요.";
            return false;
        }
        if (start < 0 || start > 99999 || end < 0 || end > 99999)
        {
            error = "시작 번호와 끝 번호는 0부터 99999 사이의 정수여야 합니다.";
            return false;
        }
        if (start > end)
        {
            error = "끝 번호는 시작 번호보다 크거나 같아야 합니다.";
            return false;
        }
        return true;
    }

    private static HashSet<string> ParseExcludedNumbers(string text)
    {
        var result = new HashSet<string>(StringComparer.Ordinal);
        foreach (var raw in text.Split(','))
        {
            if (int.TryParse(raw.Trim(), out var value) && value is >= 0 and <= 99999)
                result.Add(value.ToString("D5", CultureInfo.InvariantCulture));
        }
        return result;
    }

    private void ShowInfo(string message) =>
        MessageBox.Show(this, message, "안내", MessageBoxButtons.OK, MessageBoxIcon.Information);

    private Panel CreateCard(Padding padding) => new()
    {
        Dock = DockStyle.Fill,
        Padding = padding,
        BackColor = Color.White
    };

    private Label TitleLabel(string text) => new()
    {
        Text = text,
        Dock = DockStyle.Fill,
        Font = new Font("Malgun Gothic", 14F, FontStyle.Bold),
        ForeColor = TextMain
    };

    private Label FieldLabel(string text, int x, int y) => new()
    {
        Text = text,
        Location = new Point(x, y),
        Size = new Size(235, 24),
        Font = new Font("Malgun Gothic", 9F, FontStyle.Bold),
        ForeColor = Color.FromArgb(38, 50, 71)
    };

    private static void ConfigureTextBox(TextBox box, string placeholder)
    {
        box.Dock = DockStyle.Fill;
        box.PlaceholderText = placeholder;
        box.Font = new Font("Malgun Gothic", 10F);
        box.BorderStyle = BorderStyle.FixedSingle;
        box.Margin = new Padding(0, 4, 0, 6);
    }

    private static void ConfigureTab(Button button, string text)
    {
        button.Text = text;
        button.Dock = DockStyle.Fill;
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = 0;
        button.Margin = new Padding(2);
        button.Cursor = Cursors.Hand;
        button.Font = new Font("Malgun Gothic", 9F, FontStyle.Bold);
    }

    private void SetTabState(Button button, bool active)
    {
        button.BackColor = active ? Color.White : Color.FromArgb(241, 245, 251);
        button.ForeColor = active ? Color.FromArgb(23, 87, 203) : Color.FromArgb(102, 113, 134);
    }
}

internal sealed class DrawForm : Form
{
    private readonly List<string> numbers;
    private readonly DrawStage stage;
    private bool playing;

    public DrawForm(List<string> numbers)
    {
        this.numbers = numbers;
        Text = "럭키드로우 — 추첨";
        BackColor = Color.Black;
        WindowState = FormWindowState.Maximized;
        StartPosition = FormStartPosition.CenterScreen;
        KeyPreview = true;
        FormBorderStyle = FormBorderStyle.Sizable;
        stage = new DrawStage { Dock = DockStyle.Fill };
        Controls.Add(stage);
        KeyDown += async (_, eventArgs) =>
        {
            if (eventArgs.KeyCode == Keys.Enter) await StartDrawAsync();
            if (eventArgs.KeyCode == Keys.F11) ToggleFullScreen();
        };
    }

    private async Task StartDrawAsync()
    {
        if (playing || numbers.Count == 0) return;
        playing = true;
        var index = Random.Shared.Next(numbers.Count);
        var target = numbers[index];
        var stopwatch = Stopwatch.StartNew();

        while (stopwatch.ElapsedMilliseconds < 3600)
        {
            stage.Digits = Enumerable.Range(0, 5).Select(_ => Random.Shared.Next(10).ToString()).ToArray();
            stage.Invalidate();
            await Task.Delay(72);
        }

        for (var i = 0; i < 5; i++)
        {
            stage.Digits[i] = target[i].ToString();
            stage.Invalidate();
            await Task.Delay(120);
        }

        numbers.RemoveAt(index);
        stage.StartConfetti();
        await Task.Delay(860);
        playing = false;
    }

    private void ToggleFullScreen()
    {
        if (FormBorderStyle == FormBorderStyle.None)
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            WindowState = FormWindowState.Maximized;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.None;
            WindowState = FormWindowState.Maximized;
        }
    }
}

internal sealed class DrawStage : Control
{
    private sealed class Particle
    {
        public float X;
        public float Y;
        public float SpeedX;
        public float SpeedY;
        public float Rotation;
        public Color Color;
    }

    private readonly List<Particle> particles = new();
    private readonly System.Windows.Forms.Timer confettiTimer = new() { Interval = 16 };
    private int confettiFrames;

    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    public string[] Digits { get; set; } = ["0", "0", "0", "0", "0"];

    public DrawStage()
    {
        DoubleBuffered = true;
        BackColor = Color.Black;
        confettiTimer.Tick += (_, _) => AnimateConfetti();
    }

    public void StartConfetti()
    {
        particles.Clear();
        var colors = new[] { Color.DeepSkyBlue, Color.Gold, Color.HotPink, Color.White, Color.LimeGreen };
        for (var i = 0; i < 150; i++)
        {
            particles.Add(new Particle
            {
                X = Random.Shared.NextSingle() * Math.Max(1, Width),
                Y = -Random.Shared.Next(20, 240),
                SpeedX = Random.Shared.NextSingle() * 5 - 2.5F,
                SpeedY = Random.Shared.NextSingle() * 5 + 3,
                Rotation = Random.Shared.NextSingle() * 360,
                Color = colors[Random.Shared.Next(colors.Length)]
            });
        }
        confettiFrames = 0;
        confettiTimer.Start();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;

        const float baseWidth = 2304F;
        const float baseHeight = 640F;
        var scale = Math.Min(Width / baseWidth, Height / baseHeight);
        var stageWidth = baseWidth * scale;
        var stageHeight = baseHeight * scale;
        var stageX = (Width - stageWidth) / 2F;
        var stageY = (Height - stageHeight) / 2F;
        const float digitWidth = 112F;
        const float digitHeight = 136F;
        const float gap = 18F;
        const float digitsY = 232F;
        var totalWidth = digitWidth * 5 + gap * 4;
        var digitsX = (baseWidth - totalWidth) / 2F;

        using var border = new Pen(Color.FromArgb(235, 255, 255, 255), Math.Max(1.5F, 2F * scale));
        using var fill = new SolidBrush(Color.FromArgb(235, 0, 0, 0));
        using var digitBrush = new SolidBrush(Color.White);
        using var font = new Font("Arial Black", Math.Max(12F, 76F * scale), FontStyle.Bold, GraphicsUnit.Pixel);
        using var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };

        for (var i = 0; i < 5; i++)
        {
            var rect = new RectangleF(
                stageX + (digitsX + i * (digitWidth + gap)) * scale,
                stageY + digitsY * scale,
                digitWidth * scale,
                digitHeight * scale
            );
            using var path = RoundedRectangle(rect, 14F * scale);
            e.Graphics.FillPath(fill, path);
            e.Graphics.DrawPath(border, path);
            e.Graphics.DrawString(Digits[i], font, digitBrush, rect, format);
        }

        foreach (var particle in particles)
        {
            using var brush = new SolidBrush(particle.Color);
            e.Graphics.TranslateTransform(particle.X, particle.Y);
            e.Graphics.RotateTransform(particle.Rotation);
            e.Graphics.FillRectangle(brush, -5, -3, 10, 6);
            e.Graphics.ResetTransform();
        }
    }

    private void AnimateConfetti()
    {
        confettiFrames++;
        foreach (var particle in particles)
        {
            particle.X += particle.SpeedX;
            particle.Y += particle.SpeedY;
            particle.SpeedY += 0.08F;
            particle.Rotation += 7F;
        }
        if (confettiFrames > 180)
        {
            confettiTimer.Stop();
            particles.Clear();
        }
        Invalidate();
    }

    private static GraphicsPath RoundedRectangle(RectangleF rect, float radius)
    {
        var path = new GraphicsPath();
        var diameter = Math.Max(1, radius * 2);
        var arc = new RectangleF(rect.X, rect.Y, diameter, diameter);
        path.AddArc(arc, 180, 90);
        arc.X = rect.Right - diameter;
        path.AddArc(arc, 270, 90);
        arc.Y = rect.Bottom - diameter;
        path.AddArc(arc, 0, 90);
        arc.X = rect.Left;
        path.AddArc(arc, 90, 90);
        path.CloseFigure();
        return path;
    }
}

internal static class XlsxReader
{
    private static readonly string[] NumberHeaders = ["no", "번호", "number", "연번", "participantno"];

    public static List<string> ReadNumbers(string filePath)
    {
        using var archive = ZipFile.OpenRead(filePath);
        XNamespace spreadsheet = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        XNamespace relationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        XNamespace packageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";

        var workbook = LoadXml(archive, "xl/workbook.xml");
        var firstSheet = workbook.Descendants(spreadsheet + "sheet").FirstOrDefault()
            ?? throw new InvalidDataException("엑셀에 시트가 없습니다.");
        var relationshipId = firstSheet.Attribute(relationships + "id")?.Value
            ?? throw new InvalidDataException("첫 번째 시트 정보를 읽을 수 없습니다.");
        var workbookRels = LoadXml(archive, "xl/_rels/workbook.xml.rels");
        var target = workbookRels.Descendants(packageRelationships + "Relationship")
            .FirstOrDefault(node => node.Attribute("Id")?.Value == relationshipId)
            ?.Attribute("Target")?.Value
            ?? throw new InvalidDataException("첫 번째 시트 파일을 찾을 수 없습니다.");
        var sheetPath = target.StartsWith('/') ? target.TrimStart('/') : "xl/" + target.TrimStart('/');
        sheetPath = NormalizeZipPath(sheetPath);

        var sharedStrings = ReadSharedStrings(archive, spreadsheet);
        var worksheet = LoadXml(archive, sheetPath);
        var rows = worksheet.Descendants(spreadsheet + "row").ToList();
        if (rows.Count < 2) throw new InvalidDataException("엑셀에 참가자 데이터가 없습니다.");

        var headerCells = ReadRow(rows[0], spreadsheet, sharedStrings);
        var numberColumn = headerCells
            .FirstOrDefault(pair => NumberHeaders.Contains(pair.Value.Trim().ToLowerInvariant()))
            .Key;
        if (numberColumn <= 0)
            throw new InvalidDataException("번호 컬럼(no, 번호, number, 연번, participantNo)이 필요합니다.");

        var numbers = new List<string>();
        foreach (var row in rows.Skip(1))
        {
            var cells = ReadRow(row, spreadsheet, sharedStrings);
            if (!cells.TryGetValue(numberColumn, out var raw)) continue;
            if (!decimal.TryParse(raw.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed)) continue;
            if (parsed != decimal.Truncate(parsed) || parsed < 0 || parsed > 99999) continue;
            numbers.Add(((int)parsed).ToString("D5", CultureInfo.InvariantCulture));
        }
        if (numbers.Count == 0) throw new InvalidDataException("유효한 참가자 번호가 없습니다.");
        return numbers;
    }

    private static Dictionary<int, string> ReadRow(XElement row, XNamespace ns, IReadOnlyList<string> sharedStrings)
    {
        var result = new Dictionary<int, string>();
        foreach (var cell in row.Elements(ns + "c"))
        {
            var reference = cell.Attribute("r")?.Value ?? "";
            var column = ColumnIndex(reference);
            if (column <= 0) continue;
            var type = cell.Attribute("t")?.Value;
            string value;
            if (type == "inlineStr")
                value = string.Concat(cell.Descendants(ns + "t").Select(node => node.Value));
            else
            {
                value = cell.Element(ns + "v")?.Value ?? "";
                if (type == "s" && int.TryParse(value, out var stringIndex) && stringIndex >= 0 && stringIndex < sharedStrings.Count)
                    value = sharedStrings[stringIndex];
            }
            result[column] = value;
        }
        return result;
    }

    private static List<string> ReadSharedStrings(ZipArchive archive, XNamespace ns)
    {
        var entry = archive.GetEntry("xl/sharedStrings.xml");
        if (entry is null) return [];
        using var stream = entry.Open();
        var document = XDocument.Load(stream);
        return document.Descendants(ns + "si")
            .Select(item => string.Concat(item.Descendants(ns + "t").Select(text => text.Value)))
            .ToList();
    }

    private static XDocument LoadXml(ZipArchive archive, string path)
    {
        var entry = archive.GetEntry(path) ?? throw new InvalidDataException($"엑셀 내부 파일을 찾을 수 없습니다: {path}");
        using var stream = entry.Open();
        return XDocument.Load(stream);
    }

    private static string NormalizeZipPath(string path)
    {
        var parts = new Stack<string>();
        foreach (var part in path.Replace('\\', '/').Split('/'))
        {
            if (part is "" or ".") continue;
            if (part == "..") { if (parts.Count > 0) parts.Pop(); }
            else parts.Push(part);
        }
        return string.Join('/', parts.Reverse());
    }

    private static int ColumnIndex(string cellReference)
    {
        var index = 0;
        foreach (var character in cellReference)
        {
            if (!char.IsLetter(character)) break;
            index = index * 26 + (char.ToUpperInvariant(character) - 'A' + 1);
        }
        return index;
    }
}
