using VeracityIbkrConnector;

var config = ConnectorConfig.FromArgs(args);
var logger = new RollingFileLogger(config.LogPath);
var keyStore = new ConnectorKeyStore(config.KeyPath);
var connector = new IbkrConnector(config, logger, keyStore);

using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};

try
{
    await connector.RunAsync(cts.Token);
}
catch (Exception ex)
{
    logger.Error($"Connector failed: {ex.Message}");
    Environment.ExitCode = 1;
}
