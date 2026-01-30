using System.Diagnostics;
using System.Windows;
using System.Windows.Forms;
using VeracityIbkrConnector;

namespace VeracityIbkrConnector;

public partial class TrayApp : Application
{
    private NotifyIcon? _notifyIcon;
    private ConnectorProcessManager? _connectorManager;
    private AppConfigStore? _configStore;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        _configStore = new AppConfigStore();
        _connectorManager = new ConnectorProcessManager(_configStore);

        _notifyIcon = new NotifyIcon
        {
            Icon = System.Drawing.SystemIcons.Application,
            Visible = true,
            Text = "Veracity IBKR Connector"
        };

        var menu = new ContextMenuStrip();
        menu.Items.Add("Open setup", null, (_, _) => ShowSetup());
        menu.Items.Add("Start sync", null, async (_, _) => await _connectorManager.StartAsync());
        menu.Items.Add("Stop sync", null, (_, _) => _connectorManager.Stop());
        menu.Items.Add("Open Gateway UI", null, (_, _) => Process.Start(new ProcessStartInfo("https://localhost:5000") { UseShellExecute = true }));
        menu.Items.Add("View logs", null, (_, _) => _connectorManager.OpenLogs());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit", null, (_, _) => Shutdown());
        _notifyIcon.ContextMenuStrip = menu;
        _notifyIcon.DoubleClick += (_, _) => ShowSetup();

        ShowSetup();
    }

    private void ShowSetup()
    {
        var window = Current.Windows.OfType<SetupWindow>().FirstOrDefault();
        if (window == null)
        {
            window = new SetupWindow(_configStore!, _connectorManager!);
            window.Show();
        }
        else
        {
            window.Activate();
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _connectorManager?.Stop();
        if (_notifyIcon != null)
        {
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
        }
        base.OnExit(e);
    }
}
