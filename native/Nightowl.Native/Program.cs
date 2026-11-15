using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Nightowl.Native;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private static readonly PowerAssertionThread PowerThread = new();

    public static int Main()
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;

        PowerThread.Start();

        try
        {
            string? line;
            while ((line = Console.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                HandleLine(line);
            }
        }
        finally
        {
            PowerThread.Stop();
        }

        return 0;
    }

    private static void HandleLine(string line)
    {
        long id = 0;
        try
        {
            var cleanLine = line.TrimStart('\uFEFF');
            using var doc = JsonDocument.Parse(cleanLine);
            var root = doc.RootElement;
            if (root.TryGetProperty("id", out var idProp) && idProp.TryGetInt64(out var parsedId))
            {
                id = parsedId;
            }

            var cmd = root.TryGetProperty("cmd", out var cmdProp) ? cmdProp.GetString() : null;
            object result = cmd switch
            {
                "setAwake" => HandleSetAwake(root),
                "getPowerStatus" => Win32.GetPowerStatus(),
                "snapshot" => Win32.TakeSnapshot(),
                "focusWindow" => HandleFocusWindow(root),
                "stripWindowChrome" => HandleStripWindowChrome(root),
                "ping" => new { ok = true, pid = Environment.ProcessId },
                _ => throw new InvalidOperationException($"Unknown command: {cmd}")
            };

            WriteResponse(new { id, ok = true, result });
        }
        catch (Exception ex)
        {
            WriteResponse(new { id, ok = false, error = ex.Message });
        }
    }

    private static object HandleSetAwake(JsonElement root)
    {
        bool keepAwake = root.TryGetProperty("keepAwake", out var ka) && ka.GetBoolean();
        bool keepDisplay = root.TryGetProperty("keepDisplay", out var kd) && kd.GetBoolean();
        var applied = PowerThread.SetState(keepAwake, keepDisplay);
        return new { keepAwake, keepDisplay, executionState = applied };
    }

    private static object HandleFocusWindow(JsonElement root)
    {
        if (!root.TryGetProperty("hwnd", out var hwndProp))
        {
            return new { focused = false, reason = "missing hwnd" };
        }

        long hwndLong = hwndProp.ValueKind == JsonValueKind.String
            ? long.Parse(hwndProp.GetString()!)
            : hwndProp.GetInt64();

        var hwnd = new IntPtr(hwndLong);
        string? tabTitle = root.TryGetProperty("tabTitle", out var ttProp) && ttProp.ValueKind == JsonValueKind.String
            ? ttProp.GetString()
            : null;
        string? sessionId = root.TryGetProperty("sessionId", out var sidProp) && sidProp.ValueKind == JsonValueKind.String
            ? sidProp.GetString()
            : null;

        var (focused, reason) = Win32.FocusWindow(hwnd);
        bool tabSelected = false;
        string? tabSelectDetail = null;
        if (focused && (!string.IsNullOrWhiteSpace(tabTitle) || !string.IsNullOrWhiteSpace(sessionId)))
        {
            (tabSelected, tabSelectDetail) = Win32.TrySelectTabByTitle(hwnd, tabTitle, sessionId);
        }
        return new { focused, reason, tabSelected, tabSelectDetail };
    }

    private static object HandleStripWindowChrome(JsonElement root)
    {
        if (!root.TryGetProperty("hwnd", out var hwndProp))
        {
            return new { stripped = false, reason = "missing hwnd" };
        }

        long hwndLong = hwndProp.ValueKind == JsonValueKind.String
            ? long.Parse(hwndProp.GetString()!)
            : hwndProp.GetInt64();

        var hwnd = new IntPtr(hwndLong);
        var ok = Win32.StripWindowChrome(hwnd);
        return new { stripped = ok };
    }

    private static void WriteResponse(object payload)
    {
        var json = JsonSerializer.Serialize(payload, JsonOptions);
        Console.Out.WriteLine(json);
        Console.Out.Flush();
    }
}

internal sealed class PowerAssertionThread
{
    private readonly BlockingCollection<(bool KeepAwake, bool KeepDisplay, TaskCompletionSource<uint> Done)> _queue = new();
    private Thread? _thread;

    public void Start()
    {
        _thread = new Thread(Run)
        {
            IsBackground = true,
            Name = "NightowlPowerAssertion"
        };
        _thread.Start();
    }

