using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace VeracityIbkrConnector;

internal sealed class IbkrConnector
{
    private readonly ConnectorConfig _config;
    private readonly RollingFileLogger _logger;
    private readonly ConnectorKeyStore _keyStore;
    private readonly HttpClient _gatewayClient;
    private readonly HttpClient _serverClient;

    public const int ExitInvalidKey = 32;

    public IbkrConnector(ConnectorConfig config, RollingFileLogger logger, ConnectorKeyStore keyStore)
    {
        _config = config;
        _logger = logger;
        _keyStore = keyStore;

        var gatewayHandler = new HttpClientHandler();
        if (_config.InsecureTls)
        {
            gatewayHandler.ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;
        }
        _gatewayClient = new HttpClient(gatewayHandler)
        {
            BaseAddress = new Uri(_config.GatewayUrl.TrimEnd('/') + "/v1/api/")
        };
        _gatewayClient.Timeout = TimeSpan.FromSeconds(10);

        _serverClient = new HttpClient
        {
            BaseAddress = new Uri(_config.ServerUrl.TrimEnd('/') + "/")
        };
        _serverClient.Timeout = TimeSpan.FromSeconds(10);
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_config.ServerUrl))
        {
            _logger.Error("Missing --server argument.");
            return;
        }

        var connectorKey = _keyStore.Load();
        if (string.IsNullOrWhiteSpace(connectorKey))
        {
            connectorKey = await ExchangeConnectorKeyAsync(cancellationToken);
        }

        _logger.Info($"Connector starting. Server={_config.ServerUrl} Gateway={_config.GatewayUrl}");

        while (!cancellationToken.IsCancellationRequested)
        {
            var heartbeat = new Dictionary<string, object?>
            {
                ["status"] = "online",
                ["reason"] = "",
                ["authStatus"] = new Dictionary<string, object?>
                {
                    ["authenticated"] = false,
                    ["connected"] = false
                },
                ["connectorVersion"] = _config.ConnectorVersion,
                ["gatewayUrl"] = _config.GatewayUrl.TrimEnd('/')
            };

            SnapshotPayload? snapshot = null;
            try
            {
                var auth = await GetAuthStatusAsync(cancellationToken);
                heartbeat["authStatus"] = new Dictionary<string, object?>
                {
                    ["authenticated"] = auth.Authenticated,
                    ["connected"] = auth.Connected
                };

                if (!auth.Authenticated || !auth.Connected)
                {
                    heartbeat["status"] = "disconnected";
                    heartbeat["reason"] = "IBKR session not authenticated. Open https://localhost:5000 and login/2FA in Client Portal Gateway.";
                    _logger.Warn("IBKR session not authenticated.");
                }
                else
                {
                    await _gatewayClient.PostAsync("tickle", null, cancellationToken);
                    snapshot = await BuildSnapshotAsync(cancellationToken);
                }
            }
            catch (Exception ex)
            {
                heartbeat["status"] = "error";
                heartbeat["reason"] = "Unable to reach IBKR Client Portal Gateway.";
                _logger.Error($"IBKR error: {ex.Message}");
            }

            try
            {
                await SendHeartbeatAsync(connectorKey, heartbeat, cancellationToken);
                if (snapshot != null)
                {
                    await SendSnapshotAsync(connectorKey, snapshot, cancellationToken);
                    _logger.Info($"Snapshot sent for {snapshot.AccountId}.");
                }
            }
            catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.Unauthorized)
            {
                _logger.Error("Connector key rejected by server. Clearing local key.");
                _keyStore.Clear();
                Environment.ExitCode = ExitInvalidKey;
                return;
            }
            catch (Exception ex)
            {
                _logger.Error($"Veracity error: {ex.Message}");
            }

            await Task.Delay(TimeSpan.FromSeconds(_config.PollSeconds), cancellationToken);
        }
    }

    private async Task<string> ExchangeConnectorKeyAsync(CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_config.Token))
        {
            throw new InvalidOperationException("Connector key missing and no --token provided.");
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, "api/integrations/ibkr/connector/exchange");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _config.Token);
        request.Content = JsonContent.Create(new { });

        var response = await _serverClient.SendAsync(request, cancellationToken);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            _logger.Error("Connector token rejected; please generate a fresh token.");
            _keyStore.Clear();
            Environment.ExitCode = ExitInvalidKey;
            throw new InvalidOperationException("Connector token rejected.");
        }
        response.EnsureSuccessStatusCode();

        var payload = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);
        if (!payload.TryGetProperty("connectorKey", out var keyElement))
        {
            throw new InvalidOperationException("Connector key missing in exchange response.");
        }

        var connectorKey = keyElement.GetString();
        if (string.IsNullOrWhiteSpace(connectorKey))
        {
            throw new InvalidOperationException("Connector key missing in exchange response.");
        }

        _keyStore.Save(connectorKey);
        return connectorKey;
    }

    private async Task<AuthStatus> GetAuthStatusAsync(CancellationToken cancellationToken)
    {
        var response = await _gatewayClient.GetAsync("iserver/auth/status", cancellationToken);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);
        bool authenticated = payload.TryGetProperty("authenticated", out var authValue) && authValue.GetBoolean();
        bool connected = payload.TryGetProperty("connected", out var connValue) && connValue.GetBoolean();
        if (!authenticated && payload.TryGetProperty("isAuthenticated", out var altAuth))
        {
            authenticated = altAuth.GetBoolean();
        }
        if (!connected && payload.TryGetProperty("brokerageSession", out var altConn))
        {
            connected = altConn.GetBoolean();
        }
        return new AuthStatus(authenticated, connected);
    }

    private async Task<SnapshotPayload?> BuildSnapshotAsync(CancellationToken cancellationToken)
    {
        var accountsRes = await _gatewayClient.GetAsync("portfolio/accounts", cancellationToken);
        accountsRes.EnsureSuccessStatusCode();
        var accountsPayload = await accountsRes.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);
        var accountId = ResolveAccountId(accountsPayload) ?? _config.AccountOverride;
        if (string.IsNullOrWhiteSpace(accountId))
        {
            _logger.Warn("No IBKR account found.");
            return null;
        }

        var summaryRes = await _gatewayClient.GetAsync($"portfolio/{accountId}/summary", cancellationToken);
        summaryRes.EnsureSuccessStatusCode();
        var summaryPayload = await summaryRes.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);
        var portfolioValue = ExtractPortfolioValue(summaryPayload, out var currency);
        if (portfolioValue == null)
        {
            _logger.Warn("Portfolio value missing from summary.");
            return null;
        }

        JsonElement? ledgerPayload = null;
        try
        {
            var ledgerRes = await _gatewayClient.GetAsync($"portfolio/{accountId}/ledger", cancellationToken);
            ledgerRes.EnsureSuccessStatusCode();
            ledgerPayload = await ledgerRes.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);
        }
        catch
        {
            ledgerPayload = null;
        }

        var rootCurrency = DetermineRootCurrency(summaryPayload, ledgerPayload, accountsPayload);

        var positionsRes = await _gatewayClient.GetAsync($"portfolio2/{accountId}/positions", cancellationToken);
        positionsRes.EnsureSuccessStatusCode();
        var positionsPayload = await positionsRes.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);

        var ordersRes = await _gatewayClient.GetAsync("iserver/account/orders", cancellationToken);
        ordersRes.EnsureSuccessStatusCode();
        var ordersPayload = await ordersRes.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);

        var orders = ExtractStopOrders(ordersPayload);

        return new SnapshotPayload
        {
            AccountId = accountId,
            PortfolioValue = portfolioValue.Value,
            RootCurrency = rootCurrency.Currency,
            Positions = NormalizeArray(positionsPayload),
            Orders = orders,
            Raw = new Dictionary<string, JsonElement?>
            {
                ["accounts"] = accountsPayload,
                ["summary"] = summaryPayload,
                ["ledger"] = ledgerPayload,
                ["positions"] = positionsPayload,
                ["orders"] = ordersPayload
            },
            Meta = new SnapshotMeta
            {
                GatewayUrl = _config.GatewayUrl.TrimEnd('/'),
                ConnectorVersion = _config.ConnectorVersion,
                Ts = DateTimeOffset.UtcNow.ToString("O"),
                RootCurrencySource = rootCurrency.Reason,
                CurrencyConfidence = rootCurrency.Confidence,
                CurrencyReason = rootCurrency.Reason
            }
        };
    }

    private async Task SendHeartbeatAsync(string connectorKey, object payload, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/integrations/ibkr/connector/heartbeat");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", connectorKey);
        request.Content = JsonContent.Create(payload);
        var response = await _serverClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private async Task SendSnapshotAsync(string connectorKey, SnapshotPayload payload, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/integrations/ibkr/connector/snapshot");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", connectorKey);
        request.Content = JsonContent.Create(payload);
        var response = await _serverClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private static string? ResolveAccountId(JsonElement accountsPayload)
    {
        if (accountsPayload.ValueKind == JsonValueKind.Array && accountsPayload.GetArrayLength() > 0)
        {
            var first = accountsPayload.EnumerateArray().FirstOrDefault();
            if (first.ValueKind == JsonValueKind.String) return first.GetString();
            if (first.ValueKind == JsonValueKind.Object && first.TryGetProperty("accountId", out var accountId))
            {
                return accountId.GetString();
            }
            if (first.ValueKind == JsonValueKind.Object && first.TryGetProperty("id", out var id))
            {
                return id.GetString();
            }
        }
        if (accountsPayload.ValueKind == JsonValueKind.Object && accountsPayload.TryGetProperty("accounts", out var accounts)
            && accounts.ValueKind == JsonValueKind.Array && accounts.GetArrayLength() > 0)
        {
            var first = accounts.EnumerateArray().FirstOrDefault();
            if (first.ValueKind == JsonValueKind.Object && first.TryGetProperty("accountId", out var accountId))
            {
                return accountId.GetString();
            }
        }
        return null;
    }

    private static double? ExtractPortfolioValue(JsonElement summary, out string currency)
    {
        currency = "UNKNOWN";
        if (summary.ValueKind == JsonValueKind.Object)
        {
            if (summary.TryGetProperty("netliquidation", out var net))
            {
                if (TryExtractAmount(net, out var amount, out var curr))
                {
                    currency = curr;
                    return amount;
                }
            }
            if (summary.TryGetProperty("equitywithloanvalue", out var equity))
            {
                if (TryExtractAmount(equity, out var amount, out var curr))
                {
                    currency = curr;
                    return amount;
                }
            }
            if (summary.TryGetProperty("totalcashvalue", out var cash))
            {
                if (TryExtractAmount(cash, out var amount, out var curr))
                {
                    currency = curr;
                    return amount;
                }
            }
        }
        return null;
    }

    private static bool TryExtractAmount(JsonElement element, out double amount, out string currency)
    {
        amount = 0;
        currency = "UNKNOWN";
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty("amount", out var amt) && amt.TryGetDouble(out amount))
            {
                currency = element.TryGetProperty("currency", out var curr) ? curr.GetString() ?? "UNKNOWN" : "UNKNOWN";
                return true;
            }
            if (element.TryGetProperty("value", out var val) && val.TryGetDouble(out amount))
            {
                currency = element.TryGetProperty("currency", out var curr) ? curr.GetString() ?? "UNKNOWN" : "UNKNOWN";
                return true;
            }
        }
        return false;
    }

    private static RootCurrency DetermineRootCurrency(JsonElement summary, JsonElement? ledger, JsonElement accounts)
    {
        if (summary.ValueKind == JsonValueKind.Object)
        {
            if (summary.TryGetProperty("netliquidation", out var net) && net.ValueKind == JsonValueKind.Object
                && net.TryGetProperty("currency", out var curr) && !string.IsNullOrWhiteSpace(curr.GetString()))
            {
                return new RootCurrency(curr.GetString()!, "high", "summary.netliquidation.currency");
            }
            if (summary.TryGetProperty("baseCurrency", out var baseCurrency) && !string.IsNullOrWhiteSpace(baseCurrency.GetString()))
            {
                return new RootCurrency(baseCurrency.GetString()!, "high", "summary.baseCurrency");
            }
            if (summary.TryGetProperty("currency", out var summaryCurrency) && !string.IsNullOrWhiteSpace(summaryCurrency.GetString()))
            {
                return new RootCurrency(summaryCurrency.GetString()!, "high", "summary.currency");
            }
        }
        if (ledger.HasValue && ledger.Value.ValueKind == JsonValueKind.Object && ledger.Value.TryGetProperty("baseCurrency", out var ledgerCurrency))
        {
            return new RootCurrency(ledgerCurrency.GetString() ?? "UNKNOWN", "medium", "ledger.baseCurrency");
        }
        if (accounts.ValueKind == JsonValueKind.Array)
        {
            foreach (var account in accounts.EnumerateArray())
            {
                if (account.ValueKind == JsonValueKind.Object && account.TryGetProperty("currency", out var curr) && !string.IsNullOrWhiteSpace(curr.GetString()))
                {
                    return new RootCurrency(curr.GetString()!, "medium", "accounts.currency");
                }
            }
        }
        return new RootCurrency("UNKNOWN", "low", "unresolved");
    }

    private static List<object> NormalizeArray(JsonElement payload)
    {
        if (payload.ValueKind == JsonValueKind.Array)
        {
            return payload.EnumerateArray().Select(item => (object)item).ToList();
        }
        if (payload.ValueKind == JsonValueKind.Object)
        {
            if (payload.TryGetProperty("positions", out var positions) && positions.ValueKind == JsonValueKind.Array)
            {
                return positions.EnumerateArray().Select(item => (object)item).ToList();
            }
            if (payload.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
            {
                return data.EnumerateArray().Select(item => (object)item).ToList();
            }
        }
        return new List<object>();
    }

    private static List<NormalizedOrder> ExtractStopOrders(JsonElement payload)
    {
        var orders = new List<JsonElement>();
        if (payload.ValueKind == JsonValueKind.Array)
        {
            orders.AddRange(payload.EnumerateArray());
        }
        else if (payload.ValueKind == JsonValueKind.Object)
        {
            if (payload.TryGetProperty("orders", out var ordersElement) && ordersElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var entry in ordersElement.EnumerateArray())
                {
                    if (entry.ValueKind == JsonValueKind.Object && entry.TryGetProperty("orders", out var nested) && nested.ValueKind == JsonValueKind.Array)
                    {
                        orders.AddRange(nested.EnumerateArray());
                    }
                    else
                    {
                        orders.Add(entry);
                    }
                }
            }
            else if (payload.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
            {
                orders.AddRange(data.EnumerateArray());
            }
        }

        var normalized = new List<NormalizedOrder>();
        foreach (var order in orders)
        {
            var type = GetString(order, "orderType") ?? GetString(order, "orderTypeDesc") ?? GetString(order, "type");
            if (string.IsNullOrWhiteSpace(type)) continue;
            var typeNormalized = type.ToUpperInvariant();
            if (!typeNormalized.Contains("STOP") && !typeNormalized.Contains("STP")) continue;

            var stopPrice = GetNumber(order, "auxPrice") ?? GetNumber(order, "stopPrice") ?? GetNumber(order, "triggerPrice") ?? GetNumber(order, "stop");
            if (stopPrice == null) continue;

            normalized.Add(new NormalizedOrder
            {
                Id = GetString(order, "orderId") ?? GetString(order, "id"),
                Ticker = (GetString(order, "ticker") ?? GetString(order, "symbol"))?.ToUpperInvariant(),
                Conid = GetString(order, "conid") ?? GetString(order, "conidex"),
                Type = typeNormalized,
                Status = (GetString(order, "status") ?? GetString(order, "orderStatus") ?? GetString(order, "state"))?.ToUpperInvariant(),
                Side = (GetString(order, "side") ?? GetString(order, "action"))?.ToUpperInvariant(),
                Quantity = GetNumber(order, "totalQuantity") ?? GetNumber(order, "qty") ?? GetNumber(order, "quantity"),
                StopPrice = stopPrice.Value,
                CreatedAt = GetString(order, "orderTime") ?? GetString(order, "createdTime") ?? GetString(order, "time")
            });
        }

        return normalized;
    }

    private static string? GetString(JsonElement element, string property)
    {
        if (element.ValueKind != JsonValueKind.Object) return null;
        if (!element.TryGetProperty(property, out var value)) return null;
        return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
    }

    private static double? GetNumber(JsonElement element, string property)
    {
        if (element.ValueKind != JsonValueKind.Object) return null;
        if (!element.TryGetProperty(property, out var value)) return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number)) return number;
        if (value.ValueKind == JsonValueKind.String && double.TryParse(value.GetString(), out var parsed)) return parsed;
        return null;
    }

    private record AuthStatus(bool Authenticated, bool Connected);

    private record RootCurrency(string Currency, string Confidence, string Reason);
}

internal sealed class SnapshotPayload
{
    public string AccountId { get; init; } = "";
    public double PortfolioValue { get; init; }
    public string RootCurrency { get; init; } = "";
    public List<object> Positions { get; init; } = new();
    public List<NormalizedOrder>? Orders { get; init; }
    public Dictionary<string, JsonElement?>? Raw { get; init; }
    public SnapshotMeta? Meta { get; init; }
}

internal sealed class SnapshotMeta
{
    public string? GatewayUrl { get; init; }
    public string? ConnectorVersion { get; init; }
    public string? Ts { get; init; }
    public string? RootCurrencySource { get; init; }
    public string? CurrencyConfidence { get; init; }
    public string? CurrencyReason { get; init; }
}

internal sealed class NormalizedOrder
{
    public string? Id { get; init; }
    public string? Ticker { get; init; }
    public string? Conid { get; init; }
    public string? Type { get; init; }
    public string? Status { get; init; }
    public string? Side { get; init; }
    public double? Quantity { get; init; }
    public double StopPrice { get; init; }
    public string? CreatedAt { get; init; }
}
