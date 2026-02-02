using System.IO.Compression;
using System.Net.Http;

namespace VeracityIbkrConnector;

public sealed class GatewayInstaller
{
    private readonly HttpClient _httpClient = new();

    public async Task<string> DownloadAndExtractAsync(string zipUrl, string targetDir, IProgress<string>? progress = null)
    {
        Directory.CreateDirectory(targetDir);
        var zipPath = Path.Combine(targetDir, "gateway.zip");
        progress?.Report("Downloading gateway...");
        var data = await _httpClient.GetByteArrayAsync(zipUrl);
        await File.WriteAllBytesAsync(zipPath, data);
        progress?.Report("Extracting gateway...");
        ZipFile.ExtractToDirectory(zipPath, targetDir, true);
        File.Delete(zipPath);
        return targetDir;
    }

    public string LocateRunScript(string installDir)
    {
        var runPath = Path.Combine(installDir, "bin", "run.bat");
        if (File.Exists(runPath)) return runPath;
        var matches = Directory.GetFiles(installDir, "run.bat", SearchOption.AllDirectories);
        return matches.FirstOrDefault() ?? string.Empty;
    }
}