    public uint SetState(bool keepAwake, bool keepDisplay)
    {
        var tcs = new TaskCompletionSource<uint>(TaskCreationOptions.RunContinuationsAsynchronously);
        _queue.Add((keepAwake, keepDisplay, tcs));
        return tcs.Task.GetAwaiter().GetResult();
    }

    public void Stop()
    {
        try
        {
            SetState(false, false);
        }
        catch
        {
            // ignore on shutdown
        }
        _queue.CompleteAdding();
        _thread?.Join(500);
    }

    private void Run()
    {
        try
        {
            foreach (var item in _queue.GetConsumingEnumerable())
            {
                uint flags = Win32.ES_CONTINUOUS;
                if (item.KeepAwake)
                {
                    flags |= Win32.ES_SYSTEM_REQUIRED;
                    if (item.KeepDisplay)
                    {
                        flags |= Win32.ES_DISPLAY_REQUIRED;
                    }
                }

                uint prev = Win32.SetThreadExecutionState(flags);
                item.Done.TrySetResult(prev);
            }
        }
        finally
        {
            Win32.SetThreadExecutionState(Win32.ES_CONTINUOUS);
        }
    }
}

internal static class Win32
{
    public const uint ES_CONTINUOUS = 0x80000000;
    public const uint ES_SYSTEM_REQUIRED = 0x00000001;
    public const uint ES_DISPLAY_REQUIRED = 0x00000002;

