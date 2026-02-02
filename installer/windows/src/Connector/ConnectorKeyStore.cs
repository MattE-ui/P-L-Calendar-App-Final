using System.Security.Cryptography;
using System.Text;

namespace VeracityIbkrConnector;

internal sealed class ConnectorKeyStore
{
    private readonly string _keyPath;

    public ConnectorKeyStore(string keyPath)
    {
        _keyPath = keyPath;
        Directory.CreateDirectory(Path.GetDirectoryName(_keyPath)!);
    }

    public string? Load()
    {
        if (!File.Exists(_keyPath)) return null;
        try
        {
            var encrypted = File.ReadAllBytes(_keyPath);
            var decrypted = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(decrypted);
        }
        catch
        {
            return null;
        }
    }

    public void Save(string connectorKey)
    {
        var payload = Encoding.UTF8.GetBytes(connectorKey);
        var encrypted = ProtectedData.Protect(payload, null, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(_keyPath, encrypted);
    }

    public void Clear()
    {
        if (File.Exists(_keyPath))
        {
            File.Delete(_keyPath);
        }
    }
}
