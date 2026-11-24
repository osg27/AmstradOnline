"""Assemble serial-pingpong.s with vasm and write a bootable 880 KB test ADF."""
import pathlib, struct, subprocess, sys
here = pathlib.Path(__file__).resolve().parent
vasm = sys.argv[1] if len(sys.argv) > 1 else "vasmm68k_mot"
out = here / "serial-pingpong.bin"
subprocess.run([vasm, "-Fbin", "-quiet", "-o", str(out), str(here / "serial-pingpong.s")], check=True)
boot = bytearray(out.read_bytes().ljust(1024, b"\0"))
total = 0
for i in range(0, 1024, 4):
    total += struct.unpack(">I", boot[i:i + 4])[0]
    if total > 0xFFFFFFFF:
        total = (total & 0xFFFFFFFF) + 1
struct.pack_into(">I", boot, 4, (~total) & 0xFFFFFFFF)
adf = here / "serial-pingpong.adf"
adf.write_bytes(bytes(boot) + bytes(901120 - 1024))
out.unlink()
print(f"wrote {adf} ({adf.stat().st_size} bytes), checksum {struct.unpack('>I', boot[4:8])[0]:08x}")
