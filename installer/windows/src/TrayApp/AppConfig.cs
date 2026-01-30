using System.Text.Json;

namespace VeracityIbkrConnector;

public sealed class AppConfig
{
    public string ServerUrl { get; set; } = "https://veracitysuite.com";
    public string GatewayUrl { get; set; } = "https://localhost:5000";
    public int PollSeconds { get; set; } = 15;
    public string GatewayInstallPath { get; set; } = string.Empty;
    public string GatewayZipUrl { get; set; } = "https://download2.interactivebrokers.com/portal/clientportal.gw.zip";
    public bool RunAtStartup { get; set; }
}

public sealed class AppConfigStore
{
    private readonly string _configPath;

    public AppConfigStore()
    {
        var baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Veracity");
        Directory.CreateDirectory(baseDir);
        _configPath = Path.Combine(baseDir, "ibkr-tray-config.json");
    }

    public AppConfig Load()
    {
        if (!File.Exists(_configPath)) return new AppConfig();
        try
        {
            var json = File.ReadAllText(_configPath);
            return JsonSerializer.Deserialize<AppConfig>(json) ?? new AppConfig();
        }
        catch
        {
            return new AppConfig();
        }
    }

    public void Save(AppConfig config)
    {
        var json = JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(_configPath, json);
    }
}
