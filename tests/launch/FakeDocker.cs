// Fake "docker" for testing the Windows launchers without Docker (compiled to docker.exe by the test workflow).
using System;
using System.IO;
public static class FakeDocker {
    public static int Main(string[] a) {
        string all = string.Join(" ", a);
        string cmd = a.Length > 0 ? a[0] : "";
        if (cmd == "logs") { Console.WriteLine("2026-11-21T15:00:00Z INF |  https://abc-def-ghi.trycloudflare.com                    |"); return 0; }
        if (cmd == "run" && all.Contains("--entrypoint cat")) {
            Console.Write(File.ReadAllText(Path.Combine(Environment.GetEnvironmentVariable("GITHUB_WORKSPACE"), "backend", "VERSION")).Trim());
            return 0;
        }
        if (cmd == "exec" && all.Contains("access_key")) { Console.WriteLine("TESTKEY123"); return 0; }
        if (cmd == "exec") { Console.WriteLine("FAKE-EXEC " + all); return 0; }
        return 0;
    }
}
