// cec.js — turns the TV on and switches it to our input over HDMI-CEC, and puts it to standby with
// the screen saver, using `cec-ctl` (v4l-utils' v4l2 CEC framework; already on Raspberry Pi OS).
// The Pi's vc4_hdmi driver exposes one /dev/cecN per HDMI port; whichever reports a real physical
// address (not f.f.f.f) is the one actually wired to the TV, so both are tried at startup.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const DEVICES = ['/dev/cec0', '/dev/cec1'];
const CLAIM_TIMEOUT_MS = 5000;
const CMD_TIMEOUT_MS = 4000;

export class Cec {
  constructor() {
    this.device = null;     // e.g. '/dev/cec0', once the connected adapter is found
    this.physAddr = null;   // e.g. '2.0.0.0' (this box's position in the TV's HDMI tree)
    this.ready = false;
  }

  // Finds the connected adapter and claims a Playback Device logical address. Safe when there's no
  // CEC hardware at all (a dev PC, or `cec-ctl` missing) or no TV plugged in: resolves with
  // ready=false, never throws.
  async start() {
    for (const device of DEVICES) {
      try {
        const { stdout } = await run('cec-ctl', ['-d', device, '--playback'], { timeout: CLAIM_TIMEOUT_MS });
        const phys = stdout.match(/Physical Address\s*:\s*([0-9a-f.]+)/i)?.[1];
        if (phys && phys !== 'f.f.f.f') {
          this.device = device;
          this.physAddr = phys;
          this.ready = true;
          return;
        }
      } catch {
        // No such device, or claiming failed (e.g. not a Pi): try the next one, then give up quietly
      }
    }
  }

  // Wakes the TV and makes us its active source, so it also switches to our input
  async turnOn() {
    if (!this.ready) return;
    await this.#send(['--to', '0', '--image-view-on']).catch(() => {});
    await this.#send(['--active-source', `phys-addr=${this.physAddr}`]).catch(() => {});
  }

  // Only standbys the TV, not the whole HDMI bus (other devices, e.g. a soundbar, may want to stay on)
  async standby() {
    if (!this.ready) return;
    await this.#send(['--to', '0', '--standby']).catch(() => {});
  }

  #send(args) {
    return run('cec-ctl', ['-d', this.device, ...args], { timeout: CMD_TIMEOUT_MS });
  }
}
