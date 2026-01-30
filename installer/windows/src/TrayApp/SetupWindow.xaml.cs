using System.Diagnostics;
using System.Windows;

namespace VeracityIbkrConnector;

public partial class SetupWindow : Window
{
    private readonly AppConfigStore _configStore;
    private readonly ConnectorProcessManager _connectorManager;
    private readonly GatewayInstaller _gatewayInstaller = new();

    public SetupWindow(AppConfigStore configStore, ConnectorProcessManager connectorManager)
    {
        InitializeComponent();
        _configStore = configStore;
        _connectorManager = connectorManager;
        LoadConfig();

        SaveButton.Click += (_, _) => SaveConfig();
        CloseButton.Click += (_, _) => Close();
        DownloadGatewayButton.Click += async (_, _) => await DownloadGatewayAsync();
        LaunchGatewayButton.Click += (_, _) => LaunchGateway();
        OpenGatewayUiButton.Click += (_, _) => OpenGatewayUi();
        StartSyncButton.Click += async (_, _) => await StartSyncAsync();
    }

    private void LoadConfig()
    {
        var config = _configStore.Load();
        ServerUrlBox.Text = config.ServerUrl;
        GatewayUrlBox.Text = config.GatewayUrl;
        PollSecondsBox.Text = config.PollSeconds.ToString();
        GatewayUrlDownloadBox.Text = config.GatewayZipUrl;
        GatewayInstallPathBox.Text = string.IsNullOrWhiteSpace(config.GatewayInstallPath)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Veracity", "IBKR-Gateway")
            : config.GatewayInstallPath;
    }

    private void SaveConfig()
    {
        var config = _configStore.Load();
        config.ServerUrl = ServerUrlBox.Text.Trim();
        config.GatewayUrl = GatewayUrlBox.Text.Trim();
        config.GatewayZipUrl = GatewayUrlDownloadBox.Text.Trim();
        config.GatewayInstallPath = GatewayInstallPathBox.Text.Trim();
        if (int.TryParse(PollSecondsBox.Text.Trim(), out var poll))
        {
            config.PollSeconds = Math.Max(5, poll);
        }
        _configStore.Save(config);
        ConnectorStatusText.Text = "Settings saved.";
    }

    private async Task DownloadGatewayAsync()
    {
        try
        {
            SaveConfig();
            var config = _configStore.Load();
            GatewayStatusText.Text = "Downloading...";
            var progress = new Progress<string>(msg => GatewayStatusText.Text = msg);
            await _gatewayInstaller.DownloadAndExtractAsync(config.GatewayZipUrl, config.GatewayInstallPath, progress);
            GatewayStatusText.Text = "Gateway installed.";
        }
        catch (Exception ex)
        {
            GatewayStatusText.Text = $"Download failed: {ex.Message}";
        }
    }

    private void LaunchGateway()
    {
        try
        {
            SaveConfig();
            var config = _configStore.Load();
            var runScript = _gatewayInstaller.LocateRunScript(config.GatewayInstallPath);
            if (string.IsNullOrWhiteSpace(runScript))
            {
                GatewayStatusText.Text = "run.bat not found. Ensure the gateway is installed.";
                return;
            }
            var confPath = Path.Combine(AppContext.BaseDirectory, "conf.yaml");
            var args = File.Exists(confPath) ? $"\"{runScript}\" \"{confPath}\"" : $"\"{runScript}\"";
            Process.Start(new ProcessStartInfo("cmd.exe", $"/c {args}") { UseShellExecute = true });
            GatewayStatusText.Text = "Gateway launched. Finish login in the browser.";
        }
        catch (Exception ex)
        {
            GatewayStatusText.Text = $"Launch failed: {ex.Message}";
        }
    }

    private void OpenGatewayUi()
    {
        Process.Start(new ProcessStartInfo("https://localhost:5000") { UseShellExecute = true });
    }

    private async Task StartSyncAsync()
    {
        SaveConfig();
        var token = TokenBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(token))
        {
            ConnectorStatusText.Text = "Paste a one-time token first.";
            return;
        }
        ConnectorStatusText.Text = "Starting connector...";
        await _connectorManager.StartAsync(token);
        ConnectorStatusText.Text = "Connector running.";
    }
}
