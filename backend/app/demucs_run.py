"""Demucs command line, on the Mac's GPU (MPS) when there is one: python -m app.demucs_run <demucs args>.

htdemucs on MPS: 4x faster than the CPU (พบรัก 4:12 on an M3 Max: 87 s -> 18-24 s), stems the same (CPU vs MPS
96.8-98.9 dB SDR, i.e. rounding) and identical run to run. torch 2.5's MPS refuses 1-D convolutions with outputs longer
than 65536 samples (the first layers of the waveform branch), so only those run on the CPU.
DEMUCS_DEVICE=cpu (or cuda, mps) picks the device; the default is mps when available, else Demucs' own choice."""
import os
import sys

import torch
from torch import nn

LONG = 32768  # input length x stride above which a 1-D convolution runs on the CPU (MPS limit: 65536 outputs)


def _cpu_for_long(cls) -> None:
    """Such a layer runs on a CPU copy of itself, made once (moving its weights to the CPU and back for every
    chunk took 1.6 s of a 4-minute song: 645 calls); the same arithmetic, so the same stems."""
    import copy

    orig = cls.forward

    def forward(self, x, *a, **k):
        if x.device.type == "mps" and x.shape[-1] * max(1, self.stride[0]) > LONG:
            cpu = self.__dict__.get("_cpu_twin")
            if cpu is None:
                cpu = copy.deepcopy(self).to("cpu")
                self.__dict__["_cpu_twin"] = cpu  # not a registered sub-module: .to() / state_dict leave it alone
            return orig(cpu, x.to("cpu"), *a, **k).to("mps")
        return orig(self, x, *a, **k)

    cls.forward = forward


def device() -> str | None:
    want = os.environ.get("DEMUCS_DEVICE", "").strip()
    if want:
        return want
    return "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else None


if __name__ == "__main__":
    args = sys.argv[1:]
    dev = device()
    if dev and "-d" not in args:
        args = ["-d", dev] + args
    if dev == "mps":
        _cpu_for_long(nn.Conv1d)
        _cpu_for_long(nn.ConvTranspose1d)
    from demucs.separate import main

    main(args)
