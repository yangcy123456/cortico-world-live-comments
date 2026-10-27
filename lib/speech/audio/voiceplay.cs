// voiceplay.exe - play a WAV file to a chosen Windows output device (waveOut).
// Build: csc /nologo /target:exe /out:voiceplay.exe voiceplay.cs
// Usage:
//   voiceplay.exe list
//   voiceplay.exe play <file.wav> [device] [volume]
//   voiceplay.exe probe <file.wav>
// device: "" = system default, an index (0,1,...) or a case-insensitive name substring.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class VoicePlay
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WAVEOUTCAPS
    {
        public ushort wMid;
        public ushort wPid;
        public uint vDriverVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szPname;
        public uint dwFormats;
        public ushort wChannels;
        public ushort wReserved1;
        public uint dwSupport;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct WAVEFORMATEX
    {
        public ushort wFormatTag;
        public ushort nChannels;
        public uint nSamplesPerSec;
        public uint nAvgBytesPerSec;
        public ushort nBlockAlign;
        public ushort wBitsPerSample;
        public ushort cbSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct WAVEHDR
    {
        public IntPtr lpData;
        public uint dwBufferLength;
        public uint dwBytesRecorded;
        public IntPtr dwUser;
        public uint dwFlags;
        public uint dwLoops;
        public IntPtr lpNext;
        public IntPtr reserved;
    }

    [DllImport("winmm.dll")]
    public static extern uint waveOutGetNumDevs();

    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    public static extern uint waveOutGetDevCaps(IntPtr id, out WAVEOUTCAPS caps, int size);

    [DllImport("winmm.dll")]
    public static extern uint waveOutOpen(out IntPtr hwo, uint deviceId, ref WAVEFORMATEX fmt, IntPtr callback, IntPtr instance, uint flags);

    [DllImport("winmm.dll")]
    public static extern uint waveOutPrepareHeader(IntPtr hwo, IntPtr hdr, int size);

    [DllImport("winmm.dll")]
    public static extern uint waveOutWrite(IntPtr hwo, IntPtr hdr, int size);

    [DllImport("winmm.dll")]
    public static extern uint waveOutUnprepareHeader(IntPtr hwo, IntPtr hdr, int size);

    [DllImport("winmm.dll")]
    public static extern uint waveOutReset(IntPtr hwo);

    [DllImport("winmm.dll")]
    public static extern uint waveOutClose(IntPtr hwo);

    private const uint WHDR_DONE = 0x00000001;

    private sealed class Clip
    {
        public int Rate;
        public int Channels;
        public int Bits;
        public byte[] Data = new byte[0];
        public double Seconds { get { return Rate <= 0 ? 0 : (double)(Data.Length / (Channels * 2)) / Rate; } }
    }

    public static int Main(string[] args)
    {
        try
        {
            // 输出 JSON 里有设备名（中文），Node 侧按 UTF-8 读；不改的话默认代码页会把中文写坏。
            try { Console.OutputEncoding = System.Text.Encoding.UTF8; }
            catch { /* 某些控制台宿主不允许改，退回默认 */ }
            if (args.Length == 0)
            {
                return Fail("usage: voiceplay list | play <file> [device] [volume] | probe <file>");
            }
            switch (args[0])
            {
                case "list":
                    return ListCommand();
                case "play":
                    return PlayCommand(args);
                case "probe":
                    return ProbeCommand(args);
                default:
                    return Fail("unknown mode: " + args[0]);
            }
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    private static int Fail(string message)
    {
        Console.Out.Write(Json(new Dictionary<string, object> { { "ok", false }, { "error", message } }));
        Console.Out.Flush();
        return 1;
    }

    private static int ListCommand()
    {
        List<object> outputs = new List<object>();
        uint count = waveOutGetNumDevs();
        for (int i = 0; i < count; i++)
        {
            WAVEOUTCAPS caps;
            if (waveOutGetDevCaps(new IntPtr(i), out caps, Marshal.SizeOf(typeof(WAVEOUTCAPS))) != 0) continue;
            outputs.Add(new Dictionary<string, object> { { "index", i }, { "name", caps.szPname ?? "" } });
        }
        Console.Out.Write(Json(new Dictionary<string, object> { { "ok", true }, { "outputs", outputs } }));
        Console.Out.Flush();
        return 0;
    }

    private static int ProbeCommand(string[] args)
    {
        if (args.Length < 2) return Fail("probe needs a file");
        Clip clip = LoadWav(Path.GetFullPath(args[1]));
        Console.Out.Write(Json(new Dictionary<string, object>
        {
            { "ok", true },
            { "rate", clip.Rate },
            { "channels", clip.Channels },
            { "bits", clip.Bits },
            { "seconds", Math.Round(clip.Seconds, 3) },
        }));
        Console.Out.Flush();
        return 0;
    }

    private static int PlayCommand(string[] args)
    {
        if (args.Length < 2) return Fail("play needs a file");
        string file = Path.GetFullPath(args[1]);
        string wanted = args.Length > 2 ? args[2] : "";
        double volume = args.Length > 3 ? ParseDouble(args[3], 1.0) : 1.0;
        if (volume < 0) volume = 0;
        if (volume > 4) volume = 4;

        Clip clip = LoadWav(file);
        int device = ResolveDevice(wanted);
        WAVEFORMATEX format = new WAVEFORMATEX();
        format.wFormatTag = 1;
        format.nChannels = (ushort)clip.Channels;
        format.nSamplesPerSec = (uint)clip.Rate;
        format.wBitsPerSample = 16;
        format.nBlockAlign = (ushort)(clip.Channels * 2);
        format.nAvgBytesPerSec = (uint)(clip.Rate * format.nBlockAlign);

        IntPtr handle;
        uint rc = waveOutOpen(out handle, (uint)device, ref format, IntPtr.Zero, IntPtr.Zero, 0);
        if (rc != 0) return Fail("waveOutOpen failed: " + rc + " (device " + device + ")");

        int frameBytes = clip.Channels * 2;
        int chunkFrames = clip.Rate / 2;
        if (chunkFrames < 256) chunkFrames = 256;
        int chunkBytes = chunkFrames * frameBytes;

        long started = Environment.TickCount;
        try
        {
            byte[] data = clip.Data;
            if (volume != 1.0)
            {
                data = (byte[])clip.Data.Clone();
                ScaleSamples(data, volume);
            }
            for (int offset = 0; offset < data.Length; offset += chunkBytes)
            {
                int length = Math.Min(chunkBytes, data.Length - offset);
                IntPtr buffer = Marshal.AllocHGlobal(length);
                IntPtr headerPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WAVEHDR)));
                try
                {
                    Marshal.Copy(data, offset, buffer, length);
                    WAVEHDR header = new WAVEHDR();
                    header.lpData = buffer;
                    header.dwBufferLength = (uint)length;
                    Marshal.StructureToPtr(header, headerPtr, false);
                    if (waveOutPrepareHeader(handle, headerPtr, Marshal.SizeOf(typeof(WAVEHDR))) != 0) break;
                    if (waveOutWrite(handle, headerPtr, Marshal.SizeOf(typeof(WAVEHDR))) != 0)
                    {
                        waveOutUnprepareHeader(handle, headerPtr, Marshal.SizeOf(typeof(WAVEHDR)));
                        break;
                    }
                    while (true)
                    {
                        WAVEHDR current = (WAVEHDR)Marshal.PtrToStructure(headerPtr, typeof(WAVEHDR));
                        if ((current.dwFlags & WHDR_DONE) != 0) break;
                        Thread.Sleep(5);
                    }
                    waveOutUnprepareHeader(handle, headerPtr, Marshal.SizeOf(typeof(WAVEHDR)));
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                    Marshal.FreeHGlobal(headerPtr);
                }
            }
            Thread.Sleep(60);
        }
        finally
        {
            waveOutReset(handle);
            waveOutClose(handle);
        }
        long elapsed = Environment.TickCount - started;
        Console.Out.Write(Json(new Dictionary<string, object>
        {
            { "ok", true },
            { "device", DeviceName(device) },
            { "index", device },
            { "rate", clip.Rate },
            { "channels", clip.Channels },
            { "ms", elapsed },
            { "seconds", Math.Round(clip.Seconds, 3) },
        }));
        Console.Out.Flush();
        return 0;
    }

    private static int ResolveDevice(string wanted)
    {
        uint count = waveOutGetNumDevs();
        string key = (wanted ?? "").Trim();
        if (key.Length == 0) return -1;
        int parsed;
        if (int.TryParse(key, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed))
        {
            return parsed >= 0 && parsed < (int)count ? parsed : -1;
        }
        string lowered = key.ToLowerInvariant();
        for (int i = 0; i < (int)count; i++)
        {
            WAVEOUTCAPS caps;
            if (waveOutGetDevCaps(new IntPtr(i), out caps, Marshal.SizeOf(typeof(WAVEOUTCAPS))) != 0) continue;
            string name = (caps.szPname ?? "").ToLowerInvariant();
            if (name.Length > 0 && name.Contains(lowered)) return i;
        }
        return -1;
    }

    private static string DeviceName(int device)
    {
        if (device < 0) return "";
        WAVEOUTCAPS caps;
        if (waveOutGetDevCaps(new IntPtr(device), out caps, Marshal.SizeOf(typeof(WAVEOUTCAPS))) != 0) return "";
        return caps.szPname ?? "";
    }

    private static void ScaleSamples(byte[] data, double volume)
    {
        for (int i = 0; i + 1 < data.Length; i += 2)
        {
            short sample = (short)(data[i] | (data[i + 1] << 8));
            double scaled = sample * volume;
            if (scaled > 32767) scaled = 32767;
            if (scaled < -32768) scaled = -32768;
            short result = (short)scaled;
            data[i] = (byte)(result & 0xff);
            data[i + 1] = (byte)((result >> 8) & 0xff);
        }
    }

    private static Clip LoadWav(string file)
    {
        byte[] bytes = File.ReadAllBytes(file);
        if (bytes.Length < 44) throw new InvalidOperationException("not a wav file (too small)");
        if (Encoding.ASCII.GetString(bytes, 0, 4) != "RIFF" || Encoding.ASCII.GetString(bytes, 8, 4) != "WAVE")
        {
            throw new InvalidOperationException("not a wav file: " + Path.GetFileName(file));
        }
        int pos = 12;
        int formatTag = 0;
        int channels = 0;
        int rate = 0;
        int bits = 0;
        byte[] payload = null;
        while (pos + 8 <= bytes.Length)
        {
            string id = Encoding.ASCII.GetString(bytes, pos, 4);
            int size = (int)BitConverter.ToUInt32(bytes, pos + 4);
            int body = pos + 8;
            if (size < 0 || body + size > bytes.Length) size = bytes.Length - body;
            if (id == "fmt " && size >= 16)
            {
                formatTag = BitConverter.ToUInt16(bytes, body);
                channels = BitConverter.ToUInt16(bytes, body + 2);
                rate = (int)BitConverter.ToUInt32(bytes, body + 4);
                bits = BitConverter.ToUInt16(bytes, body + 14);
                if (formatTag == 0xFFFE && size >= 40)
                {
                    formatTag = BitConverter.ToUInt16(bytes, body + 24);
                }
            }
            else if (id == "data")
            {
                payload = new byte[size];
                Array.Copy(bytes, body, payload, 0, size);
            }
            pos = body + size + (size % 2);
        }
        if (payload == null || payload.Length == 0) throw new InvalidOperationException("wav has no data chunk");
        if (channels <= 0 || rate <= 0) throw new InvalidOperationException("wav has no format chunk");

        Clip clip = new Clip();
        clip.Rate = rate;
        clip.Channels = channels;
        clip.Bits = bits;
        if (formatTag == 1 && bits == 16)
        {
            clip.Data = payload;
        }
        else if (formatTag == 1 && bits == 8)
        {
            clip.Data = new byte[payload.Length * 2];
            for (int i = 0; i < payload.Length; i++)
            {
                short sample = (short)((payload[i] - 128) << 8);
                clip.Data[i * 2] = (byte)(sample & 0xff);
                clip.Data[i * 2 + 1] = (byte)((sample >> 8) & 0xff);
            }
            clip.Bits = 16;
        }
        else if (formatTag == 1 && bits == 24)
        {
            int frames = payload.Length / 3;
            clip.Data = new byte[frames * 2];
            for (int i = 0; i < frames; i++)
            {
                short sample = (short)((payload[i * 3 + 1]) | (payload[i * 3 + 2] << 8));
                clip.Data[i * 2] = (byte)(sample & 0xff);
                clip.Data[i * 2 + 1] = (byte)((sample >> 8) & 0xff);
            }
            clip.Bits = 16;
        }
        else if (formatTag == 1 && bits == 32)
        {
            int frames = payload.Length / 4;
            clip.Data = new byte[frames * 2];
            for (int i = 0; i < frames; i++)
            {
                int value = BitConverter.ToInt32(payload, i * 4);
                short sample = (short)(value >> 16);
                clip.Data[i * 2] = (byte)(sample & 0xff);
                clip.Data[i * 2 + 1] = (byte)((sample >> 8) & 0xff);
            }
            clip.Bits = 16;
        }
        else if (formatTag == 3 && bits == 32)
        {
            int frames = payload.Length / 4;
            clip.Data = new byte[frames * 2];
            for (int i = 0; i < frames; i++)
            {
                float value = BitConverter.ToSingle(payload, i * 4);
                double scaled = value * 32767.0;
                if (scaled > 32767) scaled = 32767;
                if (scaled < -32768) scaled = -32768;
                short sample = (short)scaled;
                clip.Data[i * 2] = (byte)(sample & 0xff);
                clip.Data[i * 2 + 1] = (byte)((sample >> 8) & 0xff);
            }
            clip.Bits = 16;
        }
        else
        {
            throw new InvalidOperationException("unsupported wav format: tag=" + formatTag + " bits=" + bits);
        }
        return clip;
    }

    private static double ParseDouble(string text, double fallback)
    {
        double value;
        if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out value)) return value;
        return fallback;
    }

    private static string Json(Dictionary<string, object> map)
    {
        StringBuilder text = new StringBuilder();
        text.Append('{');
        bool first = true;
        foreach (KeyValuePair<string, object> pair in map)
        {
            if (!first) text.Append(',');
            first = false;
            text.Append('"').Append(Escape(pair.Key)).Append("\":");
            AppendValue(text, pair.Value);
        }
        text.Append('}');
        return text.ToString();
    }

    private static void AppendValue(StringBuilder text, object value)
    {
        if (value == null) { text.Append("null"); return; }
        if (value is string) { text.Append('"').Append(Escape((string)value)).Append('"'); return; }
        if (value is bool) { text.Append((bool)value ? "true" : "false"); return; }
        List<object> list = value as List<object>;
        if (list != null)
        {
            text.Append('[');
            for (int i = 0; i < list.Count; i++)
            {
                if (i > 0) text.Append(',');
                AppendValue(text, list[i]);
            }
            text.Append(']');
            return;
        }
        Dictionary<string, object> nested = value as Dictionary<string, object>;
        if (nested != null) { text.Append(Json(nested)); return; }
        text.Append(Convert.ToString(value, CultureInfo.InvariantCulture));
    }

    private static string Escape(string text)
    {
        StringBuilder result = new StringBuilder(text.Length + 8);
        foreach (char ch in text)
        {
            switch (ch)
            {
                case '"': result.Append("\\\""); break;
                case '\\': result.Append("\\\\"); break;
                case '\n': result.Append("\\n"); break;
                case '\r': result.Append("\\r"); break;
                case '\t': result.Append("\\t"); break;
                default:
                    if (ch < 32) result.Append("\\u").Append(((int)ch).ToString("x4"));
                    else result.Append(ch);
                    break;
            }
        }
        return result.ToString();
    }
}
