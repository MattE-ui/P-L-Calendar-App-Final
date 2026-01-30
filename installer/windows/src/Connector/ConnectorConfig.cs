namespace VeracityIbkrConnector;

internal sealed class ConnectorConfig
{
    public string ServerUrl { get; init; } = "";
    public string GatewayUrl { get; init; } = "https://localhost:5000";
    public int PollSeconds { get; init; } = 15;
    public string? Token { get; init; }
    public bool InsecureTls { get; init; }
    public string ConnectorVersion { get; init; } = "veracity-ibkr-connector";
    public string LogPath { get; init; } = "";
    public string KeyPath { get; init; } = "";
    public string? AccountOverride { get; init; }

    public static ConnectorConfig FromArgs(string[] args)
    {
        string GetArg(string flag, string? fallback = null)
        {
            var index = Array.IndexOf(args, flag);
            if (index == -1 || index + 1 >= args.Length) return fallback ?? string.Empty;
            return args[index + 1];
        }

        var server = GetArg("--server", Environment.GetEnvironmentVariable("VERACITY_SERVER"));
        var gateway = GetArg("--gateway", Environment.GetEnvironmentVariable("IBKR_GATEWAY_URL") ?? "https://localhost:5000");
        var token = GetArg("--token", Environment.GetEnvironmentVariable("VERACITY_CONNECTOR_TOKEN"));
        var pollRaw = GetArg("--pollSeconds", GetArg("--poll", Environment.GetEnvironmentVariable("IBKR_POLL_INTERVAL") ?? "15"));
        var account = GetArg("--account", Environment.GetEnvironmentVariable("IBKR_ACCOUNT_ID"));
        var connectorVersion = Environment.GetEnvironmentVariable("VERACITY_CONNECTOR_VERSION") ?? "veracity-ibkr-connector";
        var debug = args.Contains("--debug") || Environment.GetEnvironmentVariable("VERACITY_DEBUG") == "1";
        var pollSeconds = int.TryParse(pollRaw, out var parsed) && parsed > 0 ? parsed : 15;

        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var baseDir = Path.Combine(appData, "Veracity");
        var logPath = Path.Combine(baseDir, "logs", "ibkr-connector.log");
        var keyPath = Path.Combine(baseDir, "connector-key.bin");

        return new ConnectorConfig
        {
            ServerUrl = server,
            GatewayUrl = gateway,
            PollSeconds = pollSeconds,
            Token = string.IsNullOrWhiteSpace(token) ? null : token,
            InsecureTls = args.Contains("--insecure") || Environment.GetEnvironmentVariable("IBKR_INSECURE_TLS") == "1",
            ConnectorVersion = connectorVersion,
            LogPath = logPath,
            KeyPath = keyPath,
            AccountOverride = string.IsNullOrWhiteSpace(account) ? null : account
        };
    }
}
