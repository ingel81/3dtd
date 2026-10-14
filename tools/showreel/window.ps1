# The showreel window to the front (run.mjs): finds the top-level window whose title contains -Title and, unless
# -Find, raises it above everything (topmost) even when another program holds the foreground. Windows refuses
# SetForegroundWindow to a process without recent input (foreground lock); a synthetic Alt press first lifts it.
# -Release takes topmost away again from the window -Handle. Prints the window handle (0 when none was found).
# Touches no other window.
param(
  [string]$Title = '',
  [switch]$Find,
  [switch]$Release,
  [long]$Handle = 0
)

Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ShowreelWindow {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  const uint NOSIZE = 0x1, NOMOVE = 0x2, SHOWWINDOW = 0x40;
  static readonly IntPtr TOPMOST = new IntPtr(-1), NOTOPMOST = new IntPtr(-2);

  public static IntPtr Find(string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var s = new StringBuilder(512);
      GetWindowText(h, s, 512);
      if (s.ToString().Contains(title)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static void Raise(IntPtr h) {
    // Alt down and up: the foreground lock lets a process that just "had input" take the foreground
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    ShowWindow(h, 5);
    SetWindowPos(h, TOPMOST, 0, 0, 0, 0, NOMOVE | NOSIZE | SHOWWINDOW);
    BringWindowToTop(h);
    SetForegroundWindow(h);
  }

  public static void Release(IntPtr h) {
    SetWindowPos(h, NOTOPMOST, 0, 0, 0, 0, NOMOVE | NOSIZE);
  }
}
'@

if ($Release) {
  if ($Handle -ne 0) { [ShowreelWindow]::Release([IntPtr]$Handle) }
  Write-Output $Handle
  exit 0
}
$h = [ShowreelWindow]::Find($Title)
if ($h -ne [IntPtr]::Zero -and -not $Find) { [ShowreelWindow]::Raise($h) }
Write-Output ([long]$h)
