using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows;

namespace VeracityIbkrConnector;

public sealed class ConnectorProcessManager
{
    private readonly AppConfigStore _configStore;
    private Process? _process;
    private readonly string _logPath;
    private readonly string _connectorPath;

    public ConnectorProcessManager(AppConfigStore configStore)
    {
        _configStore = configStore;
        var baseDir = AppContext.BaseDirectory;
        _connectorPath = Path.Combine(baseDir, "VeracityIbkrConnector.Connector.exe");
        _logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Veracity", "logs", "ibkr-connector.log");
    }

    public async Task StartAsync(string? token = null)
    {
        if (_process != null && !_process.HasExited) return;
        var config = _configStore.Load();
        var args = new List<string>
        {
            "--server", config.ServerUrl,
            "--gateway", config.GatewayUrl,
            "--pollSeconds", config.PollSeconds.ToString()
        };
        if (!string.IsNullOrWhiteSpace(token))
        {
            args.Add("--token");
            args.Add(token);
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = _connectorPath,
            Arguments = string.Join(' ', args.Select(QuoteArg)),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        _process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        _process.Exited += (_, _) =>
        {
            if (_process?.ExitCode == IbkrConnector.ExitInvalidKey)
            {
                MessageBox.Show("Connector key invalid. Please paste a fresh token.", "Veracity IBKR Connector");
            }
        };
        _process.OutputDataReceived += (_, e) => WriteLogLine(e.Data);
        _process.ErrorDataReceived += (_, e) => WriteLogLine(e.Data);

        _process.Start();
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();

        await Task.CompletedTask;
    }

    public void Stop()
    {
        if (_process == null) return;
        if (!_process.HasExited)
        {
            _process.Kill(true);
        }
        _process.Dispose();
        _process = null;
    }

    public void OpenLogs()
    {
        if (File.Exists(_logPath))
        {
            Process.Start(new ProcessStartInfo("notepad.exe", _logPath) { UseShellExecute = true });
        }
        else
        {
            MessageBox.Show("No logs yet. Start the connector to generate logs.");
        }
    }

    private void WriteLogLine(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(_logPath)!);
        File.AppendAllText(_logPath, line + Environment.NewLine);
    }

    private static string QuoteArg(string arg)
    {
        if (string.IsNullOrWhiteSpace(arg)) return "\"\"";
        if (arg.Contains(' ') || arg.Contains('"'))
        {
            return "\"" + arg.Replace("\"", "\\\"") + "\"";
        }
        return arg;
    }
}
