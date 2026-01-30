using System.Text;

namespace VeracityIbkrConnector;

internal sealed class RollingFileLogger
{
    private readonly string _logPath;
    private readonly object _lock = new();
    private const long MaxBytes = 5 * 1024 * 1024; // 5MB

    public RollingFileLogger(string logPath)
    {
        _logPath = logPath;
        Directory.CreateDirectory(Path.GetDirectoryName(_logPath)!);
    }

    public void Info(string message) => Write("INFO", message);
    public void Warn(string message) => Write("WARN", message);
    public void Error(string message) => Write("ERROR", message);

    public void Write(string level, string message)
    {
        lock (_lock)
        {
            RotateIfNeeded();
            var line = $"{DateTimeOffset.Now:O} [{level}] {message}";
            File.AppendAllText(_logPath, line + Environment.NewLine, Encoding.UTF8);
        }
    }

    private void RotateIfNeeded()
    {
        if (!File.Exists(_logPath)) return;
        var info = new FileInfo(_logPath);
        if (info.Length < MaxBytes) return;
        var archivePath = Path.Combine(info.DirectoryName!, $"{Path.GetFileNameWithoutExtension(_logPath)}-" + DateTimeOffset.Now.ToString("yyyyMMddHHmmss") + info.Extension);
        File.Move(_logPath, archivePath, true);
    }
}
