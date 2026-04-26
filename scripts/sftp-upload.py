"""Upload a single large file to the VPS via SFTP using sftp.open() directly.

Avoids paramiko 4.0 sftp.put() which throws ENOENT for some reason on this
specific Win→Ubuntu path. Uses the same sftp.open(remote, 'wb') call that
was verified to work in a separate test.
"""
import os
import sys
import time
import paramiko

if len(sys.argv) != 4:
    print("usage: sftp-upload.py <host-alias> <local-path> <remote-path>")
    sys.exit(1)

host_alias, local, remote = sys.argv[1], sys.argv[2], sys.argv[3]

cfg_path = os.path.expanduser("~/.ssh/config")
cfg = paramiko.SSHConfig()
if os.path.exists(cfg_path):
    with open(cfg_path) as f:
        cfg.parse(f)
host_cfg = cfg.lookup(host_alias)
hostname = host_cfg.get("hostname", host_alias)
user = host_cfg.get("user", "root")
identity = host_cfg.get("identityfile", [None])[0]
if identity:
    identity = os.path.expanduser(identity)

print(f"Connecting to {user}@{hostname} (key={identity})", flush=True)
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(hostname, username=user, key_filename=identity, look_for_keys=False, allow_agent=False)
sftp = client.open_sftp()

local_size = os.path.getsize(local)
print(f"Local size: {local_size:,} bytes ({local_size/1024/1024/1024:.2f} GB)", flush=True)

CHUNK = 1024 * 1024  # 1 MiB
start = time.time()
last_print = start
last_bytes = 0
sent = 0

# Open the SFTP target FIRST so the SFTP connection is active before we
# touch the (potentially AV-scanned, slow-to-open) local 2.4 GB file.
print("Opening remote file...", flush=True)
rf = sftp.open(remote, "wb")
rf.set_pipelined(True)
print("Opening local file...", flush=True)
lf = open(local, "rb")
print("Streaming...", flush=True)

try:
    while True:
        buf = lf.read(CHUNK)
        if not buf:
            break
        rf.write(buf)
        sent += len(buf)
        now = time.time()
        if now - last_print >= 2.0:
            speed = (sent - last_bytes) / (now - last_print)
            pct = sent / local_size * 100
            eta_sec = (local_size - sent) / speed if speed > 0 else 0
            print(f"  {sent:>13,} / {local_size:,} bytes  {pct:5.1f}%  "
                  f"{speed/1024/1024:6.2f} MB/s  ETA {int(eta_sec//60):>3}m{int(eta_sec%60):02d}s",
                  flush=True)
            last_print = now
            last_bytes = sent
finally:
    lf.close()
    rf.close()

elapsed = time.time() - start
print(f"Done in {elapsed:.1f}s, average {local_size/elapsed/1024/1024:.2f} MB/s", flush=True)
sftp.close()
client.close()
