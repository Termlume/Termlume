"""Run on Linux with gcc and libfuse3-dev. No mount or server required."""
import pathlib
import shlex
import struct
import subprocess
import tempfile

source = pathlib.Path(__file__).with_name('main.c').resolve()
with tempfile.TemporaryDirectory() as directory:
    harness = pathlib.Path(directory) / 'transport.c'
    harness.write_text('''
#define RPC_TIMEOUT_MS 80
#define main fuse_helper_main
#include "%s"
#undef main
int main(void) {
  char *data = NULL; uint32_t size = 0;
  int result = rpc('R', "/file", 0, 4, &data, &size);
  free(data);
  return result == -EIO ? 42 : 0;
}
''' % source.as_posix())
    binary = str(pathlib.Path(directory) / 'transport')
    flags = shlex.split(subprocess.check_output(
        ['pkg-config', '--cflags', '--libs', 'fuse3'], text=True))
    subprocess.run(['gcc', '-Wall', '-Wextra', '-Werror', str(harness),
                    *flags, '-o', binary], check=True)

    # A correctly framed application error is recoverable.
    valid_error = subprocess.run([binary], input=struct.pack('<iI', -5, 0),
                                 capture_output=True, timeout=2)
    assert valid_error.returncode == 42
    # Broken frames must terminate instead of leaving replies for the next read.
    for frame in [b'', b'\0\0', struct.pack('<iI', 0, 16777217),
                  struct.pack('<iI', 0, 4) + b'ab']:
        result = subprocess.run([binary], input=frame, capture_output=True, timeout=2)
        assert result.returncode == 1, result.returncode
    # Keep stdin open: timeout must kill the helper before a late reply arrives.
    process = subprocess.Popen([binary], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    assert process.stdout.readline().startswith(b'R\t')
    assert process.wait(timeout=2) == 1
    process.stdin.close()
    process.stdout.close()
print('Transport: valid error, EOF, truncated frames, oversized frame and timeout passed')
