// health.js — how the box itself is doing: CPU temperature, power / overheating warnings from the
// Pi's firmware, CPU load, memory, network, uptime. Linux-only readings are null elsewhere.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const TEMP_FILE = '/sys/class/thermal/thermal_zone0/temp';                     // millidegrees
const THROTTLED_FILE = '/sys/devices/platform/soc/soc:firmware/get_throttled';  // hex bits, Raspberry Pi kernels
const ROUTE_FILE = '/proc/net/route';
const WIRELESS_FILE = '/proc/net/wireless';

// get_throttled bits: now (0–3) and since boot (16–19)
const UNDERVOLTAGE = 1 << 0;
const THROTTLED = 1 << 2;
const SOFT_TEMP_LIMIT = 1 << 3;
const SINCE_BOOT = 16;

// CPU use is measured between two readings; the first one is taken at start
let lastCpu = cpuTimes();
let lastUsage = null;

export async function health() {
  const [temperature, throttled, network] = await Promise.all([readTemperature(), readThrottled(), readNetwork()]);
  return {
    temperature,
    power: throttled === null ? null : {
      undervoltage: flag(throttled, UNDERVOLTAGE),
      throttled: flag(throttled, THROTTLED | SOFT_TEMP_LIMIT),
    },
    cpu: cpuUsage(),
    memory: { total: os.totalmem(), available: os.freemem() },   // freemem = MemAvailable on Linux
    network,
    uptime: Math.round(os.uptime()),
  };
}

// 'now' | 'earlier' (since boot) | null
function flag(bits, mask) {
  if (bits & mask) return 'now';
  if (bits & (mask << SINCE_BOOT)) return 'earlier';
  return null;
}

async function readTemperature() {
  try {
    const milli = Number((await fs.readFile(TEMP_FILE, 'utf8')).trim());
    return Number.isFinite(milli) ? Math.round(milli / 100) / 10 : null;
  } catch {
    return null;
  }
}

// The sysfs file if the kernel has it, else `vcgencmd get_throttled` ("throttled=0x50000");
// null when neither works (not a Pi)
let throttledSource = 'file';   // 'file' | 'vcgencmd' | null
async function readThrottled() {
  try {
    if (throttledSource === 'file') {
      try {
        return parseBits(await fs.readFile(THROTTLED_FILE, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        throttledSource = 'vcgencmd';
      }
    }
    if (throttledSource === 'vcgencmd') {
      const { stdout } = await exec('vcgencmd', ['get_throttled'], { timeout: 2000 });
      return parseBits(stdout.split('=')[1] ?? '');
    }
  } catch (err) {
    if (err.code === 'ENOENT') throttledSource = null;   // no vcgencmd either
  }
  return null;
}

function parseBits(text) {
  const bits = parseInt(text.trim(), 16);
  if (!Number.isFinite(bits)) throw new Error(`Unexpected throttled value: ${text}`);
  return bits;
}

// The interface the default route goes through (lowest metric): cable or Wi‑Fi, with signal level
async function readNetwork() {
  let iface = null;
  try {
    let best = Infinity;
    for (const line of (await fs.readFile(ROUTE_FILE, 'utf8')).split('\n').slice(1)) {
      const [name, destination, , , , , metric] = line.trim().split(/\s+/);
      if (destination === '00000000' && Number(metric) < best) {
        best = Number(metric);
        iface = name;
      }
    }
  } catch {
    return null;
  }
  if (!iface) return { type: null, iface: null, signal: null };
  const type = /^(wl|wifi)/.test(iface) ? 'wifi' : 'ethernet';
  let signal = null;
  if (type === 'wifi') {
    try {
      const line = (await fs.readFile(WIRELESS_FILE, 'utf8')).split('\n').find((l) => l.trim().startsWith(`${iface}:`));
      const level = Number(line?.trim().split(/\s+/)[3]?.replace(/\.$/, ''));
      if (Number.isFinite(level) && level < 0) signal = level;   // dBm
    } catch {
      // no wireless stats
    }
  }
  return { type, iface, signal };
}

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const { times } of os.cpus()) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.irq + times.idle;
  }
  return { idle, total, at: Date.now() };
}

// Share of all cores busy since the previous reading (0–1); readings under 1 s apart reuse the last value
function cpuUsage() {
  const now = cpuTimes();
  if (now.at - lastCpu.at < 1000 && lastUsage !== null) return lastUsage;
  const total = now.total - lastCpu.total;
  if (total > 0) lastUsage = Math.min(1, Math.max(0, 1 - (now.idle - lastCpu.idle) / total));
  lastCpu = now;
  return lastUsage ?? 0;
}