    private const uint TH32CS_SNAPPROCESS = 0x00000002;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const int ProcessCommandLineInformation = 60;
    private const int DWMWA_CLOAKED = 14;
    private const int SW_RESTORE = 9;
    private const uint ASFW_ANY = 0xFFFFFFFF;
    private const uint ABM_GETTASKBARPOS = 0x00000005;
    private const uint SPI_GETWORKAREA = 0x0030;

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS lpSystemPowerStatus);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32FirstW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32NextW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle, uint dwProcessId);

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(
        IntPtr ProcessHandle,
        int ProcessInformationClass,
        IntPtr ProcessInformation,
        int ProcessInformationLength,
        out int ReturnLength);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLengthW(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, [MarshalAs(UnmanagedType.Bool)] bool fAttach);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AllowSetForegroundWindow(uint dwProcessId);

    [DllImport("user32.dll")]
    private static extern void SwitchToThisWindow(IntPtr hWnd, [MarshalAs(UnmanagedType.Bool)] bool fAltTab);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

    [DllImport("shell32.dll")]
    private static extern UIntPtr SHAppBarMessage(uint dwMessage, ref APPBARDATA pData);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SystemParametersInfoW(uint uiAction, uint uiParam, out RECT pvParam, uint fWinIni);

    [StructLayout(LayoutKind.Sequential)]
    private struct SYSTEM_POWER_STATUS
    {
        public byte ACLineStatus;
        public byte BatteryFlag;
        public byte BatteryLifePercent;
        public byte SystemStatusFlag;
        public int BatteryLifeTime;
        public int BatteryFullLifeTime;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32W
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct UNICODE_STRING
    {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct APPBARDATA
    {
        public int cbSize;
        public IntPtr hWnd;
        public uint uCallbackMessage;
        public uint uEdge;
        public RECT rc;
        public IntPtr lParam;
    }

    public static object GetPowerStatus()
    {
        if (!GetSystemPowerStatus(out var status))
        {
            return new
            {
                acLineOnline = true,
                hasBattery = false,
                batteryPercent = 100,
                charging = false,
                batterySaver = false
            };
        }

        bool hasBattery = (status.BatteryFlag & 128) == 0 && status.BatteryLifePercent <= 100;
        return new
        {
            acLineOnline = status.ACLineStatus == 1,
            hasBattery,
            batteryPercent = status.BatteryLifePercent <= 100 ? (int)status.BatteryLifePercent : 100,
            charging = (status.BatteryFlag & 8) != 0,
            batterySaver = (status.SystemStatusFlag & 1) != 0
        };
    }

    public static object TakeSnapshot()
    {
        var processes = EnumerateProcesses();
        var procMap = processes.ToDictionary(p => p.Pid, p => p);
        var windows = EnumerateWindows(procMap);

        var abd = new APPBARDATA { cbSize = Marshal.SizeOf<APPBARDATA>() };
        SHAppBarMessage(ABM_GETTASKBARPOS, ref abd);
        SystemParametersInfoW(SPI_GETWORKAREA, 0, out var workArea, 0);

        return new
        {
            processes,
            windows,
            taskbar = new
            {
                left = abd.rc.Left,
                top = abd.rc.Top,
                right = abd.rc.Right,
                bottom = abd.rc.Bottom,
                edge = abd.uEdge
            },
            workArea = new
            {
                left = workArea.Left,
                top = workArea.Top,
                right = workArea.Right,
                bottom = workArea.Bottom
            }
        };
    }

    private sealed record ProcessInfo(int Pid, int ParentPid, string Name, string? CommandLine);

    private static List<ProcessInfo> EnumerateProcesses()
    {
        var list = new List<ProcessInfo>(256);
        var snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snapshot == IntPtr.Zero || snapshot == new IntPtr(-1))
        {
            return list;
        }

        try
        {
            var entry = new PROCESSENTRY32W { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32W>() };
            if (!Process32FirstW(snapshot, ref entry)) return list;

            do
            {
                var name = entry.szExeFile ?? string.Empty;
                string? cmdLine = null;
                if (IsInterestingForCommandLine(name))
                {
                    cmdLine = TryGetCommandLine(entry.th32ProcessID);
                }

                list.Add(new ProcessInfo((int)entry.th32ProcessID, (int)entry.th32ParentProcessID, name, cmdLine));
            }
            while (Process32NextW(snapshot, ref entry));
        }
        finally
        {
            CloseHandle(snapshot);
        }

        return list;
    }

    private static bool IsInterestingForCommandLine(string exeName)
    {
        return exeName.Equals("node.exe", StringComparison.OrdinalIgnoreCase)
            || exeName.Equals("claude.exe", StringComparison.OrdinalIgnoreCase)
            || exeName.Equals("codex.exe", StringComparison.OrdinalIgnoreCase)
            || exeName.Equals("Codex.exe", StringComparison.OrdinalIgnoreCase)
            || exeName.Equals("agy.exe", StringComparison.OrdinalIgnoreCase)
            || exeName.Equals("Antigravity.exe", StringComparison.OrdinalIgnoreCase)
            || exeName.Equals("cmd.exe", StringComparison.OrdinalIgnoreCase)
            || exeName.Equals("pwsh.exe", StringComparison.OrdinalIgnoreCase)
            || exeName.Equals("powershell.exe", StringComparison.OrdinalIgnoreCase)
            || exeName.Equals("WindowsTerminal.exe", StringComparison.OrdinalIgnoreCase);
    }

    private static string? TryGetCommandLine(uint pid)
    {
        var hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (hProc == IntPtr.Zero) return null;

        try
        {
            int size = 0;
            NtQueryInformationProcess(hProc, ProcessCommandLineInformation, IntPtr.Zero, 0, out size);
            if (size <= 0 || size > 65536) return null;

            var buffer = Marshal.AllocHGlobal(size);
            try
            {
                int status = NtQueryInformationProcess(hProc, ProcessCommandLineInformation, buffer, size, out _);
                if (status != 0) return null;

                var us = Marshal.PtrToStructure<UNICODE_STRING>(buffer);
                if (us.Buffer == IntPtr.Zero || us.Length == 0) return null;
                return Marshal.PtrToStringUni(us.Buffer, us.Length / 2);
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        catch
        {
            return null;
        }
        finally
        {
            CloseHandle(hProc);
        }
    }

    private static List<object> EnumerateWindows(Dictionary<int, ProcessInfo> procMap)
    {
        var windows = new List<object>();

        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd)) return true;

            int len = GetWindowTextLengthW(hwnd);
            if (len <= 0) return true;

            if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out int cloaked, sizeof(int)) == 0 && cloaked != 0)
            {
                return true;
            }

            var sb = new StringBuilder(len + 1);
            GetWindowTextW(hwnd, sb, sb.Capacity);
            var title = sb.ToString();
            if (string.IsNullOrWhiteSpace(title)) return true;

            GetWindowThreadProcessId(hwnd, out uint pid);
            GetWindowRect(hwnd, out var rect);
            if (rect.Right - rect.Left <= 0 || rect.Bottom - rect.Top <= 0) return true;

            procMap.TryGetValue((int)pid, out var pInfo);
            windows.Add(new
            {
                hwnd = hwnd.ToInt64().ToString(),
                pid = (int)pid,
                processName = pInfo?.Name ?? string.Empty,
                title,
                isMinimized = IsIconic(hwnd)
            });

            return true;
        }, IntPtr.Zero);

        return windows;
    }

    public static bool StripWindowChrome(IntPtr hwnd)
    {
        if (!IsWindow(hwnd)) return false;
        const int GWL_STYLE = -16;
        const int GWL_EXSTYLE = -20;
        const long WS_CAPTION = 0x00C00000L;
        const long WS_THICKFRAME = 0x00040000L;
        const long WS_BORDER = 0x00800000L;
        const long WS_DLGFRAME = 0x00400000L;
        const long WS_MINIMIZEBOX = 0x00020000L;
        const long WS_MAXIMIZEBOX = 0x00010000L;
        const long WS_SYSMENU = 0x00080000L;
        const long WS_EX_DLGMODALFRAME = 0x00000001L;
        const long WS_EX_WINDOWEDGE = 0x00000100L;
        const long WS_EX_CLIENTEDGE = 0x00000200L;
        const uint SWP_NOSIZE = 0x0001;
        const uint SWP_NOMOVE = 0x0002;
        const uint SWP_NOZORDER = 0x0004;
        const uint SWP_NOACTIVATE = 0x0010;
        const uint SWP_FRAMECHANGED = 0x0020;

        long style = GetWindowLongPtr(hwnd, GWL_STYLE).ToInt64();
        long mask = WS_CAPTION | WS_THICKFRAME | WS_BORDER | WS_DLGFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU;
        long nextStyle = style & ~mask;
        if (nextStyle != style)
        {
            SetWindowLongPtr(hwnd, GWL_STYLE, new IntPtr(nextStyle));
        }

        long exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
        long exMask = WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE;
        long nextExStyle = exStyle & ~exMask;
        if (nextExStyle != exStyle)
        {
            SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(nextExStyle));
        }
        return SetWindowPos(
            hwnd,
            IntPtr.Zero,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED
        );
    }

    public static (bool Focused, string? Reason) FocusWindow(IntPtr hwnd)
    {
        if (!IsWindow(hwnd))
        {
            return (false, "window no longer exists");
        }

        if (IsIconic(hwnd))
        {
            ShowWindow(hwnd, SW_RESTORE);
        }

        AllowSetForegroundWindow(ASFW_ANY);

        IntPtr fg = GetForegroundWindow();
        uint currentThread = GetCurrentThreadId();
        uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out _) : 0;
        uint targetThread = GetWindowThreadProcessId(hwnd, out _);

        bool attachedFg = false;
        bool attachedTarget = false;

        try
        {
            if (fgThread != 0 && fgThread != currentThread)
            {
                attachedFg = AttachThreadInput(currentThread, fgThread, true);
            }
            if (targetThread != 0 && targetThread != currentThread && targetThread != fgThread)
            {
                attachedTarget = AttachThreadInput(currentThread, targetThread, true);
            }

            BringWindowToTop(hwnd);
            bool ok = SetForegroundWindow(hwnd);
            if (!ok || GetForegroundWindow() != hwnd)
            {
                const byte VK_MENU = 0x12;
                const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
                const uint KEYEVENTF_KEYUP = 0x0002;
                keybd_event(VK_MENU, 0x45, KEYEVENTF_EXTENDEDKEY, UIntPtr.Zero);
                keybd_event(VK_MENU, 0x45, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, UIntPtr.Zero);
                SwitchToThisWindow(hwnd, true);
                BringWindowToTop(hwnd);
                ok = SetForegroundWindow(hwnd) || GetForegroundWindow() == hwnd;
            }
            return ok ? (true, null) : (false, "SetForegroundWindow returned false");
        }
        finally
        {
            if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
            if (attachedFg) AttachThreadInput(currentThread, fgThread, false);
        }
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessageTimeoutW(
        IntPtr hWnd,
        uint Msg,
        UIntPtr wParam,
        IntPtr lParam,
        uint fuFlags,
        uint uTimeout,
        out UIntPtr lpdwResult);

    [DllImport("oleacc.dll")]
    private static extern int AccessibleObjectFromWindow(
        IntPtr hwnd,
        uint dwId,
        ref Guid riid,
        [MarshalAs(UnmanagedType.IUnknown)] out object? ppvObject);

    private const int UIA_ControlTypePropertyId = 30003;
    private const int UIA_ButtonControlTypeId = 50000;
    private const int UIA_HyperlinkControlTypeId = 50005;
    private const int UIA_ListItemControlTypeId = 50007;
    private const int UIA_TabItemControlTypeId = 50019;
    private const int UIA_TreeItemControlTypeId = 50023;
    private const int TreeScope_Descendants = 4;
    private const int UIA_InvokePatternId = 10000;
    private const int UIA_ValuePatternId = 10002;
    private const int UIA_SelectionItemPatternId = 10010;
    private const int UIA_LegacyIAccessiblePatternId = 10018;

    public static (bool Selected, string? Detail) TrySelectTabByTitle(IntPtr hwnd, string? tabTitle, string? sessionId = null)
    {
        if (!IsWindow(hwnd)) return (false, "invalid hwnd");

        string needle = tabTitle?.Trim() ?? string.Empty;
        string convId = string.Empty;
        if (!string.IsNullOrWhiteSpace(sessionId) &&
            sessionId.StartsWith("antigravity:conv:", StringComparison.OrdinalIgnoreCase))
        {
            convId = sessionId.Substring("antigravity:conv:".Length).Trim();
        }

        if (string.IsNullOrEmpty(needle) && string.IsNullOrEmpty(convId))
        {
            return (false, "empty target");
        }

        try
        {
            var uiaType = Type.GetTypeFromCLSID(new Guid("ff48dba4-60ef-4201-aa87-54103eef594e"));
            if (uiaType == null) return (false, "UIA CLSID not found");
            var uia = (IUIAutomation)Activator.CreateInstance(uiaType)!;

            var cLink = uia.CreatePropertyCondition(UIA_ControlTypePropertyId, UIA_HyperlinkControlTypeId);
            var cTab = uia.CreatePropertyCondition(UIA_ControlTypePropertyId, UIA_TabItemControlTypeId);
            var cList = uia.CreatePropertyCondition(UIA_ControlTypePropertyId, UIA_ListItemControlTypeId);
            var cTree = uia.CreatePropertyCondition(UIA_ControlTypePropertyId, UIA_TreeItemControlTypeId);
            var cBtn = uia.CreatePropertyCondition(UIA_ControlTypePropertyId, UIA_ButtonControlTypeId);
            var cond = uia.CreateOrCondition(
                cLink,
                uia.CreateOrCondition(
                    uia.CreateOrCondition(cTab, cList),
                    uia.CreateOrCondition(cTree, cBtn)
                )
            );

            var candidateWindows = CollectCandidateTopWindows(hwnd);
            bool toggledSidebar = false;

            for (int attempt = 0; attempt < 10; attempt++)
            {
                IUIAutomationElement? bestEl = null;
                int bestScore = 0;
                int bestCtrlType = 0;
                string bestDesc = string.Empty;
                IntPtr bestTopHwnd = hwnd;

                int totalInteractive = 0;
                int convoLinkCount = 0;
                IUIAutomationElement? toggleSidebarBtn = null;

                foreach (var topHwnd in candidateWindows)
                {
                    var searchRoots = CollectRenderAndWindowRoots(topHwnd);
                    foreach (var rootHwnd in searchRoots)
                    {
                        WakeUpAccessibility(rootHwnd);
                        IUIAutomationElement? root;
                        try
                        {
                            root = uia.ElementFromHandle(rootHwnd);
                        }
                        catch
                        {
                            continue;
                        }
                        if (root == null) continue;

                        try
                        {
                            _ = root.CurrentName;
                            if (root.GetCurrentPattern(UIA_LegacyIAccessiblePatternId) is IUIAutomationLegacyIAccessiblePattern rootLeg)
                            {
                                _ = rootLeg.CurrentName;
                                _ = rootLeg.CurrentRole;
                            }
                        }
                        catch
                        {
                            // ignore warmup probe error
                        }

                        IUIAutomationElementArray? found;
                        try
                        {
                            found = root.FindAll(TreeScope_Descendants, cond);
                        }
                        catch
                        {
                            continue;
                        }
                        if (found == null) continue;

                        int len = Math.Min(found.Length, 2000);
                        totalInteractive += len;

                        for (int i = 0; i < len; i++)
                        {
                            IUIAutomationElement? el;
                            try
                            {
                                el = found.GetElement(i);
                            }
                            catch
                            {
                                continue;
                            }
                            if (el == null) continue;

                            int ctrlType = 0;
                            try { ctrlType = el.CurrentControlType; } catch { }

                            string? name = TryGetElementName(el);
                            string? val = TryGetElementValue(el);

                            bool isConvoLink = !string.IsNullOrEmpty(val) &&
                                val.Contains("/c/", StringComparison.OrdinalIgnoreCase);
                            if (isConvoLink) convoLinkCount++;

                            if (ctrlType == UIA_ButtonControlTypeId &&
                                !string.IsNullOrEmpty(name) &&
                                name.Equals("Toggle Sidebar", StringComparison.OrdinalIgnoreCase))
                            {
                                toggleSidebarBtn ??= el;
                            }

                            int score = ScoreElement(ctrlType, name, val, isConvoLink, needle, convId);
                            if (score > bestScore)
                            {
                                bestScore = score;
                                bestEl = el;
                                bestCtrlType = ctrlType;
                                bestTopHwnd = topHwnd;
                                bestDesc = $"score={score} ctrl={ctrlType} name={name} val={val}";
                                if (score >= 100) break;
                            }
                        }

                        if (bestScore >= 100) break;
                    }

                    if (bestScore >= 100) break;
                }

                if (bestEl != null)
                {
                    if (bestTopHwnd != hwnd)
                    {
                        FocusWindow(bestTopHwnd);
                    }
                    if (ActivateElement(bestEl, bestCtrlType, out string method))
                    {
                        return (true, $"{method} ({bestDesc})");
                    }
                }

                if (attempt >= 2 && totalInteractive >= 5 && convoLinkCount == 0 && !toggledSidebar && toggleSidebarBtn != null)
                {
                    toggledSidebar = true;
                    ActivateElement(toggleSidebarBtn, UIA_ButtonControlTypeId, out _);
                    Thread.Sleep(160);
                    continue;
                }

                Thread.Sleep(85);
            }

            return (false, "target element not found after retries");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    private static List<IntPtr> CollectCandidateTopWindows(IntPtr primaryHwnd)
    {
        var list = new List<IntPtr> { primaryHwnd };
        GetWindowThreadProcessId(primaryHwnd, out uint targetPid);
        if (targetPid == 0) return list;

        EnumWindows((w, _) =>
        {
            if (w == primaryHwnd || !IsWindowVisible(w)) return true;
            GetWindowThreadProcessId(w, out uint pid);
            if (pid == targetPid && GetWindowTextLengthW(w) > 0)
            {
                list.Add(w);
            }
            return true;
        }, IntPtr.Zero);

        return list;
    }

    private static List<IntPtr> CollectRenderAndWindowRoots(IntPtr topHwnd)
    {
        var renderHwnds = new List<IntPtr>();
        var widgetHwnds = new List<IntPtr>();

        EnumChildWindows(topHwnd, (child, _) =>
        {
            var sb = new StringBuilder(128);
            if (GetClassNameW(child, sb, sb.Capacity) > 0)
            {
                string cls = sb.ToString();
                if (cls.Equals("Chrome_RenderWidgetHostHWND", StringComparison.OrdinalIgnoreCase))
                {
                    renderHwnds.Add(child);
                }
                else if (cls.StartsWith("Chrome_WidgetWin_", StringComparison.OrdinalIgnoreCase))
                {
                    widgetHwnds.Add(child);
                }
            }
            return true;
        }, IntPtr.Zero);

        // Put newest/topmostWebContentsView render widgets first, then widget windows, then topHwnd
        renderHwnds.Reverse();
        var all = new List<IntPtr>(renderHwnds.Count + widgetHwnds.Count + 1);
        all.AddRange(renderHwnds);
        all.AddRange(widgetHwnds);
        all.Add(topHwnd);
        return all;
    }

    private static void WakeUpAccessibility(IntPtr targetHwnd)
    {
        const uint WM_GETOBJECT = 0x003D;
        const int OBJID_CLIENT = unchecked((int)0xFFFFFFFC);
        const uint SMTO_ABORTIFHUNG = 0x0002;
        try
        {
            SendMessageTimeoutW(
                targetHwnd,
                WM_GETOBJECT,
                UIntPtr.Zero,
                new IntPtr(OBJID_CLIENT),
                SMTO_ABORTIFHUNG,
                80,
                out _
            );
            var iidAcc = new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");
            AccessibleObjectFromWindow(targetHwnd, unchecked((uint)OBJID_CLIENT), ref iidAcc, out _);
        }
        catch
        {
            // ignore warmup error
        }
    }

    private static string? TryGetElementName(IUIAutomationElement el)
    {
        try
        {
            string? name = el.CurrentName;
            if (!string.IsNullOrWhiteSpace(name)) return name.Trim();
        }
        catch { }

        try
        {
            if (el.GetCurrentPattern(UIA_LegacyIAccessiblePatternId) is IUIAutomationLegacyIAccessiblePattern leg)
            {
                string? legName = leg.CurrentName;
                if (!string.IsNullOrWhiteSpace(legName)) return legName.Trim();
            }
        }
        catch { }

        return null;
    }

    private static string? TryGetElementValue(IUIAutomationElement el)
    {
        try
        {
            if (el.GetCurrentPattern(UIA_ValuePatternId) is IUIAutomationValuePattern valPat)
            {
                string? val = valPat.CurrentValue;
                if (!string.IsNullOrWhiteSpace(val)) return val.Trim();
            }
        }
        catch { }

        try
        {
            if (el.GetCurrentPattern(UIA_LegacyIAccessiblePatternId) is IUIAutomationLegacyIAccessiblePattern leg)
            {
                string? legVal = leg.CurrentValue;
                if (!string.IsNullOrWhiteSpace(legVal)) return legVal.Trim();
            }
        }
        catch { }

        return null;
    }

    private static int ScoreElement(
        int ctrlType,
        string? name,
        string? val,
        bool isConvoLink,
        string needle,
        string convId)
    {
        if (!string.IsNullOrEmpty(convId) && !string.IsNullOrEmpty(val) &&
            val.Contains(convId, StringComparison.OrdinalIgnoreCase))
        {
            return 100;
        }

        if (string.IsNullOrEmpty(needle) || string.IsNullOrEmpty(name))
        {
            return 0;
        }

        if (name.Equals(needle, StringComparison.OrdinalIgnoreCase))
        {
            if (isConvoLink) return 96;
            if (ctrlType == UIA_HyperlinkControlTypeId || ctrlType == UIA_TabItemControlTypeId) return 92;
            return 88;
        }

        string trimmedNeedle = needle.TrimEnd('.', '…').Trim();
        if (trimmedNeedle.Length >= 4 &&
            (name.Contains(trimmedNeedle, StringComparison.OrdinalIgnoreCase) ||
             (name.Length >= 8 && trimmedNeedle.Contains(name, StringComparison.OrdinalIgnoreCase))))
        {
            if (isConvoLink) return 84;
            if (ctrlType == UIA_HyperlinkControlTypeId || ctrlType == UIA_TabItemControlTypeId) return 76;
            if (ctrlType == UIA_ListItemControlTypeId || ctrlType == UIA_TreeItemControlTypeId) return 72;
            return 62;
        }

        return 0;
    }

    private static bool ActivateElement(IUIAutomationElement el, int ctrlType, out string method)
    {
        method = "none";

        if (ctrlType == UIA_TabItemControlTypeId)
        {
            try
            {
                if (el.GetCurrentPattern(UIA_SelectionItemPatternId) is IUIAutomationSelectionItemPattern selPat)
                {
                    selPat.Select();
                    method = "SelectionItemPattern.Select";
                    return true;
                }
            }
            catch { }
        }

        try
        {
            if (el.GetCurrentPattern(UIA_InvokePatternId) is IUIAutomationInvokePattern invPat)
            {
                invPat.Invoke();
                method = "InvokePattern.Invoke";
                return true;
            }
        }
        catch { }

        try
        {
            if (el.GetCurrentPattern(UIA_LegacyIAccessiblePatternId) is IUIAutomationLegacyIAccessiblePattern legPat)
            {
                legPat.DoDefaultAction();
                method = "LegacyIAccessiblePattern.DoDefaultAction";
                return true;
            }
        }
        catch { }

        if (ctrlType != UIA_TabItemControlTypeId)
        {
            try
            {
                if (el.GetCurrentPattern(UIA_SelectionItemPatternId) is IUIAutomationSelectionItemPattern selPat)
                {
                    selPat.Select();
                    method = "SelectionItemPattern.Select";
                    return true;
                }
            }
            catch { }
        }

        return false;
    }

    [ComImport, Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IUIAutomation
    {
        void CompareElements();
        void CompareRuntimeIds();
        IUIAutomationElement GetRootElement();
        IUIAutomationElement ElementFromHandle(IntPtr hwnd);
        void ElementFromPoint();
        void GetFocusedElement();
        void GetRootElementBuildCache();
        void ElementFromHandleBuildCache();
        void ElementFromPointBuildCache();
        void GetFocusedElementBuildCache();
        void CreateTreeWalker();
        void GetControlViewWalker();
        void GetContentViewWalker();
        void GetRawViewWalker();
        void GetRawViewCondition();
        IUIAutomationCondition GetControlViewCondition();
        IUIAutomationCondition GetContentViewCondition();
        void CreateCacheRequest();
        IUIAutomationCondition CreateTrueCondition();
        IUIAutomationCondition CreateFalseCondition();
        IUIAutomationCondition CreatePropertyCondition(int propertyId, [MarshalAs(UnmanagedType.Struct)] object value);
        void CreatePropertyConditionEx();
        IUIAutomationCondition CreateAndCondition(IUIAutomationCondition condition1, IUIAutomationCondition condition2);
        void CreateAndConditionFromArray();
        void CreateAndConditionFromNativeArray();
        IUIAutomationCondition CreateOrCondition(IUIAutomationCondition condition1, IUIAutomationCondition condition2);
    }

    [ComImport, Guid("352ffba8-0973-437c-a61f-f64cafd81df9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IUIAutomationCondition { }

    [ComImport, Guid("14314595-b4bc-4055-95f2-58f2e42c9855"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IUIAutomationElementArray
    {
        int Length { get; }
        IUIAutomationElement GetElement(int index);
    }

    [ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IUIAutomationElement
    {
        void SetFocus();
        void GetRuntimeId();
        IUIAutomationElement FindFirst(int scope, IUIAutomationCondition condition);
        IUIAutomationElementArray FindAll(int scope, IUIAutomationCondition condition);
        void FindFirstBuildCache();
        void FindAllBuildCache();
        void BuildUpdatedCache();
        void GetCurrentPropertyValue();
        void GetCurrentPropertyValueEx();
        void GetCachedPropertyValue();
        void GetCachedPropertyValueEx();
        [return: MarshalAs(UnmanagedType.IUnknown)]
        object? GetCurrentPatternAs(int patternId, ref Guid riid);
        [return: MarshalAs(UnmanagedType.IUnknown)]
        object? GetCachedPatternAs(int patternId, ref Guid riid);
        [return: MarshalAs(UnmanagedType.IUnknown)]
        object? GetCurrentPattern(int patternId);
        void GetCachedPattern();
        void GetCachedParent();
        void GetCachedChildren();
        int CurrentProcessId { get; }
        int CurrentControlType { get; }
        string CurrentLocalizedControlType { [return: MarshalAs(UnmanagedType.BStr)] get; }
        string CurrentName { [return: MarshalAs(UnmanagedType.BStr)] get; }
    }

    [ComImport, Guid("a8efa66a-0fda-421a-9194-38021f3578ea"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IUIAutomationSelectionItemPattern
    {
        void Select();
    }

    [ComImport, Guid("fb377fbe-8ea6-46d5-9c73-6499642d3059"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IUIAutomationInvokePattern
    {
        void Invoke();
    }

    [ComImport, Guid("a94cd8b1-0844-4cd6-9d2d-640537ab39e9"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IUIAutomationValuePattern
    {
        void SetValue([MarshalAs(UnmanagedType.BStr)] string val);
        string CurrentValue { [return: MarshalAs(UnmanagedType.BStr)] get; }
    }

    [ComImport, Guid("828055ad-355b-4435-86d5-3b51c14a9b1b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IUIAutomationLegacyIAccessiblePattern
    {
        void Select(int flagsSelect);
        void DoDefaultAction();
        void SetValue([MarshalAs(UnmanagedType.LPWStr)] string szValue);
        int CurrentChildId { get; }
        string CurrentName { [return: MarshalAs(UnmanagedType.BStr)] get; }
        string CurrentValue { [return: MarshalAs(UnmanagedType.BStr)] get; }
        string CurrentDescription { [return: MarshalAs(UnmanagedType.BStr)] get; }
        uint CurrentRole { get; }
    }
}
