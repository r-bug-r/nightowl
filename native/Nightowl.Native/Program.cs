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
        var (focused, reason) = Win32.FocusWindow(hwnd);
        return new { focused, reason };
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
        const long WS_CAPTION = 0x00C00000L;
        const long WS_THICKFRAME = 0x00040000L;
        const long WS_BORDER = 0x00800000L;
        const long WS_DLGFRAME = 0x00400000L;
        const long WS_MINIMIZEBOX = 0x00020000L;
        const long WS_MAXIMIZEBOX = 0x00010000L;
        const long WS_SYSMENU = 0x00080000L;
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
}
